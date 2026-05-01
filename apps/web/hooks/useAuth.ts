'use client'
import { useCallback, useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAuthStore } from '@/store/authStore'

export function useAuth() {
  const { ready, authenticated, getAccessToken, user, logout: privyLogout } = usePrivy()
  const { tenantId, apiKey, setTenant, clear } = useAuthStore()
  const [onboarding, setOnboarding] = useState(false)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL

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
            email: user?.email?.address,
            walletAddress: user?.wallet?.address,
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
  }, [ready, authenticated, tenantId, apiUrl])

  const logout = async () => {
    clear()
    await privyLogout()
  }

  return {
    ready,
    authenticated,
    tenantId,
    apiKey,
    onboarding,
    getAccessToken,
    user,
    logout,
    // Helper: call any API endpoint with the current Privy JWT
    apiFetch: useCallback(async (path: string, init?: RequestInit) => {
      if (!apiUrl) throw new Error('NEXT_PUBLIC_API_URL not set')
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
