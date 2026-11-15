<template>
  <div>
    <div class="d-flex align-center mb-6">
      <div>
        <h1 class="text-h5 font-weight-bold">
          {{ isNew ? 'New business' : `Edit ${form.name || 'business'}` }}
        </h1>
        <p class="text-body-2 text-medium-emphasis">
          Voice, knowledge base, and phone numbers for this business.
        </p>
      </div>

      <v-spacer />

      <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/dashboard/businesses">
        Back to list
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" class="mb-4">
      {{ error }}
    </v-alert>

    <v-card class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon icon="mdi-domain" color="primary" />
        Details
      </v-card-title>

      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.name" label="Name" required />
          </v-col>

          <v-col cols="12" md="6">
            <v-text-field v-model="form.slug" label="Slug (used by the phone system to load this business)"
              hint="lowercase, no spaces - e.g. acme-plumbing" persistent-hint required />
          </v-col>
        </v-row>

        <div class="d-flex align-center ga-2">
          <v-select v-model="form.voice_id" :items="voiceItems" item-title="label" item-value="id" label="Voice" clearable
            hint="Leave blank to use the system default voice." persistent-hint class="flex-grow-1" />

          <v-btn icon variant="tonal" color="primary" :disabled="!form.voice_id" :loading="previewingVoice"
            class="mb-6" @click="playVoicePreview">
            <v-icon icon="mdi-play" />
          </v-btn>
        </div>

        <v-select v-model="form.prompt_style" :items="promptStyleItems" item-title="label" item-value="value"
          label="Receptionist instructions" persistent-hint
          hint="Standard: detailed scenario-by-scenario rules. Compact: short principles only (trial)." class="mb-4" />

        <v-textarea v-model="form.services" label="Services" rows="2" auto-grow />

        <v-textarea v-model="form.hours" label="Hours" rows="2" auto-grow />

        <v-textarea v-model="form.pricing" label="Pricing" rows="2" auto-grow />

        <v-textarea v-model="form.policies" label="Policies" rows="2" auto-grow />
      </v-card-text>
    </v-card>

    <v-card class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon icon="mdi-cloud-sync-outline" color="primary" />
        AnswerPoint (legacy system)
      </v-card-title>

      <v-card-text>
        <v-switch v-model="form.answerpoint_push_enabled" color="primary" label="Push call logs to AnswerPoint" density="comfortable" inset
          hint="Off by default - our dashboard is the only place to check call logs unless this is turned on for this business."
          persistent-hint />
      </v-card-text>
    </v-card>

    <v-card class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-help-circle-outline" color="primary" class="mr-2" />
        FAQ
        <v-spacer />
        <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-plus" @click="form.faq.push({ question: '', answer: '' })">
          Add
        </v-btn>
      </v-card-title>

      <v-card-text>
        <v-row v-for="(entry, index) in form.faq" :key="index">
          <v-col cols="12" md="5">
            <v-textarea v-model="entry.question" label="Question" density="compact" rows="1" auto-grow />
          </v-col>
          <v-col cols="12" md="6">
            <v-textarea v-model="entry.answer" label="Answer" density="compact" rows="1" auto-grow />
          </v-col>
          <v-col cols="12" md="1" class="d-flex align-center">
            <v-btn icon="mdi-delete" variant="text" size="small" @click="form.faq.splice(index, 1)" />
          </v-col>
        </v-row>

        <p v-if="!form.faq.length" class="text-medium-emphasis">
          No FAQ entries yet.
        </p>
      </v-card-text>
    </v-card>

    <v-card class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-package-variant-closed" color="primary" class="mr-2" />
        Products
        <v-spacer />
        <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-plus"
          @click="form.products.push({ name: '', price: '', availability: '' })">
          Add
        </v-btn>
      </v-card-title>

      <v-card-text>
        <v-row v-for="(product, index) in form.products" :key="index">
          <v-col cols="12" md="4">
            <v-text-field v-model="product.name" label="Name" density="compact" />
          </v-col>
          <v-col cols="6" md="3">
            <v-text-field v-model="product.price" label="Price" density="compact" />
          </v-col>
          <v-col cols="6" md="4">
            <v-textarea v-model="product.availability" label="Availability" density="compact" rows="1" auto-grow />
          </v-col>
          <v-col cols="12" md="1" class="d-flex align-center">
            <v-btn icon="mdi-delete" variant="text" size="small" @click="form.products.splice(index, 1)" />
          </v-col>
        </v-row>

        <p v-if="!form.products.length" class="text-medium-emphasis">
          No products yet.
        </p>
      </v-card-text>
    </v-card>

    <v-card v-if="!isNew" class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon icon="mdi-phone-outline" color="primary" />
        Phone numbers
      </v-card-title>

      <v-card-text>
        <v-row v-for="number in phoneNumbers" :key="number.id" align="center">
          <v-col cols="4">
            {{ number.number }}
          </v-col>
          <v-col cols="4">
            {{ number.label ?? '-' }}
          </v-col>
          <v-col cols="2">
            <v-chip :color="number.is_active ? 'success' : 'default'" size="small">
              {{ number.is_active ? 'active' : 'inactive' }}
            </v-chip>
          </v-col>
          <v-col cols="2">
            <v-btn icon="mdi-delete" variant="text" size="small" @click="deletePhoneNumber(number)" />
          </v-col>
        </v-row>

        <p v-if="!phoneNumbers.length" class="text-medium-emphasis mb-4">
          No phone numbers assigned yet.
        </p>

        <v-row>
          <v-col cols="4">
            <v-text-field v-model="newNumber.number" label="New number" density="compact" placeholder="+15551234567" />
          </v-col>
          <v-col cols="4">
            <v-text-field v-model="newNumber.label" label="Label (optional)" density="compact" />
          </v-col>
          <v-col cols="4">
            <v-btn prepend-icon="mdi-plus" @click="addPhoneNumber">
              Add number
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-btn color="primary" size="large" :loading="saving" @click="handleSave">
      {{ isNew ? 'Create business' : 'Save changes' }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/services/api'

type FaqEntry = { question: string, answer: string }
type Product = { name: string, price: string, availability: string }
type PhoneNumber = { id: number, business_id: number, number: string, label: string | null, is_active: boolean }
type Voice = { id: string, name: string, description: string }

// Mirrors CartesiaTTS.ts's CARTESIA_VOICE_ID_PATTERN (ai-runtime) - some
// businesses' voice_id column still holds a pre-2026-09-02 Rime voice
// name (e.g. 'beatty', 'vashti') left over from before the Cartesia
// switch. ai-runtime already silently falls back to Gemma for an actual
// call when it sees one of these, but the dashboard's own voiceItems
// list only has real Cartesia ids in it - matching Vuetify's v-select
// looked up nothing and just showed the raw stored string as if it were
// a real selection instead of falling back to "no voice picked" like it
// should. Guarding here so loadBusiness() shows this business as having
// no voice selected (matching what a call actually does) instead of a
// confusing stray value nothing in the picker recognizes.
const CARTESIA_VOICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const route = useRoute()
const router = useRouter()

const isNew = computed(() => route.params.id === 'new')
const businessId = computed(() => (isNew.value ? null : Number(route.params.id)))

const promptStyleItems = [
  { value: 'standard', label: 'Standard' },
  { value: 'compact', label: 'Compact (trial)' },
]

const form = reactive({
  name: '',
  slug: '',
  voice_id: null as string | null,
  prompt_style: 'standard',
  answerpoint_push_enabled: false,
  services: '',
  hours: '',
  pricing: '',
  policies: '',
  faq: [] as FaqEntry[],
  products: [] as Product[],
})

const voices = ref<Voice[]>([])
const voiceItems = computed(() => voices.value.map(v => ({ id: v.id, label: `${v.name} - ${v.description}` })))

const phoneNumbers = ref<PhoneNumber[]>([])
const newNumber = reactive({ number: '', label: '' })

const error = ref<string | null>(null)
const saving = ref(false)
const previewingVoice = ref(false)

// Fetches a fresh short sample clip for the currently-picked voice
// (backend proxies to ai-runtime, which is the only place holding the
// Cartesia API key - see VoiceController::preview()) and plays it via a
// throwaway Audio element. No caching on either end - the admin clicks
// this rarely enough that regenerating each time isn't worth the extra
// moving parts, and it also means the sample always reflects however
// Cartesia's own voice happens to sound right now.
async function playVoicePreview() {
  if (!form.voice_id || previewingVoice.value)
    return

  previewingVoice.value = true
  error.value = null

  try {
    const res = await api.get(`/voices/${form.voice_id}/preview`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data as Blob)
    const audio = new Audio(url)

    // Revoke once playback actually finishes (or fails) rather than
    // right after creating it - the blob URL has to stay valid for the
    // whole clip.
    audio.addEventListener('ended', () => URL.revokeObjectURL(url))
    audio.addEventListener('error', () => URL.revokeObjectURL(url))

    await audio.play()
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? 'Failed to play voice preview.'
  } finally {
    previewingVoice.value = false
  }
}

async function loadVoices() {
  const res = await api.get<Voice[]>('/voices')
  voices.value = res.data
}

async function loadBusiness() {
  if (isNew.value || !businessId.value)
    return

  const res = await api.get(`/businesses/${businessId.value}`)
  const business = res.data

  form.name = business.name
  form.slug = business.slug
  form.voice_id = CARTESIA_VOICE_ID_PATTERN.test(business.voice_id ?? '') ? business.voice_id : null
  form.answerpoint_push_enabled = business.answerpoint_push_enabled ?? false
  form.prompt_style = business.prompt_style ?? 'standard'
  form.services = business.services ?? ''
  form.hours = business.hours ?? ''
  form.pricing = business.pricing ?? ''
  form.policies = business.policies ?? ''
  form.faq = business.faq ?? []
  form.products = business.products ?? []
  phoneNumbers.value = business.phone_numbers ?? []
}

async function handleSave() {
  saving.value = true
  error.value = null

  const payload = {
    name: form.name,
    slug: form.slug,
    voice_id: form.voice_id,
    prompt_style: form.prompt_style,
    answerpoint_push_enabled: form.answerpoint_push_enabled,
    services: form.services || null,
    hours: form.hours || null,
    pricing: form.pricing || null,
    policies: form.policies || null,
    faq: form.faq.filter(f => f.question || f.answer),
    products: form.products.filter(p => p.name),
  }

  try {
    if (isNew.value) {
      const res = await api.post('/businesses', payload)
      router.push(`/dashboard/businesses/${res.data.id}`)
    } else {
      await api.put(`/businesses/${businessId.value}`, payload)
      await loadBusiness()
    }
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? 'Failed to save business - check the fields above.'
  } finally {
    saving.value = false
  }
}

async function addPhoneNumber() {
  if (!newNumber.number || !businessId.value)
    return

  try {
    const res = await api.post('/phone-numbers', {
      business_id: businessId.value,
      number: newNumber.number,
      label: newNumber.label || null,
    })

    phoneNumbers.value.push(res.data)
    newNumber.number = ''
    newNumber.label = ''
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? 'Failed to add phone number - it may already be assigned.'
  }
}

async function deletePhoneNumber(number: PhoneNumber) {
  if (!confirm(`Remove ${number.number}?`))
    return

  await api.delete(`/phone-numbers/${number.id}`)
  phoneNumbers.value = phoneNumbers.value.filter(n => n.id !== number.id)
}

onMounted(async () => {
  // /dashboard/businesses/new is the create form again (re-enabled
  // 2026-10-14, see BusinessController::store()); loadBusiness() skips it.
  await loadVoices()
  await loadBusiness()
})
</script>
