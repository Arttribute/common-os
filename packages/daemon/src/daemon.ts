import { watch } from "chokidar";
import { loadConfig } from "./config.js";
import { CommonOSAgentClient } from "@common-os/sdk";

const config = loadConfig();

const agent = new CommonOSAgentClient({
  agentToken: config.agentToken,
  agentId: config.agentId,
  apiUrl: config.apiUrl,
});

const HEARTBEAT_MS  = 30_000;
const POLL_MS       = 5_000;
const WORKSPACE_DIR = process.env.COMMONOS_WORKSPACE ?? config.workspaceDir;

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[daemon] starting  agent=${config.agentId}  role=${config.role}  fleet=${config.fleetId}`);

  await agent.emit({ type: "state_change", payload: { status: "online" } });
  console.log("[daemon] online");

  setInterval(() => {
    agent.emit({ type: "heartbeat" }).catch((err) => {
      console.error("[daemon] heartbeat error:", err);
    });
  }, HEARTBEAT_MS);

  startFileWatcher();
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

  try {
    const output = await executeTask(task.description);

    await agent.completeTask(task.id, output);
    await agent.emit({
      type: "task_complete",
      payload: { taskId: task.id, output },
    });

    console.log(`[daemon] task ${task.id} complete`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await agent.emit({ type: "error", payload: { message: msg } });
    console.error(`[daemon] task ${task.id} failed:`, err);
  } finally {
    await agent.emit({ type: "state_change", payload: { status: "idle" } });
    await agent.emit({ type: "action", payload: { label: "" } });
  }
}

// ─── Task execution ────────────────────────────────────────────────────────
// Integration point: plug in Agent Commons native call, Docker container pipe,
// or direct LLM invocation here. For the native path, use config.commonsApiKey
// and config.commonsAgentId to call the Agent Commons run endpoint.

async function executeTask(description: string): Promise<string> {
  if (config.integrationPath === "native" && config.commonsApiKey && config.commonsAgentId) {
    return await runViaNative(description);
  }
  if (config.integrationPath === "openclaw") {
    return await runViaOpenClaw(description);
  }
  // Guest path: the container running alongside handles execution.
  // Daemon signals readiness — actual output arrives via file_changed events.
  console.log(`[daemon] executing (guest): ${description}`);
  await sleep(2_000);
  return `completed: ${description}`;
}

async function runViaNative(description: string): Promise<string> {
  // Agent Commons native run — agent identity registered at provision time.
  // TODO: replace with @agent-commons/sdk once endpoint shape is confirmed.
  const res = await fetch("https://api.agentcommons.io/v1/runs", {
    method: "POST",
    headers: {
      "x-api-key": config.commonsApiKey,
      "x-agent-id": config.commonsAgentId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: description }),
  });

  if (!res.ok) throw new Error(`Agent Commons run failed: ${res.status}`);

  const data = await res.json() as { output?: string; result?: string };
  return data.output ?? data.result ?? "done";
}

async function runViaOpenClaw(description: string): Promise<string> {
  // OpenClaw gateway runs as a sidecar at localhost:18789.
  // Inject the task as a message into the gateway's WebSocket API.
  // The gateway processes it via the configured channels and model.
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
