import { getCloudProvider } from "@common-os/cloud";
import { Hono } from "hono";
import { agents, fleets } from "../db/mongo.js";
import { provisionAgent } from "../services/provisioner.js";
import { terminateAgentPod } from "../services/cloud-init.js";
import { removeAgentFromWorldState } from "../services/world.js";
import type { Env } from "../types.js";

const router = new Hono<Env>();

// POST /fleets/:id/agents — deploy agent VM (tenant only)
router.post("/:id/agents", async (c) => {
	if (c.get("authType") === "agent") {
		return c.json({ error: "tenant authorization required" }, 403);
	}

	const fleetId = c.req.param("id");
	const body = await c.req.json<{
		role: string;
		systemPrompt?: string;
		permissionTier?: "manager" | "worker";
		room?: string;
		integrationPath?: "native" | "openclaw" | "guest";
		dockerImage?: string;
		openclawConfig?: {
			modelProvider?: string;
			modelApiKey?: string;
			channels?: Record<string, Record<string, string>>;
			plugins?: string[];
			dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
		};
		instanceType?: string;
	}>();
	if (!body.role) return c.json({ error: "role is required" }, 400);

	const fleet = await (await fleets()).findOne({
		_id: fleetId,
		tenantId: c.get("tenantId"),
	});
	if (!fleet) return c.json({ error: "fleet not found" }, 404);

	try {
		const agent = await provisionAgent({
			fleetId,
			tenantId: c.get("tenantId"),
			fleet,
			role: body.role,
			systemPrompt: body.systemPrompt ?? `You are a ${body.role} agent.`,
			permissionTier: body.permissionTier ?? "worker",
			room: body.room ?? fleet.worldConfig.rooms[0]?.id ?? "dev-room",
			integrationPath: body.integrationPath ?? "native",
			dockerImage: body.dockerImage ?? null,
			openclawConfig: body.openclawConfig
				? {
						modelProvider: body.openclawConfig.modelProvider ?? null,
						modelApiKey: body.openclawConfig.modelApiKey ?? null,
						channels: body.openclawConfig.channels ?? null,
						plugins: body.openclawConfig.plugins ?? null,
						dmPolicy: body.openclawConfig.dmPolicy ?? "pairing",
					}
				: null,
			instanceType: body.instanceType ?? "t3.medium",
		});
		return c.json(agent, 201);
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "provisioning failed" },
			503,
		);
	}
});

// GET /fleets/:id/agents
router.get("/:id/agents", async (c) => {
	try {
		const list = await (await agents())
			.find({ fleetId: c.req.param("id"), tenantId: c.get("tenantId") })
			.sort({ createdAt: -1 })
			.toArray();
		return c.json(list);
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

// GET /fleets/:id/agents/:agentId
router.get("/:id/agents/:agentId", async (c) => {
	try {
		const agent = await (await agents()).findOne({
			_id: c.req.param("agentId"),
			fleetId: c.req.param("id"),
			tenantId: c.get("tenantId"),
		});
		if (!agent) return c.json({ error: "agent not found" }, 404);
		return c.json(agent);
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

// PATCH /fleets/:id/agents/:agentId — update world position or AXL info
router.patch("/:id/agents/:agentId", async (c) => {
	const body = await c.req.json<Record<string, unknown>>();
	const allowed = ["world", "axl.multiaddr", "axl.peerId", "status"];
	const update: Record<string, unknown> = { updatedAt: new Date() };
	for (const key of allowed) {
		if (body[key] !== undefined) update[key] = body[key];
	}

	try {
		await (await agents()).updateOne(
			{
				_id: c.req.param("agentId"),
				fleetId: c.req.param("id"),
				tenantId: c.get("tenantId"),
			},
			{ $set: update },
		);
		return c.json({ ok: true });
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

// DELETE /fleets/:id/agents/:agentId — terminate VM (tenant only)
router.delete("/:id/agents/:agentId", async (c) => {
	if (c.get("authType") === "agent") {
		return c.json({ error: "tenant authorization required" }, 403);
	}

	try {
		const col = await agents();
		const agent = await col.findOne({
			_id: c.req.param("agentId"),
			fleetId: c.req.param("id"),
			tenantId: c.get("tenantId"),
		});
		if (!agent) return c.json({ error: "agent not found" }, 404);

		if (agent.vm.instanceId) {
			try {
				if (agent.vm.provider === "gcp") {
					// instanceId is the Kubernetes namespace name for GKE agents
					await terminateAgentPod(agent.vm.instanceId);
				} else {
					const cloud = getCloudProvider(agent.vm.provider, agent.vm.region);
					await cloud.terminate(agent.vm.instanceId);
				}
			} catch {
				// Don't block if cloud call fails
			}
		}

		await col.updateOne(
			{ _id: agent._id },
			{ $set: { status: "terminated", updatedAt: new Date() } },
		);
		await removeAgentFromWorldState(agent.fleetId, agent._id);

		return c.json({ ok: true });
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

export { router as agentsRouter };
