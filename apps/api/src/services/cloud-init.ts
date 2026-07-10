import { ClusterManagerClient } from "@google-cloud/container";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth } from "google-auth-library";
import * as k8s from "@kubernetes/client-node";
import { v4 as uuidv4 } from "uuid";
import { EKSClient, DescribeClusterCommand } from "@aws-sdk/client-eks";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";
import { createHash, createHmac } from "crypto";
import { Writable } from "stream";
import type { ComputerResourceSpec } from "./computer-resources.js";
import {
  computerNamespaceManifests,
  computerRuntimeIdentity,
} from "./computer-kubernetes.js";

export { computerNamespaceManifests, computerRuntimeIdentity };

// ─── Options ───────────────────────────────────────────────────────────────

export interface LaunchOptions {
  agentId: string;
  kind?: "agent" | "computer";
  agentToken: string;
  fleetId: string;
  tenantId: string;
  apiUrl: string;
  role: string;
  systemPrompt: string;
  integrationPath: "native" | "openclaw" | "hermes" | "guest";
  dockerImage: string | null;
  commonsApiKey: string;
  commonsAgentId: string;
  walletAddress?: string;
  openclawConfig?: {
    modelProvider: string | null;
    modelId: string | null;
    modelApiKey: string | null;
    channels: Record<string, Record<string, unknown>> | null;
    plugins: string[] | null;
    dmPolicy: "pairing" | "allowlist" | "open" | "disabled" | null;
  } | null;
  openclawGatewayUrl?: string;
  hermesConfig?: {
    modelProvider: string | null;
    modelId: string | null;
    modelApiKey: string | null;
    gatewayApiKey: string | null;
  } | null;
  hermesGatewayUrl?: string;
  workspaceDir?: string;
  runnerUrl?: string;
  axlPeers?: string;
  worldRoom?: string;
  worldX?: number;
  worldY?: number;
  resourceSpec?: ComputerResourceSpec | null;
  resourceGeneration?: number;
  /** Preserve runtime identity for computers migrated from the legacy API. */
  existingNamespace?: string | null;
  existingPodName?: string | null;
  existingPvcName?: string | null;
}

export interface LaunchedService {
  /** Kubernetes namespace name — stored as namespaceId in agent.pod */
  serviceId: string;
  sessionId: string;
  podName?: string;
  pvcName?: string | null;
}

function k8sLabelValue(value: string): string {
  const raw = value || "unknown";
  const sanitized = raw
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+$/, "");
  if (sanitized && sanitized.length <= 63) return sanitized;

  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 10);
  const prefix = sanitized.slice(0, 52).replace(/[^A-Za-z0-9]+$/, "");
  return prefix ? `${prefix}-${hash}` : `value-${hash}`;
}

function k8sName(prefix: string, value: string): string {
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 10);
  const safe = k8sLabelValue(value).toLowerCase();
  const available = 63 - prefix.length - suffix.length - 2;
  const trimmed = safe
    .slice(0, Math.max(1, available))
    .replace(/[^a-z0-9]+$/, "");
  return `${prefix}-${trimmed || "runtime"}-${suffix}`;
}

function commonK8sLabels(
  opts: Pick<LaunchOptions, "agentId" | "fleetId" | "tenantId" | "kind">
): Record<string, string> {
  return {
    "managed-by": "common-os",
    "agent-id": k8sLabelValue(opts.agentId),
    "fleet-id": k8sLabelValue(opts.fleetId),
    "tenant-id": k8sLabelValue(opts.tenantId),
    "workload-kind": opts.kind === "computer" ? "computer" : "agent",
  };
}

async function createOrIgnoreConflict(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    const code =
      (error as { statusCode?: number; code?: number }).statusCode ??
      (error as { code?: number }).code;
    if (code !== 409) throw error;
  }
}

async function ensureComputerNamespaceHardening(
  kc: k8s.KubeConfig,
  namespace: string,
  labels: Record<string, string>
) {
  const core = kc.makeApiClient(k8s.CoreV1Api);
  const network = kc.makeApiClient(k8s.NetworkingV1Api);
  const manifests = computerNamespaceManifests(namespace, labels);
  await core.patchNamespace({
    name: namespace,
    body: { metadata: { labels: manifests.namespaceLabels } },
  });
  await createOrIgnoreConflict(() =>
    core.createNamespacedResourceQuota({ namespace, body: manifests.quota })
  );
  await createOrIgnoreConflict(() =>
    core.createNamespacedLimitRange({ namespace, body: manifests.limits })
  );
  for (const policy of manifests.policies) {
    await createOrIgnoreConflict(() =>
      network.createNamespacedNetworkPolicy({ namespace, body: policy })
    );
  }
}

function commonRuntimeEnv(
  opts: LaunchOptions,
  imageUrl: string
): k8s.V1EnvVar[] {
  const openclawConfigJson = JSON.stringify(buildOpenClawGatewayConfig(opts));
  const openclawModel = openClawModelId(opts);
  const openclawModelApiKey =
    opts.openclawConfig?.modelApiKey ??
    process.env.OPENCLAW_MODEL_API_KEY ??
    "";
  const providerEnvKey = openClawProviderEnvKey(
    opts.openclawConfig?.modelProvider ??
      process.env.OPENCLAW_MODEL_PROVIDER ??
      "openai"
  );
  const hermesConfigJson = JSON.stringify(buildHermesGatewayConfig(opts));
  const hermesModel = hermesModelId(opts);
  const hermesModelApiKey =
    opts.hermesConfig?.modelApiKey ?? process.env.HERMES_MODEL_API_KEY ?? "";
  const hermesProviderEnvKey = providerEnvKeyFor(
    opts.hermesConfig?.modelProvider ??
      process.env.HERMES_MODEL_PROVIDER ??
      "openai"
  );
  return [
    { name: "AGENT_ID", value: opts.agentId },
    { name: "AGENT_TOKEN", value: opts.agentToken },
    { name: "FLEET_ID", value: opts.fleetId },
    { name: "TENANT_ID", value: opts.tenantId },
    { name: "API_URL", value: opts.apiUrl },
    { name: "ROLE", value: opts.role },
    {
      name: "SYSTEM_PROMPT_B64",
      value: Buffer.from(opts.systemPrompt).toString("base64"),
    },
    { name: "INTEGRATION_PATH", value: opts.integrationPath },
    { name: "COMMONS_API_KEY", value: opts.commonsApiKey },
    { name: "COMMONS_AGENT_ID", value: opts.commonsAgentId },
    { name: "WALLET_ADDRESS", value: opts.walletAddress ?? "" },
    {
      name: "AGENT_WALLET_CHAIN_ID",
      value: process.env.AGENT_WALLET_DEFAULT_CHAIN_ID ?? "84532",
    },
    {
      name: "AGC_INITIATOR",
      value:
        process.env.AGC_INITIATOR ?? process.env.AGENTCOMMONS_INITIATOR ?? "",
    },
    {
      name: "OPENCLAW_GATEWAY_URL",
      value:
        opts.openclawGatewayUrl ??
        process.env.OPENCLAW_GATEWAY_URL ??
        "http://localhost:18789",
    },
    {
      name: "OPENCLAW_MODEL_PROVIDER",
      value:
        opts.openclawConfig?.modelProvider ??
        process.env.OPENCLAW_MODEL_PROVIDER ??
        "openai",
    },
    { name: "OPENCLAW_MODEL_ID", value: openclawModel },
    { name: "OPENCLAW_MODEL_API_KEY", value: openclawModelApiKey },
    ...(opts.integrationPath === "openclaw"
      ? [{ name: providerEnvKey, value: openclawModelApiKey }]
      : []),
    {
      name: "OPENCLAW_CHANNELS_JSON",
      value: JSON.stringify(opts.openclawConfig?.channels ?? {}),
    },
    { name: "OPENCLAW_CONFIG_JSON", value: openclawConfigJson },
    {
      name: "OPENCLAW_PLUGINS",
      value: (opts.openclawConfig?.plugins ?? []).join(","),
    },
    {
      name: "OPENCLAW_DM_POLICY",
      value: opts.openclawConfig?.dmPolicy ?? "pairing",
    },
    {
      name: "HERMES_GATEWAY_URL",
      value:
        opts.hermesGatewayUrl ??
        process.env.HERMES_GATEWAY_URL ??
        "http://localhost:8642",
    },
    {
      name: "HERMES_MODEL_PROVIDER",
      value:
        opts.hermesConfig?.modelProvider ??
        process.env.HERMES_MODEL_PROVIDER ??
        "openai",
    },
    { name: "HERMES_MODEL_ID", value: hermesModel },
    { name: "HERMES_MODEL_API_KEY", value: hermesModelApiKey },
    {
      name: "HERMES_GATEWAY_API_KEY",
      value:
        opts.hermesConfig?.gatewayApiKey ??
        process.env.HERMES_GATEWAY_API_KEY ??
        "",
    },
    ...(opts.integrationPath === "hermes"
      ? [{ name: hermesProviderEnvKey, value: hermesModelApiKey }]
      : []),
    { name: "HERMES_CONFIG_JSON", value: hermesConfigJson },
    { name: "WORKSPACE_DIR", value: opts.workspaceDir ?? "/mnt/shared" },
    { name: "COMMONOS_WORKSPACE", value: opts.workspaceDir ?? "/mnt/shared" },
    { name: "COMMONOS_AGENT_IMAGE", value: imageUrl },
    { name: "AGENT_TOOLS_PORT", value: process.env.AGENT_TOOLS_PORT ?? "4100" },
    {
      name: "AGENT_TOOLS_URL",
      value: `http://127.0.0.1:${process.env.AGENT_TOOLS_PORT ?? "4100"}`,
    },
    {
      name: "COMMONOS_TOOLS_URL",
      value: `http://127.0.0.1:${
        process.env.AGENT_TOOLS_PORT ?? "4100"
      }/v1/tools`,
    },
    { name: "DOCKER_IMAGE", value: opts.dockerImage ?? "" },
    {
      name: "RUNNER_URL",
      value: opts.runnerUrl ?? process.env.RUNNER_URL ?? "",
    },
    { name: "AXL_PEERS", value: opts.axlPeers ?? process.env.AXL_PEERS ?? "" },
    {
      name: "AXL_MODE",
      value:
        opts.kind === "computer" ? "off" : process.env.AXL_MODE ?? "explicit",
    },
    { name: "POD_IP", valueFrom: { fieldRef: { fieldPath: "status.podIP" } } },
    { name: "WORLD_ROOM", value: opts.worldRoom ?? "dev-room" },
    { name: "WORLD_X", value: String(opts.worldX ?? 2) },
    { name: "WORLD_Y", value: String(opts.worldY ?? 2) },
  ];
}

function buildHermesGatewayConfig(
  opts: LaunchOptions
): Record<string, unknown> {
  const config = opts.hermesConfig;
  const provider =
    config?.modelProvider ?? process.env.HERMES_MODEL_PROVIDER ?? "openai";
  const model = hermesModelId(opts);
  const agentRuntimeId = opts.agentId.replace(/[^a-zA-Z0-9_-]/g, "-");

  return {
    // JSON is valid YAML. Credentials remain environment-only; this
    // persistent file holds non-secret model and identity configuration.
    model: { provider, default: model },
    agent: { id: agentRuntimeId, name: opts.role },
  };
}

function hermesModelId(opts: LaunchOptions): string {
  const provider =
    opts.hermesConfig?.modelProvider ??
    process.env.HERMES_MODEL_PROVIDER ??
    "openai";
  return (
    opts.hermesConfig?.modelId ??
    process.env.HERMES_MODEL_ID ??
    (provider === "anthropic"
      ? "anthropic/claude-sonnet-4-6"
      : provider === "openrouter"
      ? "openrouter/openai/gpt-5.4-mini"
      : provider === "google"
      ? "google/gemini-3-flash"
      : provider === "groq"
      ? "groq/openai/gpt-oss-120b"
      : "openai/gpt-5.4-mini")
  );
}

function buildOpenClawGatewayConfig(
  opts: LaunchOptions
): Record<string, unknown> {
  const config = opts.openclawConfig;
  const provider =
    config?.modelProvider ?? process.env.OPENCLAW_MODEL_PROVIDER ?? "openai";
  const model = openClawModelId(opts);
  const agentRuntimeId = opts.agentId.replace(/[^a-zA-Z0-9_-]/g, "-");

  return {
    gateway: {
      mode: "local",
      bind: "loopback",
      port: 18789,
      auth: { mode: "none" },
      http: {
        endpoints: {
          chatCompletions: { enabled: true },
          responses: { enabled: true },
        },
      },
    },
    // OpenClaw reads the provider-specific environment variable injected
    // into the pod; do not copy that secret into persistent config JSON.
    env: { vars: {} },
    channels: config?.channels ?? {},
    agents: {
      defaults: {
        model: { primary: model },
      },
      list: [
        {
          id: agentRuntimeId,
          default: true,
          workspace: "/mnt/shared",
        },
      ],
    },
    messages: {
      groupChat: {
        mentionPatterns: [
          "@openclaw",
          `@${opts.role.replace(/\s+/g, "-").toLowerCase()}`,
        ],
      },
    },
  };
}

function openClawModelId(opts: LaunchOptions): string {
  const provider =
    opts.openclawConfig?.modelProvider ??
    process.env.OPENCLAW_MODEL_PROVIDER ??
    "openai";
  return (
    opts.openclawConfig?.modelId ??
    process.env.OPENCLAW_MODEL_ID ??
    (provider === "anthropic"
      ? "anthropic/claude-opus-4-6"
      : provider === "openrouter"
      ? "openrouter/openai/gpt-5.4-mini"
      : provider === "google"
      ? "google/gemini-3.1-pro"
      : provider === "groq"
      ? "groq/openai/gpt-oss-120b"
      : "openai/gpt-5.4-mini")
  );
}

function openClawProviderEnvKey(provider: string): string {
  return providerEnvKeyFor(provider);
}

function providerEnvKeyFor(provider: string): string {
  const envKeyByProvider: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
  };
  return (
    envKeyByProvider[provider] ??
    `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`
  );
}

function openClawRuntimeContainer(
  opts: LaunchOptions,
  envVars: k8s.V1EnvVar[]
): k8s.V1Container | null {
  if (opts.integrationPath !== "openclaw") return null;
  if (
    process.env.OPENCLAW_GATEWAY_URL &&
    !opts.dockerImage &&
    !process.env.OPENCLAW_IMAGE_URL
  ) {
    return null;
  }

  const image = opts.dockerImage ?? process.env.OPENCLAW_IMAGE_URL;
  if (!image) {
    throw new Error(
      "openclaw integration path requires OPENCLAW_IMAGE_URL, dockerImage, or OPENCLAW_GATEWAY_URL"
    );
  }

  return {
    name: "openclaw-runtime",
    image,
    imagePullPolicy: opts.kind === "computer" ? "IfNotPresent" : "Always",
    command: ["/bin/sh", "-lc"],
    args: [
      `
set -eu
export HOME=/mnt/shared/openclaw
mkdir -p "$HOME/.openclaw" "$HOME/logs"
if [ -n "\${OPENCLAW_CONFIG_JSON:-}" ]; then
  printf '%s' "$OPENCLAW_CONFIG_JSON" > "$HOME/.openclaw/openclaw.json"
fi
if command -v openclaw >/dev/null 2>&1; then
  exec openclaw gateway run --auth none --bind loopback --port "\${OPENCLAW_GATEWAY_PORT:-18789}"
fi
echo "openclaw binary not found in image" >&2
exit 127
`,
    ],
    env: [
      ...envVars,
      { name: "COMMONOS_RUNTIME_ROLE", value: "openclaw" },
      { name: "OPENCLAW_HEADLESS", value: "true" },
      { name: "OPENCLAW_GATEWAY_HOST", value: "0.0.0.0" },
      { name: "OPENCLAW_GATEWAY_PORT", value: "18789" },
      { name: "OPENCLAW_DATA_DIR", value: "/mnt/shared/openclaw" },
      { name: "OPENCLAW_LOG_DIR", value: "/mnt/shared/openclaw/logs" },
      { name: "HOME", value: "/mnt/shared/openclaw" },
    ],
    ports: [{ name: "openclaw", containerPort: 18789 }],
    resources: {
      requests: { cpu: "10m", memory: "256Mi" },
      limits: { cpu: "2", memory: "2Gi" },
    },
    volumeMounts: [
      {
        name: "agent-storage",
        mountPath: "/mnt/shared/openclaw",
        subPath: "openclaw",
      },
    ],
  };
}

function hermesRuntimeContainer(
  opts: LaunchOptions,
  envVars: k8s.V1EnvVar[]
): k8s.V1Container | null {
  if (opts.integrationPath !== "hermes") return null;
  if (
    process.env.HERMES_GATEWAY_URL &&
    !opts.dockerImage &&
    !process.env.HERMES_IMAGE_URL
  ) {
    return null;
  }

  const image = opts.dockerImage ?? process.env.HERMES_IMAGE_URL;
  if (!image) {
    throw new Error(
      "hermes integration path requires HERMES_IMAGE_URL, dockerImage, or HERMES_GATEWAY_URL"
    );
  }

  return {
    name: "hermes-runtime",
    image,
    imagePullPolicy: opts.kind === "computer" ? "IfNotPresent" : "Always",
    command: ["/bin/sh", "-lc"],
    args: [
      `
set -eu
mkdir -p /opt/data/logs
if [ -n "\${HERMES_CONFIG_JSON:-}" ]; then
  printf '%s' "$HERMES_CONFIG_JSON" > /opt/data/config.yaml
fi
if command -v hermes >/dev/null 2>&1; then
  exec hermes gateway run
fi
echo "hermes binary not found in image" >&2
exit 127
`,
    ],
    env: [
      ...envVars,
      { name: "COMMONOS_RUNTIME_ROLE", value: "hermes" },
      { name: "HERMES_HEADLESS", value: "true" },
      { name: "API_SERVER_ENABLED", value: "true" },
      { name: "API_SERVER_HOST", value: "0.0.0.0" },
      { name: "API_SERVER_PORT", value: "8642" },
      {
        name: "API_SERVER_KEY",
        value:
          opts.hermesConfig?.gatewayApiKey ??
          process.env.HERMES_GATEWAY_API_KEY ??
          "",
      },
      { name: "HERMES_HOME", value: "/opt/data" },
    ],
    ports: [{ name: "hermes", containerPort: 8642 }],
    resources: {
      requests: { cpu: "10m", memory: "256Mi" },
      limits: { cpu: "2", memory: "2Gi" },
    },
    volumeMounts: [
      { name: "agent-storage", mountPath: "/opt/data", subPath: "hermes" },
    ],
  };
}

function runtimeStorageInitContainer(
  opts: LaunchOptions
): k8s.V1Container | null {
  if (opts.integrationPath !== "openclaw" && opts.integrationPath !== "hermes")
    return null;
  return {
    name: "runtime-storage-init",
    image: "public.ecr.aws/docker/library/busybox:1.36.1",
    command: ["/bin/sh", "-lc"],
    args: [
      "mkdir -p /mnt/shared/openclaw /mnt/shared/hermes && (chown -R 1000:1000 /mnt/shared/openclaw || true) && (chown -R 10000:10000 /mnt/shared/hermes || true) && chmod 0777 /mnt/shared/openclaw /mnt/shared/hermes",
    ],
    securityContext: {
      runAsUser: 0,
      runAsGroup: 0,
      allowPrivilegeEscalation: false,
    },
    resources: {
      requests: { cpu: "5m", memory: "16Mi" },
      limits: { cpu: "100m", memory: "64Mi" },
    },
    volumeMounts: [{ name: "agent-storage", mountPath: "/mnt/shared" }],
  };
}

function agentContainer(
  opts: LaunchOptions,
  imageUrl: string,
  envVars: k8s.V1EnvVar[]
): k8s.V1Container {
  // Every integration path runs the daemon's shared headless Chromium in
  // this container (browser tool calls are handled here regardless of
  // integrationPath), so it always needs enough memory for Chromium on top
  // of the daemon/AXL process — not just the openclaw/hermes bridge paths.
  const computerResources = opts.kind === "computer" ? opts.resourceSpec : null;
  const requests: Record<string, string> = computerResources
    ? {
        cpu: computerResources.cpuRequest,
        memory: computerResources.memoryRequest,
      }
    : { cpu: "10m", memory: "512Mi" };
  const limits: Record<string, string> = computerResources
    ? {
        cpu: computerResources.cpuLimit,
        memory: computerResources.memoryLimit,
        ...(computerResources.gpu.count > 0
          ? { "nvidia.com/gpu": String(computerResources.gpu.count) }
          : {}),
      }
    : { cpu: "2", memory: "4Gi" };
  return {
    name: "agent",
    image: imageUrl,
    imagePullPolicy: opts.kind === "computer" ? "IfNotPresent" : "Always",
    env: envVars,
    resources: {
      requests,
      limits,
    },
    securityContext:
      opts.kind === "computer"
        ? {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ["ALL"] },
          }
        : undefined,
    ports: [
      {
        name: "agent-tools",
        containerPort: Number(process.env.AGENT_TOOLS_PORT ?? "4100"),
      },
    ],
    volumeMounts: [{ name: "agent-storage", mountPath: "/mnt/shared" }],
  };
}

function guestRuntimeContainer(
  opts: LaunchOptions,
  envVars: k8s.V1EnvVar[]
): k8s.V1Container | null {
  if (opts.integrationPath !== "guest") return null;
  if (!opts.dockerImage) {
    throw new Error("guest integration path requires dockerImage");
  }

  return {
    name: "guest-runtime",
    image: opts.dockerImage,
    imagePullPolicy: opts.kind === "computer" ? "IfNotPresent" : "Always",
    env: [...envVars, { name: "COMMONOS_RUNTIME_ROLE", value: "guest" }],
    resources: {
      requests: { cpu: "10m", memory: "256Mi" },
      limits: { cpu: "2", memory: "2Gi" },
    },
    volumeMounts: [{ name: "agent-storage", mountPath: "/mnt/shared" }],
  };
}

export interface WorkspaceReadOptions {
  agentId: string;
  namespace: string;
  provider: "gcp" | "aws";
  region?: string | null;
  rootDir?: string | null;
  path: string;
  maxBytes?: number;
}

export class WorkspaceReadError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "WorkspaceReadError";
  }
}

// ─── GCS storage bootstrap ────────────────────────────────────────────────

async function ensureAgentStorage(
  projectId: string,
  bucketName: string,
  agentId: string,
  sessionId: string
): Promise<void> {
  const storage = new Storage({ projectId });
  const bucket = storage.bucket(bucketName);

  const [exists] = await bucket.exists();
  if (!exists) {
    await bucket.create({ location: "EU" });
    console.log(`[cloud-init] created bucket ${bucketName}`);
  }

  const placeholder = bucket.file(
    `agents/${agentId}/sessions/${sessionId}/.keep`
  );
  const [fileExists] = await placeholder.exists();
  if (!fileExists) {
    await placeholder.save("CommonOS GCS FUSE agent session placeholder.");
  }
}

// ─── GKE cluster connection ───────────────────────────────────────────────

const GKE_POLL_MS = 5_000;
const GKE_MAX_POLLS = 120;

// Cache kubeconfig per cluster key; GKE access tokens last ~1 hour so we refresh at 55 min
interface KubeConfigCache {
  kc: k8s.KubeConfig;
  expiresAt: number;
}
const kubeConfigCache = new Map<string, KubeConfigCache>();

async function waitForGkeOperation(
  gkeClient: ClusterManagerClient,
  operationName: string
): Promise<void> {
  for (let i = 0; i < GKE_MAX_POLLS; i++) {
    const [op] = await gkeClient.getOperation({ name: operationName });
    if (op.status === 3) {
      if (op.error?.message)
        throw new Error(`GKE operation failed: ${op.error.message}`);
      return;
    }
    await new Promise((r) => setTimeout(r, GKE_POLL_MS));
  }
  throw new Error(`Timed out waiting for GKE operation ${operationName}`);
}

async function ensureNodePoolAutoscaling(
  gkeClient: ClusterManagerClient,
  projectId: string,
  region: string,
  clusterName: string,
  poolName = "default-pool"
): Promise<void> {
  const poolPath = `projects/${projectId}/locations/${region}/clusters/${clusterName}/nodePools/${poolName}`;
  try {
    const [pool] = await gkeClient.getNodePool({ name: poolPath });
    if (pool.autoscaling?.enabled) {
      console.log(
        `[cloud-init] node pool autoscaling already enabled (min=${pool.autoscaling.minNodeCount}, max=${pool.autoscaling.maxNodeCount})`
      );
      return;
    }
    console.log("[cloud-init] enabling node pool autoscaling...");
    const [op] = await gkeClient.setNodePoolAutoscaling({
      name: poolPath,
      autoscaling: { enabled: true, minNodeCount: 1, maxNodeCount: 10 },
    });
    if (op.name) await waitForGkeOperation(gkeClient, op.name);
    console.log("[cloud-init] node pool autoscaling enabled (min=1, max=10)");
  } catch (err) {
    console.warn(
      "[cloud-init] could not configure node pool autoscaling:",
      err instanceof Error ? err.message : err
    );
  }
}

async function getKubeConfig(
  projectId: string,
  region: string,
  clusterName: string
): Promise<k8s.KubeConfig> {
  const cacheKey = `${projectId}/${region}/${clusterName}`;
  const cached = kubeConfigCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.kc;
  }

  const gkeClient = new ClusterManagerClient();
  const parent = `projects/${projectId}/locations/${region}`;

  let endpoint: string;
  let caCert: string | undefined;

  try {
    const [cluster] = await gkeClient.getCluster({
      name: `${parent}/clusters/${clusterName}`,
    });
    endpoint = cluster.endpoint ?? "";
    caCert = cluster.masterAuth?.clusterCaCertificate ?? undefined;
    console.log(
      `[cloud-init] GKE cluster "${clusterName}" found (endpoint: ${endpoint})`
    );
    // Ensure autoscaling is on for the existing cluster's node pool
    await ensureNodePoolAutoscaling(gkeClient, projectId, region, clusterName);
  } catch (err: unknown) {
    const isNotFound =
      err instanceof Error &&
      (err.message.includes("NOT_FOUND") || err.message.includes("not found"));
    if (!isNotFound) throw err;

    // Cluster doesn't exist — create it with autoscaling from the start
    console.log(`[cloud-init] creating GKE cluster "${clusterName}"...`);
    const [operation] = await gkeClient.createCluster({
      parent,
      cluster: {
        name: clusterName,
        // Avoid europe-west1-c which has recurring e2 stockouts
        locations: ["europe-west1-b", "europe-west1-d"],
        nodePools: [
          {
            name: "default-pool",
            initialNodeCount: 1,
            config: {
              machineType: "e2-standard-2",
              oauthScopes: [
                "https://www.googleapis.com/auth/devstorage.read_write",
                "https://www.googleapis.com/auth/logging.write",
                "https://www.googleapis.com/auth/monitoring",
                "https://www.googleapis.com/auth/cloud-platform",
              ],
              workloadMetadataConfig: { mode: "GKE_METADATA" },
            },
            autoscaling: {
              enabled: true,
              minNodeCount: 1,
              maxNodeCount: 10,
            },
            management: {
              autoUpgrade: true,
              autoRepair: true,
            },
          },
        ],
        workloadIdentityConfig: {
          workloadPool: `${projectId}.svc.id.goog`,
        },
        addonsConfig: {
          gcsFuseCsiDriverConfig: { enabled: true },
        },
        masterAuthorizedNetworksConfig: {
          enabled: true,
          cidrBlocks: [{ cidrBlock: "0.0.0.0/0", displayName: "all" }],
        },
      },
    });
    if (operation.name) {
      await waitForGkeOperation(gkeClient, operation.name);
    }
    const [created] = await gkeClient.getCluster({
      name: `${parent}/clusters/${clusterName}`,
    });
    endpoint = created.endpoint ?? "";
    caCert = created.masterAuth?.clusterCaCertificate ?? undefined;
    console.log(
      `[cloud-init] GKE cluster "${clusterName}" created with autoscaling (min=1, max=10)`
    );
  }

  console.log(`[cloud-init] fetching GKE access token...`);
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const accessToken = await auth.getAccessToken();
  console.log(`[cloud-init] GKE access token obtained`);

  const kc = new k8s.KubeConfig();
  kc.loadFromOptions({
    clusters: [
      {
        name: clusterName,
        server: `https://${endpoint}`,
        caData: caCert,
        skipTLSVerify: false,
      },
    ],
    users: [{ name: "gke-user", token: accessToken ?? undefined }],
    contexts: [{ cluster: clusterName, user: "gke-user", name: "gke-context" }],
    currentContext: "gke-context",
  });

  kubeConfigCache.set(cacheKey, { kc, expiresAt: Date.now() + 55 * 60 * 1000 });
  return kc;
}

async function kubeConfigForProvider(
  provider: "gcp" | "aws",
  region?: string | null
): Promise<k8s.KubeConfig> {
  if (provider === "aws") {
    return getEksKubeConfig(
      region ?? process.env.AWS_REGION ?? "us-east-1",
      process.env.EKS_CLUSTER ?? "common-os-agents"
    );
  }
  return getKubeConfig(
    process.env.GCP_PROJECT_ID ?? "common-os-prod",
    region ?? process.env.GCP_REGION ?? "europe-west1",
    process.env.GKE_CLUSTER ?? "common-os-agents"
  );
}

function normalizeWorkspaceReadPath(rawPath: string): string {
  if (!rawPath || rawPath.includes("\0")) {
    throw new WorkspaceReadError("path is required", 400);
  }

  const parts = rawPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0);

  if (parts.some((part) => part === "." || part === "..")) {
    throw new WorkspaceReadError("path escapes workspace", 400);
  }

  return parts.join("/");
}

async function agentPodName(
  kc: k8s.KubeConfig,
  namespace: string,
  agentId: string
): Promise<string> {
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const pods = await coreApi.listNamespacedPod({
    namespace,
    labelSelector: `agent-id=${k8sLabelValue(agentId)}`,
  });
  const pod =
    pods.items.find(
      (item) =>
        item.status?.phase !== "Succeeded" && item.status?.phase !== "Failed"
    ) ?? pods.items[0];
  if (!pod?.metadata?.name) {
    throw new WorkspaceReadError("agent pod not found", 404);
  }
  return pod.metadata.name;
}

export async function readAgentWorkspaceFile(
  opts: WorkspaceReadOptions
): Promise<string> {
  const relPath = normalizeWorkspaceReadPath(opts.path);
  const rootDir = opts.rootDir?.trim() || "/mnt/shared";
  const maxBytes = opts.maxBytes ?? 500_000;
  const kc = await kubeConfigForProvider(opts.provider, opts.region);
  const podName = await agentPodName(kc, opts.namespace, opts.agentId);

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;

  const stdout = new Writable({
    write(chunk: Buffer | string, encoding, callback) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      stdoutBytes += buf.length;
      if (stdoutBytes <= maxBytes + 1024) stdoutChunks.push(buf);
      callback();
    },
  });

  const stderr = new Writable({
    write(chunk: Buffer | string, encoding, callback) {
      stderrChunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
      );
      callback();
    },
  });

  const script = [
    "set -eu",
    'root="$(readlink -f "$1")"',
    'file="$(readlink -f "$1/$2" 2>/dev/null || true)"',
    'if [ -z "$file" ]; then echo "__COMMONOS_NOT_FOUND__" >&2; exit 44; fi',
    'case "$file" in "$root"/*) ;; *) echo "__COMMONOS_ESCAPE__" >&2; exit 47 ;; esac',
    'if [ ! -e "$file" ]; then echo "__COMMONOS_NOT_FOUND__" >&2; exit 44; fi',
    'if [ ! -f "$file" ]; then echo "__COMMONOS_NOT_FILE__" >&2; exit 45; fi',
    `bytes="$(wc -c < "$file" | tr -d ' ')"`,
    `if [ "$bytes" -gt "${maxBytes}" ]; then echo "__COMMONOS_TOO_LARGE__:$bytes" >&2; exit 46; fi`,
    'cat "$file"',
  ].join("\n");

  const exec = new k8s.Exec(kc);
  let settleExec!: (status: unknown) => void;
  let rejectExec!: (err: Error) => void;
  let settled = false;
  const execDone = new Promise<unknown>((resolve, reject) => {
    settleExec = (status) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    rejectExec = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
  });
  const timeout = setTimeout(() => {
    rejectExec(new WorkspaceReadError("workspace read timed out", 504));
  }, 15_000);

  const ws = await exec.exec(
    opts.namespace,
    podName,
    "agent",
    ["/bin/sh", "-c", script, "commonos-read", rootDir, relPath],
    stdout,
    stderr,
    null,
    false,
    (status) => {
      settleExec(status);
    }
  );
  ws.on("error", (err: unknown) => {
    rejectExec(err instanceof Error ? err : new Error(String(err)));
  });
  ws.on("close", () => {
    settleExec(undefined);
  });

  const execStatus = await execDone.finally(() => clearTimeout(timeout));

  const stderrText = Buffer.concat(stderrChunks).toString("utf-8").trim();
  if (stderrText.includes("__COMMONOS_NOT_FOUND__")) {
    throw new WorkspaceReadError("file not found", 404);
  }
  if (stderrText.includes("__COMMONOS_NOT_FILE__")) {
    throw new WorkspaceReadError("path is not a file", 400);
  }
  if (stderrText.includes("__COMMONOS_ESCAPE__")) {
    throw new WorkspaceReadError("path escapes workspace", 400);
  }
  const tooLarge = stderrText.match(/__COMMONOS_TOO_LARGE__:(\d+)/);
  if (tooLarge) {
    throw new WorkspaceReadError(
      `file is too large to preview (${tooLarge[1]} bytes)`,
      413
    );
  }
  if (stdoutBytes > maxBytes + 1024) {
    throw new WorkspaceReadError("file is too large to preview", 413);
  }
  const status = execStatus as
    | { status?: string; message?: string; code?: number }
    | undefined;
  if (status?.status === "Failure" || status?.code) {
    throw new WorkspaceReadError(
      stderrText || status.message || "could not read file",
      502
    );
  }

  return Buffer.concat(stdoutChunks).toString("utf-8");
}

// ─── Retry helpers ────────────────────────────────────────────────────────

async function ensureNamespaceWithRetry(
  projectId: string,
  region: string,
  clusterName: string,
  namespace: string,
  labels: Record<string, string>,
  maxAttempts = 4
): Promise<void> {
  const cacheKey = `${projectId}/${region}/${clusterName}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const kc = await getKubeConfig(projectId, region, clusterName);
      const coreApi = kc.makeApiClient(k8s.CoreV1Api);
      await coreApi.createNamespace({
        body: { metadata: { name: namespace, labels } },
      });
      return;
    } catch (err: unknown) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 409) return; // Already exists — success
      if (attempt === maxAttempts) throw err;
      console.log(
        `[cloud-init] namespace creation attempt ${attempt} failed (${String(
          err
        )}), retrying with fresh client...`
      );
      kubeConfigCache.delete(cacheKey);
    }
  }
}

async function ensurePodWithRetry(
  projectId: string,
  region: string,
  clusterName: string,
  namespace: string,
  podBody: k8s.V1Pod,
  maxAttempts = 4
): Promise<void> {
  const cacheKey = `${projectId}/${region}/${clusterName}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const kc = await getKubeConfig(projectId, region, clusterName);
      const coreApi = kc.makeApiClient(k8s.CoreV1Api);
      await coreApi.createNamespacedPod({ namespace, body: podBody });
      return;
    } catch (err: unknown) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 409) return; // Already exists — success
      if (attempt === maxAttempts) throw err;
      console.log(
        `[cloud-init] pod creation attempt ${attempt} failed (${String(
          err
        )}), retrying with fresh client...`
      );
      kubeConfigCache.delete(cacheKey);
    }
  }
}

// ─── Per-agent GKE pod ────────────────────────────────────────────────────

function defaultGcpAgentImageUrl(_projectId: string, _region: string): string {
  return "ghcr.io/arttribute/common-os/agent:latest";
}

/**
 * Provisions one Kubernetes namespace + pod per agent on the shared GKE cluster.
 * Pod contains:
 *   - agent container: common-os-agent image (entrypoint.sh → bunx common-os-daemon)
 * AXL runs as a background process inside the agent container (started in entrypoint.sh).
 * Storage: GCS FUSE CSI volume when GCP_AGENT_STORAGE_MODE=gcsfuse,
 * otherwise emptyDir for legacy fleet agents. Persistent computers require
 * durable GCS Fuse storage and fail closed when it is unavailable.
 */
export async function launchAgentPod(
  opts: LaunchOptions
): Promise<LaunchedService> {
  const projectId = process.env.GCP_PROJECT_ID ?? "common-os-prod";
  const region = process.env.GCP_REGION ?? "europe-west1";
  const clusterName = process.env.GKE_CLUSTER ?? "common-os-agents";
  const imageUrl =
    process.env.AGENT_IMAGE_URL ?? defaultGcpAgentImageUrl(projectId, region);
  const bucketName =
    process.env.GCS_BUCKET_NAME ?? "agent-session-state-bucket";
  const useGcsFuse =
    process.env.GCP_AGENT_STORAGE_MODE === "gcsfuse" ||
    process.env.GCS_FUSE_ENABLED === "true";
  if (opts.kind === "computer" && !useGcsFuse) {
    throw new Error(
      "Persistent GCS Fuse storage is required for agent computers on GKE"
    );
  }

  const sessionId = uuidv4();
  // Kubernetes names must be RFC 1123: lowercase alphanumeric + '-' only
  const k8sId = opts.agentId.replace(/_/g, "-");
  const computerIdentity = computerRuntimeIdentity(opts.tenantId, opts.agentId);
  const namespace =
    opts.kind === "computer"
      ? opts.existingNamespace ?? computerIdentity.namespace
      : `agent-${k8sId}`;
  const podName =
    opts.kind === "computer"
      ? opts.existingPodName ?? computerIdentity.podName
      : `agent-${k8sId}`;

  console.log(`[cloud-init] getting kubeconfig for ${opts.agentId}...`);
  const kc = await getKubeConfig(projectId, region, clusterName);
  console.log(`[cloud-init] kubeconfig obtained`);

  // Namespace per agent — provides isolation boundary
  console.log(`[cloud-init] creating namespace ${namespace}...`);
  const namespaceLabels =
    opts.kind === "computer"
      ? computerNamespaceManifests(namespace, commonK8sLabels(opts))
          .namespaceLabels
      : commonK8sLabels(opts);
  await ensureNamespaceWithRetry(
    projectId,
    region,
    clusterName,
    namespace,
    namespaceLabels
  );
  if (opts.kind === "computer") {
    await ensureComputerNamespaceHardening(
      kc,
      namespace,
      commonK8sLabels(opts)
    );
  }
  console.log(
    `[cloud-init] namespace ready, creating pod ${podName} with image ${imageUrl}...`
  );

  const envVars = commonRuntimeEnv(opts, imageUrl);

  const volume: k8s.V1Volume = useGcsFuse
    ? {
        name: "agent-storage",
        csi: {
          driver: "gcsfuse.csi.storage.gke.io",
          readOnly: false,
          volumeAttributes: {
            bucketName,
            mountOptions: `implicit-dirs,only-dir=agents/${
              opts.agentId
            }/sessions/${opts.kind === "computer" ? "persistent" : sessionId}`,
          },
        },
      }
    : { name: "agent-storage", emptyDir: {} };

  if (useGcsFuse) {
    await ensureAgentStorage(
      projectId,
      bucketName,
      opts.agentId,
      opts.kind === "computer" ? "persistent" : sessionId
    );
  }

  const openClawContainer = openClawRuntimeContainer(opts, envVars);
  const hermesContainer = hermesRuntimeContainer(opts, envVars);
  const guestContainer = guestRuntimeContainer(opts, envVars);
  const storageInit = runtimeStorageInitContainer(opts);
  const podBody: k8s.V1Pod = {
    metadata: {
      name: podName,
      namespace,
      labels: commonK8sLabels(opts),
      annotations: {
        "common-os/agent-image": imageUrl,
        "common-os/resource-generation": String(opts.resourceGeneration ?? 1),
      },
    },
    spec: {
      restartPolicy: "Always",
      automountServiceAccountToken:
        opts.kind === "computer" ? false : undefined,
      securityContext:
        opts.kind === "computer"
          ? { seccompProfile: { type: "RuntimeDefault" } }
          : undefined,
      runtimeClassName:
        opts.kind === "computer"
          ? opts.resourceSpec?.runtimeClassName ??
            process.env.COMPUTER_RUNTIME_CLASS ??
            undefined
          : undefined,
      initContainers: storageInit ? [storageInit] : undefined,
      containers: [
        agentContainer(opts, imageUrl, envVars),
        ...(openClawContainer ? [openClawContainer] : []),
        ...(hermesContainer ? [hermesContainer] : []),
        ...(guestContainer ? [guestContainer] : []),
      ],
      volumes: [volume],
    },
  };

  await ensurePodWithRetry(projectId, region, clusterName, namespace, podBody);

  console.log(
    `[cloud-init] pod ${podName} created in namespace ${namespace} using image ${imageUrl}${
      openClawContainer ? ` openclaw=${openClawContainer.image}` : ""
    }${hermesContainer ? ` hermes=${hermesContainer.image}` : ""}${
      guestContainer ? ` guest=${opts.dockerImage}` : ""
    }`
  );
  return {
    serviceId: namespace,
    sessionId,
    podName,
    pvcName: useGcsFuse
      ? `gcs://${bucketName}/agents/${opts.agentId}/sessions/persistent`
      : null,
  };
}

/**
 * Deletes the agent's Kubernetes namespace, which cascades to delete the pod
 * and all associated resources.
 */
export async function terminateAgentPod(namespace: string): Promise<void> {
  const projectId = process.env.GCP_PROJECT_ID ?? "common-os-prod";
  const region = process.env.GCP_REGION ?? "europe-west1";
  const clusterName = process.env.GKE_CLUSTER ?? "common-os-agents";

  const kc = await getKubeConfig(projectId, region, clusterName);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);

  try {
    await coreApi.deleteNamespace({ name: namespace });
    console.log(`[cloud-init] namespace ${namespace} deleted`);
  } catch (err) {
    console.warn(`[cloud-init] could not delete namespace ${namespace}:`, err);
  }
}

// ─── EKS — per-agent pod (AWS equivalent of GKE path) ────────────────────

// SHA256 implementation using Node.js crypto — satisfies @smithy/signature-v4 HashConstructor
class NodeSha256 {
  private chunks: Buffer[] = [];
  private secret?: Buffer;

  constructor(secret?: string | Uint8Array) {
    if (secret)
      this.secret =
        typeof secret === "string" ? Buffer.from(secret) : Buffer.from(secret);
  }

  update(data: string | Uint8Array | ArrayBuffer) {
    this.chunks.push(Buffer.from(data as ArrayBuffer));
  }

  async digest(): Promise<Uint8Array> {
    const buf = Buffer.concat(this.chunks);
    const result = this.secret
      ? createHmac("sha256", this.secret).update(buf).digest()
      : createHash("sha256").update(buf).digest();
    return new Uint8Array(result);
  }
}

async function getEksToken(
  region: string,
  clusterName: string
): Promise<string> {
  const credentials = await defaultProvider()();
  const signer = new SignatureV4({
    credentials,
    region,
    service: "sts",
    sha256: NodeSha256 as never,
  });

  const signed = await signer.presign(
    {
      method: "GET",
      protocol: "https:",
      hostname: `sts.${region}.amazonaws.com`,
      path: "/",
      query: { Action: "GetCallerIdentity", Version: "2011-06-15" },
      headers: {
        host: `sts.${region}.amazonaws.com`,
        "x-k8s-aws-id": clusterName,
      },
    },
    { expiresIn: 60 }
  );

  const url = new URL(`https://sts.${region}.amazonaws.com/`);
  for (const [k, v] of Object.entries(signed.query ?? {})) {
    url.searchParams.set(k, Array.isArray(v) ? v[0] : (v as string));
  }

  return "k8s-aws-v1." + Buffer.from(url.toString()).toString("base64url");
}

async function getEksKubeConfig(
  region: string,
  clusterName: string
): Promise<k8s.KubeConfig> {
  const eksClient = new EKSClient({ region });
  const { cluster } = await eksClient.send(
    new DescribeClusterCommand({ name: clusterName })
  );

  if (!cluster?.endpoint || !cluster?.certificateAuthority?.data) {
    throw new Error(
      `EKS cluster "${clusterName}" not found or missing endpoint/CA`
    );
  }

  const token = await getEksToken(region, clusterName);

  const kc = new k8s.KubeConfig();
  kc.loadFromOptions({
    clusters: [
      {
        name: clusterName,
        server: cluster.endpoint,
        caData: cluster.certificateAuthority.data,
        skipTLSVerify: false,
      },
    ],
    users: [{ name: "eks-user", token }],
    contexts: [{ cluster: clusterName, user: "eks-user", name: "eks-context" }],
    currentContext: "eks-context",
  });

  return kc;
}

async function ensureEksEfsStorageClass(
  kc: k8s.KubeConfig,
  configuredName: string,
  fileSystemId: string
): Promise<string> {
  const storageApi = kc.makeApiClient(k8s.StorageV1Api);
  let storageClassName = configuredName;

  try {
    const existing = await storageApi.readStorageClass({
      name: configuredName,
    });
    if (existing.parameters?.fileSystemId === fileSystemId) {
      return configuredName;
    }

    // Preserve an existing class that may still back older claims. New claims
    // use a filesystem-specific class with the correct immutable parameters.
    storageClassName = `${configuredName}-${fileSystemId
      .slice(-8)
      .toLowerCase()}`;
  } catch (err: unknown) {
    const code =
      (err as { statusCode?: number; code?: number })?.statusCode ??
      (err as { code?: number })?.code;
    if (code !== 404) throw err;
  }

  try {
    await storageApi.createStorageClass({
      body: {
        apiVersion: "storage.k8s.io/v1",
        kind: "StorageClass",
        metadata: { name: storageClassName },
        provisioner: "efs.csi.aws.com",
        parameters: {
          provisioningMode: "efs-ap",
          fileSystemId,
          directoryPerms: "700",
          basePath: "/agents",
          ensureUniqueDirectory: "true",
        },
        // Sleeping deletes only the pod; the claim remains. Explicit
        // computer destruction deletes the claim and must release its EFS
        // access point instead of orphaning billable storage.
        reclaimPolicy: "Delete",
        allowVolumeExpansion: true,
        mountOptions: ["tls"],
        volumeBindingMode: "Immediate",
      },
    });
    console.log(
      `[cloud-init] EFS storage class "${storageClassName}" configured`
    );
  } catch (err: unknown) {
    const code =
      (err as { statusCode?: number; code?: number })?.statusCode ??
      (err as { code?: number })?.code;
    if (code !== 409) throw err;
  }

  return storageClassName;
}

/**
 * Provisions one Kubernetes namespace + pod per agent on the shared EKS cluster.
 * Storage: EFS CSI when configured, otherwise emptyDir for legacy fleet
 * agents. Persistent computers fail closed unless EFS is configured.
 */
export async function launchAgentPodEks(
  opts: LaunchOptions
): Promise<LaunchedService> {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const clusterName = process.env.EKS_CLUSTER ?? "common-os-agents";
  const imageUrl =
    process.env.AGENT_IMAGE_URL ?? "ghcr.io/arttribute/common-os/agent:latest";
  const efsId = process.env.EFS_FILE_SYSTEM_ID ?? "";
  if (opts.kind === "computer" && !efsId) {
    throw new Error(
      "Persistent EFS storage is required for agent computers on EKS"
    );
  }
  const efsStorageClass = process.env.EFS_STORAGE_CLASS ?? "common-os-efs";

  const sessionId = uuidv4();
  const k8sId = opts.agentId.replace(/_/g, "-");
  const identity = computerRuntimeIdentity(opts.tenantId, opts.agentId);
  const namespace =
    opts.kind === "computer"
      ? opts.existingNamespace ?? identity.namespace
      : `agent-${k8sId}`;
  const podName =
    opts.kind === "computer"
      ? opts.existingPodName ?? identity.podName
      : `agent-${k8sId}`;
  const pvcName =
    opts.kind === "computer"
      ? opts.existingPvcName ?? identity.pvcName
      : "agent-storage";

  const kc = await getEksKubeConfig(region, clusterName);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const storageClassName = efsId
    ? await ensureEksEfsStorageClass(
        kc,
        opts.kind === "computer"
          ? `${efsStorageClass}-computers-v2`
          : efsStorageClass,
        efsId
      )
    : "";
  const labels = commonK8sLabels(opts);
  const namespaceLabels =
    opts.kind === "computer"
      ? computerNamespaceManifests(namespace, labels).namespaceLabels
      : labels;

  await createOrIgnoreConflict(() =>
    coreApi.createNamespace({
      body: { metadata: { name: namespace, labels: namespaceLabels } },
    })
  );
  if (opts.kind === "computer") {
    await ensureComputerNamespaceHardening(kc, namespace, labels);
  }

  const envVars = commonRuntimeEnv(opts, imageUrl);
  const openClawContainer = openClawRuntimeContainer(opts, envVars);
  const hermesContainer = hermesRuntimeContainer(opts, envVars);
  const guestContainer = guestRuntimeContainer(opts, envVars);
  const storageInit = runtimeStorageInitContainer(opts);

  if (efsId) {
    try {
      await coreApi.createNamespacedPersistentVolumeClaim({
        namespace,
        body: {
          metadata: { name: pvcName, namespace, labels },
          spec: {
            accessModes: ["ReadWriteMany"],
            resources: {
              requests: {
                storage: `${
                  opts.kind === "computer"
                    ? opts.resourceSpec?.storageGiB ?? 10
                    : 5
                }Gi`,
              },
            },
            storageClassName,
          },
        },
      });
    } catch (error) {
      const code = (error as { statusCode?: number }).statusCode;
      if (code !== 409) throw error;
      if (opts.kind === "computer") {
        await coreApi.patchNamespacedPersistentVolumeClaim({
          name: pvcName,
          namespace,
          body: {
            spec: {
              resources: {
                requests: {
                  storage: `${opts.resourceSpec?.storageGiB ?? 10}Gi`,
                },
              },
            },
          },
        });
      }
    }
  }

  const volume: k8s.V1Volume = efsId
    ? {
        name: "agent-storage",
        persistentVolumeClaim: { claimName: pvcName },
      }
    : { name: "agent-storage", emptyDir: {} };

  await createOrIgnoreConflict(() =>
    coreApi.createNamespacedPod({
      namespace,
      body: {
        metadata: {
          name: podName,
          namespace,
          labels,
          annotations: {
            "common-os/agent-image": imageUrl,
            "common-os/resource-generation": String(
              opts.resourceGeneration ?? 1
            ),
          },
        },
        spec: {
          restartPolicy: "Always",
          automountServiceAccountToken:
            opts.kind === "computer" ? false : undefined,
          securityContext:
            opts.kind === "computer"
              ? { seccompProfile: { type: "RuntimeDefault" } }
              : undefined,
          runtimeClassName:
            opts.kind === "computer"
              ? opts.resourceSpec?.runtimeClassName ??
                process.env.COMPUTER_RUNTIME_CLASS ??
                undefined
              : undefined,
          initContainers: storageInit ? [storageInit] : undefined,
          containers: [
            agentContainer(opts, imageUrl, envVars),
            ...(openClawContainer ? [openClawContainer] : []),
            ...(hermesContainer ? [hermesContainer] : []),
            ...(guestContainer ? [guestContainer] : []),
          ],
          volumes: [volume],
        },
      },
    })
  );

  console.log(
    `[cloud-init] EKS pod ${podName} created in namespace ${namespace} using image ${imageUrl}`
  );
  return {
    serviceId: namespace,
    sessionId,
    podName,
    pvcName: efsId ? pvcName : null,
  };
}

export async function terminateAgentPodEks(namespace: string): Promise<void> {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const clusterName = process.env.EKS_CLUSTER ?? "common-os-agents";

  const kc = await getEksKubeConfig(region, clusterName);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);

  try {
    await coreApi.deleteNamespace({ name: namespace });
    console.log(`[cloud-init] EKS namespace ${namespace} deleted`);
  } catch (err) {
    console.warn(
      `[cloud-init] could not delete EKS namespace ${namespace}:`,
      err
    );
  }
}

export async function suspendComputerPod(opts: {
  provider: "gcp" | "aws";
  region?: string | null;
  namespace: string;
  podName: string;
}): Promise<void> {
  const kc = await kubeConfigForProvider(opts.provider, opts.region);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  try {
    await coreApi.deleteNamespacedPod({
      name: opts.podName,
      namespace: opts.namespace,
      gracePeriodSeconds: 20,
    });
  } catch (error) {
    const code =
      (error as { statusCode?: number; code?: number }).statusCode ??
      (error as { code?: number }).code;
    if (code !== 404) throw error;
  }
}

export async function destroyComputerRuntime(opts: {
  provider: "gcp" | "aws";
  region?: string | null;
  namespace: string;
  podName: string;
  pvcName?: string | null;
  workspaceUri?: string | null;
}): Promise<void> {
  await suspendComputerPod(opts);
  if (opts.provider === "gcp" && opts.workspaceUri?.startsWith("gcs://")) {
    const location = opts.workspaceUri.slice("gcs://".length);
    const slash = location.indexOf("/");
    const bucketName = slash < 0 ? location : location.slice(0, slash);
    const prefix =
      slash < 0 ? "" : location.slice(slash + 1).replace(/\/?$/, "/");
    if (!bucketName || !prefix) {
      throw new Error("invalid persistent GCS workspace URI");
    }
    await new Storage().bucket(bucketName).deleteFiles({ prefix });
  }
  if (!opts.pvcName) return;
  const kc = await kubeConfigForProvider(opts.provider, opts.region);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  try {
    await coreApi.deleteNamespacedPersistentVolumeClaim({
      name: opts.pvcName,
      namespace: opts.namespace,
    });
  } catch (error) {
    const code =
      (error as { statusCode?: number; code?: number }).statusCode ??
      (error as { code?: number }).code;
    if (code !== 404) throw error;
  }
}

export async function inspectAgentPodEks(
  namespace: string,
  agentId: string,
  explicitPodName?: string,
  explicitPvcName?: string | null
): Promise<{
  phase: string | null;
  nodeName: string | null;
  podIp: string | null;
  conditions: Array<{
    type: string;
    status: string;
    reason: string | null;
    message: string | null;
  }>;
  containers: Array<{
    name: string;
    ready: boolean;
    restartCount: number;
    state: string;
    reason: string | null;
    message: string | null;
  }>;
  pvc: { phase: string | null; volumeName: string | null } | null;
}> {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const clusterName = process.env.EKS_CLUSTER ?? "common-os-agents";
  const kc = await getEksKubeConfig(region, clusterName);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const podName = explicitPodName ?? `agent-${agentId.replace(/_/g, "-")}`;

  const pod = await coreApi.readNamespacedPod({ namespace, name: podName });
  const containers = (pod.status?.containerStatuses ?? []).map((container) => {
    const waiting = container.state?.waiting;
    const terminated = container.state?.terminated;
    const running = container.state?.running;
    return {
      name: container.name,
      ready: container.ready,
      restartCount: container.restartCount,
      state: waiting
        ? "waiting"
        : terminated
        ? "terminated"
        : running
        ? "running"
        : "unknown",
      reason: waiting?.reason ?? terminated?.reason ?? null,
      message: waiting?.message ?? terminated?.message ?? null,
    };
  });

  let pvc: { phase: string | null; volumeName: string | null } | null = null;
  try {
    const claim = await coreApi.readNamespacedPersistentVolumeClaim({
      namespace,
      name: explicitPvcName ?? "agent-storage",
    });
    pvc = {
      phase: claim.status?.phase ?? null,
      volumeName: claim.spec?.volumeName ?? null,
    };
  } catch (err: unknown) {
    const code =
      (err as { statusCode?: number; code?: number })?.statusCode ??
      (err as { code?: number })?.code;
    if (code !== 404) throw err;
  }

  return {
    phase: pod.status?.phase ?? null,
    nodeName: pod.spec?.nodeName ?? null,
    podIp: pod.status?.podIP ?? null,
    conditions: (pod.status?.conditions ?? []).map((condition) => ({
      type: condition.type,
      status: condition.status,
      reason: condition.reason ?? null,
      message: condition.message ?? null,
    })),
    containers,
    pvc,
  };
}

// ─── AWS EC2 startup script ────────────────────────────────────────────────

export interface StartupScriptOptions {
  agentId: string;
  agentToken: string;
  fleetId: string;
  tenantId: string;
  apiUrl: string;
  role: string;
  systemPrompt: string;
  dockerImage: string | null;
  commonsApiKey: string;
  commonsAgentId: string;
  integrationPath: "native" | "openclaw" | "hermes" | "guest";
  runnerUrl?: string;
}

export function buildStartupScript(opts: StartupScriptOptions): string {
  const image =
    opts.dockerImage ?? "ghcr.io/Arttribute/common-os/agent-runtime:latest";

  return `#!/bin/bash
set -euo pipefail

# ── System deps ─────────────────────────────────────────────
apt-get update -qq
apt-get install -y -qq curl git jq chromium

# ── Node.js 22 ───────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

# ── Agent Commons CLI (agc) ──────────────────────────────────
npm install -g @agent-commons/cli

# ── AXL binary ──────────────────────────────────────────────
curl -fsSL https://install.axl.gensyn.ai | bash - || true
export PATH="$PATH:/usr/local/bin"

# ── CommonOS daemon config ───────────────────────────────────
mkdir -p /etc/common-os
cat > /etc/common-os/config.json << 'CONFIGEOF'
{
  "agentId":           "${opts.agentId}",
  "agentToken":        "${opts.agentToken}",
  "apiUrl":            "${opts.apiUrl}",
  "fleetId":           "${opts.fleetId}",
  "tenantId":          "${opts.tenantId}",
  "commonsApiKey":     "${opts.commonsApiKey}",
  "commonsAgentId":    "${opts.commonsAgentId}",
  "integrationPath":   "${opts.integrationPath}",
  "dockerImage":       ${opts.dockerImage ? `"${opts.dockerImage}"` : "null"},
  "role":              "${opts.role}",
  "runnerUrl":         "${opts.runnerUrl ?? ""}",
  "workspaceDir":      "/mnt/shared",
  "openclawGatewayUrl":"http://localhost:18789",
  "hermesGatewayUrl":  "http://localhost:17890",
  "worldRoom":         "dev-room",
  "worldX":            2,
  "worldY":            2
}
CONFIGEOF

# ── systemd: CommonOS daemon ─────────────────────────────────
cat > /etc/systemd/system/common-os-daemon.service << 'SVCEOF'
[Unit]
Description=CommonOS Fleet Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/npx common-os-daemon
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable common-os-daemon
systemctl start common-os-daemon

${
  opts.integrationPath === "native"
    ? `
if [ -n "${opts.commonsApiKey}" ]; then
  agc start --api-key "${opts.commonsApiKey}" --agent-id "${opts.commonsAgentId}" &
fi
`
    : `
if command -v docker &>/dev/null || (curl -fsSL https://get.docker.com | sh); then
  docker pull ${image}
  docker run -d \\
    --name common-os-agent \\
    --restart unless-stopped \\
    -e AGENT_ID="${opts.agentId}" \\
    -e AGENT_TOKEN="${opts.agentToken}" \\
    -e API_URL="${opts.apiUrl}" \\
    -e AGENT_ROLE="${opts.role}" \\
    -e COMMONS_API_KEY="${opts.commonsApiKey}" \\
    ${image}
fi
`
}`;
}
