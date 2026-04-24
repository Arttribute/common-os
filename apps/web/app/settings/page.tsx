import Link from 'next/link'

export default function SettingsPage() {
  return (
    <main
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: '#060b14',
        fontFamily: 'monospace',
      }}
    >
      <h1 style={{ fontSize: 18, color: '#e2e8f0', fontWeight: 600 }}>Settings</h1>
      <p style={{ fontSize: 11, color: '#334155' }}>API keys · account · billing</p>
      <p style={{ fontSize: 10, color: '#1e293b', marginTop: 8 }}>
        Coming soon — post-hackathon
      </p>
      <Link
        href="/world"
        style={{ fontSize: 10, color: '#475569', textDecoration: 'underline', marginTop: 8 }}
      >
        ← back to world
      </Link>
    </main>
  )
}
