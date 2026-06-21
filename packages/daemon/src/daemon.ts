import { watch } from "chokidar";
import { randomBytes } from "crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  statSync,
} from "fs";
import { join, dirname, resolve, relative } from "path";
import { loadConfig } from "./config.js";
import { CommonOSAgentClient } from "@common-os/sdk";

const config = loadConfig();

const agent = new CommonOSAgentClient({
  agentToken: config.agentToken,
  agentId: config.agentId,
  apiUrl: config.apiUrl,
});

const HEARTBEAT_MS   = 30_000;
const POLL_MS        = 5_000;
const MSG_POLL_MS    = Number(process.env.MSG_POLL_MS ?? 750);
const MESSAGE_RUN_TIMEOUT_MS = Number(process.env.MESSAGE_RUN_TIMEOUT_MS ?? 180_000);
const OPENCLAW_RESPONSE_TIMEOUT_MS = Number(process.env.OPENCLAW_RESPONSE_TIMEOUT_MS ?? 90_000);
const OPENCLAW_READY_TIMEOUT_MS = Number(process.env.OPENCLAW_READY_TIMEOUT_MS ?? 30_000);
const HERMES_RESPONSE_TIMEOUT_MS = Number(process.env.HERMES_RESPONSE_TIMEOUT_MS ?? 90_000);
const HERMES_READY_TIMEOUT_MS = Number(process.env.HERMES_READY_TIMEOUT_MS ?? 30_000);
const AGENT_TOOLS_PORT = Number(process.env.AGENT_TOOLS_PORT ?? 4100);
const BROWSER_STATUS_MS = Number(process.env.BROWSER_STATUS_MS ?? 7_500);
const BROWSER_SCREENSHOT_QUALITY = Number(process.env.BROWSER_SCREENSHOT_QUALITY ?? 45);
const HEALTH_MS      = 10_000;
const AXL_INBOX_MS   = 5_000;
const WORKSPACE_DIR  = process.env.COMMONOS_WORKSPACE ?? config.workspaceDir;
const AXL_API_URL    = process.env.AXL_API_URL ?? "http://localhost:9002";
const AXL_LISTEN_PORT = process.env.AXL_LISTEN_PORT ?? "9001";
const AXL_MODE = (process.env.AXL_MODE ?? "explicit").toLowerCase();
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const DAEMON_RUNTIME = "common-os-daemon/agc-direct-stream-v9-explicit-axl";
const AGENT_IMAGE    = process.env.COMMONOS_AGENT_IMAGE ?? "";
const COMMIT_SHA     = process.env.COMMONOS_COMMIT_SHA ?? "";

type AgcMessage = { role: "user" | "assistant"; content: string };
type AxlRoutingContext = { axlTargetAgentId?: string | null; axlTargetPeerId?: string | null };
type TokenUsagePayload = {
  provider?: string;
  model?: string;
  source?: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  requestCount: number;
};

type AxlEnvelope = {
  type?: "request" | "response";
  id?: string;
  fromAgentId?: string;
  toAgentId?: string;
  content?: string;
  inReplyTo?: string;
};

type FleetOrchestration = {
  topology?: string;
  managerRole?: string | null;
  communicationCadence?: string;
  defaultChannel?: string;
  axlPolicy?: string;
  taskSharing?: {
    assignment?: string;
    handoffProtocol?: string;
    dependencies?: string;
  };
  reporting?: {
    statusFormat?: string;
    reportToRole?: string | null;
    onTaskStart?: boolean;
    onTaskComplete?: boolean;
    onBlocked?: boolean;
  };
  checkIns?: {
    enabled?: boolean;
    cadenceMinutes?: number;
    checkOnBlockedTasks?: boolean;
    checkOnStaleTasksMinutes?: number;
  };
  escalation?: {
    blockedAfterMinutes?: number;
    escalateToRole?: string | null;
    requireHumanOnConflict?: boolean;
  };
  customInstructions?: string;
};

// Session ID is created once at startup and persisted so the agent remembers
// all previous conversations across daemon restarts.
let agentSessionId: string | null = null;
let agcReady = false;
let fleetOrchestration: FleetOrchestration | null = null;
let browserProc: ReturnType<typeof Bun.spawn> | null = null;
let browserWs: WebSocket | null = null;
let browserSessionId: string | null = null;
let browserStderrTail = "";
let browserLastError: string | null = null;
let browserCdpId = 0;
const browserPending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (err: Error) => void }>();
type ManagedProcess = {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  proc: ReturnType<typeof Bun.spawn>;
  startedAt: string;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
};
const managedProcesses = new Map<string, ManagedProcess>();

function axlEnabled(): boolean {
  return AXL_MODE !== "off" && AXL_MODE !== "disabled";
}

function axlAutoMode(): boolean {
  return AXL_MODE === "auto";
}

// ─── World state ──────────────────────────────────────────────────────────

const worldPos = {
  room: config.worldRoom ?? "dev-room",
  x: config.worldX ?? 2,
  y: config.worldY ?? 2,
};

// ─── First-time setup ──────────────────────────────────────────────────────

async function firstTimeSetup(): Promise<void> {
  try {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
    console.log(`[daemon] workspace ready at ${WORKSPACE_DIR}`);
  } catch {}

  if (config.integrationPath === "native") {
    if (!config.commonsApiKey) await bootstrapCommons();
    await ensureAgcReady();
  }
}

async function ensureAgcReady(): Promise<void> {
  if (agcReady) return;
  if (!config.commonsApiKey || !config.commonsAgentId) {
    console.log("[daemon] AGC not configured — will retry bootstrap in background");
    return;
  }
  await setupAgcAuth();
  await initSession(); // recover only — new sessions created lazily on first run
  agcReady = true;
}

async function startAgcBootstrapRetryLoop(): Promise<void> {
  if (config.integrationPath !== "native") return;
  while (!agcReady) {
    await sleep(60_000);
    if (!config.commonsApiKey || !config.commonsAgentId) {
      await bootstrapCommons();
    }
    await ensureAgcReady();
  }
}

async function bootstrapCommons(): Promise<void> {
  console.log("[daemon] bootstrapping Agent Commons credentials...");
  try {
    const res = await fetch(
      `${config.apiUrl}/agents/${config.agentId}/bootstrap`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.agentToken}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      console.warn(`[daemon] bootstrap: API returned ${res.status}`);
      return;
    }
    const data = await res.json() as {
      commonsAgentId?: string | null;
      commonsApiKey?: string | null;
    };
    if (data.commonsApiKey && data.commonsAgentId) {
      config.commonsApiKey = data.commonsApiKey;
      config.commonsAgentId = data.commonsAgentId;
      console.log(`[daemon] Agent Commons ready  agentId=${config.commonsAgentId}`);
    } else {
      console.warn("[daemon] bootstrap: no complete Agent Commons credentials returned — AGENTCOMMONS_API_KEY or commonsAgentId may be missing");
    }
  } catch (err) {
    console.warn("[daemon] bootstrap failed:", err instanceof Error ? err.message : err);
  }
}

// ─── AGC CLI configuration ─────────────────────────────────────────────────
// The daemon drives Agent Commons exclusively through the `agc` CLI binary,
// which is pre-installed in the agent image. Auth lives in ~/.agc/config.json
// (written once after bootstrapCommons resolves the API key). All subsequent
// `agc run` calls inherit auth from that file via the AGC_API_KEY env var.

const AGC_BASE_URL = (process.env.AGC_API_URL ?? "https://api.agentcommons.io").replace(/\/$/, "");
const AGC_INITIATOR = process.env.AGC_INITIATOR ?? process.env.AGENTCOMMONS_INITIATOR ?? "";
const AGC_HOME_CONFIG = join(process.env.HOME ?? "/root", ".agc", "config.json");

async function setupAgcAuth(): Promise<void> {
  if (!config.commonsApiKey) return;
  try {
    mkdirSync(dirname(AGC_HOME_CONFIG), { recursive: true });
    writeFileSync(
      AGC_HOME_CONFIG,
      JSON.stringify({
        apiKey: config.commonsApiKey,
        apiUrl: AGC_BASE_URL,
        ...(AGC_INITIATOR ? { initiator: AGC_INITIATOR } : {}),
      }),
      { mode: 0o600 },
    );
    console.log("[daemon] agc auth configured");
  } catch (err) {
    console.warn("[daemon] agc config write failed:", err instanceof Error ? err.message : err);
  }
}

function agcEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AGC_API_KEY: config.commonsApiKey ?? "",
    AGC_API_URL: AGC_BASE_URL,
    ...(AGC_INITIATOR ? { AGC_INITIATOR } : {}),
  };
}

// ─── Session management ────────────────────────────────────────────────────
// One persistent AGC session per agent. The session ID is cached in the
// workspace and recovered from the control plane when ephemeral pod storage is
// lost. All messages and tasks share this session, giving the agent continuous
// conversational memory.

const SESSION_FILE = join(WORKSPACE_DIR, ".common-os-session.json");

async function recoverSessionFromApi(): Promise<string | null> {
  if (!config.apiUrl || !config.agentId || !config.agentToken) return null;

  try {
    const res = await fetch(`${config.apiUrl}/agents/${config.agentId}/session/current`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.agentToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[daemon] session recovery skipped: API returned ${res.status}`);
      return null;
    }

    const data = await res.json() as { agcSessionId?: string | null };
    return data.agcSessionId ?? null;
  } catch (err) {
    console.warn("[daemon] session recovery failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function initSession(): Promise<void> {
  if (!config.commonsAgentId || !config.commonsApiKey) {
    console.log("[daemon] AGC not configured — skipping session init");
    return;
  }

  // 1. Resume from local file (survives in-place restarts)
  try {
    if (existsSync(SESSION_FILE)) {
      const saved = JSON.parse(readFileSync(SESSION_FILE, "utf-8")) as {
        sessionId?: string;
        agentId?: string;
      };
      if (saved.sessionId && saved.agentId === config.commonsAgentId) {
        agentSessionId = saved.sessionId;
        console.log(`[daemon] resumed session ${agentSessionId}`);
        return;
      }
    }
  } catch {}

  // 2. Recover from MongoDB (survives pod restarts where /workspace is wiped)
  const recovered = await recoverSessionFromApi();
  if (recovered) {
    agentSessionId = recovered;
    try {
      writeFileSync(SESSION_FILE, JSON.stringify({ sessionId: recovered, agentId: config.commonsAgentId }));
    } catch {}
    console.log(`[daemon] recovered session ${agentSessionId} from API`);
    return;
  }

  // No existing session found — a new one will be created lazily on first agc run.
  console.log("[daemon] no prior session found — will create on first run");
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function parseAgcSessionId(output: string): string | null {
  const clean = stripAnsi(output);
  for (const line of clean.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    // SSE line or plain JSON
    const raw = s.startsWith("data:") ? s.slice(5).trim() : s;
    if (raw.startsWith("{")) {
      try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        const id = obj.sessionId ?? obj.id ?? obj.session_id ?? null;
        if (typeof id === "string" && id) return id;
      } catch {}
    }
    // "Session: ses_xxx" or "Session ID: ses_xxx" printed by --no-stream / --new-session
    const kv = s.match(/(?:session(?:\s+id)?)\s*[=:]\s*([^\s(]+)/i);
    if (kv?.[1]) return kv[1];
  }
  // Fallback: any token that looks like a session identifier
  const m = clean.match(/\b(sess?[-_][a-zA-Z0-9_-]{6,}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/);
  return m?.[1] ?? null;
}

async function registerSessionWithApi(): Promise<void> {
  if (!agentSessionId) return
  const title = `Session ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
  try {
    await fetch(`${config.apiUrl}/agents/${config.agentId}/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.agentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agcSessionId: agentSessionId, title }),
      signal: AbortSignal.timeout(10_000),
    })
    console.log(`[daemon] session registered with API  agcSessionId=${agentSessionId.slice(0, 12)}…`)
  } catch (err) {
    console.warn('[daemon] session registration failed:', err instanceof Error ? err.message : err)
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

function emitHeartbeat(): void {
  agent.emit({
    type: "heartbeat",
    payload: {
      runtime: DAEMON_RUNTIME,
      commitSha: COMMIT_SHA,
      agentImage: AGENT_IMAGE,
    },
  }).catch((err) => {
    console.error("[daemon] heartbeat error:", err);
  });
}

async function main() {
  console.log(`[daemon] starting  ${DAEMON_RUNTIME}  agent=${config.agentId}  role=${config.role}  fleet=${config.fleetId}  image=${AGENT_IMAGE || "unknown"}  commit=${COMMIT_SHA || "unknown"}`);

  await firstTimeSetup();
  await agent.emit({ type: "state_change", payload: { status: "online" } }).catch((err) => {
    console.error("[daemon] state change error:", err);
  });
  emitHeartbeat();
  console.log("[daemon] online");

  // Push initial workspace snapshot so the UI can show the pod filesystem immediately
  await emitWorkspaceSnapshot().catch(() => {});
  await refreshFleetOrchestration().catch(() => {});

  if (axlEnabled()) {
    void registerAxlPeer();
    void discoverFleetPeers();
  } else {
    console.log("[daemon] AXL disabled");
  }
  void startAgcBootstrapRetryLoop();

  setInterval(() => {
    emitHeartbeat();
  }, HEARTBEAT_MS);
  setInterval(() => {
    refreshFleetOrchestration().catch(() => {});
  }, 60_000);
  startBrowserPolling();
  startAgentToolsServer();

  startFileWatcher();
  startHealthMonitor();
  if (axlAutoMode()) {
    void startAxlInboxLoop();
  } else if (axlEnabled()) {
    console.log("[daemon] AXL explicit mode: P2P is available only when cli_send_axl_message is called");
  }
  if (config.integrationPath === "guest") {
    console.log("[daemon] guest runtime owns task/message execution; daemon will monitor workspace, heartbeat, and status");
    return;
  }
  void pollMessages();
  await pollTasks();
}

// ─── Workspace snapshot ────────────────────────────────────────────────────

async function refreshFleetOrchestration(): Promise<void> {
  if (!config.apiUrl || !config.fleetId) return;
  const res = await fetch(`${config.apiUrl}/fleets/${config.fleetId}`, {
    headers: { Authorization: `Bearer ${config.agentToken}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return;
  const fleet = await res.json() as { orchestration?: FleetOrchestration | null };
  fleetOrchestration = fleet.orchestration ?? null;
}

function orchestrationContext(): string {
  if (!fleetOrchestration) {
    return [
      "## Fleet Coordination",
      "No fleet orchestration policy is configured. Coordinate conservatively: keep task ownership clear, summarize handoffs, and ask for clarification before interrupting other agents.",
    ].join("\n");
  }

  const o = fleetOrchestration;
  const lines = [
    "## Fleet Coordination Policy",
    `Topology: ${o.topology ?? "manager-led"}`,
    `Manager role: ${o.managerRole ?? "manager"}`,
    `Default communication channel: ${o.defaultChannel ?? "control-plane"}`,
    `Communication cadence: ${o.communicationCadence ?? "task-boundary"}`,
    `AXL/P2P policy: ${o.axlPolicy ?? "explicit-only"}`,
    "",
    "Task sharing:",
    `- Assignment: ${o.taskSharing?.assignment ?? "manager-assigns"}`,
    `- Dependencies: ${o.taskSharing?.dependencies ?? "explicit"}`,
    `- Handoff protocol: ${o.taskSharing?.handoffProtocol ?? "Summarize context, current state, blockers, required inputs, and next action."}`,
    "",
    "Reporting:",
    `- Format: ${o.reporting?.statusFormat ?? "structured"}`,
    `- Report to role: ${o.reporting?.reportToRole ?? o.managerRole ?? "manager"}`,
    `- On task start: ${o.reporting?.onTaskStart === false ? "no" : "yes"}`,
    `- On task complete: ${o.reporting?.onTaskComplete === false ? "no" : "yes"}`,
    `- On blocked: ${o.reporting?.onBlocked === false ? "no" : "yes"}`,
    "",
    "Check-ins and escalation:",
    `- Check-ins: ${o.checkIns?.enabled === false ? "disabled" : `every ${o.checkIns?.cadenceMinutes ?? 30} minutes`}`,
    `- Check blocked tasks: ${o.checkIns?.checkOnBlockedTasks === false ? "no" : "yes"}`,
    `- Stale task threshold: ${o.checkIns?.checkOnStaleTasksMinutes ?? 60} minutes`,
    `- Escalate blocked work after: ${o.escalation?.blockedAfterMinutes ?? 30} minutes`,
    `- Escalate to role: ${o.escalation?.escalateToRole ?? o.managerRole ?? "manager"}`,
    `- Human required on conflict: ${o.escalation?.requireHumanOnConflict === false ? "no" : "yes"}`,
  ];

  if (o.customInstructions?.trim()) {
    lines.push("", "Custom coordination instructions:", o.customInstructions.trim());
  }

  lines.push(
    "",
    "Follow this policy when deciding when to share status, hand off work, ask another agent for help, or escalate. Do not interrupt other agents outside this policy unless the user explicitly requests it.",
  );

  return lines.join("\n");
}

async function emitWorkspaceSnapshot(): Promise<void> {
  const snapshot = buildWorkspaceSnapshot(WORKSPACE_DIR);
  await agent
    .emit({ type: "workspace_snapshot", payload: { snapshot, rootDir: WORKSPACE_DIR } })
    .catch(() => {});
  console.log(`[daemon] workspace snapshot emitted (${snapshot.split("\n").length} lines)`);
}

// ─── Agent browser ─────────────────────────────────────────────────────────

type BrowserRuntimeStatus = {
  status: "off" | "starting" | "on" | "error";
  url?: string | null;
  title?: string | null;
  screenshot?: string | null;
  lastAction?: string | null;
  error?: string | null;
};

let browserLastAction: string | null = null;

function rememberBrowserStderr(chunk: string): void {
  browserStderrTail = `${browserStderrTail}${chunk}`.slice(-4_000);
}

async function consumeBrowserStderr(stream: ReadableStream<Uint8Array> | null | undefined): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) rememberBrowserStderr(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    rememberBrowserStderr(`\n[stderr read failed: ${err instanceof Error ? err.message : String(err)}]`);
  }
}

async function browserSnapshot(lastAction?: string): Promise<BrowserRuntimeStatus> {
  if (lastAction) browserLastAction = lastAction;
  if (!browserProc || !browserWs || !browserSessionId) return { status: "off", lastAction: browserLastAction, error: browserLastError };
  try {
    const urlResult = await cdpSend("Runtime.evaluate", { expression: "location.href", returnByValue: true }, browserSessionId);
    const titleResult = await cdpSend("Runtime.evaluate", { expression: "document.title", returnByValue: true }, browserSessionId);
    const shotResult = await cdpSend("Page.captureScreenshot", {
      format: "jpeg",
      quality: Math.max(25, Math.min(80, BROWSER_SCREENSHOT_QUALITY)),
      fromSurface: true,
    }, browserSessionId);
    const url = cdpValue(urlResult) ?? null;
    const title = cdpValue(titleResult) ?? null;
    const data = typeof shotResult.data === "string" ? shotResult.data : null;
    return {
      status: "on",
      url,
      title,
      screenshot: data ? `data:image/jpeg;base64,${data}` : null,
      lastAction: browserLastAction,
      error: null,
    };
  } catch (err) {
    return {
      status: "error",
      url: null,
      title: null,
      screenshot: null,
      lastAction: browserLastAction,
      error: browserLastError ?? (err instanceof Error ? err.message : String(err)),
    };
  }
}

async function waitForBrowserReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  let lastState = "";
  while (Date.now() < deadline) {
    try {
      const ready = await cdpSend("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      }, browserSessionId);
      lastState = cdpValue(ready) ?? "";
      if (lastState === "complete" || lastState === "interactive") return;
    } catch (err) {
      lastState = err instanceof Error ? err.message : String(err);
    }
    await sleep(250);
  }
  throw new Error(`browser did not become ready within ${Math.round(timeoutMs / 1000)}s (${lastState || "unknown state"})`);
}

async function browserEvaluate(expression: string, timeoutMs = 10_000): Promise<unknown> {
  await ensureBrowser();
  const result = await cdpSend("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  }, browserSessionId);
  const nested = result.result as Record<string, unknown> | undefined;
  if (nested?.subtype === "error") {
    const description = typeof nested.description === "string" ? nested.description : "browser evaluation failed";
    throw new Error(description);
  }
  return nested?.value ?? result.value ?? null;
}

function formatBrowserValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

// Keeps the browser tab live between agent-driven actions
function startBrowserPolling(): void {
  setInterval(() => {
    if (!browserProc || !browserWs || !browserSessionId) return;
    void browserSnapshot().then(emitBrowserStatus).catch(() => {});
  }, BROWSER_STATUS_MS);
}

async function emitBrowserStatus(status: BrowserRuntimeStatus): Promise<void> {
  await agent.emit({ type: "browser_status", payload: status }).catch((err) => {
    console.warn("[daemon] browser status emit failed:", err instanceof Error ? err.message : err);
  });
}

function browserExecutablePath(): string {
  return process.env.BROWSER_EXECUTABLE_PATH
    ?? (existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : "/usr/bin/chromium");
}

function resetBrowserState(): void {
  browserProc = null;
  browserWs = null;
  browserSessionId = null;
}

async function cdpSend(method: string, params: Record<string, unknown> = {}, sessionId?: string | null): Promise<Record<string, unknown>> {
  if (!browserWs || browserWs.readyState !== WebSocket.OPEN) throw new Error("browser websocket is not connected");
  const id = ++browserCdpId;
  const msg = { id, method, params, ...(sessionId ? { sessionId } : {}) };
  const result = new Promise<Record<string, unknown>>((resolve, reject) => {
    browserPending.set(id, { resolve, reject });
    setTimeout(() => {
      if (browserPending.delete(id)) reject(new Error(`browser command timed out: ${method}`));
    }, 30_000);
  });
  browserWs.send(JSON.stringify(msg));
  return result;
}

function cdpValue(result: Record<string, unknown>): string | null {
  const value = result.value;
  if (typeof value === "string") return value;
  const nested = result.result as Record<string, unknown> | undefined;
  return typeof nested?.value === "string" ? nested.value : null;
}

async function waitForBrowserWs(port: number): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) {
        const data = await res.json() as { webSocketDebuggerUrl?: string };
        if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error("Chromium remote debugging endpoint did not become ready");
}

async function connectBrowserWs(wsUrl: string): Promise<void> {
  browserWs = new WebSocket(wsUrl);
  browserWs.addEventListener("message", (event) => {
    const raw = typeof event.data === "string" ? event.data : "";
    if (!raw) return;
    const msg = JSON.parse(raw) as { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
    if (!msg.id) return;
    const pending = browserPending.get(msg.id);
    if (!pending) return;
    browserPending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message ?? "browser command failed"));
    else pending.resolve(msg.result ?? {});
  });
  browserWs.addEventListener("close", () => {
    browserWs = null;
    browserSessionId = null;
    for (const pending of browserPending.values()) pending.reject(new Error("browser websocket closed"));
    browserPending.clear();
    browserLastAction = "browser disconnected";
    void emitBrowserStatus({ status: "off", url: null, title: null, screenshot: null, lastAction: browserLastAction, error: null });
  });
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => rejectOpen(new Error("browser websocket open timed out")), 5_000);
    browserWs?.addEventListener("open", () => {
      clearTimeout(timeout);
      resolveOpen();
    }, { once: true });
    browserWs?.addEventListener("error", () => {
      clearTimeout(timeout);
      rejectOpen(new Error("browser websocket connection failed"));
    }, { once: true });
  });
}

async function ensureBrowser(url?: string): Promise<void> {
  if (browserProc && browserWs && browserSessionId) {
    if (url) await cdpSend("Page.navigate", { url }, browserSessionId);
    return;
  }

  await emitBrowserStatus({ status: "starting", url: url ?? null, title: null, screenshot: null, lastAction: "launch", error: null });
  const port = Number(process.env.BROWSER_DEBUG_PORT ?? 9222);
  const userDataDir = process.env.BROWSER_USER_DATA_DIR ?? "/tmp/commonos-agent-browser";
  const executablePath = browserExecutablePath();
  if (!existsSync(executablePath)) {
    browserLastError = `Chromium executable not found at ${executablePath}`;
    await emitBrowserStatus({ status: "error", url: null, title: null, screenshot: null, lastAction: "launch", error: browserLastError });
    throw new Error(browserLastError);
  }
  browserLastError = null;
  browserStderrTail = "";
  mkdirSync(userDataDir, { recursive: true });
  console.log(`[daemon] launching browser executable=${executablePath} port=${port} profile=${userDataDir}`);
  const proc = Bun.spawn([
    executablePath,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--no-sandbox",
    "--no-zygote",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-extensions",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-popup-blocking",
    "--no-first-run",
    "--no-default-browser-check",
    "--metrics-recording-only",
    "--mute-audio",
    "about:blank",
  ], {
    stdout: "ignore",
    stderr: "pipe",
  });
  browserProc = proc;
  void consumeBrowserStderr(proc.stderr);
  void proc.exited.then((code) => {
    if (browserProc !== proc) return;
    browserLastError = `Chromium exited with code ${code}${browserStderrTail.trim() ? `: ${browserStderrTail.trim()}` : ""}`;
    console.warn(`[daemon] ${browserLastError}`);
    resetBrowserState();
    browserLastAction = "browser exited";
    void emitBrowserStatus({ status: "off", url: null, title: null, screenshot: null, lastAction: browserLastAction, error: browserLastError });
  });
  try {
    await connectBrowserWs(await waitForBrowserWs(port));
    const target = await cdpSend("Target.createTarget", {
      url: url ?? "about:blank",
    });
    const targetId = typeof target.targetId === "string" ? target.targetId : "";
    const attached = await cdpSend("Target.attachToTarget", { targetId, flatten: true });
    browserSessionId = typeof attached.sessionId === "string" ? attached.sessionId : null;
    if (!browserSessionId) throw new Error("could not attach to browser target");
    await cdpSend("Page.enable", {}, browserSessionId);
    await cdpSend("Runtime.enable", {}, browserSessionId);
    await cdpSend("Emulation.setDeviceMetricsOverride", {
      width: Number(process.env.BROWSER_VIEWPORT_WIDTH ?? 1280),
      height: Number(process.env.BROWSER_VIEWPORT_HEIGHT ?? 800),
      deviceScaleFactor: 1,
      mobile: false,
    }, browserSessionId);
    await emitBrowserStatus(await browserSnapshot(url ? `open ${url}` : "launch"));
  } catch (err) {
    browserLastError = `${err instanceof Error ? err.message : String(err)}${browserStderrTail.trim() ? `: ${browserStderrTail.trim()}` : ""}`;
    console.warn(`[daemon] browser launch failed: ${browserLastError}`);
    if (browserProc === proc) {
      resetBrowserState();
      proc.kill();
    }
    await emitBrowserStatus({ status: "error", url: null, title: null, screenshot: null, lastAction: "launch", error: browserLastError });
    throw new Error(browserLastError);
  }
}

async function closeBrowser(): Promise<void> {
  const current = browserProc;
  const currentWs = browserWs;
  resetBrowserState();
  currentWs?.close();
  current?.kill();
  browserLastAction = "close";
  browserLastError = null;
  await emitBrowserStatus({ status: "off", url: null, title: null, screenshot: null, lastAction: browserLastAction, error: null });
}

// ─── Pod-local Agent Tools API ──────────────────────────────────────────────
//
// Any sibling container in this pod — a custom/guest runtime the tenant
// brings, or a future integration path — can drive the full TOOL_CATALOG
// (browser, filesystem, wallet, AXL, and anything added later) over plain
// HTTP without needing CommonOS-specific tool-calling plumbing. Containers
// in the same Kubernetes pod share the loopback interface, so binding to
// 127.0.0.1 keeps this reachable pod-locally only.
function startAgentToolsServer(): void {
  Bun.serve({
    hostname: "127.0.0.1",
    port: AGENT_TOOLS_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      try {
        if (req.method === "GET" && url.pathname === "/healthz") {
          return Response.json({ ok: true });
        }
        // Discovery endpoint — any sibling container can list what this pod
        // can do without hardcoding tool names on its own side.
        if (req.method === "GET" && url.pathname === "/v1/tools") {
          return Response.json({ ok: true, tools: TOOL_CATALOG });
        }
        const match = url.pathname.match(/^\/v1\/tools\/([a-zA-Z0-9_]+)$/);
        if (req.method === "POST" && match) {
          const name = match[1];
          if (!toolCatalogEntry(name)) {
            return Response.json({ ok: false, error: `unknown tool: ${name}` }, { status: 404 });
          }
          const args = await req.json().catch(() => ({})) as Record<string, unknown>;
          return Response.json({ ok: true, result: await executeLocalTool(name, args) });
        }
        return Response.json({ ok: false, error: "not found" }, { status: 404 });
      } catch (err) {
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
      }
    },
  });
  console.log(`[daemon] agent tools API listening on 127.0.0.1:${AGENT_TOOLS_PORT} (${TOOL_CATALOG.length} tools)`);
}

// ─── File watcher ──────────────────────────────────────────────────────────

let snapshotDebounce: ReturnType<typeof setTimeout> | null = null;

function startFileWatcher() {
  try {
    const watcher = watch(WORKSPACE_DIR, {
      ignoreInitial: true,
      persistent: true,
      ignored: /(node_modules|\.git)/,
    });

    watcher.on("add",    (path) => emitFileChange(path, "create"));
    watcher.on("change", (path) => emitFileChange(path, "modify"));
    watcher.on("unlink", (path) => emitFileChange(path, "delete"));

    console.log(`[daemon] watching ${WORKSPACE_DIR}`);
  } catch {
    // workspace dir may not exist yet — watcher is optional
  }
}

function emitFileChange(path: string, op: "create" | "modify" | "delete") {
  agent.emit({ type: "file_changed", payload: { path, op } }).catch(() => {});
  // Debounce snapshot refresh so rapid file writes don't flood the API
  if (snapshotDebounce) clearTimeout(snapshotDebounce);
  snapshotDebounce = setTimeout(() => {
    snapshotDebounce = null;
    emitWorkspaceSnapshot().catch(() => {});
  }, 4_000);
}

// ─── Health monitor ────────────────────────────────────────────────────────

let runtimeHealthy = true;

function startHealthMonitor() {
  if (config.integrationPath !== "openclaw" && config.integrationPath !== "hermes") {
    return;
  }

  const probeUrl = config.integrationPath === "hermes"
    ? `${config.hermesGatewayUrl}/health`
    : `${config.openclawGatewayUrl}/health`;

  setInterval(async () => {
    try {
      const res = await fetch(probeUrl, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      if (!runtimeHealthy) {
        runtimeHealthy = true;
        console.log("[daemon] runtime healthy again");
        await agent.emit({ type: "state_change", payload: { status: "idle" } });
      }
    } catch (err) {
      if (runtimeHealthy) {
        runtimeHealthy = false;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[daemon] runtime health check failed:", msg);
        await agent
          .emit({ type: "error", payload: { message: `runtime unreachable: ${msg}` } })
          .catch(() => {});
      }
    }
  }, HEALTH_MS);

  console.log(`[daemon] health monitor → ${probeUrl}`);
}

// ─── AXL peer registration ────────────────────────────────────────────────

async function registerAxlPeer(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${AXL_API_URL}/topology`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) throw new Error(`AXL topology endpoint returned ${res.status}`);

      const data = await res.json() as { our_public_key?: string; our_ipv6?: string };
      const peerId    = data.our_public_key ?? null;
      const dialAddr  = axlDialAddress(data.our_ipv6);

      if (!peerId) throw new Error("AXL returned no public key");

      await fetch(`${config.apiUrl}/fleets/${config.fleetId}/agents/${config.agentId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${config.agentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ "axl.peerId": peerId, "axl.multiaddr": dialAddr }),
      });

      console.log(`[daemon] AXL peer registered  peerId=${peerId.slice(0, 16)}…  dial=${dialAddr ?? "unknown"}  ipv6=${data.our_ipv6 ?? "unknown"}`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[daemon] AXL peer registration attempt ${attempt + 1}/5 failed: ${msg}`);
      if (attempt < 4) await sleep(3_000);
    }
  }
  console.warn("[daemon] AXL peer registration failed after 5 attempts — continuing without P2P");
}

function axlDialAddress(overlayIpv6?: string): string | null {
  if (process.env.POD_IP) return `tls://${process.env.POD_IP}:${AXL_LISTEN_PORT}`;
  if (!overlayIpv6) return null;
  const host = overlayIpv6.includes(":") ? `[${overlayIpv6}]` : overlayIpv6;
  return `tls://${host}:${AXL_LISTEN_PORT}`;
}

// ─── AXL fleet peer discovery ─────────────────────────────────────────────

async function discoverFleetPeers(): Promise<void> {
  if (!config.fleetId || !config.apiUrl) return;
  try {
    const res = await fetch(
      `${config.apiUrl}/fleets/${config.fleetId}/peers`,
      {
        headers: { Authorization: `Bearer ${config.agentToken}` },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return;

    const peers = (await res.json()) as Array<{
      agentId: string;
      role?: string | null;
      peerId: string | null;
      multiaddr: string | null;
      permissionTier: string;
      walletAddress?: string | null;
      chainIds?: number[];
    }>;

    for (const peer of peers) {
      if (peer.peerId && peer.agentId !== config.agentId) {
        peerIdToAgentId.set(peer.peerId, peer.agentId);
        agentIdToPeerId.set(peer.agentId, peer.peerId);
        if (peer.role) {
          agentIdToRole.set(peer.agentId, peer.role);
          for (const alias of roleAliases(peer.role)) {
            peerAliasToAgentId.set(alias, peer.agentId);
          }
        }
        if (peer.walletAddress) agentIdToWalletAddress.set(peer.agentId, peer.walletAddress);
      }
    }
    console.log(`[daemon] fleet peer map updated  ${peerIdToAgentId.size} peer(s)`);

    const manager = peers.find(
      (p) => p.permissionTier === "manager" && p.agentId !== config.agentId && p.peerId,
    );

    if (manager) {
      config.managerAgentId = manager.agentId;
      config.managerPeerId = manager.peerId!;
      console.log(
        `[daemon] manager peer cached  agentId=${manager.agentId}  peerId=${manager.peerId?.slice(0, 16)}…`,
      );
    }
  } catch {
    // Non-fatal
  }
}

// ─── AXL inbox loop ────────────────────────────────────────────────────────

const peerIdToAgentId = new Map<string, string>();
const agentIdToPeerId = new Map<string, string>();
const agentIdToRole = new Map<string, string>();
const peerAliasToAgentId = new Map<string, string>();
const agentIdToWalletAddress = new Map<string, string>();

function parseAxlPayload(raw: string): AxlEnvelope {
  try {
    const parsed = JSON.parse(raw) as AxlEnvelope;
    if (parsed && typeof parsed === "object" && typeof parsed.content === "string") {
      return parsed;
    }
  } catch {}

  return { type: "request", content: raw };
}

function normalizeAxlAlias(value: string): string {
  return value.toLowerCase().trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

function roleAliases(role: string): string[] {
  const compact = normalizeAxlAlias(role);
  return Array.from(new Set([
    compact,
    compact.replace(/\s+agent$/, ""),
    compact.replace(/\s+agent\s+/g, " "),
    compact.replace(/\s+/g, "-"),
    compact.replace(/\s+/g, ""),
  ].filter(Boolean)));
}

function axlPeerDirectory(): string {
  const rows = Array.from(agentIdToPeerId.entries())
    .map(([agentId, peerId]) => {
      const role = agentIdToRole.get(agentId) ?? "unknown role";
      const manager = agentId === config.managerAgentId ? " manager" : "";
      return `| ${role}${manager} | ${agentId} | ${peerId} |`;
    });

  if (rows.length === 0) {
    return "No fleet AXL peers are cached yet. The optional AXL tool refreshes peer discovery only when it is called.";
  }

  return [
    "| Role | Agent ID | AXL peer ID |",
    "|------|----------|-------------|",
    ...rows,
  ].join("\n");
}

function walletDirectory(): string {
  const rows = Array.from(agentIdToWalletAddress.entries())
    .map(([agentId, address]) => {
      const role = agentIdToRole.get(agentId) ?? "unknown role";
      return `| ${role} | ${agentId} | ${address} |`;
    });

  if (rows.length === 0) {
    return "No peer wallets are cached yet. Wallet sends resolve recipients through the CommonOS API at signing time.";
  }

  return [
    "| Role | Agent ID | Wallet |",
    "|------|----------|--------|",
    ...rows,
  ].join("\n");
}

function formatAxlPayload(envelope: Required<Pick<AxlEnvelope, "type" | "content">> & AxlEnvelope): string {
  return JSON.stringify({
    id: envelope.id ?? `axlmsg_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`,
    type: envelope.type,
    fromAgentId: envelope.fromAgentId ?? config.agentId,
    toAgentId: envelope.toAgentId,
    content: envelope.content,
    inReplyTo: envelope.inReplyTo,
    createdAt: new Date().toISOString(),
  });
}

async function startAxlInboxLoop(): Promise<void> {
  console.log("[daemon] AXL inbox loop started");
  while (true) {
    try {
      await pollAxlInbox();
    } catch {
      // Non-fatal
    }
    await sleep(AXL_INBOX_MS);
  }
}

async function pollAxlInbox(): Promise<void> {
  // AXL /recv returns one message per call (204 when queue is empty).
  // Drain all queued messages in a single poll cycle.
  while (true) {
    const res = await fetch(`${AXL_API_URL}/recv`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (res.status === 204) break; // queue empty
    if (!res.ok) break;

    const raw = await res.text();
    const envelope = parseAxlPayload(raw);
    const content = envelope.content ?? "";
    const fromPeerId = res.headers.get("x-from-peer-id") ?? "unknown";

    // Resolve peerId (hex public key) → agentId: fleet cache first, then API.
    let resolvedAgentId = peerIdToAgentId.get(fromPeerId);
    if (!resolvedAgentId && fromPeerId !== "unknown") {
      const resolved = await resolveAgentByName(fromPeerId).catch(() => null);
      if (resolved) {
        resolvedAgentId = resolved.agentId;
        peerIdToAgentId.set(fromPeerId, resolved.agentId);
      }
    }
    const senderLabel = envelope.fromAgentId ?? resolvedAgentId ?? fromPeerId.slice(0, 16);

    console.log(`[daemon] AXL message from ${senderLabel}: ${content.slice(0, 80)}`);

    await agent
      .emit({
        type: "message_recv",
        payload: { fromAgentId: senderLabel, preview: content.slice(0, 100) },
      })
      .catch(() => {});

    if (envelope.type === "response") {
      console.log(`[daemon] AXL response from ${senderLabel}: ${content.slice(0, 120)}`);
      await recordInboundAxlResponse({
        content,
        fromAgentId: resolvedAgentId ?? envelope.fromAgentId,
        axlPeerId: fromPeerId !== "unknown" ? fromPeerId : null,
        axlMessageId: envelope.id ?? null,
        inReplyTo: envelope.inReplyTo ?? null,
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[daemon] AXL response record failed: ${msg}`);
      });
      continue;
    }

    if (content && config.integrationPath !== "guest") {
      await enqueueAxlMessage({
        content,
        fromAgentId: resolvedAgentId ?? envelope.fromAgentId,
        axlPeerId: fromPeerId !== "unknown" ? fromPeerId : null,
        axlMessageId: envelope.id ?? null,
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[daemon] AXL message enqueue failed: ${msg}`);
        const taskDescription = `[AXL from ${senderLabel}]\n${content}`;
        void handleTask(
          { id: `axl_${Date.now()}`, description: taskDescription },
          {
            replyToPeerId: fromPeerId !== "unknown" ? fromPeerId : undefined,
            replyToAgentId: resolvedAgentId ?? envelope.fromAgentId,
            incomingMessageId: envelope.id,
          },
        ).catch(() => {});
      });
    }
  }
}

// ─── World tools ──────────────────────────────────────────────────────────

async function worldMove(room: string, x: number, y: number): Promise<void> {
  worldPos.room = room;
  worldPos.x = x;
  worldPos.y = y;
  await agent
    .emit({ type: "world_move", payload: { room, x, y } })
    .catch((err) => console.warn("[world] move emit failed:", err));
}

async function worldInteract(
  objectId: string,
  action: string,
  room: string,
  x: number,
  y: number,
): Promise<void> {
  await agent
    .emit({ type: "world_interact", payload: { objectId, action, room, x, y } })
    .catch((err) => console.warn("[world] interact emit failed:", err));
  console.log(`[world] interact  obj=${objectId}  action=${action}`);
}

async function worldCreateObject(
  objectType: string,
  room: string,
  x: number,
  y: number,
  label?: string,
): Promise<string> {
  const objectId = `obj_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  await agent
    .emit({ type: "world_create_object", payload: { objectId, objectType, room, x, y, label } })
    .catch((err) => console.warn("[world] create_object emit failed:", err));
  console.log(`[world] created object  type=${objectType}  id=${objectId}  label=${label ?? ""}`);
  return objectId;
}

function workPosition(): { room: string; x: number; y: number } {
  const role = (config.role ?? "").toLowerCase();
  if (role.includes("manager")) return { room: "meeting-room", x: 2, y: 2 };
  if (role.includes("design")) return { room: "design-room", x: 2, y: 2 };
  return { room: "dev-room", x: 3, y: 2 };
}

// ─── AXL outbound ──────────────────────────────────────────────────────────

async function sendAxlMessage(
  toPeerId: string,  // recipient's ed25519 public key (hex), used as X-Destination-Peer-Id
  toAgentId: string,
  content: string,
  options: { type?: "request" | "response"; inReplyTo?: string } = {},
): Promise<void> {
  if (!axlEnabled()) throw new Error("AXL is disabled for this agent");
  const axlMessageId = `axlmsg_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  const res = await fetch(`${AXL_API_URL}/send`, {
    method: "POST",
    headers: { "X-Destination-Peer-Id": toPeerId },
    body: formatAxlPayload({
      id: axlMessageId,
      type: options.type ?? "request",
      fromAgentId: config.agentId,
      toAgentId,
      content,
      inReplyTo: options.inReplyTo,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`AXL send failed: ${res.status}`);

  if ((options.type ?? "request") === "request") {
    await recordOutboundAxlMessage({
      content,
      toAgentId,
      axlPeerId: toPeerId,
      axlMessageId,
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[daemon] AXL outbound record failed: ${msg}`);
    });
  }

  await agent
    .emit({ type: "message_sent", payload: { toAgentId, preview: content.slice(0, 100) } })
    .catch(() => {});

  console.log(`[daemon] AXL message sent → ${toAgentId}  "${content.slice(0, 60)}"`);
}

async function enqueueAxlMessage(body: {
  content: string;
  fromAgentId?: string | null;
  axlPeerId?: string | null;
  axlMessageId?: string | null;
}): Promise<void> {
  const res = await fetch(`${config.apiUrl}/agents/${config.agentId}/messages/axl`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`AXL message enqueue failed: ${res.status}`);
}

async function recordOutboundAxlMessage(body: {
  content: string;
  toAgentId?: string | null;
  axlPeerId?: string | null;
  axlMessageId?: string | null;
}): Promise<void> {
  const res = await fetch(`${config.apiUrl}/agents/${config.agentId}/messages/axl/outbound`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`AXL outbound record failed: ${res.status}`);
}

async function recordInboundAxlResponse(body: {
  content: string;
  fromAgentId?: string | null;
  axlPeerId?: string | null;
  axlMessageId?: string | null;
  inReplyTo?: string | null;
}): Promise<void> {
  const res = await fetch(`${config.apiUrl}/agents/${config.agentId}/messages/axl/response`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`AXL response record failed: ${res.status}`);
}

async function resolveAxlTarget(target: string): Promise<{ agentId: string; peerId: string }> {
  const normalized = target.trim();
  const alias = normalizeAxlAlias(normalized);
  if (!normalized) throw new Error("AXL target is required");

  const wantsManager = /\b(manager|master|lead|fleet\s+(manager|master))\b/i.test(normalized);
  if (wantsManager) {
    if (!config.managerAgentId || !config.managerPeerId) await discoverFleetPeers();
    if (config.managerAgentId && config.managerPeerId) {
      return { agentId: config.managerAgentId, peerId: config.managerPeerId };
    }
  }

  let peerId = agentIdToPeerId.get(normalized);
  if (peerId) return { agentId: normalized, peerId };

  const aliasAgentId = peerAliasToAgentId.get(alias) ?? peerAliasToAgentId.get(alias.replace(/\s+/g, ""));
  if (aliasAgentId) {
    peerId = agentIdToPeerId.get(aliasAgentId);
    if (peerId) return { agentId: aliasAgentId, peerId };
  }

  const resolved = await resolveAgentByName(normalized);
  if (resolved?.agentId && resolved.peerId) {
    peerIdToAgentId.set(resolved.peerId, resolved.agentId);
    agentIdToPeerId.set(resolved.agentId, resolved.peerId);
    return { agentId: resolved.agentId, peerId: resolved.peerId };
  }

  if (resolved?.agentId) {
    peerId = agentIdToPeerId.get(resolved.agentId);
    if (peerId) return { agentId: resolved.agentId, peerId };
  }

  await discoverFleetPeers();
  peerId = agentIdToPeerId.get(normalized);
  if (peerId) return { agentId: normalized, peerId };

  const refreshedAliasAgentId = peerAliasToAgentId.get(alias) ?? peerAliasToAgentId.get(alias.replace(/\s+/g, ""));
  if (refreshedAliasAgentId) {
    peerId = agentIdToPeerId.get(refreshedAliasAgentId);
    if (peerId) return { agentId: refreshedAliasAgentId, peerId };
  }

  const agentId = peerIdToAgentId.get(normalized);
  if (agentId) return { agentId, peerId: normalized };

  throw new Error(`Could not resolve AXL target: ${target}`);
}

// ─── AXL agent resolution ─────────────────────────────────────────────────

async function resolveAgentByName(name: string): Promise<{
  agentId: string;
  multiaddr?: string | null;
  peerId?: string;
  role?: string;
  fleetId?: string;
} | null> {
  try {
    const res = await fetch(
      `${config.apiUrl}/agents/resolve/${encodeURIComponent(name)}`,
      {
        headers: { Authorization: `Bearer ${config.agentToken}` },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      agentId?: string;
      multiaddr?: string;
      peerId?: string;
      role?: string;
      fleetId?: string;
    };
    if (!data.agentId || !data.peerId && !data.multiaddr) return null;
    return data as { agentId: string; multiaddr?: string | null; peerId?: string; role?: string; fleetId?: string };
  } catch {
    return null;
  }
}

// ─── Human message polling loop ───────────────────────────────────────────

async function pollMessages(): Promise<void> {
  console.log("[daemon] message loop started");
  while (true) {
    try {
      const res = await fetch(
        `${config.apiUrl}/agents/${config.agentId}/messages/next`,
        {
          headers: { Authorization: `Bearer ${config.agentToken}` },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (res.status === 200) {
        const msg = await res.json() as {
          id: string;
          content: string;
          messages?: AgcMessage[];
          sessionId?: string | null;
          agcSessionId?: string | null;
          source?: "human" | "axl";
          fromAgentId?: string | null;
          axlPeerId?: string | null;
          axlMessageId?: string | null;
          axlTargetAgentId?: string | null;
          axlTargetPeerId?: string | null;
        };
        if (msg?.id && msg?.content) {
          await handleMessage(msg);
        }
      }
    } catch (err) {
      console.warn("[daemon] message poll error:", err instanceof Error ? err.message : err);
    }
    await sleep(MSG_POLL_MS);
  }
}

async function handleMessage(msg: {
  id: string;
  content: string;
  messages?: AgcMessage[];
  sessionId?: string | null;
  agcSessionId?: string | null;
  source?: "human" | "axl";
  fromAgentId?: string | null;
  axlPeerId?: string | null;
  axlMessageId?: string | null;
  axlTargetAgentId?: string | null;
  axlTargetPeerId?: string | null;
}): Promise<void> {
  console.log(`[daemon] message ${msg.id}: ${msg.content.slice(0, 80)}`);

  await agent.emit({ type: "state_change", payload: { status: "working" } });

  try {
    const deltaStream = createDeltaStream(msg.id);
    await postMessageEvent(msg.id, { type: "message_status", status: "waiting_for_runtime" }).catch(() => {});
    const runResult = await withTimeout(
      executeTask(
        msg.content,
        msg.agcSessionId ?? undefined,
        msg.messages,
        {
          axlTargetAgentId: msg.axlTargetAgentId,
          axlTargetPeerId: msg.axlTargetPeerId,
        },
        {
          onStatus: (status) => postMessageEvent(msg.id, { type: "message_status", status }),
          onDelta: deltaStream.emit,
          onToolCall: (tool) => postMessageEvent(msg.id, { type: "tool_call", tool, label: `waiting on ${toolName(tool)}` }),
        },
      ),
      MESSAGE_RUN_TIMEOUT_MS,
      "agent runtime",
    );
    const response = typeof runResult === "string" ? runResult : runResult.response;
    if (deltaStream.emittedLength() > 0) {
      await deltaStream.flush();
    } else {
      await streamFinalResponse(msg.id, response);
    }

    await fetch(
      `${config.apiUrl}/agents/${config.agentId}/messages/${msg.id}/respond`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.agentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          response,
          ...(typeof runResult === "object" && runResult.agcSessionId ? { agcSessionId: runResult.agcSessionId } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    console.log(`[daemon] message ${msg.id} responded`);

    if (axlAutoMode() && msg.source === "axl" && msg.axlPeerId) {
      await sendAxlMessage(
        msg.axlPeerId,
        msg.fromAgentId ?? msg.axlPeerId.slice(0, 16),
        response,
        { type: "response", inReplyTo: msg.axlMessageId ?? msg.id },
      ).catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`[daemon] AXL response send failed: ${detail}`);
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[daemon] message ${msg.id} error:`, err);
    await markMessageFailed(msg.id, detail).catch((failErr) => {
      console.warn("[daemon] message fail report error:", failErr instanceof Error ? failErr.message : failErr);
    });
  } finally {
    await agent.emit({ type: "state_change", payload: { status: "idle" } });
  }
}

async function markMessageFailed(msgId: string, error: string): Promise<void> {
  const res = await fetch(
    `${config.apiUrl}/agents/${config.agentId}/messages/${msgId}/fail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.agentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new Error(`message fail report failed: ${res.status}`);
}

type MessageEventPayload =
  | { type: "message_status"; status: string }
  | { type: "message_delta"; delta: string }
  | { type: "tool_call" | "tool_result"; tool: string; label?: string };

interface MessageRunHooks {
  onStatus?: (status: string) => Promise<void>;
  onDelta?: (delta: string) => Promise<void>;
  onToolCall?: (tool: string) => Promise<void>;
}

async function postMessageEvent(msgId: string, payload: MessageEventPayload): Promise<void> {
  const res = await fetch(
    `${config.apiUrl}/agents/${config.agentId}/messages/${msgId}/event`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.agentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!res.ok) throw new Error(`message event failed: ${res.status}`);
}

function createDeltaStream(msgId: string): {
  emit: (delta: string) => Promise<void>;
  flush: () => Promise<void>;
  emittedLength: () => number;
} {
  let pending = "";
  let lastFlush = 0;
  let chain = Promise.resolve();
  let emitted = 0;

  async function flush(): Promise<void> {
    if (!pending) return;
    const chunk = pending;
    pending = "";
    lastFlush = Date.now();
    emitted += chunk.length;
    chain = chain
      .then(() => postMessageEvent(msgId, { type: "message_delta", delta: chunk }))
      .catch((err) => console.warn("[daemon] message delta event failed:", err instanceof Error ? err.message : err));
    await chain;
  }

  async function emit(delta: string): Promise<void> {
    if (!delta) return;
    pending += delta;
    const now = Date.now();
    if (now - lastFlush < 250 && pending.length < 240) return;
    await flush();
  }

  return { emit, flush, emittedLength: () => emitted + pending.length };
}

async function streamFinalResponse(msgId: string, response: string): Promise<void> {
  const text = response.trim();
  if (!text) return;
  const chunks = text.match(/[\s\S]{1,180}/g) ?? [text];
  for (const chunk of chunks) {
    await postMessageEvent(msgId, { type: "message_delta", delta: chunk }).catch((err) => {
      console.warn("[daemon] final response stream failed:", err instanceof Error ? err.message : err);
    });
    await sleep(90);
  }
}

// ─── Task polling loop ─────────────────────────────────────────────────────

async function pollTasks() {
  console.log("[daemon] task loop started");

  while (true) {
    try {
      const task = await agent.nextTask();
      if (task) {
        await handleTask(task);
      }
    } catch (err) {
      console.error("[daemon] poll error:", err);
    }
    await sleep(POLL_MS);
  }
}

async function handleTask(
  task: { id: string; description: string },
  axlReply?: { replyToPeerId?: string; replyToAgentId?: string; incomingMessageId?: string },
) {
  if (!task?.id || !task?.description) {
    console.warn(`[daemon] skipping malformed task:`, task);
    return;
  }
  console.log(`[daemon] task ${task.id} — ${task.description}`);

  await agent.emit({ type: "state_change", payload: { status: "working" } });
  await agent.emit({
    type: "task_start",
    payload: { taskId: task.id, description: task.description },
  });
  await agent.emit({ type: "action", payload: { label: truncate(task.description, 50) } });

  const pos = workPosition();
  await worldMove(pos.room, pos.x, pos.y);

  const workObjectId = `${pos.room}-workstation`;
  await worldInteract(workObjectId, truncate(task.description, 40), pos.room, pos.x, pos.y);

  try {
    const runResult = await executeTask(task.description);
    const output = typeof runResult === "string" ? runResult : runResult.response;

    await worldCreateObject("artifact", pos.room, pos.x + 1, pos.y, truncate(task.description, 24));

    await agent.completeTask(task.id, output);
    await agent.emit({ type: "task_complete", payload: { taskId: task.id, output } });

    console.log(`[daemon] task ${task.id} complete`);

    if (axlAutoMode() && axlReply?.replyToPeerId && axlReply.replyToAgentId) {
      await sendAxlMessage(
        axlReply.replyToPeerId,
        axlReply.replyToAgentId,
        output,
        { type: "response", inReplyTo: axlReply.incomingMessageId ?? task.id },
      ).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[daemon] AXL response send failed: ${msg}`);
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await agent.emit({ type: "error", payload: { message: msg } });
    console.error(`[daemon] task ${task.id} failed:`, err);
  } finally {
    await worldMove(worldPos.room, 2, 2).catch(() => {});
    await agent.emit({ type: "state_change", payload: { status: "idle" } });
    await agent.emit({ type: "action", payload: { label: "" } });
  }
}

// ─── Task execution ────────────────────────────────────────────────────────

async function executeTask(
  description: string,
  agcSessionId?: string,
  messages?: AgcMessage[],
  routing?: AxlRoutingContext,
  hooks?: MessageRunHooks,
): Promise<string | { response: string; agcSessionId?: string }> {
  if (config.integrationPath === "openclaw") return await runViaOpenClaw(description, messages, hooks);
  if (config.integrationPath === "hermes") return await runViaHermes(description, messages, hooks);
  if (config.integrationPath === "native") {
    const result = await runViaNative(description, agcSessionId, messages, routing, hooks);

    if (result.response.trim()) return result;

    const markdownFallback = await maybeWriteMarkdownFallback(description, messages);
    if (markdownFallback) return { response: markdownFallback, ...(result.agcSessionId ? { agcSessionId: result.agcSessionId } : {}) };

    return {
      response: "I could not complete that request because the agent runtime returned no output.",
      ...(result.agcSessionId ? { agcSessionId: result.agcSessionId } : {}),
    };
  }
  throw new Error("guest runtime execution is handled by the tenant image");
}

async function maybeWriteMarkdownFallback(description: string, messages?: AgcMessage[]): Promise<string | null> {
  if (!/\b(?:create|save|write|store)\b/i.test(description) || !/\b(?:md|markdown|file)\b/i.test(description)) return null;
  const lastAssistant = [...(messages ?? [])].reverse().find((msg) => msg.role === "assistant" && msg.content.trim());
  if (!lastAssistant?.content) return null;

  const title = lastAssistant.content.match(/^#{1,3}\s+(.+)$/m)?.[1] ?? "agent response";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "agent_response";
  const fileName = `${slug}.md`;
  const abs = workspacePath(fileName);
  writeFileSync(abs, lastAssistant.content.trim() + "\n", "utf-8");
  await emitWorkspaceSnapshot().catch(() => {});
  return `Saved markdown file to ${abs}`;
}

// ─── Workspace snapshot & filesystem manifest ──────────────────────────────
// Builds a live directory tree that is injected into every prompt so the agent
// knows exactly what files exist in its workspace.

const SNAP_SKIP = new Set([".git", "node_modules", ".cache", "__pycache__", ".next", "dist", "build"]);

function buildWorkspaceSnapshot(dir: string, maxDepth = 2): string {
  const lines: string[] = [`${dir}/`];

  function walk(d: string, depth: number, prefix: string) {
    if (lines.length >= 200) return;
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = readdirSync(d, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (lines.length >= 200) { lines.push(`${prefix}... (truncated)`); return; }
      if (entry.name.startsWith(".") || SNAP_SKIP.has(entry.name)) continue;
      const isDir = entry.isDirectory();
      lines.push(`${prefix}${entry.name}${isDir ? "/" : ""}`);
      if (isDir && depth < maxDepth) walk(join(d, entry.name), depth + 1, prefix + "  ");
    }
  }

  walk(dir, 1, "  ");
  return lines.join("\n");
}

function cleanAgcOutput(raw: string): string {
  const clean = stripAnsi(raw);
  return clean
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      // Drop tool-status lines printed by agc streaming: "  ─ write_file  ✓  (0.3s)"
      if (/^\s*[─-]\s+\S/.test(t) && (/\([\d.]+s\)/.test(t) || /✓|✗|✘/.test(t))) return false;
      // Drop the session footer: "Session: xxx  (resume with: …)"
      if (/^Session\s*:/i.test(t) && /resume with/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

function buildRunPrompt(description: string, messages?: AgcMessage[], routing?: AxlRoutingContext): string {
  const routingContext = buildAxlRoutingPromptContext(routing);
  if (!messages || messages.length <= 1) {
    return [buildCliContext(), orchestrationContext(), routingContext, description].filter(Boolean).join("\n\n");
  }

  const transcript = messages
    .slice(-12)
    .map((msg) => `${msg.role === "assistant" ? "Assistant" : "User"}: ${msg.content}`)
    .join("\n\n");

  return [
    buildCliContext(),
    orchestrationContext(),
    routingContext,
    "",
    "Continue this CommonOS conversation. Use the prior turns as context, but answer only the latest user request.",
    "",
    transcript,
  ].join("\n");
}

function buildAxlRoutingPromptContext(routing?: AxlRoutingContext): string {
  if (!routing?.axlTargetAgentId && !routing?.axlTargetPeerId) return "";
  return [
    "### Optional AXL Target",
    "The request includes a CommonOS P2P target. Use `cli_send_axl_message` only when the user explicitly asks to use CommonOS P2P/AXL or clearly asks this agent to message another CommonOS agent through the fleet network.",
    "When normal chat, OpenClaw connectors, or human-facing channels are more appropriate, respond normally and do not call the AXL tool.",
    `Target agentId: ${routing.axlTargetAgentId ?? "(unknown)"}`,
    `Target AXL peerId: ${routing.axlTargetPeerId ?? "(unknown)"}`,
  ].join("\n");
}

// ─── Tool catalog ───────────────────────────────────────────────────────────
//
// Single source of truth for every tool this pod can execute. Adding a new
// pod capability (another app, another wallet action, etc.) means: add a
// catalog entry here, add its `if (tool === "...")` branch in
// executeLocalTool, and it is immediately available everywhere a daemon
// reaches an LLM — the native cli_tool_request schema sent to AGC, the
// OpenClaw/Hermes `tools` param, the generic pod-local HTTP tools API, and
// the generated docs in buildCliContext. No other repo needs to change.

type ToolCatalogEntry = { name: string; description: string; parameters: Record<string, unknown> };

const TOOL_CATALOG: ToolCatalogEntry[] = [
  { name: "list_directory", description: "List files and folders at a path in this pod's workspace. Defaults to the session root.", parameters: { type: "object", properties: { path: { type: "string", description: "Directory path relative to session root (default: session root)" } }, required: [] } },
  { name: "read_file", description: "Read the full contents of a file in this pod's workspace.", parameters: { type: "object", properties: { path: { type: "string", description: "File path relative to session root" } }, required: ["path"] } },
  { name: "write_file", description: "Write or overwrite a file in this pod's workspace. Creates parent directories if needed.", parameters: { type: "object", properties: { path: { type: "string", description: "File path relative to session root" }, content: { type: "string", description: "Content to write" } }, required: ["path", "content"] } },
  { name: "search_files", description: "Find files matching a glob-style pattern in this pod's workspace. Returns up to 50 matches.", parameters: { type: "object", properties: { pattern: { type: "string", description: "Glob-style filename pattern (e.g. \"*.ts\")" }, directory: { type: "string", description: "Directory to search (default: session root)" } }, required: ["pattern"] } },
  { name: "run_command", description: "Run a short shell command (up to 5 minutes) in this pod's workspace and return its output. Use this for node, npm, npx, pnpm, git, tests, build scripts, and dev servers.", parameters: { type: "object", properties: { command: { type: "string", description: "Command to run, e.g. node, npm, npx, sh, git" }, args: { type: "array", items: { type: "string" }, description: "Arguments array, e.g. [\"--version\"] or [\"create\", \"vite@latest\", \"site\", \"--\", \"--template\", \"react-ts\"]" }, cwd: { type: "string", description: "Working directory (default: session root)" }, timeout_seconds: { type: "number", description: "Max seconds to wait (default 120, max 300)" } }, required: ["command"] } },
  { name: "start_process", description: "Start a long-running process such as a Next.js/Vite dev server and keep it alive in the pod. Returns a process id and recent logs.", parameters: { type: "object", properties: { id: { type: "string", description: "Optional stable process id, e.g. \"dev-server\"" }, command: { type: "string", description: "Command to run, e.g. npm, pnpm, bun, node" }, args: { type: "array", items: { type: "string" }, description: "Arguments array, e.g. [\"run\", \"dev\", \"--\", \"--host\", \"0.0.0.0\", \"--port\", \"3000\"]" }, cwd: { type: "string", description: "Working directory (default: session root)" }, wait_seconds: { type: "number", description: "Seconds to collect startup logs before returning (default 3, max 15)" } }, required: ["command"] } },
  { name: "process_status", description: "List managed long-running processes or show one process with recent stdout/stderr logs.", parameters: { type: "object", properties: { id: { type: "string", description: "Optional process id returned by start_process" } }, required: [] } },
  { name: "stop_process", description: "Stop a managed long-running process by id.", parameters: { type: "object", properties: { id: { type: "string", description: "Process id returned by start_process" } }, required: ["id"] } },
  { name: "browser_open", description: "Launch this pod's shared Chromium browser and navigate to a URL.", parameters: { type: "object", properties: { url: { type: "string", description: "URL to open" } }, required: ["url"] } },
  { name: "browser_wait", description: "Wait until the shared browser page is interactive/complete, then return URL, title, and screenshot status.", parameters: { type: "object", properties: { timeout_seconds: { type: "number", description: "Max seconds to wait (default 20, max 60)" } }, required: [] } },
  { name: "browser_eval", description: "Evaluate JavaScript in the shared browser page and return the JSON-serializable result. Use this to inspect rendered text, errors, selectors, and client state.", parameters: { type: "object", properties: { expression: { type: "string", description: "JavaScript expression or async IIFE to evaluate in the page" }, timeout_seconds: { type: "number", description: "Max seconds to wait (default 10, max 30)" } }, required: ["expression"] } },
  { name: "browser_status", description: "Return the shared browser's on/off state, current URL, page title, and latest screenshot.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "browser_screenshot", description: "Refresh and return the latest screenshot of the shared browser.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "browser_click", description: "Click a coordinate in the shared browser's viewport.", parameters: { type: "object", properties: { x: { type: "number", description: "X coordinate" }, y: { type: "number", description: "Y coordinate" } }, required: ["x", "y"] } },
  { name: "browser_type", description: "Type text into the focused element, or into a CSS selector, in the shared browser.", parameters: { type: "object", properties: { text: { type: "string", description: "Text to type" }, selector: { type: "string", description: "Optional CSS selector to type into" } }, required: ["text"] } },
  { name: "browser_close", description: "Close the shared browser.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "send_axl_message", description: "Send a CommonOS fleet message over AXL/P2P. Only use when explicitly requested — OpenClaw/channel connectors are the normal messaging surface.", parameters: { type: "object", properties: { target: { type: "string", description: "Agent id, AXL peer id, role/name like Pumba, fleet manager, or fleet master" }, content: { type: "string", description: "Message to send" } }, required: ["target", "content"] } },
  { name: "wallet_address", description: "Return this agent's wallet address.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "wallet_balance", description: "Return this agent's Base Sepolia wallet balance.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "wallet_send_transaction", description: "Request a policy-checked wallet transaction signed by CommonOS/Privy. Pass the recipient alias when the user names another CommonOS agent — the API resolves the wallet again at signing time.", parameters: { type: "object", properties: { recipient: { type: "string", description: "Agent role/name like Sammy, @Sammy, agent id, or 0x address" }, valueEth: { type: "string", description: "Amount in ETH, e.g. \"0.001\"" }, valueWei: { type: "string", description: "Amount in wei (alternative to valueEth)" }, chainId: { type: "number", description: "Chain id (default: agent's configured chain)" }, data: { type: "string", description: "Optional raw call data" } }, required: ["recipient"] } },
];

function toolCatalogEntry(name: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG.find((entry) => entry.name === name);
}

// JSON-schema function defs, cli_-prefixed, for any consumer that binds
// tools to an LLM (AGC's dynamic cliTools, OpenClaw/Hermes `tools` param).
function cliToolDefs(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return TOOL_CATALOG.map((entry) => ({ name: `cli_${entry.name}`, description: entry.description, parameters: entry.parameters }));
}

function buildCliContext(): string {
  const toolTable = TOOL_CATALOG.map((entry) => `| \`cli_${entry.name}\` | ${entry.description} |`).join("\n");
  return `
## CLI Local Tools - ACTIVE

You are running inside a CommonOS agent pod with DIRECT access to this pod's workspace. The following cli_* tools are in your tool list and execute inside the pod in real time.

**Session root:** ${WORKSPACE_DIR}
**Agent wallet:** ${config.walletAddress || "(not provisioned yet)"}
**Default chain:** Base Sepolia (${config.walletChainId || 84532})

### Current file system (live snapshot)

\`\`\`
${buildWorkspaceSnapshot(WORKSPACE_DIR)}
\`\`\`

### MANDATORY RULES - READ CAREFULLY

1. **Call cli_* tools immediately and directly.** Do not create Agent Commons tasks for pod file operations or CommonOS fleet messaging.
2. **Use AXL only when explicitly requested.** OpenClaw and channel connectors are normal messaging surfaces; do not route those conversations through AXL unless the user specifically asks for CommonOS P2P/AXL.
3. File operations are sandboxed to the session root. Return the actual path or command output after using a tool.
4. For markdown file requests, write the .md file with \`cli_write_file\` and return its path.
5. For website, app, package, build, install, test, or localhost/dev-server requests, use \`cli_run_command\` for finite commands and \`cli_start_process\` for dev servers that must stay alive. Standard agent pods include Node.js, npm, npx, pnpm, bun, and git unless a command check proves otherwise.
6. Never say npm, node, npx, git, package managers, files, terminal commands, or localhost are unavailable until you have called \`cli_run_command\` to verify, such as \`node --version\`, \`npm --version\`, \`which npm\`, or the requested command itself.
7. If the user asks you to create and run an app/site, create the files, install dependencies as needed, start the dev server with \`cli_start_process\`, open it with \`cli_browser_open\`, inspect it with \`cli_browser_wait\`, \`cli_browser_eval\`, and screenshots, then fix any errors and re-check before reporting the localhost URL.

### Available CLI tools

| Tool | What it does |
|------|-------------|
${toolTable}

### cli_run_command examples

\`\`\`json
{"command":"node","args":["--version"]}
{"command":"npm","args":["--version"]}
{"command":"npm","args":["create","vite@latest","site","--","--template","react-ts"]}
{"command":"npm","args":["install"],"cwd":"site","timeout_seconds":300}
\`\`\`

### cli_start_process + browser verification examples

\`\`\`json
{"id":"next-dev","command":"npm","args":["run","dev","--","--hostname","0.0.0.0","--port","3000"],"cwd":"next-site","wait_seconds":5}
{"id":"vite-dev","command":"npm","args":["run","dev","--","--host","0.0.0.0","--port","3000"],"cwd":"vite-site","wait_seconds":5}
{"url":"http://127.0.0.1:3000"}
{"timeout_seconds":30}
{"expression":"({ title: document.title, text: document.body.innerText.slice(0, 2000), errors: Array.from(document.querySelectorAll('nextjs-portal')).map(e => e.textContent) })"}
\`\`\`

### Cached AXL peers in this fleet

${axlPeerDirectory()}

### Cached fleet wallets

${walletDirectory()}
`.trim();
}

function agcHeaders(): Record<string, string> {
  const key = config.commonsApiKey ?? "";
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
    "x-api-key": key,
    ...(AGC_INITIATOR ? { "x-initiator": AGC_INITIATOR } : {}),
  };
}

function workspacePath(userPath = "."): string {
  const target = resolve(WORKSPACE_DIR, userPath);
  const rel = relative(WORKSPACE_DIR, target);
  if (rel.startsWith("..") || rel === ".." || target !== WORKSPACE_DIR && relative(WORKSPACE_DIR, target).startsWith(`..`)) {
    throw new Error(`Path escapes workspace: ${userPath}`);
  }
  return target;
}

function toolName(name: unknown): string {
  return String(name ?? "").replace(/^cli_/, "");
}

function appendTail(existing: string, chunk: string, max = 12_000): string {
  return `${existing}${chunk}`.slice(-max);
}

function boundedSeconds(value: unknown, fallback: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

async function collectProcessStream(
  managed: ManagedProcess,
  stream: ReadableStream<Uint8Array> | null | undefined,
  key: "stdoutTail" | "stderrTail",
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) managed[key] = appendTail(managed[key], decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    managed[key] = appendTail(managed[key], `\n[log stream failed: ${err instanceof Error ? err.message : String(err)}]`);
  }
}

function managedProcessStatus(managed: ManagedProcess): string {
  const relCwd = relative(WORKSPACE_DIR, managed.cwd) || ".";
  return [
    `id=${managed.id}`,
    `command=${[managed.command, ...managed.args].join(" ")}`,
    `cwd=${relCwd}`,
    `startedAt=${managed.startedAt}`,
    `status=${managed.exitCode === null ? "running" : `exited ${managed.exitCode}`}`,
    managed.stdoutTail.trim() ? `--- stdout tail ---\n${managed.stdoutTail.trim()}` : "",
    managed.stderrTail.trim() ? `--- stderr tail ---\n${managed.stderrTail.trim()}` : "",
  ].filter(Boolean).join("\n");
}

async function stopManagedProcess(id: string): Promise<string> {
  const managed = managedProcesses.get(id);
  if (!managed) throw new Error(`managed process not found: ${id}`);
  if (managed.exitCode === null) {
    managed.proc.kill();
    await Promise.race([managed.proc.exited, sleep(5_000)]).catch(() => {});
  }
  managedProcesses.delete(id);
  return `Stopped process ${id}.`;
}

async function executeLocalTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = toolName(name);
  console.log(`[daemon] cli tool request: ${tool}`);

  if (tool === "read_file") {
    const filePath = String(args.path ?? "");
    if (!filePath) throw new Error('read_file requires "path"');
    const abs = workspacePath(filePath);
    const st = statSync(abs);
    if (st.isDirectory()) throw new Error(`${filePath} is a directory`);
    if (st.size > 500_000) throw new Error(`${filePath} is too large to read`);
    return readFileSync(abs, "utf-8");
  }

  if (tool === "write_file") {
    const filePath = String(args.path ?? "");
    if (!filePath) throw new Error('write_file requires "path"');
    const content = String(args.content ?? "");
    const abs = workspacePath(filePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf-8");
    await emitWorkspaceSnapshot().catch(() => {});
    return `Written ${content.length} bytes to ${filePath}`;
  }

  if (tool === "list_directory") {
    const dirPath = String(args.path ?? ".");
    const abs = workspacePath(dirPath);
    const entries = readdirSync(abs, { withFileTypes: true });
    return entries
      .map((entry) => `[${entry.isDirectory() ? "d" : "f"}] ${entry.name}`)
      .join("\n") || "(empty directory)";
  }

  if (tool === "search_files") {
    const pattern = String(args.pattern ?? "");
    if (!pattern) throw new Error('search_files requires "pattern"');
    const base = workspacePath(String(args.directory ?? "."));
    const regex = new RegExp(pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."), "i");
    const results: string[] = [];
    const walk = (dir: string, depth = 0) => {
      if (depth > 8 || results.length >= 50) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const full = join(dir, entry.name);
        const rel = relative(WORKSPACE_DIR, full);
        if (regex.test(entry.name) || regex.test(rel)) results.push(rel);
        if (entry.isDirectory()) walk(full, depth + 1);
      }
    };
    walk(base);
    return results.join("\n") || `No files found matching: ${pattern}`;
  }

  if (tool === "run_command") {
    const command = String(args.command ?? "");
    const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
    if (!command) throw new Error('run_command requires "command"');
    const cwd = args.cwd ? workspacePath(String(args.cwd)) : WORKSPACE_DIR;
    const proc = Bun.spawn([command, ...cmdArgs], { cwd, stdout: "pipe", stderr: "pipe" });
    const timeoutMs = Math.min(Number(args.timeout_seconds ?? 120) * 1000, 300_000);
    let timedOut = false;
    const code = await Promise.race([
      proc.exited,
      sleep(timeoutMs).then(() => {
        timedOut = true;
        proc.kill();
        return -1;
      }),
    ]);
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return [
      stdout.trim(),
      stderr.trim() ? `--- stderr ---\n${stderr.trim()}` : "",
      timedOut ? `(command timed out after ${timeoutMs / 1000}s)` : `(exit code ${code})`,
    ].filter(Boolean).join("\n") || "(no output)";
  }

  if (tool === "start_process") {
    const command = String(args.command ?? "");
    const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
    if (!command) throw new Error('start_process requires "command"');
    const id = String(args.id ?? `proc_${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_.-]/g, "-");
    const cwd = args.cwd ? workspacePath(String(args.cwd)) : WORKSPACE_DIR;
    if (managedProcesses.has(id)) {
      await stopManagedProcess(id);
    }
    const proc = Bun.spawn([command, ...cmdArgs], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOST: process.env.HOST ?? "0.0.0.0",
      },
    });
    const managed: ManagedProcess = {
      id,
      command,
      args: cmdArgs,
      cwd,
      proc,
      startedAt: new Date().toISOString(),
      exitCode: null,
      stdoutTail: "",
      stderrTail: "",
    };
    managedProcesses.set(id, managed);
    void collectProcessStream(managed, proc.stdout, "stdoutTail");
    void collectProcessStream(managed, proc.stderr, "stderrTail");
    void proc.exited.then((code) => {
      managed.exitCode = code;
      console.log(`[daemon] managed process ${id} exited with ${code}`);
    });
    await sleep(boundedSeconds(args.wait_seconds, 3, 15) * 1000);
    return managedProcessStatus(managed);
  }

  if (tool === "process_status") {
    const id = args.id !== undefined ? String(args.id) : "";
    if (id) {
      const managed = managedProcesses.get(id);
      if (!managed) throw new Error(`managed process not found: ${id}`);
      return managedProcessStatus(managed);
    }
    if (managedProcesses.size === 0) return "No managed processes.";
    return Array.from(managedProcesses.values()).map(managedProcessStatus).join("\n\n");
  }

  if (tool === "stop_process") {
    const id = String(args.id ?? "");
    if (!id) throw new Error('stop_process requires "id"');
    return await stopManagedProcess(id);
  }

  if (tool === "browser_open") {
    const url = String(args.url ?? "");
    if (!url) throw new Error('browser_open requires "url"');
    await ensureBrowser(url);
    await sleep(1_000);
    const status = await browserSnapshot(`open ${url}`);
    await emitBrowserStatus(status);
    return [
      `Browser is ${status.status}.`,
      `url=${status.url ?? url}`,
      `title=${status.title ?? ""}`,
      status.screenshot ? "screenshot=available in CommonOS UI" : "",
    ].filter(Boolean).join("\n");
  }

  if (tool === "browser_wait") {
    const timeoutMs = boundedSeconds(args.timeout_seconds, 20, 60) * 1000;
    await ensureBrowser();
    await waitForBrowserReady(timeoutMs);
    const status = await browserSnapshot("wait");
    await emitBrowserStatus(status);
    return [
      `Browser is ${status.status}.`,
      `url=${status.url ?? ""}`,
      `title=${status.title ?? ""}`,
      status.screenshot ? "screenshot=available in CommonOS UI" : "",
    ].filter(Boolean).join("\n");
  }

  if (tool === "browser_eval") {
    const expression = String(args.expression ?? "");
    if (!expression) throw new Error('browser_eval requires "expression"');
    const timeoutMs = boundedSeconds(args.timeout_seconds, 10, 30) * 1000;
    const value = await browserEvaluate(expression, timeoutMs);
    return formatBrowserValue(value);
  }

  if (tool === "browser_status") {
    const status = await browserSnapshot("status");
    await emitBrowserStatus(status);
    return [
      `Browser is ${status.status}.`,
      status.url ? `url=${status.url}` : "",
      status.title ? `title=${status.title}` : "",
      status.lastAction ? `lastAction=${status.lastAction}` : "",
      status.error ? `error=${status.error}` : "",
      status.screenshot ? "screenshot=available in CommonOS UI" : "",
    ].filter(Boolean).join("\n");
  }

  if (tool === "browser_screenshot") {
    await ensureBrowser();
    const status = await browserSnapshot("screenshot");
    await emitBrowserStatus(status);
    return [
      `Captured browser screenshot.`,
      `url=${status.url ?? ""}`,
      `title=${status.title ?? ""}`,
      "screenshot=available in CommonOS UI",
    ].join("\n");
  }

  if (tool === "browser_click") {
    const x = Number(args.x);
    const y = Number(args.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('browser_click requires numeric "x" and "y"');
    await ensureBrowser();
    await cdpSend("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, browserSessionId);
    await cdpSend("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, browserSessionId);
    await sleep(500);
    const status = await browserSnapshot(`click ${Math.round(x)},${Math.round(y)}`);
    await emitBrowserStatus(status);
    return `Clicked browser at ${Math.round(x)},${Math.round(y)}. url=${status.url ?? ""}`;
  }

  if (tool === "browser_type") {
    const text = String(args.text ?? "");
    const selector = args.selector !== undefined ? String(args.selector) : "";
    if (!text) throw new Error('browser_type requires "text"');
    await ensureBrowser();
    if (selector) {
      await cdpSend("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("selector not found"); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
        awaitPromise: true,
        returnByValue: true,
      }, browserSessionId);
    } else {
      await cdpSend("Input.insertText", { text }, browserSessionId);
    }
    const status = await browserSnapshot(selector ? `type into ${selector}` : "type");
    await emitBrowserStatus(status);
    return `Typed ${text.length} characters${selector ? ` into ${selector}` : ""}.`;
  }

  if (tool === "browser_close") {
    await closeBrowser();
    return "Browser closed.";
  }

  if (tool === "send_axl_message") {
    const target = String(args.target ?? args.toAgentId ?? args.agentId ?? args.peerId ?? "");
    const content = String(args.content ?? args.message ?? "");
    if (!target) throw new Error('send_axl_message requires "target"');
    if (!content) throw new Error('send_axl_message requires "content"');

    const resolved = await resolveAxlTarget(target);
    await sendAxlMessage(resolved.peerId, resolved.agentId, content, { type: "request" });

    return [
      `Sent via AXL to ${resolved.agentId}.`,
      `peerId=${resolved.peerId}`,
      `content=${content}`,
    ].join("\n");
  }

  if (tool === "wallet_address") {
    return config.walletAddress || "Wallet not provisioned yet";
  }

  if (tool === "wallet_balance") {
    const res = await fetch(`${config.apiUrl}/fleets/${config.fleetId}/agents/${config.agentId}/wallet`, {
      headers: { Authorization: `Bearer ${config.agentToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`wallet balance lookup failed: ${res.status}`);
    const data = await res.json() as {
      address?: string;
      balances?: Array<{ chainId: number; formatted?: string | null; balanceWei?: string | null; symbol?: string; rpcConfigured?: boolean; error?: string }>;
    };
    const balances = data.balances ?? [];
    if (balances.length === 0) return `${data.address ?? config.walletAddress}: no balances available`;
    return balances.map((b) => {
      const amount = b.formatted ?? (b.balanceWei ? `${b.balanceWei} wei` : "unavailable");
      const suffix = b.error ? ` (${b.error})` : (b.rpcConfigured === false ? " (RPC not configured)" : "");
      return `chain ${b.chainId}: ${amount} ${b.symbol ?? "ETH"}${suffix}`;
    }).join("\n");
  }

  if (tool === "wallet_send_transaction") {
    const recipient = String(args.recipient ?? args.to ?? args.target ?? "");
    const valueEth = args.valueEth !== undefined ? String(args.valueEth) : undefined;
    const valueWei = args.valueWei !== undefined ? String(args.valueWei) : undefined;
    const chainId = Number(args.chainId ?? config.walletChainId ?? 84532);
    const data = args.data !== undefined ? String(args.data) : undefined;
    if (!recipient) throw new Error('wallet_send_transaction requires "recipient"');
    if (!valueEth && !valueWei) throw new Error('wallet_send_transaction requires "valueEth" or "valueWei"');

    const res = await fetch(`${config.apiUrl}/agents/${config.agentId}/wallet/send-transaction`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.agentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient, valueEth, valueWei, chainId, data }),
      signal: AbortSignal.timeout(30_000),
    });
    const response = await res.json().catch(() => null) as {
      txHash?: string | null;
      status?: string;
      toAddress?: string;
      toAgentId?: string | null;
      valueWei?: string;
      error?: string;
    } | null;
    if (!res.ok) throw new Error(response?.error ?? `wallet transaction failed: ${res.status}`);
    return [
      `Wallet transaction ${response?.status ?? "submitted"}.`,
      response?.txHash ? `txHash=${response.txHash}` : "",
      response?.toAgentId ? `toAgentId=${response.toAgentId}` : "",
      response?.toAddress ? `to=${response.toAddress}` : "",
      response?.valueWei ? `valueWei=${response.valueWei}` : "",
      response?.error ? `error=${response.error}` : "",
    ].filter(Boolean).join("\n");
  }

  return `Unsupported local tool: ${name}`;
}

async function postCliToolResult(requestId: string, result: string): Promise<void> {
  const res = await fetch(`${AGC_BASE_URL}/v1/agents/cli-tool-result`, {
    method: "POST",
    headers: agcHeaders(),
    body: JSON.stringify({ requestId, result }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[daemon] cli-tool-result failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

function finalTextFromEvent(event: Record<string, unknown>): string | null {
  const payload = (event.payload && typeof event.payload === "object" ? event.payload : event) as Record<string, unknown>;
  const value = payload.response ?? payload.content ?? payload.text ?? payload.message ?? null;
  return typeof value === "string" ? value : null;
}

function sessionIdFromEvent(event: Record<string, unknown>): string | null {
  const payload = (event.payload && typeof event.payload === "object" ? event.payload : event) as Record<string, unknown>;
  const id = payload.sessionId ?? payload.session_id ?? null;
  return typeof id === "string" ? id : null;
}

function numberFrom(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return 0;
}

function tokenUsageFromEvent(
  event: Record<string, unknown>,
  defaults: { provider?: string; model?: string; source: string },
): TokenUsagePayload | null {
  const payload = (event.payload && typeof event.payload === "object" ? event.payload : event) as Record<string, unknown>;
  const usage = (payload.usage && typeof payload.usage === "object" ? payload.usage : payload) as Record<string, unknown>;
  const inputDetails = (usage.input_token_details && typeof usage.input_token_details === "object"
    ? usage.input_token_details
    : usage.inputTokenDetails && typeof usage.inputTokenDetails === "object"
      ? usage.inputTokenDetails
      : {}) as Record<string, unknown>;
  const promptDetails = (usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
    ? usage.prompt_tokens_details
    : usage.promptTokenDetails && typeof usage.promptTokenDetails === "object"
      ? usage.promptTokenDetails
      : {}) as Record<string, unknown>;

  const inputTokens = numberFrom(
    usage.inputTokens,
    usage.input_tokens,
    usage.prompt_tokens,
  );
  const outputTokens = numberFrom(
    usage.outputTokens,
    usage.output_tokens,
    usage.completion_tokens,
  );
  const cachedInputTokens = Math.min(inputTokens, numberFrom(
    usage.cachedInputTokens,
    usage.cachedTokens,
    usage.cached_tokens,
    usage.cache_read_input_tokens,
    inputDetails.cache_read,
    inputDetails.cacheRead,
    inputDetails.cache_read_input_tokens,
    promptDetails.cached_tokens,
  ));

  if (inputTokens + outputTokens === 0) return null;

  return {
    provider: typeof payload.provider === "string" ? payload.provider : defaults.provider,
    model: typeof payload.model === "string"
      ? payload.model
      : typeof payload.modelId === "string"
        ? payload.modelId
        : defaults.model,
    source: defaults.source,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    requestCount: numberFrom(usage.requestCount, usage.request_count) || 1,
  };
}

async function emitTokenUsage(payload: TokenUsagePayload): Promise<void> {
  await agent.emit({ type: "token_usage", payload }).catch((err) => {
    console.warn("[daemon] token usage emit failed:", err instanceof Error ? err.message : String(err));
  });
}

// ─── Native execution via Agent Commons stream ─────────────────────────────
// Mirrors `agc run --local --yes` inside the daemon so world UI messages can
// execute pod-local filesystem and command tools without depending on an
// external runner process or opaque CLI subprocess behavior.

async function runViaNative(
  description: string,
  agcSessionId?: string,
  messages?: AgcMessage[],
  routing?: AxlRoutingContext,
  hooks?: MessageRunHooks,
): Promise<{ response: string; agcSessionId?: string; axlToolCalled: boolean }> {
  const sessionIdToUse = agcSessionId ?? agentSessionId;
  const agentId = config.commonsAgentId || config.agentId;
  const prompt = buildRunPrompt(description, messages, routing);

  console.log(
    `[daemon] agc stream  runtime=${DAEMON_RUNTIME}  agent=${agentId.slice(0, 12)}  session=${sessionIdToUse?.slice(0, 12) ?? "new"}  history=${messages?.length ?? 0}`,
  );

  const body = {
    agentId,
    ...(sessionIdToUse ? { sessionId: sessionIdToUse } : {}),
    messages: [{ role: "user", content: prompt }],
    cliContext: buildCliContext(),
    cliTools: cliToolDefs(),
    ...(AGC_INITIATOR ? { initiatorId: AGC_INITIATOR } : {}),
  };

  const res = await fetch(`${AGC_BASE_URL}/v1/agents/run/stream`, {
    method: "POST",
    headers: agcHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Agent Commons stream failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let output = "";
  let finalText: string | null = null;
  let observedSessionId: string | null = sessionIdToUse ?? null;
  let toolRequestCount = 0;
  let axlToolCalled = false;
  let observedUsage: TokenUsagePayload | null = null;

  async function handleEvent(raw: string): Promise<void> {
    const line = raw.trim();
    if (!line || line === "[DONE]") return;
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!payload || payload === "[DONE]") return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }

    const maybeSessionId = sessionIdFromEvent(event);
    if (maybeSessionId) observedSessionId = maybeSessionId;
    const maybeUsage = tokenUsageFromEvent(event, {
      provider: "agent-commons",
      model: undefined,
      source: "agent-commons-stream",
    });
    if (maybeUsage) observedUsage = maybeUsage;

    if (event.type === "token" && typeof event.content === "string") {
      output += event.content;
      await hooks?.onDelta?.(event.content).catch(() => {});
      return;
    }

    if (event.type === "cli_tool_request") {
      toolRequestCount += 1;
      const requestId = typeof event.requestId === "string" ? event.requestId : "";
      const requestedTool = String(event.tool ?? "");
      await hooks?.onToolCall?.(requestedTool).catch(() => {});
      if (toolName(requestedTool) === "send_axl_message") axlToolCalled = true;
      const args = (event.args && typeof event.args === "object" ? event.args : {}) as Record<string, unknown>;
      let result: string;
      try {
        result = await executeLocalTool(requestedTool, args);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (requestId) await postCliToolResult(requestId, result);
      return;
    }

    if (event.type === "final" || event.type === "done" || event.type === "completed") {
      finalText = finalTextFromEvent(event) ?? finalText;
    }
  }

  let streamDone = false;
  while (!streamDone) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      await handleEvent(line);
      if (/^\s*data:\s*(?:\[DONE\]|{"type":"(?:final|completed)")/.test(line)) {
        streamDone = true;
        break;
      }
    }
    if (done) break;
  }

  if (observedSessionId && observedSessionId !== agentSessionId) {
    agentSessionId = observedSessionId;
    try {
      writeFileSync(SESSION_FILE, JSON.stringify({ sessionId: observedSessionId, agentId: config.commonsAgentId }));
    } catch {}
    void registerSessionWithApi().catch(() => {});
    console.log(`[daemon] session persisted: ${observedSessionId}`);
  }
  if (observedUsage) await emitTokenUsage(observedUsage);

  const response = cleanAgcOutput(finalText ?? output);
  console.log(
    `[daemon] agc stream done  runtime=${DAEMON_RUNTIME}  length=${response.length}  tools=${toolRequestCount}  axl=${axlToolCalled}  session=${observedSessionId?.slice(0, 12) ?? "none"}`,
  );
  return { response, axlToolCalled, ...(observedSessionId ? { agcSessionId: observedSessionId } : {}) };
}

async function runViaOpenClaw(description: string, messages?: AgcMessage[], hooks?: MessageRunHooks): Promise<string> {
  const message = buildRunPrompt(description, messages);
  await hooks?.onStatus?.("waiting_for_openclaw").catch(() => {});
  await waitForOpenClawGateway();

  return await runResponsesConversation({
    gatewayUrl: `${config.openclawGatewayUrl}/v1/responses`,
    headers: { "Content-Type": "application/json" },
    body: {
      model: `openclaw/${config.agentId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      input: message,
      user: `commonos:${config.fleetId}:${config.agentId}`,
    },
    hooks,
    usageDefaults: {
      provider: process.env.OPENCLAW_MODEL_PROVIDER ?? "openclaw",
      model: process.env.OPENCLAW_MODEL_ID,
      source: "openclaw-stream",
    },
    timeoutMs: OPENCLAW_RESPONSE_TIMEOUT_MS,
    gatewayLabel: "OpenClaw gateway",
  });
}

async function runViaHermes(description: string, messages?: AgcMessage[], hooks?: MessageRunHooks): Promise<string> {
  const message = buildRunPrompt(description, messages);
  await hooks?.onStatus?.("waiting_for_hermes").catch(() => {});
  await waitForHermesGateway();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const gatewayKey = process.env.HERMES_GATEWAY_API_KEY;
  if (gatewayKey) headers.Authorization = `Bearer ${gatewayKey}`;

  return await runResponsesConversation({
    gatewayUrl: `${config.hermesGatewayUrl}/v1/responses`,
    headers,
    body: {
      model: process.env.HERMES_MODEL_ID ?? `hermes/${config.agentId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      input: message,
      user: `commonos:${config.fleetId}:${config.agentId}`,
    },
    hooks,
    usageDefaults: {
      provider: process.env.HERMES_MODEL_PROVIDER ?? "hermes",
      model: process.env.HERMES_MODEL_ID,
      source: "hermes-stream",
    },
    timeoutMs: HERMES_RESPONSE_TIMEOUT_MS,
    gatewayLabel: "Hermes gateway",
  });
}

async function waitForOpenClawGateway(): Promise<void> {
  const deadline = Date.now() + OPENCLAW_READY_TIMEOUT_MS;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${config.openclawGatewayUrl}/health`, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(1_000);
  }
  throw new Error(`OpenClaw gateway unavailable after ${Math.round(OPENCLAW_READY_TIMEOUT_MS / 1000)}s: ${lastError}`);
}

async function waitForHermesGateway(): Promise<void> {
  const deadline = Date.now() + HERMES_READY_TIMEOUT_MS;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${config.hermesGatewayUrl}/health`, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(1_000);
  }
  throw new Error(`Hermes gateway unavailable after ${Math.round(HERMES_READY_TIMEOUT_MS / 1000)}s: ${lastError}`);
}

// ─── Shared tool catalog — Responses API (OpenClaw, Hermes) ────────────────
//
// Native (AGC) gets the catalog via cli_tool_request SSE events (see
// executeLocalTool below) using the dynamic cliTools the daemon sends on
// every run. OpenClaw and Hermes are opaque gateway binaries that advertise
// OpenAI Responses-API compatibility, so the same catalog is offered to
// them as a `tools` array on /v1/responses; any function_call they emit is
// executed through the same executeLocalTool dispatcher. One tool catalog,
// reachable from every agent runtime.

function responsesToolDefs(): Array<Record<string, unknown>> {
  return cliToolDefs().map((def) => ({ type: "function", name: def.name, description: def.description, parameters: def.parameters }));
}

type ResponsesToolCall = { callId: string; name: string; arguments: string };

type GatewayStreamResult = {
  output: string;
  responseId: string | null;
  toolCalls: ResponsesToolCall[];
};

async function readGatewayStream(
  res: Response,
  hooks: MessageRunHooks | undefined,
  usageDefaults: { provider: string; model?: string; source: string },
): Promise<GatewayStreamResult> {
  if (!res.body) return { output: "", responseId: null, toolCalls: [] };
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let output = "";
  let responseId: string | null = null;
  const toolCalls: ResponsesToolCall[] = [];
  let observedUsage: TokenUsagePayload | null = null;

  async function handlePayload(raw: string): Promise<void> {
    const payload = raw.trim();
    if (!payload || payload === "[DONE]") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    const maybeUsage = tokenUsageFromEvent(event, {
      provider: usageDefaults.provider,
      model: usageDefaults.model,
      source: usageDefaults.source,
    });
    if (maybeUsage) observedUsage = maybeUsage;

    const eventResponseId = responsesEventId(event);
    if (eventResponseId) responseId = eventResponseId;

    const toolCall = responsesFunctionCall(event);
    if (toolCall) {
      toolCalls.push(toolCall);
      return;
    }

    const text = openClawDeltaFromEvent(event);
    const delta = nextOpenClawDelta(output, text);
    if (delta) {
      output += delta;
      await hooks?.onDelta?.(delta).catch(() => {});
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      await handlePayload(trimmed.startsWith("data:") ? trimmed.slice(5) : trimmed);
    }
    if (done) break;
  }
  await handlePayload(buffer.startsWith("data:") ? buffer.slice(5) : buffer);
  if (observedUsage) await emitTokenUsage(observedUsage);
  return { output, responseId, toolCalls };
}

function responsesEventId(event: Record<string, unknown>): string | null {
  const response = event.response && typeof event.response === "object" ? event.response as Record<string, unknown> : null;
  if (typeof response?.id === "string") return response.id;
  if (event.object === "response" && typeof event.id === "string") return event.id;
  return null;
}

function responsesFunctionCall(event: Record<string, unknown>): ResponsesToolCall | null {
  const type = String(event.type ?? "");
  if (type !== "response.output_item.done" && type !== "function_call") return null;
  const item = (event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : event) as Record<string, unknown>;
  if (String(item.type ?? "") !== "function_call") return null;
  const name = String(item.name ?? "");
  if (!toolCatalogEntry(toolName(name))) return null;
  const callId = String(item.call_id ?? item.callId ?? item.id ?? "");
  if (!callId) return null;
  return { callId, name, arguments: typeof item.arguments === "string" ? item.arguments : "{}" };
}

// Drives a tools-enabled OpenAI Responses-API conversation against an
// OpenClaw/Hermes gateway, executing any cataloged function_call through
// executeLocalTool and feeding the result back via previous_response_id
// until the model produces a final answer (or we hit the round cap).
async function runResponsesConversation(opts: {
  gatewayUrl: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  hooks?: MessageRunHooks;
  usageDefaults: { provider: string; model?: string; source: string };
  timeoutMs: number;
  gatewayLabel: string;
}): Promise<string> {
  const MAX_TOOL_ROUNDS = 6;
  let body: Record<string, unknown> = { ...opts.body, tools: responsesToolDefs(), stream: true };
  let finalOutput = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(opts.gatewayUrl, {
      method: "POST",
      headers: opts.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${opts.gatewayLabel} failed (${res.status}): ${truncate(detail || res.statusText, 500)}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream") && !contentType.includes("application/x-ndjson")) {
      const data = await res.json() as {
        output_text?: string;
        output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }>; text?: string }>;
        response?: string;
        text?: string;
      };
      const outputText = data.output_text
        ?? data.text
        ?? data.response
        ?? data.output?.flatMap((item) => [
          item.text,
          ...(item.content?.map((content) => content.text) ?? []),
        ]).filter(Boolean).join("\n");
      return outputText || finalOutput || "done";
    }

    const result = await readGatewayStream(res, opts.hooks, opts.usageDefaults);
    if (result.output) finalOutput = finalOutput ? `${finalOutput}\n${result.output}` : result.output;

    if (!result.toolCalls.length) return finalOutput || "done";

    if (!result.responseId) {
      console.warn(`[daemon] ${opts.gatewayLabel}: browser tool call requested but no response id observed; stopping tool loop`);
      return finalOutput || "done";
    }

    const toolOutputs = await Promise.all(result.toolCalls.map(async (call) => {
      await opts.hooks?.onToolCall?.(call.name).catch(() => {});
      let output: string;
      try {
        const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
        output = await executeLocalTool(toolName(call.name), args);
      } catch (err) {
        output = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      return { type: "function_call_output", call_id: call.callId, output };
    }));

    body = {
      model: body.model,
      previous_response_id: result.responseId,
      input: toolOutputs,
      user: body.user,
      tools: responsesToolDefs(),
      stream: true,
    };
  }

  return finalOutput || "I could not complete that request — the browser tool loop hit its round limit.";
}

function nextOpenClawDelta(output: string, text: string | null): string | null {
  if (!text) return null;
  if (!output) return text;
  if (text === output || output.endsWith(text)) return null;
  if (text.startsWith(output)) return text.slice(output.length);
  return text;
}

function openClawDeltaFromEvent(event: Record<string, unknown>): string | null {
  for (const key of ["delta", "text", "output_text", "response"]) {
    const value = event[key];
    if (typeof value === "string") return value;
  }
  const nestedDelta = event.delta && typeof event.delta === "object"
    ? (event.delta as Record<string, unknown>).text
    : null;
  if (typeof nestedDelta === "string") return nestedDelta;
  const item = event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : null;
  if (typeof item?.text === "string") return item.text;
  const content = Array.isArray(item?.content) ? item.content : [];
  const text = content
    .map((part) => part && typeof part === "object" ? (part as Record<string, unknown>).text : null)
    .filter((part): part is string => typeof part === "string")
    .join("");
  return text || null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    );
  });
}

// ─── Boot ──────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[daemon] fatal:", err);
  process.exit(1);
});
