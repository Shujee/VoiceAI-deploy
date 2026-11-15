import { AudioFrame } from '@livekit/rtc-node'

export interface ISTT {
  pushAudio(frame: AudioFrame): void
  close(): Promise<void>
}