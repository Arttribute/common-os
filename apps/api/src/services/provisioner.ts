import { createHash, randomBytes } from "crypto";
import { agents, fleets, worldStates } from "../db/mongo.js";
import type { AgentDoc, FleetDoc } from "../types.js";
import { launchAgentPod, launchAgentPodEks } from "./cloud-init.js";

const AGC_BASE_URL = (process.env.AGC_API_URL ?? "https://api.agentcommons.io").replace(/\/$/, "");
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

interface ProvisionAgentOptions {
	fleetId: string;
	tenantId: string;
	fleet: FleetDoc;
	role: string;
	systemPrompt: string;
	permissionTier: "manager" | "worker";
	room: string;
	integrationPath: "native" | "openclaw" | "guest";
	dockerImage: string | null;
	openclawConfig: AgentDoc["config"]["openclawConfig"];
}

export async function provisionAgent(
	opts: ProvisionAgentOptions,
): Promise<AgentDoc & { agentToken: string }> {
	const agentId = `agt_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
	const agentToken = `cos_agent_${randomBytes(24).toString("hex")}`;
	const agentTokenHash = createHash("sha256").update(agentToken).digest("hex");
	const now = new Date();

	const roomDef = opts.fleet.worldConfig.rooms.find((r) => r.id === opts.room);
	const startX = roomDef ? roomDef.bounds.x + 2 : 2;
	const startY = roomDef ? roomDef.bounds.y + 2 : 2;

	const provider = (process.env.CLOUD_PROVIDER as "gcp" | "aws") ?? "gcp";
	const region = process.env.GCP_REGION ?? process.env.CLOUD_REGION ?? "europe-west1";

	const commons =
		opts.integrationPath === "openclaw"
			? { agentId: null, apiKey: null, walletAddress: null, registryAgentId: null }
			: await registerWithAgentCommons(agentId, opts.role, opts.systemPrompt);

	if (opts.integrationPath === "native" && !commons.agentId) {
		throw new Error("Agent Commons registration failed; native agents require a commons agentId");
	}

	const agentDoc: AgentDoc = {
		_id: agentId,
		fleetId: opts.fleetId,
		tenantId: opts.tenantId,
		commons,
		pod: {
			namespaceId: null,
			provider,
			region,
		},
		agentTokenHash,
		status: "provisioning",
		permissionTier: opts.permissionTier,
		config: {
			role: opts.role,
			systemPrompt: opts.systemPrompt,
			integrationPath: opts.integrationPath,
			dockerImage: opts.dockerImage,
			openclawConfig: opts.openclawConfig ?? null,
			tools: [],
		},
		world: { room: opts.room, x: startX, y: startY, facing: "south" },
		axl: { peerId: null, multiaddr: null },
		lastHeartbeatAt: null,
		startedAt: null,
		createdAt: now,
		updatedAt: now,
	};

	await (await agents()).create(agentDoc as never);

	await (await fleets()).updateOne(
		{ _id: opts.fleetId },
		{ $inc: { agentCount: 1 } as never, $set: { updatedAt: now } },
	);

	await (await worldStates()).updateOne(
		{ fleetId: opts.fleetId },
		{
			$push: {
				agents: {
					agentId,
					role: opts.role,
					permissionTier: opts.permissionTier,
					status: "provisioning",
					world: agentDoc.world,
				} as never,
			},
			$set: { updatedAt: now },
		},
	);

	void launchCloudInstance(agentDoc, opts, agentToken, commons.apiKey);

	return { ...agentDoc, agentToken };
}

export async function registerWithAgentCommons(
	agentId: string,
	role: string,
	systemPrompt: string,
): Promise<AgentDoc["commons"]> {
	const platformKey = process.env.AGENTCOMMONS_API_KEY;
	if (!platformKey) {
		return { agentId: null, apiKey: null, walletAddress: null, registryAgentId: null };
	}

	// SDK uses Authorization: Bearer + x-initiator (wallet address of the platform user)
	const baseHeaders = {
		"Authorization": `Bearer ${platformKey}`,
		"Content-Type": "application/json",
	};

	try {
		// Resolve our platform principal (wallet address) so agents are owned correctly
		let owner: string | null = null;
		try {
			const meRes = await fetch(`${AGC_BASE_URL}/v1/auth/me`, {
				headers: baseHeaders,
				signal: AbortSignal.timeout(8_000),
			});
			if (meRes.ok) {
				const raw = (await meRes.json()) as Record<string, unknown>;
				const me = (raw.data ?? raw) as { principalId?: string | null; principalType?: string | null };
				owner = me.principalId ?? null;
			}
		} catch {
			// Non-fatal — owner is optional
		}

		const headers = owner
			? { ...baseHeaders, "x-initiator": owner }
			: baseHeaders;

		// Step 1: create the agent
		const agentRes = await fetch(`${AGC_BASE_URL}/v1/agents`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				name: `${role}-${agentId}`,
				instructions: systemPrompt,
				modelProvider: "openai",
				modelId: "gpt-4o",
				...(owner && { owner }),
			}),
			signal: AbortSignal.timeout(15_000),
		});
		if (!agentRes.ok) {
			const body = await agentRes.text().catch(() => '')
			console.error(`[provisioner] Agent Commons create agent failed: ${agentRes.status} ${body}`);
			return { agentId: null, apiKey: null, walletAddress: null, registryAgentId: null };
		}
		const rawAgentData = (await agentRes.json()) as Record<string, unknown>;
		const agentData = (rawAgentData.data ?? rawAgentData) as {
			agentId?: string;
			id?: string;
			walletAddress?: string | null;
			address?: string | null;
			primaryWalletAddress?: string | null;
			wallet?: { address?: string | null };
		};
		const registryAgentId = agentData.agentId ?? agentData.id ?? null;
		console.log(`[provisioner] Agent Commons registry agent created: ${registryAgentId}`);
		if (!registryAgentId) return { agentId: null, apiKey: null, walletAddress: null, registryAgentId: null };

		let walletAddress =
			agentData.walletAddress ??
			agentData.primaryWalletAddress ??
			agentData.address ??
			agentData.wallet?.address ??
			null;
		try {
			const walletRes = await fetch(`${AGC_BASE_URL}/v1/wallets/agent/${registryAgentId}/primary`, {
				headers,
				signal: AbortSignal.timeout(8_000),
			});
			if (walletRes.ok) {
				const raw = (await walletRes.json()) as Record<string, unknown>;
				const wallet = (raw.data ?? raw) as { address?: string | null };
				walletAddress = wallet.address ?? null;
			}
		} catch {
			// Non-fatal — some agents may not have a primary wallet immediately.
		}

		if (!walletAddress) {
			try {
				const createWalletRes = await fetch(`${AGC_BASE_URL}/v1/wallets`, {
					method: "POST",
					headers,
					body: JSON.stringify({
						agentId: registryAgentId,
						type: "eoa",
						label: "Primary",
					}),
					signal: AbortSignal.timeout(10_000),
				});
				if (createWalletRes.ok) {
					const raw = (await createWalletRes.json()) as Record<string, unknown>;
					const wallet = (raw.data ?? raw) as { address?: string | null };
					walletAddress = wallet.address ?? null;
				}
			} catch {
				// Handled below.
			}
		}

		if (!walletAddress || !ETH_ADDRESS_RE.test(walletAddress)) {
			console.error(`[provisioner] Agent Commons agent ${registryAgentId} has no 0x wallet address`);
			return { agentId: null, apiKey: null, walletAddress: null, registryAgentId };
		}

		// Agent Commons only allows creating API keys for yourself, so per-agent keys
		// aren't possible. The platform key is returned so the daemon can run this agent.
		// We do NOT store the platform key in MongoDB — bootstrap always injects it from env.
		return {
			agentId: walletAddress,
			apiKey: null,  // intentionally null in DB; bootstrap provides the platform key at runtime
			walletAddress,
			registryAgentId,
		};
	} catch (err) {
		console.error("[provisioner] Agent Commons registration error:", err);
		return { agentId: null, apiKey: null, walletAddress: null, registryAgentId: null };
	}
}

async function launchCloudInstance(
	agentDoc: AgentDoc,
	opts: ProvisionAgentOptions,
	agentToken: string,
	commonsApiKey: string | null,
): Promise<void> {
	const apiUrl = process.env.API_URL ?? "http://localhost:3001";

	const podOpts = {
		agentId: agentDoc._id,
		agentToken,
		fleetId: agentDoc.fleetId,
		tenantId: agentDoc.tenantId,
		apiUrl,
		role: opts.role,
		integrationPath: opts.integrationPath,
		dockerImage: opts.dockerImage,
		commonsApiKey: commonsApiKey ?? "",
		commonsAgentId: agentDoc.commons.agentId ?? "",
		runnerUrl: process.env.RUNNER_URL,
		worldRoom: agentDoc.world.room,
		worldX: agentDoc.world.x,
		worldY: agentDoc.world.y,
	};

	const deadline = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error("pod launch timed out after 15m")), 15 * 60 * 1000),
	);

	try {
		const launch = agentDoc.pod.provider === "gcp"
			? launchAgentPod(podOpts)
			: launchAgentPodEks(podOpts);

		const result = await Promise.race([launch, deadline]);

		await (await agents()).updateOne(
			{ _id: agentDoc._id },
			{
				$set: {
					"pod.namespaceId": result.serviceId,
					status: "starting",
					updatedAt: new Date(),
				},
			},
		);
	} catch (err) {
		console.error(`[provisioner] cloud launch failed for ${agentDoc._id}:`, err);
		await (await agents()).updateOne(
			{ _id: agentDoc._id },
			{ $set: { status: "failed", updatedAt: new Date() } },
		);
	}
}
