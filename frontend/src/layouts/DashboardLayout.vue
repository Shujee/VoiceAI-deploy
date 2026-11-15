<template>
  <v-app-bar
    flat
    elevation="1"
    color="surface"
  >
    <div class="pl-4">
      <BrandLogo to="/dashboard/businesses" />
    </div>

    <v-spacer />

    <v-btn
      variant="text"
      prepend-icon="mdi-open-in-new"
      href="/"
      target="_blank"
      class="d-none d-sm-flex mr-2"
    >
      View public site
    </v-btn>

    <v-menu v-if="auth.user">
      <template #activator="{ props: menuProps }">
        <v-btn
          variant="text"
          class="text-none"
          v-bind="menuProps"
        >
          <v-avatar
            color="primary"
            size="32"
            class="mr-2"
          >
            <span class="text-caption font-weight-bold">{{ initials }}</span>
          </v-avatar>
          <span class="d-none d-sm-inline">{{ auth.user.email }}</span>
          <v-icon
            icon="mdi-chevron-down"
            size="18"
            class="ml-1"
          />
        </v-btn>
      </template>

      <v-list density="compact" min-width="200">
        <v-list-item :subtitle="auth.user.email" :title="auth.user.name" />
        <v-divider />
        <v-list-item
          prepend-icon="mdi-logout"
          title="Log out"
          @click="handleLogout"
        />
      </v-list>
    </v-menu>
  </v-app-bar>

  <v-navigation-drawer permanent>
    <v-list
      nav
      class="pa-2"
    >
      <v-list-item
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
        rounded="lg"
        class="mb-1"
        color="primary"
      />
    </v-list>
  </v-navigation-drawer>

  <v-main>
    <v-container
      fluid
      class="pa-4 pa-md-6"
    >
      <router-view />
    </v-container>
  </v-main>
</template>

<script lang="ts" setup>
// Visual reskin only (2026-09-14 facelift) - logo instead of a plain text
// title, an avatar/menu instead of a bare "Log out" text button, and
// rounded/highlighted active nav items. Routes and auth logic unchanged.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import BrandLogo from '@/components/BrandLogo.vue'

const auth = useAuthStore()
const router = useRouter()

const navItems = [
  { to: '/dashboard/businesses', icon: 'mdi-domain', title: 'Businesses' },
  { to: '/dashboard/call-logs', icon: 'mdi-phone-log', title: 'Call Logs' },
  { to: '/dashboard/usage', icon: 'mdi-currency-usd', title: 'Usage' },
  { to: '/dashboard/test-call', icon: 'mdi-phone-in-talk', title: 'Test Call' },
]

const initials = computed(() => {
  const name = auth.user?.name?.trim()
  if (name)
    return name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()

  return auth.user?.email?.[0]?.toUpperCase() ?? '?'
})

async function handleLogout() {
  await auth.logout()
  router.push({ name: 'login' })
}
</script>
