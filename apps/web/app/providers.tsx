'use client'
import { PrivyProvider } from '@privy-io/react-auth'

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''

export function Providers({ children }: { children: React.ReactNode }) {
  // If no Privy app ID is configured, render children directly (dev / demo mode)
  if (!appId) return <>{children}</>

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#f59e0b',
          logo: '',
        },
        loginMethods: ['email', 'wallet'],
        embeddedWallets: { createOnLogin: 'users-without-wallets' },
      }}
    >
      {children}
    </PrivyProvider>
  )
}
