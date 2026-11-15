import { LiveKitTransport } from '../providers/livekit/LiveKitTransport.js'

export const services = {
  voiceTransport: new LiveKitTransport(),
}