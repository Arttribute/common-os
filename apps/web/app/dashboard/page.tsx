'use client'
import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@/hooks/useAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Fleet {
  _id: string
  name: string
  worldType: string
  status: 'active' | 'stopped'
  agentCount: number
  createdAt: string
  worldConfig: { rooms: Array<{ id: string; label: string }> }
}

interface Agent {
  _id: string
  config: { role: string; integrationPath: string }
  commons?: {
    agentId: string | null
    walletAddress: string | null
    registryAgentId?: string | null
  }
  permissionTier: 'manager' | 'worker'
  status: string
  createdAt: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'monospace' }

const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 7px',
  borderRadius: 4,
  fontSize: 10,
  fontFamily: 'monospace',
  letterSpacing: 0.5,
  background: `${color}18`,
  color,
  border: `1px solid ${color}40`,
})

const statusColor: Record<string, string> = {
  running: '#10b981',
  starting: '#6366f1',
  idle: '#10b981',
  provisioning: '#6366f1',
  stopped: '#4b5563',
  terminated: '#4b5563',
  error: '#ef4444',
}

function statusDot(status: string) {
  const c = statusColor[status] ?? '#4b5563'
  return (
    <span
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: c,
        boxShadow: `0 0 4px ${c}`,
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  )
}

function shortId(value: string | null | undefined): string {
  if (!value) return 'missing'
  if (value.length <= 16) return value
  return `${value.slice(0, 10)}…${value.slice(-4)}`
}

function hasWalletIdentity(value: string | null | undefined): boolean {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value))
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { ready } = usePrivy()
  const { authenticated, tenantId, onboarding, logout, apiFetch } = useAuth()
  const router = useRouter()

  const [fleets, setFleets] = useState<Fleet[]>([])
  const [agentsByFleet, setAgentsByFleet] = useState<Record<string, Agent[]>>({})
  const [expandedFleet, setExpandedFleet] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Create fleet form state ──────────────────────────────────────────────
  const [showCreateFleet, setShowCreateFleet] = useState(false)
  const [fleetName, setFleetName] = useState('')
  const [fleetWorld, setFleetWorld] = useState('office')
  const [creatingFleet, setCreatingFleet] = useState(false)

  // ── Create agent form state ───────────────────────────────────────────────
  const [agentForm, setAgentForm] = useState<string | null>(null) // fleetId
  const [agentRole, setAgentRole] = useState('')
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentTier, setAgentTier] = useState<'manager' | 'worker'>('worker')
  const [agentPath, setAgentPath] = useState<'native' | 'openclaw'>('native')
  const [deployingAgent, setDeployingAgent] = useState(false)

  // Redirect to /auth if not logged in
  useEffect(() => {
    if (ready && !authenticated) router.replace('/auth')
  }, [ready, authenticated, router])

  const fetchFleets = useCallback(async () => {
    if (!authenticated || !tenantId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/fleets')
      if (res.ok) setFleets(await res.json() as Fleet[])
      else setError('could not load fleets')
    } catch {
      setError('could not connect to API')
    } finally {
      setLoading(false)
    }
  }, [authenticated, tenantId, apiFetch])

  useEffect(() => {
    void fetchFleets()
  }, [fetchFleets])

  const fetchAgents = async (fleetId: string) => {
    if (agentsByFleet[fleetId]) return
    const res = await apiFetch(`/fleets/${fleetId}/agents`)
    if (res.ok) {
      const list = await res.json() as Agent[]
      setAgentsByFleet((prev) => ({ ...prev, [fleetId]: list }))
    }
  }

  const toggleFleet = async (fleetId: string) => {
    if (expandedFleet === fleetId) {
      setExpandedFleet(null)
    } else {
      setExpandedFleet(fleetId)
      await fetchAgents(fleetId)
    }
  }

  const createFleet = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fleetName.trim()) return
    setCreatingFleet(true)
    try {
      const res = await apiFetch('/fleets', {
        method: 'POST',
        body: JSON.stringify({ name: fleetName.trim(), worldType: fleetWorld }),
      })
      if (res.ok) {
        const fleet = await res.json() as Fleet
        setFleets((prev) => [fleet, ...prev])
        setFleetName('')
        setFleetWorld('office')
        setShowCreateFleet(false)
      }
    } finally {
      setCreatingFleet(false)
    }
  }

  const deployAgent = async (e: React.FormEvent, fleetId: string) => {
    e.preventDefault()
    if (!agentRole.trim()) return
    setDeployingAgent(true)
    try {
      const res = await apiFetch(`/fleets/${fleetId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          role: agentRole.trim(),
          systemPrompt: agentPrompt.trim() || `You are a ${agentRole.trim()} agent.`,
          permissionTier: agentTier,
          integrationPath: agentPath,
        }),
      })
      if (res.ok) {
        const agent = await res.json() as Agent
        setAgentsByFleet((prev) => ({
          ...prev,
          [fleetId]: [agent, ...(prev[fleetId] ?? [])],
        }))
        // Update agentCount in fleet list
        setFleets((prev) =>
          prev.map((f) =>
            f._id === fleetId ? { ...f, agentCount: f.agentCount + 1 } : f,
          ),
        )
        setAgentForm(null)
        setAgentRole('')
        setAgentPrompt('')
      }
    } finally {
      setDeployingAgent(false)
    }
  }

  const terminateAgent = async (fleetId: string, agentId: string) => {
    const res = await apiFetch(`/fleets/${fleetId}/agents/${agentId}`, { method: 'DELETE' })
    if (!res.ok) {
      setError(`could not terminate agent (${res.status})`)
      return
    }
    setAgentsByFleet((prev) => ({
      ...prev,
      [fleetId]: (prev[fleetId] ?? []).filter((a) => a._id !== agentId),
    }))
    setFleets((prev) =>
      prev.map((f) =>
        f._id === fleetId ? { ...f, agentCount: Math.max(0, f.agentCount - 1) } : f,
      ),
    )
  }

  // ── Loading / auth states ─────────────────────────────────────────────────

  if (!ready || (!authenticated && !onboarding)) {
    return (
      <div style={{ ...centeredPage }}>
        <span style={{ color: '#64748b', fontSize: 12, ...mono }}>loading…</span>
      </div>
    )
  }

  if (onboarding || (authenticated && !tenantId)) {
    return (
      <div style={{ ...centeredPage }}>
        <span style={{ color: '#64748b', fontSize: 12, ...mono }}>setting up your account…</span>
      </div>
    )
  }

  // ── Main dashboard ────────────────────────────────────────────────────────

  const activeAgentFleet = agentForm ? fleets.find(f => f._id === agentForm) : null

  return (
    <div style={{ minHeight: '100vh', background: '#060b14', color: '#e2e8f0', ...mono }}>

      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '14px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          gap: 12,
        }}
      >
        <Link href="/" style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.5, color: 'inherit', textDecoration: 'none' }}>
          common<span style={{ color: '#f59e0b' }}>os</span>
        </Link>
        <span style={{ marginLeft: 'auto' }} />
        <UserEmail />
        <button onClick={() => router.push('/settings')} style={ghostBtn}>settings</button>
        <button onClick={() => void logout()} style={ghostBtn}>sign out</button>
      </header>

      <main style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px' }}>

        {/* Section header */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, gap: 12 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#cbd5e1', margin: 0 }}>fleets</h2>
          <span style={{ fontSize: 10, color: '#64748b', background: 'rgba(255,255,255,0.04)', padding: '2px 7px', borderRadius: 4 }}>
            {fleets.length}
          </span>
          <button style={{ ...actionBtn, marginLeft: 'auto' }} onClick={() => setShowCreateFleet(true)}>
            + new fleet
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ ...panel, color: '#ef4444', fontSize: 11, marginBottom: 16 }}>{error}</div>
        )}

        {/* Fleet list */}
        {loading ? (
          <div style={{ fontSize: 11, color: '#64748b', padding: '16px 0' }}>loading fleets…</div>
        ) : fleets.length === 0 ? (
          <div style={{ ...panel, textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>no fleets yet</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>create a fleet to deploy your first agents</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fleets.map((fleet) => (
              <FleetCard
                key={fleet._id}
                fleet={fleet}
                agents={agentsByFleet[fleet._id]}
                expanded={expandedFleet === fleet._id}
                onToggle={() => void toggleFleet(fleet._id)}
                onOpenWorld={() => router.push(`/world?fleet=${fleet._id}`)}
                onDeployAgent={() => setAgentForm(fleet._id)}
                onTerminateAgent={(agentId) => void terminateAgent(fleet._id, agentId)}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Create fleet dialog ── */}
      {showCreateFleet && (
        <DialogBackdrop onClose={() => { setShowCreateFleet(false); setFleetName(''); setFleetWorld('office') }}>
          <form
            onSubmit={(e) => void createFleet(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>new fleet</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>fleet name</label>
              <input
                style={inputStyle}
                placeholder="my-agent-fleet"
                value={fleetName}
                onChange={(e) => setFleetName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>world type</label>
              <select style={inputStyle} value={fleetWorld} onChange={(e) => setFleetWorld(e.target.value)}>
                <option value="office">office</option>
                <option value="research-lab">research lab</option>
                <option value="command-center">command center</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" style={ghostBtn} onClick={() => { setShowCreateFleet(false); setFleetName(''); setFleetWorld('office') }}>
                cancel
              </button>
              <button type="submit" style={actionBtn} disabled={creatingFleet}>
                {creatingFleet ? 'creating…' : 'create fleet'}
              </button>
            </div>
          </form>
        </DialogBackdrop>
      )}

      {/* ── Deploy agent dialog ── */}
      {agentForm && (
        <DialogBackdrop onClose={() => { setAgentForm(null); setAgentRole(''); setAgentPrompt('') }}>
          <form
            onSubmit={(e) => void deployAgent(e, agentForm)}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>
              deploy agent
              {activeAgentFleet && (
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400, marginLeft: 8 }}>
                  → {activeAgentFleet.name}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}>
                <label style={labelStyle}>role</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. researcher"
                  value={agentRole}
                  onChange={(e) => setAgentRole(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={labelStyle}>tier</label>
                <select style={inputStyle} value={agentTier} onChange={(e) => setAgentTier(e.target.value as 'manager' | 'worker')}>
                  <option value="worker">worker</option>
                  <option value="manager">manager</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={labelStyle}>integration</label>
                <select style={inputStyle} value={agentPath} onChange={(e) => setAgentPath(e.target.value as 'native' | 'openclaw')}>
                  <option value="native">native</option>
                  <option value="openclaw">openclaw</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>system prompt (optional)</label>
              <textarea
                style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
                placeholder={`You are a ${agentRole || 'research'} agent…`}
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" style={ghostBtn} onClick={() => { setAgentForm(null); setAgentRole(''); setAgentPrompt('') }}>
                cancel
              </button>
              <button type="submit" style={actionBtn} disabled={deployingAgent}>
                {deployingAgent ? 'deploying…' : 'deploy agent'}
              </button>
            </div>
          </form>
        </DialogBackdrop>
      )}
    </div>
  )
}

// ── UserEmail helper ──────────────────────────────────────────────────────────

function UserEmail() {
  const { user } = usePrivy()
  const email = user?.email?.address ?? user?.wallet?.address?.slice(0, 10)
  if (!email) return null
  return (
    <span style={{ fontSize: 11, color: '#64748b', letterSpacing: 0.5 }}>
      {email}
    </span>
  )
}

// ── FleetCard ─────────────────────────────────────────────────────────────────

function FleetCard({
  fleet,
  agents,
  expanded,
  onToggle,
  onOpenWorld,
  onDeployAgent,
  onTerminateAgent,
}: {
  fleet: Fleet
  agents?: Agent[]
  expanded: boolean
  onToggle: () => void
  onOpenWorld: () => void
  onDeployAgent: () => void
  onTerminateAgent: (agentId: string) => void
}) {
  return (
    <div style={panel}>
      {/* Fleet header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={onToggle}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: fleet.status === 'active' ? '#10b981' : '#4b5563' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{fleet.name}</span>
        <span style={badge('#6366f1')}>{fleet.worldType}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>{fleet.agentCount} agents</span>
        <button onClick={(e) => { e.stopPropagation(); onOpenWorld() }} style={{ ...actionBtn, fontSize: 9 }}>
          open world →
        </button>
        <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
          {/* Agent list — scrollable when many agents */}
          {!agents ? (
            <div style={{ fontSize: 11, color: '#64748b', padding: '8px 0' }}>loading agents…</div>
          ) : agents.length === 0 ? (
            <div style={{ fontSize: 11, color: '#64748b', padding: '8px 0' }}>no agents deployed</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, maxHeight: 280, overflowY: 'auto' }}>
              {agents.map((agent) => {
                const agcId = agent.commons?.agentId ?? agent.commons?.walletAddress ?? null
                const agcOk = hasWalletIdentity(agcId)
                return (
                  <div
                    key={agent._id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}
                  >
                    {statusDot(agent.status)}
                    <span style={{ fontSize: 11, color: '#cbd5e1', textTransform: 'capitalize' }}>{agent.config.role}</span>
                    <span style={badge(agent.permissionTier === 'manager' ? '#f59e0b' : '#6366f1')}>{agent.permissionTier}</span>
                    <span style={badge('#4b5563')}>{agent.config.integrationPath}</span>
                    {agent.config.integrationPath === 'native' && (
                      <span style={badge(agcOk ? '#10b981' : '#ef4444')} title={agcId ?? 'Agent Commons wallet not resolved'}>
                        agc {shortId(agcId)}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#64748b' }}>{agent.status}</span>
                    <button
                      onClick={() => onTerminateAgent(agent._id)}
                      style={{ background: 'none', border: 'none', color: '#ef444460', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace', padding: '0 4px' }}
                      title="terminate"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <button style={ghostBtn} onClick={onDeployAgent}>+ deploy agent</button>
        </div>
      )}
    </div>
  )
}

// ── Dialog ────────────────────────────────────────────────────────────────────

function DialogBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // Close on Escape
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%', maxWidth: 460,
          background: '#0d1525',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          padding: '24px 28px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          fontFamily: 'monospace',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const centeredPage: React.CSSProperties = {
  width: '100vw',
  height: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#060b14',
  fontFamily: 'monospace',
}

const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 10,
  padding: '14px 16px',
  fontFamily: 'monospace',
}

const actionBtn: React.CSSProperties = {
  padding: '7px 14px',
  background: 'rgba(245, 158, 11, 0.10)',
  border: '1px solid rgba(245, 158, 11, 0.3)',
  borderRadius: 6,
  color: '#f59e0b',
  fontSize: 11,
  fontFamily: 'monospace',
  cursor: 'pointer',
  letterSpacing: 0.3,
  whiteSpace: 'nowrap',
}

const ghostBtn: React.CSSProperties = {
  padding: '7px 12px',
  background: 'none',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6,
  color: '#94a3b8',
  fontSize: 11,
  fontFamily: 'monospace',
  cursor: 'pointer',
  letterSpacing: 0.3,
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#64748b',
  letterSpacing: 0.5,
  textTransform: 'uppercase',
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '7px 10px',
  outline: 'none',
  width: '100%',
}
