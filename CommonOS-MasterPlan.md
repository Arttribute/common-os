# COMMONOS — MASTER PLAN
> Version 1.6 — April 2026 | One-week hackathon build. Builds on Agent Commons infrastructure.
> A deployment and management framework for persistent AI agent fleets — each agent gets its own computer.

---

## BUILD STATUS — 2026-04-25

| Phase | What | Status |
|---|---|---|
| 1 — Scaffold & CI/CD | Monorepo, packages building, CI passing | ✅ Complete |
| 2 — Data Layer & Cloud | `@commonos/events` (full Zod schema), `@commonos/cloud` (AWS + GCP providers) | ✅ Complete · MongoDB wired · Redis replaced by in-memory for hackathon |
| 3 — Fleet Control Plane API | All routes, auth, provisioner, WebSocket stream, Agent Commons registration | ✅ Complete · awaiting MONGODB_URI + cloud credentials for live infra |
| 4 — Fleet Daemon | Config loader done, heartbeat loop done; task/file/AXL loops pending | 🔄 Partial |
| 5 — SDK & CLI | SDK complete (fleets, agents, tasks, world snapshot, streamUrl); CLI stubs | 🔄 Partial |
| 6 — World UI | Phaser isometric world, agent sprites, HUD, mock simulation + real API hook | ✅ Complete |
| 7 — Bounty Integrations | AXL, Uniswap | ⬜ Not started |

**Critical path:** Phase 3 ✅ — Phases 4, 5, and 7 now unblocked. Next: wire MONGODB_URI + AGENTCOMMONS_API_KEY, then test end-to-end.

---

## TABLE OF CONTENTS

1. [Vision](#1-vision)
2. [Problem Statement](#2-problem-statement)
3. [Solution](#3-solution)
4. [Relationship to Agent Commons](#4-relationship-to-agent-commons)
5. [Architecture Overview](#5-architecture-overview)
6. [Credentials & Auth](#6-credentials--auth)
7. [Permission Model](#7-permission-model)
8. [Data Architecture](#8-data-architecture)
   - 8.1 Storage Strategy
   - 8.2 MongoDB Collections
   - 8.3 Redis (Ephemeral Layer)
   - 8.4 Indexes
9. [Cloud-Init Bootstrap](#9-cloud-init-bootstrap)
10. [Monorepo Structure](#10-monorepo-structure)
11. [Build Phases](#11-build-phases)
    - 11.1 Phase 1 — Scaffold & CI/CD
    - 11.2 Phase 2 — Data Layer & Cloud Package
    - 11.3 Phase 3 — Fleet Control Plane API
    - 11.4 Phase 4 — Fleet Daemon
    - 11.5 Phase 5 — SDK & CLI
    - 11.6 Phase 6 — World UI
    - 11.7 Phase 7 — Bounty Integrations
12. [CI/CD & Release Workflow](#12-cicd--release-workflow)
13. [Tech Stack](#13-tech-stack)
14. [Bounty Strategy](#14-bounty-strategy)
15. [Demo Plan & Submission](#15-demo-plan--submission)
16. [Build Timeline (1 Week)](#16-build-timeline-1-week)

---

## 1. VISION

CommonOS is the infrastructure layer above Agent Commons. Where Agent Commons gives agents identity, wallets, memory, tools, and a runtime — CommonOS gives them a **computer of their own**.

The core primitive: **a persistent agent with its own computer, visible as a character in a world.**

A developer sees: an isolated VM, a running LLM runtime, a filesystem, an API. A non-technical user sees: an agent character sitting at a desk in an office, building their product. Same thing, two lenses.

There are two propositions at play, and both matter:

- **Proposition A — Infrastructure:** Give every AI agent its own computer. Persistent, isolated, stateful. Deploy a fleet with one command, manage it with a CLI or SDK, observe it in real time.
- **Proposition B — Experience:** Make agent work visible. A live spatial simulation where agents are embodied characters in a world — an office, a market, a city — and the world is a live map of real compute doing real work.

The infrastructure is the foundation. The experience is the moat. Nobody has built the combination.

The long-term vision: deploying a fleet of AI agents is as natural as deploying a team of workers. You describe the roles, pick a cloud, and your agents spin up as persistent workers — each with its own VM and filesystem — visible in a simulation that shows exactly what they're doing and producing in real time.

---

## 2. PROBLEM STATEMENT

AI agents are becoming more capable, but most are still run as short-lived processes instead of persistent workers with their own computer, files, and runtime.

Current agent frameworks are getting better at reasoning and orchestration, but deployment and operations remain weak. In many setups, agents do not run inside dedicated, isolated, stateful environments of their own. In multi-agent systems, that matters even more. Without clear runtime separation, agents are harder to manage as durable workers: working state is harder to preserve, failures are harder to isolate, credentials and local data are harder to contain, and responsibility across agents is harder to track.

As a result, running many agents together in production is still brittle, opaque, and operationally messy. And there is no standard platform for it — developers stitch together fragile infrastructure by hand with no visibility into what agents are actually doing.

---

## 3. SOLUTION

CommonOS is a deployment and management framework for persistent AI agent fleets. It gives every agent its own isolated cloud sandbox — its own computer, runtime, and persistent filesystem. On top of these dedicated environments, CommonOS provides a shared control plane for provisioning, task routing, permissions, monitoring, and coordination across the fleet.

Fleets are governed by a layered permission model: human masters authorize agent capabilities, manager agents supervise and coordinate across the fleet, worker agents act only within their assigned scope.

CommonOS also provides a live spatial interface where agents appear as active presences in shared environments — an office, a workspace, a floor — making the state of the fleet immediately legible without reading logs.

**Three layers:**

1. **Fleet Infrastructure** — one-command deployment of isolated agent VMs on AWS or GCP; each agent owns a real computer with its own filesystem and persistent runtime
2. **Control Plane** — provisioning, task routing, permission enforcement, event streaming, monitoring across the fleet
3. **World UI** — agents as embodied characters in a 2.5D isometric simulation; the world is a live map of real compute doing real work

**Framework agnostic by design.** CommonOS does not require Agent Commons agents. Any agent — LangGraph, CrewAI, AutoGen, raw API calls — can join a fleet by installing the `@commonos/sdk` and emitting events. Agent Commons agents are the native, first-class path and get the full feature set. Guest agents get task routing, event emission, and world UI visibility.

---

## 4. RELATIONSHIP TO AGENT COMMONS

CommonOS is a **separate project** that uses Agent Commons as its identity and capability layer. Agent Commons is not modified. The clean principle: Agent Commons owns the agent, CommonOS owns the computer the agent runs on.

### What Agent Commons provides (used as-is)

| Agent Commons capability | How CommonOS uses it |
|---|---|
| Agent identity (`POST /v1/agents`) | Fleet control plane calls this to create each agent record at deploy time |
| Agent wallets (`/v1/wallets`) | Each fleet agent gets a wallet provisioned at deploy time |
| `agc` CLI | Runs inside the VM as the native agent runtime for native-path agents |
| Sessions (LangGraph execution) | Agent's LLM loop runs via Commons sessions API |
| Tasks + scheduling (`/v1/tasks`) | Fleet routes tasks through Commons task system for native agents |
| Memory (vector DB) | Agent memory persists in Commons as normal |
| MCP tools/servers | Pre-configured per agent role at deploy time |
| Skills registry | Agents pull skills from Commons |
| A2A messaging | Baseline agent-to-agent protocol (AXL augments this at the VM layer) |
| `@agent-commons/sdk` | Fleet control plane uses this to call the Commons API |

### What CommonOS owns exclusively

| Layer | What it owns |
|---|---|
| VM instances | Instance ID, provider, region, status, uptime, agent token |
| Fleet topology | Fleet membership, agent roles, world positions, room assignments |
| Task routing | Which task goes to which VM, queue management |
| Event stream | Real-time structured events from all agents across the fleet |
| World state | Sprite positions, room occupancy, animation state |
| Permission model | Human master, manager agent, worker agent roles and scopes |

### The clean boundary

```
Agent Commons              CommonOS
─────────────              ────────
Agent identity       ←→    VM instance
Wallet                     Fleet membership
Sessions                   Task routing
Memory                     World position
MCP tools                  Event stream
agc runtime                Fleet daemon
                           Cloud provider (AWS)
                           Permission model
                           World UI
```

CommonOS calls Agent Commons via REST API at deploy time and for native agent sessions. No shared database, no shared process, no deeper coupling.

---

## 5. ARCHITECTURE OVERVIEW

```
┌──────────────────────────────────────────────────────────┐
│                      World UI                            │
│           Next.js + Phaser 3 (isometric 2.5D)            │
│     React HUD (fleet panel, inspector, command bar)      │
├──────────────────────────────────────────────────────────┤
│               Fleet Control Plane (Hono API)             │
│   auth · provisioning · task routing · event streaming   │
│   permission enforcement · world state management        │
├──────────────────────────────────────────────────────────┤
│               Agent Commons API                          │
│     identity · wallets · sessions · memory · tools       │
├──────────────────────────────────────────────────────────┤
│      Cloud Provider Layer (AWS EC2 · GCP Compute)        │
├──────────────┬────────────────┬─────────────────────────┤
│  Agent VM    │   Agent VM     │   Agent VM              │
│  daemon      │   daemon       │   daemon                │
│  agc runtime │   agc runtime  │   Docker image          │
│  /workspace  │   /workspace   │   /workspace            │
│  AXL node    │   AXL node     │   AXL node              │
└──────────────┴────────────────┴─────────────────────────┘
    Native agents (Agent Commons)     Guest agents (any framework)
```

### World UI — React + Phaser architecture

The world UI runs two rendering systems simultaneously in the same browser window. Phaser owns the `<canvas>` and renders the world. React renders a `<div>` that sits absolutely on top of the canvas — `pointer-events: none` by default so clicks fall through to Phaser, but individual HUD panels re-enable pointer events selectively. All state flows through Zustand. Phaser polls the store each frame; React reads from the same store. Neither calls the other directly.

```
WebSocket events → Zustand store → Phaser reads each frame
                               → React HUD reads reactively
```

### Two agent integration paths

**Native path (Agent Commons agents)**
- VM boots with `agc` pre-installed and authenticated via injected Commons credentials
- Full Agent Commons feature set: sessions, memory, wallets, MCP tools, skills
- Fleet daemon manages `agc` as a child process
- Events emitted by daemon on behalf of the agc runtime

**Guest path (any agent framework)**
- VM runs tenant's Docker image (tenant provides image URI at deploy time)
- Tenant installs `@commonos/sdk` in their image — calls `agent.emit()` and `agent.nextTask()`
- Fleet daemon manages the Docker container lifecycle
- Same world UI visibility as native agents

---

## 6. CREDENTIALS & AUTH

There are two distinct credential types. They have different scopes and different lifetimes.

### Tenant API Key (`cos_live_...`)

The human-facing credential. Authorizes full fleet management.

**How it's created:**
1. User signs up via Privy (web UI) — wallet connect or social login
2. On first login, the API creates a tenant document in MongoDB
3. A `cos_live_...` key is generated, stored hashed in the tenant document, and shown once in the dashboard

**Where it's used:**
- CLI — stored in `~/.commonos/config.json` after `commonos auth login`
- SDK — `new CommonOSClient({ apiKey: process.env.COMMONOS_API_KEY })`
- Direct API calls — `Authorization: Bearer cos_live_...` header

**What it can do:** create fleets, deploy agents, assign tasks, read logs, stop/terminate VMs, manage rooms, read world state. Everything a human operator needs.

**CLI config file:** `~/.commonos/config.json`
```json
{
  "apiKey": "cos_live_abc123...",
  "apiUrl": "https://api.commonos.dev",
  "defaultProvider": "aws",
  "defaultRegion": "us-east-1"
}
```

---

### Agent VM Token (`cos_agent_...`)

A scoped, per-agent credential. Generated at deploy time. Injected into the VM via cloud-init. Never exposed to the tenant.

**How it's created:**
- Generated by the provisioner when `POST /fleets/:id/agents` is called
- Stored in the agent document (hashed) in MongoDB
- Injected into the VM as the env var `COMMONOS_AGENT_TOKEN`

**What it can do (strictly scoped):**
- `POST /events` — only for its own `agentId`
- `GET /agents/:agentId/tasks/next` — only its own task queue
- `POST /agents/:agentId/tasks/:taskId/complete` — only its own tasks
- Nothing else — cannot list fleets, cannot create or terminate anything

**Why separate from tenant key:** if a VM is compromised, the blast radius is limited to that one agent. The tenant key stays safe.

---

### API Auth — Two Flows

The Hono API handles two distinct auth flows in the same middleware:

```typescript
app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (token?.startsWith('cos_live_')) {
    // Tenant key flow — used by CLI and SDK
    const tenant = await db.collection('tenants').findOne({ apiKeyHash: hash(token) })
    if (!tenant) return c.json({ error: 'unauthorized' }, 401)
    c.set('tenantId', tenant._id)
    c.set('authType', 'tenant')

  } else if (token?.startsWith('cos_agent_')) {
    // Agent token flow — used by daemon inside VM
    const agent = await db.collection('agents').findOne({ agentTokenHash: hash(token) })
    if (!agent) return c.json({ error: 'unauthorized' }, 401)
    c.set('tenantId', agent.tenantId)
    c.set('agentId', agent._id)
    c.set('authType', 'agent')

  } else {
    // Privy JWT flow — used by web UI
    const payload = await verifyPrivyJwt(token)
    const tenant = await db.collection('tenants').findOne({ privyUserId: payload.sub })
    c.set('tenantId', tenant._id)
    c.set('authType', 'privy')
  }

  await next()
})
```

Route-level guards enforce that agent-scoped routes reject tenant keys and vice versa.

---

### SDK — Two Client Classes

Both exported from `@commonos/sdk`:

```typescript
// Human operator — uses tenant API key
const client = new CommonOSClient({
  apiKey: process.env.COMMONOS_API_KEY   // cos_live_...
})

await client.fleets.create({ name: 'eng-team', provider: 'aws', region: 'us-east-1' })
await client.agents.deploy({ fleetId: 'flt_xyz', role: 'engineer', systemPrompt: '...' })
await client.tasks.send({ agentId: 'agt_xyz', description: 'build the auth module' })
await client.agents.logs('agt_xyz')
```

```typescript
// Agent runtime inside VM — uses agent token (injected by cloud-init)
const agent = new CommonOSAgentClient({
  agentToken: process.env.COMMONOS_AGENT_TOKEN,  // cos_agent_...
  agentId:    process.env.COMMONOS_AGENT_ID
})

await agent.emit({ type: 'state_change', status: 'online' })
const task = await agent.nextTask()
if (task) {
  await agent.emit({ type: 'task_start', taskId: task.id, description: task.description })
  // ... run agent logic ...
  await agent.completeTask(task.id, output)
}
```

---

## 7. PERMISSION MODEL

CommonOS enforces a three-tier permission hierarchy. This is what makes fleet operation safe and auditable.

```
┌─────────────────────────────────────┐
│         Human Master                │
│  Full control. Authorizes all       │
│  sensitive operations via Privy     │
│  wallet signature or session.       │
└─────────────┬───────────────────────┘
              │ can create and assign
              ▼
┌─────────────────────────────────────┐
│         Manager Agent               │
│  Read-only across all worker        │
│  filesystems in the fleet.          │
│  Can assign tasks to workers.       │
│  Cannot write to other agents'      │
│  workspaces. Cannot terminate VMs.  │
└─────────────┬───────────────────────┘
              │ routes tasks to
              ▼
┌─────────────────────────────────────┐
│         Worker Agent                │
│  Write access only within           │
│  /workspace of its own VM.          │
│  Cannot read other agents'          │
│  workspaces. Cannot self-assign.    │
└─────────────────────────────────────┘
```

### Role assignment

Each agent document has a `role` field and a `permissionTier` field:

```
permissionTier: 'manager' | 'worker'
```

Manager agents are deployed with elevated tokens that allow:
- `GET /fleets/:id/agents/:agentId/fs` — read any worker's `/workspace` (read-only, proxied by fleet control plane via AWS SSM or daemon)
- `POST /fleets/:id/agents/:agentId/task` — assign tasks to workers

Worker agents have tokens scoped only to their own VM. They cannot call any cross-agent endpoints.

### Human authorization

Certain operations require active human authorization — they cannot be initiated by any agent:
- Deploying a new agent VM
- Terminating an agent VM
- Elevating an agent to manager tier
- Increasing an agent's tool permissions

These routes validate `authType === 'tenant'` or `authType === 'privy'`. Agent tokens are rejected outright.

### Manager agent filesystem access

The fleet daemon on each worker VM exposes a restricted read-only HTTP endpoint on localhost (`127.0.0.1:7070`) that serves `/workspace` contents. The fleet control plane tunnels to this endpoint via AWS SSM Session Manager when a manager agent calls the filesystem read API. No direct VM-to-VM networking is required.

---

## 8. DATA ARCHITECTURE

### 8.1 Storage Strategy

CommonOS uses **MongoDB** as its primary database and **Redis** as the ephemeral layer.

**Why MongoDB:**
- Events are the highest-volume collection — each event type has a different payload shape. MongoDB's flexible document model handles this without nullable columns or JSON casting.
- Agent configs are JSON-heavy (tools, system prompt, world config, cloud config, AXL peer info) — embedded documents are cleaner than relational columns.
- No schema migrations during a one-week build. Zod handles validation at the API boundary; MongoDB stores whatever passes.
- Fleet → agents → tasks is a document hierarchy with no complex joins.

**Why Redis alongside:**
- Task queues must be fast, ephemeral, and pop-able — Redis lists are the right primitive.
- Agent presence (online/offline) is real-time state, not a persistent record.
- AXL peer directory per fleet is a short-lived lookup table rebuilt on each VM boot.
- WebSocket session routing needs sub-millisecond reads.

**What Agent Commons owns (not duplicated):**
Agent identity records, wallet data, session history, vector memory, MCP tool configs, and skills all remain in Agent Commons' own database. CommonOS references these by ID only.

---

### 8.2 MongoDB Collections

#### `tenants`
One document per registered tenant.

```json
{
  "_id": "ten_01JRXYZ",
  "name": "Acme Corp",
  "email": "admin@acme.com",
  "privyUserId": "did:privy:abc123",
  "walletAddress": "0xabc...def",
  "apiKeyHash": "sha256:...",
  "cloudConfig": {
    "provider": "aws",
    "region": "us-east-1",
    "vpcId": "vpc-0abc123",
    "subnetId": "subnet-0abc456",
    "securityGroupId": "sg-0abc789",
    "iamInstanceProfile": "commonos-agent-profile-ten_01JRXYZ"
  },
  "plan": "free",
  "createdAt": "2026-04-22T10:00:00Z",
  "updatedAt": "2026-04-22T10:00:00Z"
}
```

Note: `apiKeyHash` stores the SHA-256 hash of the `cos_live_...` key, never the plaintext.

---

#### `fleets`
One document per fleet. A fleet is a named group of agents sharing a world.

```json
{
  "_id": "flt_01JRXYZ",
  "tenantId": "ten_01JRXYZ",
  "name": "Engineering Team",
  "worldType": "office",
  "worldConfig": {
    "tilemap": "office-v1",
    "rooms": [
      { "id": "dev-room",     "label": "Dev Room",     "bounds": { "x": 0,  "y": 0,  "w": 10, "h": 8 } },
      { "id": "design-room",  "label": "Design Room",  "bounds": { "x": 12, "y": 0,  "w": 8,  "h": 8 } },
      { "id": "meeting-room", "label": "Meeting Room",  "bounds": { "x": 0,  "y": 10, "w": 6,  "h": 6 } }
    ]
  },
  "status": "active",
  "agentCount": 3,
  "createdAt": "2026-04-22T10:00:00Z",
  "updatedAt": "2026-04-22T10:00:00Z"
}
```

---

#### `agents`
One document per deployed agent VM. Central record linking Commons identity, VM details, world position, AXL peer info, and permission tier.

```json
{
  "_id": "agt_01JRXYZ",
  "fleetId": "flt_01JRXYZ",
  "tenantId": "ten_01JRXYZ",

  "commons": {
    "agentId": "agt_commons_abc123",
    "apiKey":  "sk_commons_...",
    "walletAddress": "0xabc...def"
  },

  "vm": {
    "instanceId":   "i-0abc123def456",
    "provider":     "aws",
    "region":       "us-east-1",
    "instanceType": "t3.medium",
    "publicIp":     "52.10.20.30",
    "privateIp":    "10.0.1.42",
    "diskGb":       50
  },

  "agentTokenHash": "sha256:...",

  "status": "running",

  "permissionTier": "worker",

  "config": {
    "role":            "backend-engineer",
    "systemPrompt":    "You are a senior backend engineer...",
    "integrationPath": "native",
    "dockerImage":     null,
    "tools":           ["write_file", "run_command", "browse", "send_message"]
  },

  "world": {
    "room":   "dev-room",
    "x":      5,
    "y":      3,
    "facing": "south"
  },

  "axl": {
    "peerId":    "12D3KooWAbC...",
    "multiaddr": "/ip4/52.10.20.30/tcp/4001/p2p/12D3KooWAbC..."
  },

  "lastHeartbeatAt": "2026-04-22T10:05:00Z",
  "startedAt":       "2026-04-22T10:01:00Z",
  "createdAt":       "2026-04-22T10:00:00Z",
  "updatedAt":       "2026-04-22T10:05:00Z"
}
```

**`status` enum:** `provisioning` | `starting` | `running` | `idle` | `stopping` | `stopped` | `terminated` | `error`

**`permissionTier` enum:** `manager` | `worker`

**`integrationPath` enum:** `native` | `guest`

---

#### `tasks`
One document per task assigned to an agent.

```json
{
  "_id": "tsk_01JRXYZ",
  "agentId":  "agt_01JRXYZ",
  "fleetId":  "flt_01JRXYZ",
  "tenantId": "ten_01JRXYZ",

  "assignedBy":        "human",
  "assignedByAgentId": null,

  "description": "Build the user authentication module with JWT and refresh tokens",
  "status":      "completed",

  "output": "Created /workspace/src/auth/jwt.ts, /workspace/src/auth/middleware.ts ...",
  "error":  null,

  "startedAt":   "2026-04-22T10:10:00Z",
  "completedAt": "2026-04-22T10:25:00Z",
  "createdAt":   "2026-04-22T10:09:00Z"
}
```

**`status` enum:** `queued` | `running` | `completed` | `failed` | `cancelled`

**`assignedBy` enum:** `human` | `manager-agent`

---

#### `events`
One document per agent event. High volume. TTL index auto-expires after 30 days. Powers the world UI event stream and the logs API.

```json
{
  "_id": "evt_01JRXYZ",
  "agentId":  "agt_01JRXYZ",
  "fleetId":  "flt_01JRXYZ",
  "tenantId": "ten_01JRXYZ",
  "type":     "action",
  "payload": {
    "label":  "writing code",
    "detail": "Creating JWT middleware in /workspace/src/auth/middleware.ts"
  },
  "createdAt": "2026-04-22T10:12:00Z"
}
```

**All event type payloads:**

| `type` | Payload fields |
|---|---|
| `state_change` | `status: 'online' \| 'idle' \| 'working' \| 'error' \| 'offline'` |
| `task_start` | `taskId: string, description: string` |
| `task_complete` | `taskId: string, output?: string` |
| `action` | `label: string, detail?: string` |
| `message_sent` | `toAgentId: string, preview: string` |
| `message_recv` | `fromAgentId: string, preview: string` |
| `world_move` | `room: string, x: number, y: number` |
| `file_changed` | `path: string, op: 'create' \| 'modify' \| 'delete'` |
| `error` | `message: string` |
| `heartbeat` | *(empty payload)* |

---

#### `messages`
One document per inter-agent message. AXL handles transport; this is the persistent record.

```json
{
  "_id": "msg_01JRXYZ",
  "fromAgentId":  "agt_01JRXYZ",
  "toAgentId":    "agt_02JRXYZ",
  "fleetId":      "flt_01JRXYZ",
  "tenantId":     "ten_01JRXYZ",
  "content":      "Auth module complete — ready for review.",
  "axlMessageId": "axl_...",
  "deliveredAt":  "2026-04-22T10:26:00Z",
  "readAt":       null,
  "createdAt":    "2026-04-22T10:25:58Z"
}
```

---

#### `world_states`
One document per fleet. Canonical snapshot of world state loaded by the UI on initial connect. Updated on every `world_move` event. Avoids loading all agent fields on world load — only position and status are needed.

```json
{
  "_id": "wld_flt_01JRXYZ",
  "fleetId":  "flt_01JRXYZ",
  "tenantId": "ten_01JRXYZ",
  "agents": [
    {
      "agentId":        "agt_01JRXYZ",
      "role":           "backend-engineer",
      "permissionTier": "worker",
      "status":         "working",
      "world": { "room": "dev-room", "x": 5, "y": 3, "facing": "south" }
    },
    {
      "agentId":        "agt_02JRXYZ",
      "role":           "manager",
      "permissionTier": "manager",
      "status":         "idle",
      "world": { "room": "meeting-room", "x": 2, "y": 2, "facing": "east" }
    }
  ],
  "updatedAt": "2026-04-22T10:26:00Z"
}
```

---

### 8.3 Redis (Ephemeral Layer)

| Key pattern | Type | TTL | Purpose |
|---|---|---|---|
| `tenant:{id}:agent:{id}:tasks` | List | None | Task queue — daemon RPUSH, daemon BLPOP |
| `tenant:{id}:fleet:{id}:peers` | Hash | None | AXL peer directory — `agentId → multiaddr` |
| `tenant:{id}:agent:{id}:presence` | String | 90s | Online presence — daemon refreshes every 30s |
| `tenant:{id}:fleet:{id}:ws` | Set | None | Active WebSocket connection IDs for event broadcast |
| `ratelimit:{apiKey}` | String | 60s | Rate limiting counter per tenant |

---

### 8.4 Indexes

**`tenants`**
```
{ apiKeyHash: 1 }     unique   — auth middleware lookup on every request
{ privyUserId: 1 }    unique   — Privy JWT auth lookup
```

**`fleets`**
```
{ tenantId: 1, createdAt: -1 }
```

**`agents`**
```
{ tenantId: 1, status: 1 }
{ fleetId: 1 }
{ "vm.instanceId": 1 }     unique
{ "commons.agentId": 1 }   unique
{ agentTokenHash: 1 }      unique   — agent token auth middleware
{ "axl.peerId": 1 }
```

**`tasks`**
```
{ agentId: 1, status: 1, createdAt: -1 }
{ fleetId: 1, status: 1 }
```

**`events`**
```
{ fleetId: 1, createdAt: -1 }
{ agentId: 1, createdAt: -1 }
{ tenantId: 1, createdAt: -1 }
{ createdAt: 1 }   TTL 2592000s (30 days)
```

**`messages`**
```
{ toAgentId: 1, readAt: 1 }
{ fleetId: 1, createdAt: -1 }
```

**`world_states`**
```
{ fleetId: 1 }   unique
```

---

## 9. CLOUD-INIT BOOTSTRAP

This is the script that runs once when a VM first boots. It installs everything the agent needs and starts the daemon. Built by the provisioner and injected as EC2 UserData (base64-encoded).

```bash
#!/bin/bash
set -e

# ── System setup ────────────────────────────────────────────
apt-get update -y
apt-get install -y curl git docker.io

# ── Node.js 22 ──────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# ── AXL binary ──────────────────────────────────────────────
# Gensyn AXL — P2P encrypted inter-agent communication
curl -fsSL https://install.axl.gensyn.ai | bash -
export PATH="$PATH:/usr/local/bin"

# ── CommonOS daemon ─────────────────────────────────────────
npm install -g @commonos/daemon

# ── Agent Commons CLI (native path only) ────────────────────
# INTEGRATION_PATH is injected by provisioner
if [ "${INTEGRATION_PATH}" = "native" ]; then
  npm install -g @agent-commons/cli
fi

# ── Agent workspace ─────────────────────────────────────────
mkdir -p /workspace
useradd -m -d /workspace -s /bin/bash agent
chown -R agent:agent /workspace

# ── Write agent config ──────────────────────────────────────
mkdir -p /etc/commonos
cat > /etc/commonos/config.json << 'AGENTCONFIG'
{
  "agentId":         "${AGENT_ID}",
  "tenantId":        "${TENANT_ID}",
  "agentToken":      "${AGENT_TOKEN}",
  "fleetId":         "${FLEET_ID}",
  "apiUrl":          "${CONTROL_PLANE_URL}",
  "commonsApiKey":   "${COMMONS_API_KEY}",
  "commonsAgentId":  "${COMMONS_AGENT_ID}",
  "integrationPath": "${INTEGRATION_PATH}",
  "dockerImage":     "${DOCKER_IMAGE}",
  "role":            "${AGENT_ROLE}",
  "worldRoom":       "${WORLD_ROOM}",
  "worldX":          ${WORLD_X},
  "worldY":          ${WORLD_Y}
}
AGENTCONFIG

# ── Systemd: AXL node ───────────────────────────────────────
cat > /etc/systemd/system/commonos-axl.service << 'EOF'
[Unit]
Description=CommonOS AXL Node
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/axl start --port 4001
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

# ── Systemd: CommonOS daemon ─────────────────────────────────
cat > /etc/systemd/system/commonos-daemon.service << 'EOF'
[Unit]
Description=CommonOS Fleet Daemon
After=network.target commonos-axl.service
Requires=commonos-axl.service

[Service]
Type=simple
ExecStart=/usr/bin/commonos-daemon
Restart=always
RestartSec=5
User=root
EnvironmentFile=/etc/commonos/config.json

[Install]
WantedBy=multi-user.target
EOF

# ── Start services ───────────────────────────────────────────
systemctl daemon-reload
systemctl enable commonos-axl commonos-daemon
systemctl start commonos-axl
sleep 3   # give AXL time to bind
systemctl start commonos-daemon
```

**Variables injected by provisioner at build time:**

| Variable | Source |
|---|---|
| `AGENT_ID` | Generated by provisioner |
| `TENANT_ID` | From tenant record |
| `AGENT_TOKEN` | Generated by provisioner (`cos_agent_...`) |
| `FLEET_ID` | From fleet record |
| `CONTROL_PLANE_URL` | Platform env var |
| `COMMONS_API_KEY` | From Commons agent creation response |
| `COMMONS_AGENT_ID` | From Commons agent creation response |
| `INTEGRATION_PATH` | `native` or `guest` — from deploy request |
| `DOCKER_IMAGE` | Tenant's image URI (guest path only) |
| `AGENT_ROLE` | From deploy request |
| `WORLD_ROOM` | From deploy request |
| `WORLD_X` / `WORLD_Y` | Assigned by provisioner spawn-point logic |

---

## 10. MONOREPO STRUCTURE

```
/commonos
├── apps/
│   ├── api/                   # Hono — fleet control plane
│   │   ├── src/
│   │   │   ├── index.ts       # app entry, middleware registration
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts    # tenant key + agent token + Privy JWT
│   │   │   │   └── ratelimit.ts
│   │   │   ├── routes/
│   │   │   │   ├── fleets.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── events.ts
│   │   │   │   └── stream.ts  # WebSocket handler
│   │   │   ├── services/
│   │   │   │   ├── provisioner.ts   # VM deploy + cloud-init build
│   │   │   │   ├── cloud-init.ts    # script template builder
│   │   │   │   └── world.ts         # world state management
│   │   │   └── db/
│   │   │       └── mongo.ts   # MongoDB client + collection helpers
│   │   └── package.json
│   │
│   └── web/                   # Next.js 15 — world UI + dashboard
│       ├── app/
│       │   ├── page.tsx       # landing
│       │   ├── auth/          # Privy login
│       │   ├── world/
│       │   │   └── page.tsx   # client-only, mounts Phaser
│       │   └── settings/      # account, API keys
│       ├── components/
│       │   ├── PhaserGame.tsx # mounts Phaser canvas
│       │   └── hud/
│       │       ├── HUD.tsx
│       │       ├── FleetPanel.tsx
│       │       ├── Inspector.tsx
│       │       └── CommandBar.tsx
│       ├── game/
│       │   ├── scenes/
│       │   │   ├── BootScene.ts
│       │   │   ├── WorldScene.ts
│       │   │   └── UIScene.ts
│       │   ├── entities/
│       │   │   └── AgentSprite.ts
│       │   └── systems/
│       │       ├── animationMapper.ts
│       │       └── pathfinding.ts
│       ├── store/
│       │   ├── agentStore.ts
│       │   ├── worldStore.ts
│       │   └── socketStore.ts
│       └── package.json
│
├── packages/
│   ├── sdk/                   # @commonos/sdk — TypeScript client (tenant + agent)
│   ├── cli/                   # @commonos/cli — `commonos` binary
│   ├── cloud/                 # @commonos/cloud — AWS provider (GCP post-hackathon)
│   ├── event-schema/          # @commonos/events — shared Zod event types
│   └── daemon/                # @commonos/daemon — process running inside each VM
│
├── infra/
│   ├── terraform/aws/         # VPC, EC2, IAM, security groups per tenant
│   └── terraform/gcp/         # VPC Network, Compute, IAM per tenant
│                              # Note: Terraform runs post-hackathon (automated per-tenant VPC).
│                              # For hackathon: one VPC per provider set up manually in console.
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── .changeset/
├── pnpm-workspace.yaml
└── package.json
```

---

## 11. BUILD PHASES

### 11.1 Phase 1 — Scaffold & CI/CD
*Goal: repo is alive, CI passes, packages build* · **✅ COMPLETE**

- [x] Init monorepo — pnpm workspaces, Node 22, pnpm 9.15.3
- [x] Adapt `ci.yml` from agent-commons — update package name refs
- [x] Adapt `release.yml` from agent-commons — update auto-patch checks to `@commonos/sdk` + `@commonos/cli`, update post-publish bump to `apps/web`
- [x] Set up Changesets config
- [x] Set up Husky
- [x] Create package stubs with correct `package.json` (tsup, publishConfig, engines node>=22)
- [x] Root `package.json` scripts: `build`, `release`, `version-ci`, `changeset`
- [x] First push to `main` — confirm CI passes

**Secrets:** `GH_PAT`, `NPM_TOKEN`

---

### 11.2 Phase 2 — Data Layer & Cloud Package
*Goal: MongoDB connected, AWS VM provisioned end-to-end* · **✅ Cloud packages complete · ⬜ MongoDB/Redis wiring pending (moved to Phase 3)**

**MongoDB setup** ⬜ — to be wired inside `apps/api/src/db/mongo.ts` during Phase 3
- MongoDB Atlas free tier for development
- Native driver (`mongodb` npm package), no ORM
- Zod validation at API boundary
- Implement all collections from Section 8.2
- Create all indexes from Section 8.4

**`packages/event-schema` → `@commonos/events`** ✅ Complete
- Full Zod discriminated union for all event types
- Shared by daemon, API, and world UI

**`packages/cloud` → `@commonos/cloud`**

```typescript
interface AgentInstanceConfig {
  tenantId:      string
  agentId:       string
  region:        string
  instanceType:  string          // 't3.medium' | 'e2-medium' | etc.
  diskGb:        number
  startupScript: string          // cloud-init userdata (base64 for AWS, raw for GCP)
  tags:          Record<string, string>
  // GCP-specific
  gcpProject?:   string
  gcpZone?:      string
}

interface ProvisionedInstance {
  instanceId: string             // EC2 instance ID or GCP instance name
  publicIp:   string
  privateIp:  string
  provider:   'aws' | 'gcp'
  status:     'pending' | 'running' | 'stopped' | 'terminated'
}

interface CloudProvider {
  provision(config: AgentInstanceConfig): Promise<ProvisionedInstance>
  terminate(instanceId: string):          Promise<void>
  stop(instanceId: string):               Promise<void>
  start(instanceId: string):              Promise<void>
  getStatus(instanceId: string):          Promise<ProvisionedInstance>
}
```

- `AWSProvider` — `@aws-sdk/client-ec2`: `RunInstances`, `TerminateInstances`, `DescribeInstances`, `StartInstances`, `StopInstances`
- `GCPProvider` — `@google-cloud/compute`: `instances.insert`, `instances.delete`, `instances.get`, `instances.start`, `instances.stop`
- `getCloudProvider(provider: 'aws' | 'gcp', region: string): CloudProvider` — factory, one line to switch

**Tenant `cloudConfig` per provider:**

```json
// AWS tenant
"cloudConfig": {
  "provider":            "aws",
  "region":              "us-east-1",
  "vpcId":               "vpc-0abc123",
  "subnetId":            "subnet-0abc456",
  "securityGroupId":     "sg-0abc789",
  "iamInstanceProfile":  "commonos-agent-profile-ten_xyz"
}

// GCP tenant
"cloudConfig": {
  "provider":            "gcp",
  "region":              "us-central1",
  "zone":                "us-central1-a",
  "projectId":           "my-gcp-project",
  "network":             "commonos-agent-network",
  "subnetwork":          "commonos-agent-subnet",
  "serviceAccountEmail": "commonos-agent@my-gcp-project.iam.gserviceaccount.com"
}
```

**Env vars required for each provider:**

```
# AWS
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
AWS_AGENT_AMI_ID          # base Ubuntu 22.04 AMI ID

# GCP
GCP_PROJECT_ID
GCP_SERVICE_ACCOUNT_KEY   # JSON key file contents (base64)
GCP_AGENT_IMAGE           # e.g. projects/ubuntu-os-cloud/global/images/ubuntu-2204-lts
```

**Environment variables required by API:**
```
MONGODB_URI
REDIS_URL

# AWS
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
AWS_AGENT_AMI_ID           # base Ubuntu 22.04 AMI ID

# GCP
GCP_PROJECT_ID
GCP_SERVICE_ACCOUNT_KEY    # base64-encoded JSON key
GCP_AGENT_IMAGE            # projects/ubuntu-os-cloud/global/images/ubuntu-2204-lts

COMMONS_API_URL            # Agent Commons API base URL
COMMONS_API_KEY            # platform-level key for creating agents/wallets
CONTROL_PLANE_URL          # this API's public URL (injected into VMs)
PRIVY_APP_ID
PRIVY_APP_SECRET
JWT_SECRET
```

---

### 11.3 Phase 3 — Fleet Control Plane API
*Goal: deploy agent fleet via API; VMs provision and report back* · **⬜ NOT STARTED — CRITICAL PATH**

> **Next up.** `apps/api/src/index.ts` currently has only a health endpoint. Everything below needs to be built here.

**Auth middleware** — three flows as documented in Section 6

**Routes**

```
POST   /auth/tenant                         # first-login tenant creation (Privy)
GET    /auth/me                             # resolve current tenant

POST   /fleets                              # create fleet
GET    /fleets                              # list tenant's fleets
GET    /fleets/:id                          # fleet detail + world config

POST   /fleets/:id/agents                   # deploy agent VM
GET    /fleets/:id/agents                   # list agents + VM status
GET    /fleets/:id/agents/:agentId          # agent detail
PATCH  /fleets/:id/agents/:agentId          # update world position, role
DELETE /fleets/:id/agents/:agentId          # terminate VM

POST   /fleets/:id/agents/:agentId/task     # assign task (human only)
GET    /fleets/:id/agents/:agentId/tasks    # task history
GET    /fleets/:id/agents/:agentId/fs       # read agent workspace (manager only)

GET    /fleets/:id/stream                   # WebSocket — real-time event stream
GET    /fleets/:id/world                    # current world_state snapshot

POST   /events                              # agent daemon POSTs events (agent token only)
```

**Provisioner deploy sequence**
1. Validate request — tenant key required, human only
2. Call Agent Commons API → `POST /v1/agents` → get `commons_agent_id`
3. Call Agent Commons API → `POST /v1/wallets` → get wallet address
4. Generate `cos_agent_...` token, hash it
5. Assign world spawn point (random unoccupied tile in target room)
6. Build cloud-init script from template (Section 9)
7. Call `AWSProvider.provision()` → get `instanceId`
8. Write agent document to MongoDB with `status: provisioning`
9. Register agent in Redis AXL peer directory (multiaddr populated when daemon registers)
10. Return `{ agentId, instanceId, status: 'provisioning' }`
11. Daemon boots → emits `state_change: online` → API updates status to `running`

**Event ingestion — `POST /events`**
1. Validate agent token → resolve agent
2. Parse + validate event with Zod
3. Write to `events` collection
4. If `world_move`: update `agents.world` + `world_states` snapshot
5. If `state_change`: update `agents.status`
6. If `heartbeat`: update `agents.lastHeartbeatAt`
7. Broadcast to all WebSocket subscribers on `tenant:{id}:fleet:{id}:ws`

---

### 11.4 Phase 4 — Fleet Daemon
*Goal: persistent process in every VM; platform always informed* · **🔄 PARTIAL**

**What's done:**
- [x] `DaemonConfig` type + `loadConfig()` reading `/etc/commonos/config.json`
- [x] `CommonOSAgentClient` instantiation from config
- [x] Startup: emits `state_change: online`
- [x] Heartbeat loop every 30s

**What's left:**
- [ ] Connect to AXL node and register peer multiaddr
- [ ] Task inbox loop (BLPOP from Redis, forward to agent runtime)
- [ ] File watcher (chokidar on `/workspace`, emit `file_changed`)
- [ ] Health monitor (check agc / Docker alive, emit `error` on crash)
- [ ] Spawn agc (native path) or Docker container (guest path)

**`packages/daemon` → `@commonos/daemon`**

Published to npm. Installed globally via cloud-init. Runs as a systemd service. Tenants cannot replace or bypass it.

**Startup sequence**
1. Read `/etc/commonos/config.json` ✅
2. Connect to AXL — `axl connect --port 4001`
3. Register AXL peer address with fleet control plane: `PATCH /fleets/:id/agents/:agentId` with `axl.multiaddr`
4. Push AXL multiaddr to Redis peer directory: `HSET tenant:{id}:fleet:{id}:peers {agentId} {multiaddr}`
5. Start agent runtime (native: spawn `agc`; guest: start Docker container)
6. Emit `state_change: online` ✅
7. Begin main loops

**Main loops (concurrent)**

```
Heartbeat loop   — every 30s: emit heartbeat, refresh Redis presence key   ✅ Done
Task inbox loop  — every 5s: BLPOP from Redis task queue, forward to agent runtime
File watcher     — chokidar on /workspace: emit file_changed on create/modify/delete
Health monitor   — every 10s: check agc process / Docker container alive; emit error on crash
AXL inbox        — listen for inbound AXL messages: deliver to agent runtime as incoming task/message
```

**AXL inter-agent messaging**
- Outbound: agent runtime calls `agent.emit({ type: 'message_sent', toAgentId, preview })` → daemon looks up `toAgentId` multiaddr from Redis peer directory → sends via AXL
- Inbound: daemon receives AXL message → delivers to agent runtime → emits `message_recv` event to control plane

---

### 11.5 Phase 5 — SDK & CLI
*Goal: developers can manage fleets from code and terminal* · **🔄 PARTIAL**

**What's done:**
- [x] `CommonOSClient` — `fleets.create/list/get`, `agents.deploy/list/get/terminate/logs`, `tasks.send/list`
- [x] `CommonOSAgentClient` — `emit(event)`, `nextTask()`, `completeTask(taskId, output)`
- [x] CLI binary structure — all commands defined: `auth`, `fleet`, `agent`, `task`
- [x] All command flags and arguments wired up

**What's left (unblocked once Phase 3 API routes exist):**
- [ ] `commonos auth login` — open browser → Privy flow → write `~/.commonos/config.json`
- [ ] `commonos auth whoami` — read config, call `GET /auth/me`
- [ ] All fleet/agent/task commands — replace stub `console.log` with real API calls via SDK
- [ ] `commonos agent exec` — SSM session into VM shell
- [ ] Add Chalk + Ora for output formatting
- [ ] Zod-typed response parsing in SDK

**`packages/sdk` → `@commonos/sdk`** ✅ Client classes implemented
- tsup, dual ESM/CJS, Zod-typed responses
- Exports `CommonOSClient` (tenant scope) and `CommonOSAgentClient` (agent scope)
- See Section 6 for full usage examples

**`packages/cli` → `@commonos/cli`** 🔄 Structure done, actions are stubs
- Binary: `commonos`
- Stack: Commander + Chalk + Ora (same pattern as `agc-cli`)
- Config: `~/.commonos/config.json`
- First-run: `commonos auth login` opens browser → Privy → exchanges for API key → writes config

```
commonos auth login
commonos auth whoami
commonos auth logout

commonos fleet create --name <n> --provider aws --region us-east-1
commonos fleet ls
commonos fleet status <fleet-id>

commonos agent deploy --fleet <id> --role <role> --prompt <file|string>
commonos agent deploy --fleet <id> --image <docker-uri>   # guest path
commonos agent ls --fleet <id>
commonos agent logs <agent-id>
commonos agent exec <agent-id>          # SSM session into VM shell
commonos agent stop <agent-id>
commonos agent terminate <agent-id>

commonos task send <agent-id> <description>
commonos task ls <agent-id>

commonos room ls --fleet <id>
commonos room move <agent-id> <room>
```

---

### 11.6 Phase 6 — World UI
*Goal: agents visible as sprites in a live isometric simulation* · **✅ COMPLETE**

**What's built (`apps/web/`):**
- [x] Zustand stores: `agentStore`, `worldStore`, `socketStore` (exact shapes from master plan)
- [x] Mock simulation: 33s looping cycle — 3 agents assign/work/complete tasks, speech bubbles, moves
- [x] Phaser isometric tile grid — rooms color-coded, programmatic rendering (no external assets)
- [x] `AgentSprite` — Container with body, head, status dot, name, action label, speech bubble; bob animations
- [x] `WorldScene` — spawns sprites from store, syncs each frame, camera pan/zoom, agent selection
- [x] `BootScene` — preload stub ready for Kenney tileset swap
- [x] `UIScene` — reserved for fixed Phaser HUD elements
- [x] `PhaserGame.tsx` — canvas component, dynamic import with ssr:false
- [x] `HUD.tsx` — React overlay, pointer-events managed per panel
- [x] `FleetPanel` — live agent list with status dots and current actions
- [x] `Inspector` — selected agent detail: status, task, action history
- [x] `CommandBar` — task assignment input, assigns to selected agent
- [x] Routes: `/` (landing), `/world` (full client), `/auth` (Privy-gated), `/settings` (stub)
- [x] Privy auth — conditional on `NEXT_PUBLIC_PRIVY_APP_ID`; bypassed in demo mode
- [x] `WorldClient` — mounts Phaser + HUD, starts mock simulation

**Remaining / next connections:**
- [ ] Replace `startMockSimulation()` with real `GET /fleets/:id/world` + WebSocket once API is live
- [ ] Swap programmatic sprites for Kenney isometric tileset assets (post-hackathon)

**Stack:** Next.js 15 (App Router) + Phaser 3 + Zustand

**Auth: Privy**
Privy handles wallet connect + social login. On first Privy login, the API creates the tenant record. Subsequent logins resolve the existing tenant. The Privy JWT is sent as the `Authorization` header for web UI requests.

**Route structure**
```
/               # landing / marketing
/auth           # Privy login
/world          # the product — client-only
/settings       # account, API keys, billing (post-hackathon)
```

**World UI initial load sequence**
1. User authenticates via Privy
2. Redirect to `/world?fleet=flt_xyz`
3. `GET /fleets/:id/world` → load `world_states` snapshot → place all agent sprites at stored positions
4. `GET /fleets/:id` → load `worldConfig` (tilemap name, room bounds) → render tilemap
5. Open WebSocket `GET /fleets/:id/stream` → begin receiving live events
6. Events apply on top of snapshot — world is now live

**Phaser scene structure**

| Scene | Role |
|---|---|
| `BootScene` | Preload tilesets, spritesheets, audio |
| `WorldScene` | Isometric tilemap, agent sprites, room zones, pathfinding |
| `UIScene` | Speech bubbles, status dots, tooltips (Phaser layer, not React) |

**React HUD (sits over canvas)**

| Component | Role |
|---|---|
| `FleetPanel` | List all agents, status dots, quick task assignment |
| `Inspector` | Clicked agent detail — task history, current action, logs |
| `CommandBar` | Type a task and assign it to selected agent |

**Zustand stores**

| Store | Owns |
|---|---|
| `agentStore` | All agent states, positions, current animation state |
| `worldStore` | Camera, selected agent, room config, tilemap |
| `socketStore` | WebSocket connection, connection status, event queue |

**Event → world animation mapping**

| Event | World behaviour |
|---|---|
| `state_change: online` | Spawn sprite at stored position |
| `state_change: working` | Working animation + yellow status dot |
| `state_change: idle` | Idle animation + green dot |
| `state_change: error` | Error animation + red dot |
| `state_change: offline` | Fade sprite, grey dot |
| `action: <label>` | Working animation + speech bubble showing label |
| `message_sent` | Walk toward recipient → talking animation + bubble |
| `task_complete` | Idle + "done" bubble + brief glow effect |
| `file_changed` | Brief pulse on agent sprite |
| `world_move` | `sprite.walkTo(newX, newY)` via A* pathfinding |
| `error` | Error animation + red bubble with message |

**Asset strategy:** Kenney free isometric city tileset as placeholder. Swap for custom art post-hackathon.

---

### 11.7 Phase 7 — Bounty Integrations
*Blocked on Phase 3 (API) and Phase 4 (daemon) being live* · **⬜ NOT STARTED**

#### Gensyn AXL (primary — $5,000)

AXL is a P2P encrypted communication layer with built-in MCP and A2A support. It replaces the need for a central message broker for inter-agent communication.

**Why this is architecturally justified:** isolated VMs on separate networks should not depend on a central Redis broker for agent-to-agent messaging. AXL gives P2P encrypted communication with peer discovery — matching the decentralized compute model.

**Integration points:**
- Cloud-init installs and starts AXL binary as a systemd service on every VM (see Section 9)
- Daemon registers AXL peer multiaddr with fleet control plane on boot
- Fleet control plane maintains AXL peer directory in Redis per fleet
- Outbound agent messages route via AXL directly to recipient VM — no control plane relay
- Inbound AXL messages delivered by daemon to agent runtime
- `messages` collection persists the record; AXL handles the transport

**Demo scenario:** two VMs provisioned → manager agent assigns task to worker → worker completes task → sends message to manager via AXL → both agents animate in the world UI (walk + talk) → message stored in DB

#### Uniswap (secondary — $5,000, if time permits)

Agents already have Commons wallets (USDC on Base Sepolia). Uniswap swap is a natural tool extension.

**Integration:** add `swap_tokens` tool callable by agent runtime → calls Uniswap API using agent's wallet → returns swap result → agent emits `action: swapping tokens` event visible in world UI

**Required:** `FEEDBACK.md` in repo root documenting DX experience with Uniswap API — mandatory for prize eligibility.

---

## 12. CI/CD & RELEASE WORKFLOW

Carried over from Agent Commons with two adaptations.

### CI (`ci.yml`)
- Runs on push to `main` + `develop`, and PRs to `main`
- pnpm 9.15.3, Node 22
- Build all packages: `pnpm --filter './packages/*' run build`
- Test all packages: `pnpm --filter './packages/*' run test --passWithNoTests`

### Release (`release.yml`)
- Runs on push to `main`
- Auto-generates patch changeset when `packages/sdk/` or `packages/cli/` change without a changeset
- `changesets/action` creates version PR or publishes to npm
- Post-publish: bumps `apps/web` dependency on `@commonos/sdk` to latest version

**Package name refs (changed from agent-commons):**
- `@agent-commons/sdk` → `@commonos/sdk`
- `@agent-commons/cli` → `@commonos/cli`
- Post-publish app bump: `apps/commons-app` → `apps/web`

### Secrets required
| Secret | Purpose |
|---|---|
| `GH_PAT` | Changesets pushes version commits to main |
| `NPM_TOKEN` | Publishing packages to npm registry |

---

## 13. TECH STACK

| Layer | Technology | Notes |
|---|---|---|
| Monorepo | pnpm 9.15.3 + Turborepo | Same as agent-commons |
| Language | TypeScript throughout | |
| API | Hono | Fleet control plane |
| Frontend | Next.js 15 + React 19 | |
| Auth | Privy | Wallet + social login, same as agent-commons |
| World rendering | Phaser 3 | Isometric 2.5D |
| State management | Zustand | Agent, world, socket stores |
| Database | MongoDB (native driver) | No ORM — direct collection ops |
| Schema validation | Zod | At API boundary |
| Cache / queues | Redis | Task queues, presence, peer directory |
| Package builds | tsup | Same as agent-commons |
| Versioning | Changesets | Same workflow as agent-commons |
| Git hooks | Husky | |
| Cloud (AWS) | `@aws-sdk/client-ec2` | |
| Cloud (GCP) | `@google-cloud/compute` | |
| IaC | Terraform | Per-tenant automated VPC provisioning: post-hackathon. Manual VPC setup for hackathon demo. |
| P2P messaging | Gensyn AXL | Inter-agent communication |
| Agent runtime (native) | `agc` CLI (Agent Commons) | Runs inside VM |
| Agent runtime (guest) | Docker + `@commonos/sdk` | Tenant's own image |

---

## 14. BOUNTY STRATEGY

| Bounty | Prize | Priority | Effort |
|---|---|---|---|
| Gensyn AXL | $5,000 | Primary — build Day 4 | Medium |
| Uniswap API | $5,000 | Secondary — build Day 7 only if ahead | Low |

**Hard cap: two bounties maximum.** Three bounties risks incomplete submissions.

**Gensyn rationale:** Their "Agent Town" suggested build is exactly CommonOS. AXL is architecturally motivated — not a cosmetic integration. Replaces the need for a central Redis message broker at the VM layer.

**Skip:** 0G (integration story is weak relative to the problem), KeeperHub (not load-bearing).

**Uniswap note:** the `FEEDBACK.md` file is a hard requirement for eligibility. Must document DX experience: what worked, what didn't, bugs, docs gaps, missing endpoints.

---

## 15. DEMO PLAN & SUBMISSION

### The demo (3 minutes)

**Minute 1 — The problem + setup**
- Show existing agent framework (shared process, no isolation, no visibility)
- Open terminal: `commonos auth login` → authenticated
- `commonos fleet create --name "product-team" --provider aws`
- `commonos agent deploy --fleet flt_xyz --role "manager" --prompt "You coordinate the engineering team"`
- `commonos agent deploy --fleet flt_xyz --role "backend-engineer" --prompt "You write Node.js code"`
- `commonos agent deploy --fleet flt_xyz --role "frontend-engineer" --prompt "You write React code"`

**Minute 2 — The world comes alive**
- Open the web UI at `/world`
- Three agent sprites appear in the office — manager in the meeting room, engineers at desks
- `commonos task send agt_manager "Build a REST API for a todo app"`
- Manager agent wakes up, walks to engineer, assigns subtasks
- Engineers start working — typing animations, speech bubbles, file_changed pulses

**Minute 3 — AXL in action + output**
- Show two agents communicating via AXL (speech bubbles, walking animation)
- Show the terminal: `commonos agent logs agt_backend` — real output streaming
- Show the `/workspace` output: actual files written by the agent
- Show the architecture diagram — explain AXL P2P comms, isolated VMs, Agent Commons as identity layer

### Hackathon submission checklist

**General requirements:**
- [ ] Public GitHub repo with complete README (setup instructions, architecture)
- [ ] Architecture diagram (Section 5 ASCII diagram + rendered version)
- [ ] Demo video — under 3 minutes, follows script above
- [x] Live demo — World UI running (`apps/web` builds and serves)
- [ ] Live demo link (deployed API + web UI — needs Phase 3 complete)
- [ ] Team member names, Telegram, and X handles

**Gensyn AXL requirements:**
- [ ] AXL used for inter-agent communication (not replaced by centralized broker)
- [ ] Demo shows communication across separate AXL nodes (separate VMs, not in-process)
- [ ] README section explaining how AXL is integrated and why

**Uniswap requirements (if pursuing):**
- [ ] `FEEDBACK.md` in repo root — specific, actionable feedback on DX
- [ ] Working demo of agent swap via Uniswap API
- [ ] README section explaining Uniswap integration

---

## 16. BUILD TIMELINE (1 WEEK)

**Hard deadline: 7 days from start.**

> **Current position: 2026-04-25.** Phases 1, 2 (cloud), 5 (SDK), 6 (World UI) are done ahead of schedule. Phase 3 (API) is the immediate priority — it unlocks everything else.

```
Day 1 (Monday)   ✅ DONE
├── Repo scaffolded, CI/CD passing, packages building
├── Event schema Zod types complete
└── Package stubs building

Day 2 (Tuesday)  ✅ DONE
├── AWS cloud package — AWSProvider: provision, terminate, stop, start, getStatus
├── GCP cloud package — GCPProvider: provision, terminate, stop, start, getStatus
├── SDK — CommonOSClient + CommonOSAgentClient fully implemented
└── CLI — all command structure + flags defined (actions still stubs)

Day 3 (Wednesday) ✅ DONE (ahead of schedule — World UI built early)
├── Daemon — config loader, startup sequence, heartbeat loop
├── World UI — Phaser isometric world, agent sprites, HUD, mock simulation
└── All routes: /, /world, /auth, /settings

── ◀ WE ARE HERE (2026-04-25) ──────────────────────────

Day 4 (Thursday) ← CURRENT PRIORITY
├── Fleet Control Plane API — MongoDB connection, auth middleware
├── API routes: /fleets, /fleets/:id/agents, /events, WebSocket stream
└── Provisioner service — cloud-init script builder, VM deploy sequence

Day 5 (Friday)
├── Daemon — task inbox loop, file watcher, health monitor
├── AXL integration — daemon registers peer, routes messages P2P
└── CLI — wire all commands to live API (auth login → config, fleet/agent/task commands)

Day 6 (Saturday)
├── World UI — replace mock simulation with real WebSocket + world_states snapshot
├── Manager/worker permission model enforced in API
└── End-to-end demo: deploy fleet via CLI → agents appear in world → tasks animate

Day 7 (Sunday)
├── Polish, fix blocking bugs
├── Uniswap integration (if ahead of schedule)
├── FEEDBACK.md written (required for Uniswap)
├── README + architecture diagram
├── Demo video recorded
└── Submission submitted before deadline
```

**Cut line — if behind on Day 6:**
Drop Uniswap. Drop CLI auth flow (use API key directly from env). The core demo: `curl` to deploy fleet → world animates live → two agents communicate via AXL.

**Non-negotiable for submission:**
- Working VM provisioning (Phase 3 provisioner)
- Fleet daemon reporting events (Phase 4 main loops)
- World UI showing live agent animations (Phase 6 ✅ — already done)
- AXL inter-agent messaging working across two VMs (Phase 7)
- Public GitHub repo with README and demo video
