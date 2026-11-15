<template>
  <div>
    <div class="mb-6">
      <h1 class="text-h5 font-weight-bold">
        Usage &amp; estimated cost
      </h1>
      <p class="text-body-2 text-medium-emphasis">
        Self-tracked spend estimates across your voice and language providers.
      </p>
    </div>

    <v-alert
      type="info"
      variant="tonal"
      class="mb-4"
    >
      Neither Groq nor Rime provide a live "remaining credit" API, so these
      figures are a self-tracked estimate: our own logged usage multiplied by
      each provider's published per-unit price. Check the linked dashboard
      below for the actual account balance.
    </v-alert>

    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
    >
      {{ error }}
    </v-alert>

    <v-row v-if="usage">
      <v-col cols="12" sm="6" md="3">
        <v-card class="pa-5" variant="outlined">
          <div class="text-caption text-medium-emphasis mb-1">
            Logged calls
          </div>
          <div class="text-h4 font-weight-bold">
            {{ usage.call_count.toLocaleString() }}
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" sm="6" md="3">
        <v-card class="pa-5" variant="outlined">
          <div class="text-caption text-medium-emphasis mb-1">
            Groq spend
          </div>
          <div class="text-h4 font-weight-bold gradient-text">
            ${{ usage.groq.estimated_cost_usd.toFixed(2) }}
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" sm="6" md="3">
        <v-card class="pa-5" variant="outlined">
          <div class="text-caption text-medium-emphasis mb-1">
            Rime spend
          </div>
          <div class="text-h4 font-weight-bold gradient-text">
            ${{ usage.rime.estimated_cost_usd.toFixed(2) }}
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" sm="6" md="3">
        <v-card class="pa-5" variant="outlined">
          <div class="text-caption text-medium-emphasis mb-1">
            Combined spend
          </div>
          <div class="text-h4 font-weight-bold gradient-text">
            ${{ (usage.groq.estimated_cost_usd + usage.rime.estimated_cost_usd).toFixed(2) }}
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card variant="outlined">
          <v-card-title class="d-flex align-center ga-2">
            <v-icon icon="mdi-message-text-outline" color="primary" />
            Groq ({{ usage.groq.model }})
          </v-card-title>

          <v-card-text>
            <p>Prompt tokens: {{ usage.groq.prompt_tokens.toLocaleString() }}</p>
            <p>Completion tokens: {{ usage.groq.completion_tokens.toLocaleString() }}</p>
            <p class="text-h6 mt-2">
              Estimated spend: ${{ usage.groq.estimated_cost_usd.toFixed(4) }}
            </p>
          </v-card-text>

          <v-card-actions>
            <v-btn
              :href="usage.groq.dashboard_url"
              target="_blank"
              variant="text"
              color="primary"
              append-icon="mdi-open-in-new"
            >
              Open Groq billing dashboard
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card variant="outlined">
          <v-card-title class="d-flex align-center ga-2">
            <v-icon icon="mdi-waveform" color="primary" />
            Rime ({{ usage.rime.model }})
          </v-card-title>

          <v-card-text>
            <p>Characters synthesized: {{ usage.rime.characters.toLocaleString() }}</p>
            <p class="text-h6 mt-2">
              Estimated spend: ${{ usage.rime.estimated_cost_usd.toFixed(4) }}
            </p>
          </v-card-text>

          <v-card-actions>
            <v-btn
              :href="usage.rime.dashboard_url"
              target="_blank"
              variant="text"
              color="primary"
              append-icon="mdi-open-in-new"
            >
              Open Rime billing dashboard
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/services/api'

type UsageSummary = {
  call_count: number
  groq: {
    model: string
    prompt_tokens: number
    completion_tokens: number
    estimated_cost_usd: number
    dashboard_url: string
  }
  rime: {
    model: string
    characters: number
    estimated_cost_usd: number
    dashboard_url: string
  }
}

const usage = ref<UsageSummary | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const res = await api.get<UsageSummary>('/usage/summary')
    usage.value = res.data
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? 'Failed to load usage summary.'
  }
})
</script>
