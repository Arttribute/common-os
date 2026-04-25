'use client'
import { useState } from 'react'
import { useWorldStore } from '@/store/worldStore'
import { THEMES } from '@/game/systems/worldThemes'
import type { ThemeId, AgentStyle } from '@/game/systems/worldThemes'

const AGENT_STYLES: { id: AgentStyle; label: string; emoji: string }[] = [
  { id: 'person',      label: 'Person',  emoji: '🧑' },
  { id: 'sketch-cube', label: 'Sketch',  emoji: '🎲' },
  { id: 'robot',       label: 'Robot',   emoji: '🤖' },
  { id: 'blob',        label: 'Blob',    emoji: '👾' },
  { id: 'minimal',     label: 'Minimal', emoji: '⬤'  },
]

const THEME_ORDER: ThemeId[] = ['office', 'hackerspace', 'gym', 'industrial']

export function WorldCustomizer() {
  const [open, setOpen] = useState(false)
  const theme = useWorldStore((s) => s.theme)
  const agentStyle = useWorldStore((s) => s.agentStyle)
  const setTheme = useWorldStore((s) => s.setTheme)
  const setAgentStyle = useWorldStore((s) => s.setAgentStyle)

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 60,
        left: 16,
        pointerEvents: 'auto',
        zIndex: 10,
      }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 10px',
          background: open ? 'rgba(245,158,11,0.15)' : 'rgba(6,11,20,0.8)',
          border: `1px solid ${open ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: 7,
          color: open ? '#f59e0b' : '#475569',
          fontSize: 9,
          fontFamily: 'monospace',
          cursor: 'pointer',
          backdropFilter: 'blur(10px)',
          transition: 'all 0.15s',
          letterSpacing: 0.5,
        }}
      >
        <span style={{ fontSize: 11 }}>⚙</span>
        customize
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 34,
            left: 0,
            width: 220,
            background: 'rgba(6,11,20,0.92)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 10,
            padding: '12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* World theme */}
          <div>
            <div style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
              World Theme
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {THEME_ORDER.map(id => {
                const t = THEMES[id]
                const active = theme === id
                return (
                  <button
                    key={id}
                    onClick={() => setTheme(id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      padding: '8px 6px',
                      background: active ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${active ? 'rgba(245,158,11,0.45)' : 'rgba(255,255,255,0.07)'}`,
                      borderRadius: 7,
                      cursor: 'pointer',
                      transition: 'all 0.12s',
                    }}
                  >
                    <ThemeSwatch themeId={id} />
                    <span style={{ fontSize: 13 }}>{t.emoji}</span>
                    <span style={{ fontSize: 8, color: active ? '#f59e0b' : '#64748b', fontFamily: 'monospace', letterSpacing: 0.5 }}>
                      {t.name}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

          {/* Agent style */}
          <div>
            <div style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
              Agent Style
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {AGENT_STYLES.map(s => {
                const active = agentStyle === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => setAgentStyle(s.id)}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      padding: '8px 4px',
                      background: active ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${active ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.07)'}`,
                      borderRadius: 7,
                      cursor: 'pointer',
                      transition: 'all 0.12s',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{s.emoji}</span>
                    <span style={{ fontSize: 8, color: active ? '#818cf8' : '#475569', fontFamily: 'monospace' }}>
                      {s.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ThemeSwatch({ themeId }: { themeId: ThemeId }) {
  const t = THEMES[themeId]
  const roomVals = Object.values(t.rooms)
  const swatchColors = [
    t.floorA,
    roomVals[0]?.fill ?? t.floorA,
    roomVals[1]?.fill ?? t.floorB,
    roomVals[2]?.fill ?? t.floorA,
  ]
  return (
    <div style={{ display: 'flex', gap: 2, height: 14 }}>
      {swatchColors.map((c, i) => (
        <div
          key={i}
          style={{
            width: 12,
            height: 14,
            borderRadius: 2,
            background: '#' + c.toString(16).padStart(6, '0'),
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        />
      ))}
    </div>
  )
}
