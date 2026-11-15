<template>
  <div>
    <div class="d-flex align-center mb-6">
      <div>
        <h1 class="text-h5 font-weight-bold">
          Businesses
        </h1>
        <p class="text-body-2 text-medium-emphasis">
          Every business currently live on your VoiceAI lines.
        </p>
      </div>

      <v-spacer />

      <!-- Re-enabled 2026-10-14 alongside the AnswerPoint sync (see
           BusinessController::store()). -->
      <v-btn color="primary" variant="tonal" prepend-icon="mdi-plus" class="me-2"
        :to="'/dashboard/businesses/new'">
        New business
      </v-btn>

      <v-btn
        color="primary"
        prepend-icon="mdi-sync"
        :loading="syncing"
        @click="handleSync"
      >
        Sync from AnswerPoint
      </v-btn>
    </div>

    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
    >
      {{ error }}
    </v-alert>

    <v-alert
      v-if="syncResult"
      type="success"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="syncResult = null"
    >
      Synced from AnswerPoint: {{ syncResult.created }} new, {{ syncResult.updated }} updated,
      {{ syncResult.phones_added }} phone number(s) added, {{ syncResult.phones_removed }} deactivated.
    </v-alert>

    <v-card variant="outlined">
      <v-data-table
        :headers="headers"
        :items="businesses"
        :loading="loading"
        item-value="id"
      >
        <template #item.name="{ item }">
          <div class="d-flex align-center ga-3 py-2">
            <v-avatar
              color="primary"
              variant="tonal"
              size="36"
            >
              <span class="text-caption font-weight-bold">{{ item.name.slice(0, 2).toUpperCase() }}</span>
            </v-avatar>
            <span class="font-weight-medium">{{ item.name }}</span>
          </div>
        </template>

        <template #item.source="{ item }">
          <!-- Distinguishes the demo-seeded/manually-created businesses
               (no answerpoint_client_id) from real ones pulled in by
               AnswerPointClientSync - so it's obvious at a glance which
               rows the client will actually recognize as their own. -->
          <v-chip
            v-if="item.answerpoint_client_id"
            size="small"
            color="primary"
            variant="tonal"
          >
            Synced
          </v-chip>
          <v-chip
            v-else
            size="small"
            variant="tonal"
          >
            Local
          </v-chip>
        </template>

        <template #item.status="{ item }">
          <v-chip
            size="small"
            :color="item.status === 'active' ? 'success' : 'default'"
            variant="tonal"
          >
            {{ item.status }}
          </v-chip>
        </template>

        <template #item.voice_id="{ item }">
          {{ item.voice_id ?? '(default)' }}
        </template>

        <template #item.phone_numbers="{ item }">
          <span v-if="item.phone_numbers?.length">
            {{ item.phone_numbers.filter((p: PhoneNumber) => p.is_active).map((p: PhoneNumber) => p.number).join(', ') || 'none active' }}
          </span>
          <span
            v-else
            class="text-medium-emphasis"
          >none assigned</span>
        </template>

        <template #item.actions="{ item }">
          <v-btn
            icon="mdi-pencil"
            variant="text"
            size="small"
            :to="`/dashboard/businesses/${item.id}`"
          />
          <v-btn
            icon="mdi-delete"
            variant="text"
            size="small"
            @click="handleDelete(item)"
          />
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/services/api'

type PhoneNumber = {
  id: number
  number: string
  label: string | null
  is_active: boolean
}

type Business = {
  id: number
  name: string
  slug: string
  voice_id: string | null
  answerpoint_client_id: number | null
  status: 'active' | 'inactive'
  phone_numbers?: PhoneNumber[]
}

type SyncResult = {
  created: number
  updated: number
  phones_added: number
  phones_removed: number
}

const businesses = ref<Business[]>([])
const loading = ref(false)
const syncing = ref(false)
const error = ref<string | null>(null)
const syncResult = ref<SyncResult | null>(null)

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Source', key: 'source', sortable: false },
  { title: 'Status', key: 'status' },
  { title: 'Slug', key: 'slug' },
  { title: 'Voice', key: 'voice_id' },
  { title: 'Phone numbers', key: 'phone_numbers' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
]

async function loadBusinesses() {
  loading.value = true
  error.value = null

  try {
    const res = await api.get<Business[]>('/businesses')
    businesses.value = res.data
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? 'Failed to load businesses.'
  } finally {
    loading.value = false
  }
}

async function handleSync() {
  syncing.value = true
  error.value = null
  syncResult.value = null

  try {
    const res = await api.post<SyncResult>('/businesses/sync-answerpoint')
    syncResult.value = res.data
    await loadBusinesses()
  } catch (err: any) {
    // Most likely cause right now: ANSWERPOINT_CLIENTS_URL isn't
    // configured yet (the endpoint was requested from AnswerPoint's team
    // 2026-09-17, not yet received) - AnswerPointClient::fetchClients()
    // throws a message that says exactly that, surfaced here as-is.
    error.value = err?.response?.data?.message ?? 'Failed to sync from AnswerPoint.'
  } finally {
    syncing.value = false
  }
}

async function handleDelete(business: Business) {
  if (!confirm(`Delete "${business.name}"? This cannot be undone.`))
    return

  try {
    await api.delete(`/businesses/${business.id}`)
    await loadBusinesses()
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? 'Failed to delete business.'
  }
}

onMounted(loadBusinesses)
</script>
