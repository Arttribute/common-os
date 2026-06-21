import { AgentEventSchema } from "@common-os/events";
import { randomBytes } from "crypto";
import { Hono } from "hono";
import { broadcastToFleet } from "../db/memory.js";
import { agents, events, tasks, worldStates } from "../db/mongo.js";
import type { Env } from "../types.js";

const router = new Hono<Env>();

const DEFAULT_PERSISTED_EVENT_TYPES = new Set([
	"token_usage",
	"error",
	"task_start",
	"task_complete",
]);

function persistedEventTypes(): Set<string> {
	const configured = process.env.PERSIST_EVENT_TYPES;
	if (!configured) return DEFAULT_PERSISTED_EVENT_TYPES;
	return new Set(configured.split(",").map((type) => type.trim()).filter(Boolean));
}

function shouldPersistEvent(type: string): boolean {
	const mode = (process.env.EVENT_PERSISTENCE_MODE ?? "minimal").toLowerCase();
	if (mode === "off" || mode === "disabled") return false;
	if (mode === "all") return true;
	return persistedEventTypes().has(type);
}

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
		} else if (event.type === "browser_status") {
			await agentCol.updateOne(
				{ _id: agentId },
				{
					$set: {
						"browser.status": event.payload.status,
						"browser.url": event.payload.url ?? null,
						"browser.title": event.payload.title ?? null,
						"browser.screenshot": event.payload.screenshot ?? null,
						"browser.lastAction": event.payload.lastAction ?? null,
						"browser.error": event.payload.error ?? null,
						"browser.updatedAt": now,
						updatedAt: now,
					},
				},
			);
		} else if (event.type === "heartbeat") {
			const heartbeatProvesRunning = ["provisioning", "starting", "stopped"].includes(agentDoc.status);
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
				{ $set: { lastHeartbeatAt: now, updatedAt: now, ...runtimePayload, ...(heartbeatProvesRunning ? { status: "running" } : {}) } },
			);
			if (heartbeatProvesRunning) {
				await (await worldStates()).updateOne(
					{ fleetId: agentDoc.fleetId, "agents.agentId": agentId },
					{ $set: { "agents.$.status": "running", updatedAt: now } },
				);
			}
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

		let eventId: string | null = null;
		let persistenceWarning: string | null = null;
		if (shouldPersistEvent(event.type)) {
			eventId = `evt_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
			try {
				await (await events()).create({
					_id: eventId,
					agentId,
					fleetId: agentDoc.fleetId,
					tenantId: agentDoc.tenantId,
					type: event.type,
					payload: (event as { payload?: Record<string, unknown> }).payload ?? {},
					createdAt: now,
				} as never);
			} catch (err) {
				persistenceWarning = err instanceof Error ? err.message : String(err);
				eventId = null;
				console.warn(`[events] skipped event persistence type=${event.type} agent=${agentId}: ${persistenceWarning}`);
			}
		}

		return c.json({ ok: true, eventId, persisted: Boolean(eventId), ...(persistenceWarning ? { persistenceWarning } : {}) });
	} catch (err) {
		console.warn("[events] state update failed:", err instanceof Error ? err.message : err);
		return c.json({ error: "database error" }, 503);
	}
});

export { router as eventsRouter };
