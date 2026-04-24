'use client'
import { FleetPanel } from './FleetPanel'
import { Inspector } from './Inspector'
import { CommandBar } from './CommandBar'
import { useSocketStore } from '@/store/socketStore'

export function HUD() {
  const socketStatus = useSocketStore((s) => s.status)

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
      {/* Top-left: connection status */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          pointerEvents: 'none',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: -0.5 }}>
          common<span style={{ color: '#f59e0b' }}>os</span>
        </span>
        <ConnectionDot status={socketStatus} />
      </div>

      {/* Controls hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          right: 16,
          fontSize: 8,
          color: '#1e293b',
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

      {/* Bottom: command bar */}
      <CommandBar />
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
      <span style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace' }}>{labels[status] ?? status}</span>
    </div>
  )
}
