<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script lang="ts" setup>
// Layout (app-bar/navigation-drawer/main) now lives per-route - see
// layouts/DashboardLayout.vue and pages/login.vue - rather than fixed here,
// since the login page and the dashboard need different chrome.
</script>
