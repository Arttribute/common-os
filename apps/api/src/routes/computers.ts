import { randomBytes } from "crypto";
import { Hono } from "hono";
import { agents, humanMessages, events } from "../db/mongo.js";
import { enqueueHumanMessage, broadcastToFleet } from "../db/memory.js";
import {
  agentCommonsServiceToken,
  provisionAgent,
  wakeProvisionedComputer,
} from "../services/provisioner.js";
import {
  destroyComputerRuntime,
  inspectAgentPodEks,
  readAgentWorkspaceFile,
  runRuntimeChannelCommand,
  suspendComputerPod,
  WorkspaceReadError,
} from "../services/cloud-init.js";
import {
  resolveComputerResourceSpec,
  type ComputerResourceOverrides,
} from "../services/computer-resources.js";
import {
  ensureCanonicalComputerTenant,
  ensureTenantComputerFleet,
  type CanonicalComputerOwner,
} from "../services/computer-tenancy.js";
import {
  ensureDefaultRuntimeSession,
  ensureRuntimeSessionForAgcSession,
} from "../services/runtimeSessions.js";
import { removeAgentFromWorldState } from "../services/world.js";
import type { AgentDoc, Env, HumanMessageDoc } from "../types.js";
import { publicAgent } from "../utils/public-agent.js";
import { persistedRuntimeConfig } from "../services/runtime-config-safety.js";

const router = new Hono<Env>();
const AGC_URL = (
  process.env.AGC_API_URL ?? "https://api.agentcommons.io"
).replace(/\/$/, "");

type ComputerRequestBody = {
  agentCommonsId?: string;
  computerId?: string;
  name?: string;
  role?: string;
  systemPrompt?: string;
  dockerImage?: string | null;
  image?: string | null;
  integrationPath?: "native" | "openclaw" | "hermes" | "guest";
  nativeConfig?: AgentDoc["config"]["nativeConfig"];
  openclawConfig?: AgentDoc["config"]["openclawConfig"];
  hermesConfig?: AgentDoc["config"]["hermesConfig"];
  resourceProfile?: unknown;
  resourceMode?: "fixed" | "elastic";
  resources?: ComputerResourceOverrides | null;
  idleTtlMinutes?: number;
  policy?: {
    allowBrowser?: boolean;
    allowTerminal?: boolean;
    allowFilesystem?: boolean;
    networkAccess?: "standard" | "restricted" | "disabled";
  };
};

function runtimeRequest(body: ComputerRequestBody) {
  const integrationPath = body.integrationPath ?? "native";
  if (!["native", "openclaw", "hermes", "guest"].includes(integrationPath)) {
    throw new Error(`unsupported runtime: ${integrationPath}`);
  }
  return {
    integrationPath,
    nativeConfig:
      integrationPath === "native" ? body.nativeConfig ?? null : null,
    openclawConfig:
      integrationPath === "openclaw" ? body.openclawConfig ?? null : null,
    hermesConfig:
      integrationPath === "hermes" ? body.hermesConfig ?? null : null,
  };
}

type ComputerPatchBody = {
  desiredState?: "running" | "stopped";
  resourceProfile?: unknown;
  resourceMode?: "fixed" | "elastic";
  resources?: ComputerResourceOverrides | null;
  idleTtlMinutes?: number;
  policy?: ComputerRequestBody["policy"];
};

function rejectAgentPrincipal(c: any) {
  return c.get("authType") === "agent"
    ? c.json({ error: "tenant authorization required" }, 403)
    : null;
}

function serviceBinding(c: any): string | null {
  const value = c.req.header("x-agent-commons-agent-id")?.trim();
  return value || null;
}

async function verifyAgentCommonsOwner(
  c: any,
  agentCommonsId: string
): Promise<{ owner: CanonicalComputerOwner } | { response: Response }> {
  const token = await agentCommonsServiceToken();
  if (!token) {
    return {
      response: c.json(
        { error: "Agent Commons ownership verification is unavailable" },
        503
      ),
    };
  }
  const response = await fetch(
    `${AGC_URL}/v1/agents/${encodeURIComponent(agentCommonsId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    return {
      response: c.json(
        {
          error:
            "Agent Commons agent was not found or is not owned by this account",
        },
        response.status === 404 ? 404 : 403
      ),
    };
  }
  const raw = (await response.json()) as Record<string, unknown>;
  const agent = (raw.data ?? raw) as {
    ownerUserId?: string | null;
    owner?: string | null;
    workspaceId?: string | null;
  };
  const ownerUserId = String(agent.ownerUserId ?? agent.owner ?? "").trim();
  if (!ownerUserId) {
    return {
      response: c.json(
        { error: "Agent Commons agent has no canonical owner" },
        409
      ),
    };
  }
  if (
    c.get("authType") !== "service" &&
    (c.get("userId") !== ownerUserId ||
      (c.get("workspaceId") &&
        agent.workspaceId &&
        c.get("workspaceId") !== agent.workspaceId))
  ) {
    return {
      response: c.json(
        { error: "Agent Commons agent is not owned by this account" },
        403
      ),
    };
  }
  return {
    owner: {
      ownerUserId,
      workspaceId: agent.workspaceId ?? null,
    },
  };
}

async function getBoundComputer(c: any): Promise<AgentDoc | Response> {
  const denied = rejectAgentPrincipal(c);
  if (denied) return denied;
  const id = c.req.param("computerId");
  const binding = serviceBinding(c);
  if (c.get("authType") === "service" && !binding) {
    return c.json({ error: "x-agent-commons-agent-id is required" }, 403);
  }
  const query: Record<string, unknown> = { _id: id, kind: "computer" };
  if (c.get("authType") === "service") query.externalAgentId = binding;
  else query.tenantId = c.get("tenantId");
  let computer = await (await agents()).findOne(query).lean();
  if (!computer && c.get("authType") === "service" && binding) {
    // Rolling migration for runtimes created by the former /computers alias,
    // which stored them as ordinary Agent documents. Exact ID + canonical AGC
    // binding is required, so this cannot widen service access.
    const legacy = await (await agents())
      .findOne({ _id: id, "commons.agentId": binding })
      .lean();
    if (legacy) {
      const resolved = resolveComputerResourceSpec({ profile: "standard" });
      const now = new Date();
      const converted: AgentDoc = {
        ...legacy,
        kind: "computer",
        externalAgentId: binding,
        desiredState:
          legacy.status === "stopped" || legacy.status === "terminated"
            ? "stopped"
            : "running",
        resourceProfile: resolved.profile,
        resourceMode: "elastic",
        resourceSpec: resolved.spec,
        resourceGeneration: 1,
        compute: {
          ownerUserId: legacy.commons.ownerUserId ?? null,
          workspaceId: legacy.commons.workspaceId ?? null,
          namespace: legacy.pod.namespaceId,
          podName: legacy.pod.namespaceId
            ? `agent-${legacy._id.replace(/_/g, "-")}`
            : null,
          pvcName: legacy.pod.provider === "aws" ? "agent-storage" : null,
          volumeRetained: true,
          provisionRequestedAt: legacy.createdAt,
          readyAt: legacy.startedAt ?? null,
          activatedAt: legacy.startedAt ?? legacy.createdAt,
          suspendedAt: legacy.status === "stopped" ? legacy.updatedAt : null,
          restartedAt: null,
          currentActiveStartedAt:
            legacy.status === "stopped"
              ? null
              : legacy.startedAt ?? legacy.createdAt,
          lastActivityAt: legacy.updatedAt,
          idleTtlMinutes: 60,
          policy: {
            allowBrowser: true,
            allowTerminal: true,
            allowFilesystem: true,
            networkAccess: "standard",
          },
          accumulatedActiveMs: 0,
          activeIntervals: [],
        },
        updatedAt: now,
      };
      await (
        await agents()
      ).updateOne(
        { _id: id, "commons.agentId": binding },
        {
          $set: {
            kind: converted.kind,
            externalAgentId: converted.externalAgentId,
            desiredState: converted.desiredState,
            resourceProfile: converted.resourceProfile,
            resourceMode: converted.resourceMode,
            resourceSpec: converted.resourceSpec,
            resourceGeneration: converted.resourceGeneration,
            compute: converted.compute,
            updatedAt: now,
          },
        }
      );
      computer = converted;
    }
  }
  if (!computer) return c.json({ error: "computer not found" }, 404);
  return computer;
}

function isResponse(value: AgentDoc | Response): value is Response {
  return value instanceof Response;
}

function computerResponse(computer: AgentDoc) {
  return publicAgent({
    ...computer,
    pod: {
      ...computer.pod,
      podName: computer.compute?.podName ?? null,
    },
    resources: computer.resourceSpec
      ? {
          profile: computer.resourceProfile,
          mode: computer.resourceMode ?? "elastic",
          cpuRequest: computer.resourceSpec.cpuRequest,
          cpuLimit: computer.resourceSpec.cpuLimit,
          memoryRequest: computer.resourceSpec.memoryRequest,
          memoryLimit: computer.resourceSpec.memoryLimit,
          storageLimit: `${computer.resourceSpec.storageGiB}Gi`,
          gpuType: computer.resourceSpec.gpu.type,
          gpuCount: computer.resourceSpec.gpu.count,
          generation: computer.resourceGeneration ?? 1,
        }
      : null,
    compute: {
      ...computer.compute,
      tenantId: computer.tenantId,
      cellId: `${computer.pod.provider}:${computer.pod.region}`,
      volumeId: computer.compute?.pvcName ?? null,
      generation: computer.resourceGeneration ?? 1,
      startupLatencyMs:
        computer.compute?.readyAt && computer.compute?.provisionRequestedAt
          ? Math.max(
              0,
              new Date(computer.compute.readyAt).getTime() -
                new Date(computer.compute.provisionRequestedAt).getTime()
            )
          : null,
    },
  });
}

function computerNeedsRecovery(computer: AgentDoc, now = Date.now()) {
  if (
    computer.desiredState !== "running" ||
    !["running", "idle", "starting", "provisioning"].includes(computer.status)
  ) {
    return false;
  }
  if (computer.pod.lastError && ["running", "idle"].includes(computer.status)) {
    return true;
  }
  const heartbeatAt = computer.lastHeartbeatAt
    ? new Date(computer.lastHeartbeatAt).getTime()
    : NaN;
  if (
    ["running", "idle"].includes(computer.status) &&
    Number.isFinite(heartbeatAt)
  ) {
    return now - heartbeatAt > 120_000;
  }
  const provisionRequestedAt = computer.compute?.provisionRequestedAt
    ? new Date(computer.compute.provisionRequestedAt).getTime()
    : NaN;
  return (
    ["starting", "provisioning"].includes(computer.status) &&
    Number.isFinite(provisionRequestedAt) &&
    now - provisionRequestedAt > 900_000
  );
}

function closeActiveInterval(computer: AgentDoc, endedAt: Date) {
  const intervals = [...(computer.compute?.activeIntervals ?? [])];
  const last = intervals.at(-1);
  if (last && !last.endedAt) last.endedAt = endedAt;
  const currentStarted = computer.compute?.currentActiveStartedAt;
  const elapsed = currentStarted
    ? Math.max(0, endedAt.getTime() - new Date(currentStarted).getTime())
    : 0;
  return {
    intervals,
    accumulatedActiveMs: (computer.compute?.accumulatedActiveMs ?? 0) + elapsed,
  };
}

async function suspendComputer(computer: AgentDoc) {
  const namespace = computer.compute?.namespace ?? computer.pod.namespaceId;
  const podName = computer.compute?.podName;
  if (namespace && podName) {
    await suspendComputerPod({
      provider: computer.pod.provider,
      region: computer.pod.region,
      namespace,
      podName,
    });
  }
  const now = new Date();
  const meter = closeActiveInterval(computer, now);
  await (
    await agents()
  ).updateOne(
    { _id: computer._id, tenantId: computer.tenantId, kind: "computer" },
    {
      $set: {
        desiredState: "stopped",
        status: "stopped",
        "compute.suspendedAt": now,
        "compute.currentActiveStartedAt": null,
        "compute.accumulatedActiveMs": meter.accumulatedActiveMs,
        "compute.activeIntervals": meter.intervals,
        updatedAt: now,
      },
    }
  );
  return {
    ...computer,
    desiredState: "stopped" as const,
    status: "stopped" as const,
    updatedAt: now,
    compute: computer.compute
      ? {
          ...computer.compute,
          suspendedAt: now,
          currentActiveStartedAt: null,
          accumulatedActiveMs: meter.accumulatedActiveMs,
          activeIntervals: meter.intervals,
        }
      : null,
  };
}

// Idempotently provision or wake the one logical computer for an AGC agent.
router.post("/", async (c) => {
  const denied = rejectAgentPrincipal(c);
  if (denied) return denied;
  const body = await c.req
    .json<ComputerRequestBody>()
    .catch(() => ({} as ComputerRequestBody));
  const agentCommonsId = body.agentCommonsId?.trim();
  if (!agentCommonsId)
    return c.json({ error: "agentCommonsId is required" }, 400);
  if (c.get("authType") === "service" && serviceBinding(c) !== agentCommonsId) {
    return c.json(
      { error: "service binding does not match agentCommonsId" },
      403
    );
  }
  const verified = await verifyAgentCommonsOwner(c, agentCommonsId);
  if ("response" in verified) return verified.response;

  try {
    const runtime = runtimeRequest(body);
    const tenant = await ensureCanonicalComputerTenant(verified.owner);
    const fleet = await ensureTenantComputerFleet({
      tenant,
      owner: verified.owner,
    });
    let existing = await (
      await agents()
    )
      .findOne({
        kind: "computer",
        externalAgentId: agentCommonsId,
      })
      .lean();
    if (existing && existing.tenantId !== tenant._id) {
      await (
        await agents()
      ).updateOne(
        {
          _id: existing._id,
          kind: "computer",
          externalAgentId: agentCommonsId,
        },
        {
          $set: {
            tenantId: tenant._id,
            fleetId: fleet._id,
            "compute.ownerUserId": verified.owner.ownerUserId,
            "compute.workspaceId": verified.owner.workspaceId,
            updatedAt: new Date(),
          },
        }
      );
      existing = {
        ...existing,
        tenantId: tenant._id,
        fleetId: fleet._id,
        compute: existing.compute
          ? {
              ...existing.compute,
              ownerUserId: verified.owner.ownerUserId,
              workspaceId: verified.owner.workspaceId,
            }
          : existing.compute,
      };
    }
    const resources = resolveComputerResourceSpec({
      profile: body.resourceProfile,
      mode: body.resourceMode,
      resources: body.resources,
    });
    if (existing) {
      const persistedRuntime = persistedRuntimeConfig(runtime);
      const requested =
        body.resourceProfile !== undefined || body.resources !== undefined
          ? resolveComputerResourceSpec({
              profile: body.resourceProfile ?? existing.resourceProfile,
              mode: body.resourceMode ?? existing.resourceMode,
              resources: body.resources,
            })
          : {
              profile: existing.resourceProfile ?? resources.profile,
              spec: existing.resourceSpec ?? resources.spec,
            };
      const storageGiB = Math.max(
        existing.resourceSpec?.storageGiB ?? 0,
        requested.spec.storageGiB
      );
      const resourceSpec = { ...requested.spec, storageGiB };
      const runtimeChanged =
        existing.config.integrationPath !== runtime.integrationPath ||
        existing.config.dockerImage !==
          (body.dockerImage ?? body.image ?? existing.config.dockerImage) ||
        JSON.stringify(existing.config.nativeConfig ?? null) !==
          JSON.stringify(persistedRuntime.nativeConfig) ||
        JSON.stringify(existing.config.openclawConfig ?? null) !==
          JSON.stringify(persistedRuntime.openclawConfig) ||
        JSON.stringify(existing.config.hermesConfig ?? null) !==
          JSON.stringify(persistedRuntime.hermesConfig);
      const changed =
        runtimeChanged ||
        JSON.stringify(existing.resourceSpec) !==
          JSON.stringify(resourceSpec) ||
        existing.resourceProfile !== requested.profile ||
        existing.resourceMode !==
          (body.resourceMode ?? existing.resourceMode ?? "elastic");
      const updated: AgentDoc = {
        ...existing,
        config: {
          ...existing.config,
          integrationPath: runtime.integrationPath,
          dockerImage:
            body.dockerImage ?? body.image ?? existing.config.dockerImage,
          ...persistedRuntime,
        },
        resourceProfile: requested.profile,
        resourceMode: body.resourceMode ?? existing.resourceMode ?? "elastic",
        resourceSpec,
        compute: existing.compute
          ? {
              ...existing.compute,
              idleTtlMinutes:
                body.idleTtlMinutes === undefined
                  ? existing.compute.idleTtlMinutes
                  : Math.max(
                      5,
                      Math.min(Number(body.idleTtlMinutes) || 60, 1440)
                    ),
              policy: body.policy
                ? {
                    allowBrowser: body.policy.allowBrowser !== false,
                    allowTerminal: body.policy.allowTerminal !== false,
                    allowFilesystem: body.policy.allowFilesystem !== false,
                    networkAccess: body.policy.networkAccess ?? "standard",
                  }
                : existing.compute.policy,
            }
          : existing.compute,
        // The generation identifies a concrete pod runtime. Resource edits
        // advance it only when wakeProvisionedComputer replaces the pod.
        resourceGeneration: existing.resourceGeneration ?? 1,
        updatedAt: new Date(),
      };
      await (
        await agents()
      ).updateOne(
        { _id: existing._id, tenantId: tenant._id, kind: "computer" },
        {
          $set: {
            "config.integrationPath": updated.config.integrationPath,
            "config.dockerImage": updated.config.dockerImage,
            "config.nativeConfig": updated.config.nativeConfig,
            "config.openclawConfig": updated.config.openclawConfig,
            "config.hermesConfig": updated.config.hermesConfig,
            resourceProfile: updated.resourceProfile,
            resourceMode: updated.resourceMode,
            resourceSpec: updated.resourceSpec,
            resourceGeneration: updated.resourceGeneration,
            "compute.idleTtlMinutes": updated.compute?.idleTtlMinutes,
            "compute.policy": updated.compute?.policy,
            updatedAt: updated.updatedAt,
          },
        }
      );
      const launchConfig: AgentDoc = {
        ...updated,
        config: {
          ...updated.config,
          nativeConfig: runtime.nativeConfig,
          openclawConfig: runtime.openclawConfig,
          hermesConfig: runtime.hermesConfig,
        },
      };
      const unhealthy = computerNeedsRecovery(existing);
      if (
        (changed || unhealthy) &&
        ["running", "idle", "starting", "provisioning"].includes(
          existing.status
        )
      ) {
        await suspendComputer(updated);
        return c.json(
          computerResponse(await wakeProvisionedComputer(launchConfig))
        );
      }
      if (
        existing.desiredState !== "running" ||
        !["running", "idle", "starting", "provisioning"].includes(
          existing.status
        )
      ) {
        if (existing.status !== "stopped") await suspendComputer(updated);
        return c.json(
          computerResponse(await wakeProvisionedComputer(launchConfig))
        );
      }
      return c.json(computerResponse(updated));
    }

    const role = body.role ?? body.name ?? "agent computer";
    const created = await provisionAgent({
      kind: "computer",
      externalAgentId: agentCommonsId,
      fleetId: fleet._id,
      tenantId: tenant._id,
      userId: verified.owner.ownerUserId,
      workspaceId: verified.owner.workspaceId ?? undefined,
      existingCommonsAgentId: agentCommonsId,
      fleet,
      role,
      systemPrompt:
        body.systemPrompt ??
        `You are the persistent CommonOS computer for Agent Commons agent ${agentCommonsId}.`,
      permissionTier: "worker",
      room: "dev-room",
      integrationPath: runtime.integrationPath,
      dockerImage: body.dockerImage ?? body.image ?? null,
      nativeConfig: runtime.nativeConfig,
      openclawConfig: runtime.openclawConfig,
      hermesConfig: runtime.hermesConfig,
      resourceProfile: resources.profile,
      resourceMode: body.resourceMode ?? "elastic",
      resourceSpec: resources.spec,
      idleTtlMinutes: Math.max(
        5,
        Math.min(Number(body.idleTtlMinutes) || 60, 1440)
      ),
      computerPolicy: {
        allowBrowser: body.policy?.allowBrowser !== false,
        allowTerminal: body.policy?.allowTerminal !== false,
        allowFilesystem: body.policy?.allowFilesystem !== false,
        networkAccess: body.policy?.networkAccess ?? "standard",
      },
    });
    return c.json(computerResponse(created), 201);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const raced = await (await agents())
        .findOne({ kind: "computer", externalAgentId: agentCommonsId })
        .lean();
      if (raced) return c.json(computerResponse(raced));
    }
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "computer provisioning failed",
      },
      503
    );
  }
});

router.get("/", async (c) => {
  const denied = rejectAgentPrincipal(c);
  if (denied) return denied;
  const query: Record<string, unknown> = { kind: "computer" };
  if (c.get("authType") === "service") {
    const requested = c.req.query("agentCommonsId")?.trim();
    const binding = serviceBinding(c);
    if (!requested || !binding || requested !== binding) {
      return c.json(
        { error: "agentCommonsId must match x-agent-commons-agent-id" },
        403
      );
    }
    query.externalAgentId = binding;
  } else {
    query.tenantId = c.get("tenantId");
  }
  if (c.req.query("includeTerminated") !== "true") {
    query.status = { $ne: "terminated" };
  }
  const list = await (await agents())
    .find(query)
    .sort({ createdAt: -1 })
    .lean();
  return c.json(list.map(computerResponse));
});

router.get("/:computerId", async (c) => {
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  return c.json(computerResponse(computer));
});

router.get("/:computerId/runtime-status", async (c) => {
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  if (!computer.pod.namespaceId || !computer.compute?.podName) {
    return c.json({ error: "computer pod is not ready" }, 409);
  }
  if (computer.pod.provider !== "aws") {
    return c.json(
      { error: "runtime diagnostics are available for AWS pods" },
      409
    );
  }
  return c.json(
    await inspectAgentPodEks(
      computer.pod.namespaceId,
      computer._id,
      computer.compute.podName,
      computer.compute.pvcName
    )
  );
});

router.post("/:computerId/runtime-channels/:channel/:action", async (c) => {
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  const channel = c.req.param("channel");
  const action = c.req.param("action");
  if (channel !== "whatsapp") {
    return c.json({ error: "unsupported runtime channel" }, 400);
  }
  if (!(["connect", "status", "disconnect"] as const).includes(action as any)) {
    return c.json({ error: "unsupported runtime channel action" }, 400);
  }
  if (computer.config.integrationPath !== "openclaw") {
    return c.json(
      { error: "QR channel setup is currently available for OpenClaw" },
      409
    );
  }
  const namespace = computer.compute?.namespace ?? computer.pod.namespaceId;
  const podName = computer.compute?.podName;
  if (
    !namespace ||
    !podName ||
    !["running", "idle"].includes(computer.status)
  ) {
    return c.json({ error: "runtime must be ready before channel setup" }, 409);
  }
  try {
    return c.json(
      await runRuntimeChannelCommand({
        provider: computer.pod.provider,
        region: computer.pod.region,
        namespace,
        podName,
        runtime: "openclaw",
        channel,
        action: action as "connect" | "status" | "disconnect",
      })
    );
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "channel setup failed",
      },
      503
    );
  }
});

router.get("/:computerId/workspace/read", async (c) => {
  try {
    const computer = await getBoundComputer(c);
    if (isResponse(computer)) return computer;
    if (!computer.pod.namespaceId)
      return c.json({ error: "computer pod is not ready" }, 409);
    const content = await readAgentWorkspaceFile({
      agentId: computer._id,
      namespace: computer.pod.namespaceId,
      provider: computer.pod.provider,
      region: computer.pod.region,
      rootDir: computer.workspace?.rootDir,
      path: c.req.query("path") ?? "",
    });
    return c.json({ content });
  } catch (error) {
    if (error instanceof WorkspaceReadError) {
      return c.json({ error: error.message }, error.status as any);
    }
    return c.json({ error: "could not read workspace file" }, 502);
  }
});

router.post("/:computerId/instructions", async (c) => {
  const body = await c.req
    .json<{ content?: string; sessionId?: string }>()
    .catch(() => ({} as { content?: string; sessionId?: string }));
  if (!body.content) return c.json({ error: "content is required" }, 400);
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  if (
    !["running", "idle", "starting", "provisioning"].includes(computer.status)
  ) {
    return c.json({ error: "computer is not running" }, 409);
  }
  let sessionId = body.sessionId ?? null;
  if (sessionId) {
    const session = await ensureRuntimeSessionForAgcSession(
      computer,
      sessionId,
      {
        title: "Agent Commons computer session",
      }
    );
    sessionId = session._id as string;
  } else {
    sessionId = (await ensureDefaultRuntimeSession(computer))._id;
  }
  const msgId = `hmsg_${Date.now().toString(36)}${randomBytes(4).toString(
    "hex"
  )}`;
  const now = new Date();
  const doc: HumanMessageDoc = {
    _id: msgId,
    agentId: computer._id,
    fleetId: computer.fleetId,
    tenantId: computer.tenantId,
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
  await (
    await agents()
  ).updateOne(
    { _id: computer._id, tenantId: computer.tenantId, kind: "computer" },
    { $set: { "compute.lastActivityAt": now, updatedAt: now } }
  );
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
});

router.get("/:computerId/instructions", async (c) => {
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  const list = await (
    await humanMessages()
  )
    .find({
      agentId: computer._id,
      fleetId: computer.fleetId,
      tenantId: computer.tenantId,
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return c.json(list.reverse());
});

router.get("/:computerId/instructions/:messageId/snapshot", async (c) => {
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  const messageId = c.req.param("messageId");
  const message = await (
    await humanMessages()
  )
    .findOne({
      _id: messageId,
      agentId: computer._id,
      fleetId: computer.fleetId,
      tenantId: computer.tenantId,
    })
    .lean();
  if (!message) return c.json({ error: "instruction not found" }, 404);
  const after = c.req.query("after");
  const afterId = c.req.query("afterId")?.trim();
  const afterDate = after ? new Date(after) : null;
  const eventQuery: Record<string, unknown> = {
    agentId: computer._id,
    fleetId: computer.fleetId,
    tenantId: computer.tenantId,
    type: {
      $in: [
        "runtime.message_status",
        "runtime.message_delta",
        "runtime.tool_call",
        "runtime.tool_result",
      ],
    },
    "payload.msgId": messageId,
  };
  if (afterDate && Number.isFinite(afterDate.getTime())) {
    if (afterId) {
      eventQuery.$or = [
        { createdAt: { $gt: afterDate } },
        { createdAt: afterDate, _id: { $gt: afterId } },
      ];
    } else {
      eventQuery.createdAt = { $gt: afterDate };
    }
  }
  const runtimeEvents = await (await events())
    .find(eventQuery)
    .sort({ createdAt: 1, _id: 1 })
    .limit(500)
    .lean();
  return c.json({ message, events: runtimeEvents });
});

router.get("/:computerId/instructions/:messageId/events", async (c) => {
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  const messageId = c.req.param("messageId");
  const message = await (
    await humanMessages()
  )
    .findOne({
      _id: messageId,
      agentId: computer._id,
      fleetId: computer.fleetId,
      tenantId: computer.tenantId,
    })
    .lean();
  if (!message) return c.json({ error: "instruction not found" }, 404);

  const list = await (
    await events()
  )
    .find({
      agentId: computer._id,
      fleetId: computer.fleetId,
      tenantId: computer.tenantId,
      type: {
        $in: [
          "runtime.message_status",
          "runtime.message_delta",
          "runtime.tool_call",
          "runtime.tool_result",
        ],
      },
      "payload.msgId": messageId,
    })
    .sort({ createdAt: 1, _id: 1 })
    .limit(500)
    .lean();
  return c.json(list);
});

router.patch("/:computerId", async (c) => {
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  const body = await c.req
    .json<ComputerPatchBody>()
    .catch(() => ({} as ComputerPatchBody));

  try {
    if (body.desiredState === "stopped") {
      return c.json(computerResponse(await suspendComputer(computer)));
    }
    let updated = computer;
    let changed = false;
    if (
      body.resourceProfile !== undefined ||
      body.resourceMode !== undefined ||
      body.resources !== undefined
    ) {
      const resolved = resolveComputerResourceSpec({
        profile: body.resourceProfile ?? computer.resourceProfile,
        mode: body.resourceMode ?? computer.resourceMode,
        resources: body.resources,
      });
      resolved.spec.storageGiB = Math.max(
        computer.resourceSpec?.storageGiB ?? 0,
        resolved.spec.storageGiB
      );
      changed =
        JSON.stringify(computer.resourceSpec) !== JSON.stringify(resolved.spec);
      updated = {
        ...computer,
        resourceProfile: resolved.profile,
        resourceMode: body.resourceMode ?? computer.resourceMode ?? "elastic",
        resourceSpec: resolved.spec,
        resourceGeneration: computer.resourceGeneration ?? 1,
        updatedAt: new Date(),
      };
      await (
        await agents()
      ).updateOne(
        { _id: computer._id, tenantId: computer.tenantId, kind: "computer" },
        {
          $set: {
            resourceProfile: updated.resourceProfile,
            resourceMode: updated.resourceMode,
            resourceSpec: updated.resourceSpec,
            resourceGeneration: updated.resourceGeneration,
            updatedAt: updated.updatedAt,
          },
        }
      );
    }
    if (body.idleTtlMinutes !== undefined || body.policy !== undefined) {
      const compute = updated.compute
        ? {
            ...updated.compute,
            idleTtlMinutes:
              body.idleTtlMinutes === undefined
                ? updated.compute.idleTtlMinutes
                : Math.max(
                    5,
                    Math.min(Number(body.idleTtlMinutes) || 60, 1440)
                  ),
            policy: body.policy
              ? {
                  allowBrowser: body.policy.allowBrowser !== false,
                  allowTerminal: body.policy.allowTerminal !== false,
                  allowFilesystem: body.policy.allowFilesystem !== false,
                  networkAccess: body.policy.networkAccess ?? "standard",
                }
              : updated.compute.policy,
          }
        : updated.compute;
      updated = { ...updated, compute, updatedAt: new Date() };
      await (
        await agents()
      ).updateOne(
        { _id: computer._id, tenantId: computer.tenantId, kind: "computer" },
        {
          $set: {
            "compute.idleTtlMinutes": compute?.idleTtlMinutes,
            "compute.policy": compute?.policy,
            updatedAt: updated.updatedAt,
          },
        }
      );
    }
    if (changed && ["running", "idle", "starting"].includes(computer.status)) {
      await suspendComputer(updated);
      return c.json(computerResponse(await wakeProvisionedComputer(updated)));
    }
    if (
      body.desiredState === "running" &&
      (computer.desiredState !== "running" ||
        !["running", "idle", "starting", "provisioning"].includes(
          computer.status
        ))
    ) {
      if (computer.status !== "stopped") await suspendComputer(updated);
      return c.json(computerResponse(await wakeProvisionedComputer(updated)));
    }
    return c.json(computerResponse(updated));
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "computer update failed",
      },
      422
    );
  }
});

router.post("/:computerId/restart", async (c) => {
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  try {
    await suspendComputer(computer);
    const restarted = await wakeProvisionedComputer({
      ...computer,
      status: "stopped",
      desiredState: "stopped",
    });
    await (
      await agents()
    ).updateOne(
      { _id: computer._id, tenantId: computer.tenantId, kind: "computer" },
      { $set: { "compute.restartedAt": new Date() } }
    );
    return c.json(computerResponse(restarted));
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "computer restart failed",
      },
      503
    );
  }
});

router.delete("/:computerId", async (c) => {
  const computer = await getBoundComputer(c);
  if (isResponse(computer)) return computer;
  try {
    const namespace = computer.compute?.namespace ?? computer.pod.namespaceId;
    const podName = computer.compute?.podName;
    if (namespace && podName) {
      await destroyComputerRuntime({
        provider: computer.pod.provider,
        region: computer.pod.region,
        namespace,
        podName,
        // GKE stores a diagnostic gcs:// workspace URI in this field; it is
        // not a Kubernetes claim name and must never be sent to PVC deletion.
        pvcName:
          computer.pod.provider === "aws" ? computer.compute?.pvcName : null,
        workspaceUri:
          computer.pod.provider === "gcp" ? computer.compute?.pvcName : null,
      });
    }
    await (
      await agents()
    ).updateOne(
      { _id: computer._id, tenantId: computer.tenantId, kind: "computer" },
      {
        $set: {
          desiredState: "terminated",
          status: "terminated",
          "compute.volumeRetained": false,
          updatedAt: new Date(),
        },
      }
    );
    await removeAgentFromWorldState(computer.fleetId, computer._id);
    return c.json({ ok: true });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "computer deletion failed",
      },
      503
    );
  }
});

export { router as computersRouter };
