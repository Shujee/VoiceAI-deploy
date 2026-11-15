/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

import Login from '@/pages/login.vue'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import MarketingLayout from '@/layouts/MarketingLayout.vue'
import LandingPage from '@/pages/index.vue'
import AboutPage from '@/pages/about.vue'
import ContactPage from '@/pages/contact.vue'
import BusinessesList from '@/pages/dashboard/businesses/index.vue'
import BusinessEdit from '@/pages/dashboard/businesses/[id].vue'
import CallLogsList from '@/pages/dashboard/call-logs/index.vue'
import CallLogDetail from '@/pages/dashboard/call-logs/[id].vue'
import UsagePage from '@/pages/dashboard/usage.vue'
import TestCall from '@/pages/dashboard/test-call.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: Login,
      meta: { public: true },
    },
    // Public marketing site (2026-09-14 facelift) - previously '/' just
    // redirected straight into the dashboard, since there was no real
    // landing page yet. pages/index.vue is now the actual landing page.
    {
      path: '/',
      component: MarketingLayout,
      children: [
        { path: '', name: 'home', component: LandingPage, meta: { public: true } },
        { path: 'about', name: 'about', component: AboutPage, meta: { public: true } },
        { path: 'contact', name: 'contact', component: ContactPage, meta: { public: true } },
      ],
    },
    {
      path: '/dashboard',
      component: DashboardLayout,
      children: [
        { path: '', redirect: '/dashboard/businesses' },
        { path: 'businesses', name: 'businesses', component: BusinessesList },
        { path: 'businesses/:id', name: 'business-edit', component: BusinessEdit, props: true },
        { path: 'call-logs', name: 'call-logs', component: CallLogsList },
        { path: 'call-logs/:id', name: 'call-log-detail', component: CallLogDetail, props: true },
        { path: 'usage', name: 'usage', component: UsagePage },
        { path: 'test-call', name: 'test-call', component: TestCall },
      ],
    },
  ],
})

// Single shared admin login (see happy-gliding-puffin.md) - anything not
// explicitly marked public requires a Sanctum session. fetchUser() is
// gated on auth.initialized so this only hits the backend once per page
// load/refresh, not on every navigation.
router.beforeEach(async to => {
  if (to.meta.public)
    return true

  const auth = useAuthStore()

  if (!auth.initialized)
    await auth.fetchUser()

  if (!auth.isAuthenticated) {
    return {
      name: 'login',
      query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined,
    }
  }

  return true
})

export default router
