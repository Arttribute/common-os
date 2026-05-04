import Link from "next/link";

const C = {
  bg: "#060b14",
  amber: "#f59e0b",
  cyan: "#22d3ee",
  green: "#4ade80",
  purple: "#a78bfa",
  text: "#e2e8f0",
  muted: "#64748b",
  dim: "#334155",
  faint: "#1e293b",
  border: "rgba(255,255,255,0.07)",
  cardBg: "rgba(255,255,255,0.025)",
};

export default function HomePage() {
  return (
    <>
      <style>{`
        .landing { overflow-y: auto; height: 100vh; scroll-behavior: smooth; }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
        .live-dot { animation: pulse-dot 2s ease-in-out infinite; }

        .cta-primary:hover  { background: rgba(245,158,11,0.22) !important; border-color: rgba(245,158,11,0.6) !important; }
        .cta-secondary:hover { border-color: rgba(255,255,255,0.22) !important; color: #e2e8f0 !important; }
        .feature-card:hover  { background: rgba(255,255,255,0.05) !important; border-color: rgba(245,158,11,0.18) !important; }
        .comp-row:hover      { background: rgba(255,255,255,0.03) !important; }
        .nav-link:hover      { color: #e2e8f0 !important; }
        .runtime-card:hover  { border-color: rgba(34,211,238,0.3) !important; background: rgba(34,211,238,0.04) !important; }

        @media (max-width: 860px) {
          .hero-title   { font-size: 20px !important; }
          .section-title { font-size: 16px !important; }
          .two-col      { grid-template-columns: 1fr !important; }
          .three-col    { grid-template-columns: 1fr !important; }
          .four-col     { flex-direction: column !important; }
          .comp-row, .comp-head { grid-template-columns: 2fr 1fr 1fr !important; font-size: 10px !important; }
          .nav-links    { display: none !important; }
          .s-pad        { padding: 72px 24px !important; }
        }
      `}</style>

      <div className="landing" style={{ background: C.bg, color: C.text, fontFamily: "monospace" }}>

        {/* ── Nav ── */}
        <nav style={{
          position: "sticky", top: 0, zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 40px",
          background: "rgba(6,11,20,0.88)",
          backdropFilter: "blur(14px)",
          borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.5 }}>
            common<span style={{ color: C.amber }}>os</span>
          </span>
          <div className="nav-links" style={{ display: "flex", gap: 28, alignItems: "center" }}>
            {[
              { label: "How it works", href: "#how-it-works" },
              { label: "World UI",     href: "#world-ui" },
              { label: "SDK & CLI",    href: "#sdk" },
            ].map(({ label, href }) => (
              <a key={href} href={href} className="nav-link" style={{ fontSize: 10, color: C.muted, textDecoration: "none", letterSpacing: 1.5, textTransform: "uppercase", transition: "color 0.15s" }}>
                {label}
              </a>
            ))}
          </div>
          <Link href="/auth" className="cta-primary" style={{
            padding: "8px 22px",
            background: "rgba(245,158,11,0.1)", border: `1px solid rgba(245,158,11,0.3)`,
            borderRadius: 6, color: C.amber, fontSize: 11, textDecoration: "none",
            letterSpacing: 0.5, transition: "all 0.2s",
          }}>
            get started →
          </Link>
        </nav>

        {/* ── Hero ── */}
        <section style={{
          minHeight: "100vh",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          textAlign: "center", padding: "100px 24px 80px",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: "38%", left: "50%", transform: "translate(-50%, -50%)",
            width: 700, height: 500,
            background: "radial-gradient(ellipse, rgba(245,158,11,0.07) 0%, transparent 68%)",
            pointerEvents: "none",
          }} />

          <div style={{ fontSize: 10, color: C.amber, letterSpacing: 3, marginBottom: 44, textTransform: "uppercase" }}>
            Agent Fleet Infrastructure
          </div>

          <h1 className="hero-title" style={{
            fontFamily: "var(--font-pixel)",
            fontSize: 28, lineHeight: 1.75, marginBottom: 44, maxWidth: 580,
          }}>
            Run agent swarms,<br />
            each with a<br />
            dedicated runtime<br />
            and filesystem.
          </h1>

          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.9, maxWidth: 500, marginBottom: 16 }}>
            Deploy a swarm with one command — every agent gets its own <span style={{ color: C.text }}>dedicated computer</span>, persistent filesystem, and P2P messaging. No shared state. No interference.
          </p>

          {/* CLI teaser */}
          <div style={{
            display: "inline-block", margin: "20px 0 48px",
            padding: "16px 24px",
            background: "rgba(0,0,0,0.5)", border: `1px solid ${C.border}`,
            borderRadius: 10, textAlign: "left",
          }}>
            <div style={{ fontSize: 10, color: C.dim, marginBottom: 12, letterSpacing: 1 }}>QUICKSTART</div>
            {[
              { prompt: "$", cmd: "npm install -g @common-os/cli",                          color: C.muted },
              { prompt: "$", cmd: "cos fleet create --name \"product-team\"",               color: C.text  },
              { prompt: "$", cmd: "cos agent deploy --fleet flt_xyz --role \"researcher\"", color: C.text  },
              { prompt: "$", cmd: "cos task send agt_xyz \"analyze the market\"",           color: C.text  },
            ].map(({ prompt, cmd, color }) => (
              <div key={cmd} style={{ fontSize: 12, lineHeight: 1.9 }}>
                <span style={{ color: C.amber }}>{prompt} </span>
                <span style={{ color }}>{cmd}</span>
              </div>
            ))}
          </div>

          <Link href="/auth" className="cta-primary" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "13px 48px",
            background: "rgba(245,158,11,0.12)", border: `1px solid rgba(245,158,11,0.35)`,
            borderRadius: 8, color: C.amber, fontSize: 12, textDecoration: "none",
            letterSpacing: 0.5, transition: "all 0.2s",
          }}>
            launch your fleet →
          </Link>

          <div style={{ position: "absolute", bottom: 36, fontSize: 9, color: C.faint, letterSpacing: 2 }}>↓ scroll</div>
        </section>

        <div style={{ height: 1, background: `linear-gradient(to right, transparent, ${C.border}, transparent)` }} />

        {/* ── How it works ── */}
        <section id="how-it-works" className="s-pad" style={{ padding: "120px 40px" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ fontSize: 10, color: C.cyan, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>How it works</div>

            <h2 className="section-title" style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 22, lineHeight: 1.75, marginBottom: 40, maxWidth: 500,
            }}>
              One pod.<br />
              Per agent.<br />
              Always on.
            </h2>

            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, maxWidth: 580, marginBottom: 72 }}>
              Every agent in your fleet runs in a dedicated, sandboxed pod with a persistent cloud filesystem. Agents communicate directly over a P2P network — no shared state, no central broker, no interference between agents or with your own environment.
            </p>

            {/* Architecture diagram */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 72 }}>
              <div style={{
                padding: "12px 36px",
                background: "rgba(245,158,11,0.08)", border: `1px solid rgba(245,158,11,0.25)`,
                borderRadius: 8, color: C.amber, fontSize: 10, letterSpacing: 1.5,
              }}>
                YOUR ENVIRONMENT
              </div>
              <div style={{ width: 1, height: 28, background: `linear-gradient(to bottom, rgba(245,158,11,0.4), ${C.border})` }} />

              <div style={{ width: "100%", padding: "28px 28px 32px", background: "rgba(255,255,255,0.018)", border: `1px solid ${C.border}`, borderRadius: 14 }}>
                <div style={{ fontSize: 9, color: C.dim, letterSpacing: 2, marginBottom: 28, textAlign: "center" }}>
                  COMMON OS — FLEET CONTROL PLANE
                </div>

                <div className="four-col" style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                  {[
                    { label: "Agent 01", role: "researcher",  delay: "0s"   },
                    { label: "Agent 02", role: "eng",         delay: "0.5s" },
                    { label: "Agent 03", role: "manager",     delay: "1s"   },
                    { label: "Agent 04", role: "analyst",     delay: "1.5s" },
                  ].map(({ label, role, delay }) => (
                    <div key={label} style={{
                      flex: "1 1 150px",
                      padding: "20px 16px",
                      background: "rgba(34,211,238,0.03)", border: `1px solid rgba(34,211,238,0.14)`,
                      borderRadius: 10, textAlign: "center",
                    }}>
                      <div style={{ fontSize: 9, color: C.cyan, letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
                      <div style={{ fontSize: 9, color: C.dim, marginBottom: 14 }}>role: {role}</div>
                      <div style={{ fontSize: 9, color: C.faint, lineHeight: 2.0, marginBottom: 14 }}>
                        /workspace<br />
                        gVisor sandbox<br />
                        AXL P2P node<br />
                        daemon.mjs
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <span className="live-dot" style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: C.green, animationDelay: delay }} />
                        <span style={{ fontSize: 8, color: C.muted }}>running</span>
                      </div>
                    </div>
                  ))}
                  <div style={{
                    flex: "1 1 80px",
                    padding: "20px 16px", border: `1px dashed ${C.faint}`,
                    borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <span style={{ fontSize: 10, color: C.faint }}>+ n</span>
                  </div>
                </div>

                {/* AXL P2P line */}
                <div style={{ marginTop: 24, padding: "12px 20px", background: "rgba(167,139,250,0.04)", border: `1px solid rgba(167,139,250,0.12)`, borderRadius: 8, textAlign: "center" }}>
                  <span style={{ fontSize: 10, color: C.purple, letterSpacing: 1.5 }}>AXL P2P — </span>
                  <span style={{ fontSize: 10, color: C.muted }}>agents communicate directly, no central broker</span>
                </div>
              </div>
            </div>

            {/* Property cards */}
            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[
                { label: "Sandboxed pods",              desc: "Every agent runs in a hardened, kernel-isolated pod. A compromised agent cannot escape its sandbox or reach your environment.", color: C.cyan },
                { label: "Persistent workspaces",      desc: "Each pod mounts a persistent cloud filesystem. Files survive restarts. Long-running work picks up exactly where it left off.", color: C.green },
                { label: "AXL P2P messaging",          desc: "Agents talk directly over a decentralized P2P network. Workers notify managers on task completion — no broker, no bottleneck.", color: C.purple },
                { label: "Fleet control plane",        desc: "Task routing, event streaming, permission tiers, and world state — one API surface for your entire swarm.", color: C.amber },
              ].map((item) => (
                <div key={item.label} className="feature-card" style={{
                  padding: 24, background: C.cardBg, border: `1px solid ${C.border}`,
                  borderRadius: 10, transition: "all 0.2s",
                }}>
                  <div style={{ fontSize: 11, color: item.color, marginBottom: 8, fontWeight: 600 }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Agent runtimes ── */}
        <section style={{
          padding: "120px 40px",
          background: "rgba(255,255,255,0.015)",
          borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ fontSize: 10, color: C.purple, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>Agent Runtimes</div>

            <h2 className="section-title" style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 22, lineHeight: 1.75, marginBottom: 40, maxWidth: 480,
            }}>
              Bring your<br />
              own agent.
            </h2>

            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, maxWidth: 560, marginBottom: 56 }}>
              Each pod supports three runtime paths. Use the native AI runtime for full agent capabilities, the integrations gateway for 50+ platforms, or bring your own image with any framework.
            </p>

            <div className="three-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
              {[
                {
                  tag: "native",
                  color: C.amber,
                  title: "Native runtime",
                  desc: "Full AI agent capabilities — memory, tools, wallets, and onchain identity. The default path for autonomous agents.",
                  flag: "--integration native",
                },
                {
                  tag: "openclaw",
                  color: C.cyan,
                  title: "Integrations gateway",
                  desc: "50+ platform connectors built in. Messaging platforms, social networks, browser automation — no extra config.",
                  flag: "--integration openclaw",
                },
                {
                  tag: "guest",
                  color: C.purple,
                  title: "Bring your own image",
                  desc: "Any container image, any framework. If your agent runs in a container, it runs here — no lock-in.",
                  flag: "--integration guest",
                },
              ].map((rt) => (
                <div key={rt.tag} className="runtime-card feature-card" style={{
                  padding: 28, background: C.cardBg, border: `1px solid ${C.border}`,
                  borderRadius: 12, transition: "all 0.2s",
                }}>
                  <div style={{
                    display: "inline-block", padding: "3px 10px", marginBottom: 16,
                    background: `rgba(${rt.color === C.amber ? "245,158,11" : rt.color === C.cyan ? "34,211,238" : "167,139,250"},0.1)`,
                    border: `1px solid rgba(${rt.color === C.amber ? "245,158,11" : rt.color === C.cyan ? "34,211,238" : "167,139,250"},0.25)`,
                    borderRadius: 4, fontSize: 10, color: rt.color, letterSpacing: 1,
                  }}>
                    {rt.tag}
                  </div>
                  <div style={{ fontSize: 13, color: C.text, marginBottom: 10, fontWeight: 600 }}>{rt.title}</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8, marginBottom: 20 }}>{rt.desc}</div>
                  <div style={{ fontSize: 11, color: C.faint, fontFamily: "monospace" }}>{rt.flag}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── World UI ── */}
        <section id="world-ui" className="s-pad" style={{ padding: "120px 40px" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ fontSize: 10, color: C.green, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>World UI</div>

            <h2 className="section-title" style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 22, lineHeight: 1.75, marginBottom: 40, maxWidth: 520,
            }}>
              Watch your<br />
              fleet work<br />
              in real time.
            </h2>

            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, maxWidth: 560, marginBottom: 64 }}>
              Open the World UI and your fleet appears in a live 2.5D isometric simulation. Every pod state is reflected in real time — when an agent starts a task, it walks to its desk. When it finishes, an artifact appears in the world. When two agents communicate over AXL, you see the message exchange.
            </p>

            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}>
              <div>
                {[
                  { label: "Task start",       desc: "Agent walks to its desk when work begins." },
                  { label: "Task complete",     desc: "A glowing artifact appears at the agent's workspace." },
                  { label: "AXL message",       desc: "Speech bubbles show live P2P messages between agents." },
                  { label: "Dynamic objects",   desc: "Agents can create whiteboards, terminals, checkpoints in the world." },
                  { label: "Fleet panel",       desc: "Live agent list with status and current action." },
                  { label: "Inspector",         desc: "Select any agent to view task history and recent actions." },
                ].map((item, i) => (
                  <div key={item.label} style={{
                    display: "flex", gap: 16, alignItems: "flex-start",
                    padding: "16px 0",
                    borderBottom: i < 5 ? `1px solid ${C.border}` : "none",
                  }}>
                    <span className="live-dot" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: C.green, marginTop: 4, flexShrink: 0, animationDelay: `${i * 0.3}s` }} />
                    <div>
                      <div style={{ fontSize: 12, color: C.text, marginBottom: 4, fontWeight: 600 }}>{item.label}</div>
                      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ padding: 28, background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 12 }}>
                <div style={{ fontSize: 10, color: C.green, letterSpacing: 2, marginBottom: 20 }}>WORLD EVENT STREAM</div>
                {[
                  { time: "12:04:01", agent: "agt_a1f3", event: "task_start",     detail: "build the auth module",        color: C.cyan },
                  { time: "12:04:03", agent: "agt_b7c2", event: "world_move",     detail: "→ desk_02",                    color: C.muted },
                  { time: "12:04:11", agent: "agt_a1f3", event: "message_sent",   detail: "→ agt_b7c2 via AXL",          color: C.purple },
                  { time: "12:04:11", agent: "agt_b7c2", event: "message_recv",   detail: "from agt_a1f3",               color: C.purple },
                  { time: "12:07:42", agent: "agt_a1f3", event: "task_complete",  detail: "auth.ts written",             color: C.green },
                  { time: "12:07:43", agent: "agt_a1f3", event: "world_create",   detail: "artifact: auth_module",       color: C.amber },
                  { time: "12:07:45", agent: "agt_b7c2", event: "task_start",     detail: "review auth module",          color: C.cyan },
                ].map((ev, i) => (
                  <div key={i} style={{
                    display: "grid", gridTemplateColumns: "60px 80px 1fr",
                    gap: 8, fontSize: 10, padding: "7px 0",
                    borderBottom: i < 6 ? `1px solid rgba(255,255,255,0.04)` : "none",
                  }}>
                    <span style={{ color: C.faint }}>{ev.time}</span>
                    <span style={{ color: C.dim }}>{ev.agent.slice(0, 8)}</span>
                    <span style={{ color: ev.color }}>{ev.event} <span style={{ color: C.faint }}>{ev.detail}</span></span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 48, textAlign: "center" }}>
              <Link href="/world" className="cta-secondary" style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "12px 28px",
                background: "transparent", border: `1px solid ${C.border}`,
                borderRadius: 8, color: C.muted, fontSize: 12, textDecoration: "none",
                letterSpacing: 0.5, transition: "all 0.2s",
              }}>
                <span className="live-dot" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: C.green }} />
                open world UI
              </Link>
            </div>
          </div>
        </section>

        {/* ── SDK & CLI ── */}
        <section id="sdk" style={{
          padding: "120px 40px",
          background: "rgba(255,255,255,0.015)",
          borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ fontSize: 10, color: C.amber, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>SDK & CLI</div>

            <h2 className="section-title" style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 22, lineHeight: 1.75, marginBottom: 40, maxWidth: 480,
            }}>
              Deploy a fleet<br />
              in minutes.
            </h2>

            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, maxWidth: 520, marginBottom: 56 }}>
              A CLI and TypeScript SDK built around fleets, agents, and tasks. One command to create a fleet. One command to deploy an agent. One command to send work.
            </p>

            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              {/* CLI */}
              <div style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "12px 20px", background: "rgba(255,255,255,0.03)", borderBottom: `1px solid ${C.border}`,
                }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["#ff5f57","#febc2e","#28c840"].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />)}
                  </div>
                  <span style={{ fontSize: 11, color: C.muted }}>terminal</span>
                </div>
                <pre style={{ padding: "28px 28px", fontSize: 12, lineHeight: 2.0, overflowX: "auto", margin: 0 }}>
                  <code>
                    <span style={{ color: C.dim }}># install</span>{"\n"}
                    <span style={{ color: C.amber }}>$ </span><span style={{ color: C.text }}>npm install -g @common-os/cli</span>{"\n\n"}
                    <span style={{ color: C.dim }}># create a fleet</span>{"\n"}
                    <span style={{ color: C.amber }}>$ </span><span style={{ color: C.text }}>cos fleet create --name "product-team"</span>{"\n\n"}
                    <span style={{ color: C.dim }}># deploy agents to it</span>{"\n"}
                    <span style={{ color: C.amber }}>$ </span><span style={{ color: C.text }}>cos agent deploy --fleet flt_xyz \</span>{"\n"}
                    {"    "}<span style={{ color: C.text }}>--role "backend-engineer"</span>{"\n\n"}
                    <span style={{ color: C.dim }}># send work</span>{"\n"}
                    <span style={{ color: C.amber }}>$ </span><span style={{ color: C.text }}>cos task send agt_xyz \</span>{"\n"}
                    {"    "}<span style={{ color: C.text }}>"build the auth module" \</span>{"\n"}
                    {"    "}<span style={{ color: C.text }}>--fleet flt_xyz</span>
                  </code>
                </pre>
              </div>

              {/* SDK */}
              <div style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "12px 20px", background: "rgba(255,255,255,0.03)", borderBottom: `1px solid ${C.border}`,
                }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["#ff5f57","#febc2e","#28c840"].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />)}
                  </div>
                  <span style={{ fontSize: 11, color: C.muted }}>fleet.ts</span>
                </div>
                <pre style={{ padding: "28px 28px", fontSize: 12, lineHeight: 2.0, overflowX: "auto", margin: 0 }}>
                  <code>
                    <span style={{ color: C.dim }}>{"// TypeScript SDK"}</span>{"\n"}
                    <span style={{ color: C.cyan }}>import</span><span style={{ color: C.text }}>{" { CommonOSClient } "}</span><span style={{ color: C.cyan }}>from</span><span style={{ color: C.green }}>{" '@common-os/sdk'"}</span>{"\n\n"}
                    <span style={{ color: C.text }}>{"const client = new CommonOSClient({"}</span>{"\n"}
                    {"  "}<span style={{ color: C.text }}>{"apiKey: 'cos_live_...'"}</span>{"\n"}
                    <span style={{ color: C.text }}>{"}) "}</span>{"\n\n"}
                    <span style={{ color: C.dim }}>{"// one fleet, isolated pods per agent"}</span>{"\n"}
                    <span style={{ color: C.text }}>{"const fleet = await client.fleets.create({"}</span>{"\n"}
                    {"  "}<span style={{ color: C.text }}>{"name: 'eng-team'"}</span>{"\n"}
                    <span style={{ color: C.text }}>{"}) "}</span>{"\n\n"}
                    <span style={{ color: C.text }}>{"const agent = await client.agents.deploy("}</span>{"\n"}
                    {"  "}<span style={{ color: C.text }}>{"fleet._id, { role: 'researcher' }"}</span>{"\n"}
                    <span style={{ color: C.text }}>{")"}</span>{"\n\n"}
                    <span style={{ color: C.text }}>{"await client.tasks.send(fleet._id,"}</span>{"\n"}
                    {"  "}<span style={{ color: C.text }}>{"agent._id, { description: 'analyze market' }"}</span>{"\n"}
                    <span style={{ color: C.text }}>{")"}</span>
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section style={{
          padding: "120px 40px", textAlign: "center",
          borderTop: `1px solid ${C.border}`,
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: 700, height: 500,
            background: "radial-gradient(ellipse, rgba(245,158,11,0.06) 0%, transparent 68%)",
            pointerEvents: "none",
          }} />

          <div style={{ fontSize: 10, color: C.amber, letterSpacing: 3, marginBottom: 36, textTransform: "uppercase" }}>Ship it</div>

          <h2 style={{ fontFamily: "var(--font-pixel)", fontSize: 24, lineHeight: 1.75, marginBottom: 44 }}>
            Deploy your<br />
            swarm today.
          </h2>

          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, maxWidth: 420, margin: "0 auto 52px" }}>
            Every agent gets its own <span style={{ color: C.text }}>dedicated computer</span>. Isolated, persistent, always on. Your environment stays yours.
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/auth" className="cta-primary" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "14px 36px",
              background: "rgba(245,158,11,0.12)", border: `1px solid rgba(245,158,11,0.35)`,
              borderRadius: 8, color: C.amber, fontSize: 12, textDecoration: "none",
              letterSpacing: 0.5, transition: "all 0.2s",
            }}>
              launch your fleet →
            </Link>
            <Link href="/world" className="cta-secondary" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "14px 36px",
              background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.muted, fontSize: 12, textDecoration: "none",
              letterSpacing: 0.5, transition: "all 0.2s",
            }}>
              watch live demo
            </Link>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer style={{
          padding: "28px 40px", borderTop: `1px solid ${C.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>
            common<span style={{ color: C.amber }}>os</span>
          </span>
          <span style={{ fontSize: 9, color: C.faint, letterSpacing: 1.5 }}>
            AGENT COMMONS HACKATHON · 2026
          </span>
        </footer>

      </div>
    </>
  );
}
