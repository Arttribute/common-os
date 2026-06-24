'use client'
import { PrivyProvider } from '@privy-io/react-auth'
import { SessionProvider } from 'next-auth/react'

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''

export function Providers({ children }: { children: React.ReactNode }) {
  // If no Privy app ID is configured, render children directly (dev / demo mode)
  if (!appId) return <SessionProvider>{children}</SessionProvider>

  return (
    <SessionProvider>
      <PrivyProvider
        appId={appId}
        config={{
          appearance: {
            theme: 'dark',
            accentColor: '#f59e0b',
            logo: '',
          },
          loginMethods: ['wallet'],
          embeddedWallets: { createOnLogin: 'off' },
        }}
      >
        {children}
      </PrivyProvider>
    </SessionProvider>
  )
}
