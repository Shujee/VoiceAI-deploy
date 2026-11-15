// Single shared admin login (one operator manages every business - see
// happy-gliding-puffin.md's scope decisions), backed by Laravel Sanctum's
// SPA cookie-session auth, not a token store.
import axios from 'axios'
import { defineStore } from 'pinia'
import api, { appOrigin } from '@/services/api'

export type AdminUser = {
  id: number
  name: string
  email: string
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as AdminUser | null,
    // Flips true after the first fetchUser() call (success or failure) -
    // lets the router guard tell "haven't checked yet" apart from
    // "checked, not logged in" so it only hits /me once per page load.
    initialized: false,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    isAuthenticated: state => !!state.user,
  },

  actions: {
    // Sanctum SPA auth needs a fresh CSRF cookie before the first
    // state-changing request (login) in each session - a plain GET to the
    // root-level sanctum/csrf-cookie endpoint, using the same
    // withCredentials behavior as the main api instance so the cookie is
    // actually stored by the browser.
    async ensureCsrfCookie() {
      await axios.get(`${appOrigin}/sanctum/csrf-cookie`, { withCredentials: true })
    },

    async login(email: string, password: string) {
      this.loading = true
      this.error = null

      try {
        await this.ensureCsrfCookie()
        const res = await api.post('/login', { email, password })
        this.user = res.data.user
        this.initialized = true
      } catch (error: any) {
        // AuthController throws a ValidationException on bad credentials -
        // that shape is {message, errors: {email: [...]}}, not a flat
        // message worth showing on its own, so prefer the field-level
        // message when present.
        this.error = error?.response?.data?.errors?.email?.[0]
          ?? error?.response?.data?.message
          ?? 'Login failed - check your email and password.'
        throw error
      } finally {
        this.loading = false
      }
    },

    async logout() {
      try {
        await api.post('/logout')
      } finally {
        this.user = null
      }
    },

    // Called once at app startup (see router/index.ts's beforeEach guard)
    // to check for an existing session cookie, so a page refresh stays
    // logged in instead of bouncing to /login every time.
    async fetchUser() {
      try {
        const res = await api.get<{ user: AdminUser | null }>('/me')
        this.user = res.data.user
      } catch {
        this.user = null
      } finally {
        this.initialized = true
      }
    },
  },
})
