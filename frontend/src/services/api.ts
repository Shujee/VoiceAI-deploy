import axios from 'axios'

const apiBaseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api'

// Sanctum's CSRF cookie endpoint lives at the app root (sanctum/csrf-cookie),
// not under /api - derived from the API base URL so only one env var needs
// to be set. See stores/auth.ts's ensureCsrfCookie().
export const appOrigin = apiBaseURL.replace(/\/api\/?$/, '')

// withCredentials is required for Sanctum's cookie-based SPA session auth
// to actually send/receive the session + XSRF-TOKEN cookies cross-origin
// (frontend on :3041, backend on :8000 in dev).
//
// withXSRFToken is the important one and easy to miss: axios only
// auto-attaches the X-XSRF-TOKEN header (read from the XSRF-TOKEN cookie
// Sanctum's csrf-cookie endpoint sets) when the request is SAME-ORIGIN by
// default, as a security default - cross-origin (our case: :3041 -> :8000)
// it silently skips the header unless this is set, which otherwise shows
// up as a 419 CSRF token mismatch on /login despite ensureCsrfCookie()
// having fetched the cookie successfully just before it.
const api = axios.create({
  baseURL: apiBaseURL,
  withCredentials: true,
  withXSRFToken: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
  },
})

export default api
