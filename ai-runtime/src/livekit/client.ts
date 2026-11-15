import { Room } from '@livekit/rtc-node'
import { createToken } from './token.js'

export async function connect() {
  const room = new Room()

  await room.connect(
    process.env.LIVEKIT_URL!,
    await createToken('voiceai-runtime'),
  )

  console.log(`Connected to room: ${room.name}`)

  room.on('participantConnected', participant => {
    console.log(`Participant joined: ${participant.identity}`)
  })

  room.on('participantDisconnected', participant => {
    console.log(`Participant left: ${participant.identity}`)
  })

  return room
}