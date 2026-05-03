'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Privy auth is conditionally loaded based on NEXT_PUBLIC_PRIVY_APP_ID.
// If not configured, redirect straight to world (demo mode).
export default function AuthPage() {
  const router = useRouter()
  const privyEnabled = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID

  useEffect(() => {
    if (!privyEnabled) {
      router.replace('/world')
    }
  }, [privyEnabled, router])

  if (!privyEnabled) {
    return (
      <div style={{ ...centeredStyle }}>
        <span style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace' }}>redirecting…</span>
      </div>
    )
  }

  return <PrivyLoginGate />
}

function PrivyLoginGate() {
  // Dynamically load Privy hooks to avoid SSR issues
  const { default: PrivyLogin } = require('./PrivyLogin') as { default: React.ComponentType }
  return <PrivyLogin />
}

const centeredStyle: React.CSSProperties = {
  width: '100vw',
  height: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#060b14',
}
