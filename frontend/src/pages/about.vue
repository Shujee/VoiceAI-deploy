<template>
  <div>
    <div class="page-header">
      <p class="section-eyebrow">
        About VoiceAI
      </p>
      <h1 class="page-header__title mx-auto">
        Built for people who are too busy doing the work to also answer the phone.
      </h1>
      <p class="page-header__subtitle mx-auto">
        VoiceAI started with a simple, frustrating problem: tradespeople miss
        calls while they're up a ladder, under a driveway, or mid-job - and
        every missed call is a missed quote.
      </p>
    </div>

    <v-container
      class="py-8"
      style="max-width: 860px;"
    >
      <p class="text-body-1 mb-6">
        Most small and mid-sized service businesses - roofers, driveway and
        paving crews, general contractors, construction firms - run on the
        phone. But whoever normally answers it is also the person doing the
        work, so calls go to voicemail, and voicemail rarely gets a call
        back before the customer has already rung the next name on the list.
      </p>

      <p class="text-body-1 mb-6">
        VoiceAI answers instead. It has a real, natural conversation with
        the caller - not a phone tree - using your business's own hours,
        pricing, and policies, and hands you a clean summary the moment the
        call ends: who called, what they need, and a callback number.
      </p>

      <p class="text-body-1">
        Every business on the platform gets its own voice, its own
        knowledge base, and its own number - so if you run more than one
        brand or crew, each line sounds and behaves exactly the way you've
        set it up, all from one dashboard.
      </p>
    </v-container>

    <v-sheet
      color="surface-variant"
      class="py-16"
    >
      <v-container style="max-width: 1180px;">
        <div class="text-center mb-10">
          <p class="section-eyebrow">
            What we care about
          </p>
          <h2 class="page-header__title mx-auto" style="margin-top: 8px;">
            A few things we don't compromise on
          </h2>
        </div>

        <v-row>
          <v-col
            v-for="value in values"
            :key="value.title"
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
                  :icon="value.icon"
                  size="26"
                />
              </v-avatar>

              <h3 class="text-h6 font-weight-bold mb-2">
                {{ value.title }}
              </h3>

              <p class="text-body-2 text-medium-emphasis">
                {{ value.description }}
              </p>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </v-sheet>

    <v-container
      class="text-center py-16"
      style="max-width: 640px;"
    >
      <h2 class="text-h4 font-weight-bold mb-4">
        Want to hear it for yourself?
      </h2>
      <p class="text-body-1 text-medium-emphasis mb-8">
        We'll set up a live line for your business so you can hear VoiceAI
        handle a real call before you commit to anything.
      </p>
      <v-btn
        size="x-large"
        color="primary"
        to="/contact"
      >
        Get a demo
      </v-btn>
    </v-container>
  </div>
</template>

<script setup lang="ts">
const values = [
  {
    icon: 'mdi-phone-check-outline',
    title: 'Answers every time',
    description: 'No downtime excuses. If the line rings, VoiceAI is there to take it.',
  },
  {
    icon: 'mdi-chat-processing-outline',
    title: 'Sounds like a real person',
    description: "Natural, warm conversation - not a menu of 'press 1 for sales'.",
  },
  {
    icon: 'mdi-waveform',
    title: 'Refined against real calls',
    description: "Every workflow is tuned against real recorded calls, not guesswork about how people actually talk.",
  },
  {
    icon: 'mdi-tune-variant',
    title: 'Your business, your rules',
    description: 'Voice, hours, pricing, and policies are fully configurable per business, per number.',
  },
]
</script>
