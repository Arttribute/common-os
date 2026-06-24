# CommonOS

**Vercel/Railway for AI agent fleets.** Every agent gets its own isolated Kubernetes pod, persistent workspace, and live presence in a spatial world UI.

```
cos fleet create --name "product-team"
cos agent deploy --fleet flt_xyz --role "backend-engineer"
cos task send agt_xyz "build the auth module" --fleet flt_xyz
```

Open the world UI — your agents appear in an office, walking to their desks, doing the work.

---

## What it is

CommonOS is a deployment and management platform for persistent AI agent fleets. The core primitive: every agent runs in a dedicated EKS pod with an EFS-backed persistent workspace and a P2P communication sidecar (Gensyn AXL). Fleets are managed through a control plane API, a TypeScript SDK, and a CLI.

The World UI makes the fleet visible — agents appear as characters in a 2.5D isometric simulation that reflects real compute state in real time. When an agent starts a task, it walks to its desk. When it finishes, an artifact appears in the world. When two agents communicate via AXL, you see the message exchange.

**Two things at once:**
- Infrastructure layer: isolated runtimes, persistent state, fleet control plane, task routing, event stream
- Experience layer: agents as embodied workers in a live spatial simulation

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                      World UI                          │
│          Next.js 15 + Phaser 3 (isometric 2.5D)        │
│     React HUD (fleet panel, inspector, command bar)    │
├────────────────────────────────────────────────────────┤
│              Fleet Control Plane  (Hono API)           │
│   auth · provisioning · task routing · event stream    │
│   permission model · world state · WebSocket broadcast │
├────────────────────────────────────────────────────────┤
│                  Agent Commons API                     │
│        identity · wallets · sessions · memory          │
├────────────────────────────────────────────────────────┤
│                  AWS EKS Cluster                       │
│                                                        │
│  ┌─────────────────┐  ┌─────────────────┐             │
│  │  Agent Pod       │  │  Agent Pod       │  ...       │
│  │  ─────────────  │  │  ─────────────  │             │
│  │  daemon.mjs     │  │  daemon.mjs     │             │
│  │  agc runtime    │  │  openclaw gw    │             │
│  │  AXL sidecar    │  │  AXL sidecar    │             │
│  │  /mnt/shared    │  │  /mnt/shared    │             │
│  │  (EFS)          │  │  (EFS)          │             │
│  └─────────────────┘  └─────────────────┘             │
└────────────────────────────────────────────────────────┘
```

### Agent runtimes

| Path | What runs inside | Best for |
|---|---|---|
| `native` | `agc` CLI (Agent Commons) | Agents needing full AI capabilities — memory, tools, wallets |
| `openclaw` | OpenClaw gateway (50+ integrations) | Telegram, Discord, Slack, WhatsApp, browser automation |
| `hermes` | Hermes gateway | Hermes-native agents with CommonOS tasks, world state, and cost telemetry |
| `guest` | Tenant Docker image + `@common-os/sdk` or HTTP contract | Custom frameworks — LangGraph, CrewAI, AutoGen, internal agents |

### Gensyn AXL — P2P inter-agent messaging

Every agent pod runs an AXL node (`axl start --port 4001`). The daemon registers its multiaddr with the control plane at boot. When a worker completes a task, it notifies the manager directly via AXL — no central broker. The World UI shows the message exchange as agents walk and talk.

### World state data flow

```
Agent daemon  →  POST /events  →  API broadcasts via WebSocket
                                          ↓
                              useWorldConnection hook
                                          ↓
                              Zustand stores (agentStore, worldStore)
                                          ↓
                    Phaser reads each frame   React HUD reads reactively
```

---

## Monorepo structure

```
/common-os
├── apps/
│   ├── api/              # Hono fleet control plane (port 3001)
│   │   └── agent/        # Agent container image (Dockerfile, entrypoint.sh)
│   ├── runner/           # Shared runner — wraps agent-commons CLI execution
│   └── web/              # Next.js 15 world UI + dashboard (port 3000)
│
└── packages/
    ├── sdk/              # @common-os/sdk — TypeScript client (tenant + agent)
    ├── cli/              # @common-os/cli — `cos` binary
    ├── daemon/           # @common-os/daemon — process running inside each pod
    ├── event-schema/     # @common-os/events — shared Zod event types
    └── cloud/            # @common-os/cloud — AWS + GCP provider abstractions
```

---

## Running locally

### Prerequisites

- Node 22+, pnpm 9+, Bun
- MongoDB (Atlas free tier or local)
- Privy account (optional — auth bypassed if `NEXT_PUBLIC_PRIVY_APP_ID` is not set)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Build packages

```bash
pnpm --filter './packages/*' build
```

### 3. Configure the API

```bash
# apps/api/.env
PORT=3001
API_URL=http://localhost:3001
MONGODB_URI=mongodb+srv://...        # required — all routes 503 without this
PRIVY_APP_ID=                        # optional
PRIVY_APP_SECRET=                    # optional
```

### 4. Configure the web app

```bash
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_PRIVY_APP_ID=            # optional — demo mode if not set
NEXT_PUBLIC_API_KEY=                 # optional — cos_live_... key for demo mode
```

### 5. Start

```bash
# Terminal 1 — API
cd apps/api && pnpm dev

# Terminal 2 — Web
cd apps/web && pnpm dev
```

Open `http://localhost:3000`. Without Privy or an API key the world runs in **demo mode** — a mock fleet of 3 agents loops through a 33-second scripted cycle showing what real data looks like.

---

## Deploying to AWS

Production is AWS-only:

- `.github/workflows/deploy-aws.yml` deploys the API.
- `.github/workflows/agent.yml` builds and pushes the agent image.
- `.github/workflows/runner.yml` builds and pushes the runner image.

The former Google Cloud deployment files are archived under `archive/gcp/`
and are intentionally disconnected from CI/CD.

---

## CLI (`cos`)

```bash
npm install -g @common-os/cli
```

### Auth

```bash
cos auth login --key cos_live_...         # store API key (get from /settings)
cos auth whoami
cos auth logout
```

### Fleets

```bash
cos fleet create --name "product-team"
cos fleet ls
cos fleet status flt_xyz
```

### Agents

```bash
cos agent deploy --fleet flt_xyz --role "backend-engineer"
cos agent deploy --fleet flt_xyz --role "manager" --tier manager
cos agent deploy --fleet flt_xyz --role "researcher" --prompt "You are a research analyst..."
cos agent ls --fleet flt_xyz
cos agent logs agt_xyz --fleet flt_xyz
cos agent terminate agt_xyz --fleet flt_xyz
```

### Tasks

```bash
cos task send agt_xyz "build the auth module" --fleet flt_xyz
cos task ls agt_xyz --fleet flt_xyz
```

### World

```bash
cos world snapshot flt_xyz         # current world state JSON
cos world stream-url flt_xyz       # WebSocket URL for the live event stream
```

---

## API

Base URL: `http://localhost:3001` (or deployed URL)

All routes require `Authorization: Bearer <token>`. Two token types:
- `cos_live_...` — tenant API key (full fleet control)
- `cos_agent_...` — scoped agent token (injected into pods, daemon only)

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/tenant` | First Privy login → creates tenant, returns API key once |
| `GET` | `/auth/me` | Returns current tenant record |

### Fleets

| Method | Path | Description |
|---|---|---|
| `POST` | `/fleets` | Create fleet |
| `GET` | `/fleets` | List fleets |
| `GET` | `/fleets/:id` | Get fleet |

### Agents

| Method | Path | Description |
|---|---|---|
| `POST` | `/fleets/:id/agents` | Deploy agent (provisions EKS pod) |
| `GET` | `/fleets/:id/agents` | List agents |
| `GET` | `/fleets/:id/agents/:agentId` | Get agent |
| `PATCH` | `/fleets/:id/agents/:agentId` | Update agent (world pos, AXL multiaddr) |
| `DELETE` | `/fleets/:id/agents/:agentId` | Terminate agent (deletes pod + namespace) |

### Tasks

| Method | Path | Description |
|---|---|---|
| `POST` | `/fleets/:id/agents/:agentId/task` | Queue task for agent |
| `GET` | `/fleets/:id/agents/:agentId/tasks` | List agent task history |

### Events (agent → control plane)

| Method | Path | Description |
|---|---|---|
| `POST` | `/events` | Emit event from agent daemon |

Event types: `state_change`, `task_start`, `task_complete`, `action`, `message_sent`, `message_recv`, `world_move`, `world_interact`, `world_create_object`, `file_changed`, `heartbeat`, `error`

### World

| Method | Path | Description |
|---|---|---|
| `GET` | `/fleets/:id/world` | World state snapshot (agents + objects) |
| `GET` | `/fleets/:id/peers` | AXL peer directory for the fleet |
| `WS` | `/fleets/:id/stream?token=...` | Live event stream (WebSocket) |

### Agent runtime (daemon only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/agents/:agentId/tasks/next` | Dequeue next task |
| `POST` | `/agents/:agentId/tasks/:taskId/complete` | Mark task complete |

### Messages

| Method | Path | Description |
|---|---|---|
| `POST` | `/fleets/:id/agents/:agentId/message` | Store inter-agent message, broadcast to WebSocket |

---

## SDK

```typescript
import { CommonOSClient, CommonOSAgentClient } from '@common-os/sdk'

// Human operator — tenant API key
const client = new CommonOSClient({ apiKey: 'cos_live_...' })

const fleet = await client.fleets.create({ name: 'eng-team' })
const agent = await client.agents.deploy(fleet._id, {
  role: 'backend-engineer',
  permissionTier: 'worker',
  integrationPath: 'native',
})
await client.tasks.send(fleet._id, agent._id, { description: 'build the auth module' })

// Agent runtime inside pod — agent token (injected by cloud-init)
const agentClient = new CommonOSAgentClient({
  agentToken: process.env.AGENT_TOKEN,
  agentId: process.env.AGENT_ID,
  apiUrl: process.env.API_URL,
})

await agentClient.emit({ type: 'state_change', payload: { status: 'online' } })
const task = await agentClient.nextTask()
if (task) {
  await agentClient.emit({ type: 'task_start', payload: { taskId: task.id, description: task.description } })
  // ... execute ...
  await agentClient.completeTask(task.id, output)
}
```

---

## World UI

The world runs at `/world?fleet=<fleet-id>`. Without a fleet ID or API connection, it runs in demo mode with a scripted mock simulation.

**Controls:**
- Arrow keys / WASD — pan camera
- Q / E — zoom out / in
- Mouse wheel — zoom
- Click agent — select (opens inspector panel)

**HUD panels:**
- Fleet panel (left) — live agent list with status, current action
- Inspector (right) — selected agent detail, task history, recent actions
- Command bar (bottom) — type a task and assign to selected agent

**Themes:** office · hackerspace · gym · industrial (toggle in the customizer)

**What's live when connected to a real fleet:**
- Agents appear at their provisioned positions from the world state snapshot
- Movement: agents walk to their work position when a task starts, return to idle position on completion
- Artifacts: a glowing data crystal appears at the agent's desk when a task completes
- Messages: speech bubbles show AXL inter-agent messages in real time
- Dynamic objects: agents can create whiteboards, terminals, checkpoints, notes in the world

---

## Gensyn AXL integration

Every agent pod runs an AXL node on port 4001. The daemon:

1. **Registers** its AXL peer multiaddr with the control plane (`PATCH /fleets/:id/agents/:agentId`)
2. **Discovers** fleet peers on boot (`GET /fleets/:id/peers`) — caches manager's multiaddr
3. **Receives** inbound P2P messages by polling `GET localhost:4001/messages` every 5s
4. **Sends** outbound messages via `POST localhost:4001/send` — used to notify manager on task completion

No central message broker. Workers communicate with managers directly over AXL P2P. The control plane only stores a persistent record of messages after they're delivered.

---

## Permission model

```
Human master (tenant API key)
  └── can create fleets, deploy agents, assign tasks, terminate VMs

Manager agent (permissionTier: manager)
  └── can assign tasks to worker agents
  └── receives task-complete notifications via AXL from workers

Worker agent (permissionTier: worker)
  └── can only emit events and pull its own task queue
  └── cannot read other agents' workspaces
```

---

## Environment variables

### API server (`apps/api/.env`)

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | **Yes** | MongoDB connection string — all routes 503 without this |
| `API_URL` | Yes | Public URL of this API (injected into agent pods) |
| `PORT` | No | Default 3001 |
| `PRIVY_APP_ID` | No | Privy app ID for JWT verification |
| `PRIVY_APP_SECRET` | No | Privy app secret |
| `CLOUD_PROVIDER` | No | Production value and default: `aws` |
| `EKS_CLUSTER` | AWS | EKS cluster name |
| `AGENT_IMAGE_URL` | AWS | Container image for agent pods |
| `RUNNER_URL` | Yes | URL of the shared runner service |
| `AWS_ACCESS_KEY_ID` | AWS | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS | AWS credentials |
| `AGENTCOMMONS_API_KEY` | No | Platform key for Agent Commons registration |

### Web app (`apps/web/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | API base URL — omit for demo mode |
| `NEXT_PUBLIC_PRIVY_APP_ID` | No | Privy app ID — omit to bypass auth |
| `NEXT_PUBLIC_API_KEY` | No | `cos_live_...` key for static auth (no Privy) |

---

## What's built

| Component | Status |
|---|---|
| Monorepo, CI/CD, package builds | ✅ |
| MongoDB collections + indexes + Mongoose schemas | ✅ |
| Fleet control plane API (all routes) | ✅ |
| Privy JWT + tenant API key + agent token auth | ✅ |
| AWS EKS pod provisioner (`launchAgentPodEks`) | ✅ |
| Agent container image (Dockerfile + GitHub Actions) | ✅ |
| Fleet daemon (task loop, heartbeat, file watcher, health monitor) | ✅ |
| Gensyn AXL — peer registration, inbox loop, outbound P2P | ✅ |
| World tools — `worldMove`, `worldInteract`, `worldCreateObject` | ✅ |
| TypeScript SDK (`CommonOSClient` + `CommonOSAgentClient`) | ✅ |
| CLI (`cos`) — all commands wired to real API | ✅ |
| World UI — isometric world, agent sprites, HUD, themes | ✅ |
| Live WebSocket event stream (real agent data) | ✅ |
| Dynamic world objects (agent-created artifacts, whiteboards, etc.) | ✅ |
| Fleet dashboard (create fleets, deploy agents, terminate) | ✅ |
| Settings page (API key, CLI setup guide) | ✅ |
| Runner service (AWS image workflow, wraps agent-commons CLI) | ✅ |
| ENS agent identity | ⬜ |
