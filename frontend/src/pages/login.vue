<template>
  <v-main>
    <div class="login-screen">
      <div class="login-panel d-none d-md-flex">
        <AuroraBackground variant="panel" />

        <div class="login-panel__content">
          <BrandLogo
            inverted
            to="/"
          />

          <h2 class="login-panel__title">
            Every call answered, every business covered.
          </h2>

          <p class="login-panel__subtitle">
            Manage voices, knowledge bases, and call logs for every business
            on your VoiceAI line from one dashboard.
          </p>
        </div>
      </div>

      <div class="login-form-side">
        <v-container class="fill-height d-flex align-center justify-center">
          <v-card
            width="380"
            class="pa-6"
            variant="outlined"
          >
            <div class="d-flex justify-center mb-2 d-md-none">
              <BrandLogo :show-wordmark="true" />
            </div>

            <v-card-title class="text-center px-0">
              Admin sign in
            </v-card-title>

            <v-card-subtitle class="text-center px-0 mb-4">
              VoiceAI Admin Dashboard
            </v-card-subtitle>

            <v-card-text class="px-0">
              <v-form @submit.prevent="handleSubmit">
                <v-text-field
                  v-model="email"
                  label="Email"
                  type="email"
                  autocomplete="username"
                  prepend-inner-icon="mdi-email-outline"
                  required
                />

                <v-text-field
                  v-model="password"
                  label="Password"
                  type="password"
                  autocomplete="current-password"
                  prepend-inner-icon="mdi-lock-outline"
                  required
                />

                <v-alert
                  v-if="auth.error"
                  type="error"
                  density="compact"
                  class="mb-4"
                >
                  {{ auth.error }}
                </v-alert>

                <v-btn
                  type="submit"
                  color="primary"
                  size="large"
                  block
                  :loading="auth.loading"
                >
                  Log in
                </v-btn>
              </v-form>
            </v-card-text>

            <div class="text-center mt-2">
              <router-link
                to="/"
                class="text-caption text-medium-emphasis text-decoration-none"
              >
                &larr; Back to voiceai.example
              </router-link>
            </div>
          </v-card>
        </v-container>
      </div>
    </div>
  </v-main>
</template>

<script lang="ts" setup>
// Visual reskin only (2026-09-14 facelift) - the actual auth logic
// (auth.login / redirect handling) is unchanged from the original version.
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AuroraBackground from '@/components/AuroraBackground.vue'
import BrandLogo from '@/components/BrandLogo.vue'

const email = ref('')
const password = ref('')

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

async function handleSubmit() {
  try {
    await auth.login(email.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard/businesses'
    router.push(redirect)
  } catch {
    // auth.error is already set and rendered above - nothing else to do.
  }
}
</script>

<style scoped>
.login-screen {
  display: flex;
  min-height: 100vh;
}

.login-panel {
  position: relative;
  overflow: hidden;
  flex: 1 1 45%;
  background: #0B0A17;
  align-items: center;
  justify-content: center;
}

.login-panel__content {
  position: relative;
  z-index: 1;
  color: #fff;
  max-width: 380px;
  padding: 48px;
}

.login-panel__title {
  font-size: 1.7rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.25;
  margin: 32px 0 16px;
}

.login-panel__subtitle {
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.6;
}

.login-form-side {
  flex: 1 1 55%;
  display: flex;
}
</style>
