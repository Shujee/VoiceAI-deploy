import { AudioFrame } from '@livekit/rtc-node'
import { ISTT } from './ISTT.js'
import { PcmResampler } from '../audio/PcmResampler.js'
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket'

// How long the server VAD must observe silence before it declares the
// user's turn finished (input_audio_buffer.speech_stopped). This elapses
// BEFORE speechStoppedAt is set, so it is real latency the caller
// experiences but it never shows up in any [Timing] log downstream of
// speech_stopped — see TranscriptTiming.vadSilenceDurationMs.
// History: 1200ms -> 600ms -> 900ms -> 700ms -> 400ms (2026-09-04).
// 600ms was tried once and reverted: a caller's ordinary mid-thought
// pause ("The... day after tomorrow at 6 PM") got closed after just
// "The", sent to the LLM as if it were a complete turn (see
// processTranscript in test-token.ts — it has no idea a transcript is a
// fragment vs. a real complete answer), producing a reply to a fragment
// and two rapid interruptions once the caller's actual answer collided
// with it. 900ms was the fix for that, then 700ms clawed back 200ms once
// a real-audio TTFA benchmark made every 100ms worth fighting for again.
// Dropped further to 400ms (2026-09-04, deliberate, not a re-run of the
// 600ms mistake): this project's own interruption handling (onInterruption
// + INTERRUPTED_CONTEXT_NOTE in test-token.ts) already lets a caller who
// gets cut off mid-sentence barge back in and be heard - the fragment
// still gets a premature reply, but the caller can immediately talk over
// it, and a caller cut off once tends to leave a shorter pause the second
// time, not a longer one. That reframes this constant from "avoid ever
// triggering the fragment-cutoff bug" to "keep the fragment-cutoff RATE
// low enough that barge-in recovery covers for it," which is a real
// tradeoff being made on purpose, in the 300-500ms range generally cited
// as normal for conversational voice agents. The structural fix
// (coalescing a suspiciously-short fragment with whatever follows,
// instead of treating every VAD segment as a complete turn) is still not
// built - if real calls show the fragment-cutoff/rapid-interruption
// pattern often enough that barge-in recovery doesn't feel adequate,
// that is the signal to move back toward 700ms rather than push lower,
// or to finally build that structural fix instead of continuing to just
// retune this number.
const SILENCE_DURATION_MS = 400

export interface TranscriptTiming {
  // When the server-side VAD detected the user stopped talking
  // (input_audio_buffer.speech_stopped). This is the true start of the
  // "user speech ends -> ..." latency budget, not transcriptCompletedAt.
  speechStoppedAt?: number
  // When the completed transcript was handed to the conversation layer.
  transcriptCompletedAt: number
  // The configured VAD hangover (see SILENCE_DURATION_MS above) that already
  // elapsed before speechStoppedAt — real latency, invisible to every
  // [Timing] log that's anchored on speechStoppedAt.
  vadSilenceDurationMs: number
}

export type TranscriptHandler = (
  transcript: string,
  timing: TranscriptTiming,
) => void

function describeSocketError(error: unknown): unknown {
  const anyError = error as { error?: unknown; message?: unknown } | undefined
  return anyError?.error ?? anyError?.message ?? error
}

export class OpenAIRealtimeSTT implements ISTT {
  private socket: OpenAIRealtimeWebSocket | null = null
  private readonly resampler = new PcmResampler(48000, 24000)

  private lastAudioSentAt?: number
  private speechStoppedAt?: number
  private firstTranscriptDeltaAt?: number

  // Reconnect state (see scheduleReconnect below). `stt` is a single
  // process-global connection reused across every sequential call for
  // this process's whole lifetime (see test-token.ts) - previously, if
  // the underlying Realtime WebSocket ever dropped (an OpenAI-side
  // blip, a network hiccup), the only thing listening was an 'error'
  // handler that just logged, leaving every call afterward silently
  // getting no STT/VAD at all until someone manually restarted the
  // process. Real incident (Aug 31 2026): an OpenAI-side service issue
  // did exactly this mid-session.
  private intentionalClose = false
  private reconnecting = false
  private reconnectAttempt = 0

  constructor(
    private readonly onTranscript?: TranscriptHandler,
    private readonly onInterruption?: () => void,
    // Fired on EVERY server-VAD speech_started event, whether or not it
    // ends up counting as an interruption - used by test-token.ts purely
    // to fire tts.warmUp?.() the instant the caller starts talking again,
    // so the TTS connection has a head start (racing against STT+LLM)
    // before the reply it'll actually need to speak even exists yet. See
    // ITTS.warmUp() for why this matters.
    private readonly onSpeechStart?: () => void,
    // Added 2026-10-07 for test-token.ts's caller-continuation handling
    // (a caller pausing mid-sentence used to get two separate replies):
    // it needs to know when the caller stops talking and when a turn
    // produced no usable transcript, so a held fragment is never stranded.
    private readonly hooks: {
      onSpeechStop?: () => void
      onTranscriptDiscarded?: () => void
    } = {},
  ) { }

  async connect(): Promise<void> {
    this.intentionalClose = false

    // The FIRST connection attempt used to be the one path that could
    // throw straight out of connect() - main() awaits this once at
    // startup uncaught, so a rejection here used to reach
    // main().catch(...).process.exit(1) and kill the entire ai-runtime
    // process before it ever joined the LiveKit room (real incident,
    // 2026-09-01: OpenAI unreachable at startup -> every call just rang
    // forever, nothing was even listening). Every later drop was already
    // handled gracefully by scheduleReconnect() (see socket.on('error')
    // below) - this makes the very first attempt behave the same way:
    // never throws past this point, just logs and starts the same
    // backoff retry loop. The process comes up and can still join the
    // LiveKit room / answer calls while STT reconnects in the
    // background; those calls simply get no transcription until it
    // succeeds, which is the same degraded mode scheduleReconnect
    // already accepts for a mid-call drop.
    try {
      await this.openSocket()
    } catch (error) {
      console.error(
        '[STT] Initial connection attempt failed - will retry in the ' +
        'background rather than crash the process:',
        describeSocketError(error),
      )
      this.scheduleReconnect()
    }
  }

  // Builds a fresh Realtime WebSocket connection and wires up every event
  // handler on it. Called once from connect() on startup, and again
  // automatically (see scheduleReconnect below) any time the connection
  // drops unexpectedly after that - a fresh OpenAIRealtimeWebSocket has no
  // listeners of its own, so everything below has to be re-registered on
  // every reconnect, not just the first connect.
  private async openSocket(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey)
      throw new Error('OPENAI_API_KEY is not configured')

    const socket = new OpenAIRealtimeWebSocket({
      model: 'gpt-realtime',
    })

    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      socket.socket.addEventListener('open', () => resolve())
      socket.socket.addEventListener('error', reject)
    })

    // The openai SDK maps an abrupt underlying socket closure (network
    // drop, OpenAI-side outage, etc.) to an 'error' event on this wrapper
    // rather than a plain 'close' - confirmed from a real incident's stack
    // trace (WebSocket's internal #onSocketClose -> fireEvent ->
    // OpenAIRealtimeWebSocket._onError). So this is both "log it" AND the
    // one signal available that this connection is gone and needs
    // replacing. The `this.socket === socket` guard matters once a
    // reconnect has happened at least once: without it, a late-firing
    // 'error' from an OLD, already-superseded socket could trigger a
    // second, redundant reconnect on top of whatever replaced it.
    socket.on('error', event => {
      console.error('[STT] OpenAI Realtime error:', describeSocketError(event))

      if (this.socket === socket)
        this.scheduleReconnect()
    })

    // NOTE: this is a text delta of the streaming transcript, not an audio
    // delta — the old label here ("FIRST audio delta") was misleading.
    // It's timed against speechStoppedAt (VAD), not against a
    // "response.created" event: that event is never observed to fire in
    // this session's real logs when turn_detection.create_response is
    // false (confirmed empirically — its timing suffix was blank on every
    // single turn), so it was dead instrumentation and has been removed.
    this.socket.on(
      'conversation.item.input_audio_transcription.delta',
      event => {
        if (!this.firstTranscriptDeltaAt) {
          this.firstTranscriptDeltaAt = Date.now()

          console.log(
            `[STT] FIRST transcript delta — ${this.speechStoppedAt
              ? `${this.firstTranscriptDeltaAt - this.speechStoppedAt} ms after VAD speech_stopped`
              : 'no speech_stopped timestamp'
            }`,
          )
        }
      },
    )

    this.socket.on(
      'conversation.item.input_audio_transcription.completed',
      event => {
        const speechStoppedAt = this.speechStoppedAt
        const transcriptCompletedAt = Date.now()

        this.firstTranscriptDeltaAt = undefined
        this.speechStoppedAt = undefined
        this.lastAudioSentAt = undefined

        const transcript = event.transcript?.trim()

        // Discard empty / non-lexical transcripts (e.g. a brief VAD blip
        // from breath or background noise). This used to happen silently —
        // logging it now so these blips are visible instead of leaving an
        // unexplained gap between "speech started/stopped" and the next
        // real transcript in the log.
        if (!transcript || !/[\p{L}\p{N}]/u.test(transcript)) {
          console.log(
            `[STT] discarded empty/non-lexical transcript: ${JSON.stringify(event.transcript ?? '')}`,
          )
          this.hooks.onTranscriptDiscarded?.()
          return
        }

        console.log(
          `[STT] transcription completed: ${JSON.stringify(transcript)}` +
          (speechStoppedAt
            ? ` — ${transcriptCompletedAt - speechStoppedAt} ms after VAD speech_stopped`
            : ' — no speech_stopped timestamp'),
        )

        this.onTranscript?.(transcript, {
          speechStoppedAt,
          transcriptCompletedAt,
          vadSilenceDurationMs: SILENCE_DURATION_MS,
        })
      },
    )

    this.socket.on(
      'input_audio_buffer.committed',
      event => {
        console.log('[STT] audio buffer committed')
      },
    )

    this.socket.on(
      'conversation.item.created',
      event => {
        console.log(
          '[STT] conversation item created:',
          event.item?.type,
          event.item?.id,
        )
      },
    )

    this.socket.on(
      'input_audio_buffer.speech_started',
      () => {
        console.log('[STT] speech started')
        this.serverVadSpeechActive = true
        this.onSpeechStart?.()

        // Real-call evidence (Aug 29 2026): a caller talked over a long
        // reply near the end of a call ("Okay, can you also...") and was
        // simply ignored - the assistant kept talking right to the end of
        // its own sentence, and only processed the caller's input as the
        // NEXT turn once its own reply had finished. The local RMS gate's
        // frames that turn only ever reached streak=1/8 (repeatedly
        // resetting - the caller's mic level for that utterance just
        // wasn't loud/sustained enough to build a full 8-frame streak),
        // so interruptionFrames never reached interruptionRequiredFrames
        // and the RMS-driven paths below never even got a chance to run -
        // but the server's own VAD (a real speech classifier, not just
        // amplitude) DID correctly detect and transcribe the whole thing.
        // The RMS gate was only ever being used to catch LOUD
        // interruptions fast; it was never meant to be the only way a
        // quieter one could register at all.
        //
        // Fix: server VAD's own speech_started, on its own, is now enough
        // to interrupt - it doesn't need the local RMS streak to have
        // independently reached its own threshold first (that path still
        // exists below for a loud interruption that completes its streak
        // before this event arrives - see rmsGatePendingSince). Still
        // respects the post-playback-start grace window (interruptionGraceMs)
        // for consistency with the RMS path, since real callers essentially
        // never interrupt in the first half-second of the assistant
        // starting to talk anyway.
        const pastGraceWindow = this.assistantSpeaking
          && Date.now() - this.assistantSpeakingStartedAt >= this.interruptionGraceMs

        if (pastGraceWindow) {
          console.log(
            '[STT] User interruption detected (server VAD speech_started)' +
            (this.rmsGatePendingSince !== null
              ? ' - also corroborates a pending RMS-gate streak'
              : ' - RMS gate never independently reached its own streak this time'),
          )

          this.onInterruption?.()

          this.assistantSpeaking = false
          this.interruptionFrames = 0
          this.rmsGatePendingSince = null
        }
      },
    )

    this.socket.on(
      'input_audio_buffer.speech_stopped',
      () => {
        this.speechStoppedAt = Date.now()
        this.serverVadSpeechActive = false
        this.hooks.onSpeechStop?.()

        console.log(
          `[STT] speech stopped (VAD) — ${this.lastAudioSentAt
            ? `${this.speechStoppedAt - this.lastAudioSentAt} ms since last audio frame sent`
            : 'no audio timestamp'
          }`,
        )
      },
    )

    this.socket.on('session.updated', (event) => {
      const session = event.session as typeof event.session & {
        instructions?: string
      }

      console.log('[STT] SESSION INSTRUCTIONS:')
      console.log(session.instructions)
    })

    this.socket.send({
      type: 'session.update',
      session: {

        type: 'realtime',
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: 24000,
            },
            transcription: {
              model: 'gpt-4o-transcribe',
              language: 'en',
              // No transcription `prompt` here: one was tried on 2026-10-07
              // (UK English, "postcodes such as LU1 9DB") and the model
              // started hallucinating it - echo/noise came back as
              // "LU1 9DB" and invented sentences ("I would like to speak
              // with Mr. Thompson"), wrecking the conversation.
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: SILENCE_DURATION_MS,
              create_response: false,
              interrupt_response: true,
            }
          },
        }
      }
    })
  }

  // Reconnects with capped exponential backoff (1s, 2s, 4s, 8s, 15s, 15s,
  // ...) after an unexpected drop. Guarded by `reconnecting` so a burst of
  // multiple 'error' events for the same dead connection only schedules
  // one attempt, and by `intentionalClose` so a deliberate shutdown
  // (SIGINT/SIGTERM, see test-token.ts) never triggers a reconnect. A call
  // in progress when the connection drops still loses STT for its own
  // remainder (pushAudio's readyState guard silently drops frames rather
  // than throwing) - there's no good way to resume mid-call transcription
  // on a brand-new Realtime session - but every call AFTER this one
  // succeeds gets a working connection again automatically, instead of
  // needing a manual process restart the way it did before this existed.
  private scheduleReconnect(): void {
    if (this.intentionalClose || this.reconnecting)
      return

    this.reconnecting = true

    const attempt = this.reconnectAttempt++
    const delayMs = Math.min(1000 * 2 ** attempt, 15000)

    console.warn(
      `[STT] Realtime connection lost - reconnecting in ${delayMs} ms ` +
      `(attempt ${attempt + 1}). Any call in progress right now has lost ` +
      'STT for its remainder; calls after this reconnect succeeds will be fine.',
    )

    setTimeout(async () => {
      try {
        await this.openSocket()

        this.reconnectAttempt = 0
        this.reconnecting = false

        console.log('[STT] Realtime connection restored')
      } catch (error) {
        console.error('[STT] Reconnect attempt failed, will retry:', describeSocketError(error))

        this.reconnecting = false
        this.scheduleReconnect()
      }
    }, delayMs)
  }

  private audioFrameCount = 0
  private assistantSpeaking = false

  private interruptionFrames = 0
  // Was 800. Real log evidence from a quiet room (ceiling fan + the
  // assistant's own TTS audio, browser client, echo cancellation on by
  // LiveKit's defaults, no actual user speech) showed the local RMS gate
  // hitting up to 2047 on residual echo/ambient noise alone — well above
  // the old threshold. This is a provisional bump to clear that observed
  // false-positive ceiling with headroom (2047 -> 3000), not a tuned value:
  // we don't yet have an RMS sample from a genuine interruption on this
  // same setup to confirm real speech clears 3000 comfortably. Needs
  // validation both ways — quiet-room false positives should stop, and a
  // real "stop talking" attempt should still register.
  //
  // KNOWN LIMITATION (flagged, not fixed - see voiceai_runtime_status.md
  // project note): this whole gate is pure volume, with zero speech-vs-
  // noise discrimination - any sufficiently loud sustained sound (someone
  // else talking in the background, a TV, ambient noise) trips it exactly
  // like a real interruption, because to this code they're identical. A
  // real fix needs an actual signal that distinguishes "the caller is
  // talking to the assistant" from "there is loud sound in the room" -
  // e.g. corroborating with OpenAI's own server-side VAD (speech-model
  // based, not just amplitude) before firing, not just tuning these two
  // numbers. Not attempted here - real risk of either not helping (VAD
  // will still fire on background *talk*, since that's genuinely speech)
  // or of making genuine interruptions less responsive, and not something
  // to gamble on right before a demo without proper before/after testing.
  //
  // interruptionRequiredFrames bumped 3 -> 8 as a cheap, conservative,
  // reversible partial mitigation: requires roughly 2-3x longer sustained
  // loud audio before firing (each frame is a short, fixed chunk of mic
  // audio - see pushAudio below), which should filter brief noise bursts
  // and short interjections without making a real, sustained interruption
  // attempt noticeably slower to register. It will NOT stop a false
  // trigger from continuous loud background talk that lasts the same
  // streak length - that needs the real fix described above.
  private readonly interruptionThreshold = 3000
  private readonly interruptionRequiredFrames = 8

  // Real-call evidence (Aug 29 2026): a false-positive interruption cut off
  // the assistant's very FIRST greeting of the call, almost as soon as
  // playback started - the worst possible moment for one of these, since
  // it's the caller's first impression. The RMS gate climbed smoothly from
  // ~3600 up to ~11000 across its 8-frame streak - well past the ~2047
  // ceiling previously observed from residual echo/ambient noise alone in
  // a quiet-room test (see interruptionThreshold's comment above), so this
  // wasn't just a repeat of that same false-positive pattern; but the user
  // wasn't sure whether they'd actually made a sound right then either, so
  // it's genuinely unclear whether this was a real (if very early) barge-in
  // or an onset artifact - e.g. the AEC path needing a brief moment to
  // adapt whenever new TTS content starts playing, or a startup pop.
  // Rather than guess at retuning the threshold/streak with no clear
  // signal for which direction to move them, this adds a short grace
  // window right after assistant playback starts, during which the local
  // RMS gate is not evaluated at all (OpenAI's own server VAD still gets
  // every frame regardless - see the comment on the assistantSpeaking
  // check in pushAudio below). A genuine caller interruption almost never
  // happens within the first half-second of the assistant starting to
  // speak anyway (they typically let at least a syllable or two play
  // first), so this trades a small amount of instant-barge-in
  // responsiveness for filtering out exactly this class of onset false
  // positive. This does NOT fix the deeper known gap (still flagged below
  // and in voiceai_runtime_status.md) - it only hardens the single
  // riskiest moment (the start of any assistant utterance) against it.
  private readonly interruptionGraceMs = 500
  private assistantSpeakingStartedAt = 0

  // Real-call evidence (Aug 29 2026, second occurrence): even with the
  // grace window above, the local RMS gate cut the assistant off well
  // into playback (not near the start), climbing to ~18000 - well past
  // both the previous false-positive's ~11000 and the original ~2047
  // quiet-room ceiling - with the caller explicitly confirming they said
  // nothing and heard no loud noise either. Checked whether OpenAI's own
  // server-side VAD (a real speech-model classifier, not just amplitude -
  // already receiving every audio frame regardless of playback state,
  // see the comment on the assistantSpeaking check in pushAudio) reported
  // any speech_started during that same window: it did not. That's
  // exactly the corroborating signal this gate was missing - see the
  // KNOWN LIMITATION comment on interruptionThreshold above, which
  // already named "corroborating with OpenAI's own server-side VAD" as
  // the real fix, just not attempted until now.
  //
  // Rather than fire the instant the local RMS streak completes, the gate
  // now waits up to interruptionConfirmMs for the server VAD to also
  // report speech_started before treating it as a real interruption - if
  // that confirmation arrives, the interruption fires immediately from
  // the speech_started handler itself rather than waiting out the rest of
  // the window (see there). If it never arrives within the window, the
  // streak is dropped as noise/echo and the assistant keeps talking.
  // Trade-off: a genuine interruption's local RMS streak can complete
  // before OpenAI's own detection catches up (network round-trip plus its
  // own detection latency - the session's prefix_padding_ms=300 gives a
  // rough sense of that latency), so this adds up to interruptionConfirmMs
  // of extra delay to a REAL interruption in the case where local RMS
  // happens to win that race, in exchange for not cutting the assistant
  // off for sounds that were never speech at all. 600ms was chosen with
  // headroom over that ~300ms figure rather than cut it close.
  private serverVadSpeechActive = false
  private rmsGatePendingSince: number | null = null
  private readonly interruptionConfirmMs = 600

  private measureRms(pcm: Int16Array): number {
    let sum = 0

    for (const sample of pcm)
      sum += sample * sample

    return Math.sqrt(sum / pcm.length)
  }

  startAssistantSpeaking(): void {
    this.assistantSpeaking = true
    this.assistantSpeakingStartedAt = Date.now()
    this.interruptionFrames = 0
    this.rmsGatePendingSince = null
  }

  stopAssistantSpeaking(): void {
    this.assistantSpeaking = false
    this.interruptionFrames = 0
    this.rmsGatePendingSince = null
  }

  pushAudio(frame: AudioFrame): void {
    if (!this.socket || this.socket.socket.readyState !== WebSocket.OPEN)
      return

    const pcm = this.resampler.process(frame)

    // Used to gate audio forwarding entirely: while the assistant was
    // speaking, mic audio was ONLY checked locally and never sent to
    // OpenAI's socket at all. That caused a real bug — if the caller
    // started talking right as assistantSpeaking flipped true, OpenAI's
    // own server VAD had already opened a speech segment (speech_started)
    // but then got no further audio to detect trailing silence with, so it
    // sat stuck open until playback ended and forwarding resumed, at which
    // point speech_stopped fired almost instantly. Net effect: a real
    // utterance's transcript was delayed by however long the assistant
    // kept talking (several seconds), not lost, but not fast either — and
    // if the caller kept talking throughout, none of that audio would have
    // reached OpenAI at all. Now we always forward, so OpenAI's VAD stays
    // in sync regardless of local playback state; the local RMS gate below
    // still runs in parallel purely to decide whether to interrupt.
    // Trade-off: since we no longer withhold audio during playback,
    // residual echo that leaks past AEC could occasionally reach OpenAI's
    // own (more sensitive) VAD and get transcribed as if the caller said
    // it. Watch for that in the next log — a transcript that echoes what
    // the assistant itself just said.
    if (this.assistantSpeaking && Date.now() - this.assistantSpeakingStartedAt < this.interruptionGraceMs) {
      // Still within the post-playback-start grace window (see
      // interruptionGraceMs above) - don't evaluate the RMS gate yet, and
      // don't let any frames from this window count toward a streak once
      // the window ends.
      this.interruptionFrames = 0
      this.rmsGatePendingSince = null
    } else if (this.assistantSpeaking) {
      const rms = this.measureRms(pcm)

      if (rms > this.interruptionThreshold) {
        this.interruptionFrames++

        // Logged every frame in a growing streak, not just on the frame
        // that fires — without this, an interruption event just says "it
        // happened," with no way to tell whether it was a loud, unambiguous
        // spike or barely nudged over threshold=800. That distinction is
        // the difference between "raise the threshold a bit" and "this
        // needs an entirely different approach (echo cancellation, mute
        // gating, etc.)."
        console.log(
          `[STT] local RMS gate: frame rms=${rms.toFixed(0)} ` +
          `(threshold=${this.interruptionThreshold}) ` +
          `streak=${this.interruptionFrames}/${this.interruptionRequiredFrames}`,
        )

        if (this.interruptionFrames >= this.interruptionRequiredFrames) {
          // See rmsGatePendingSince/interruptionConfirmMs above - don't
          // cut the assistant off on RMS alone unless the server's own
          // (real, speech-model-based) VAD agrees this is actually speech.
          if (this.serverVadSpeechActive) {
            console.log(
              '[STT] User interruption detected (local RMS gate, ' +
              'corroborated by server VAD)',
            )

            this.onInterruption?.()

            this.assistantSpeaking = false
            this.interruptionFrames = 0
            this.rmsGatePendingSince = null
          } else if (this.rmsGatePendingSince === null) {
            this.rmsGatePendingSince = Date.now()

            console.log(
              '[STT] local RMS gate streak reached but server VAD hasn\'t ' +
              `reported speech yet - waiting up to ${this.interruptionConfirmMs} ms ` +
              'for corroboration before cutting the assistant off',
            )
          } else if (Date.now() - this.rmsGatePendingSince >= this.interruptionConfirmMs) {
            console.log(
              '[STT] No server VAD corroboration arrived within the wait ' +
              'window - treating this as noise/echo, not a real ' +
              'interruption; the assistant keeps talking',
            )

            this.interruptionFrames = 0
            this.rmsGatePendingSince = null
          }
        }
      } else {
        // Silent-reset bug fixed here (Aug 29 2026): this branch used to
        // reset both counters with zero log output, even when it was
        // wiping out a streak that had already reached/passed the
        // required threshold and was actively waiting on VAD
        // corroboration (rmsGatePendingSince set). Real-call evidence: a
        // log showed the streak climb cleanly to 10/8 with no reset
        // printed anywhere, then two lines later
        // speech_started logged "RMS gate never independently reached
        // its own streak this time" - which was simply false; it had
        // reached it, then got silently reset by one quieter in-between
        // frame (real speech doesn't sit above threshold on literally
        // every frame) moments before speech_started fired. Only log
        // when there was something to lose, so a genuinely-quiet frame
        // during normal playback doesn't spam this on every turn.
        if (this.interruptionFrames > 0) {
          console.log(
            `[STT] local RMS gate: frame rms=${rms.toFixed(0)} back under ` +
            `threshold (${this.interruptionThreshold}) - streak reset from ` +
            `${this.interruptionFrames}/${this.interruptionRequiredFrames}` +
            (this.rmsGatePendingSince !== null
              ? ' (was waiting on VAD corroboration - that wait is now abandoned)'
              : ''),
          )
        }

        this.interruptionFrames = 0
        this.rmsGatePendingSince = null
      }
    } else {
      this.interruptionFrames = 0
      this.rmsGatePendingSince = null
    }

    const audio = Buffer.from(
      pcm.buffer,
      pcm.byteOffset,
      pcm.byteLength,
    ).toString('base64')

    this.lastAudioSentAt = Date.now()

    this.socket.send({
      type: 'input_audio_buffer.append',
      audio,
    })

    this.audioFrameCount++
  }

  async close(): Promise<void> {
    this.intentionalClose = true

    if (!this.socket)
      return

    this.socket.close()
    this.socket = null
  }
}