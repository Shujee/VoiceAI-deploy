<template>
  <router-link
    :to="to"
    class="brand-logo"
  >
    <svg
      viewBox="0 0 40 40"
      class="brand-logo__mark"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          :id="gradientId"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop
            offset="0%"
            stop-color="#4F46E5"
          />
          <stop
            offset="100%"
            stop-color="#7C3AED"
          />
        </linearGradient>
      </defs>
      <rect
        width="40"
        height="40"
        rx="11"
        :fill="inverted ? 'rgba(255,255,255,0.16)' : `url(#${gradientId})`"
      />
      <rect x="9" y="17" width="3.4" height="6" rx="1.7" fill="white" />
      <rect x="15" y="12" width="3.4" height="16" rx="1.7" fill="white" />
      <rect x="21" y="8" width="3.4" height="24" rx="1.7" fill="white" />
      <rect x="27" y="14" width="3.4" height="12" rx="1.7" fill="white" />
    </svg>

    <span
      v-if="showWordmark"
      class="brand-logo__wordmark"
      :class="{ 'brand-logo__wordmark--inverted': inverted }"
    >Voice<span :class="inverted ? 'brand-logo__accent--inverted' : 'gradient-text'">AI</span></span>
  </router-link>
</template>

<script setup lang="ts">
// Reusable brand mark used on the marketing nav/footer, the login page, and
// the dashboard app bar - replaces the old default Vuetify logo.svg (the
// stock "V" mark from the project scaffold, not an actual VoiceAI brand
// asset). `inverted` renders it for dark/glass backgrounds (hero, login
// side panel); default renders for light surfaces (dashboard app bar,
// marketing nav on scroll).
const { to = '/', inverted = false, showWordmark = true } = defineProps<{
  to?: string
  inverted?: boolean
  showWordmark?: boolean
}>()

// Unique per-render id so two logos on the same page (e.g. nav + footer)
// don't collide on the same <linearGradient id="...">, which in some
// browsers makes every instance after the first render solid black.
const gradientId = `brand-logo-gradient-${Math.random().toString(36).slice(2, 9)}`
</script>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}

.brand-logo__mark {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
}

.brand-logo__wordmark {
  font-family: 'Plus Jakarta Sans', 'Roboto', sans-serif;
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
}

/* Resolved entirely in this component's own stylesheet rather than via
   Vuetify's `text-white` utility class - that utility lives in a CSS
   @layer (see public/layers.css), and this file's plain, unlayered
   `.brand-logo__wordmark` rule above was silently winning over it
   regardless of which class order/specificity looked "right" on paper,
   leaving the wordmark in dark on-surface text on the login page's dark
   side panel. A same-file, higher-specificity override has no layer to
   lose to. */
.brand-logo__wordmark.brand-logo__wordmark--inverted {
  color: #fff;
}

.brand-logo__accent--inverted {
  color: #fff;
}
</style>
