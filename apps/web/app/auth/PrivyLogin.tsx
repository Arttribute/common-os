'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

  const busy = !ready || onboarding || (authenticated && !tenantId)
  const statusText = !ready
    ? 'Loading...'
    : onboarding
      ? 'Setting up your account...'
      : authenticated && !tenantId
        ? 'Connecting tenant...'
        : 'Continue'

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-md border bg-background">
            <ShieldCheck className="size-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">
            Sign in to Common<span className="text-primary">OS</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Access your fleet control plane and deployment credentials.
          </p>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            size="lg"
            onClick={authenticated ? undefined : login}
            disabled={busy}
          >
            {busy && <Loader2 className="animate-spin" />}
            {statusText}
            {!busy && <ArrowRight />}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
