'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

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
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Redirecting to demo world...
      </div>
    )
  }

  return <PrivyLoginGate />
}

function PrivyLoginGate() {
  const { default: PrivyLogin } = require('./PrivyLogin') as { default: React.ComponentType }
  return <PrivyLogin />
}
