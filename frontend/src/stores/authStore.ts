import { create } from 'zustand'

const API_URL = import.meta.env.VITE_API_URL || ''
const TOKEN_KEY = 'pm-ia-token'

interface User {
  id: string
  name: string
  email: string
  role: string
  organization_id: string
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: 'Erro ao fazer login' } }))
      throw new Error(err.error?.message || `HTTP ${res.status}`)
    }

    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.token)
    set({ user: data.user, token: data.token, isAuthenticated: true, isLoading: false })
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    set({ user: null, token: null, isAuthenticated: false, isLoading: false })
  },

  checkAuth: async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      set({ isLoading: false, isAuthenticated: false })
      return
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) throw new Error('Token inválido')

      const data = await res.json()
      set({ user: data.user, token, isAuthenticated: true, isLoading: false })
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      set({ user: null, token: null, isAuthenticated: false, isLoading: false })
    }
  },
}))
