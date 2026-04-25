'use client'
import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { HUD } from '@/components/hud/HUD'
import { useWorldStore } from '@/store/worldStore'
import { useWorldConnection } from '@/hooks/useWorldConnection'

const PhaserGame = dynamic(() => import('@/components/PhaserGame'), { ssr: false })

export default function WorldClient() {
  const initialized = useWorldStore((s) => s.initialized)
  const searchParams = useSearchParams()

  // ?fleet=<fleetId> activates real API; falls back to mock simulation otherwise
  const fleetId = searchParams.get('fleet') ?? undefined
  const { isLive } = useWorldConnection(fleetId)

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#060b14' }}>
      {initialized && <PhaserGame />}

      <HUD />

      {!initialized && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#334155',
            fontSize: 11,
            fontFamily: 'monospace',
            letterSpacing: 2,
          }}
        >
          {isLive ? 'connecting to fleet…' : 'initializing world…'}
        </div>
      )}
    </div>
  )
}
