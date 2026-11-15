<template>
  <v-app>
    <v-app-bar
      flat
      :elevation="scrolled ? 2 : 0"
      color="surface"
      class="marketing-nav"
    >
      <v-container
        class="d-flex align-center py-0"
        style="max-width: 1180px;"
      >
        <BrandLogo />

        <v-spacer />

        <div class="d-none d-md-flex align-center ga-2">
          <v-btn variant="text" to="/">
            Home
          </v-btn>
          <v-btn variant="text" to="/about">
            About
          </v-btn>
          <v-btn variant="text" to="/contact">
            Contact
          </v-btn>
          <v-btn variant="text" to="/login" class="ml-2">
            Admin Login
          </v-btn>
          <v-btn color="primary" to="/contact">
            Get a demo
          </v-btn>
        </div>

        <v-app-bar-nav-icon
          class="d-md-none"
          @click="drawer = !drawer"
        />
      </v-container>
    </v-app-bar>

    <v-navigation-drawer
      v-model="drawer"
      temporary
      location="right"
      class="d-md-none"
    >
      <v-list nav>
        <v-list-item to="/" title="Home" @click="drawer = false" />
        <v-list-item to="/about" title="About" @click="drawer = false" />
        <v-list-item to="/contact" title="Contact" @click="drawer = false" />
        <v-divider class="my-2" />
        <v-list-item to="/login" title="Admin login" @click="drawer = false" />
      </v-list>
    </v-navigation-drawer>

    <v-main>
      <router-view />
    </v-main>

    <footer class="marketing-footer">
      <v-container style="max-width: 1180px;">
        <div class="d-flex flex-column flex-sm-row justify-space-between align-center ga-4 py-8">
          <BrandLogo />

          <div class="d-flex ga-6">
            <router-link to="/" class="marketing-footer__link">
              Home
            </router-link>
            <router-link to="/about" class="marketing-footer__link">
              About
            </router-link>
            <router-link to="/contact" class="marketing-footer__link">
              Contact
            </router-link>
          </div>

          <span class="text-body-2 text-medium-emphasis">&copy; {{ year }} VoiceAI. All rights reserved.</span>
        </div>
      </v-container>
    </footer>
  </v-app>
</template>

<script setup lang="ts">
// Public-facing chrome (nav + footer) for the marketing site - separate from
// DashboardLayout.vue, which is only mounted behind the auth guard. Kept as
// its own layout (rather than reusing DashboardLayout) since the two need
// completely different chrome: no nav-drawer/logout here, and this one is
// reachable without a session.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import BrandLogo from '@/components/BrandLogo.vue'

const drawer = ref(false)
const scrolled = ref(false)
const year = new Date().getFullYear()

function handleScroll() {
  scrolled.value = window.scrollY > 8
}

onMounted(() => window.addEventListener('scroll', handleScroll, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('scroll', handleScroll))
</script>

<style scoped>
.marketing-footer {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.marketing-footer__link {
  text-decoration: none;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.75;
  font-size: 0.9rem;
}

.marketing-footer__link:hover {
  opacity: 1;
}
</style>
