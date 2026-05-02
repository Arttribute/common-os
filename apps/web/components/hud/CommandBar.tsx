'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'
import { useAuthStore } from '@/store/authStore'

export function CommandBar() {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const selectedId = useAgentStore((s) => s.selectedAgentId)
  const agents = useAgentStore((s) => s.agents)
  const setCurrentTask = useAgentStore((s) => s.setCurrentTask)
  const updateStatus = useAgentStore((s) => s.updateStatus)
  const setCurrentAction = useAgentStore((s) => s.setCurrentAction)
  const storeFleetId = useWorldStore((s) => s.fleetId)
  const storedApiKey = useAuthStore((s) => s.apiKey)
  const searchParams = useSearchParams()

  const selected = selectedId ? agents[selectedId] : null
  const shortRole = selected?.role.replace(/-/g, ' ') ?? 'an agent'

  const { getAccessToken, authenticated } = usePrivy()
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  // URL param takes priority; store value is fallback (set from snapshot)
  const urlFleet = searchParams.get('fleet')
  const activeFleetId = urlFleet ?? storeFleetId
  // Live if we have an API URL + fleet + any auth (stored key, env key, or Privy session)
  const isLive = Boolean(apiUrl && activeFleetId && (storedApiKey ?? process.env.NEXT_PUBLIC_API_KEY ?? authenticated))

  async function resolveToken(): Promise<string | null> {
    if (storedApiKey) return storedApiKey
    if (process.env.NEXT_PUBLIC_API_KEY) return process.env.NEXT_PUBLIC_API_KEY
    try { return await getAccessToken() } catch { return null }
  }

  async function handleSend() {
    if (!input.trim() || !selectedId) return
    setSending(true)
    const content = input.trim()
    setInput('')

    if (isLive && activeFleetId) {
      try {
        const token = await resolveToken()
        await fetch(`${apiUrl}/fleets/${activeFleetId}/agents/${selectedId}/human-message`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        })
        // Agent response will arrive via WebSocket broadcast
      } catch {
        fallbackLocalUpdate(selectedId, content)
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

  return (
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
      <span style={{ fontSize: 9, color: '#334155', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
        {selected ? `→ ${shortRole}` : '→ select agent'}
      </span>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void handleSend()}
        placeholder={selected ? `Message ${shortRole}...` : 'Click an agent to select'}
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
  )
}
