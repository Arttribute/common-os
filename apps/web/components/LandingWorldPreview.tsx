'use client'

import { Suspense, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Badge } from '@/components/ui/badge'
import { HUD } from '@/components/hud/HUD'
import { startMockSimulation } from '@/lib/mockSimulation'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'

const PhaserGame = dynamic(() => import('@/components/PhaserGame'), { ssr: false })

export function LandingWorldPreview() {
  const initialized = useWorldStore((state) => state.initialized)
  const clearAgents = useAgentStore((state) => state.clearAgents)
  const setZoom = useWorldStore((state) => state.setZoom)

  useEffect(() => {
    clearAgents()
    setZoom(0.62)
    const stop = startMockSimulation()

    return () => {
      stop()
      clearAgents()
      setZoom(1)
    }
  }, [clearAgents, setZoom])

  return (
    <div className="window-breathe overflow-hidden rounded-lg border border-white/10 bg-[#080c14] shadow-2xl shadow-black/50">
      <div className="flex h-10 items-center gap-3 border-b border-white/10 bg-gradient-to-b from-[#141e30] to-[#0e1525] px-4">
        <div className="flex gap-1.5">
          <span className="size-3 rounded-full bg-red-500" />
          <span className="size-3 rounded-full bg-amber-500" />
          <span className="size-3 rounded-full bg-emerald-500" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-300">World UI preview</span>
        </div>
        <Badge variant="success">Demo</Badge>
      </div>

      <div className="relative h-[460px] overflow-hidden bg-[#060b14]">
        {initialized && <PhaserGame />}
        <Suspense fallback={null}>
          <HUD />
        </Suspense>

        {!initialized && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Initializing world...
          </div>
        )}
      </div>
    </div>
  )
}
