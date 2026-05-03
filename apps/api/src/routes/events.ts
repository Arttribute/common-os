import { AgentEventSchema } from "@common-os/events";
import { randomBytes } from "crypto";
import { Hono } from "hono";
import { broadcastToFleet } from "../db/memory.js";
import { agents, events, tasks, worldStates } from "../db/mongo.js";
import { registerAgentENS } from "../services/ens.js";
import type { Env } from "../types.js";

const router = new Hono<Env>();

// POST /events — agent emits an event
router.post("/", async (c) => {
	const raw = await c.req.json<Record<string, unknown>>();

	const parsed = AgentEventSchema.safeParse(raw);
	if (!parsed.success) {
		return c.json(
			{ error: "invalid event", details: parsed.error.issues },
			400,
		);
	}

	const event = parsed.data;
	const agentId = (c.get("agentId") ?? raw["agentId"]) as string | undefined;
	if (!agentId) return c.json({ error: "agentId required" }, 400);

	try {
		const agentDoc = await (await agents()).findOne({
			_id: agentId,
			tenantId: c.get("tenantId"),
		}).lean();
		if (!agentDoc) return c.json({ error: "agent not found" }, 404);

		const now = new Date();
		const eventId = `evt_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

		await (await events()).create({
			_id: eventId,
			agentId,
			fleetId: agentDoc.fleetId,
			tenantId: agentDoc.tenantId,
			type: event.type,
			payload: (event as { payload?: Record<string, unknown> }).payload ?? {},
			createdAt: now,
		} as never);

		const agentCol = await agents();

		if (event.type === "world_move") {
			const { room, x, y } = event.payload;
			await agentCol.updateOne(
				{ _id: agentId },
				{
					$set: {
						"world.room": room,
						"world.x": x,
						"world.y": y,
						updatedAt: now,
					},
				},
			);
			await (await worldStates()).updateOne(
				{ fleetId: agentDoc.fleetId, "agents.agentId": agentId },
				{
					$set: {
						"agents.$.world": { room, x, y, facing: "south" },
						updatedAt: now,
					},
				},
			);
		} else if (event.type === "state_change") {
			const statusMap: Record<string, string> = {
				online: "running",
				idle: "idle",
				working: "running",
				error: "error",
				offline: "stopped",
			};
			const agentStatus = (statusMap[event.payload.status] ??
				event.payload.status) as import("../types.js").AgentStatus;
			await agentCol.updateOne(
				{ _id: agentId },
				{ $set: { status: agentStatus, updatedAt: now } },
			);
			await (await worldStates()).updateOne(
				{ fleetId: agentDoc.fleetId, "agents.agentId": agentId },
				{ $set: { "agents.$.status": agentStatus, updatedAt: now } },
			);
			void registerAgentENS(
				agentId,
				{
					fleetId: agentDoc.fleetId,
					role: agentDoc.config.role,
					status: agentStatus,
					peerId: agentDoc.axl.peerId,
					multiaddr: agentDoc.axl.multiaddr,
					commonsAgentId: agentDoc.commons.agentId,
				},
				agentDoc.commons.walletAddress,
			);
		} else if (event.type === "world_interact") {
			// Log the interaction — no state mutation needed (object state is ephemeral)
		} else if (event.type === "world_create_object") {
			const { objectId, objectType, room, x, y, label } = event.payload;
			await (await worldStates()).updateOne(
				{ fleetId: agentDoc.fleetId },
				{
					$push: {
						objects: {
							objectId,
							objectType,
							room,
							x,
							y,
							label: label ?? null,
							createdByAgentId: agentId,
						} as never,
					},
					$set: { updatedAt: now },
				},
			);
		} else if (event.type === "workspace_snapshot") {
			await agentCol.updateOne(
				{ _id: agentId },
				{
					$set: {
						"workspace.snapshot": event.payload.snapshot,
						"workspace.rootDir": event.payload.rootDir,
						"workspace.updatedAt": now,
						updatedAt: now,
					},
				},
			);
		} else if (event.type === "heartbeat") {
			const runtimePayload = event.payload
				? {
					"runtime.name": event.payload.runtime ?? null,
					"runtime.commitSha": event.payload.commitSha ?? null,
					"runtime.agentImage": event.payload.agentImage ?? null,
					"runtime.updatedAt": now,
				}
				: {};
			await agentCol.updateOne(
				{ _id: agentId },
				{ $set: { lastHeartbeatAt: now, updatedAt: now, ...runtimePayload } },
			);
		} else if (event.type === "task_start") {
			await (await tasks()).updateOne(
				{ _id: event.payload.taskId, agentId },
				{ $set: { status: "running", startedAt: now } },
			);
		} else if (event.type === "task_complete") {
			await (await tasks()).updateOne(
				{ _id: event.payload.taskId, agentId },
				{
					$set: {
						status: "completed",
						output: event.payload.output ?? null,
						completedAt: now,
					},
				},
			);
		}

		broadcastToFleet(agentDoc.fleetId, {
			type: "agent_event",
			agentId,
			event,
			ts: now.toISOString(),
		});

		return c.json({ ok: true, eventId });
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

export { router as eventsRouter };
