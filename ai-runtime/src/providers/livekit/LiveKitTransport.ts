import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RemoteParticipant,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
} from '@livekit/rtc-node'

import { IVoiceTransport } from '../../voice/IVoiceTransport.js'

export type AudioFrameHandler = (frame: AudioFrame) => void

// A LiveKit SIP participant carries the dialed/caller number as string
// attributes (participant.attributes, a plain Record<string,string>) -
// notably 'sip.phoneNumber' (caller ID). Typed loosely here rather than
// pulling in LiveKit's SIP-specific types, since this app only ever reads
// one or two of these keys (see test-token.ts's onParticipantConnected).
export type ParticipantHandler = (participant: RemoteParticipant) => void

export class LiveKitTransport implements IVoiceTransport {
  private room = new Room()
  private connected = false
  private audioSource?: AudioSource
  private audioTrack?: LocalAudioTrack
  // Guards against notifying the same participant twice - see the two
  // call sites of notifyParticipantConnected() in connect() below for why
  // both exist and why that makes double-firing a real possibility, not
  // just theoretical.
  private readonly notifiedParticipants = new Set<string>()

  constructor(
    private readonly onAudioFrame?: AudioFrameHandler,
    // Fire once per caller joining/leaving the room - this is the actual
    // "one phone call" boundary, independent of this ai-runtime process's
    // own lifetime (it stays connected to the room across multiple
    // sequential calls - see test-token.ts's main()). Used for call-log
    // start/end bookkeeping, not for anything on the live audio path.
    private readonly onParticipantConnected?: ParticipantHandler,
    private readonly onParticipantDisconnected?: ParticipantHandler,
  ) { }

  async connect(token: string, url: string): Promise<void> {
    if (this.connected)
      return

    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      console.log(
        `Track published: ${publication.sid} ${publication.kind} from ${participant.identity}`,
      )
    })

    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(
        `Track subscribed: ${publication.sid} ${publication.kind} from ${participant.identity}`,
      )

      if (track.kind === TrackKind.KIND_AUDIO) {
        console.log('Creating AudioStream...')
        this.consumeAudio(track)
      }
    })

    this.room.on(RoomEvent.TrackSubscriptionFailed, (trackSid, participant, reason) => {
      console.error(
        `Track subscription failed: ${trackSid} from ${participant.identity}: ${reason}`,
      )
    })

    this.room.on(
      RoomEvent.ParticipantConnected,
      participant => {
        console.log(`Participant joined: ${participant.identity}`)
        this.notifyParticipantConnected(participant)
      },
    )

    this.room.on(
      RoomEvent.ParticipantDisconnected,
      participant => {
        console.log(`Participant left: ${participant.identity}`)
        this.onParticipantDisconnected?.(participant)
      },
    )

    console.log('Connecting with autoSubscribe default...')
    await this.room.connect(url, token)
    console.log('Connected; remote participants:', this.room.remoteParticipants.size)

    // Added 2026-09-09, real bug found via a live test call: RoomEvent.
    // ParticipantConnected (registered above) only fires for a
    // participant who joins AFTER this room.connect() resolves - it does
    // NOT retroactively fire for someone who was already sitting in the
    // room the moment we connected. That race was structurally impossible
    // in the old boot-time-connect model (this process was always the
    // FIRST participant in its one fixed room, long before any caller
    // could exist) - but in the current per-call, webhook-triggered model
    // (see test-token.ts's runCallSession), the caller's SIP leg can and
    // did beat this connect() call into the room, which meant
    // onParticipantConnected - and therefore beginCall() - never fired at
    // all: no greeting, no STT routing, nothing, even though the caller
    // was very much connected and talking. Catching already-present
    // participants here closes that gap. notifyParticipantConnected()
    // dedupes against the live event above in case the SDK ever fires
    // both for the same join (e.g. a participant connecting mid-handshake,
    // right as this call resolves) - without that guard this would risk
    // running beginCall() twice for one caller.
    for (const participant of this.room.remoteParticipants.values()) {
      console.log(`Participant already in room at connect time: ${participant.identity}`)
      this.notifyParticipantConnected(participant)
    }

    // Confirmed by reading @livekit/rtc-node's actual source
    // (audio_source.ts): AudioSource takes a 3rd constructor arg,
    // queueSize (ms), defaulting to 1000ms when omitted — which is what
    // the old `new AudioSource(24000, 1)` was silently using. captureFrame()
    // sends the whole frame over FFI and awaits a native callback; the
    // native side only accepts a frame once there's room in that queue.
    // Our TTS sentences are routinely 800-3300ms as ONE frame (see
    // TTSSentenceQueue -> publishAudio), i.e. often bigger than the
    // 1000ms buffer itself, so captureFrame() was forced to block
    // mid-call waiting for older queued audio to drain before it could
    // even accept the new frame. That's what the [Timing] captureFrame
    // ratio (0.00-0.69 in real logs) was actually measuring — native
    // buffer backpressure, not "real-time playback pacing" as originally
    // guessed. Bumping the buffer to 8000ms (comfortably bigger than any
    // single sentence we've observed) should let captureFrame() accept
    // the whole frame immediately in the common case.
    // clearAudioQueue()/ClearAudioBufferRequest still flushes this buffer
    // instantly on interrupt regardless of its size, so this doesn't
    // affect barge-in responsiveness.
    this.audioSource = new AudioSource(24000, 1, 8000)

    this.audioTrack = LocalAudioTrack.createAudioTrack(
      'AI Voice',
      this.audioSource,
    )

    const publication = await this.room.localParticipant!.publishTrack(
      this.audioTrack,
      new TrackPublishOptions(),
    )

    console.log(
      `Published AI audio track: ${publication.sid} ${publication.kind}`,
    )

    this.connected = true

    console.log(`Connected to room '${this.room.name}'`)
  }

  async disconnect(): Promise<void> {
    if (!this.connected)
      return

    await this.room.disconnect()

    if (this.audioTrack)
      await this.audioTrack.close()

    this.audioTrack = undefined
    this.audioSource = undefined

    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  private notifyParticipantConnected(participant: RemoteParticipant): void {
    if (this.notifiedParticipants.has(participant.identity))
      return

    this.notifiedParticipants.add(participant.identity)
    this.onParticipantConnected?.(participant)
  }

  private async consumeAudio(track: any): Promise<void> {
    const audioStream = new AudioStream(track)

    for await (const frame of audioStream) {
      this.onAudioFrame?.(frame)
    }
  }

  async publishAudio(
    pcm: Int16Array,
    signal: AbortSignal,
  ): Promise<number> {
    if (!this.audioSource)
      throw new Error('LiveKit audio source is not initialized')

    if (signal.aborted)
      return 0

    const sampleRate = 24000
    const channels = 1

    const frame = new AudioFrame(
      pcm,
      sampleRate,
      channels,
      pcm.length,
    )

    const durationMs = pcm.length / sampleRate * 1000

    // Instrumentation: captureFrame() is handed the ENTIRE sentence as one
    // frame. Confirmed from @livekit/rtc-node source: this await blocks on
    // a native FFI callback that only fires once the AudioSource's internal
    // queue (queueSize ms, see the constructor call above) has room for the
    // new frame — so a nonzero captureMs here means the native buffer was
    // full/near-full when we called, not that "playback pacing happens
    // inside this await" (that was the original, now-confirmed-wrong,
    // guess). With queueSize bumped to 8000ms this should mostly read ~0ms
    // now; a persistently high ratio after that change would mean the
    // buffer is still undersized for how far ahead we're queuing audio.
    const captureStartedAt = Date.now()

    await this.audioSource.captureFrame(frame)

    const captureMs = Date.now() - captureStartedAt

    if (signal.aborted) {
      console.log(
        `[LiveKit TTS] capture completed after abort — captureFrame took ${captureMs} ms`,
      )
      return 0
    }

    // Commented out (Aug 29 2026, not deleted) - fires once per audio
    // chunk (dozens per sentence); the backpressure question this was
    // diagnosing is settled (ratio consistently near 0, the expected/
    // healthy case - see the comment above this function), and it was one
    // of the biggest contributors to log volume. Uncomment if capture
    // timing or backpressure needs investigating again.
    // console.log(
    //   `[Timing] captureFrame: ${captureMs} ms wall time for ${durationMs.toFixed(0)} ms of audio ` +
    //   `(ratio ${(captureMs / durationMs).toFixed(2)}) — this is native AudioSource queue backpressure ` +
    //   `(queueSize=8000ms), not real-time playback pacing; ratio near 0 is the expected/healthy case`,
    // )

    // console.log(
    //   `[LiveKit TTS] published ${pcm.length} samples — ${durationMs} ms audio`,
    // )

    return durationMs
  }

  clearAudioQueue(): void {
    this.audioSource?.clearQueue()
  }

  // Delegates straight to AudioSource.waitForPlayout() (confirmed by
  // reading audio_source.ts: it resolves via an internal timer keyed off
  // the SDK's own currentQueueSize bookkeeping, and clearQueue() resolves
  // it immediately too via releaseWaiter()). This replaces the queue's old
  // hand-rolled `durationMs + fixed guard` timer, which only accounted for
  // the LAST published item's own duration — now that captureFrame() can
  // return almost instantly (queueSize=8000ms), multiple items can be
  // in-flight in the native buffer at once, so a per-item timer would
  // under-count and could report "finished" while earlier audio is still
  // audibly playing.
  async waitForPlayout(): Promise<void> {
    await this.audioSource?.waitForPlayout()
  }
}