# AXL Integration Plan — Agent P2P Messaging

## Overview

Gensyn AXL is the peer-to-peer transport layer already running inside every CommonOS agent pod. It provides libp2p-based direct messaging between agents using multiaddrs. The daemon already has AXL code but it is currently coupled into the core loop, which caused failures.

This document covers:
1. Decoupling AXL from the core daemon loop (cleanup)
2. Exposing AXL as agent-callable tools so agents can use it deliberately, not automatically

AXL messaging is the transport; ENS (see `ens-integration-plan.md`) is the discovery layer that tells an agent which multiaddr to send to.

---

## Current Problem

The daemon's `main()` function currently `await`s AXL operations before the core loop starts, meaning an AXL failure at boot can stall or kill the daemon. Additionally, `sendAxlMessage` is called inside `handleTask` automatically after every task completion, making AXL a hard dependency of task execution.

```
Current main():
  await firstTimeSetup()
  await agent.emit(online)
  await registerAxlPeer()       ← blocks startup if AXL is down
  await discoverFleetPeers()    ← blocks startup if AXL is down
  setInterval(heartbeat)
  startFileWatcher()
  startHealthMonitor()
  void startAxlInboxLoop()
  void pollMessages()
  await pollTasks()             ← core loop

Current handleTask():
  ...execute task...
  if (config.managerMultiaddr) {
    await sendAxlMessage(...)   ← AXL called in every task completion
  }
```

---

## Target Architecture

```
Core loop (AXL-free):
  heartbeat
  pollMessages()      ← human messages
  pollTasks()         ← AGC tasks

AXL overlay (non-blocking, independent):
  void registerAxlPeer()     ← fire-and-forget at startup
  void discoverFleetPeers()  ← fire-and-forget at startup
  startAxlInboxLoop()        ← background, already void

Agent tools (explicit use only):
  resolve_agent      ← calls API /agents/resolve/:name
  send_axl_message   ← resolve + AXL send, only when agent asks
```

If AXL is unavailable, the core loop runs normally. Agents that want to use AXL call the tools explicitly; nothing calls AXL automatically.

---

## Daemon Changes

### `main()` — remove blocking AXL awaits

```typescript
// Before
await registerAxlPeer();
await discoverFleetPeers();

// After
void registerAxlPeer();      // fire-and-forget, logs warn if unavailable
void discoverFleetPeers();   // fire-and-forget, logs warn if unavailable
```

### `handleTask()` — remove automatic AXL notify

Remove the block at the end of task completion that sends a summary to the manager via AXL. Task completion reporting is an API concern (`agent.completeTask`), not an AXL concern.

```typescript
// Remove this block entirely:
if (config.managerAgentId && config.managerMultiaddr) {
  const summary = `Task complete: ...`;
  await sendAxlMessage(config.managerMultiaddr, config.managerAgentId, summary).catch(...);
}
```

### `startAxlInboxLoop()` — keep as-is

Already `void` / fire-and-forget. The inbox loop continues routing incoming AXL messages to `handleTask`. This is the correct direction — AXL can push work into the core loop, but the core loop does not depend on AXL being up.

---

## New Agent Tools

These are added to the daemon's tool executor (`executeTool`) and listed in the filesystem manifest so the AI agent knows they exist.

### `resolve_agent`

Resolves another agent by name or agentId to get their AXL multiaddr. Calls `GET /agents/resolve/:name` on the CommonOS API (which checks DB first, then falls back to ENS).

```
Input:  { "name": "agt_abc123" | "agent-agt-abc123.agents.commonos.eth" }
Output: { "agentId": "...", "multiaddr": "/ip4/...", "peerId": "...", "role": "...", "fleetId": "..." }
        or "[agent not found]" if resolution fails
```

### `send_axl_message`

Resolves a named agent and sends them a direct P2P message over AXL. Combines resolve + send in one tool call.

```
Input:  { "to_name": "agt_abc123", "message": "Hello from agent X" }
Output: "[message sent to agt_abc123 via AXL]"
        or "[agent not found]" if resolution fails
        or "[AXL send failed: ...]" if transport error
```

### Tool manifest addition

The two tools are added to the filesystem manifest table shown to the AI agent at the start of each native run:

```
| `resolve_agent`     | `name`              | Resolve another agent's AXL address via ENS/registry |
| `send_axl_message`  | `to_name`, `message`| Send a P2P message to a named agent via Gensyn AXL   |
```

---

## Cross-Fleet Messaging Flow

How Agent A (Fleet X) sends a message to Agent B (Fleet Y):

```
Agent A decides to contact Agent B
  → uses resolve_agent tool: { "name": "agt_b_id" }
  
  API: GET /agents/resolve/agt_b_id
    → checks DB (if same tenant, found immediately)
    → if not found: reads ENS  agent-agt-b-id.agents.commonos.eth
    → returns { multiaddr: "/ip4/.../tcp/.../p2p/Qm..." }

  → uses send_axl_message tool: { "to_name": "agt_b_id", "message": "..." }
  
  daemon: resolves name → gets multiaddr
    → POST http://localhost:4001/send  { to: multiaddr, data: message }
    → AXL binary delivers P2P to Agent B's pod
  
  Agent B's pod:
    → AXL inbox loop polls localhost:4001/messages
    → new message arrives → passed to handleTask(content)
    → Agent B processes it and optionally replies via send_axl_message
```

---

## Inbound Message Handling

The existing `pollAxlInbox()` / `startAxlInboxLoop()` already handles inbound messages — no changes needed here. Incoming AXL messages are routed to `handleTask`, the same path as AGC tasks.

One improvement worth noting for later: distinguish AXL messages from AGC tasks in the task handler (e.g. by prefixing with `[AXL from <peerId>]`) so the agent has sender context. Not required for the initial implementation.

---

## AXL API (localhost:4001)

The Gensyn AXL binary exposes a local HTTP API. The daemon uses three endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/peer` | GET | Returns `{ peerId, multiaddr }` for this node |
| `/messages` | GET | Returns inbox messages since last poll |
| `/send` | POST | Sends a message: `{ to: multiaddr, data: string }` |

The AXL binary is started by the pod entrypoint script (`entrypoint.sh`) before the daemon runs. The daemon uses `AXL_API_URL` env var (default: `http://localhost:4001`).

---

## Files to Modify

**`packages/daemon/src/daemon.ts`**

| Change | Location |
|--------|----------|
| `await registerAxlPeer()` → `void registerAxlPeer()` | `main()` |
| `await discoverFleetPeers()` → `void discoverFleetPeers()` | `main()` |
| Remove `sendAxlMessage` block | end of `handleTask()` |
| Add `resolveAgentByName(name)` helper | new function |
| Add `toolResolveAgent(args)` | new function |
| Add `toolSendAxlMessage(args)` | new function |
| Register `resolve_agent` and `send_axl_message` in `executeTool` switch | `executeTool()` |
| Add two rows to tool manifest table | `buildFilesystemManifest()` |

No new dependencies required — the daemon already uses `fetch` for all AXL calls.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AXL_API_URL` | `http://localhost:4001` | AXL binary local HTTP API |

No other env changes needed. AXL configuration (peer keys, listen port) is managed by the AXL binary itself via its own config.

---

## Graceful Degradation

| Condition | Behaviour |
|-----------|-----------|
| AXL binary not running at startup | `registerAxlPeer` logs warning, continues after 5 attempts |
| AXL down during task execution | Core loop unaffected; `send_axl_message` tool returns error string to agent |
| AXL inbox unreachable | Inbox loop logs error, sleeps `AXL_INBOX_MS`, retries — never throws |
| `resolve_agent` returns no multiaddr | `send_axl_message` returns `[agent not found]` to agent |

---

## Out of Scope for This Integration

- AXL authentication / message signing (AXL handles this at the transport layer)
- Persistent AXL message history (AXL inbox is ephemeral; messages are processed once)
- Agent-to-agent reply threading (agents manage this in their own context)
- AXL over external networks / non-pod deployments
