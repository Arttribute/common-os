'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAuthStore } from '@/store/authStore'

const mono: React.CSSProperties = { fontFamily: 'monospace' }

const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 10,
  padding: '18px 20px',
  fontFamily: 'monospace',
}

const label: React.CSSProperties = {
  fontSize: 9,
  color: '#475569',
  letterSpacing: 1,
  textTransform: 'uppercase',
  marginBottom: 6,
}

const codeBlock: React.CSSProperties = {
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 6,
  padding: '10px 14px',
  fontSize: 11,
  color: '#94a3b8',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
  position: 'relative',
}

export default function SettingsPage() {
  const { user } = usePrivy()
  const { apiKey, tenantId } = useAuthStore()
  const router = useRouter()
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.commonos.dev'
  const email = user?.email?.address ?? user?.wallet?.address?.slice(0, 16) ?? '—'

  async function copy(text: string, setCopied: (v: boolean) => void) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const loginCmd = apiKey
    ? `commonos auth login --key ${apiKey} --url ${apiUrl}`
    : `commonos auth login --key <your-api-key> --url ${apiUrl}`

  return (
    <div style={{ minHeight: '100vh', background: '#060b14', color: '#e2e8f0', ...mono }}>

      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '14px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        gap: 12,
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.5 }}>
          common<span style={{ color: '#f59e0b' }}>os</span>
        </span>
        <span style={{ fontSize: 11, color: '#334155' }}>/ settings</span>
        <span style={{ marginLeft: 'auto' }} />
        <button
          onClick={() => router.push('/dashboard')}
          style={{ ...ghostBtn, fontSize: 10 }}
        >
          ← dashboard
        </button>
        <button
          onClick={() => router.push('/world')}
          style={{ ...ghostBtn, fontSize: 10 }}
        >
          world →
        </button>
      </header>

      <main style={{ maxWidth: 660, margin: '0 auto', padding: '36px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Account */}
        <div style={panel}>
          <div style={label}>account</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row k="email" v={email} />
            <Row k="tenant id" v={tenantId ?? '—'} dim />
            <Row k="plan" v="free" />
          </div>
        </div>

        {/* API Key */}
        <div style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div style={label}>api key</div>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#334155' }}>
              {apiKey ? 'stored from first login' : 'not available — re-login to get a new key'}
            </span>
          </div>

          {apiKey ? (
            <div>
              <div style={{ ...codeBlock, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, color: '#94a3b8', letterSpacing: 0.3 }}>
                  {showKey ? apiKey : `${apiKey.slice(0, 16)}${'•'.repeat(24)}`}
                </span>
                <button
                  onClick={() => setShowKey(v => !v)}
                  style={iconBtn}
                  title={showKey ? 'hide' : 'reveal'}
                >
                  {showKey ? '👁' : '👁‍🗨'}
                </button>
                <button
                  onClick={() => void copy(apiKey, setCopiedKey)}
                  style={iconBtn}
                  title="copy"
                >
                  {copiedKey ? '✓' : '⎘'}
                </button>
              </div>
              <div style={{ fontSize: 9, color: '#334155', marginTop: 8 }}>
                Keep this secret. It grants full control over your fleets.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#334155' }}>
              API key was shown once at account creation. Sign out and back in to generate a new one.
            </div>
          )}
        </div>

        {/* CLI Setup */}
        <div style={panel}>
          <div style={label}>cli setup</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
            Install and authenticate the CommonOS CLI:
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <CodeLine label="install" code="npm install -g @common-os/cli" />
            <div>
              <div style={{ fontSize: 9, color: '#475569', marginBottom: 4 }}>authenticate</div>
              <div style={{ ...codeBlock, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, color: apiKey ? '#94a3b8' : '#475569' }}>{loginCmd}</span>
                <button
                  onClick={() => void copy(loginCmd, setCopiedCmd)}
                  style={iconBtn}
                  title="copy"
                >
                  {copiedCmd ? '✓' : '⎘'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 14 }}>
            <div style={{ fontSize: 9, color: '#475569', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>
              common commands
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                ['fleet create', 'commonos fleet create --name my-fleet'],
                ['agent deploy', 'commonos agent deploy --fleet <id> --role engineer'],
                ['task send', 'commonos task send <agent-id> "build the auth module" --fleet <id>'],
                ['agent logs', 'commonos agent logs <agent-id> --fleet <id>'],
                ['world view', 'commonos world snapshot <fleet-id>'],
              ].map(([name, cmd]) => (
                <div key={name} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 9, color: '#334155', minWidth: 80, flexShrink: 0 }}>{name}</span>
                  <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>{cmd}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </main>
    </div>
  )
}

function Row({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
      <span style={{ fontSize: 10, color: '#475569', minWidth: 80 }}>{k}</span>
      <span style={{ fontSize: 11, color: dim ? '#334155' : '#94a3b8', fontFamily: 'monospace' }}>{v}</span>
    </div>
  )
}

function CodeLine({ label: lbl, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div>
      <div style={{ fontSize: 9, color: '#475569', marginBottom: 4 }}>{lbl}</div>
      <div style={{ ...codeBlock, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>{code}</span>
        <button onClick={() => void copy()} style={iconBtn} title="copy">
          {copied ? '✓' : '⎘'}
        </button>
      </div>
    </div>
  )
}

const ghostBtn: React.CSSProperties = {
  padding: '6px 12px',
  background: 'none',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6,
  color: '#475569',
  fontSize: 10,
  fontFamily: 'monospace',
  cursor: 'pointer',
}

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#475569',
  cursor: 'pointer',
  fontSize: 13,
  padding: '0 2px',
  flexShrink: 0,
}
