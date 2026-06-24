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
  const apiUrl = getCommonOsApiUrl()

  // After Privy login, ensure this user has a tenant record in the API
  useEffect(() => {
    if (!ready || !authenticated || tenantId || !apiUrl) return

    setOnboarding(true)
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
        }
      } catch {
        // Non-fatal — user can retry by refreshing
      } finally {
        setOnboarding(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, tenantId, apiUrl, getAccessToken, user?.email, setTenant])

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
