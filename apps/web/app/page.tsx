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
          50% { opacity: 0.2; }
        }
        .live-dot { animation: pulse-dot 2s ease-in-out infinite; }

        .cta-primary:hover {
          background: rgba(245,158,11,0.22) !important;
          border-color: rgba(245,158,11,0.6) !important;
        }
        .cta-secondary:hover {
          border-color: rgba(255,255,255,0.22) !important;
          color: #e2e8f0 !important;
        }
        .feature-card:hover {
          background: rgba(255,255,255,0.05) !important;
          border-color: rgba(245,158,11,0.18) !important;
        }
        .comparison-row:hover { background: rgba(255,255,255,0.03) !important; }
        .nav-link:hover { color: #e2e8f0 !important; }

        @media (max-width: 860px) {
          .hero-title  { font-size: 20px !important; }
          .section-title { font-size: 16px !important; }
          .two-col { grid-template-columns: 1fr !important; }
          .three-col { grid-template-columns: 1fr !important; }
          .four-col { flex-direction: column !important; }
          .comp-row { grid-template-columns: 2fr 1fr 1fr 1fr !important; font-size: 10px !important; }
          .comp-head { grid-template-columns: 2fr 1fr 1fr 1fr !important; font-size: 9px !important; }
          .nav-links { display: none !important; }
          .section-pad { padding: 72px 24px !important; }
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
            <a href="#insight" className="nav-link" style={{ fontSize: 10, color: C.muted, textDecoration: "none", letterSpacing: 1.5, textTransform: "uppercase", transition: "color 0.15s" }}>Why</a>
            <a href="#how-it-works" className="nav-link" style={{ fontSize: 10, color: C.muted, textDecoration: "none", letterSpacing: 1.5, textTransform: "uppercase", transition: "color 0.15s" }}>How it works</a>
            <a href="#sdk" className="nav-link" style={{ fontSize: 10, color: C.muted, textDecoration: "none", letterSpacing: 1.5, textTransform: "uppercase", transition: "color 0.15s" }}>SDK</a>
          </div>
          <Link href="/auth" className="cta-primary" style={{
            padding: "8px 22px",
            background: "rgba(245,158,11,0.1)",
            border: `1px solid rgba(245,158,11,0.3)`,
            borderRadius: 6,
            color: C.amber,
            fontSize: 11,
            textDecoration: "none",
            letterSpacing: 0.5,
            transition: "all 0.2s",
          }}>
            launch →
          </Link>
        </nav>

        {/* ── Hero ── */}
        <section style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "100px 24px 80px",
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: "38%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 700, height: 500,
            background: "radial-gradient(ellipse, rgba(245,158,11,0.07) 0%, transparent 68%)",
            pointerEvents: "none",
          }} />

          <div style={{ fontSize: 10, color: C.amber, letterSpacing: 3, marginBottom: 44, textTransform: "uppercase" }}>
            Agent Infrastructure
          </div>

          <h1 className="hero-title" style={{
            fontFamily: "var(--font-pixel)",
            fontSize: 30,
            lineHeight: 1.7,
            marginBottom: 44,
            maxWidth: 560,
          }}>
            A persistent<br />
            runtime.<br />
            For every<br />
            agent.
          </h1>

          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.9, maxWidth: 480, marginBottom: 52 }}>
            The same power that makes agentic AI tools unstoppable — a real computer, running your tasks — now available to every agent in your fleet.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <Link href="/auth" className="cta-primary" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "13px 32px",
              background: "rgba(245,158,11,0.12)",
              border: `1px solid rgba(245,158,11,0.35)`,
              borderRadius: 8,
              color: C.amber,
              fontSize: 12,
              textDecoration: "none",
              letterSpacing: 0.5,
              transition: "all 0.2s",
            }}>
              launch your fleet →
            </Link>
            <Link href="/world" className="cta-secondary" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "13px 32px",
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              color: C.muted,
              fontSize: 12,
              textDecoration: "none",
              letterSpacing: 0.5,
              transition: "all 0.2s",
            }}>
              <span className="live-dot" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: C.green }} />
              watch live
            </Link>
          </div>

          <div style={{ position: "absolute", bottom: 36, fontSize: 9, color: C.faint, letterSpacing: 2 }}>↓ scroll</div>
        </section>

        <div style={{ height: 1, background: `linear-gradient(to right, transparent, ${C.border}, transparent)` }} />

        {/* ── The Core Insight ── */}
        <section id="insight" className="section-pad" style={{ padding: "120px 40px" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ fontSize: 10, color: C.cyan, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>The Core Insight</div>

            <h2 className="section-title" style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 22,
              lineHeight: 1.75,
              marginBottom: 64,
              maxWidth: 480,
            }}>
              The reason<br />
              agentic AI<br />
              works.
            </h2>

            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "start" }}>
              <div>
                <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, marginBottom: 24 }}>
                  The most capable AI agents aren't just smarter prompting. They have a computer. They read files, run code, keep processes alive between steps, and pick up exactly where they left off. That persistent runtime is the difference between a tool that responds and one that actually gets things done.
                </p>
                <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, marginBottom: 24 }}>
                  Your onchain agents deserve the same. Without persistent compute, they're just API calls — stateless, short-lived, incapable of long-horizon work.
                </p>
                <p style={{ fontSize: 14, color: C.text, lineHeight: 1.95, borderLeft: `3px solid ${C.amber}`, paddingLeft: 20 }}>
                  CommonOS gives every agent its own machine. Not shared. Not temporary. Its own.
                </p>
              </div>
              <div style={{
                padding: 28,
                background: C.cardBg,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                borderLeft: `3px solid ${C.amber}`,
              }}>
                <div style={{ fontSize: 10, color: C.amber, letterSpacing: 2, marginBottom: 20 }}>WHAT PERSISTENT COMPUTE UNLOCKS</div>
                {[
                  { label: "Long-running tasks", detail: "Processes that live beyond a single prompt, across sessions." },
                  { label: "File system access", detail: "Read, write, and maintain state that persists between calls." },
                  { label: "Code execution", detail: "Run builds, tests, and scripts — autonomously and in isolation." },
                  { label: "Background work", detail: "Monitor, wait, retry, and act without being called every time." },
                ].map((item, i) => (
                  <div key={item.label} style={{
                    marginBottom: i < 3 ? 20 : 0,
                    paddingBottom: i < 3 ? 20 : 0,
                    borderBottom: i < 3 ? `1px solid ${C.border}` : "none",
                  }}>
                    <div style={{ fontSize: 12, color: C.text, marginBottom: 5, fontWeight: 600 }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.7 }}>{item.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── The Problem ── */}
        <section style={{
          padding: "120px 40px",
          background: "rgba(255,255,255,0.015)",
          borderTop: `1px solid ${C.border}`,
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ fontSize: 10, color: C.purple, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>The Problem</div>

            <h2 className="section-title" style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 22,
              lineHeight: 1.75,
              marginBottom: 64,
              maxWidth: 480,
            }}>
              Shared space<br />
              breaks<br />
              fleets.
            </h2>

            <div className="three-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 40 }}>
              {[
                {
                  color: "#ef4444",
                  label: "01",
                  title: "State contamination",
                  desc: "One agent's writes become another agent's reads. Shared filesystems mean shared failure modes — at fleet scale, this compounds fast.",
                },
                {
                  color: "#f97316",
                  label: "02",
                  title: "No security boundary",
                  desc: "A compromised agent can reach your workspace, your credentials, and every other agent's context. There is no blast radius limit.",
                },
                {
                  color: "#eab308",
                  label: "03",
                  title: "Tasks disappear",
                  desc: "Long-running work has nowhere to live. When the session ends, the agent's progress goes with it. Statelessness is a hard ceiling.",
                },
              ].map((item) => (
                <div key={item.title} className="feature-card" style={{
                  padding: 28,
                  background: C.cardBg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  transition: "all 0.2s",
                }}>
                  <div style={{ fontSize: 10, color: item.color, letterSpacing: 2, marginBottom: 16 }}>{item.label}</div>
                  <div style={{ fontSize: 13, color: item.color, marginBottom: 12, fontWeight: 600 }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8 }}>{item.desc}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: "20px 28px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.12)", borderRadius: 8 }}>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.9 }}>
                This is fine with one agent on a demo. At fleet scale — ten, fifty, a hundred agents running in parallel — shared environments are fundamentally broken. Isolation must be a first principle, not an afterthought.
              </p>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how-it-works" className="section-pad" style={{ padding: "120px 40px" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ fontSize: 10, color: C.green, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>How it works</div>

            <h2 className="section-title" style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 22,
              lineHeight: 1.75,
              marginBottom: 40,
              maxWidth: 440,
            }}>
              One pod.<br />
              Per agent.<br />
              Always on.
            </h2>

            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, maxWidth: 560, marginBottom: 72 }}>
              CommonOS provisions a secure, isolated pod for every agent in your fleet. Each pod is a complete runtime — its own filesystem, processes, and memory. Agents cannot reach each other's environments, and they cannot reach yours. Long-running tasks persist on each agent's own pod between calls.
            </p>

            {/* Architecture diagram */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 64 }}>
              {/* Your workspace */}
              <div style={{
                padding: "12px 36px",
                background: "rgba(245,158,11,0.08)",
                border: `1px solid rgba(245,158,11,0.25)`,
                borderRadius: 8,
                color: C.amber,
                fontSize: 10,
                letterSpacing: 1.5,
              }}>
                YOUR WORKSPACE
              </div>

              {/* Connector */}
              <div style={{ width: 1, height: 28, background: `linear-gradient(to bottom, rgba(245,158,11,0.4), ${C.border})` }} />

              {/* CommonOS layer */}
              <div style={{
                width: "100%",
                padding: "28px 28px 32px",
                background: "rgba(255,255,255,0.018)",
                border: `1px solid ${C.border}`,
                borderRadius: 14,
              }}>
                <div style={{ fontSize: 9, color: C.dim, letterSpacing: 2, marginBottom: 28, textAlign: "center" }}>
                  COMMON OS — ISOLATION BOUNDARY
                </div>

                <div className="four-col" style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                  {[
                    { label: "Agent 01", delay: "0s" },
                    { label: "Agent 02", delay: "0.5s" },
                    { label: "Agent 03", delay: "1s" },
                    { label: "Agent 04", delay: "1.5s" },
                  ].map(({ label, delay }) => (
                    <div key={label} style={{
                      flex: "1 1 140px",
                      padding: "20px 16px",
                      background: "rgba(34,211,238,0.03)",
                      border: `1px solid rgba(34,211,238,0.14)`,
                      borderRadius: 10,
                      textAlign: "center",
                    }}>
                      <div style={{ fontSize: 9, color: C.cyan, letterSpacing: 1.5, marginBottom: 14 }}>{label}</div>
                      <div style={{ fontSize: 9, color: C.faint, lineHeight: 2.0, marginBottom: 14 }}>
                        /workspace<br />
                        /processes<br />
                        /memory<br />
                        /network
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <span className="live-dot" style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: C.green, animationDelay: delay }} />
                        <span style={{ fontSize: 8, color: C.muted }}>running</span>
                      </div>
                    </div>
                  ))}
                  <div style={{
                    flex: "1 1 80px",
                    padding: "20px 16px",
                    border: `1px dashed ${C.faint}`,
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 80,
                  }}>
                    <span style={{ fontSize: 10, color: C.faint }}>+ n</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Properties grid */}
            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[
                { label: "Persistent state", desc: "Tasks keep running. Files stay. Processes live between prompts and across sessions." },
                { label: "Hard isolation", desc: "Each pod is cryptographically separate. No cross-agent contamination, ever." },
                { label: "Long-horizon work", desc: "Agents monitor, wait, retry, and act without being invoked every step of the way." },
                { label: "Fleet identity", desc: "Every agent has an onchain identity and an auditable history of actions taken." },
              ].map((item) => (
                <div key={item.label} className="feature-card" style={{
                  padding: 24,
                  background: C.cardBg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  transition: "all 0.2s",
                }}>
                  <div style={{ fontSize: 12, color: C.text, marginBottom: 8, fontWeight: 600 }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Why not VMs ── */}
        <section style={{
          padding: "120px 40px",
          background: "rgba(255,255,255,0.015)",
          borderTop: `1px solid ${C.border}`,
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ fontSize: 10, color: C.amber, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>Why not VMs</div>

            <h2 className="section-title" style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 22,
              lineHeight: 1.75,
              marginBottom: 40,
              maxWidth: 480,
            }}>
              Faster than<br />
              a VM. Built<br />
              for agents.
            </h2>

            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, maxWidth: 560, marginBottom: 64 }}>
              You could provision a VM per agent. You'd spend more, wait minutes for each cold start, and still end up managing infrastructure that was built for human workloads, not AI agents. CommonOS is purpose-built for fleet-scale agent deployment.
            </p>

            {/* Comparison table */}
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div className="comp-head" style={{
                display: "grid",
                gridTemplateColumns: "2fr 1.5fr 1.5fr 1.5fr",
                padding: "14px 28px",
                background: "rgba(255,255,255,0.04)",
                borderBottom: `1px solid ${C.border}`,
                fontSize: 10, letterSpacing: 1.5,
              }}>
                <span style={{ color: C.muted }}>CAPABILITY</span>
                <span style={{ color: C.amber }}>COMMONOS</span>
                <span style={{ color: C.dim }}>VMs</span>
                <span style={{ color: C.dim }}>SHARED RUNTIME</span>
              </div>
              {[
                { cap: "Cold start",         cos: "< 1 second",      vm: "2 – 5 minutes",   shared: "instant (unsafe)" },
                { cap: "Agent isolation",    cos: "per-agent",        vm: "per-VM (manual)", shared: "none" },
                { cap: "Fleet scale",        cos: "one command",      vm: "complex IaC",     shared: "fragile" },
                { cap: "Cost",               cos: "purpose-built",    vm: "overprovisioned", shared: "low (but unsafe)" },
                { cap: "Long-running tasks", cos: "native",           vm: "yes",             shared: "no" },
                { cap: "Agent-native APIs",  cos: "yes",              vm: "no",              shared: "no" },
                { cap: "Onchain identity",   cos: "built in",         vm: "none",            shared: "none" },
              ].map((row, i) => (
                <div key={row.cap} className="comp-row comparison-row" style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1.5fr 1.5fr 1.5fr",
                  padding: "14px 28px",
                  borderBottom: i < 6 ? `1px solid ${C.border}` : "none",
                  fontSize: 12,
                  transition: "background 0.15s",
                }}>
                  <span style={{ color: C.muted }}>{row.cap}</span>
                  <span style={{ color: C.green }}>{row.cos}</span>
                  <span style={{ color: C.dim }}>{row.vm}</span>
                  <span style={{ color: C.faint }}>{row.shared}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SDK ── */}
        <section id="sdk" className="section-pad" style={{ padding: "120px 40px" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ fontSize: 10, color: C.cyan, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>SDK</div>

            <h2 className="section-title" style={{
              fontFamily: "var(--font-pixel)",
              fontSize: 22,
              lineHeight: 1.75,
              marginBottom: 40,
              maxWidth: 480,
            }}>
              Deploy a fleet<br />
              in minutes.
            </h2>

            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, maxWidth: 520, marginBottom: 56 }}>
              A TypeScript SDK designed around agent fleets. Spin up isolated pods, assign work, and let agents run — each in their own secure workspace, with no infrastructure to manage.
            </p>

            <div style={{
              background: "rgba(0,0,0,0.45)",
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              overflow: "hidden",
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 16,
                padding: "12px 20px",
                background: "rgba(255,255,255,0.03)",
                borderBottom: `1px solid ${C.border}`,
              }}>
                <div style={{ display: "flex", gap: 6 }}>
                  {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                    <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
                  ))}
                </div>
                <span style={{ fontSize: 11, color: C.muted }}>deploy-fleet.ts</span>
              </div>

              <pre style={{ padding: "32px 36px", fontSize: 13, lineHeight: 1.9, overflowX: "auto", margin: 0 }}>
                <code style={{ color: C.text }}>{`import { CommonOS } from "@common-os/sdk"

const os = new CommonOS()

`}<span style={{ color: C.dim }}>{`// Each agent gets its own isolated pod`}</span>{`
const fleet = await os.deploy({
  size: 10,
  image: "agent",
})

`}<span style={{ color: C.dim }}>{`// Long-running tasks that actually persist`}</span>{`
await fleet.agents[0].run(
  "Monitor the mempool and execute when conditions are met"
)

`}<span style={{ color: C.dim }}>{`// Agents work in parallel, in total isolation`}</span>{`
await Promise.all(
  fleet.agents.map(agent =>
    agent.run("Analyze and rebalance the portfolio")
  )
)

`}<span style={{ color: C.dim }}>{`// Nothing bleeds between pods`}</span>{`
console.log(fleet.agents.map(a => a.pod.id))
`}<span style={{ color: C.muted }}>{`// → ['pod_a1f3', 'pod_b7c2', 'pod_c9d1', ...]`}</span>
                </code>
              </pre>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section style={{
          padding: "120px 40px",
          textAlign: "center",
          borderTop: `1px solid ${C.border}`,
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 700, height: 500,
            background: "radial-gradient(ellipse, rgba(245,158,11,0.06) 0%, transparent 68%)",
            pointerEvents: "none",
          }} />

          <div style={{ fontSize: 10, color: C.amber, letterSpacing: 3, marginBottom: 36, textTransform: "uppercase" }}>Ship it</div>

          <h2 style={{
            fontFamily: "var(--font-pixel)",
            fontSize: 24,
            lineHeight: 1.75,
            marginBottom: 44,
          }}>
            Deploy your<br />
            fleet today.
          </h2>

          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.95, maxWidth: 420, margin: "0 auto 52px" }}>
            Give your agents a real computer. Isolate them from each other and from you. Let them work on long-horizon tasks while you focus on what matters.
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/auth" className="cta-primary" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "14px 36px",
              background: "rgba(245,158,11,0.12)",
              border: `1px solid rgba(245,158,11,0.35)`,
              borderRadius: 8,
              color: C.amber,
              fontSize: 12,
              textDecoration: "none",
              letterSpacing: 0.5,
              transition: "all 0.2s",
            }}>
              launch your fleet →
            </Link>
            <Link href="/world" className="cta-secondary" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "14px 36px",
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              color: C.muted,
              fontSize: 12,
              textDecoration: "none",
              letterSpacing: 0.5,
              transition: "all 0.2s",
            }}>
              watch live demo
            </Link>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer style={{
          padding: "28px 40px",
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
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
