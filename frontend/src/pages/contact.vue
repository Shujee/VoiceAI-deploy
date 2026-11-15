<template>
  <div>
    <div class="page-header">
      <p class="section-eyebrow">
        Contact
      </p>
      <h1 class="page-header__title mx-auto">
        Let's get your line covered.
      </h1>
      <p class="page-header__subtitle mx-auto">
        Tell us a bit about your business and we'll set up a live demo line
        so you can hear VoiceAI answer a call for yourself.
      </p>
    </div>

    <v-container
      class="pb-16"
      style="max-width: 1000px;"
    >
      <v-row>
        <v-col
          cols="12"
          md="7"
        >
          <v-card
            class="pa-6 pa-sm-8"
            variant="outlined"
          >
            <template v-if="!submitted">
              <v-form @submit.prevent="handleSubmit">
                <v-text-field
                  v-model="form.name"
                  label="Your name"
                  required
                />

                <v-text-field
                  v-model="form.business"
                  label="Business name"
                />

                <v-text-field
                  v-model="form.email"
                  label="Email"
                  type="email"
                  required
                />

                <v-text-field
                  v-model="form.phone"
                  label="Phone (optional)"
                />

                <v-textarea
                  v-model="form.message"
                  label="What kind of business is this for?"
                  rows="4"
                  auto-grow
                />

                <v-btn
                  type="submit"
                  color="primary"
                  size="large"
                  block
                  :loading="submitting"
                >
                  Send
                </v-btn>
              </v-form>
            </template>

            <template v-else>
              <div class="text-center py-8">
                <v-avatar
                  color="primary"
                  variant="tonal"
                  size="64"
                  class="mb-4"
                >
                  <v-icon
                    icon="mdi-check"
                    size="32"
                  />
                </v-avatar>
                <h3 class="text-h6 font-weight-bold mb-2">
                  Thanks, {{ form.name.split(' ')[0] || 'there' }}!
                </h3>
                <p class="text-body-2 text-medium-emphasis">
                  We've got your details and will be in touch shortly to set
                  up your demo line.
                </p>
              </div>
            </template>
          </v-card>
        </v-col>

        <v-col
          cols="12"
          md="5"
        >
          <v-card
            class="pa-6 pa-sm-8 h-100"
            color="surface-variant"
            variant="flat"
          >
            <h3 class="text-h6 font-weight-bold mb-4">
              Prefer to reach out directly?
            </h3>

            <div class="d-flex align-center ga-3 mb-4">
              <v-icon icon="mdi-email-outline" />
              <a
                href="mailto:hello@voiceai.example"
                class="text-decoration-none text-primary"
              >hello@voiceai.example</a>
            </div>

            <div class="d-flex align-center ga-3 mb-4">
              <v-icon icon="mdi-phone-outline" />
              <span>+1 (555) 010-2000</span>
            </div>

            <div class="d-flex align-start ga-3">
              <v-icon icon="mdi-clock-outline" />
              <span>Mon-Fri, 9am-6pm - naturally, our own line is answered by VoiceAI too.</span>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </div>
</template>

<script setup lang="ts">
// Placeholder contact details above (email/phone) - swap for the real
// business contact info before this goes in front of the client.
//
// The form below is intentionally frontend-only for now: there's no
// `/contact` (or similar) backend endpoint yet to receive submissions, so
// handleSubmit() just shows the confirmation state rather than pretending
// to send anything. Wire this up to a real endpoint (e.g. POST /api/leads,
// or a simple mailto-triggering service) once one exists.
import { reactive, ref } from 'vue'

const form = reactive({
  name: '',
  business: '',
  email: '',
  phone: '',
  message: '',
})

const submitting = ref(false)
const submitted = ref(false)

async function handleSubmit() {
  submitting.value = true

  try {
    // Simulated latency only - no network request yet, see note above.
    await new Promise(resolve => setTimeout(resolve, 500))
    submitted.value = true
  } finally {
    submitting.value = false
  }
}
</script>
