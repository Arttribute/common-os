import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Cloud,
  HardDrive,
  LockKeyhole,
  Network,
  Server,
  Terminal,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LandingWorldPreview } from "@/components/LandingWorldPreview";

const capabilities = [
  {
    icon: Server,
    title: "Dedicated runtime per agent",
    description:
      "Each agent runs in its own isolated pod with a durable workspace and clear operational boundaries.",
  },
  {
    icon: Workflow,
    title: "Fleet control plane",
    description:
      "Create fleets, deploy agents, assign tasks, and stream events from one API and CLI surface.",
  },
  {
    icon: HardDrive,
    title: "Persistent workspaces",
    description:
      "Agent files survive restarts so long-running work can resume instead of starting from scratch.",
  },
  {
    icon: LockKeyhole,
    title: "Permissioned agents",
    description:
      "Separate manager and worker tiers so autonomy is useful without turning operations into guesswork.",
  },
];

const runtimeRows = [
  ["Native", "Managed AI agent runtime with tools, memory, wallet identity, and task events."],
  ["OpenClaw", "Connector-ready runtime for platform integrations and browser-based work."],
  [
    "Guest image",
    "Run your own agent container beside the CommonOS daemon, with shared workspace access and the task/event API contract.",
  ],
];

const terminalLines = [
  "npm install -g @common-os/cli",
  'cos fleet create --name "product-team"',
  'cos agent deploy --fleet flt_xyz --role "backend-engineer"',
  'cos task send agt_xyz "ship the auth module" --fleet flt_xyz',
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 overflow-hidden border-b border-white/10 bg-background/90 backdrop-blur">
        <HeaderSwarm />
        <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a className="transition-colors hover:text-foreground" href="#platform">
              Platform
            </a>
            <a className="transition-colors hover:text-foreground" href="/docs">
              Docs
            </a>
            <a className="transition-colors hover:text-foreground" href="#workflow">
              Workflow
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <a href="https://github.com/Arttribute/common-os" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth">
                Launch
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="border-b border-white/10">
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-12 px-6 py-24 lg:grid-cols-[0.95fr_1.05fr] lg:py-28">
          <div className="relative max-w-2xl">
            <HeroSwarm />
            <Badge variant="outline" className="mb-6 bg-background">
              Agent fleet infrastructure
            </Badge>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Operate AI agents like production infrastructure.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              CommonOS gives every agent a dedicated runtime, persistent filesystem,
              task stream, and fleet-level control plane so teams can deploy
              autonomous workers with the same discipline they expect from cloud tools.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/auth">
                  Create a fleet
                  <ArrowRight />
                </Link>
              </Button>
            </div>
            <div className="mt-10 grid max-w-xl grid-cols-2 gap-4 text-sm text-muted-foreground sm:grid-cols-3">
              {["Isolated pods", "Persistent files", "Real-time events"].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="window-breathe overflow-hidden rounded-lg border border-white/10 bg-[#080c14] shadow-2xl shadow-black/50">
            <div className="flex h-10 items-center gap-3 border-b border-white/10 bg-gradient-to-b from-[#141e30] to-[#0e1525] px-4">
              <div className="flex gap-1.5">
                <span className="size-3 rounded-full bg-red-500" />
                <span className="size-3 rounded-full bg-amber-500" />
                <span className="size-3 rounded-full bg-emerald-500" />
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Terminal className="size-4 text-muted-foreground" />
                <span className="truncate text-sm font-medium text-slate-300">Fleet quickstart</span>
                <Badge variant="warning" className="hidden sm:inline-flex">CLI</Badge>
              </div>
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                cos quickstart
              </span>
            </div>

            <div className="flex border-b border-white/10 bg-[#0a0e1a] px-4">
              {["Terminal", "Fleets", "Agents"].map((label, index) => (
                <div
                  key={label}
                  className={
                    index === 0
                      ? "border-b-2 border-amber-400 px-3 py-2 text-xs font-medium text-amber-200"
                      : "px-3 py-2 text-xs font-medium text-muted-foreground"
                  }
                >
                  {label}
                </div>
              ))}
            </div>

            <div className="p-5">
              <div className="rounded-md border border-white/10 bg-[#060a12] p-5 font-mono text-sm text-slate-200 shadow-inner">
                <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3 text-xs text-muted-foreground">
                  <span>/workspace/product-team</span>
                  <span>zsh</span>
                </div>
                {terminalLines.map((line) => (
                  <div key={line} className="flex gap-3 py-1.5">
                    <span className="text-amber-300">$</span>
                    <span className="break-all">{line}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["fleets", "Create runtime groups"],
                  ["agents", "Deploy workers"],
                  ["tasks", "Route work"],
                ].map(([label, copy]) => (
                  <div key={label} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{copy}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="border-b border-white/10 bg-muted/30 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-2xl">
            <Badge variant="secondary">Platform</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              The standard operating layer for agent fleets.
            </h2>
            <p className="mt-4 text-muted-foreground">
              CommonOS focuses on the operational pieces teams need after the first demo:
              isolation, lifecycle control, task routing, identity, and audit-ready events.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((item) => (
              <Card key={item.title}>
                <CardHeader>
                  <div className="mb-3 flex size-10 items-center justify-center rounded-md border bg-background">
                    <item.icon className="size-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{item.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-6 text-muted-foreground">
                  {item.description}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="world-ui" className="border-b border-white/10 bg-muted/20 py-20">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 lg:grid-cols-[1.15fr_0.85fr]">
          <LandingWorldPreview />
          <div className="max-w-xl lg:pl-6">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Watch work move through the fleet.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              The world view gives operators a quick read on who is running, what is in flight,
              and where attention is needed. It is a map for supervision, not decoration.
            </p>
            <div className="mt-6 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              {[
                "Fleet status at a glance",
                "Task progress in context",
                "Command input in context",
                "Details available when selected",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="runtimes" className="border-b border-white/10 py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Badge variant="secondary">Runtimes</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Use the runtime path that matches the work.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Start with the managed runtime, connect to external systems when needed,
              or bring a containerized agent stack you already trust.
            </p>
          </div>
          <Card>
            <CardContent className="p-0">
              {runtimeRows.map(([name, description]) => (
                <div
                  key={name}
                  className="grid gap-3 border-b p-5 last:border-b-0 sm:grid-cols-[160px_1fr]"
                >
                  <div className="font-semibold">{name}</div>
                  <div className="text-sm leading-6 text-muted-foreground">{description}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="workflow" className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Boxes,
                title: "Create a fleet",
                copy: "Define the operating environment and deploy a group of isolated agents.",
              },
              {
                icon: Cloud,
                title: "Assign work",
                copy: "Send tasks through the API, CLI, or dashboard and follow status in real time.",
              },
              {
                icon: Network,
                title: "Inspect outcomes",
                copy: "Review agents, workspaces, events, and the visual world view when you need live context.",
              },
            ].map((item) => (
              <Card key={item.title}>
                <CardHeader>
                  <item.icon className="size-5 text-primary" />
                  <CardTitle className="text-lg">{item.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-6 text-muted-foreground">
                  {item.copy}
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-16 rounded-lg border border-amber-400/20 bg-[#060b14] px-6 py-8 text-center text-slate-100 shadow-2xl shadow-black/30 sm:px-10">
            <h2 className="text-3xl font-semibold tracking-tight">
              Deploy a fleet with a clean operational surface.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              The dashboard is built for repeated use: create fleets, deploy agents,
              open the world view, and manage credentials without leaving the control plane.
            </p>
            <Button asChild size="lg" className="mt-6">
              <Link href="/auth">
                Get started
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function Logo() {
  return (
    <Link href="/" className="text-lg font-semibold tracking-tight text-foreground">
      Common<span className="text-primary">OS</span>
    </Link>
  );
}

function HeaderSwarm() {
  return (
    <svg
      className="pointer-events-none absolute right-0 top-0 h-16 w-[360px] text-amber-300/50 opacity-60"
      viewBox="0 0 360 64"
      aria-hidden="true"
    >
      <path className="swarm-line" d="M36 34 C88 8 132 54 184 28 S286 12 330 38" fill="none" stroke="currentColor" strokeWidth="1" />
      <path className="swarm-line" d="M76 46 C124 24 170 42 220 20 S294 30 340 18" fill="none" stroke="currentColor" strokeWidth="1" style={{ animationDelay: "1.4s" }} />
      {[36, 105, 184, 260, 330].map((x, index) => (
        <circle
          key={x}
          className="swarm-node"
          cx={x}
          cy={index % 2 ? 24 : 38}
          r="3"
          fill="currentColor"
          style={{ animationDelay: `${index * 0.45}s` }}
        />
      ))}
    </svg>
  );
}

function HeroSwarm() {
  return (
    <div className="pointer-events-none absolute -right-10 top-6 hidden h-56 w-72 text-amber-300/45 opacity-45 sm:block lg:-right-20">
      <svg className="h-full w-full" viewBox="0 0 288 224" aria-hidden="true">
        <path className="swarm-line" d="M28 116 C76 62 128 150 174 84 S228 92 262 42" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path className="swarm-line" d="M42 166 C86 112 126 128 174 158 S226 148 258 112" fill="none" stroke="rgb(129 140 248 / 0.72)" strokeWidth="1.1" style={{ animationDelay: "1.6s" }} />
        <path className="swarm-line" d="M72 58 C122 38 168 58 214 30" fill="none" stroke="rgb(52 211 153 / 0.5)" strokeWidth="1" style={{ animationDelay: "2.5s" }} />
        {[
          [28, 116],
          [86, 82],
          [132, 132],
          [174, 84],
          [222, 104],
          [262, 42],
        ].map(([x, y], index) => (
          <g key={`${x}-${y}`} className="swarm-node" style={{ animationDelay: `${index * 0.35}s` }}>
            <circle cx={x} cy={y} r="5.5" fill="rgb(6 11 20 / 0.92)" stroke="currentColor" strokeWidth="1.3" />
            <circle cx={x} cy={y} r="2" fill="currentColor" />
          </g>
        ))}
      </svg>
      <span
        className="packet-dot absolute size-1.5 rounded-full bg-amber-300 shadow-[0_0_12px_rgb(245_158_11_/_0.8)]"
        style={{ offsetPath: "path('M28 116 C76 62 128 150 174 84 S228 92 262 42')" }}
      />
      <span
        className="packet-dot absolute size-1.5 rounded-full bg-indigo-300 shadow-[0_0_12px_rgb(129_140_248_/_0.8)]"
        style={{
          offsetPath: "path('M42 166 C86 112 126 128 174 158 S226 148 258 112')",
          animationDelay: "2.2s",
        }}
      />
    </div>
  );
}
