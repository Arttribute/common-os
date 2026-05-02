import { watch } from "chokidar";
import { randomBytes } from "crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from "fs";
import { join, dirname } from "path";
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
const MSG_POLL_MS    = 3_000;
const HEALTH_MS      = 10_000;
const AXL_INBOX_MS   = 5_000;
const WORKSPACE_DIR  = process.env.COMMONOS_WORKSPACE ?? config.workspaceDir;
const AXL_API_URL    = process.env.AXL_API_URL ?? "http://localhost:4001";
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

type AgcMessage = { role: "user" | "assistant"; content: string };

// Session ID is created once at startup and persisted so the agent remembers
// all previous conversations across daemon restarts.
let agentSessionId: string | null = null;

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
    await setupAgcAuth();
    await initSession(); // recover only — new sessions created lazily on first run
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
const AGC_HOME_CONFIG = join(process.env.HOME ?? "/root", ".agc", "config.json");

async function setupAgcAuth(): Promise<void> {
  if (!config.commonsApiKey) return;
  try {
    mkdirSync(dirname(AGC_HOME_CONFIG), { recursive: true });
    writeFileSync(
      AGC_HOME_CONFIG,
      JSON.stringify({ apiKey: config.commonsApiKey, apiUrl: AGC_BASE_URL }),
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

function parseAgcSessionId(output: string): string | null {
  for (const line of output.split("\n")) {
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
    // "Session: ses_xxx" or "Session ID: ses_xxx" header line
    const kv = s.match(/(?:session(?:\s+id)?)\s*[=:]\s*(\S+)/i);
    if (kv?.[1]) return kv[1];
  }
  // Fallback: any token that looks like a session identifier
  const m = output.match(/\b(sess?[-_][a-zA-Z0-9_-]{6,}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/);
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

async function main() {
  console.log(`[daemon] starting  agent=${config.agentId}  role=${config.role}  fleet=${config.fleetId}`);

  await firstTimeSetup();
  await agent.emit({ type: "state_change", payload: { status: "online" } });
  console.log("[daemon] online");

  // Push initial workspace snapshot so the UI can show the pod filesystem immediately
  await emitWorkspaceSnapshot().catch(() => {});

  await registerAxlPeer();
  await discoverFleetPeers();

  setInterval(() => {
    agent.emit({ type: "heartbeat" }).catch((err) => {
      console.error("[daemon] heartbeat error:", err);
    });
  }, HEARTBEAT_MS);

  startFileWatcher();
  startHealthMonitor();
  void startAxlInboxLoop();
  void pollMessages();
  await pollTasks();
}

// ─── Workspace snapshot ────────────────────────────────────────────────────

async function emitWorkspaceSnapshot(): Promise<void> {
  const snapshot = buildWorkspaceSnapshot(WORKSPACE_DIR);
  await agent
    .emit({ type: "workspace_snapshot", payload: { snapshot, rootDir: WORKSPACE_DIR } })
    .catch(() => {});
  console.log(`[daemon] workspace snapshot emitted (${snapshot.split("\n").length} lines)`);
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
  if (config.integrationPath !== "openclaw") {
    return;
  }

  const probeUrl = `${config.openclawGatewayUrl}/health`;

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
      const res = await fetch(`${AXL_API_URL}/peer`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) throw new Error(`AXL peer endpoint returned ${res.status}`);

      const data = await res.json() as { peerId?: string; multiaddr?: string; addrs?: string[] };
      const peerId    = data.peerId ?? null;
      const multiaddr = data.multiaddr ?? data.addrs?.[0] ?? null;

      if (!peerId && !multiaddr) throw new Error("AXL returned no peer info");

      await fetch(`${config.apiUrl}/fleets/${config.fleetId}/agents/${config.agentId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${config.agentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ "axl.peerId": peerId, "axl.multiaddr": multiaddr }),
      });

      console.log(`[daemon] AXL peer registered  peerId=${peerId}  multiaddr=${multiaddr}`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[daemon] AXL peer registration attempt ${attempt + 1}/5 failed: ${msg}`);
      if (attempt < 4) await sleep(3_000);
    }
  }
  console.warn("[daemon] AXL peer registration failed after 5 attempts — continuing without P2P");
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
      peerId: string | null;
      multiaddr: string | null;
      permissionTier: string;
    }>;

    const manager = peers.find(
      (p) => p.permissionTier === "manager" && p.agentId !== config.agentId && p.multiaddr,
    );

    if (manager) {
      config.managerAgentId = manager.agentId;
      config.managerMultiaddr = manager.multiaddr!;
      console.log(
        `[daemon] manager peer cached  agentId=${manager.agentId}  multiaddr=${manager.multiaddr}`,
      );
    }
  } catch {
    // Non-fatal
  }
}

// ─── AXL inbox loop ────────────────────────────────────────────────────────

let lastSeenAxlMessageTs = 0;

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
  const res = await fetch(`${AXL_API_URL}/messages`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return;

  const messages = (await res.json()) as Array<{
    id?: string;
    from?: string;
    fromPeerId?: string;
    data?: string;
    content?: string;
    timestamp?: number;
  }>;
  if (!Array.isArray(messages) || messages.length === 0) return;

  for (const msg of messages) {
    const ts = msg.timestamp ?? 0;
    if (ts <= lastSeenAxlMessageTs) continue;

    const content = msg.data ?? msg.content ?? "";
    const fromPeerId = msg.from ?? msg.fromPeerId ?? "unknown";

    console.log(`[daemon] AXL message from ${fromPeerId}: ${content.slice(0, 80)}`);

    await agent
      .emit({
        type: "message_recv",
        payload: { fromAgentId: fromPeerId, preview: content.slice(0, 100) },
      })
      .catch(() => {});

    if (content && config.integrationPath !== "guest") {
      void handleTask({ id: `axl_${Date.now()}`, description: content }).catch(() => {});
    }

    if (ts > lastSeenAxlMessageTs) lastSeenAxlMessageTs = ts;
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
  toMultiaddr: string,
  toAgentId: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${AXL_API_URL}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: toMultiaddr, data: content }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`AXL send failed: ${res.status}`);

  await agent
    .emit({ type: "message_sent", payload: { toAgentId, preview: content.slice(0, 100) } })
    .catch(() => {});

  console.log(`[daemon] AXL message sent → ${toAgentId}  "${content.slice(0, 60)}"`);
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
}): Promise<void> {
  console.log(`[daemon] message ${msg.id}: ${msg.content.slice(0, 80)}`);

  await agent.emit({ type: "state_change", payload: { status: "working" } });

  try {
    const response = await executeTask(msg.content, msg.agcSessionId ?? undefined, msg.messages);

    await fetch(
      `${config.apiUrl}/agents/${config.agentId}/messages/${msg.id}/respond`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.agentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ response }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    console.log(`[daemon] message ${msg.id} responded`);
  } catch (err) {
    console.error(`[daemon] message ${msg.id} error:`, err);
  } finally {
    await agent.emit({ type: "state_change", payload: { status: "idle" } });
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

async function handleTask(task: { id: string; description: string }) {
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
    const output = await executeTask(task.description);

    await worldCreateObject("artifact", pos.room, pos.x + 1, pos.y, truncate(task.description, 24));

    await agent.completeTask(task.id, output);
    await agent.emit({ type: "task_complete", payload: { taskId: task.id, output } });

    console.log(`[daemon] task ${task.id} complete`);

    if (config.managerAgentId && config.managerMultiaddr) {
      const summary = `Task complete: ${task.description.slice(0, 60)} → ${output.slice(0, 80)}`;
      await sendAxlMessage(config.managerMultiaddr, config.managerAgentId, summary).catch(
        (err) => console.warn("[daemon] AXL manager notify failed:", err),
      );
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

async function executeTask(description: string, agcSessionId?: string, messages?: AgcMessage[]): Promise<string> {
  if (config.integrationPath === "openclaw") return await runViaOpenClaw(description);
  if (config.integrationPath === "native") return await runViaNative(description, agcSessionId, messages);
  await sleep(2_000);
  return `completed: ${description}`;
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

// ─── Native execution via agc CLI ──────────────────────────────────────────
// `agc run --local --yes` is the only way to get cli_tool_request events from
// AGC (direct REST calls do not trigger local-tool mode). The CLI binary is
// pre-installed in the image; it handles auth, session memory, and all local
// tool calls (read/write/run) automatically inside its own process. We just
// capture stdout as the agent's final response.

async function runViaNative(description: string, agcSessionId?: string, _messages?: AgcMessage[]): Promise<string> {
  const sessionIdToUse = agcSessionId ?? agentSessionId;
  const isFirstRun = !sessionIdToUse;
  const agentId = config.commonsAgentId || config.agentId;

  console.log(`[daemon] agc run  agent=${agentId.slice(0, 12)}  session=${sessionIdToUse?.slice(0, 12) ?? (isFirstRun ? "new" : "none")}`);

  const args = ["run", "--agent", agentId, "--local", "--yes", "--no-stream"];
  if (sessionIdToUse) {
    args.push("--session", sessionIdToUse);
  } else {
    args.push("--new-session"); // first run: create and persist session
  }
  args.push(description);

  const proc = Bun.spawn(["agc", ...args], {
    cwd: WORKSPACE_DIR,
    env: agcEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });

  await Promise.race([proc.exited, sleep(120_000).then(() => proc.kill())]);

  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (err) console.warn("[daemon] agc run stderr:", err.slice(0, 300));

  // On first run, extract and persist the new session ID from output
  if (isFirstRun) {
    const newId = parseAgcSessionId(out + "\n" + err);
    if (newId) {
      agentSessionId = newId;
      try {
        writeFileSync(SESSION_FILE, JSON.stringify({ sessionId: newId, agentId: config.commonsAgentId }));
      } catch {}
      void registerSessionWithApi().catch(() => {});
      console.log(`[daemon] session created on first run: ${agentSessionId}`);
    } else {
      console.warn("[daemon] --new-session did not yield a session ID — future runs will be sessionless");
    }
  }

  // Strip any "Session: <id>" header line printed by --new-session
  const result = out.replace(/^Session(?:\s+ID)?\s*[=:]\s*\S+\s*\n?/i, "").trim();
  console.log(`[daemon] agc run done  length=${result.length}`);
  return result || "done";
}

async function runViaOpenClaw(description: string): Promise<string> {
  const res = await fetch(`${config.openclawGatewayUrl}/api/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: description, agentId: config.agentId }),
  });

  if (!res.ok) throw new Error(`OpenClaw gateway error: ${res.status}`);

  const data = await res.json() as { output?: string; response?: string };
  return data.output ?? data.response ?? "done";
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Boot ──────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[daemon] fatal:", err);
  process.exit(1);
});
