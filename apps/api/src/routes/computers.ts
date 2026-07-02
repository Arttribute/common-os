import { Hono } from "hono";
import { randomBytes } from "crypto";
import { agents, agentSessions, fleets, humanMessages } from "../db/mongo.js";
import { enqueueHumanMessage, broadcastToFleet } from "../db/memory.js";
import {
	agentCommonsServiceToken,
	provisionAgent,
} from "../services/provisioner.js";
import {
	inspectAgentPodEks,
	readAgentWorkspaceFile,
	terminateAgentPod,
	terminateAgentPodEks,
	WorkspaceReadError,
} from "../services/cloud-init.js";
import { ensureDefaultRuntimeSession } from "../services/runtimeSessions.js";
import { removeAgentFromWorldState } from "../services/world.js";
import type { Env, HumanMessageDoc } from "../types.js";
import { publicAgent } from "../utils/public-agent.js";

const router = new Hono<Env>();

function defaultComputerFleetId() {
	return (
		process.env.COMMONOS_COMPUTER_FLEET_ID ??
		process.env.COMMONOS_DEFAULT_COMPUTER_FLEET_ID ??
		process.env.COMMON_OS_FLEET_ID ??
		null
	);
}

async function verifyAgentCommonsOwnership(
	c: any,
	agentCommonsId?: string,
) {
	if (!agentCommonsId) return null;
	const agcUrl = (process.env.AGC_API_URL ?? "https://api.agentcommons.io").replace(/\/$/, "");
	const serviceToken = await agentCommonsServiceToken();
	if (!serviceToken || !c.get("userId")) {
		return c.json({ error: "Could not verify Agent Commons ownership" }, 503);
	}
	const verifyResponse = await fetch(
		`${agcUrl}/v1/agents/${encodeURIComponent(agentCommonsId)}`,
		{ headers: { Authorization: `Bearer ${serviceToken}` } },
	);
	if (!verifyResponse.ok) {
		return c.json(
			{ error: "Agent Commons agent was not found or is not owned by this Commons account" },
			verifyResponse.status === 404 ? 404 : 403,
		);
	}
	const rawAgent = (await verifyResponse.json()) as Record<string, unknown>;
	const agent = (rawAgent.data ?? rawAgent) as {
		ownerUserId?: string;
		workspaceId?: string;
	};
	if (
		agent.ownerUserId !== c.get("userId") ||
		(c.get("workspaceId") &&
			agent.workspaceId &&
			agent.workspaceId !== c.get("workspaceId"))
	) {
		return c.json(
			{ error: "Agent Commons agent was not found or is not owned by this Commons account" },
			403,
		);
	}
	return null;
}

async function getComputer(c: any) {
	return (await agents()).findOne({
		_id: c.req.param("computerId"),
		tenantId: c.get("tenantId"),
	}).lean();
}

// POST /computers - deploy a general-purpose computer pod.
router.post("/", async (c) => {
	if (c.get("authType") === "agent") {
		return c.json({ error: "tenant authorization required" }, 403);
	}

	const body = await c.req.json<{
		fleetId?: string;
		name?: string;
		role?: string;
		systemPrompt?: string;
		permissionTier?: "manager" | "worker";
		room?: string;
		integrationPath?: "native" | "openclaw" | "hermes" | "guest";
		dockerImage?: string | null;
		image?: string | null;
		nativeConfig?: {
			modelProvider?: string;
			modelId?: string;
			modelApiKey?: string;
		};
		openclawConfig?: {
			modelProvider?: string;
			modelId?: string;
			modelApiKey?: string;
			channels?: Record<string, Record<string, unknown>>;
			plugins?: string[];
			dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
		};
		hermesConfig?: {
			modelProvider?: string;
			modelId?: string;
			modelApiKey?: string;
			gatewayApiKey?: string;
		};
		agentCommonsId?: string;
	}>().catch(() => ({}));

	const fleetId = body.fleetId ?? c.req.query("fleetId") ?? defaultComputerFleetId();
	if (!fleetId) {
		return c.json({ error: "fleetId is required unless COMMONOS_COMPUTER_FLEET_ID is configured" }, 400);
	}

	const fleet = await (await fleets()).findOne({
		_id: fleetId,
		tenantId: c.get("tenantId"),
	}).lean();
	if (!fleet) return c.json({ error: "computer placement fleet not found" }, 404);

	const ownershipError = await verifyAgentCommonsOwnership(c, body.agentCommonsId);
	if (ownershipError) return ownershipError;

	const role = body.role ?? body.name ?? "computer";
	try {
		const computer = await provisionAgent({
			fleetId,
			tenantId: c.get("tenantId"),
			userId: c.get("userId"),
			workspaceId: c.get("workspaceId"),
			existingCommonsAgentId: body.agentCommonsId,
			fleet,
			role,
			systemPrompt: body.systemPrompt ?? `You are an isolated CommonOS computer runtime named ${role}.`,
			permissionTier: body.permissionTier ?? "worker",
			room: body.room ?? fleet.worldConfig.rooms[0]?.id ?? "dev-room",
			integrationPath: body.integrationPath ?? "native",
			dockerImage: body.dockerImage ?? body.image ?? null,
			nativeConfig: body.nativeConfig
				? {
						modelProvider: body.nativeConfig.modelProvider ?? "openai",
						modelId: body.nativeConfig.modelId ?? null,
						modelApiKey: body.nativeConfig.modelApiKey ?? null,
					}
				: null,
			openclawConfig: body.openclawConfig
				? {
						modelProvider: body.openclawConfig.modelProvider ?? null,
						modelId: body.openclawConfig.modelId ?? null,
						modelApiKey: body.openclawConfig.modelApiKey ?? null,
						channels: body.openclawConfig.channels ?? null,
						plugins: body.openclawConfig.plugins ?? null,
						dmPolicy: body.openclawConfig.dmPolicy ?? "pairing",
					}
				: null,
			hermesConfig: body.hermesConfig
				? {
						modelProvider: body.hermesConfig.modelProvider ?? null,
						modelId: body.hermesConfig.modelId ?? null,
						modelApiKey: body.hermesConfig.modelApiKey ?? null,
						gatewayApiKey: body.hermesConfig.gatewayApiKey ?? null,
					}
				: null,
		});
		return c.json(publicAgent(computer), 201);
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "computer provisioning failed" },
			503,
		);
	}
});

// GET /computers?fleetId=... - list computer pods visible to the tenant.
router.get("/", async (c) => {
	try {
		const fleetId = c.req.query("fleetId");
		const includeTerminated = c.req.query("includeTerminated") === "true";
		const query: Record<string, unknown> = { tenantId: c.get("tenantId") };
		if (fleetId) query.fleetId = fleetId;
		if (!includeTerminated) query.status = { $ne: "terminated" };
		const list = await (await agents())
			.find(query)
			.sort({ createdAt: -1 })
			.lean();
		return c.json(list.map(publicAgent));
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

// GET /computers/:computerId
router.get("/:computerId", async (c) => {
	try {
		const computer = await getComputer(c);
		if (!computer) return c.json({ error: "computer not found" }, 404);
		return c.json(publicAgent(computer));
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

// GET /computers/:computerId/runtime-status
router.get("/:computerId/runtime-status", async (c) => {
	try {
		const computer = await getComputer(c);
		if (!computer) return c.json({ error: "computer not found" }, 404);
		if (!computer.pod.namespaceId) return c.json({ error: "computer pod is not ready" }, 409);
		if (computer.pod.provider !== "aws") {
			return c.json({ error: "runtime diagnostics are available for AWS pods" }, 409);
		}
		return c.json(await inspectAgentPodEks(computer.pod.namespaceId, computer._id));
	} catch (err) {
		console.error("[computers] runtime diagnostics failed:", err);
		return c.json({ error: "could not inspect computer runtime" }, 502);
	}
});

// GET /computers/:computerId/workspace/read?path=/file.txt
router.get("/:computerId/workspace/read", async (c) => {
	try {
		const computer = await getComputer(c);
		if (!computer) return c.json({ error: "computer not found" }, 404);
		if (!computer.pod.namespaceId) return c.json({ error: "computer pod is not ready" }, 409);

		const content = await readAgentWorkspaceFile({
			agentId: computer._id,
			namespace: computer.pod.namespaceId,
			provider: computer.pod.provider,
			region: computer.pod.region,
			rootDir: computer.workspace?.rootDir,
			path: c.req.query("path") ?? "",
		});
		return c.json({ content });
	} catch (err) {
		if (err instanceof WorkspaceReadError) {
			return c.json({ error: err.message }, err.status as any);
		}
		console.error("[computers] workspace read failed:", err);
		return c.json({ error: "could not read workspace file" }, 502);
	}
});

// POST /computers/:computerId/instructions - send a runtime instruction.
router.post("/:computerId/instructions", async (c) => {
	const body = await c.req.json<{ content: string; sessionId?: string }>().catch(() => ({
		content: "",
		sessionId: undefined,
	}));
	if (!body.content) return c.json({ error: "content is required" }, 400);

	try {
		const computer = await getComputer(c);
		if (!computer) return c.json({ error: "computer not found" }, 404);

		let sessionId: string | null = body.sessionId ?? null;
		if (sessionId) {
			const sess = await (await agentSessions()).findOne({
				agentId: computer._id,
				$or: [{ _id: sessionId }, { agcSessionId: sessionId }],
			}).lean();
			if (!sess) return c.json({ error: "session not found" }, 404);
			sessionId = sess._id as string;
		} else {
			const session = await ensureDefaultRuntimeSession(computer);
			sessionId = session._id;
		}

		const msgId = `hmsg_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
		const now = new Date();
		const doc: HumanMessageDoc = {
			_id: msgId,
			agentId: computer._id,
			fleetId: computer.fleetId,
			tenantId: c.get("tenantId"),
			sessionId,
			content: body.content,
			status: "pending",
			response: null,
			error: null,
			respondedAt: null,
			failedAt: null,
			processingStartedAt: null,
			updatedAt: now,
			source: "human",
			axlDirection: null,
			axlTargetAgentId: null,
			axlTargetPeerId: null,
			fromAgentId: null,
			toAgentId: null,
			axlPeerId: null,
			axlMessageId: null,
			createdAt: now,
		};

		await (await humanMessages()).create(doc as never);
		enqueueHumanMessage(computer._id, msgId);
		broadcastToFleet(computer.fleetId, {
			type: "human_message",
			agentId: computer._id,
			msgId,
			sessionId,
			content: body.content,
			ts: now.toISOString(),
		});

		return c.json(doc, 201);
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : "database error" }, 503);
	}
});

// GET /computers/:computerId/instructions - list recent runtime instructions.
router.get("/:computerId/instructions", async (c) => {
	try {
		const computer = await getComputer(c);
		if (!computer) return c.json({ error: "computer not found" }, 404);
		const list = await (await humanMessages())
			.find({
				agentId: computer._id,
				fleetId: computer.fleetId,
				tenantId: c.get("tenantId"),
			})
			.sort({ createdAt: -1 })
			.limit(50)
			.lean();
		return c.json(list.reverse());
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

// DELETE /computers/:computerId - terminate a computer pod.
router.delete("/:computerId", async (c) => {
	if (c.get("authType") === "agent") {
		return c.json({ error: "tenant authorization required" }, 403);
	}

	try {
		const col = await agents();
		const computer = await getComputer(c);
		if (!computer) return c.json({ error: "computer not found" }, 404);

		if (computer.pod.namespaceId) {
			try {
				if (computer.pod.provider === "gcp") {
					await terminateAgentPod(computer.pod.namespaceId);
				} else {
					await terminateAgentPodEks(computer.pod.namespaceId);
				}
			} catch {
				// Termination is eventually consistent; don't block DB state.
			}
		}

		await col.updateOne(
			{ _id: computer._id },
			{ $set: { status: "terminated", updatedAt: new Date() } },
		);
		await removeAgentFromWorldState(computer.fleetId, computer._id);
		return c.json({ ok: true });
	} catch {
		return c.json({ error: "database error" }, 503);
	}
});

export { router as computersRouter };
