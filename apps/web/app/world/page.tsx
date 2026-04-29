'use client'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@/hooks/useAuth'
import { HUD } from '@/components/hud/HUD'
import { useWorldStore } from '@/store/worldStore'
import { useWorldConnection } from '@/hooks/useWorldConnection'

const PhaserGame = dynamic(() => import('@/components/PhaserGame'), { ssr: false })

// Inner component uses useSearchParams — must be inside <Suspense>
function WorldContent() {
  const { ready } = usePrivy()
  const { authenticated, getAccessToken } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fleetId = searchParams.get('fleet') ?? undefined
  const initialized = useWorldStore((s) => s.initialized)

  const privyEnabled = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID
  useEffect(() => {
    if (privyEnabled && ready && !authenticated) {
      router.replace('/auth')
    }
  }, [privyEnabled, ready, authenticated, router])

  const { isLive } = useWorldConnection(
    fleetId,
    privyEnabled ? getAccessToken : undefined,
  )

  if (privyEnabled && (!ready || !authenticated)) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#060b14',
          color: '#334155',
          fontSize: 11,
          fontFamily: 'monospace',
          letterSpacing: 2,
        }}
      >
        {ready ? 'redirecting…' : 'loading…'}
      </div>
    )
  }

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

export default function WorldPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#060b14',
            color: '#334155',
            fontSize: 11,
            fontFamily: 'monospace',
            letterSpacing: 2,
          }}
        >
          loading…
        </div>
      }
    >
      <WorldContent />
    </Suspense>
  )
}
