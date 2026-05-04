'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FleetPanel } from './FleetPanel'
import { Inspector } from './Inspector'
import { CommandBar } from './CommandBar'
import { WorldCustomizer } from './WorldCustomizer'
import { AgentDetailModal } from './AgentDetailModal'
import { useSocketStore } from '@/store/socketStore'

export function HUD() {
  const socketStatus = useSocketStore((s) => s.status)
  const router = useRouter()

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        fontFamily: 'monospace',
      }}
    >
      {/* Top-left: logo + connection status + back button */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'auto',
        }}
      >
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 5,
            color: '#64748b',
            fontSize: 10,
            fontFamily: 'monospace',
            padding: '3px 8px',
            cursor: 'pointer',
            letterSpacing: 0.3,
            lineHeight: 1,
          }}
        >
          ← fleets
        </button>
        <Link href="/" style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: -0.5, textDecoration: 'none' }}>
          common<span style={{ color: '#f59e0b' }}>os</span>
        </Link>
        <ConnectionDot status={socketStatus} />
      </div>

      {/* Controls hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          right: 16,
          fontSize: 10,
          color: '#475569',
          fontFamily: 'monospace',
          lineHeight: 1.8,
          textAlign: 'right',
          pointerEvents: 'none',
        }}
      >
        <div>arrows / WASD — pan</div>
        <div>scroll — zoom</div>
        <div>click agent — select</div>
      </div>

      {/* Right: fleet panel + inspector */}
      <FleetPanel />
      <Inspector />

      {/* Bottom-left: world customizer */}
      <WorldCustomizer />

      {/* Bottom: command bar */}
      <CommandBar />

      {/* Agent detail modal — rendered outside the canvas layer */}
      <AgentDetailModal />
    </div>
  )
}

function ConnectionDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connected:    '#10b981',
    connecting:   '#f59e0b',
    disconnected: '#4b5563',
    error:        '#ef4444',
  }
  const labels: Record<string, string> = {
    connected: 'live', connecting: 'connecting', disconnected: 'demo', error: 'error',
  }
  const color = colors[status] ?? '#4b5563'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{labels[status] ?? status}</span>
    </div>
  )
}
