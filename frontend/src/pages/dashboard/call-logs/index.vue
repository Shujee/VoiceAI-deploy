<template>
  <div>
    <div class="mb-6">
      <h1 class="text-h5 font-weight-bold">
        Call Logs
      </h1>
      <p class="text-body-2 text-medium-emphasis">
        Every call VoiceAI has answered, across all businesses.
      </p>
    </div>

    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
    >
      {{ error }}
    </v-alert>

    <v-card class="mb-4 pa-4" variant="outlined">
      <v-select
        v-model="businessFilter"
        :items="businessItems"
        item-title="name"
        item-value="id"
        label="Filter by business"
        prepend-inner-icon="mdi-filter-variant"
        clearable
        density="compact"
        style="max-width: 320px"
        @update:model-value="loadCallLogs"
      />
    </v-card>

    <v-card variant="outlined">
      <v-data-table-server
        :headers="headers"
        :items="callLogs"
        :items-length="totalItems"
        :loading="loading"
        :items-per-page="25"
        item-value="id"
        @update:options="handleOptionsUpdate"
      >
        <template #item.business="{ item }">
          {{ item.business?.name ?? '-' }}
        </template>

        <template #item.started_at="{ item }">
          {{ item.started_at ? new Date(item.started_at).toLocaleString() : '-' }}
        </template>

        <template #item.call_type="{ item }">
          <v-chip
            v-if="item.call_type"
            size="small"
            color="primary"
            variant="tonal"
          >
            {{ item.call_type }}
          </v-chip>
          <span v-else>-</span>
        </template>

        <template #item.actions="{ item }">
          <v-btn
            icon="mdi-eye"
            variant="text"
            size="small"
            :to="`/dashboard/call-logs/${item.id}`"
          />
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/services/api'

type Business = { id: number, name: string }

type CallLog = {
  id: number
  business?: Business
  caller_number: string | null
  caller_name: string | null
  started_at: string | null
  call_type: string | null
  message: string | null
}

const callLogs = ref<CallLog[]>([])
const totalItems = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const businessFilter = ref<number | null>(null)
const businessItems = ref<Business[]>([])
const currentPage = ref(1)

const headers = [
  { title: 'Business', key: 'business' },
  { title: 'Caller', key: 'caller_number' },
  { title: 'Name', key: 'caller_name' },
  { title: 'Started', key: 'started_at' },
  { title: 'Type', key: 'call_type' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
]

async function loadBusinesses() {
  const res = await api.get<Business[]>('/businesses')
  businessItems.value = res.data
}

async function loadCallLogs() {
  loading.value = true
  error.value = null

  try {
    const res = await api.get('/call-logs', {
      params: {
        page: currentPage.value,
        ...(businessFilter.value ? { business_id: businessFilter.value } : {}),
      },
    })

    callLogs.value = res.data.data
    totalItems.value = res.data.total
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? 'Failed to load call logs.'
  } finally {
    loading.value = false
  }
}

function handleOptionsUpdate(options: { page: number }) {
  currentPage.value = options.page
  loadCallLogs()
}

onMounted(async () => {
  await loadBusinesses()
  await loadCallLogs()
})
</script>
