'use client'
import { useCallback, useEffect, useState } from 'react'
import { signIn, signOut, useSession } from 'next-auth/react'
import { getCommonOsApiUrl } from '@/lib/api-url'
import { useAuthStore } from '@/store/authStore'

export function useAuth() {
  const { data: session, status } = useSession()
  const ready = status !== 'loading'
  const authenticated = status === 'authenticated'
  const getAccessToken = useCallback(async () => session?.accessToken ?? null, [session?.accessToken])
  const user = session?.user
  const { tenantId, apiKey, setTenant, clear } = useAuthStore()
  const [onboarding, setOnboarding] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const apiUrl = getCommonOsApiUrl()

  // Resolve the canonical tenant after every authenticated browser session.
  // Persisted tenant IDs are only a cache and must never override identity.
  useEffect(() => {
    if (!ready || !authenticated || !apiUrl) return

    setOnboarding(true)
    setOnboardingError(null)
    void (async () => {
      try {
        const token = await getAccessToken()
        const res = await fetch(`${apiUrl}/auth/tenant`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: user?.email,
          }),
        })
        if (res.ok) {
          const data = (await res.json()) as { _id: string; apiKey?: string }
          setTenant(data._id, data.apiKey)
        } else {
          setOnboardingError(`Could not connect your CommonOS account (${res.status}).`)
        }
      } catch {
        setOnboardingError('Could not connect to the CommonOS API.')
      } finally {
        setOnboarding(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, apiUrl, getAccessToken, user?.email, setTenant])

  const logout = async () => {
    clear()
    await signOut({ callbackUrl: '/' })
  }

  return {
    ready,
    authenticated,
    tenantId,
    apiKey,
    onboarding,
    onboardingError,
    getAccessToken,
    user,
    login: () => signIn('commons', { callbackUrl: '/dashboard' }),
    logout,
    // Helper: call any API endpoint with the current Privy JWT
    apiFetch: useCallback(async (path: string, init?: RequestInit) => {
      if (!apiUrl) throw new Error('CommonOS API URL not set')
      const token = await getAccessToken()
      return fetch(`${apiUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      })
    }, [apiUrl, getAccessToken]),
  }
}
