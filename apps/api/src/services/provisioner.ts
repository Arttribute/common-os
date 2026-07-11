import { createHash, randomBytes } from "crypto";
import { agents, fleets, worldStates } from "../db/mongo.js";
import type { AgentDoc, FleetDoc } from "../types.js";
import type {
  ComputerResourceProfile,
  ComputerResourceSpec,
} from "./computer-resources.js";
import { launchAgentPod, launchAgentPodEks } from "./cloud-init.js";
import { ensureAgentWallet } from "./agentWallet.js";
import { persistedRuntimeConfig } from "./runtime-config-safety.js";

const AGC_BASE_URL = (
  process.env.AGC_API_URL ?? "https://api.agentcommons.io"
).replace(/\/$/, "");
const DEFAULT_API_URL =
  "https://co-34acbf16a9a0464c8be79137d4f7bbd6.ecs.eu-west-1.on.aws";
let cachedAgentCommonsServiceToken:
  | { value: string; expiresAt: number }
  | undefined;

export async function agentCommonsServiceToken(): Promise<string | null> {
  if (
    cachedAgentCommonsServiceToken &&
    cachedAgentCommonsServiceToken.expiresAt > Date.now() + 30_000
  ) {
    return cachedAgentCommonsServiceToken.value;
  }
  const issuer = process.env.COMMONS_IDENTITY_ISSUER;
  const clientId = process.env.AGENTCOMMONS_SERVICE_CLIENT_ID;
  const clientSecret = process.env.AGENTCOMMONS_SERVICE_CLIENT_SECRET;
  if (issuer && clientId && clientSecret) {
    const response = await fetch(`${issuer.replace(/\/$/, "")}/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "agents:create agents:read agents:run activity:read",
        resource: "commons-platform",
      }),
    });
    if (!response.ok)
      throw new Error("Could not obtain Agent Commons service token");
    const token = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    cachedAgentCommonsServiceToken = {
      value: token.access_token,
      expiresAt: Date.now() + (token.expires_in ?? 600) * 1000,
    };
    return token.access_token;
  }
  return (
    process.env.AGENTCOMMONS_SERVICE_TOKEN ??
    process.env.AGENTCOMMONS_API_KEY ??
    null
  );
}

export interface ProvisionAgentOptions {
  kind?: "agent" | "computer";
  externalAgentId?: string | null;
  fleetId: string;
  tenantId: string;
  userId?: string;
  workspaceId?: string;
  existingCommonsAgentId?: string;
  fleet: FleetDoc;
  role: string;
  systemPrompt: string;
  permissionTier: "manager" | "worker";
  room: string;
  integrationPath: "native" | "openclaw" | "hermes" | "guest";
  dockerImage: string | null;
  nativeConfig: AgentDoc["config"]["nativeConfig"];
  openclawConfig: AgentDoc["config"]["openclawConfig"];
  hermesConfig: AgentDoc["config"]["hermesConfig"];
  resourceProfile?: ComputerResourceProfile | null;
  resourceMode?: "fixed" | "elastic" | null;
  resourceSpec?: ComputerResourceSpec | null;
  idleTtlMinutes?: number | null;
  computerPolicy?: {
    allowBrowser: boolean;
    allowTerminal: boolean;
    allowFilesystem: boolean;
    networkAccess: "standard" | "restricted" | "disabled";
  };
}

export async function provisionAgent(
  opts: ProvisionAgentOptions
): Promise<AgentDoc & { agentToken: string }> {
  if (
    opts.integrationPath === "openclaw" &&
    !opts.dockerImage &&
    !process.env.OPENCLAW_IMAGE_URL &&
    !process.env.OPENCLAW_GATEWAY_URL
  ) {
    throw new Error(
      "OpenClaw deploys require OPENCLAW_IMAGE_URL, OPENCLAW_GATEWAY_URL, or a dockerImage override"
    );
  }
  if (
    opts.integrationPath === "hermes" &&
    !opts.dockerImage &&
    !process.env.HERMES_IMAGE_URL &&
    !process.env.HERMES_GATEWAY_URL
  ) {
    throw new Error(
      "Hermes deploys require HERMES_IMAGE_URL, HERMES_GATEWAY_URL, or a dockerImage override"
    );
  }

  const agentId = `agt_${Date.now().toString(36)}${randomBytes(4).toString(
    "hex"
  )}`;
  const agentToken = `cos_agent_${randomBytes(24).toString("hex")}`;
  const agentTokenHash = createHash("sha256").update(agentToken).digest("hex");
  const now = new Date();

  const roomDef = opts.fleet.worldConfig.rooms.find((r) => r.id === opts.room);
  const startX = roomDef ? roomDef.bounds.x + 2 : 2;
  const startY = roomDef ? roomDef.bounds.y + 2 : 2;

  const provider = process.env.CLOUD_PROVIDER === "gcp" ? "gcp" : "aws";
  const region =
    provider === "gcp"
      ? process.env.GCP_REGION ?? process.env.CLOUD_REGION ?? "europe-west1"
      : process.env.AWS_REGION ?? process.env.CLOUD_REGION ?? "eu-west-1";

  const commons = opts.existingCommonsAgentId
    ? {
        agentId: opts.existingCommonsAgentId,
        ownerUserId: opts.userId ?? null,
        workspaceId: opts.workspaceId ?? null,
        apiKey: null,
        walletAddress: null,
        registryAgentId: opts.existingCommonsAgentId,
      }
    : opts.integrationPath === "openclaw" || opts.integrationPath === "hermes"
    ? {
        agentId: null,
        apiKey: null,
        walletAddress: null,
        registryAgentId: null,
      }
    : await registerWithAgentCommons(
        agentId,
        opts.role,
        opts.systemPrompt,
        opts.nativeConfig,
        { userId: opts.userId, workspaceId: opts.workspaceId }
      );

  if (opts.integrationPath === "native" && !commons.agentId) {
    console.warn(
      "[provisioner] Agent Commons registration returned no agentId; native agent will run without AGC identity"
    );
  }

  const agentDoc: AgentDoc = {
    _id: agentId,
    kind: opts.kind ?? "agent",
    externalAgentId: opts.externalAgentId ?? null,
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
    desiredState: "running",
    resourceProfile: opts.resourceProfile ?? null,
    resourceMode: opts.resourceMode ?? null,
    resourceSpec: opts.resourceSpec ?? null,
    resourceGeneration: 1,
    compute:
      opts.kind === "computer"
        ? {
            ownerUserId: opts.userId ?? null,
            workspaceId: opts.workspaceId ?? null,
            namespace: null,
            podName: null,
            pvcName: null,
            volumeRetained: true,
            provisionRequestedAt: now,
            readyAt: null,
            activatedAt: now,
            suspendedAt: null,
            restartedAt: null,
            currentActiveStartedAt: now,
            lastActivityAt: now,
            idleTtlMinutes: opts.idleTtlMinutes ?? 60,
            policy: opts.computerPolicy ?? {
              allowBrowser: true,
              allowTerminal: true,
              allowFilesystem: true,
              networkAccess: "standard",
            },
            accumulatedActiveMs: 0,
            activeIntervals: [{ startedAt: now, endedAt: null }],
          }
        : null,
    permissionTier: opts.permissionTier,
    config: {
      role: opts.role,
      systemPrompt: opts.systemPrompt,
      integrationPath: opts.integrationPath,
      dockerImage: opts.dockerImage,
      // Credentials are injected into the initial pod from `opts` below and
      // deliberately not persisted in Mongo. Subsequent Agent Commons wake
      // requests supply fresh credentials; platform defaults remain the
      // fallback for direct CommonOS callers.
      ...persistedRuntimeConfig(opts),
      tools: [],
    },
    world: { room: opts.room, x: startX, y: startY, facing: "south" },
    axl: { peerId: null, multiaddr: null },
    lastHeartbeatAt: null,
    runtime: null,
    startedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await (await agents()).create(agentDoc as never);
  if (opts.kind !== "computer") {
    const wallet = await ensureAgentWallet(agentDoc);
    agentDoc.commons.walletAddress = wallet.address;
    agentDoc.wallet = {
      address: wallet.address,
      provider: wallet.provider,
      signerRef: wallet.signerRef,
      chainIds: wallet.chainIds,
      policy: {
        dailyLimitWei:
          process.env.AGENT_WALLET_DAILY_LIMIT_WEI ?? "100000000000000000",
        requireApprovalAboveWei:
          process.env.AGENT_WALLET_APPROVAL_ABOVE_WEI ?? "10000000000000000",
        allowedContracts: [],
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  await (
    await fleets()
  ).updateOne(
    { _id: opts.fleetId },
    { $inc: { agentCount: 1 } as never, $set: { updatedAt: now } }
  );

  await (
    await worldStates()
  ).updateOne(
    { fleetId: opts.fleetId },
    {
      $push: {
        agents: {
          agentId,
          role: opts.role,
          permissionTier: opts.permissionTier,
          status: "provisioning",
          commons: {
            agentId: commons.agentId,
            walletAddress: commons.walletAddress,
            registryAgentId: commons.registryAgentId ?? null,
          },
          world: agentDoc.world,
        } as never,
      },
      $set: { updatedAt: now },
    }
  );

  void launchCloudInstance(agentDoc, opts, agentToken, commons.apiKey);

  return { ...agentDoc, agentToken };
}

export async function registerWithAgentCommons(
  agentId: string,
  role: string,
  systemPrompt: string,
  nativeConfig?: AgentDoc["config"]["nativeConfig"],
  owner?: { userId?: string; workspaceId?: string }
): Promise<AgentDoc["commons"]> {
  const platformKey = await agentCommonsServiceToken();
  if (!platformKey) {
    return {
      agentId: null,
      apiKey: null,
      walletAddress: null,
      registryAgentId: null,
    };
  }

  const headers = {
    Authorization: `Bearer ${platformKey}`,
    "x-api-key": platformKey,
    ...(process.env.AGC_INITIATOR ?? process.env.AGENTCOMMONS_INITIATOR
      ? {
          "x-initiator":
            process.env.AGC_INITIATOR ?? process.env.AGENTCOMMONS_INITIATOR,
        }
      : {}),
    "Content-Type": "application/json",
  };

  try {
    const agentRes = await fetch(`${AGC_BASE_URL}/v1/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: `${role}-${agentId}`,
        instructions: systemPrompt,
        ...(owner?.userId ? { ownerUserId: owner.userId } : {}),
        ...(owner?.workspaceId ? { workspaceId: owner.workspaceId } : {}),
        modelProvider:
          nativeConfig?.modelProvider ??
          process.env.AGENTCOMMONS_MODEL_PROVIDER ??
          "openai",
        modelId:
          nativeConfig?.modelId ??
          process.env.AGENTCOMMONS_MODEL_ID ??
          "gpt-5.4-mini",
        ...(nativeConfig?.modelApiKey
          ? { modelApiKey: nativeConfig.modelApiKey }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!agentRes.ok) {
      const body = await agentRes.text().catch(() => "");
      console.error(
        `[provisioner] Agent Commons create agent failed: ${agentRes.status} ${body}`
      );
      return {
        agentId: null,
        apiKey: null,
        walletAddress: null,
        registryAgentId: null,
      };
    }

    const rawAgentData = (await agentRes.json()) as Record<string, unknown>;
    const agentData = (rawAgentData.data ?? rawAgentData) as {
      agentId?: string;
      id?: string;
    };
    const registryAgentId = agentData.agentId ?? agentData.id ?? null;
    console.log(
      `[provisioner] Agent Commons agent created: ${registryAgentId}`
    );
    if (!registryAgentId)
      return {
        agentId: null,
        apiKey: null,
        walletAddress: null,
        registryAgentId: null,
      };

    // The registryAgentId (UUID from POST /v1/agents) is the runtime identity used
    // in all AGC API calls. Wallet routes are not yet available.
    return {
      agentId: registryAgentId,
      ownerUserId: owner?.userId ?? null,
      workspaceId: owner?.workspaceId ?? null,
      apiKey: null, // platform key injected at runtime by bootstrap; never stored in DB
      walletAddress: null,
      registryAgentId,
    };
  } catch (err) {
    console.error("[provisioner] Agent Commons registration error:", err);
    return {
      agentId: null,
      apiKey: null,
      walletAddress: null,
      registryAgentId: null,
    };
  }
}

export async function launchCloudInstance(
  agentDoc: AgentDoc,
  opts: ProvisionAgentOptions,
  agentToken: string,
  commonsApiKey: string | null
): Promise<void> {
  const runtimeCommonsApiKey =
    commonsApiKey ??
    (agentDoc.commons.agentId ? await agentCommonsServiceToken() : null);
  const apiUrl = process.env.API_URL ?? DEFAULT_API_URL;
  const axlPeers = await fleetAxlPeers(
    agentDoc.fleetId,
    agentDoc._id,
    agentDoc.tenantId
  );

  const podOpts = {
    agentId: agentDoc._id,
    kind: agentDoc.kind,
    agentToken,
    fleetId: agentDoc.fleetId,
    tenantId: agentDoc.tenantId,
    apiUrl,
    role: opts.role,
    systemPrompt: opts.systemPrompt,
    integrationPath: opts.integrationPath,
    dockerImage: opts.dockerImage,
    commonsApiKey: runtimeCommonsApiKey ?? "",
    commonsAgentId: agentDoc.commons.agentId ?? "",
    walletAddress:
      agentDoc.wallet?.address ?? agentDoc.commons.walletAddress ?? "",
    openclawConfig: opts.openclawConfig,
    openclawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL,
    hermesConfig: opts.hermesConfig,
    hermesGatewayUrl: process.env.HERMES_GATEWAY_URL,
    runnerUrl: process.env.RUNNER_URL,
    axlPeers,
    worldRoom: agentDoc.world.room,
    worldX: agentDoc.world.x,
    worldY: agentDoc.world.y,
    resourceSpec: agentDoc.resourceSpec ?? null,
    resourceGeneration: agentDoc.resourceGeneration ?? 1,
    existingNamespace:
      agentDoc.kind === "computer"
        ? agentDoc.compute?.namespace ?? agentDoc.pod.namespaceId
        : null,
    existingPodName:
      agentDoc.kind === "computer" ? agentDoc.compute?.podName : null,
    existingPvcName:
      agentDoc.kind === "computer" && agentDoc.pod.provider === "aws"
        ? agentDoc.compute?.pvcName
        : null,
  };

  const deadline = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("pod launch timed out after 15m")),
      15 * 60 * 1000
    )
  );

  try {
    const launch =
      agentDoc.pod.provider === "gcp"
        ? launchAgentPod(podOpts)
        : launchAgentPodEks(podOpts);

    const result = await Promise.race([launch, deadline]);

    await (
      await agents()
    ).updateOne(
      { _id: agentDoc._id },
      {
        $set: {
          "pod.namespaceId": result.serviceId,
          "pod.lastError": null,
          ...(agentDoc.kind === "computer"
            ? {
                "compute.namespace": result.serviceId,
                "compute.podName": result.podName ?? null,
                "compute.pvcName": result.pvcName ?? null,
              }
            : {}),
          status: "starting",
          updatedAt: new Date(),
        },
      }
    );
  } catch (err) {
    console.error(
      `[provisioner] cloud launch failed for ${agentDoc._id}:`,
      err
    );
    const now = new Date();
    const errorMessage = err instanceof Error ? err.message : String(err);
    const current =
      agentDoc.kind === "computer"
        ? await (await agents())
            .findOne({ _id: agentDoc._id, kind: "computer" })
            .lean()
        : null;
    const intervals = [...(current?.compute?.activeIntervals ?? [])];
    const activeInterval = intervals.at(-1);
    if (activeInterval && !activeInterval.endedAt) activeInterval.endedAt = now;
    const activeStartedAt = current?.compute?.currentActiveStartedAt;
    const elapsed = activeStartedAt
      ? Math.max(0, now.getTime() - new Date(activeStartedAt).getTime())
      : 0;
    await (
      await agents()
    ).updateOne(
      { _id: agentDoc._id },
      {
        $set: {
          status: "failed",
          ...(agentDoc.kind === "computer"
            ? {
                desiredState: "stopped",
                "compute.suspendedAt": now,
                "compute.currentActiveStartedAt": null,
                "compute.accumulatedActiveMs":
                  (current?.compute?.accumulatedActiveMs ?? 0) + elapsed,
                "compute.activeIntervals": intervals,
              }
            : {}),
          "pod.lastError": errorMessage,
          updatedAt: now,
        },
      }
    );
    await (
      await worldStates()
    ).updateOne(
      { fleetId: agentDoc.fleetId, "agents.agentId": agentDoc._id },
      {
        $set: {
          "agents.$.status": "failed",
          updatedAt: now,
        },
      }
    );
  }
}

/**
 * Rotate the pod credential and launch a new runtime generation for an
 * existing logical computer. The stable Mongo identity and workspace claim are
 * reused; only the replaceable pod changes.
 */
export async function wakeProvisionedComputer(
  agent: AgentDoc
): Promise<AgentDoc> {
  if (agent.kind !== "computer") throw new Error("computer runtime required");
  const fleet = await (await fleets())
    .findOne({ _id: agent.fleetId, tenantId: agent.tenantId })
    .lean();
  if (!fleet) throw new Error("computer placement fleet not found");

  const agentToken = `cos_agent_${randomBytes(24).toString("hex")}`;
  const agentTokenHash = createHash("sha256").update(agentToken).digest("hex");
  const now = new Date();
  const nextGeneration = (agent.resourceGeneration ?? 1) + 1;
  await (
    await agents()
  ).updateOne(
    { _id: agent._id, tenantId: agent.tenantId, kind: "computer" },
    {
      $set: {
        agentTokenHash,
        desiredState: "running",
        status: "provisioning",
        resourceGeneration: nextGeneration,
        "pod.lastError": null,
        "compute.activatedAt": agent.compute?.activatedAt ?? now,
        "compute.provisionRequestedAt": now,
        "compute.readyAt": null,
        "compute.suspendedAt": null,
        "compute.currentActiveStartedAt": now,
        updatedAt: now,
      },
      $push: {
        "compute.activeIntervals": { startedAt: now, endedAt: null },
      },
    }
  );

  const refreshed: AgentDoc = {
    ...agent,
    agentTokenHash,
    desiredState: "running",
    status: "provisioning",
    resourceGeneration: nextGeneration,
    pod: {
      ...agent.pod,
      lastError: null,
    },
    updatedAt: now,
  };
  const opts: ProvisionAgentOptions = {
    kind: "computer",
    externalAgentId: agent.externalAgentId,
    fleetId: agent.fleetId,
    tenantId: agent.tenantId,
    userId: agent.compute?.ownerUserId ?? undefined,
    workspaceId: agent.compute?.workspaceId ?? undefined,
    existingCommonsAgentId: agent.commons.agentId ?? undefined,
    fleet,
    role: agent.config.role,
    systemPrompt: agent.config.systemPrompt,
    permissionTier: agent.permissionTier,
    room: agent.world.room,
    integrationPath: agent.config.integrationPath,
    dockerImage: agent.config.dockerImage,
    nativeConfig: agent.config.nativeConfig,
    openclawConfig: agent.config.openclawConfig,
    hermesConfig: agent.config.hermesConfig,
    resourceProfile: agent.resourceProfile,
    resourceMode: agent.resourceMode,
    resourceSpec: agent.resourceSpec,
    idleTtlMinutes: agent.compute?.idleTtlMinutes,
    computerPolicy: agent.compute?.policy ?? undefined,
  };
  void launchCloudInstance(refreshed, opts, agentToken, null);
  return refreshed;
}

async function fleetAxlPeers(
  fleetId: string,
  agentId: string,
  tenantId: string
): Promise<string> {
  const configuredPeers = (process.env.AXL_PEERS ?? "")
    .split(",")
    .map((peer) => peer.trim())
    .filter(Boolean);

  const existingAgents = await (
    await agents()
  )
    .find(
      {
        fleetId,
        tenantId,
        _id: { $ne: agentId },
        "axl.multiaddr": { $nin: [null, ""] },
        status: { $ne: "terminated" },
      },
      { axl: 1 }
    )
    .lean();

  const fleetPeers = existingAgents
    .map((agent) => agent.axl?.multiaddr)
    .filter((peer): peer is string =>
      Boolean(peer && peer.startsWith("tls://"))
    );

  return Array.from(new Set([...configuredPeers, ...fleetPeers])).join(",");
}
