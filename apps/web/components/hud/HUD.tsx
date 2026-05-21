'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
    <div className="pointer-events-none absolute inset-0 z-10 font-sans">
      <div className="pointer-events-auto absolute left-4 top-4 flex items-center gap-2 rounded-lg border border-white/10 bg-background/85 px-2 py-2 shadow-xl shadow-black/20 backdrop-blur-xl">
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')} className="h-8 px-2 text-muted-foreground">
          <ArrowLeft />
          Fleets
        </Button>
        <Link href="/" className="px-2 text-sm font-semibold tracking-tight text-foreground">
          Common<span className="text-primary">OS</span>
        </Link>
        <ConnectionDot status={socketStatus} />
      </div>

      <div className="pointer-events-none absolute bottom-16 right-4 rounded-md border border-white/10 bg-background/70 px-3 py-2 text-right text-[11px] leading-5 text-muted-foreground shadow-lg shadow-black/20 backdrop-blur-xl">
        <div>Arrows / WASD to pan</div>
        <div>Scroll to zoom</div>
        <div>Click an agent to select</div>
      </div>

      <FleetPanel />
      <Inspector />
      <WorldCustomizer />
      <CommandBar />
      <AgentDetailModal />
    </div>
  )
}

function ConnectionDot({ status }: { status: string }) {
  const tone: Record<string, string> = {
    connected: 'bg-emerald-400',
    connecting: 'bg-amber-400',
    disconnected: 'bg-slate-500',
    error: 'bg-red-400',
  }
  const labels: Record<string, string> = {
    connected: 'Live',
    connecting: 'Connecting',
    disconnected: 'Demo',
    error: 'Error',
  }

  return (
    <Badge variant="outline" className="gap-2">
      <span className={`size-1.5 rounded-full ${tone[status] ?? 'bg-slate-500'}`} />
      {labels[status] ?? status}
    </Badge>
  )
}
