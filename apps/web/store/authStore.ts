import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  tenantId: string | null
  apiKey: string | null          // shown once at tenant creation; stored for CLI reference
  setTenant: (tenantId: string, apiKey?: string) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      tenantId: null,
      apiKey: null,
      setTenant: (tenantId, apiKey) =>
        set({ tenantId, ...(apiKey ? { apiKey } : {}) }),
      clear: () => set({ tenantId: null, apiKey: null }),
    }),
    { name: 'commonos-auth' },
  ),
)
