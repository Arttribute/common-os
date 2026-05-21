'use client'

import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useWorldStore } from '@/store/worldStore'
import { THEMES } from '@/game/systems/worldThemes'
import type { ThemeId, AgentStyle } from '@/game/systems/worldThemes'

const AGENT_STYLES: { id: AgentStyle; label: string; emoji: string }[] = [
  { id: 'person', label: 'Person', emoji: 'P' },
  { id: 'sketch-cube', label: 'Sketch', emoji: 'S' },
  { id: 'robot', label: 'Robot', emoji: 'R' },
  { id: 'blob', label: 'Blob', emoji: 'B' },
  { id: 'minimal', label: 'Minimal', emoji: 'M' },
]

const THEME_ORDER: ThemeId[] = ['office', 'hackerspace', 'gym', 'industrial']

export function WorldCustomizer() {
  const [open, setOpen] = useState(false)
  const theme = useWorldStore((s) => s.theme)
  const agentStyle = useWorldStore((s) => s.agentStyle)
  const setTheme = useWorldStore((s) => s.setTheme)
  const setAgentStyle = useWorldStore((s) => s.setAgentStyle)

  return (
    <div className="pointer-events-auto absolute bottom-16 left-4 z-10">
      <Button
        variant={open ? 'default' : 'outline'}
        size="sm"
        onClick={() => setOpen((value) => !value)}
        className={open ? '' : 'bg-background/80 backdrop-blur-xl'}
      >
        <Settings2 />
        Customize
      </Button>

      {open && (
        <div className="absolute bottom-11 left-0 w-[260px] rounded-lg border border-white/10 bg-background/92 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <SectionTitle>World Theme</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {THEME_ORDER.map((id) => {
              const currentTheme = THEMES[id]
              const active = theme === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  className={cn(
                    'rounded-md border p-3 text-left transition-colors',
                    active
                      ? 'border-amber-400/45 bg-amber-400/10'
                      : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
                  )}
                >
                  <ThemeSwatch themeId={id} />
                  <div className={cn('mt-2 text-sm font-medium', active ? 'text-amber-200' : 'text-slate-300')}>
                    {currentTheme.name}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="my-4 h-px bg-white/10" />

          <SectionTitle>Agent Style</SectionTitle>
          <div className="grid grid-cols-5 gap-2">
            {AGENT_STYLES.map((style) => {
              const active = agentStyle === style.id
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setAgentStyle(style.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md border px-2 py-2 transition-colors',
                    active
                      ? 'border-indigo-300/45 bg-indigo-400/15 text-indigo-100'
                      : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06]',
                  )}
                  title={style.label}
                >
                  <span className="flex size-7 items-center justify-center rounded border border-current/20 font-mono text-xs">
                    {style.emoji}
                  </span>
                  <span className="text-[10px]">{style.label.slice(0, 3)}</span>
                </button>
              )
            })}
          </div>

          <Badge variant="outline" className="mt-4 w-full justify-center text-[11px]">
            Visual changes apply to this world view
          </Badge>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

function ThemeSwatch({ themeId }: { themeId: ThemeId }) {
  const theme = THEMES[themeId]
  const roomVals = Object.values(theme.rooms)
  const swatchColors = [
    theme.floorA,
    roomVals[0]?.fill ?? theme.floorA,
    roomVals[1]?.fill ?? theme.floorB,
    roomVals[2]?.fill ?? theme.floorA,
  ]

  return (
    <div className="flex h-4 gap-1">
      {swatchColors.map((color, index) => (
        <div
          key={index}
          className="h-4 flex-1 rounded-sm border border-white/10"
          style={{ background: `#${color.toString(16).padStart(6, '0')}` }}
        />
      ))}
    </div>
  )
}
