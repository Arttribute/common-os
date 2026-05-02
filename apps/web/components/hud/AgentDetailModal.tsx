'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAgentStore } from '@/store/agentStore'
import type { AgentCommonsIdentity } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'
import { useAuthStore } from '@/store/authStore'
import { usePrivy } from '@privy-io/react-auth'
import { useSearchParams } from 'next/navigation'

// ─── Types ─────────────────────────────────────────────────────────────────

interface SessionEntry {
  kind: 'task' | 'message'
  id: string
  createdAt: string
  // task fields
  description?: string
  status?: string
  output?: string | null
  error?: string | null
  assignedBy?: string
  startedAt?: string | null
  completedAt?: string | null
  // message fields
  content?: string
  response?: string | null
  respondedAt?: string | null
}

interface AgentSession {
  _id: string
  title: string
  isDefault: boolean
  messageCount: number
  lastMessageAt: string | null
  createdAt: string
  agcSessionId: string | null
}

interface FsNode {
  name: string
  isDir: boolean
  children: FsNode[]
  depth: number
}

// ─── Filesystem snapshot parser ────────────────────────────────────────────

function parseSnapshot(snapshot: string): FsNode[] {
  const lines = snapshot.split('\n').filter(Boolean)
  const root: FsNode[] = []
  const stack: Array<{ node: FsNode; indent: number }> = []

  for (let i = 1; i < lines.length; i++) {  // skip first line (root dir)
    const line = lines[i]
    const indent = line.length - line.trimStart().length
    const name = line.trim().replace('... (truncated)', '…')
    if (!name) continue

    const isDir = name.endsWith('/')
    const node: FsNode = { name: isDir ? name.slice(0, -1) : name, isDir, children: [], depth: indent }

    // Pop stack until we find the correct parent
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    if (stack.length === 0) {
      root.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ node, indent })
  }

  return root
}

// ─── File icon ─────────────────────────────────────────────────────────────

function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return '📁'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    py: '🐍', ts: '📘', tsx: '📘', js: '📒', jsx: '📒',
    json: '⚙️', yaml: 'yml'.includes(ext) ? '⚙️' : '⚙️', yml: '⚙️',
    md: '📝', txt: '📄', sh: '⚡', env: '🔒',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', svg: '🖼️', gif: '🖼️',
    html: '🌐', css: '🎨', sql: '🗄️', csv: '📊',
    lock: '🔒', toml: '⚙️', rs: '🦀', go: '🐹',
  }
  return map[ext] ?? '📄'
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)  return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    completed: '#10b981', failed: '#ef4444', running: '#f59e0b',
    queued: '#6366f1', cancelled: '#4b5563',
    pending: '#6366f1', processing: '#f59e0b', responded: '#10b981',
  }
  return map[status] ?? '#64748b'
}

function shortId(value: string | null | undefined, head = 10, tail = 4): string {
  if (!value) return 'missing'
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function errorText(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error
  }
  return fallback
}

function isWalletAddress(value: string | null | undefined): boolean {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value))
}

// ─── Sessions view ──────────────────────────────────────────────────────────

function SessionsView({
  sessions,
  allMessages,
  loading,
  activeSessionId,
  sessionMessages,
  messagesLoading,
  error,
  onSelectSession,
  onBack,
  onNewSession,
  creating,
}: {
  sessions: AgentSession[]
  allMessages: SessionEntry[]
  loading: boolean
  activeSessionId: string | null
  sessionMessages: SessionEntry[]
  messagesLoading: boolean
  error: string | null
  onSelectSession: (id: string) => void
  onBack: () => void
  onNewSession: () => void
  creating: boolean
}) {
  if (activeSessionId) {
    // Show messages within the selected session
    const session = sessions.find(s => s._id === activeSessionId)
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Back button + session title */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          flexShrink: 0,
        }}>
          <button onClick={onBack} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#475569', fontSize: 10, fontFamily: 'monospace', padding: '2px 6px',
          }}>← back</button>
          <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', flex: 1 }}>
            {session?.title ?? 'Session'}
          </span>
          {session?.agcSessionId && (
            <span style={{ fontSize: 7, color: '#1e3a5f', fontFamily: 'monospace' }} title={session.agcSessionId}>
              agc {shortId(session.agcSessionId, 12, 6)}
            </span>
          )}
          {session && !session.agcSessionId && (
            <span style={{ fontSize: 7, color: '#ef4444', fontFamily: 'monospace' }}>
              missing agc session
            </span>
          )}
        </div>
        {error && (
          <div style={{
            margin: '8px 16px 0',
            padding: '7px 9px',
            border: '1px solid rgba(239,68,68,0.25)',
            background: 'rgba(239,68,68,0.08)',
            borderRadius: 4,
            color: '#fca5a5',
            fontSize: 9,
            fontFamily: 'monospace',
            lineHeight: 1.5,
            flexShrink: 0,
          }}>
            {error}
          </div>
        )}
        {messagesLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace' }}>loading…</div>
          </div>
        ) : sessionMessages.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace' }}>no messages yet</div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sessionMessages.map(entry => <SessionCard key={entry.id} entry={entry} />)}
          </div>
        )}
      </div>

    )
  }

  // Show sessions list
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace' }}>loading sessions…</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, color: '#334155', fontFamily: 'monospace' }}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={onNewSession}
          disabled={creating}
          style={{
            background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: 4, color: '#93c5fd', cursor: 'pointer',
            fontSize: 9, fontFamily: 'monospace', padding: '3px 10px',
            opacity: creating ? 0.5 : 1,
          }}
        >
          {creating ? '…' : '+ new session'}
        </button>
      </div>

      {sessions.length === 0 && allMessages.length > 0 ? (
        // No sessions yet but messages exist — show flat list
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {allMessages.map(entry => <SessionCard key={entry.id} entry={entry} />)}
        </div>
      ) : sessions.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ fontSize: 20 }}>📭</div>
          <div style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace' }}>no messages yet</div>
          <div style={{ fontSize: 9, color: '#1e3a5f', fontFamily: 'monospace' }}>send a message to start chatting</div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {sessions.map(sess => (
            <SessionRow key={sess._id} session={sess} onClick={() => onSelectSession(sess._id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionRow({ session, onClick }: { session: AgentSession; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 16px',
        cursor: 'pointer',
        background: hovered ? 'rgba(59,130,246,0.06)' : 'transparent',
        borderLeft: session.isDefault ? '2px solid #3b82f6' : '2px solid transparent',
        display: 'flex', flexDirection: 'column', gap: 3,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: session.isDefault ? '#93c5fd' : '#94a3b8', fontFamily: 'monospace', flex: 1 }}>
          {session.title}
        </span>
        {session.isDefault && (
          <span style={{ fontSize: 7, color: '#3b82f6', fontFamily: 'monospace', background: 'rgba(59,130,246,0.1)', padding: '1px 5px', borderRadius: 3 }}>
            active
          </span>
        )}
        <span style={{ fontSize: 8, color: '#1e3a5f', fontFamily: 'monospace' }}>
          {relativeTime(session.lastMessageAt ?? session.createdAt)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace' }}>
          {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
        </span>
        {session.agcSessionId && (
          <span style={{ fontSize: 7, color: '#1e293b', fontFamily: 'monospace' }} title={session.agcSessionId}>
            agc {shortId(session.agcSessionId, 10, 4)}
          </span>
        )}
        {!session.agcSessionId && (
          <span style={{ fontSize: 7, color: '#ef4444', fontFamily: 'monospace' }}>
            missing agc id
          </span>
        )}
      </div>
    </div>
  )
}

function SessionCard({ entry }: { entry: SessionEntry }) {
  const [expanded, setExpanded] = useState(false)

  if (entry.kind === 'message') {
    return (
      <div style={{ borderLeft: '2px solid #1e3a5f', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Human message */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 9, color: '#3b82f6', fontFamily: 'monospace', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>YOU</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'monospace', lineHeight: 1.6, wordBreak: 'break-word' }}>
              {entry.content}
            </div>
            <div style={{ fontSize: 8, color: '#1e3a5f', fontFamily: 'monospace', marginTop: 2 }}>
              {relativeTime(entry.createdAt)}
            </div>
          </div>
        </div>

        {/* Agent response */}
        {entry.response ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 9, color: '#10b981', fontFamily: 'monospace', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>AGT</span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 10,
                  color: '#94a3b8',
                  fontFamily: 'monospace',
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                  maxHeight: expanded ? 'none' : 80,
                  overflow: expanded ? 'visible' : 'hidden',
                }}
              >
                {entry.response}
              </div>
              {entry.response.length > 200 && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 8, color: '#3b82f6', fontFamily: 'monospace',
                    padding: '2px 0', marginTop: 2,
                  }}
                >
                  {expanded ? '▲ collapse' : '▼ expand'}
                </button>
              )}
              <div style={{ fontSize: 8, color: '#1e3a5f', fontFamily: 'monospace', marginTop: 2 }}>
                {relativeTime(entry.respondedAt)}
              </div>
            </div>
          </div>
        ) : entry.status === 'processing' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 28 }}>
            <span style={{ fontSize: 9, color: '#f59e0b', fontFamily: 'monospace' }}>processing…</span>
          </div>
        ) : null}
      </div>
    )
  }

  // Task entry
  const color = statusColor(entry.status ?? 'queued')
  return (
    <div style={{ borderLeft: `2px solid ${color}44`, paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#f59e0b', fontWeight: 700 }}>TASK</span>
        <span
          style={{
            fontSize: 8, fontFamily: 'monospace', color,
            background: `${color}18`, border: `1px solid ${color}44`,
            padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.5,
          }}
        >
          {entry.status}
        </span>
        <span style={{ fontSize: 8, color: '#1e3a5f', fontFamily: 'monospace', marginLeft: 'auto' }}>
          {relativeTime(entry.createdAt)}
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'monospace', lineHeight: 1.5, wordBreak: 'break-word' }}>
        {entry.description}
      </div>
      {(entry.output || entry.error) && (
        <div style={{ marginTop: 2 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 8, color: '#475569', fontFamily: 'monospace', padding: 0,
            }}
          >
            {expanded ? '▲ hide output' : '▼ show output'}
          </button>
          {expanded && (
            <div style={{
              marginTop: 4,
              fontSize: 9,
              color: entry.error ? '#ef4444' : '#64748b',
              fontFamily: 'monospace',
              background: 'rgba(0,0,0,0.3)',
              padding: '6px 8px',
              borderRadius: 4,
              lineHeight: 1.6,
              wordBreak: 'break-word',
              maxHeight: 160,
              overflowY: 'auto',
            }}>
              {entry.error ?? entry.output}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Computer / filesystem view ─────────────────────────────────────────────

interface ComputerViewProps {
  agentRole: string
  pod?: { provider: string; region: string; namespaceId?: string | null }
  snapshot: string | null
  loading: boolean
  error: string | null
}

function ComputerView({ agentRole, pod, snapshot, loading, error }: ComputerViewProps) {
  const [path, setPath] = useState<string[]>([])
  const [history, setHistory] = useState<string[][]>([[]])
  const [histIdx, setHistIdx] = useState(0)

  const tree = snapshot ? parseSnapshot(snapshot) : null

  // Navigate to a child directory
  function navigateTo(newPath: string[]) {
    const trimmed = history.slice(0, histIdx + 1)
    setHistory([...trimmed, newPath])
    setHistIdx(trimmed.length)
    setPath(newPath)
  }

  function navBack() {
    if (histIdx === 0) return
    const prev = history[histIdx - 1]
    setHistIdx(histIdx - 1)
    setPath(prev)
  }

  function navUp() {
    if (path.length === 0) return
    navigateTo(path.slice(0, -1))
  }

  // Resolve current directory nodes
  function currentNodes(): FsNode[] {
    if (!tree) return []
    let nodes = tree
    for (const segment of path) {
      const dir = nodes.find((n) => n.isDir && n.name === segment)
      if (!dir) return []
      nodes = dir.children
    }
    return nodes
  }

  const nodes = currentNodes()
  const sortedNodes = [
    ...nodes.filter((n) => n.isDir).sort((a, b) => a.name.localeCompare(b.name)),
    ...nodes.filter((n) => !n.isDir).sort((a, b) => a.name.localeCompare(b.name)),
  ]

  const pathStr = path.length === 0 ? '/' : '/' + path.join('/')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#080c14' }}>
      {/* Window chrome — retro toolbar */}
      <div style={{
        background: 'linear-gradient(180deg, #1a2540 0%, #111827 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}>
        {/* Back / Up buttons */}
        <NavButton disabled={histIdx === 0} onClick={navBack} title="Back">◀</NavButton>
        <NavButton disabled={path.length === 0} onClick={navUp} title="Up">▲</NavButton>

        {/* Address bar */}
        <div style={{
          flex: 1,
          background: '#0a0e1a',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 3,
          padding: '3px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 9,
          fontFamily: 'monospace',
          color: '#64748b',
          overflow: 'hidden',
        }}>
          <span style={{ color: '#334155', flexShrink: 0 }}>📂</span>
          <span style={{ color: '#475569', flexShrink: 0 }}>workspace</span>
          {path.map((seg, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <span style={{ color: '#1e293b' }}> › </span>
              <span
                style={{ color: i === path.length - 1 ? '#94a3b8' : '#475569', cursor: 'pointer' }}
                onClick={() => navigateTo(path.slice(0, i + 1))}
              >
                {seg}
              </span>
            </span>
          ))}
        </div>

        <span style={{ fontSize: 8, color: '#1e293b', fontFamily: 'monospace' }}>{pathStr}</span>
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left sidebar — "drives" */}
        <div style={{
          width: 120,
          background: '#0a0e18',
          borderRight: '1px solid rgba(255,255,255,0.04)',
          padding: '8px 0',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}>
          <div style={{ padding: '4px 10px 8px', fontSize: 7, color: '#1e293b', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
            Devices
          </div>
          <SidebarItem
            icon="💾"
            label="workspace"
            active={true}
            onClick={() => navigateTo([])}
          />
          <div style={{ marginTop: 12, padding: '4px 10px 6px', fontSize: 7, color: '#1e293b', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
            Pod Info
          </div>
          {pod && (
            <>
              <div style={{ padding: '3px 10px', fontSize: 8, color: '#334155', fontFamily: 'monospace', lineHeight: 1.8 }}>
                <div>☁️ {pod.provider}</div>
                <div>📍 {pod.region}</div>
                {pod.namespaceId && (
                  <div style={{ color: '#1e293b', fontSize: 7, wordBreak: 'break-all', marginTop: 2 }}>
                    {pod.namespaceId.slice(0, 16)}…
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* File area */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace' }}>loading workspace…</div>
            </div>
          ) : !snapshot ? (
            <NoSnapshot agentRole={agentRole} pod={pod} error={error} />
          ) : sortedNodes.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 16 }}>📂</div>
              <div style={{ fontSize: 9, color: '#334155', fontFamily: 'monospace' }}>empty folder</div>
            </div>
          ) : (
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: 8,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 2,
              alignContent: 'flex-start',
            }}>
              {sortedNodes.map((node) => (
                <FileItem
                  key={node.name}
                  node={node}
                  onOpen={() => {
                    if (node.isDir) navigateTo([...path, node.name])
                  }}
                />
              ))}
            </div>
          )}

          {/* Status bar */}
          <div style={{
            height: 22,
            borderTop: '1px solid rgba(255,255,255,0.04)',
            background: '#0a0e18',
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            gap: 16,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 8, color: '#1e3a5f', fontFamily: 'monospace' }}>
              {sortedNodes.filter((n) => n.isDir).length} folder(s)
            </span>
            <span style={{ fontSize: 8, color: '#1e3a5f', fontFamily: 'monospace' }}>
              {sortedNodes.filter((n) => !n.isDir).length} file(s)
            </span>
            {snapshot && (
              <span style={{ fontSize: 8, color: '#0f172a', fontFamily: 'monospace', marginLeft: 'auto' }}>
                workspace snapshot
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NavButton({ children, disabled, onClick, title }: {
  children: React.ReactNode
  disabled: boolean
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: disabled ? 'transparent' : 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 3,
        color: disabled ? '#1e293b' : '#475569',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 9,
        fontFamily: 'monospace',
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

function SidebarItem({ icon, label, active, onClick }: {
  icon: string; label: string; active: boolean; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        cursor: 'pointer',
        background: active ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
        borderLeft: active ? '2px solid #3b82f6' : '2px solid transparent',
      }}
    >
      <span style={{ fontSize: 11 }}>{icon}</span>
      <span style={{ fontSize: 9, color: active ? '#93c5fd' : '#475569', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  )
}

function FileItem({ node, onOpen }: { node: FsNode; onOpen: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 88,
        padding: '8px 4px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        borderRadius: 4,
        cursor: node.isDir ? 'pointer' : 'default',
        background: hovered ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
        border: hovered ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid transparent',
        transition: 'background 0.1s, border 0.1s',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>{fileIcon(node.name, node.isDir)}</span>
      <span style={{
        fontSize: 8,
        color: node.isDir ? '#e8b44a' : '#8ab4d4',
        fontFamily: 'monospace',
        textAlign: 'center',
        lineHeight: 1.3,
        wordBreak: 'break-all',
        maxWidth: 80,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxHeight: 28,
      }}>
        {node.name}
      </span>
    </div>
  )
}

function NoSnapshot({ agentRole, pod, error }: {
  agentRole: string
  pod?: { provider: string; region: string; namespaceId?: string | null }
  error?: string | null
}) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      padding: 24,
    }}>
      <div style={{ fontSize: 32 }}>🖥️</div>
      <div style={{ fontSize: 11, color: '#334155', fontFamily: 'monospace', textAlign: 'center', lineHeight: 1.8 }}>
        {agentRole} pod is online<br />
        <span style={{ fontSize: 9, color: '#1e3a5f' }}>
          Workspace snapshot will appear once the agent processes its first task.
        </span>
      </div>
      {error && (
        <div style={{
          maxWidth: 320,
          padding: '7px 9px',
          border: '1px solid rgba(239,68,68,0.25)',
          background: 'rgba(239,68,68,0.08)',
          borderRadius: 4,
          color: '#fca5a5',
          fontSize: 9,
          fontFamily: 'monospace',
          lineHeight: 1.5,
          textAlign: 'center',
        }}>
          {error}
        </div>
      )}
      {pod && (
        <div style={{
          marginTop: 8,
          padding: '8px 14px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          alignItems: 'center',
        }}>
          <div style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace' }}>☁️ {pod.provider} · 📍 {pod.region}</div>
          {pod.namespaceId && (
            <div style={{ fontSize: 7, color: '#1e293b', fontFamily: 'monospace' }}>{pod.namespaceId}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main modal ─────────────────────────────────────────────────────────────

export function AgentDetailModal() {
  const isOpen       = useAgentStore((s) => s.detailModalOpen)
  const closeModal   = useAgentStore((s) => s.closeDetailModal)
  const selectedId   = useAgentStore((s) => s.selectedAgentId)
  const agents       = useAgentStore((s) => s.agents)
  const storeFleetId = useWorldStore((s) => s.fleetId)
  const storedApiKey = useAuthStore((s) => s.apiKey)
  const searchParams = useSearchParams()
  const { getAccessToken, authenticated } = usePrivy()

  const [tab, setTab] = useState<'sessions' | 'computer'>('sessions')
  const [sessions, setSessions]   = useState<AgentSession[]>([])
  const [snapshot, setSnapshot]   = useState<string | null>(null)
  const [sessLoading, setSessLoading] = useState(false)
  const [snapLoading, setSnapLoading] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionMessages, setSessionMessages] = useState<SessionEntry[]>([])
  const [msgsLoading, setMsgsLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [allMessages, setAllMessages] = useState<SessionEntry[]>([])
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const agent = selectedId ? agents[selectedId] : null
  const setActiveSession = useAgentStore((s) => s.setActiveSession)
  const urlFleet = searchParams.get('fleet')
  const fleetId = urlFleet ?? storeFleetId
  const apiUrl = process.env.NEXT_PUBLIC_API_URL

  const isLive = Boolean(apiUrl && fleetId && (storedApiKey ?? process.env.NEXT_PUBLIC_API_KEY ?? authenticated))

  async function resolveToken(): Promise<string | null> {
    if (storedApiKey) return storedApiKey
    if (process.env.NEXT_PUBLIC_API_KEY) return process.env.NEXT_PUBLIC_API_KEY
    try { return await getAccessToken() } catch { return null }
  }

  const fetchSessions = useCallback(async () => {
    if (!isLive || !selectedId || !fleetId) return
    setSessLoading(true)
    setSessionError(null)
    try {
      const token = await resolveToken()
      const [sessRes, msgsRes] = await Promise.all([
        fetch(`${apiUrl}/fleets/${fleetId}/agents/${selectedId}/sessions`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiUrl}/fleets/${fleetId}/agents/${selectedId}/human-messages`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      if (sessRes.ok) {
        setSessions(await sessRes.json() as AgentSession[])
      } else {
        const data = await sessRes.json().catch(() => null)
        setSessionError(errorText(data, `could not load sessions (${sessRes.status})`))
      }
      if (msgsRes.ok) {
        const raw = await msgsRes.json() as Array<Record<string, unknown>>
        setAllMessages(raw.map(m => ({
          ...m,
          id: (m._id ?? m.id) as string,
          kind: 'message' as const,
        }) as SessionEntry))
      }
    } catch {
      setSessionError('could not connect to sessions API')
    }
    finally { setSessLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, selectedId, fleetId])

  const fetchSessionMessages = useCallback(async (sessionId: string) => {
    if (!isLive || !selectedId || !fleetId) return
    setMsgsLoading(true)
    setSessionError(null)
    try {
      const token = await resolveToken()
      const res = await fetch(`${apiUrl}/fleets/${fleetId}/agents/${selectedId}/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json() as { messages?: Array<Record<string, unknown>> }
        setSessionMessages((data.messages ?? []).map(m => ({
          ...m,
          id: (m._id ?? m.id) as string,
          kind: (m.kind ?? 'message') as SessionEntry['kind'],
        }) as SessionEntry))
      } else {
        const data = await res.json().catch(() => null)
        setSessionError(errorText(data, `could not load session messages (${res.status})`))
      }
    } catch {
      setSessionError('could not connect to session messages API')
    }
    finally { setMsgsLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, selectedId, fleetId])

  const createSession = useCallback(async () => {
    if (!isLive || !selectedId || !fleetId) return
    setCreating(true)
    setSessionError(null)
    try {
      const token = await resolveToken()
      const res = await fetch(`${apiUrl}/fleets/${fleetId}/agents/${selectedId}/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setSessionError(errorText(data, `could not create Agent Commons session (${res.status})`))
        return
      }
      const created = await res.json() as { _id?: string; agcSessionId?: string | null }
      const newSessionId = created.agcSessionId ?? created._id ?? null
      if (newSessionId) {
        setActiveSessionId(newSessionId)
        setActiveSession(selectedId, newSessionId)
        void fetchSessionMessages(newSessionId)
      }
      await fetchSessions()
    } catch {
      setSessionError('could not connect to create an Agent Commons session')
    }
    finally { setCreating(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, selectedId, fleetId, fetchSessions, fetchSessionMessages, setActiveSession])

  const fetchWorkspace = useCallback(async () => {
    if (!isLive || !selectedId || !fleetId) return
    setSnapLoading(true)
    setWorkspaceError(null)
    try {
      const token = await resolveToken()
      const res = await fetch(`${apiUrl}/fleets/${fleetId}/agents/${selectedId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json() as { workspace?: { snapshot?: string } | null }
        setSnapshot(data.workspace?.snapshot ?? null)
      } else {
        const data = await res.json().catch(() => null)
        setWorkspaceError(errorText(data, `could not load workspace snapshot (${res.status})`))
      }
    } catch {
      setWorkspaceError('could not connect to workspace API')
    }
    finally { setSnapLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, selectedId, fleetId])

  useEffect(() => {
    if (!isOpen || !selectedId) return
    setSessions([])
    setAllMessages([])
    setSessionError(null)
    setWorkspaceError(null)
    setSnapshot(null)
    setTab('sessions')
    setActiveSessionId(null)
    setSessionMessages([])
    void fetchSessions()
  }, [isOpen, selectedId, fetchSessions])

  // Auto-refresh sessions list or session messages every 5 s while the sessions tab is active
  useEffect(() => {
    if (!isOpen || tab !== 'sessions') return
    if (activeSessionId) {
      const id = setInterval(() => { void fetchSessionMessages(activeSessionId) }, 5_000)
      return () => clearInterval(id)
    }
    const id = setInterval(() => { void fetchSessions() }, 5_000)
    return () => clearInterval(id)
  }, [isOpen, tab, activeSessionId, fetchSessions, fetchSessionMessages])

  useEffect(() => {
    if (isOpen && tab === 'computer') void fetchWorkspace()
  }, [isOpen, tab, fetchWorkspace])

  // Auto-refresh workspace every 10 s while the computer tab is active
  useEffect(() => {
    if (!isOpen || tab !== 'computer') return
    const id = setInterval(() => { void fetchWorkspace() }, 10_000)
    return () => clearInterval(id)
  }, [isOpen, tab, fetchWorkspace])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, closeModal])

  if (!isOpen || !agent) return null

  const shortRole = agent.role.replace(/-/g, ' ')
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
    >
      <div
        style={{
          width: 780,
          height: 560,
          background: '#080c14',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
          animation: 'modalIn 0.15s ease-out',
        }}
      >
        {/* Title bar */}
        <div style={{
          background: 'linear-gradient(180deg, #141e30 0%, #0e1525 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '0 14px',
          height: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}>
          {/* macOS-style traffic lights */}
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <TrafficLight color="#ef4444" onClick={closeModal} />
            <TrafficLight color="#f59e0b" />
            <TrafficLight color="#22c55e" />
          </div>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', textTransform: 'capitalize' }}>
              {shortRole}
            </span>
            {agent.permissionTier === 'manager' && (
              <span style={{ fontSize: 7, color: '#f59e0b', fontFamily: 'monospace', background: 'rgba(245,158,11,0.1)', padding: '1px 5px', borderRadius: 3, border: '1px solid rgba(245,158,11,0.3)' }}>
                MGR
              </span>
            )}
            <StatusPill status={agent.status} />
          </div>

          {/* Pod info in title bar */}
          {agent.pod && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 8, color: '#1e3a5f', fontFamily: 'monospace' }}>
                {agent.pod.provider} · {agent.pod.region}
              </span>
            </div>
          )}

          <span style={{ fontSize: 10, color: '#1e293b', fontFamily: 'monospace', marginLeft: 4 }} title={agent.agentId}>
            cos {shortId(agent.agentId, 12, 4)}
          </span>
        </div>

        <AgentIdentityStrip
          commonOsAgentId={agent.agentId}
          commons={agent.commons}
        />

        {/* Tab bar */}
        <div style={{
          background: '#0a0e1a',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex',
          padding: '0 14px',
          gap: 0,
          flexShrink: 0,
        }}>
          <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>
            💬 Sessions
          </TabButton>
          <TabButton active={tab === 'computer'} onClick={() => setTab('computer')}>
            🖥️ Computer
          </TabButton>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {tab === 'sessions' ? (
            <SessionsView
              sessions={sessions}
              allMessages={allMessages}
              loading={sessLoading}
              activeSessionId={activeSessionId}
              sessionMessages={sessionMessages}
              messagesLoading={msgsLoading}
              error={sessionError}
              onSelectSession={(id) => {
                setActiveSessionId(id)
                if (selectedId) setActiveSession(selectedId, id)
                void fetchSessionMessages(id)
              }}
              onBack={() => { setActiveSessionId(null); setSessionMessages([]) }}
              onNewSession={() => void createSession()}
              creating={creating}
            />
          ) : (
            <ComputerView
              agentRole={shortRole}
              pod={agent.pod}
              snapshot={snapshot}
              loading={snapLoading}
              error={workspaceError}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  )
}

function AgentIdentityStrip({
  commonOsAgentId,
  commons,
}: {
  commonOsAgentId: string
  commons?: AgentCommonsIdentity
}) {
  const runtimeId = commons?.agentId ?? commons?.walletAddress ?? null
  const validWallet = isWalletAddress(runtimeId)

  return (
    <div style={{
      background: '#080d18',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      padding: '6px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      <IdentityField label="commonos" value={commonOsAgentId} />
      <IdentityField
        label="agent commons"
        value={runtimeId}
        color={validWallet ? '#86efac' : '#fca5a5'}
        badge={validWallet ? 'wallet' : 'not resolved'}
      />
      {commons?.registryAgentId && (
        <IdentityField label="registry" value={commons.registryAgentId} />
      )}
    </div>
  )
}

function IdentityField({
  label,
  value,
  color = '#64748b',
  badge,
}: {
  label: string
  value: string | null | undefined
  color?: string
  badge?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 7, color: '#1e3a5f', fontFamily: 'monospace', textTransform: 'uppercase', flexShrink: 0 }}>
        {label}
      </span>
      <span
        title={value ?? 'missing'}
        style={{
          fontSize: 8,
          color,
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: label === 'agent commons' ? 210 : 150,
        }}
      >
        {shortId(value, label === 'agent commons' ? 14 : 10, 6)}
      </span>
      {badge && (
        <span style={{
          fontSize: 7,
          color,
          fontFamily: 'monospace',
          border: `1px solid ${color}33`,
          background: `${color}10`,
          borderRadius: 3,
          padding: '1px 4px',
          flexShrink: 0,
        }}>
          {badge}
        </span>
      )}
    </div>
  )
}

function TrafficLight({ color, onClick }: { color: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 11,
        height: 11,
        borderRadius: '50%',
        background: color,
        opacity: 0.7,
        cursor: onClick ? 'pointer' : 'default',
        flexShrink: 0,
      }}
    />
  )
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    working: '#f59e0b', idle: '#10b981', online: '#10b981',
    error: '#ef4444', offline: '#4b5563', provisioning: '#6366f1',
  }
  const color = colors[status] ?? '#4b5563'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      background: `${color}18`,
      border: `1px solid ${color}44`,
      borderRadius: 3,
      padding: '1px 6px',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: `0 0 4px ${color}` }} />
      <span style={{ fontSize: 8, color, fontFamily: 'monospace' }}>{status}</span>
    </div>
  )
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
        color: active ? '#93c5fd' : '#334155',
        cursor: 'pointer',
        fontSize: 10,
        fontFamily: 'monospace',
        padding: '8px 14px',
        transition: 'color 0.15s',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      {children}
    </button>
  )
}
