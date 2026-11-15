<template>
  <div>
    <div class="d-flex align-center mb-6">
      <div>
        <h1 class="text-h5 font-weight-bold">
          Call Log #{{ route.params.id }}
        </h1>
        <p class="text-body-2 text-medium-emphasis">
          Full transcript and usage for this call.
        </p>
      </div>

      <v-spacer />

      <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/dashboard/call-logs">
        Back to list
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" class="mb-4">
      {{ error }}
    </v-alert>

    <template v-if="callLog">
      <v-card class="mb-4" variant="outlined">
        <v-card-title class="d-flex align-center ga-2">
          <v-icon icon="mdi-information-outline" color="primary" />
          Summary
        </v-card-title>

        <v-card-text>
          <v-row>
            <v-col cols="12" md="4">
              <strong>Business:</strong> {{ callLog.business?.name ?? '-' }}
            </v-col>
            <v-col cols="12" md="4">
              <strong>Caller number:</strong> {{ callLog.caller_number ?? 'unknown' }}
            </v-col>
            <v-col cols="12" md="4">
              <strong>Call type:</strong>
              <v-chip v-if="callLog.call_type" size="small" color="primary" variant="tonal" class="ml-1">
                {{ callLog.call_type }}
              </v-chip>
              <span v-else>-</span>
            </v-col>
            <v-col cols="12" md="4">
              <strong>Started:</strong> {{ formatDate(callLog.started_at) }}
            </v-col>
            <v-col cols="12" md="4">
              <strong>Ended:</strong> {{ formatDate(callLog.ended_at) }}
            </v-col>
            <v-col cols="12" md="4">
              <strong>Callback number:</strong> {{ callLog.callback_number ?? '-' }}
            </v-col>
            <v-col cols="12">
              <strong>Caller name:</strong> {{ callLog.caller_name ?? '-' }}
            </v-col>
            <v-col cols="12" md="4">
              <strong>Postcode:</strong> {{ callLog.postcode ?? '-' }}
            </v-col>
            <v-col cols="12">
              <strong>Address:</strong> {{ callLog.address ?? '-' }}
            </v-col>
            <v-col cols="12">
              <strong>Message:</strong> {{ callLog.message ?? '-' }}
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <v-card class="mb-4" variant="outlined">
        <v-card-title class="d-flex align-center ga-2">
          <v-icon icon="mdi-message-text-outline" color="primary" />
          Raw transcript
        </v-card-title>

        <v-card-text>
          <div v-if="!callLog.raw_transcript?.length" class="text-medium-emphasis">
            No transcript recorded.
          </div>

          <div v-for="(turn, index) in callLog.raw_transcript" :key="index" class="transcript-turn" :class="`transcript-turn--${turn.role}`">
            <v-avatar size="28" :color="turn.role === 'user' ? 'secondary' : 'primary'" variant="tonal" class="mr-2">
              <v-icon :icon="turn.role === 'user' ? 'mdi-account' : 'mdi-robot-outline'" size="16" />
            </v-avatar>
            <div>
              <div class="text-caption text-medium-emphasis">
                {{ turn.role === 'user' ? 'Caller' : 'Assistant' }}
              </div>
              {{ turn.text }}
            </div>
          </div>
        </v-card-text>
      </v-card>

      <v-card variant="outlined">
        <v-card-title class="d-flex align-center ga-2">
          <v-icon icon="mdi-chart-box-outline" color="primary" />
          Usage on this call
        </v-card-title>

        <v-card-text>
          <v-row>
            <v-col cols="12" md="4">
              LLM prompt tokens: {{ callLog.llm_prompt_tokens ?? 0 }}
            </v-col>
            <v-col cols="12" md="4">
              LLM completion tokens: {{ callLog.llm_completion_tokens ?? 0 }}
            </v-col>
            <v-col cols="12" md="4">
              TTS characters: {{ callLog.tts_characters ?? 0 }}
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/services/api'

type TranscriptTurn = { role: 'user' | 'assistant', text: string, at: string }

type CallLog = {
  id: number
  business?: { id: number, name: string }
  caller_number: string | null
  caller_name: string | null
  callback_number: string | null
  postcode: string | null
  address: string | null
  message: string | null
  call_type: string | null
  started_at: string | null
  ended_at: string | null
  raw_transcript: TranscriptTurn[] | null
  llm_prompt_tokens: number | null
  llm_completion_tokens: number | null
  tts_characters: number | null
}

const route = useRoute()
const callLog = ref<CallLog | null>(null)
const error = ref<string | null>(null)

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '-'
}

onMounted(async () => {
  try {
    const res = await api.get<CallLog>(`/call-logs/${route.params.id}`)
    callLog.value = res.data
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? 'Failed to load call log.'
  }
})
</script>

<style scoped>
.transcript-turn {
  display: flex;
  align-items: flex-start;
  padding: 8px 0;
}

.transcript-turn + .transcript-turn {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
