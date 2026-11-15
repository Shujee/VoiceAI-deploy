<template>
  <v-card class="pa-4">
    <v-card-title>LiveKit Test</v-card-title>

    <v-card-text>
      <div>Status: {{ status }}</div>
      <div v-if="roomName">Room: {{ roomName }}</div>
    </v-card-text>

    <v-card-actions>
      <v-btn :disabled="connected || connecting" @click="connect">
        {{ connecting ? 'Connecting...' : 'Connect' }}
      </v-btn>

      <v-btn :disabled="!connected" @click="disconnect">
        Disconnect
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { Room, setLogLevel, LogLevel } from 'livekit-client'
import api from '@/services/api'
import { connectToLiveKit } from '@/services/livekit'

setLogLevel(LogLevel.debug)

const identity = `browser-${Math.random().toString(36).slice(2, 8)}`
const roomName = 'test-room'
const liveKitUrl = import.meta.env.VITE_LIVEKIT_URL ?? 'ws://localhost:7880'

const status = ref('Disconnected')
const connecting = ref(false)
const connected = ref(false)

let room: Room | null = null

async function connect() {
  if (room)
    return

  connecting.value = true
  status.value = 'Requesting token...'

  try {
    const response = await api.post<{ token: string }>('/livekit/token', {
      identity,
      room: roomName,
    })

    status.value = 'Connecting...'

    room = await connectToLiveKit(response.data.token, liveKitUrl)

    await room.localParticipant.setMicrophoneEnabled(true)

    console.log(
      'Published tracks:',
      Array.from(room.localParticipant.trackPublications.values()).map(
        publication => ({
          kind: publication.kind,
          source: publication.source,
          sid: publication.trackSid,
          muted: publication.isMuted,
        }),
      ),
    )

    connected.value = true
    status.value = 'Connected'
  }
  catch (error) {
    console.error(error)
    status.value = 'Connection failed'
    room = null
  }
  finally {
    connecting.value = false
  }
}

async function disconnect() {
  if (!room)
    return

  await room.disconnect()

  room = null
  connected.value = false
  status.value = 'Disconnected'
}

onBeforeUnmount(() => {
  room?.disconnect()
})
</script>