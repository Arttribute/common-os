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
const MSG_POLL_MS    = 3_000;
const HEALTH_MS      = 10_000;
const AXL_INBOX_MS   = 5_000;
const WORKSPACE_DIR  = process.env.COMMONOS_WORKSPACE ?? config.workspaceDir;
const AXL_API_URL    = process.env.AXL_API_URL ?? "http://localhost:9002";
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const DAEMON_RUNTIME = "common-os-daemon/agc-direct-stream-v2";

type AgcMessage = { role: "user" | "assistant"; content: string };

type AxlEnvelope = {
  type?: "request" | "response";
  id?: string;
  fromAgentId?: string;
  toAgentId?: string;
  content?: string;
  inReplyTo?: string;
};

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

async function main() {
  console.log(`[daemon] starting  ${DAEMON_RUNTIME}  agent=${config.agentId}  role=${config.role}  fleet=${config.fleetId}`);

  await firstTimeSetup();
  await agent.emit({ type: "state_change", payload: { status: "online" } });
  console.log("[daemon] online");

  // Push initial workspace snapshot so the UI can show the pod filesystem immediately
  await emitWorkspaceSnapshot().catch(() => {});

  void registerAxlPeer();
  void discoverFleetPeers();

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
      const res = await fetch(`${AXL_API_URL}/topology`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) throw new Error(`AXL topology endpoint returned ${res.status}`);

      const data = await res.json() as { our_public_key?: string; our_ipv6?: string };
      const peerId    = data.our_public_key ?? null;
      const multiaddr = data.our_ipv6 ?? null;

      if (!peerId) throw new Error("AXL returned no public key");

      await fetch(`${config.apiUrl}/fleets/${config.fleetId}/agents/${config.agentId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${config.agentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ "axl.peerId": peerId, "axl.multiaddr": multiaddr }),
      });

      console.log(`[daemon] AXL peer registered  peerId=${peerId.slice(0, 16)}…  ipv6=${multiaddr}`);
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

    for (const peer of peers) {
      if (peer.peerId && peer.agentId !== config.agentId) {
        peerIdToAgentId.set(peer.peerId, peer.agentId);
        agentIdToPeerId.set(peer.agentId, peer.peerId);
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

function parseAxlPayload(raw: string): AxlEnvelope {
  try {
    const parsed = JSON.parse(raw) as AxlEnvelope;
    if (parsed && typeof parsed === "object" && typeof parsed.content === "string") {
      return parsed;
    }
  } catch {}

  return { type: "request", content: raw };
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
}): Promise<void> {
  console.log(`[daemon] message ${msg.id}: ${msg.content.slice(0, 80)}`);

  await agent.emit({ type: "state_change", payload: { status: "working" } });

  try {
    const runResult = await executeTask(msg.content, msg.agcSessionId ?? undefined, msg.messages);
    const response = typeof runResult === "string" ? runResult : runResult.response;

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

    if (msg.source === "axl" && msg.axlPeerId) {
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

    if (axlReply?.replyToPeerId && axlReply.replyToAgentId) {
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
): Promise<string | { response: string; agcSessionId?: string }> {
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

function buildRunPrompt(description: string, messages?: AgcMessage[]): string {
  if (!messages || messages.length <= 1) {
    return [buildCliContext(), "", description].join("\n");
  }

  const transcript = messages
    .slice(-12)
    .map((msg) => `${msg.role === "assistant" ? "Assistant" : "User"}: ${msg.content}`)
    .join("\n\n");

  return [
    buildCliContext(),
    "",
    "Continue this CommonOS conversation. Use the prior turns as context, but answer only the latest user request.",
    "",
    transcript,
  ].join("\n");
}

function buildCliContext(): string {
  return `
## CLI Local File System - ACTIVE

You are running inside a CommonOS agent pod with DIRECT access to this pod's workspace.

Session root: ${WORKSPACE_DIR}

Current file system snapshot:

\`\`\`
${buildWorkspaceSnapshot(WORKSPACE_DIR)}
\`\`\`

Mandatory rules:
1. When asked to create, edit, inspect, search, or run something in the pod, call the cli_* tools directly.
2. Do not say you cannot access the filesystem. You can use cli_read_file, cli_write_file, cli_list_directory, cli_search_files, and cli_run_command.
3. File operations are sandboxed to the session root. Return the actual path or command output after using a tool.
4. For markdown file requests, write the .md file with cli_write_file and return its path.
5. For agent-to-agent communication in CommonOS, use cli_send_axl_message by default. Do not use Agent Commons native A2A unless the user explicitly asks for Agent Commons/native A2A or cli_send_axl_message fails.

CommonOS AXL messaging tool:
- cli_send_axl_message({ "target": "<agent id, peer id, fleet manager, or fleet master>", "content": "<message>" })
- The tool sends over AXL, records the conversation for observability, and returns the recipient and delivery path.
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

// ─── Native execution via Agent Commons stream ─────────────────────────────
// Mirrors `agc run --local --yes` inside the daemon so world UI messages can
// execute pod-local filesystem and command tools without depending on an
// external runner process or opaque CLI subprocess behavior.

async function runViaNative(
  description: string,
  agcSessionId?: string,
  messages?: AgcMessage[],
): Promise<{ response: string; agcSessionId?: string }> {
  const sessionIdToUse = agcSessionId ?? agentSessionId;
  const agentId = config.commonsAgentId || config.agentId;
  const prompt = buildRunPrompt(description, messages);

  console.log(
    `[daemon] agc stream  runtime=${DAEMON_RUNTIME}  agent=${agentId.slice(0, 12)}  session=${sessionIdToUse?.slice(0, 12) ?? "new"}  history=${messages?.length ?? 0}`,
  );

  const body = {
    agentId,
    ...(sessionIdToUse ? { sessionId: sessionIdToUse } : {}),
    messages: [{ role: "user", content: prompt }],
    cliContext: buildCliContext(),
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

    if (event.type === "token" && typeof event.content === "string") {
      output += event.content;
      return;
    }

    if (event.type === "cli_tool_request") {
      toolRequestCount += 1;
      const requestId = typeof event.requestId === "string" ? event.requestId : "";
      const requestedTool = String(event.tool ?? "");
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

  const response = cleanAgcOutput(finalText ?? output);
  console.log(
    `[daemon] agc stream done  runtime=${DAEMON_RUNTIME}  length=${response.length}  tools=${toolRequestCount}  session=${observedSessionId?.slice(0, 12) ?? "none"}`,
  );
  return { response: response || "done", ...(observedSessionId ? { agcSessionId: observedSessionId } : {}) };
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
