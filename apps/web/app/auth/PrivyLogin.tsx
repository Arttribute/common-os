'use client'
import { usePrivy } from '@privy-io/react-auth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function PrivyLogin() {
  const { ready, authenticated, login } = usePrivy()
  const router = useRouter()

  useEffect(() => {
    if (ready && authenticated) router.replace('/world')
  }, [ready, authenticated, router])

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

      <p style={{ fontSize: 11, color: '#334155', letterSpacing: 1 }}>
        sign in to manage your fleet
      </p>

      <button
        onClick={login}
        disabled={!ready}
        style={{
          padding: '11px 28px',
          background: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 8,
          color: '#f59e0b',
          fontSize: 12,
          fontFamily: 'monospace',
          cursor: ready ? 'pointer' : 'not-allowed',
          opacity: ready ? 1 : 0.5,
          letterSpacing: 0.5,
        }}
      >
        {ready ? 'connect wallet / sign in' : 'loading…'}
      </button>
    </div>
  )
}
