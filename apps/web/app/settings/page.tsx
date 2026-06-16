'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { ArrowLeft, Check, Copy, Eye, EyeOff, KeyRound, Terminal, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getCommonOsApiUrl } from '@/lib/api-url'
import { useAuthStore } from '@/store/authStore'

export default function SettingsPage() {
  const { user } = usePrivy()
  const { apiKey, tenantId } = useAuthStore()
  const router = useRouter()
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const apiUrl = getCommonOsApiUrl()
  const email = user?.email?.address ?? user?.wallet?.address?.slice(0, 16) ?? '-'
  const loginCmd = apiKey
    ? `cos auth login --key ${apiKey} --url ${apiUrl}`
    : `cos auth login --key <your-api-key> --url ${apiUrl}`

  async function copy(text: string, setCopied: (value: boolean) => void) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Common<span className="text-primary">OS</span>
          </Link>
          <Badge variant="secondary">Settings</Badge>
          <Button className="ml-auto" variant="outline" size="sm" onClick={() => router.push('/dashboard')}>
            <ArrowLeft />
            Dashboard
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Account settings</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your tenant identity, API key, and CLI setup.
          </p>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <User className="size-5 text-primary" />
                <CardTitle>Account</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <InfoItem label="Email or wallet" value={email} />
              <InfoItem label="Tenant ID" value={tenantId ?? '-'} muted />
              <InfoItem label="Plan" value="Free" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-5 text-primary" />
                  <CardTitle>API key</CardTitle>
                </div>
                <Badge variant={apiKey ? 'success' : 'secondary'}>
                  {apiKey ? 'Stored locally' : 'Not available'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {apiKey ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-md border bg-background p-2">
                    <code className="min-w-0 flex-1 truncate px-2 font-mono text-sm text-slate-300">
                      {showKey ? apiKey : `${apiKey.slice(0, 16)}${'*'.repeat(24)}`}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={showKey ? 'Hide key' : 'Reveal key'}
                      onClick={() => setShowKey((value) => !value)}
                    >
                      {showKey ? <EyeOff /> : <Eye />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Copy key"
                      onClick={() => void copy(apiKey, setCopiedKey)}
                    >
                      {copiedKey ? <Check /> : <Copy />}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Keep this key private. It can control fleets and agent operations for this tenant.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The API key is shown during account creation. Sign out and back in to generate a new one.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Terminal className="size-5 text-primary" />
                <CardTitle>CLI setup</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <CommandLine label="Install" command="npm install -g @common-os/cli" />
              <div>
                <div className="mb-2 text-sm font-medium">Authenticate</div>
                <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#060b14] p-3 text-slate-100">
                  <code className="min-w-0 flex-1 truncate font-mono text-sm">{loginCmd}</code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    title="Copy command"
                    onClick={() => void copy(loginCmd, setCopiedCmd)}
                  >
                    {copiedCmd ? <Check /> : <Copy />}
                  </Button>
                </div>
              </div>
              <div className="rounded-md border">
                {[
                  ['Create fleet', 'cos fleet create --name my-fleet'],
                  ['Deploy agent', 'cos agent deploy --fleet <id> --role engineer'],
                  ['Send task', 'cos task send <agent-id> "build the auth module" --fleet <id>'],
                  ['Agent logs', 'cos agent logs <agent-id> --fleet <id>'],
                  ['World snapshot', 'cos world snapshot <fleet-id>'],
                ].map(([name, cmd]) => (
                  <div key={name} className="grid gap-2 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[150px_1fr]">
                    <span className="text-sm font-medium">{name}</span>
                    <code className="min-w-0 break-all font-mono text-sm text-muted-foreground">{cmd}</code>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

function InfoItem({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/30 p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={muted ? 'mt-1 truncate text-sm text-muted-foreground' : 'mt-1 truncate text-sm font-medium'}>
        {value}
      </div>
    </div>
  )
}

function CommandLine({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div>
      <div className="mb-2 text-sm font-medium">{label}</div>
      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#060b14] p-3 text-slate-100">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">{command}</code>
        <Button type="button" variant="secondary" size="icon" title="Copy command" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}
