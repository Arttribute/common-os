'use client'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
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
  // URL param takes priority; store value is fallback (set from snapshot)
  const urlFleet = searchParams.get('fleet')
  const activeFleetId = urlFleet ?? storeFleetId
  // Live if we have an API URL + fleet + any auth (stored key, env key, or Privy session)
  const isLive = Boolean(apiUrl && activeFleetId && (storedApiKey || process.env.NEXT_PUBLIC_API_KEY || authenticated))

  async function resolveToken(): Promise<string | null> {
    if (storedApiKey) return storedApiKey
    if (process.env.NEXT_PUBLIC_API_KEY) return process.env.NEXT_PUBLIC_API_KEY
    try { return await getAccessToken() } catch { return null }
  }

  async function handleSend() {
    if (!input.trim() || !selectedId) return
    setSending(true)
    setError(null)
    const content = input.trim()
    setInput('')
    setAxlTargetAgentId(null)
    setMentionOpen(false)

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
    <>
    {mentionOpen && selectedId && mentionableAgents.length > 0 && (
      <div
        className="pointer-events-auto absolute bottom-[76px] left-1/2 z-20 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-white/10 bg-background/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
      >
        {mentionableAgents.map((agent, idx) => (
          <button
            key={agent.agentId}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); insertMention(agent.agentId) }}
            className={cn(
              'flex w-full items-center gap-3 border-b border-white/10 px-3 py-2 text-left text-sm text-slate-200 last:border-b-0',
              idx === mentionIndex ? 'bg-amber-400/10' : 'hover:bg-white/[0.04]',
            )}
          >
            <span className="text-primary">@</span>
            <span className="min-w-0 flex-1 truncate capitalize">{agent.role.replace(/-/g, ' ')}</span>
            <span className="font-mono text-xs text-muted-foreground">{agent.agentId.slice(0, 8)}</span>
          </button>
        ))}
      </div>
    )}
    <div
      className="pointer-events-auto absolute bottom-5 left-1/2 z-10 flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-center gap-2 rounded-lg border border-white/10 bg-background/90 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl"
    >
      <Badge variant="outline" className="hidden max-w-40 truncate sm:inline-flex">
        {selected ? shortRole : 'Select agent'}
      </Badge>

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
        placeholder={selected ? `Message ${shortRole}...` : 'Click an agent to select'}
        disabled={!selectedId}
        className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-amber-400/40 focus:ring-2 focus:ring-amber-400/20 disabled:cursor-not-allowed disabled:opacity-60"
      />

      <Button
        onClick={() => void handleSend()}
        disabled={!selectedId || !input.trim() || sending}
        size="icon"
        variant={selectedId && input.trim() ? 'default' : 'outline'}
        title="Send message"
      >
        {sending ? <span className="text-sm">...</span> : <Send />}
      </Button>
    </div>
    {error && (
      <div className="pointer-events-auto absolute bottom-[76px] left-1/2 z-10 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-md border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-200 shadow-lg shadow-black/30 backdrop-blur-xl">
        {error}
      </div>
    )}
    </>
  )
}
