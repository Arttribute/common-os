'use client'
import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { HUD } from '@/components/hud/HUD'
import { startMockSimulation } from '@/lib/mockSimulation'
import { useWorldStore } from '@/store/worldStore'

const PhaserGame = dynamic(() => import('@/components/PhaserGame'), { ssr: false })

export default function WorldClient() {
  const initialized = useWorldStore((s) => s.initialized)
  const stopSimRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // Start mock simulation unless a real fleet WebSocket is connected.
    // Replace startMockSimulation() with real API calls when backend is ready.
    stopSimRef.current = startMockSimulation()
    return () => stopSimRef.current?.()
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#060b14' }}>
      {/* Phaser canvas fills the full viewport */}
      {initialized && <PhaserGame />}

      {/* React HUD sits on top, pointer-events managed per panel */}
      <HUD />

      {/* Loading state while simulation initialises */}
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
          initializing world…
        </div>
      )}
    </div>
  )
}
