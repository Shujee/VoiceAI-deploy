<template>
  <div
    class="aurora"
    :class="`aurora--${variant}`"
  >
    <span class="aurora__blob aurora__blob--1" />
    <span class="aurora__blob aurora__blob--2" />
    <span class="aurora__blob aurora__blob--3" />
  </div>
</template>

<script setup lang="ts">
// Animated CSS-only background (see .aurora* rules in styles/global.scss) -
// used behind the marketing hero ('hero', full-bleed) and the login page's
// branded side panel ('panel', smaller/subtler). Chosen over a video
// background: no asset to source/license, loads instantly, and re-themes
// automatically from the brand CSS variables.
withDefaults(defineProps<{ variant?: 'hero' | 'panel' }>(), { variant: 'hero' })
</script>
