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
import { resolve, relative, join, dirname } from "path";
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

  if (config.integrationPath === "native" && !config.commonsApiKey) {
    await bootstrapCommons();
  }

  if (config.integrationPath === "native") {
    await initSession();
    await registerSessionWithApi();
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
    if (data.commonsApiKey) {
      config.commonsApiKey = data.commonsApiKey;
      config.commonsAgentId = data.commonsAgentId ?? config.agentId;
      console.log(`[daemon] Agent Commons ready  agentId=${config.commonsAgentId}`);
    } else {
      console.warn("[daemon] bootstrap: no Agent Commons credentials returned — AGENTCOMMONS_API_KEY may not be configured");
    }
  } catch (err) {
    console.warn("[daemon] bootstrap failed:", err instanceof Error ? err.message : err);
  }
}

// ─── AGC API ───────────────────────────────────────────────────────────────
// Base URL and auth headers for direct calls to the Agent Commons REST API.
// The daemon bypasses the agc CLI and calls the API directly for both session
// creation and streaming execution — no subprocess overhead, clean output.

const AGC_BASE_URL = (process.env.AGC_API_URL ?? "https://api.agentcommons.io").replace(/\/$/, "");

function agcHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.commonsApiKey}`,
  };
}

// ─── Session management ────────────────────────────────────────────────────
// One persistent AGC session per agent. The session ID is stored in the
// workspace so it survives daemon restarts. All messages and tasks share
// this session, giving the agent continuous conversational memory.

const SESSION_FILE = join(WORKSPACE_DIR, ".common-os-session.json");

async function initSession(): Promise<void> {
  if (!config.commonsAgentId || !config.commonsApiKey) {
    console.log("[daemon] AGC not configured — skipping session init");
    return;
  }

  // Try to resume an existing session for this agent
  try {
    if (existsSync(SESSION_FILE)) {
      const data = JSON.parse(readFileSync(SESSION_FILE, "utf-8")) as {
        sessionId?: string;
        agentId?: string;
      };
      if (data.sessionId && data.agentId === config.commonsAgentId) {
        agentSessionId = data.sessionId;
        console.log(`[daemon] resumed session ${agentSessionId}`);
        return;
      }
    }
  } catch {
    // Fall through to create a new session
  }

  // Create a new session via the AGC REST API directly
  try {
    const res = await fetch(`${AGC_BASE_URL}/v1/sessions`, {
      method: "POST",
      headers: agcHeaders(),
      body: JSON.stringify({
        agentId: config.commonsAgentId,
        title: `daemon-${config.agentId.slice(0, 12)}`,
        source: "daemon",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const raw = await res.json() as Record<string, unknown>;
      const data = (raw.data ?? raw) as Record<string, unknown>;
      const sessionId = (data.sessionId ?? data.id ?? null) as string | null;
      if (sessionId) {
        agentSessionId = sessionId;
        writeFileSync(
          SESSION_FILE,
          JSON.stringify({ sessionId, agentId: config.commonsAgentId }),
        );
        console.log(`[daemon] created session ${agentSessionId}`);
        return;
      }
    }
    console.warn(`[daemon] session creation failed: ${res.status} — running without session`);
  } catch (err) {
    console.warn("[daemon] session init error:", err instanceof Error ? err.message : err);
  }
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

  void registerAxlPeer();
  void discoverFleetPeers();

  setInterval(() => {
    agent.emit({ type: "heartbeat" }).catch((err: unknown) => {
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
    .catch((err: unknown) => console.warn("[world] move emit failed:", err));
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
    .catch((err: unknown) => console.warn("[world] interact emit failed:", err));
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
    .catch((err: unknown) => console.warn("[world] create_object emit failed:", err));
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
  options: { emitEvent?: boolean } = {},
): Promise<void> {
  const res = await fetch(`${AXL_API_URL}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: toMultiaddr, data: content }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`AXL send failed: ${res.status}`);

  if (options.emitEvent !== false) {
    await agent
      .emit({ type: "message_sent", payload: { toAgentId, preview: content.slice(0, 100) } })
      .catch(() => {});
  }

  console.log(`[daemon] AXL message sent → ${toAgentId}  "${content.slice(0, 60)}"`);
}

interface ResolvedAgent {
  name: string
  agentId: string | null
  commonsAgentId?: string | null
  fleetId: string | null
  role: string | null
  status: string | null
  peerId: string | null
  multiaddr: string | null
  walletAddress?: string | null
  source: 'db' | 'ens'
}

async function resolveAgentByName(name: string): Promise<ResolvedAgent | null> {
  const res = await fetch(
    `${config.apiUrl}/agents/resolve/${encodeURIComponent(name)}`,
    {
      headers: { Authorization: `Bearer ${config.agentToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!res.ok) return null;
  return await res.json() as ResolvedAgent;
}

async function recordAgentMessage(toAgentId: string, content: string): Promise<void> {
  const res = await fetch(
    `${config.apiUrl}/fleets/${config.fleetId}/agents/${toAgentId}/message`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.agentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fromAgentId: config.agentId,
        toAgentId,
        content,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!res.ok) {
    throw new Error(`message registry write failed: ${res.status}`);
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
        const msg = await res.json() as { id: string; content: string; sessionId?: string | null; agcSessionId?: string | null };
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

async function handleMessage(msg: { id: string; content: string; sessionId?: string | null; agcSessionId?: string | null }): Promise<void> {
  console.log(`[daemon] message ${msg.id}: ${msg.content.slice(0, 80)}`);

  await agent.emit({ type: "state_change", payload: { status: "working" } });

  try {
    const response = await executeTask(msg.content, msg.agcSessionId ?? undefined);

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
      void sendAxlMessage(config.managerMultiaddr, config.managerAgentId, summary).catch(
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

async function executeTask(description: string, agcSessionId?: string): Promise<string> {
  if (config.integrationPath === "openclaw") return await runViaOpenClaw(description);
  if (config.integrationPath === "native") return await runViaNative(description, agcSessionId);
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

function buildFilesystemManifest(rootDir: string, snapshot: string): string {
  return `## Pod Workspace Context

You are running inside your own Kubernetes pod on CommonOS. The daemon handles all \
local tool execution automatically.

**Workspace root:** \`${rootDir}\`

**Current workspace snapshot:**
\`\`\`
${snapshot}
\`\`\`

### Available local tools

| Tool | Args | Description |
|------|------|-------------|
| cli_read_file | path | Read a file (relative to workspace root) |
| cli_write_file | path, content | Create or overwrite a file |
| cli_list_directory | path? | List directory contents |
| cli_run_command | command, cwd? | Execute any shell command |
| cli_search_files | pattern, path? | Find files matching a glob pattern |
| resolve_agent | name | Resolve another CommonOS agent via DB/ENS |
| send_axl_message | to_name, message | Record a message and attempt AXL delivery |

**Rules:**
1. All paths are relative to \`${rootDir}\`
2. Commands run with full pod environment (bun, node, python, git, curl, etc.)
3. You own this pod — no confirmation needed for any operation
4. cli_write_file and cli_run_command execute immediately — auto-approve is active
5. Chain tool calls across turns to accomplish complex tasks`;
}

// ─── Local tool execution ──────────────────────────────────────────────────
// Tools are invoked via the AGC platform's cli_tool_request SSE event.
// The daemon receives the event, executes the tool locally, and posts the
// result back to AGC — no interactive confirmation, the agent owns this pod.

function assertInWorkspace(userPath: string): string {
  const abs = resolve(WORKSPACE_DIR, userPath);
  const rel = relative(WORKSPACE_DIR, abs);
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error(`path "${userPath}" escapes workspace`);
  }
  return abs;
}

function toolReadFile(args: { path: string }): string {
  const abs = assertInWorkspace(args.path);
  if (!existsSync(abs)) return `[error: file not found: ${args.path}]`;
  try {
    const stat = statSync(abs);
    if (stat.isDirectory()) return `[error: "${args.path}" is a directory — use list_directory]`;
    const content = readFileSync(abs, "utf-8");
    return content.length > 50_000
      ? content.slice(0, 50_000) + "\n… (truncated at 50 KB)"
      : content;
  } catch (err) {
    return `[error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

function toolWriteFile(args: { path: string; content: string }): string {
  try {
    const abs = assertInWorkspace(args.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, args.content ?? "", "utf-8");
    return `[ok: wrote ${abs}]`;
  } catch (err) {
    return `[error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

function toolListDirectory(args: { path?: string }): string {
  try {
    const abs = args.path ? assertInWorkspace(args.path) : WORKSPACE_DIR;
    if (!existsSync(abs)) return `[error: directory not found: ${args.path ?? "."}]`;
    const entries = readdirSync(abs, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory: () => boolean;
    }>;
    if (entries.length === 0) return "[empty directory]";
    return entries
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join("\n");
  } catch (err) {
    return `[error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

async function toolRunCommand(args: { command: string; cwd?: string }): Promise<string> {
  try {
    const cwd = args.cwd ? assertInWorkspace(args.cwd) : WORKSPACE_DIR;
    const proc = Bun.spawn(["sh", "-c", args.command], {
      cwd,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    const combined = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).trim();
    return combined.slice(0, 10_000) || "[command produced no output]";
  } catch (err) {
    return `[error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

async function toolSearchFiles(args: { pattern: string; path?: string }): Promise<string> {
  try {
    const searchRoot = args.path ? assertInWorkspace(args.path) : WORKSPACE_DIR;
    const proc = Bun.spawn(
      ["find", searchRoot, "-name", args.pattern, "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*"],
      {
        cwd: WORKSPACE_DIR,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const lines = stdout.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return `[no files matching "${args.pattern}"]`;
    return lines.slice(0, 200).join("\n");
  } catch (err) {
    return `[error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

async function toolResolveAgent(args: { name: string }): Promise<string> {
  if (!args.name) return '[error: name is required]';
  const resolved = await resolveAgentByName(args.name);
  if (!resolved) return `[agent not found: ${args.name}]`;
  return JSON.stringify(resolved, null, 2);
}

async function toolSendAxlMessage(args: { to_name: string; message: string }): Promise<string> {
  if (!args.to_name) return '[error: to_name is required]';
  if (!args.message) return '[error: message is required]';

  const resolved = await resolveAgentByName(args.to_name);
  if (!resolved?.agentId) return `[agent not found: ${args.to_name}]`;

  let recorded = false;
  if (resolved.fleetId === config.fleetId) {
    try {
      await recordAgentMessage(resolved.agentId, args.message);
      recorded = true;
    } catch (err) {
      console.warn("[daemon] message registry write failed:", err instanceof Error ? err.message : err);
    }
  }

  if (!resolved.multiaddr) {
    if (recorded) {
      return `[message recorded for ${args.to_name}; target has no live AXL route yet]`;
    }
    return `[agent found but no AXL route for ${args.to_name}]`;
  }

  try {
    await sendAxlMessage(resolved.multiaddr, resolved.agentId, args.message, { emitEvent: !recorded });
    return recorded
      ? `[message recorded and sent to ${args.to_name} via AXL]`
      : `[message sent to ${args.to_name} via AXL]`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (recorded) {
      return `[message recorded for ${args.to_name}; AXL unavailable: ${message}]`;
    }
    return `[AXL send failed: ${message}]`;
  }
}

async function executeTool(call: { tool: string; args: Record<string, unknown> }): Promise<string> {
  const tool = call.tool.replace(/^cli_/, ""); // strip optional cli_ prefix
  const args = call.args ?? {};

  switch (tool) {
    case "read_file":
      return toolReadFile(args as { path: string });
    case "write_file":
      return toolWriteFile(args as { path: string; content: string });
    case "list_directory":
      return toolListDirectory(args as { path?: string });
    case "run_command":
      return await toolRunCommand(args as { command: string; cwd?: string });
    case "search_files":
      return await toolSearchFiles(args as { pattern: string; path?: string });
    case "resolve_agent":
      return await toolResolveAgent(args as { name: string });
    case "send_axl_message":
      return await toolSendAxlMessage(args as { to_name: string; message: string });
    default:
      return `[error: unknown tool "${tool}". Available: read_file, write_file, list_directory, run_command, search_files, resolve_agent, send_axl_message]`;
  }
}

// ─── Native execution via AGC streaming API ────────────────────────────────
// Calls the AGC streaming endpoint directly — no CLI subprocess.
// SSE events handled:
//   token            → accumulate streamed content
//   cli_tool_request → execute tool locally, POST result to /cli-tool-result
//   final            → return the completed response
// The persistent sessionId gives the agent continuous cross-task memory.

async function runViaNative(description: string, agcSessionId?: string): Promise<string> {
  const agentId = config.commonsAgentId || config.agentId;
  const snapshot = buildWorkspaceSnapshot(WORKSPACE_DIR);
  const cliContext = buildFilesystemManifest(WORKSPACE_DIR, snapshot);

  const sessionIdToUse = agcSessionId ?? agentSessionId;
  console.log(`[daemon] AGC stream  agent=${agentId.slice(0, 12)}  session=${sessionIdToUse?.slice(0, 8) ?? "none"}`);

  const res = await fetch(`${AGC_BASE_URL}/v1/agents/run/stream`, {
    method: "POST",
    headers: agcHeaders(),
    body: JSON.stringify({
      agentId,
      ...((agcSessionId ?? agentSessionId) ? { sessionId: agcSessionId ?? agentSessionId } : {}),
      messages: [{ role: "user", content: description }],
      cliContext,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AGC stream error ${res.status}: ${errText.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("AGC stream: empty response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let tokens = "";
  let finalContent = "";

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      // SSE messages are separated by double newlines
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;

        const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;

        const jsonStr = dataLine.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(jsonStr) as Record<string, unknown>;
        } catch {
          continue;
        }

        const type = event.type as string;

        if (type === "token") {
          tokens += (event.content as string) ?? "";

        } else if (type === "cli_tool_request") {
          const requestId = event.requestId as string;
          const toolName  = event.tool as string;
          const toolArgs  = (event.args ?? {}) as Record<string, unknown>;

          console.log(`[daemon] cli_tool_request: ${toolName}  args=${JSON.stringify(toolArgs).slice(0, 100)}`);
          const toolResult = await executeTool({ tool: toolName, args: toolArgs });
          console.log(`[daemon] tool result: ${toolResult.slice(0, 120)}`);

          await fetch(`${AGC_BASE_URL}/v1/agents/cli-tool-result`, {
            method: "POST",
            headers: agcHeaders(),
            body: JSON.stringify({ requestId, result: toolResult }),
            signal: AbortSignal.timeout(15_000),
          }).catch((err) =>
            console.warn("[daemon] cli-tool-result post failed:", err instanceof Error ? err.message : err),
          );

        } else if (type === "final") {
          finalContent = (event.content as string) ?? tokens;
          console.log(`[daemon] AGC stream done  tokens=${tokens.length}  final=${finalContent.length}`);
          break outer;

        } else if (type === "error") {
          throw new Error(`AGC error: ${(event.message as string) ?? JSON.stringify(event)}`);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return finalContent || tokens || "done";
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
