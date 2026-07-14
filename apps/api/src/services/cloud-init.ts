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
import { qualifiedOpenClawModelId } from "./runtime-models.js";
import { kubernetesStatusCode } from "./kubernetes-errors.js";
import {
  buildHermesGatewayConfig,
  hermesChannelEnvironment,
  hermesModelId,
} from "./hermes-config.js";
import { createKubernetesPodIdempotently } from "./kubernetes-pods.js";

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
    toolsets?: string[] | null;
    channels?: Record<string, Record<string, unknown>> | null;
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
    const code = kubernetesStatusCode(error);
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
  const currentNamespace = await core.readNamespace({ name: namespace });
  await core.patchNamespace({
    name: namespace,
    // @kubernetes/client-node 1.x selects JSON Patch as the preferred media
    // type. Supplying a merge-patch object is therefore rejected by the API
    // server. Preserve any platform labels and send an explicit JSON Patch.
    body: [
      {
        op: "add",
        path: "/metadata/labels",
        value: {
          ...(currentNamespace.metadata?.labels ?? {}),
          ...manifests.namespaceLabels,
        },
      },
    ],
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

export function commonRuntimeEnv(
  opts: LaunchOptions,
  imageUrl: string
): k8s.V1EnvVar[] {
  const runtimeSpecificEnv =
    opts.integrationPath === "openclaw"
      ? openClawRuntimeEnv(opts)
      : opts.integrationPath === "hermes"
      ? hermesRuntimeEnv(opts)
      : [];
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
    ...runtimeSpecificEnv,
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

function openClawRuntimeEnv(opts: LaunchOptions): k8s.V1EnvVar[] {
  const configJson = JSON.stringify(buildOpenClawGatewayConfig(opts));
  const openclawModel = openClawModelId(opts);
  const provider =
    opts.openclawConfig?.modelProvider ??
    process.env.OPENCLAW_MODEL_PROVIDER ??
    "openai";
  const platformProvider = process.env.OPENCLAW_MODEL_PROVIDER ?? "openai";
  const openclawModelApiKey =
    opts.openclawConfig?.modelApiKey ??
    (provider === platformProvider
      ? process.env.OPENCLAW_MODEL_API_KEY
      : undefined) ??
    "";
  const providerEnvKey = openClawProviderEnvKey(provider);
  return [
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
    { name: providerEnvKey, value: openclawModelApiKey },
    {
      name: "OPENCLAW_CHANNELS_JSON",
      value: JSON.stringify(opts.openclawConfig?.channels ?? {}),
    },
    { name: "OPENCLAW_CONFIG_JSON", value: configJson },
    {
      name: "OPENCLAW_PLUGINS",
      value: (opts.openclawConfig?.plugins ?? []).join(","),
    },
    {
      name: "OPENCLAW_DM_POLICY",
      value: opts.openclawConfig?.dmPolicy ?? "pairing",
    },
  ];
}

function hermesRuntimeEnv(opts: LaunchOptions): k8s.V1EnvVar[] {
  const configJson = JSON.stringify(buildHermesGatewayConfig(opts));
  const hermesModel = hermesModelId(opts);
  const provider =
    opts.hermesConfig?.modelProvider ??
    process.env.HERMES_MODEL_PROVIDER ??
    "openai";
  const platformProvider = process.env.HERMES_MODEL_PROVIDER ?? "openai";
  const hermesModelApiKey =
    opts.hermesConfig?.modelApiKey ??
    (provider === platformProvider
      ? process.env.HERMES_MODEL_API_KEY
      : undefined) ??
    "";
  const hermesProviderEnvKey = providerEnvKeyFor(provider);
  return [
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
    { name: hermesProviderEnvKey, value: hermesModelApiKey },
    {
      name: "HERMES_GATEWAY_API_KEY",
      value:
        opts.hermesConfig?.gatewayApiKey ??
        process.env.HERMES_GATEWAY_API_KEY ??
        "",
    },
    { name: "HERMES_CONFIG_JSON", value: configJson },
    ...hermesChannelEnv(opts),
  ];
}

function hermesChannelEnv(opts: LaunchOptions): k8s.V1EnvVar[] {
  return Object.entries(
    hermesChannelEnvironment(opts.hermesConfig?.channels)
  ).map(([name, value]) => ({ name, value }));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

export function buildOpenClawGatewayConfig(
  opts: LaunchOptions
): Record<string, unknown> {
  const config = opts.openclawConfig;
  const provider =
    config?.modelProvider ?? process.env.OPENCLAW_MODEL_PROVIDER ?? "openai";
  const model = openClawModelId(opts);
  const agentRuntimeId = opts.agentId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const channels = Object.fromEntries(
    Object.entries(config?.channels ?? {}).map(([name, channel]) => {
      const allowFrom = stringList(channel.allowFrom);
      const common = {
        enabled: channel.enabled !== false,
        dmPolicy: channel.dmPolicy ?? config?.dmPolicy ?? "pairing",
        allowFrom,
      };
      if (name === "telegram") {
        return [
          name,
          {
            ...common,
            botToken: channel.botToken,
            groups: {
              "*": { requireMention: channel.requireMention !== false },
            },
          },
        ];
      }
      if (name === "whatsapp") {
        return [
          name,
          {
            ...common,
            selfChatMode: channel.mode === "self-chat",
            groupPolicy: "allowlist",
            groupAllowFrom: allowFrom,
            groups: {
              "*": { requireMention: channel.requireMention !== false },
            },
          },
        ];
      }
      if (name === "slack") {
        return [
          name,
          {
            ...common,
            mode: "socket",
            botToken: channel.botToken,
            appToken: channel.appToken,
          },
        ];
      }
      if (name === "discord") {
        return [name, { ...common, token: channel.botToken }];
      }
      return [name, common];
    })
  );
  const configuredPlugins = stringList(config?.plugins);
  const externalChannelPlugins = ["whatsapp", "slack", "discord"].filter(
    (channel) => Boolean(config?.channels?.[channel]?.enabled)
  );
  const pluginIds = Array.from(
    new Set([...configuredPlugins, "admin-http-rpc", ...externalChannelPlugins])
  );

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
    channels,
    agents: {
      defaults: {
        model: { primary: model },
        thinkingDefault: "low",
        contextInjection: "continuation-skip",
      },
      list: [
        {
          id: agentRuntimeId,
          default: true,
          fastModeDefault: "auto",
          // OpenClaw bootstraps AGENTS.md and other runtime-owned state in
          // its workspace. Keep that inside its writable subdirectory; pod
          // tools still operate on the canonical /mnt/shared workspace via
          // the daemon's client-tool bridge.
          workspace: "/mnt/shared/openclaw/workspace",
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
    ...(pluginIds.length
      ? {
          plugins: {
            enabled: true,
            ...(externalChannelPlugins.length
              ? {
                  load: {
                    paths: externalChannelPlugins.map(
                      (channel) =>
                        `/home/node/.commonos-openclaw/extensions/${channel}`
                    ),
                  },
                }
              : {}),
            entries: Object.fromEntries(
              pluginIds.map((pluginId) => [pluginId, { enabled: true }])
            ),
          },
        }
      : {}),
  };
}

function openClawModelId(opts: LaunchOptions): string {
  const provider =
    opts.openclawConfig?.modelProvider ??
    process.env.OPENCLAW_MODEL_PROVIDER ??
    "openai";
  const model =
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
      : "openai/gpt-5.4-mini");

  // Agent Commons stores provider and model separately (for example,
  // `openai` + `gpt-5.4-mini`), while OpenClaw requires a provider-qualified
  // primary. OpenRouter model ids already contain an upstream provider but
  // still need the OpenRouter prefix.
  return qualifiedOpenClawModelId(provider, model);
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

export function openClawRuntimeContainer(
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
  node <<'NODE'
const fs = require("fs");
const configPath = process.env.HOME + "/.openclaw/openclaw.json";
const desired = JSON.parse(process.env.OPENCLAW_CONFIG_JSON);
let existing = {};
try {
  existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {}
const next = { ...existing, ...desired };
if (!desired.plugins) delete next.plugins;
fs.writeFileSync(configPath, JSON.stringify(next));
NODE
fi
if command -v openclaw >/dev/null 2>&1; then
  channel_plugins="$(node -e 'const channels = JSON.parse(process.env.OPENCLAW_CHANNELS_JSON || "{}"); console.log(["whatsapp", "slack", "discord"].filter((id) => channels[id]?.enabled === true).join(" "))')"
  if [ -n "$channel_plugins" ]; then
    plugin_state=/home/node/.commonos-openclaw
    rm -rf "$plugin_state"
    install -d -m 700 "$plugin_state/extensions"
    for plugin in $channel_plugins; do
      plugin_cache="$HOME/.openclaw/commonos-plugin-cache/$plugin"
      legacy_plugin_cache="$HOME/.openclaw/extensions/$plugin"
      if [ ! -d "$plugin_cache" ] && [ -d "$legacy_plugin_cache" ]; then
        mkdir -p "$(dirname "$plugin_cache")"
        mv "$legacy_plugin_cache" "$plugin_cache"
      fi
      if [ -d "$plugin_cache" ]; then
        ln -s "$plugin_cache" "$plugin_state/extensions/$plugin"
      else
        OPENCLAW_STATE_DIR="$plugin_state" \
          OPENCLAW_CONFIG_PATH="$plugin_state/openclaw.json" \
          openclaw plugins install "clawhub:@openclaw/$plugin"
        mkdir -p "$(dirname "$plugin_cache")"
        cp -R "$plugin_state/extensions/$plugin" "$plugin_cache"
      fi
    done
  fi
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
    // The gateway binds loopback only, so kubelet httpGet probes (which
    // target the pod IP) cannot reach it — probe with an in-container exec.
    // Boot pre-warms plugins and provider auth; the startup probe allows
    // five minutes before liveness/readiness take over.
    startupProbe: {
      exec: { command: openclawHealthProbe() },
      periodSeconds: 5,
      timeoutSeconds: 5,
      failureThreshold: 60,
    },
    readinessProbe: {
      exec: { command: openclawHealthProbe() },
      periodSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    livenessProbe: {
      exec: { command: openclawHealthProbe() },
      periodSeconds: 20,
      timeoutSeconds: 5,
      failureThreshold: 6,
    },
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

  // The official hermes-agent image boots through s6-overlay (`/init` →
  // main-wrapper.sh) which routes container args as the hermes CLI command.
  // Overriding `command` bypasses that supervisor and there is no `hermes`
  // binary on PATH, so only set `args` and let the image entrypoint run.
  // Persistent state, config.yaml, and .env live in /opt/data — seeded by
  // the hermes-config-init init container before this container starts.
  return {
    name: "hermes-runtime",
    image,
    imagePullPolicy: opts.kind === "computer" ? "IfNotPresent" : "Always",
    args: ["gateway", "run"],
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
      // Align the runtime user with the pod's shared fsGroup so hermes can
      // read/write its subPath of the shared persistent volume.
      { name: "HERMES_UID", value: "1000" },
      { name: "HERMES_GID", value: "1000" },
      { name: "PUID", value: "1000" },
      { name: "PGID", value: "1000" },
    ],
    ports: [{ name: "hermes", containerPort: 8642 }],
    // Gateway boot (venv init, config migration, provider warmup) takes tens
    // of seconds on first start; the startup probe gives it five minutes
    // before liveness/readiness take over. Exec probes with a /healthz →
    // /health fallback keep this working across hermes-agent releases.
    startupProbe: {
      exec: { command: hermesHealthProbe() },
      periodSeconds: 5,
      timeoutSeconds: 5,
      failureThreshold: 60,
    },
    readinessProbe: {
      exec: { command: hermesHealthProbe() },
      periodSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    livenessProbe: {
      exec: { command: hermesHealthProbe() },
      periodSeconds: 20,
      timeoutSeconds: 5,
      failureThreshold: 6,
    },
    resources: {
      requests: { cpu: "10m", memory: "256Mi" },
      limits: { cpu: "2", memory: "2Gi" },
    },
    volumeMounts: [
      { name: "agent-storage", mountPath: "/opt/data", subPath: "hermes" },
    ],
  };
}

/**
 * Seeds the hermes data directory before the gateway starts:
 * - `.env` marks onboarding as complete and carries the model provider key
 *   (the gateway re-reads it on boot, so model/key changes land on restart);
 * - `config.yaml` holds the non-secret model + branding configuration.
 */
function hermesConfigInitContainer(
  opts: LaunchOptions,
  envVars: k8s.V1EnvVar[]
): k8s.V1Container | null {
  if (opts.integrationPath !== "hermes") return null;
  const providerEnvKey = providerEnvKeyFor(
    opts.hermesConfig?.modelProvider ??
      process.env.HERMES_MODEL_PROVIDER ??
      "openai"
  );
  return {
    name: "hermes-config-init",
    image: "public.ecr.aws/docker/library/busybox:1.36.1",
    command: ["/bin/sh", "-c"],
    args: [
      // Values are quoted so keys containing '#' or spaces survive dotenv
      // parsing. An existing .env also tells hermes to skip its interactive
      // onboarding wizard, which a headless pod can never answer.
      `
set -eu
mkdir -p /opt/data/logs
printf '%s\\n' "$HERMES_CONFIG_JSON" > /opt/data/config.yaml
: > /opt/data/.env.next
if [ -n "\${HERMES_MODEL_API_KEY:-}" ]; then
  printf '%s="%s"\\n' "${providerEnvKey}" "$HERMES_MODEL_API_KEY" >> /opt/data/.env.next
fi
printf 'API_SERVER_ENABLED="true"\\nAPI_SERVER_HOST="0.0.0.0"\\nAPI_SERVER_PORT="8642"\\n' >> /opt/data/.env.next
if [ -n "\${HERMES_GATEWAY_API_KEY:-}" ]; then
  printf 'API_SERVER_KEY="%s"\\n' "$HERMES_GATEWAY_API_KEY" >> /opt/data/.env.next
fi
if [ -f /opt/data/platforms/whatsapp/session/creds.json ]; then
  printf 'WHATSAPP_ENABLED="true"\n' >> /opt/data/.env.next
fi
mv /opt/data/.env.next /opt/data/.env
chmod 600 /opt/data/.env
`,
    ],
    env: envVars,
    securityContext: {
      runAsUser: 0,
      runAsGroup: 0,
      allowPrivilegeEscalation: false,
    },
    resources: {
      requests: { cpu: "5m", memory: "16Mi" },
      limits: { cpu: "100m", memory: "64Mi" },
    },
    volumeMounts: [
      { name: "agent-storage", mountPath: "/opt/data", subPath: "hermes" },
    ],
  };
}

// The OpenClaw image is node-based (node user, global fetch); the gateway
// binds loopback so health must be probed from inside the container.
function openclawHealthProbe(): string[] {
  return [
    "node",
    "-e",
    "fetch('http://127.0.0.1:18789/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
  ];
}

// The hermes image is python-based (s6-overlay); /healthz is the documented
// unauthenticated health path with /health as the pre-rename fallback.
function hermesHealthProbe(): string[] {
  return [
    "python3",
    "-c",
    [
      "import urllib.request,sys",
      "for p in ('/healthz','/health'):",
      "    try:",
      "        urllib.request.urlopen('http://127.0.0.1:8642'+p,timeout=3);sys.exit(0)",
      "    except Exception:pass",
      "sys.exit(1)",
    ].join("\n"),
  ];
}

export function runtimeStorageInitContainer(
  opts: LaunchOptions
): k8s.V1Container | null {
  if (opts.integrationPath !== "openclaw" && opts.integrationPath !== "hermes")
    return null;
  return {
    name: "runtime-storage-init",
    image: "public.ecr.aws/docker/library/busybox:1.36.1",
    command: ["/bin/sh", "-lc"],
    args: [
      // EFS access points enforce their configured POSIX identity server-side,
      // so chown/chgrp is both unnecessary and rejected. Creating dedicated
      // runtime directories through the mounted access point gives every
      // container in this pod the same persistent identity.
      opts.integrationPath === "openclaw"
        ? "mkdir -p /mnt/shared/openclaw/workspace && (chmod g+rwx /mnt/shared/openclaw /mnt/shared/openclaw/workspace || true)"
        : "mkdir -p /mnt/shared/hermes && (chmod g+rwx /mnt/shared/hermes || true)",
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
    // The Bun daemon has wedged its event loop in production (main thread
    // parked on a futex) while the container stayed "Running" — heartbeats,
    // message polling, and the tools API all silently stop. Probing the
    // daemon's own HTTP server from inside the container detects that state
    // and lets kubelet restart the runtime; queued messages are reclaimed
    // by the control plane after MESSAGE_RECLAIM_MS.
    livenessProbe: {
      exec: {
        command: [
          "curl",
          "-sf",
          "-m",
          "3",
          `http://127.0.0.1:${process.env.AGENT_TOOLS_PORT ?? "4100"}/healthz`,
        ],
      },
      initialDelaySeconds: 30,
      periodSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
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
      const code = kubernetesStatusCode(err);
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
      await createKubernetesPodIdempotently(coreApi, namespace, podBody);
      return;
    } catch (err: unknown) {
      const code = kubernetesStatusCode(err);
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
  const hermesConfigInit = hermesConfigInitContainer(opts, envVars);
  const initContainers = [
    ...(storageInit ? [storageInit] : []),
    ...(hermesConfigInit ? [hermesConfigInit] : []),
  ];
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
          ? {
              // All containers in one agent computer are one trust boundary
              // but use different non-root UIDs. A shared group lets the
              // daemon and runtime sidecars safely persist the same
              // workspace without broad world-writable permissions.
              fsGroup: 1000,
              fsGroupChangePolicy: "OnRootMismatch",
              supplementalGroups: [1000],
              seccompProfile: { type: "RuntimeDefault" },
            }
          : undefined,
      runtimeClassName:
        opts.kind === "computer"
          ? opts.resourceSpec?.runtimeClassName ??
            process.env.COMPUTER_RUNTIME_CLASS ??
            undefined
          : undefined,
      initContainers: initContainers.length ? initContainers : undefined,
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
    const code = kubernetesStatusCode(err);
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
    const code = kubernetesStatusCode(err);
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
  const hermesConfigInit = hermesConfigInitContainer(opts, envVars);
  const initContainers = [
    ...(storageInit ? [storageInit] : []),
    ...(hermesConfigInit ? [hermesConfigInit] : []),
  ];

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
      const code = kubernetesStatusCode(error);
      if (code !== 409) throw error;
      if (opts.kind === "computer") {
        await coreApi.patchNamespacedPersistentVolumeClaim({
          name: pvcName,
          namespace,
          body: [
            {
              op: "replace",
              path: "/spec/resources/requests/storage",
              value: `${opts.resourceSpec?.storageGiB ?? 10}Gi`,
            },
          ],
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

  await createKubernetesPodIdempotently(coreApi, namespace, {
    metadata: {
      name: podName,
      namespace,
      labels,
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
          ? {
              // All containers in one agent computer are one trust
              // boundary but use different non-root UIDs. A shared group
              // lets the daemon and runtime sidecars safely persist the
              // same workspace without broad world-writable permissions.
              fsGroup: 1000,
              fsGroupChangePolicy: "OnRootMismatch",
              supplementalGroups: [1000],
              seccompProfile: { type: "RuntimeDefault" },
            }
          : undefined,
      runtimeClassName:
        opts.kind === "computer"
          ? opts.resourceSpec?.runtimeClassName ??
            process.env.COMPUTER_RUNTIME_CLASS ??
            undefined
          : undefined,
      initContainers: initContainers.length ? initContainers : undefined,
      containers: [
        agentContainer(opts, imageUrl, envVars),
        ...(openClawContainer ? [openClawContainer] : []),
        ...(hermesContainer ? [hermesContainer] : []),
        ...(guestContainer ? [guestContainer] : []),
      ],
      volumes: [volume],
    },
  });

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
    const code = kubernetesStatusCode(error);
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
    const code = kubernetesStatusCode(error);
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
    const code = kubernetesStatusCode(err);
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

export function parseOpenClawAdminRpcResponse(raw: string): unknown {
  let response: {
    ok?: boolean;
    payload?: unknown;
    error?: { message?: string };
  };
  try {
    response = JSON.parse(raw) as typeof response;
  } catch {
    return raw;
  }
  if (response.ok === false) {
    throw new Error(
      response.error?.message ?? "runtime channel command failed"
    );
  }
  return response.payload ?? response;
}

export async function runRuntimeChannelCommand(opts: {
  provider: "gcp" | "aws";
  region?: string | null;
  namespace: string;
  podName: string;
  runtime: "openclaw" | "hermes";
  channel: "whatsapp";
  action: "connect" | "status" | "disconnect";
  mode?: "bot" | "self-chat";
  allowFrom?: string[];
}): Promise<{ output: unknown; raw: string }> {
  // Starting the OpenClaw CLI reloads its full plugin graph and provider auth,
  // which adds tens of seconds to every UI poll. The bundled admin HTTP RPC
  // plugin dispatches these same methods inside the already-running gateway.
  const requestByAction = {
    connect: { method: "web.login.start", params: { force: true } },
    status: {
      method: "channels.status",
      params: { channel: "whatsapp", probe: false, timeoutMs: 5_000 },
    },
    disconnect: {
      method: "channels.logout",
      params: { channel: "whatsapp" },
    },
  } as const;
  const rpcRequest = JSON.stringify(requestByAction[opts.action]);
  const allowedUsersBase64 = Buffer.from(
    (opts.allowFrom ?? [])
      .map((value) => value.replace(/^\+/, "").trim())
      .filter(Boolean)
      .join(",")
  ).toString("base64");
  const kc = await kubeConfigForProvider(opts.provider, opts.region);
  const exec = new k8s.Exec(kc);
  let stdout = "";
  let stderr = "";
  const capture = (append: (chunk: string) => void) =>
    new Writable({
      write(chunk, _encoding, callback) {
        append(String(chunk).slice(0, 1_000_000));
        callback();
      },
    });
  const command =
    opts.runtime === "openclaw"
      ? [
          "/bin/sh",
          "-lc",
          `curl --silent --show-error --fail-with-body --max-time 30 \
      --request POST http://127.0.0.1:18789/api/v1/admin/rpc \
      --header 'content-type: application/json' \
      --data '${rpcRequest}'`,
        ]
      : hermesWhatsAppCommand({
          action: opts.action,
          mode: opts.mode === "self-chat" ? "self-chat" : "bot",
          allowedUsersBase64,
        });
  await new Promise<void>(async (resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("runtime channel command timed out")),
      opts.action === "connect" ? 120_000 : 40_000
    );
    try {
      const socket = await exec.exec(
        opts.namespace,
        opts.podName,
        opts.runtime === "openclaw" ? "openclaw-runtime" : "hermes-runtime",
        command,
        capture((chunk) => (stdout += chunk)),
        capture((chunk) => (stderr += chunk)),
        null,
        false,
        (status) => {
          if (status.status === "Success") finish();
          else
            finish(
              new Error(status.message ?? "runtime channel command failed")
            );
        }
      );
      socket.on("error", (error: unknown) =>
        finish(error instanceof Error ? error : new Error(String(error)))
      );
      socket.on("close", () => {
        if (!settled && stderr.trim()) finish(new Error(stderr.trim()));
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const raw = stdout.trim();
  const output =
    opts.runtime === "openclaw"
      ? parseOpenClawAdminRpcResponse(raw)
      : JSON.parse(raw || "{}");
  return { output, raw };
}

export function hermesWhatsAppCommand(opts: {
  action: "connect" | "status" | "disconnect";
  mode: "bot" | "self-chat";
  allowedUsersBase64: string;
}): string[] {
  const renderPairing = [
    "import base64,io,json,os",
    "import qrcode",
    'path=os.environ.get("PAIR_LOG","")',
    'result={"status":"starting","connected":False}',
    "lines=[]",
    '\ntry:\n lines=open(path,encoding="utf-8",errors="replace").read().splitlines()\nexcept Exception:\n pass',
    '\nfor line in lines:\n try:\n  event=json.loads(line)\n except Exception:\n  continue\n kind=str(event.get("event") or "")\n if kind=="qr" and event.get("qr"):\n  result.update(status="waiting",qr_payload=event["qr"])\n elif kind=="connected":\n  result.update(status="connected",connected=True,user=event.get("user"))\n elif kind=="error":\n  result.update(status="error",error=event.get("error"))',
    'qr=result.get("qr_payload")',
    "img=qrcode.make(qr) if qr else None",
    "buf=io.BytesIO()",
    'img.save(buf,format="PNG") if img else None',
    'result.update({"qrDataUrl":"data:image/png;base64,"+base64.b64encode(buf.getvalue()).decode()}) if img else None',
    "print(json.dumps(result))",
  ].join("\n");
  const common = `
set -eu
state=/opt/data/platforms/whatsapp
session="$state/session"
pair_log="$state/commonos-pairing.jsonl"
pid_file="$state/commonos-pairing.pid"
mkdir -p "$state" "$session"
export PAIR_LOG="$pair_log"
render_pairing() { /opt/hermes/.venv/bin/python -c '${renderPairing}'; }
restart_gateway() {
  gateway_pid="$(ps -eo pid,args | awk '/[/]opt\\/hermes\\/\\.venv\\/bin\\/hermes gateway run/{print $1; exit}')"
  [ -z "$gateway_pid" ] || kill "$gateway_pid" || true
}
activate_pairing() {
  [ -f "$session/creds.json" ] || return 0
  if [ ! -f "$state/commonos-active" ]; then
    allowed_users="$(printf '%s' '${opts.allowedUsersBase64}' | base64 -d)"
    touch /opt/data/.env
    sed -i '/^WHATSAPP_/d' /opt/data/.env
    printf 'WHATSAPP_ENABLED="true"\\nWHATSAPP_MODE="%s"\\nWHATSAPP_DM_POLICY="pairing"\\n' '${opts.mode}' >> /opt/data/.env
    if [ -n "$allowed_users" ]; then
      printf 'WHATSAPP_ALLOWED_USERS="%s"\\n' "$allowed_users" >> /opt/data/.env
    fi
    touch "$state/commonos-active"
    restart_gateway
  fi
}
`;

  if (opts.action === "disconnect") {
    return [
      "/bin/sh",
      "-lc",
      `${common}
if [ -f "$pid_file" ]; then kill "$(cat "$pid_file")" 2>/dev/null || true; fi
rm -rf "$session" "$pair_log" "$pid_file" "$state/commonos-active"
mkdir -p "$session"
sed -i '/^WHATSAPP_/d' /opt/data/.env 2>/dev/null || true
restart_gateway
printf '{"status":"disconnected","connected":false}\\n'
`,
    ];
  }

  if (opts.action === "status") {
    return [
      "/bin/sh",
      "-lc",
      `${common}
if [ -f "$session/creds.json" ]; then
  activate_pairing
  printf '{"status":"connected","connected":true}\\n'
else
  render_pairing
fi
`,
    ];
  }

  return [
    "/bin/sh",
    "-lc",
    `${common}
if [ -f "$session/creds.json" ]; then
  activate_pairing
  printf '{"status":"connected","connected":true}\\n'
  exit 0
fi
if [ -f "$pid_file" ]; then kill "$(cat "$pid_file")" 2>/dev/null || true; fi
bridge=/opt/hermes/scripts/whatsapp-bridge
if [ ! -d "$bridge/node_modules" ]; then
  cd "$bridge"
  npm install --silent
fi
: > "$pair_log"
cd "$bridge"
nohup env WHATSAPP_MODE='${opts.mode}' node bridge.js --pair-only --pair-json --session "$session" > "$pair_log" 2>&1 < /dev/null &
echo $! > "$pid_file"
for attempt in $(seq 1 90); do
  if grep -Eq '"event"[[:space:]]*:[[:space:]]*"(qr|connected|error)"' "$pair_log"; then break; fi
  kill -0 "$(cat "$pid_file")" 2>/dev/null || break
  sleep 1
done
activate_pairing
render_pairing
`,
  ];
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
