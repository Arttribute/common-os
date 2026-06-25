import Link from 'next/link'
import { Box, Loader2 } from 'lucide-react'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AuthPage({ searchParams }: Props) {
  const params = await searchParams
  const callbackUrl =
    typeof params.callbackUrl === 'string' ? params.callbackUrl : '/dashboard'
  const oauthQuery =
    typeof params.oauth_query === 'string' ? params.oauth_query : ''
  const error = typeof params.authError === 'string' ? params.authError : ''
  const registered = params.registered === '1'
  const identityUrl =
    process.env.COMMONS_IDENTITY_ISSUER?.replace(/\/api\/auth\/?$/, '') ??
    'https://auth.agentcommons.io'
  const appUrl =
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    'https://os.agentcommons.io'
  const returnTo = `${appUrl}/auth?callbackUrl=${encodeURIComponent(callbackUrl)}`

  if (!oauthQuery) {
    return (
      <Shell>
        <h1 className="mb-2 text-center text-2xl font-semibold">Sign in to Common<span className="text-primary">OS</span></h1>
        <p className="mb-8 text-center text-sm text-muted-foreground">Access your fleets and agent compute.</p>
        <form method="post" action="/api/auth/native/start">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Preparing sign in…
          </button>
        </form>
        <script dangerouslySetInnerHTML={{ __html: 'document.forms[0].submit()' }} />
      </Shell>
    )
  }

  return (
    <Shell>
      {registered && (
        <p className="mb-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
          Check your email to verify your CommonOS account.
        </p>
      )}
      <h1 className="mb-2 text-center text-2xl font-semibold">Sign in to Common<span className="text-primary">OS</span></h1>
      <p className="mb-8 text-center text-sm text-muted-foreground">Access your fleets and agent compute.</p>
      {error && <p className="mb-4 text-center text-sm text-destructive">{error}</p>}
      <a
        className="mb-5 flex w-full items-center justify-center gap-2 rounded-md border px-4 py-3 font-semibold hover:bg-accent"
        href={`${identityUrl}/native/sign-in/google?app=common-os&oauth_query=${encodeURIComponent(oauthQuery)}&return_to=${encodeURIComponent(returnTo)}`}
      >
        <span className="font-bold text-blue-500">G</span> Continue with Google
      </a>
      <div className="mb-5 flex items-center gap-3 text-xs uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <form method="post" action={`${identityUrl}/native/sign-in/email`} className="space-y-4">
        <input type="hidden" name="app" value="common-os" />
        <input type="hidden" name="oauth_query" value={oauthQuery} />
        <input type="hidden" name="return_to" value={returnTo} />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <button className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground">Sign in</button>
      </form>
      <details className="mt-5 text-sm">
        <summary className="cursor-pointer text-center font-medium">Create an account</summary>
        <form method="post" action={`${identityUrl}/native/sign-up/email`} className="mt-4 space-y-4">
          <input type="hidden" name="app" value="common-os" />
          <input type="hidden" name="oauth_query" value={oauthQuery} />
          <input type="hidden" name="return_to" value={returnTo} />
          <Field label="Name" name="name" autoComplete="name" />
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <Field label="Password" name="password" type="password" minLength={8} autoComplete="new-password" />
          <button className="w-full rounded-md border px-4 py-3 font-semibold">Create account</button>
        </form>
      </details>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <section className="w-full max-w-md rounded-xl border bg-card p-7 shadow-sm">
        <Link href="/" className="mx-auto mb-6 flex w-fit items-center gap-2 font-semibold">
          <span className="flex size-10 items-center justify-center rounded-md border"><Box className="size-5 text-primary" /></span>
          CommonOS
        </Link>
        {children}
      </section>
    </main>
  )
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...input } = props
  return (
    <label className="block text-sm font-medium">
      {label}
      <input {...input} required className="mt-1 w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
    </label>
  )
}
