export interface IVoiceTransport {
  connect(token: string, url: string): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  publishAudio(
    pcm: Int16Array,
    signal: AbortSignal,
  ): Promise<number>
  clearAudioQueue(): void
  // Resolves when everything captured so far has actually finished
  // playing out (per the transport's own accounting), not just been
  // handed off. Also resolves immediately if clearAudioQueue() is called
  // while a wait is pending. Lets callers detect real playback-finished
  // instead of guessing from a duration + fixed guard timer.
  waitForPlayout(): Promise<void>
}