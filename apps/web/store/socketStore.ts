import { create } from 'zustand'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface SocketStore {
  socket: WebSocket | null
  status: ConnectionStatus
  connect: (url: string, onMessage: (data: unknown) => void) => void
  disconnect: () => void
}

export const useSocketStore = create<SocketStore>((set, get) => ({
  socket: null,
  status: 'disconnected',

  connect: (url, onMessage) => {
    const existing = get().socket
    if (existing) existing.close()

    set({ status: 'connecting' })
    const ws = new WebSocket(url)

    ws.onopen = () => set({ status: 'connected' })
    ws.onclose = () => set({ status: 'disconnected', socket: null })
    ws.onerror = () => set({ status: 'error' })
    ws.onmessage = (msg) => {
      try {
        onMessage(JSON.parse(msg.data))
      } catch {
        // ignore malformed messages
      }
    }

    set({ socket: ws })
  },

  disconnect: () => {
    get().socket?.close()
    set({ socket: null, status: 'disconnected' })
  },
}))
