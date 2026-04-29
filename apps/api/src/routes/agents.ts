import { randomBytes } from "crypto";
import { Hono } from "hono";
import { agents, fleets, messages } from "../db/mongo.js";
import { broadcastToFleet } from "../db/memory.js";
import { provisionAgent } from "../services/provisioner.js";
import { terminateAgentPod, terminateAgentPodEks } from "../services/cloud-init.js";
import { removeAgentFromWorldState } from "../services/world.js";
import type { Env, MessageDoc } from "../types.js";

const router = new Hono<Env>();

// POST /fleets/:id/agents — deploy agent (tenant only)
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
	}).lean();
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
			.lean();
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
		}).lean();
		if (!agent) return c.json({ error: "agent not found" }, 404);
		return c.json(agent);
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

// PATCH /fleets/:id/agents/:agentId
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

// DELETE /fleets/:id/agents/:agentId — terminate (tenant only)
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
		}).lean();
		if (!agent) return c.json({ error: "agent not found" }, 404);

		if (agent.vm.instanceId) {
			try {
				if (agent.vm.provider === "gcp") {
					await terminateAgentPod(agent.vm.instanceId);
				} else {
					await terminateAgentPodEks(agent.vm.instanceId);
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

// GET /fleets/:id/peers — AXL peer directory
router.get("/:id/peers", async (c) => {
	try {
		const list = await (await agents())
			.find(
				{ fleetId: c.req.param("id"), tenantId: c.get("tenantId") },
				{ _id: 1, permissionTier: 1, axl: 1 },
			)
			.lean();

		return c.json(
			list.map((a) => ({
				agentId: a._id,
				permissionTier: a.permissionTier,
				peerId: a.axl.peerId,
				multiaddr: a.axl.multiaddr,
			})),
		);
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

// POST /fleets/:id/agents/:agentId/message
router.post("/:id/agents/:agentId/message", async (c) => {
	const body = await c.req.json<{
		toAgentId?: string;
		fromAgentId?: string;
		content: string;
		axlMessageId?: string;
	}>().catch(() => ({ content: "" })) as {
		toAgentId?: string;
		fromAgentId?: string;
		content: string;
		axlMessageId?: string;
	};

	if (!body.content) return c.json({ error: "content is required" }, 400);

	const fleetId = c.req.param("id");
	const agentId = c.req.param("agentId");
	const now = new Date();
	const fromAgentId = body.fromAgentId ?? (c.get("agentId") ?? agentId);
	const toAgentId = body.toAgentId ?? agentId;

	try {
		const msgId = `msg_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
		const msg: MessageDoc = {
			_id: msgId,
			fromAgentId,
			toAgentId,
			fleetId,
			tenantId: c.get("tenantId"),
			content: body.content,
			axlMessageId: body.axlMessageId ?? null,
			deliveredAt: now,
			createdAt: now,
		};

		await (await messages()).create(msg as never);

		broadcastToFleet(fleetId, {
			type: "agent_message",
			fromAgentId,
			toAgentId,
			preview: body.content.slice(0, 100),
			ts: now.toISOString(),
		});

		const recipient = await (await agents()).findOne(
			{ _id: toAgentId, fleetId },
			{ axl: 1 },
		).lean();

		return c.json({
			messageId: msgId,
			axlMultiaddr: recipient?.axl.multiaddr ?? null,
		}, 201);
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

export { router as agentsRouter };
