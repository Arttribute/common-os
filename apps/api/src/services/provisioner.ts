import { createHash, randomBytes } from "crypto";
import { agents, fleets, worldStates } from "../db/mongo.js";
import type { AgentDoc, FleetDoc } from "../types.js";
import { launchAgentPod, launchAgentPodEks } from "./cloud-init.js";

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
			? { agentId: null, apiKey: null, walletAddress: null }
			: await registerWithAgentCommons(agentId, opts.role, opts.systemPrompt);

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
		return { agentId: null, apiKey: null, walletAddress: null };
	}

	const headers = {
		"Authorization": `Bearer ${platformKey}`,
		"Content-Type": "application/json",
	};

	try {
		// Step 1: create the agent
		const agentRes = await fetch("https://api.agentcommons.io/v1/agents", {
			method: "POST",
			headers,
			body: JSON.stringify({
				name: `${role}-${agentId}`,
				instructions: systemPrompt,
			}),
		});
		if (!agentRes.ok) {
			console.error(`[provisioner] Agent Commons create agent failed: ${agentRes.status}`);
			return { agentId: null, apiKey: null, walletAddress: null };
		}
		const agentData = (await agentRes.json()) as { agentId?: string };
		const commonsAgentId = agentData.agentId ?? null;
		if (!commonsAgentId) return { agentId: null, apiKey: null, walletAddress: null };

		// Step 2: create an API key for the agent (plaintext key returned once only)
		const keyRes = await fetch("https://api.agentcommons.io/v1/auth/api-keys", {
			method: "POST",
			headers,
			body: JSON.stringify({
				principalId: commonsAgentId,
				principalType: "agent",
				label: `commonos-${agentId}`,
			}),
		});
		if (!keyRes.ok) {
			console.error(`[provisioner] Agent Commons create API key failed: ${keyRes.status}`);
			return { agentId: commonsAgentId, apiKey: null, walletAddress: null };
		}
		const keyData = (await keyRes.json()) as { key?: string };

		return {
			agentId: commonsAgentId,
			apiKey: keyData.key ?? null,
			walletAddress: null,
		};
	} catch (err) {
		console.error("[provisioner] Agent Commons registration error:", err);
		return { agentId: null, apiKey: null, walletAddress: null };
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
