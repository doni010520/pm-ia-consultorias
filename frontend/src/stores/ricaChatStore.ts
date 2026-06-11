import { create } from 'zustand'

interface RicaChatState {
  isOpen: boolean
  sessionId: string | null
  initialMessage: string | null
  open: (message?: string) => void
  close: () => void
  setSessionId: (id: string) => void
  clearInitialMessage: () => void
}

export const useRicaChatStore = create<RicaChatState>((set) => ({
  isOpen: false,
  sessionId: null,
  initialMessage: null,

  open: (message) =>
    set({ isOpen: true, initialMessage: message ?? null }),

  close: () => set({ isOpen: false }),

  setSessionId: (id) => {
    set({ sessionId: id })
    localStorage.setItem('rica-chat-session', id)
  },

  clearInitialMessage: () => set({ initialMessage: null }),
}))

// Inicializa o sessionId do localStorage ao carregar a store
const storedSession = localStorage.getItem('rica-chat-session')
if (storedSession) {
  useRicaChatStore.getState().setSessionId(storedSession)
}
