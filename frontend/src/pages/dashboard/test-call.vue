<template>
  <div>
    <div class="mb-6">
      <h1 class="text-h5 font-weight-bold">
        Test Call
      </h1>
      <p class="text-body-2 text-medium-emphasis">
        Connect to a LiveKit test room from the browser to sanity-check the
        voice pipeline without placing a real phone call.
      </p>
    </div>

    <LiveKitTest />
  </div>
</template>

<script setup lang="ts">
// Moved here from the old root page (pages/index.vue, now the marketing
// landing page) as part of the dashboard build - the component itself is
// unchanged, just its nav location ("Test Call" in the dashboard drawer
// instead of the site root).
import LiveKitTest from '@/components/LiveKitTest.vue'
</script>
