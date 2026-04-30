import { watch } from "chokidar";
import { randomBytes } from "crypto";
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
const HEALTH_MS      = 10_000;
const AXL_INBOX_MS   = 5_000;
const WORKSPACE_DIR  = process.env.COMMONOS_WORKSPACE ?? config.workspaceDir;
const RUNNER_URL     = process.env.RUNNER_URL ?? config.runnerUrl ?? "";
// AXL runs on localhost:4001 inside the same pod/container
const AXL_API_URL    = process.env.AXL_API_URL ?? "http://localhost:4001";

// ─── World state ──────────────────────────────────────────────────────────
// Tracks the agent's current position in the world so world tools have context.

const worldPos = {
  room: config.worldRoom ?? "dev-room",
  x: config.worldX ?? 2,
  y: config.worldY ?? 2,
};

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[daemon] starting  agent=${config.agentId}  role=${config.role}  fleet=${config.fleetId}`);

  await agent.emit({ type: "state_change", payload: { status: "online" } });
  console.log("[daemon] online");

  await registerAxlPeer();
  await discoverFleetPeers();

  setInterval(() => {
    agent.emit({ type: "heartbeat" }).catch((err) => {
      console.error("[daemon] heartbeat error:", err);
    });
  }, HEARTBEAT_MS);

  startFileWatcher();
  startHealthMonitor();
  // AXL inbox runs concurrently — does not block task polling
  void startAxlInboxLoop();
  await pollTasks();
}

// ─── File watcher ──────────────────────────────────────────────────────────

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
}

// ─── Health monitor ────────────────────────────────────────────────────────
// Checks that the runtime (runner or openclaw gateway) is reachable.
// Emits an error event if it becomes unreachable.

let runtimeHealthy = true;

function startHealthMonitor() {
  if (!RUNNER_URL && config.integrationPath !== "openclaw") {
    // No runtime endpoint to probe — skip
    return;
  }

  const probeUrl =
    config.integrationPath === "openclaw"
      ? `${config.openclawGatewayUrl}/health`
      : `${RUNNER_URL}/health`;

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
// Queries the local AXL node for its peer ID and multiaddr, then PATCHes the
// agent document so the control plane knows how to route inter-agent messages.

async function registerAxlPeer(): Promise<void> {
  // Retry a few times — AXL may still be initialising when the daemon starts
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${AXL_API_URL}/peer`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) throw new Error(`AXL peer endpoint returned ${res.status}`);

      const data = await res.json() as { peerId?: string; multiaddr?: string; addrs?: string[] };
      const peerId   = data.peerId ?? null;
      const multiaddr = data.multiaddr ?? data.addrs?.[0] ?? null;

      if (!peerId && !multiaddr) throw new Error("AXL returned no peer info");

      // PATCH the agent document via the control plane API
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
// Fetches all agents in the fleet at startup to cache the manager's AXL
// multiaddr for direct P2P message routing (no control-plane relay needed).

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

    // Find the manager — the peer we'll report completions to
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
    // Non-fatal — fleet may have no manager yet
  }
}

// ─── AXL inbox loop ────────────────────────────────────────────────────────
// Polls the local AXL node for inbound P2P messages from other agents.
// Delivers each message as a message_recv event to the control plane, and
// optionally executes the message as a task if it looks like an instruction.

let lastSeenAxlMessageTs = 0;

async function startAxlInboxLoop(): Promise<void> {
  console.log("[daemon] AXL inbox loop started");
  while (true) {
    try {
      await pollAxlInbox();
    } catch {
      // Non-fatal — AXL may still be starting
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

    // Execute task instructions from peer agents
    if (content && config.integrationPath !== "guest") {
      void handleTask({ id: `axl_${Date.now()}`, description: content }).catch(
        () => {},
      );
    }

    if (ts > lastSeenAxlMessageTs) lastSeenAxlMessageTs = ts;
  }
}

// ─── World tools ──────────────────────────────────────────────────────────
// These let the agent move and interact with the world while executing tasks.
// Each emits an event that the control plane broadcasts to all WebSocket clients,
// making the World UI reflect real agent activity in real time.

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
    .emit({
      type: "world_interact",
      payload: { objectId, action, room, x, y },
    })
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
    .emit({
      type: "world_create_object",
      payload: { objectId, objectType, room, x, y, label },
    })
    .catch((err) => console.warn("[world] create_object emit failed:", err));
  console.log(`[world] created object  type=${objectType}  id=${objectId}  label=${label ?? ""}`);
  return objectId;
}

// Pick a sensible work position for this agent's role.
function workPosition(): { room: string; x: number; y: number } {
  const role = (config.role ?? "").toLowerCase();
  if (role.includes("manager")) return { room: "meeting-room", x: 2, y: 2 };
  if (role.includes("design")) return { room: "design-room", x: 2, y: 2 };
  return { room: "dev-room", x: 3, y: 2 };
}

// ─── AXL outbound ──────────────────────────────────────────────────────────
// Sends a message to a peer agent via the local AXL node (direct P2P — no
// control-plane relay).  Emits a message_sent event so the world UI
// animates the talking sprite.

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

  if (!res.ok) {
    throw new Error(`AXL send failed: ${res.status}`);
  }

  await agent
    .emit({
      type: "message_sent",
      payload: { toAgentId, preview: content.slice(0, 100) },
    })
    .catch(() => {});

  console.log(`[daemon] AXL message sent → ${toAgentId}  "${content.slice(0, 60)}"`);
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
  console.log(`[daemon] task ${task.id} — ${task.description}`);

  await agent.emit({ type: "state_change", payload: { status: "working" } });
  await agent.emit({
    type: "task_start",
    payload: { taskId: task.id, description: task.description },
  });
  await agent.emit({
    type: "action",
    payload: { label: truncate(task.description, 50) },
  });

  // Move to work position and interact with the relevant object
  const pos = workPosition();
  await worldMove(pos.room, pos.x, pos.y);

  // Interact with the closest work surface (desk/terminal)
  const workObjectId = `${pos.room}-workstation`;
  await worldInteract(workObjectId, truncate(task.description, 40), pos.room, pos.x, pos.y);

  try {
    const output = await executeTask(task.description);

    // Create an artifact in the world representing the completed work
    await worldCreateObject(
      "artifact",
      pos.room,
      pos.x + 1,
      pos.y,
      truncate(task.description, 24),
    );

    await agent.completeTask(task.id, output);
    await agent.emit({
      type: "task_complete",
      payload: { taskId: task.id, output },
    });

    console.log(`[daemon] task ${task.id} complete`);

    // Notify manager via AXL (P2P — no control-plane relay)
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
    // Return to idle home position
    await worldMove(worldPos.room, 2, 2).catch(() => {});
    await agent.emit({ type: "state_change", payload: { status: "idle" } });
    await agent.emit({ type: "action", payload: { label: "" } });
  }
}

// ─── Task execution ────────────────────────────────────────────────────────

async function executeTask(description: string): Promise<string> {
  if (config.integrationPath === "openclaw") {
    return await runViaOpenClaw(description);
  }
  if (config.integrationPath === "native") {
    return await runViaNative(description);
  }
  // Guest path: the container running alongside handles execution.
  // Daemon signals readiness — actual output arrives via file_changed events.
  console.log(`[daemon] executing (guest): ${description}`);
  await sleep(2_000);
  return `completed: ${description}`;
}

async function runViaNative(description: string): Promise<string> {
  if (!RUNNER_URL) {
    throw new Error("RUNNER_URL not configured for native path");
  }

  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: config.commonsAgentId || config.agentId,
      prompt: description,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error(`runner error: ${text}`);
  }

  const data = await res.json() as { output?: string; result?: string };
  return data.output ?? data.result ?? "done";
}

async function runViaOpenClaw(description: string): Promise<string> {
  // OpenClaw gateway runs as a sidecar at localhost:18789.
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
