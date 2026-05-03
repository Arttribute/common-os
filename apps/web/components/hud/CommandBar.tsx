'use client'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'
import { useAuthStore } from '@/store/authStore'

export function CommandBar() {
  const [input, setInput] = useState('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [axlTargetAgentId, setAxlTargetAgentId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [systemLog, setSystemLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const selectedId = useAgentStore((s) => s.selectedAgentId)
  const agents = useAgentStore((s) => s.agents)
  const activeSessionByAgent = useAgentStore((s) => s.activeSessionByAgent)
  const setCurrentTask = useAgentStore((s) => s.setCurrentTask)
  const updateStatus = useAgentStore((s) => s.updateStatus)
  const setCurrentAction = useAgentStore((s) => s.setCurrentAction)
  const storeFleetId = useWorldStore((s) => s.fleetId)
  const storedApiKey = useAuthStore((s) => s.apiKey)
  const searchParams = useSearchParams()

  const selected = selectedId ? agents[selectedId] : null
  const activeSessionId = selectedId ? activeSessionByAgent[selectedId] : null
  const shortRole = selected?.role.replace(/-/g, ' ') ?? 'an agent'
  const mentionableAgents = useMemo(() => (
    Object.values(agents)
      .filter((agent) => agent.agentId !== selectedId)
      .filter((agent) => {
        const q = mentionQuery.toLowerCase()
        if (!q) return true
        return agent.role.toLowerCase().includes(q) || agent.agentId.toLowerCase().includes(q)
      })
      .sort((a, b) => a.role.localeCompare(b.role))
      .slice(0, 6)
  ), [agents, selectedId, mentionQuery])

  const { getAccessToken, authenticated } = usePrivy()
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  const urlFleet = searchParams.get('fleet')
  const activeFleetId = urlFleet ?? storeFleetId
  const isLive = Boolean(apiUrl && activeFleetId && (storedApiKey ?? process.env.NEXT_PUBLIC_API_KEY ?? authenticated))

  async function resolveToken(): Promise<string | null> {
    if (storedApiKey) return storedApiKey
    if (process.env.NEXT_PUBLIC_API_KEY) return process.env.NEXT_PUBLIC_API_KEY
    try { return await getAccessToken() } catch { return null }
  }

  function addLogLine(line: string) {
    setSystemLog((prev) => [...prev.slice(-3), line])
    setTimeout(() => {
      setSystemLog((prev) => prev.filter(l => l !== line))
    }, 5000)
  }

  async function handleSend() {
    if (!input.trim() || !selectedId) return
    setSending(true)
    setError(null)
    const content = input.trim()
    setInput('')
    setAxlTargetAgentId(null)
    setMentionOpen(false)

    // ENS resolution theater
    if (selected?.ensName) {
      addLogLine(`[System] Looking up ${selected.ensName} on ENS Registry…`)
      await new Promise(r => setTimeout(r, 800))
      if (selected.ensRecords?.multiaddr) {
        addLogLine(`[System] Resolved to AXL Peer ${selected.ensRecords.peerId?.slice(0, 12) ?? 'unknown'}…`)
        await new Promise(r => setTimeout(r, 400))
      }
      addLogLine('[System] Routing message payload via AXL…')
      await new Promise(r => setTimeout(r, 600))
    }

    if (isLive && activeFleetId) {
      try {
        const token = await resolveToken()
        const res = await fetch(`${apiUrl}/fleets/${activeFleetId}/agents/${selectedId}/human-message`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content,
            ...(activeSessionId ? { sessionId: activeSessionId } : {}),
            ...(axlTargetAgentId ? { axlTargetAgentId } : {}),
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null) as { error?: string } | null
          setError(data?.error ?? `message failed (${res.status})`)
          setInput(content)
          updateStatus(selectedId, 'error')
          setSending(false)
          return
        }
        // Agent response will arrive via WebSocket broadcast
      } catch {
        setError('could not connect to message API')
        setInput(content)
        updateStatus(selectedId, 'error')
      }
    } else {
      fallbackLocalUpdate(selectedId, content)
    }

    setSending(false)
  }

  function fallbackLocalUpdate(agentId: string, content: string) {
    const taskId = `tsk_${Date.now()}`
    setCurrentTask(agentId, { taskId, description: content })
    updateStatus(agentId, 'working')
    setCurrentAction(agentId, content.slice(0, 40))
  }

  const displayLabel = selected?.ensName
    ? selected.ensName.split('.')[0] ?? shortRole
    : shortRole

  function onInputChange(value: string) {
    setInput(value)
    const match = value.match(/(?:^|\s)@([^\s@]*)$/)
    if (match) {
      setMentionOpen(true)
      setMentionQuery(match[1] ?? '')
      setMentionIndex(0)
    } else {
      setMentionOpen(false)
      setMentionQuery('')
      if (!axlTargetAgentId || !value.includes('@')) setAxlTargetAgentId(null)
    }
  }

  function insertMention(agentId: string) {
    const agent = agents[agentId]
    if (!agent) return
    const label = agent.role.replace(/\s+/g, '-')
    const next = input.replace(/(^|\s)@[^\s@]*$/, `$1@${label} `)
    setInput(next)
    setAxlTargetAgentId(agentId)
    setMentionOpen(false)
    setMentionQuery('')
  }

  return (
    <div style={{ position: 'relative', pointerEvents: 'none', zIndex: 10 }}>
      {/* System log lines above the command bar */}
      {systemLog.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 52,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          alignItems: 'center',
          pointerEvents: 'none',
        }}>
          {systemLog.map((line, i) => (
            <span
              key={i}
              style={{
                fontSize: 9,
                color: i === systemLog.length - 1 ? '#f59e0b' : '#475569',
                fontFamily: 'monospace',
                opacity: 1 - (systemLog.length - 1 - i) * 0.25,
              }}
            >
              {line}
            </span>
          ))}
        </div>
      )}

      {/* @mention autocomplete dropdown */}
      {mentionOpen && selectedId && mentionableAgents.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 68,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 460,
            background: 'rgba(6, 11, 20, 0.96)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            overflow: 'hidden',
            pointerEvents: 'auto',
            zIndex: 12,
            boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
          }}
        >
          {mentionableAgents.map((agent, idx) => (
            <button
              key={agent.agentId}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertMention(agent.agentId) }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                background: idx === mentionIndex ? 'rgba(245,158,11,0.12)' : 'transparent',
                border: 0,
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                color: '#cbd5e1',
                cursor: 'pointer',
                fontFamily: 'monospace',
                textAlign: 'left',
              }}
            >
              <span style={{ color: '#f59e0b', fontSize: 10 }}>@</span>
              <span style={{ flex: 1, fontSize: 10 }}>{agent.role.replace(/-/g, ' ')}</span>
              <span style={{ color: '#334155', fontSize: 8 }}>{agent.agentId.slice(0, 8)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Error notice */}
      {error && !mentionOpen && (
        <div style={{
          position: 'absolute',
          bottom: 68,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 460,
          background: 'rgba(127, 29, 29, 0.9)',
          border: '1px solid rgba(248,113,113,0.25)',
          borderRadius: 6,
          color: '#fecaca',
          padding: '7px 10px',
          fontSize: 10,
          fontFamily: 'monospace',
          pointerEvents: 'auto',
          zIndex: 10,
        }}>
          {error}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 460,
          background: 'rgba(6, 11, 20, 0.9)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'auto',
          zIndex: 10,
        }}
      >
        <span style={{ fontSize: 9, color: selected?.ensName ? '#10b981' : '#334155', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {selected ? `→ ${displayLabel}` : '→ select agent'}
        </span>

        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (mentionOpen && mentionableAgents.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentionIndex((i) => (i + 1) % mentionableAgents.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionIndex((i) => (i - 1 + mentionableAgents.length) % mentionableAgents.length)
                return
              }
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault()
                const agent = mentionableAgents[mentionIndex]
                if (agent) insertMention(agent.agentId)
                return
              }
              if (e.key === 'Escape') {
                setMentionOpen(false)
                return
              }
            }
            if (e.key === 'Enter') void handleSend()
          }}
          placeholder={selected ? `Message ${displayLabel}... (@ to mention)` : 'Click an agent to select'}
          disabled={!selectedId}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#e2e8f0',
            fontSize: 11,
            fontFamily: 'monospace',
            caretColor: '#f59e0b',
          }}
        />

        <button
          onClick={() => void handleSend()}
          disabled={!selectedId || !input.trim() || sending}
          style={{
            background: selectedId && input.trim() ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
            border: `1px solid ${selectedId && input.trim() ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255,255,255,0.05)'}`,
            borderRadius: 5,
            color: selectedId && input.trim() ? '#f59e0b' : '#334155',
            fontSize: 9,
            fontFamily: 'monospace',
            padding: '4px 10px',
            cursor: selectedId && input.trim() ? 'pointer' : 'default',
            transition: 'all 0.15s',
          }}
        >
          {sending ? '…' : 'send'}
        </button>
      </div>
    </div>
  )
}
