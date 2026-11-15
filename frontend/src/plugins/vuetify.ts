/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 *
 * VoiceAI brand theme (2026-09-14 facelift): indigo/violet primary, plus
 * matching light/dark palettes so the pre-existing `defaultTheme: 'system'`
 * behavior (follow the OS) still works instead of forcing one mode. `defaults`
 * below rounds cards/buttons and switches every text field to the outlined,
 * comfortable-density look globally, so the dashboard's existing form pages
 * (businesses/[id].vue etc.) pick up the new look without editing each field.
 *
 * Every custom color below has its matching 'on-<color>' text color set
 * explicitly (2026-09-14 fix). The first cut of this theme only overrode
 * the swatches themselves (primary/secondary/background/surface/
 * surface-variant) and left their paired text colors on Vuetify's
 * built-in defaults - those defaults were tuned for VUETIFY'S OWN stock
 * swatches, not these, so several combinations ended up low-contrast or
 * flatly wrong (e.g. dark text on the dark-theme surface-variant panels
 * used on the landing/about pages' "how it works"/"values" sections).
 * Whenever a color is customized here, its 'on-' companion is customized
 * alongside it, rather than left to inherit a mismatched default.
 */

// Composables
import { createVuetify } from 'vuetify'
// Styles
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

const brand = {
  indigo: '#4F46E5',
  indigoDark: '#4338CA',
  violet: '#7C3AED',
  violetDark: '#6D28D9',
}

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    defaultTheme: 'system',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: brand.indigo,
          'primary-darken-1': brand.indigoDark,
          'on-primary': '#FFFFFF',
          secondary: brand.violet,
          'secondary-darken-1': brand.violetDark,
          'on-secondary': '#FFFFFF',
          background: '#F7F7FC',
          'on-background': '#1B1B2A',
          surface: '#FFFFFF',
          'on-surface': '#1B1B2A',
          'surface-bright': '#FFFFFF',
          'surface-variant': '#EDEBFB',
          'on-surface-variant': '#332E55',
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#818CF8',
          'primary-darken-1': brand.indigo,
          'on-primary': '#161327',
          secondary: '#A78BFA',
          'secondary-darken-1': brand.violet,
          'on-secondary': '#1B1533',
          background: '#0B0A17',
          'on-background': '#F2F1FA',
          surface: '#141225',
          'on-surface': '#F2F1FA',
          'surface-bright': '#1B1830',
          'surface-variant': '#241F3D',
          'on-surface-variant': '#DCD8F5',
        },
      },
    },
  },
  defaults: {
    VCard: { rounded: 'lg' },
    VBtn: { rounded: 'lg' },
    VTextField: { variant: 'outlined', density: 'comfortable' },
    VSelect: { variant: 'outlined', density: 'comfortable' },
    VTextarea: { variant: 'outlined', density: 'comfortable' },
  },
})
