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
import { Loader2 } from 'lucide-react'

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
      <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {ready ? 'Redirecting...' : 'Loading world...'}
      </div>
    )
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#060b14' }}>
      {initialized && <PhaserGame />}

      <HUD />

      {!initialized && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          <div className="rounded-lg border border-white/10 bg-background/80 px-4 py-3 shadow-xl shadow-black/30 backdrop-blur-xl">
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            {isLive ? 'Connecting to fleet...' : 'Initializing world...'}
          </div>
        </div>
      )}
    </div>
  )
}

export default function WorldPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading world...
        </div>
      }
    >
      <WorldContent />
    </Suspense>
  )
}
