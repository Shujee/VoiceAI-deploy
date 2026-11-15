<template>
  <div>
    <section class="hero-section">
      <AuroraBackground variant="hero" />

      <v-container
        class="hero-content"
        style="max-width: 900px;"
      >
        <p class="section-eyebrow text-center" style="color: #C7C4FB;">
          AI Voice Receptionist for Trade &amp; Service Businesses
        </p>

        <h1 class="hero-title text-center">
          Every call answered. Even when your hands are full.
        </h1>

        <p class="hero-subtitle text-center mx-auto">
          VoiceAI picks up every call to your business, has a real
          conversation, and sends you a clean summary - so no lead goes to
          voicemail while you're on a roof, under a car, or on-site.
        </p>

        <div class="d-flex justify-center flex-wrap ga-4 mt-8">
          <v-btn
            size="x-large"
            color="primary"
            to="/contact"
          >
            Get a demo
          </v-btn>
          <v-btn
            size="x-large"
            variant="outlined"
            class="hero-btn-outline"
            to="/about"
          >
            How it works
          </v-btn>
        </div>
      </v-container>
    </section>

    <v-container
      class="py-16"
      style="max-width: 1180px;"
    >
      <div class="text-center mb-12">
        <p class="section-eyebrow">
          Why VoiceAI
        </p>
        <h2 class="page-header__title mx-auto" style="margin-top: 8px;">
          Built for people who are busy doing the job
        </h2>
      </div>

      <v-row>
        <v-col
          v-for="feature in features"
          :key="feature.title"
          cols="12"
          sm="6"
          md="3"
        >
          <v-card
            class="pa-6 h-100 hover-lift"
            variant="outlined"
          >
            <v-avatar
              color="primary"
              variant="tonal"
              size="52"
              class="mb-4"
            >
              <v-icon
                :icon="feature.icon"
                size="26"
              />
            </v-avatar>

            <h3 class="text-h6 font-weight-bold mb-2">
              {{ feature.title }}
            </h3>

            <p class="text-body-2 text-medium-emphasis">
              {{ feature.description }}
            </p>
          </v-card>
        </v-col>
      </v-row>
    </v-container>

    <v-sheet
      color="surface-variant"
      class="py-16"
    >
      <v-container style="max-width: 1180px;">
        <div class="text-center mb-12">
          <p class="section-eyebrow">
            How it works
          </p>
          <h2 class="page-header__title mx-auto" style="margin-top: 8px;">
            Three steps. No new hardware.
          </h2>
        </div>

        <v-row>
          <v-col
            v-for="(step, index) in steps"
            :key="step.title"
            cols="12"
            md="4"
          >
            <div class="d-flex align-start ga-4">
              <div class="step-number">
                {{ index + 1 }}
              </div>
              <div>
                <h3 class="text-h6 font-weight-bold mb-1">
                  {{ step.title }}
                </h3>
                <p class="text-body-2 text-medium-emphasis">
                  {{ step.description }}
                </p>
              </div>
            </div>
          </v-col>
        </v-row>
      </v-container>
    </v-sheet>

    <section class="cta-band">
      <v-container
        class="text-center py-16"
        style="max-width: 720px;"
      >
        <h2 class="text-h4 font-weight-bold text-white mb-4">
          Stop losing jobs to missed calls.
        </h2>
        <p class="text-body-1 mb-8" style="color: rgba(255,255,255,0.82);">
          Tell us about your business and we'll set up a live demo line so
          you can hear VoiceAI answer a call for yourself.
        </p>
        <v-btn
          size="x-large"
          color="white"
          variant="flat"
          class="text-primary"
          to="/contact"
        >
          Get a demo
        </v-btn>
      </v-container>
    </section>
  </div>
</template>

<script setup lang="ts">
// Real landing page (2026-09-14 facelift). Previously this route rendered
// <LiveKitTest /> directly - that dev tool now lives at
// /dashboard/test-call (see that page's own comment) and was never actually
// reachable at '/' anyway, since router/index.ts redirected '/' straight to
// the dashboard before this facelift.
import AuroraBackground from '@/components/AuroraBackground.vue'

const features = [
  {
    icon: 'mdi-phone-in-talk',
    title: 'Picks up, every time',
    description: 'No voicemail, no missed leads. VoiceAI answers in seconds with a natural, warm voice.',
  },
  {
    icon: 'mdi-clipboard-text-clock-outline',
    title: 'Full call summary, instantly',
    description: 'Name, callback number, job details, and a full transcript land in your dashboard the moment the call ends.',
  },
  {
    icon: 'mdi-domain',
    title: 'One dashboard, every business',
    description: 'Running more than one line or brand? Each number routes to its own script, voice, and knowledge base.',
  },
  {
    icon: 'mdi-account-hard-hat-outline',
    title: 'Built for people on the job',
    description: 'Handles real call patterns - declined details, callback requests, "can I speak to someone" - the way an experienced front-desk person would.',
  },
]

const steps = [
  {
    title: 'Caller dials your number',
    description: 'Nothing changes for your customers - same number, no new hardware to install.',
  },
  {
    title: 'VoiceAI has the conversation',
    description: "Greets them, answers from your business's own info, and takes down what's needed.",
  },
  {
    title: 'You get the summary',
    description: 'A ready-to-action call log lands in your dashboard - caller info, transcript, and outcome.',
  },
]
</script>

<style scoped>
.step-number {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  background: var(--brand-gradient);
  color: #fff;
}

.cta-band {
  background: var(--brand-gradient);
}
</style>
