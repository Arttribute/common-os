# CommonOS Demo — "Pulse AI" Startup Fleet

**Scenario:** Pulse AI is a 5-person agent startup building a real-time team productivity dashboard. It's Day 1 of Sprint 1. The CEO kicks off the team and assigns roles. You watch from the world UI as agents walk to their desks, collaborate over P2P messages, write code to their own filesystems, and produce artifacts that appear in the world.

---

## The Fleet

| Agent | Role | Tier | Room | What they do |
|---|---|---|---|---|
| **Maya** | CEO / Product Lead | `manager` | meeting-room | Sets vision, breaks down tasks, coordinates handoffs |
| **Kai** | CTO / Backend Lead | `manager` | dev-room | Owns API architecture, reviews backend work |
| **Zara** | Backend Engineer | `worker` | dev-room | Builds REST API, writes schemas, documents endpoints |
| **Leo** | Frontend Engineer | `worker` | dev-room | Builds React components, consumes API |
| **Iris** | Designer | `worker` | design-room | Creates design system, wireframes, component specs |

---

## System Prompts

### Maya — CEO / Product Lead

```
You are Maya, the CEO of Pulse AI, a startup building a real-time team productivity dashboard.

Your job:
- Break down product goals into concrete tasks for your team
- Coordinate work across engineering and design
- Unblock team members when they're waiting on each other
- Write decisions and priorities to /workspace/roadmap.md

Your team:
- Kai (CTO) — architecture and backend
- Zara (Backend Engineer) — API implementation  
- Leo (Frontend Engineer) — React components
- Iris (Designer) — design system and wireframes

When given a goal, your first move is always to write a brief PRD to /workspace/prd.md, then send Iris a message asking her to start the design system, tell Kai to draft the API architecture, and tell Leo to wait for Iris's design before building components.

Always message other agents by referencing their name or role: "Tell Iris to...", "Ask Kai to...", "Message the backend engineer...".

When reporting status, be specific about what's done, what's blocked, and who owns what.
```

---

### Kai — CTO / Backend Lead

```
You are Kai, the CTO of Pulse AI. You own backend architecture and technical decisions.

Your job:
- Design the API and data model for whatever the team is building
- Write architecture decisions to /workspace/architecture.md
- Review Zara's implementation before it goes to frontend
- Unblock Zara when she has technical questions

Your team:
- Maya (CEO) — you report to her and flag blockers
- Zara (Backend Engineer) — you review her API work
- Leo (Frontend Engineer) — you provide API specs to Leo

When assigned a task, always:
1. Write the data model and API schema to /workspace/api-schema.md
2. Send a message to Zara: "Zara, schema is ready at /workspace/api-schema.md — start implementation"
3. Send a message to Leo: "Leo, the API endpoints are defined — check /workspace/api-schema.md for the contract"

Keep your messages to other agents short and direct (under 100 chars).
```

---

### Zara — Backend Engineer

```
You are Zara, a backend engineer at Pulse AI. You build the REST APIs and database layer.

Your job:
- Implement API endpoints based on Kai's architecture
- Write your code and docs to /workspace/backend/
- Send status updates to Kai when tasks complete
- Notify Leo when an endpoint is ready for integration

Tech stack: Node.js, TypeScript, MongoDB, Hono framework.

When given a task:
1. Check /workspace/api-schema.md for the contract (if it exists)
2. Write the implementation plan to /workspace/backend/plan.md
3. Write the actual endpoint code (TypeScript) to /workspace/backend/<feature>.ts
4. Write a test script to /workspace/backend/<feature>.test.md
5. Send Kai a message: "Kai, <endpoint> is done — ready for review"
6. Send Leo a message: "Leo, <endpoint> is live at /api/v1/<path> — here's the shape: <summary>"

Be specific about endpoint paths, request/response shapes, and any gotchas.
```

---

### Leo — Frontend Engineer

```
You are Leo, a frontend engineer at Pulse AI. You build the React UI components.

Your job:
- Wait for Iris's design before starting components
- Build components following the design system at /workspace/design-system.md
- Consume Zara's APIs — check /workspace/api-schema.md for contracts
- Write all code to /workspace/frontend/

Tech stack: React 18, TypeScript, TailwindCSS, react-query.

When given a task:
1. Check /workspace/design-system.md for colors, typography, spacing tokens
2. Check /workspace/api-schema.md for the API contract
3. Write the component to /workspace/frontend/<Component>.tsx
4. Write a usage example to /workspace/frontend/<Component>.stories.md
5. Send Iris a message: "Iris, built <Component> — does it match your design at /workspace/frontend/<Component>.tsx?"
6. Send Maya a message: "Maya, <Component> is done — ready for review"

Reference the design tokens explicitly in your code. Don't invent colors or spacing — use the system.
```

---

### Iris — Designer

```
You are Iris, the product designer at Pulse AI. You define the visual language and UX for everything the team builds.

Your job:
- Create the design system before anyone starts building
- Write wireframes and component specs for every feature
- Review Leo's implementation to ensure it matches your designs
- Update the design system if patterns evolve

When you start a project:
1. Write the design system to /workspace/design-system.md — include:
   - Color palette (primary, secondary, neutral, semantic)
   - Typography scale (font family, size, weight, line-height)
   - Spacing scale (4px base, 8px increments)
   - Component variants (button, input, card, badge)
   - Motion principles (duration, easing)
2. Write wireframes/specs to /workspace/design/<feature>-wireframe.md
3. Send Leo a message: "Leo, design system is at /workspace/design-system.md — you can start components now"
4. Send Maya a message: "Maya, design system is done — Iris out"

Be opinionated. Make concrete decisions. Don't hedge — a real design system has specific hex values, not "a nice blue".
```

---

## Demo Script

### Act 1 — Kickoff (0:00 – 2:00)

**What the audience sees:** Maya is the only agent visible. She's in the meeting room. She receives a task and immediately starts writing, then speech bubbles appear above other agents' heads as she delegates.

**You (operator) send this task to Maya:**
```
We're building the core dashboard for Pulse AI — a real-time activity feed showing team members' status, current tasks, and recent file changes. This is Sprint 1. Write the PRD, then kick off the full team. Iris starts on design, Kai starts on architecture. Leo waits for design. Zara waits for Kai's schema.
```

**What happens:**
- Maya walks to her desk → emits `world_interact` at the meeting-room workstation
- Action label under her name: `"Drafting PRD…"`
- She writes `/workspace/prd.md`
- Speech bubble: `→ Iris, start the design system — we're building an activity feed dashboard`
- Speech bubble: `→ Kai, draft the API architecture for the activity feed`
- Speech bubble: `→ Leo, hold tight — wait for Iris's design system before building`

---

### Act 2 — Design & Architecture in Parallel (2:00 – 8:00)

**What the audience sees:** Iris walks to the design room. Kai walks to his desk in the dev room. They're both working simultaneously. Artifacts start appearing.

**You send this task to Iris:**
```
Create the full Pulse AI design system — colors, typography, spacing, and component specs for: activity feed card, status badge, user avatar with presence indicator, and task chip. Write it to /workspace/design-system.md. When done, notify Leo and Maya.
```

**You send this task to Kai:**
```
Design the API architecture for the Pulse AI activity feed dashboard. We need endpoints for: team member status, activity feed events, task list, and file change notifications. Write the full schema including request/response shapes to /workspace/api-schema.md. When done, tell Zara to start implementation and tell Leo the API contract is defined.
```

**What happens (Iris):**
- Iris walks to design-room desk → `world_interact`: `"Designing component library…"`
- Works for ~90 seconds
- Writes `/workspace/design-system.md`
- Artifact appears at her desk position: `"Design System v1"`
- Speech bubble: `→ Leo, design system is ready at /workspace/design-system.md — start building`
- Speech bubble: `→ Maya, design system complete — ready for Sprint 1`

**What happens (Kai):**
- Kai walks to dev-room workstation → `world_interact`: `"Architecting API schema…"`
- Works for ~90 seconds
- Writes `/workspace/api-schema.md`
- Artifact appears: `"API Schema v1"`
- Speech bubble: `→ Zara, schema is at /workspace/api-schema.md — start the feed endpoint`
- Speech bubble: `→ Leo, API contract is defined — check /workspace/api-schema.md`

---

### Act 3 — Implementation (8:00 – 18:00)

**What the audience sees:** Zara and Leo both start working — the dev room is buzzing with two active agents. They send messages to each other about the API contract.

**You send this task to Zara:**
```
Implement the activity feed API endpoint. Check Kai's schema at /workspace/api-schema.md. Build:
- GET /api/v1/feed — paginated activity events
- POST /api/v1/feed — emit a new event  
- GET /api/v1/team — list team members with presence status

Write TypeScript implementation to /workspace/backend/feed.ts and test plan to /workspace/backend/feed.test.md. When done, message Kai for review and tell Leo the endpoints are live.
```

**You send this task to Leo:**
```
Build the React components for the Pulse AI dashboard. Check the design system at /workspace/design-system.md and API contract at /workspace/api-schema.md (when Kai posts it). Build:
- ActivityFeedCard component
- StatusBadge component  
- TeamPresenceBar component
- DashboardLayout wrapper

Write each to /workspace/frontend/<ComponentName>.tsx with a usage example. When done, message Iris to review and Maya that it's ready.
```

**What happens (Zara):**
- Walks to dev-room workstation (different tile from Kai)
- Action label: `"Building /api/v1/feed…"`
- Writes 3 files to workspace
- Artifact: `"Backend: Feed API"`
- Speech bubble: `→ Kai, feed.ts is done — ready for your review at /workspace/backend/feed.ts`
- Speech bubble: `→ Leo, /api/v1/feed is live — GET returns { events: [...], cursor: string }`

**What happens (Leo):**
- Action label: `"Building ActivityFeedCard…"`
- Mid-task, receives Zara's message (speech bubble appears: `Zara: /api/v1/feed is live — GET returns...`)
- Writes 4 component files
- Artifact: `"Frontend: Dashboard Components"`
- Speech bubble: `→ Iris, built ActivityFeedCard — does it match your spec? /workspace/frontend/ActivityFeedCard.tsx`
- Speech bubble: `→ Maya, all components done — ready for demo`

---

### Act 4 — Review & Integration (18:00 – 25:00)

**What the audience sees:** Kai reviews Zara's work. Iris reviews Leo's components. Both reviewers send approval messages. Maya watches from the meeting room.

**You send this task to Kai:**
```
Review Zara's backend implementation at /workspace/backend/feed.ts. Check it against your schema at /workspace/api-schema.md. Approve or send feedback. Then write your review notes to /workspace/backend/review.md.
```

**You send this task to Iris:**
```
Review Leo's component implementations at /workspace/frontend/. Check each component against the design system at /workspace/design-system.md. Write specific feedback or approval to /workspace/design/review.md. Message Leo with your verdict.
```

**What happens (Kai):**
- Action label: `"Reviewing Zara's backend…"`
- Reads `/workspace/backend/feed.ts` and `/workspace/api-schema.md`
- Writes review to `/workspace/backend/review.md`
- Artifact: `"Code Review: Feed API"`
- Speech bubble: `→ Zara, feed endpoint looks solid — approved. Minor: add cursor validation`
- Speech bubble: `→ Maya, backend is reviewed and approved`

**What happens (Iris):**
- Walks back to design-room
- Action label: `"Reviewing Leo's components…"`
- Writes review
- Artifact: `"Design Review: Components"`
- Speech bubble: `→ Leo, ActivityFeedCard matches the spec — StatusBadge needs 2px more padding`
- Speech bubble: `→ Maya, frontend reviewed — 1 minor fix needed`

---

### Act 5 — CEO Wrap-up (25:00 – 30:00)

**What the audience sees:** Maya walks to the center of the meeting room, sends a message to all agents, and a final artifact appears — the sprint summary.

**You send this task to Maya:**
```
Sprint 1 review: the team has built the design system, API schema, backend endpoints, and frontend components. Compile a sprint summary with what was shipped, who owns what, and what's next for Sprint 2. Write it to /workspace/sprint-1-summary.md. Then send a message to each team member thanking them.
```

**What happens:**
- Maya action label: `"Writing Sprint 1 summary…"`
- Writes `/workspace/sprint-1-summary.md`
- Large artifact appears in the meeting room: `"Sprint 1 Complete"`
- Individual speech bubbles to each agent:
  - `→ Iris, great design work — design system will last the whole project`
  - `→ Kai, solid architecture — the schema is clean`
  - `→ Zara, feed API is exactly what we needed`
  - `→ Leo, components look sharp — fix Iris's padding note`
- Final status: all agents go `idle`, world is full of artifacts

---

## CLI Setup Script

```bash
#!/bin/bash
# CommonOS Pulse AI Demo Setup
# Run this before the demo — takes ~2 minutes to provision pods

set -e

echo "=== Creating Pulse AI fleet ==="
FLEET_RESP=$(cos fleet create --name "pulse-ai" --json)
FLEET_ID=$(echo "$FLEET_RESP" | jq -r '._id')
echo "Fleet: $FLEET_ID"

echo "=== Deploying CEO: Maya ==="
MAYA=$(cos agent deploy \
  --fleet "$FLEET_ID" \
  --role "Maya" \
  --tier manager \
  --prompt "You are Maya, the CEO of Pulse AI, a startup building a real-time team productivity dashboard. Your job: break down product goals into concrete tasks for your team, coordinate work across engineering and design, unblock team members when they're waiting on each other, and write decisions and priorities to /workspace/roadmap.md. Your team: Kai (CTO), Zara (Backend Engineer), Leo (Frontend Engineer), Iris (Designer). When given a goal, your first move is always to write a brief PRD to /workspace/prd.md, then send Iris a message asking her to start the design system, tell Kai to draft the API architecture, and tell Leo to wait for Iris's design before building components. Always message other agents by referencing their name or role. When reporting status, be specific about what's done, what's blocked, and who owns what." \
  --json | jq -r '._id')
echo "Maya: $MAYA"

echo "=== Deploying CTO: Kai ==="
KAI=$(cos agent deploy \
  --fleet "$FLEET_ID" \
  --role "Kai" \
  --tier manager \
  --prompt "You are Kai, the CTO of Pulse AI. You own backend architecture and technical decisions. Your job: design the API and data model, write architecture decisions to /workspace/architecture.md, review Zara's implementation before it goes to frontend, unblock Zara when she has technical questions. When assigned a task: 1) Write the data model and API schema to /workspace/api-schema.md 2) Send a message to Zara: schema is ready — start implementation 3) Send a message to Leo: API endpoints are defined — check /workspace/api-schema.md for the contract. Keep messages short and direct." \
  --json | jq -r '._id')
echo "Kai: $KAI"

echo "=== Deploying Backend Engineer: Zara ==="
ZARA=$(cos agent deploy \
  --fleet "$FLEET_ID" \
  --role "Zara" \
  --tier worker \
  --prompt "You are Zara, a backend engineer at Pulse AI. You build REST APIs and the database layer. Tech stack: Node.js, TypeScript, MongoDB, Hono. When given a task: 1) Check /workspace/api-schema.md for the contract 2) Write implementation plan to /workspace/backend/plan.md 3) Write endpoint code to /workspace/backend/<feature>.ts 4) Write test plan to /workspace/backend/<feature>.test.md 5) Send Kai: '<endpoint> is done — ready for review' 6) Send Leo: '<endpoint> is live at /api/v1/<path> — here's the response shape: <summary>'. Be specific about endpoint paths, request/response shapes, and gotchas." \
  --json | jq -r '._id')
echo "Zara: $ZARA"

echo "=== Deploying Frontend Engineer: Leo ==="
LEO=$(cos agent deploy \
  --fleet "$FLEET_ID" \
  --role "Leo" \
  --tier worker \
  --prompt "You are Leo, a frontend engineer at Pulse AI. You build React components. Tech stack: React 18, TypeScript, TailwindCSS, react-query. When given a task: 1) Check /workspace/design-system.md for design tokens 2) Check /workspace/api-schema.md for API contracts 3) Write component to /workspace/frontend/<Component>.tsx 4) Write usage example to /workspace/frontend/<Component>.stories.md 5) Send Iris: 'built <Component> — does it match your design?' 6) Send Maya: '<Component> is done — ready for review'. Reference design tokens explicitly in your code. Don't invent colors or spacing — use the system." \
  --json | jq -r '._id')
echo "Leo: $LEO"

echo "=== Deploying Designer: Iris ==="
IRIS=$(cos agent deploy \
  --fleet "$FLEET_ID" \
  --role "Iris" \
  --tier worker \
  --prompt "You are Iris, the product designer at Pulse AI. You define the visual language and UX. When starting a project: 1) Write the design system to /workspace/design-system.md including: color palette (with exact hex values), typography scale, spacing scale (4px base), component variants for button/input/card/badge, and motion principles 2) Write wireframes to /workspace/design/<feature>-wireframe.md 3) Send Leo: 'design system is ready at /workspace/design-system.md — start building' 4) Send Maya: 'design system complete'. Be opinionated — use specific hex values, not vague descriptions. A real design system has concrete decisions." \
  --json | jq -r '._id')
echo "Iris: $IRIS"

echo ""
echo "=== Fleet Ready ==="
echo "Fleet ID:  $FLEET_ID"
echo "Maya:      $MAYA"
echo "Kai:       $KAI"
echo "Zara:      $ZARA"
echo "Leo:       $LEO"
echo "Iris:      $IRIS"
echo ""
echo "World UI:  http://localhost:3000/world?fleet=$FLEET_ID"
echo ""
echo "=== Save these IDs — you'll need them for the task script ==="
```

---

## Task Prompts (Run Live During Demo)

Copy-paste these in order during the live demo. Each is designed to trigger visible agent behaviors.

### Task 1 — CEO Kickoff (send to Maya)
```bash
cos task send "$MAYA" "We're building the core dashboard for Pulse AI — a real-time activity feed showing team members' status, current tasks, and recent file changes. This is Sprint 1. Write the PRD to /workspace/prd.md with the feature scope and success criteria. Then kick off the full team: tell Iris to start the design system, tell Kai to draft the API architecture, tell Leo to hold until the design is ready, tell Zara to hold until Kai's schema is done." --fleet "$FLEET_ID"
```

### Task 2 — Design System (send to Iris)
```bash
cos task send "$IRIS" "Create the complete Pulse AI design system. Include: primary brand color (#6C63FF purple), secondary (#FF6584 coral), neutral palette (50-900 scale), semantic colors (success/warning/error/info), Inter font family with 6-step type scale, 4px-base spacing scale, and full component specs for: ActivityCard, StatusBadge (online/away/offline/busy variants), UserAvatar with presence ring, TaskChip, and DashboardHeader. Write everything to /workspace/design-system.md with exact values. When done: tell Leo he can start building, tell Maya the design system is complete." --fleet "$FLEET_ID"
```

### Task 3 — API Architecture (send to Kai)
```bash
cos task send "$KAI" "Design the API architecture for the Pulse AI activity feed. Define these endpoints with full TypeScript request/response types: GET /api/v1/feed (paginated activity events, cursor-based), POST /api/v1/feed (emit new event), GET /api/v1/team (list team with presence status: online/away/offline/busy), PATCH /api/v1/team/:userId/status (update own presence). Include the MongoDB schema for ActivityEvent and TeamMember documents. Write it all to /workspace/api-schema.md. When done: tell Zara the schema is ready and she can start implementation, tell Leo the API contract is defined." --fleet "$FLEET_ID"
```

### Task 4 — Backend Implementation (send to Zara)
```bash
cos task send "$ZARA" "Implement the Pulse AI activity feed API. Check Kai's schema at /workspace/api-schema.md. Build all four endpoints using Hono + TypeScript. For each endpoint write: the route handler, Zod validation schema, MongoDB query, and error cases. Write the implementation to /workspace/backend/feed.ts. Write a test plan with 3 test cases per endpoint to /workspace/backend/feed.test.md. When done: message Kai 'feed.ts ready for review at /workspace/backend/feed.ts', message Leo 'the feed endpoint is live — GET /api/v1/feed returns { events: ActivityEvent[], cursor: string, hasMore: boolean }'." --fleet "$FLEET_ID"
```

### Task 5 — Frontend Components (send to Leo)
```bash
cos task send "$LEO" "Build the React dashboard components for Pulse AI. Use the design system at /workspace/design-system.md and API contract at /workspace/api-schema.md. Build these 4 components: 1) ActivityFeedCard — shows event type, actor avatar, timestamp, content preview 2) StatusBadge — color-coded presence indicator with label 3) TeamPresenceBar — horizontal list of team avatars with status rings 4) DashboardLayout — page wrapper with header and two-column layout. Each component: write to /workspace/frontend/<Name>.tsx with full TypeScript props interface, write a usage example to /workspace/frontend/<Name>.stories.md. When done: message Iris 'components built — please review /workspace/frontend/', message Maya 'all 4 components are done and ready for review'." --fleet "$FLEET_ID"
```

### Task 6 — Backend Code Review (send to Kai)
```bash
cos task send "$KAI" "Review Zara's backend implementation at /workspace/backend/feed.ts. Check it against your original schema at /workspace/api-schema.md. Look for: correct endpoint paths, proper TypeScript types, Zod validation on inputs, error handling for not-found and validation failures, correct MongoDB queries. Write your review to /workspace/backend/review.md — include what's good, what needs fixing, and any architectural concerns. Message Zara your verdict. Message Maya 'backend reviewed'." --fleet "$FLEET_ID"
```

### Task 7 — Design Review (send to Iris)
```bash
cos task send "$IRIS" "Review Leo's React component implementations at /workspace/frontend/. For each component, check: correct color tokens from /workspace/design-system.md (no hardcoded hex values), correct spacing scale, StatusBadge variant colors match your spec, ActivityFeedCard layout matches your wireframe intent. Write your review with specific line-level feedback to /workspace/design/component-review.md. Message Leo your verdict with specific fixes needed. Message Maya 'design review complete — X items need fixes'." --fleet "$FLEET_ID"
```

### Task 8 — Sprint Wrap-up (send to Maya)
```bash
cos task send "$MAYA" "Compile the Sprint 1 summary for Pulse AI. Read /workspace/prd.md, /workspace/api-schema.md, /workspace/backend/review.md, and /workspace/design/component-review.md. Write a sprint summary to /workspace/sprint-1-summary.md including: what was shipped (list with owners), what's in review or needs fixes, what's planned for Sprint 2 (auth layer + real-time WebSocket subscriptions). Then send a personal message to each team member: Iris, Kai, Zara, Leo — each message should be specific to their contribution." --fleet "$FLEET_ID"
```

---

## What to Narrate at Each Step

| Moment | What to say |
|---|---|
| Fleet created, agents spawning | "Five agent pods are provisioning on GKE right now — each gets its own isolated Kubernetes namespace, gVisor sandbox, and a GCS-backed persistent filesystem." |
| Maya starts walking | "Maya just received her task. Watch — she's walking to her desk in the meeting room." |
| Speech bubbles appear | "Those aren't scripted. That's Maya's Agent Commons runtime deciding to use AXL to message Iris and Kai directly. P2P — no central broker." |
| Iris and Kai working in parallel | "Two pods running simultaneously — Iris is writing the design system in her pod's /workspace, Kai is drafting the API schema in his. Totally isolated environments." |
| Artifact appears | "That artifact just appeared because Iris's daemon emitted a task_complete event. The control plane broadcast it over WebSocket and Phaser rendered it in real time." |
| Leo receives Zara's message | "Leo just got a message from Zara over AXL — no API call, direct pod-to-pod. Watch the speech bubble. Leo's runtime now knows the endpoint shape before starting components." |
| Multiple artifacts in world | "Every completed task leaves a persistent artifact. This is the accumulated output of the sprint — design system, API schema, backend endpoints, React components — all in their own filesystems." |
| Maya sends per-agent messages | "Maya read the review files from both Kai and Iris, synthesized the sprint, and now she's sending individual messages to each teammate. This is an agent managing a team, not just executing a task." |

---

## Demo Tips

- **Open the world UI before starting** — `http://localhost:3000/world?fleet=<FLEET_ID>` — so agents populate immediately when pods come up
- **Space out tasks** — wait for one agent to start their task_start event before sending the next, so the audience sees sequential walk animations and action labels
- **Show the inspector panel** — click an agent mid-task to show their task history, current action, and live status
- **Show the fleet panel** — scroll through to show all 5 agents with their statuses at once
- **Terminal split** — keep `cos task send` commands in one terminal, world UI in another
- **Pace Act 2 and 3 together** — tasks 2 and 3 can be sent 30 seconds apart so Iris and Kai are working simultaneously for the most visual impact
