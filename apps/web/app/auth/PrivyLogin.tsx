'use client'
import { usePrivy } from '@privy-io/react-auth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'

export default function PrivyLogin() {
  const { ready, login } = usePrivy()
  const { authenticated, tenantId, onboarding } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (ready && authenticated && tenantId) {
      router.replace('/dashboard')
    }
  }, [ready, authenticated, tenantId, router])

  const statusText = !ready
    ? 'loading…'
    : onboarding
      ? 'setting up your account…'
      : authenticated && !tenantId
        ? 'connecting…'
        : 'connect wallet / sign in'

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        background: '#060b14',
        fontFamily: 'monospace',
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#e2e8f0', letterSpacing: -0.5 }}>
        common<span style={{ color: '#f59e0b' }}>os</span>
      </h1>

      <p style={{ fontSize: 12, color: '#94a3b8', letterSpacing: 1 }}>
        sign in to manage your fleet
      </p>

      <button
        onClick={authenticated ? undefined : login}
        disabled={!ready || onboarding || (authenticated && !tenantId)}
        style={{
          padding: '11px 28px',
          background: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 8,
          color: '#f59e0b',
          fontSize: 12,
          fontFamily: 'monospace',
          cursor: ready && !onboarding ? 'pointer' : 'not-allowed',
          opacity: ready && !onboarding ? 1 : 0.5,
          letterSpacing: 0.5,
          minWidth: 200,
        }}
      >
        {statusText}
      </button>
    </div>
  )
}
