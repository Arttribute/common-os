import { getCloudProvider } from "@common-os/cloud";
import { createHash, randomBytes } from "crypto";
import { agents, fleets, worldStates } from "../db/mongo.js";
import type { AgentDoc, FleetDoc } from "../types.js";
import { buildStartupScript, launchAgentPod } from "./cloud-init.js";

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
	instanceType: string;
}

export async function provisionAgent(
	opts: ProvisionAgentOptions,
): Promise<AgentDoc & { agentToken: string }> {
	const agentId = `agt_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
	const agentToken = `c_os_agent_${randomBytes(24).toString("hex")}`;
	const agentTokenHash = createHash("sha256").update(agentToken).digest("hex");
	const now = new Date();

	const roomDef = opts.fleet.worldConfig.rooms.find((r) => r.id === opts.room);
	const startX = roomDef ? roomDef.bounds.x + 2 : 2;
	const startY = roomDef ? roomDef.bounds.y + 2 : 2;

	const provider = (process.env.CLOUD_PROVIDER as "aws" | "gcp") ?? "aws";
	const region = process.env.CLOUD_REGION ?? "us-east-1";

	// Agent Commons registration: native path only.
	// OpenClaw manages its own model identity — registration skipped.
	const commons =
		opts.integrationPath === "openclaw"
			? { agentId: null, apiKey: null, walletAddress: null }
			: await registerWithAgentCommons(agentId, opts.role, opts.systemPrompt);

	const agentDoc: AgentDoc = {
		_id: agentId,
		fleetId: opts.fleetId,
		tenantId: opts.tenantId,
		commons,
		vm: {
			instanceId: null,
			provider,
			region,
			instanceType: opts.instanceType,
			publicIp: null,
			privateIp: null,
			diskGb: 20,
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

	await (await agents()).insertOne(agentDoc as never);

	await (await fleets()).updateOne(
		{ _id: opts.fleetId },
		{ $inc: { agentCount: 1 }, $set: { updatedAt: now } },
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

	// Cloud provisioning is async — agent is returned to caller immediately.
	void launchCloudInstance(agentDoc, opts, agentToken, commons.apiKey);

	return { ...agentDoc, agentToken };
}

// Registers the agent with Agent Commons to get an identity + API key.
// Skips gracefully if AGENTCOMMONS_API_KEY is not configured.
async function registerWithAgentCommons(
	agentId: string,
	role: string,
	systemPrompt: string,
): Promise<AgentDoc["commons"]> {
	const platformKey = process.env.AGENTCOMMONS_API_KEY;
	if (!platformKey) {
		return { agentId: null, apiKey: null, walletAddress: null };
	}

	try {
		const res = await fetch("https://api.agentcommons.io/v1/agents", {
			method: "POST",
			headers: {
				"x-api-key": platformKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: `${role}-${agentId}`,
				instructions: systemPrompt,
			}),
		});

		if (!res.ok) return { agentId: null, apiKey: null, walletAddress: null };

		const data = (await res.json()) as {
			id?: string;
			apiKey?: string;
			walletAddress?: string;
		};

		return {
			agentId: data.id ?? null,
			apiKey: data.apiKey ?? null,
			walletAddress: data.walletAddress ?? null,
		};
	} catch {
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

	try {
		if (agentDoc.vm.provider === "gcp") {
			// GCP: deploy per-agent pod on shared GKE cluster with GCS FUSE storage
			const result = await launchAgentPod({
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
			});

			await (await agents()).updateOne(
				{ _id: agentDoc._id },
				{
					$set: {
						"vm.instanceId": result.serviceId,
						status: "starting",
						updatedAt: new Date(),
					},
				},
			);
		} else {
			// AWS (default): provision EC2 instance with cloud-init startup script
			const cloud = getCloudProvider(agentDoc.vm.provider, agentDoc.vm.region);
			const startupScript = buildStartupScript({
				agentId: agentDoc._id,
				agentToken,
				fleetId: agentDoc.fleetId,
				tenantId: agentDoc.tenantId,
				apiUrl,
				role: opts.role,
				systemPrompt: opts.systemPrompt,
				dockerImage: opts.dockerImage,
				commonsApiKey: commonsApiKey ?? "",
				commonsAgentId: agentDoc.commons.agentId ?? "",
				integrationPath: opts.integrationPath === "openclaw" ? "native" : opts.integrationPath,
			});

			const instance = await cloud.provision({
				tenantId: agentDoc.tenantId,
				agentId: agentDoc._id,
				region: agentDoc.vm.region,
				instanceType: agentDoc.vm.instanceType,
				diskGb: agentDoc.vm.diskGb,
				startupScript,
				tags: {
					fleet: agentDoc.fleetId,
					tenant: agentDoc.tenantId,
					role: opts.role,
					"managed-by": "common-os",
				},
			});

			await (await agents()).updateOne(
				{ _id: agentDoc._id },
				{
					$set: {
						"vm.instanceId": instance.instanceId,
						"vm.publicIp": instance.publicIp,
						"vm.privateIp": instance.privateIp,
						status: "starting",
						updatedAt: new Date(),
					},
				},
			);
		}
	} catch (err) {
		console.error(`[provisioner] cloud launch failed for ${agentDoc._id}:`, err);
		// Agent stays at provisioning status — daemon will never boot without infra
	}
}
