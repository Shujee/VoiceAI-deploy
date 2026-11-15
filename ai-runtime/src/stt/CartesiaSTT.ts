import WebSocket from 'ws'
import { AudioFrame } from '@livekit/rtc-node'
import { PcmResampler } from '../audio/PcmResampler.js'
import { TranscriptTiming } from './OpenAIRealtimeSTT.js'

// Cartesia's turn-detecting realtime STT (see
// https://docs.cartesia.ai/api-reference/stt/turns/websocket - the
// authoritative first-party page for this exact endpoint could not be
// fetched directly this session; the shape below was assembled from
// Cartesia's own /stt/websocket (manual-finalize) reference, the
// livekit-plugins-cartesia source, and a Sarvam STT migration guide,
// then CONFIRMED against a real call's raw event log (2026-09-04, see
// [STT] [Cartesia] RAW event lines) - every turn.update/eager_end/end
// event actually carries the transcript under "transcript", never
// "text" (event?.text below is a harmless leftover fallback, not a real
// second field this API sends). Keeping the permanent raw-JSON logging
// anyway - cheap, and the one thing that will immediately surface any
// future schema change from Cartesia's side.
const CARTESIA_STT_WS_URL = 'wss://api.cartesia.ai/stt/turns/websocket'

// Same pin as CartesiaTTS.ts's CARTESIA_VERSION - keep these two in sync
// if Cartesia ships a newer version and the old one gets deprecated.
const CARTESIA_VERSION = '2026-08-14'

const MODEL_ID = 'ink-2'

// Cartesia's own published defaults (also what livekit-plugins-cartesia
// ships as its defaults) - starting point, not yet tuned against this
// project's real calls. Lower turn_end_threshold / turn_end_timeout_ms
// would claw back more latency at the cost of more premature cutoffs,
// mirroring the exact tradeoff SILENCE_DURATION_MS documents in
// OpenAIRealtimeSTT.ts - don't retune these blind, retune them the same
// way that constant's history was built: one real-call-evidence-backed
// step at a time.
//
// TURN_START_THRESHOLD lowered 0.8 -> 0.6 (2026-09-04, first real-call
// evidence): a real barge-in test showed interruptions needing a loud,
// sustained utterance to register - two of three that DID land fired
// from turn.start alone with no RMS corroboration (proving turn.start
// CAN fire fast when confident), but one clear attempt never registered
// at all (local RMS streak reached 3/8 then reset, no turn.start ever
// arrived). 0.8 is Cartesia's own most-conservative setting; during
// active TTS playback there's real acoustic bleed for its model to see
// past, so a quick word or two may not clear that bar.
//
// Lowered again, 0.6 -> 0.5 (2026-09-05, the floor of Cartesia's valid
// range): once turn.start actually arrives, this app reacts to it
// immediately (see handleEvent's turn.start branch) - the delay a caller
// feels before a barge-in "takes" is entirely Cartesia's own model
// building confidence up to this bar, not anything added downstream.
// Pushing it lower used to be too risky on its own (a low bar means more
// early/spurious turn.start firings, each one a real but unconfirmed
// interruption), but the false-positive turn.end -> onFalseInterruption
// recovery added the same day changes that calculus: a spurious firing
// now self-corrects (the cut-off reply gets replayed) instead of either
// silently breaking barge-in reliability or leaving dead air. 0.5 is the
// floor - if this still isn't responsive enough, the remaining lever is
// TURN_END_TIMEOUT_MS/eager_end, not this constant.
const TURN_START_THRESHOLD = 0.5
const TURN_EAGER_END_THRESHOLD = 0.4
const TURN_END_THRESHOLD = 0.2
const TURN_END_TIMEOUT_MS = 5600

function describeSocketError(error: unknown): unknown {
  const anyError = error as { error?: unknown; message?: unknown } | undefined
  return anyError?.error ?? anyError?.message ?? error
}

// Drop-in replacement for OpenAIRealtimeSTT with the same public surface
// (connect/pushAudio/close/startAssistantSpeaking/stopAssistantSpeaking,
// same 3-callback constructor) so test-token.ts's `stt` variable can hold
// either one - see STT_PROVIDER in test-token.ts.
//
// Why this exists (2026-09-04): real-call [Timing]/[STT] evidence this
// session showed OpenAI's Realtime STT paying for silence-based
// endpointing TWICE - our own fixed VAD hangover, then ~700-1000ms more
// for OpenAI to actually finalize a transcript after that. Cartesia's
// ink-2 replaces BOTH stages with one semantic decision (its own
// turn.start/turn.update/turn.eager_end/turn.resume/turn.end lifecycle,
// no external VAD needed) - see turn.end below for exactly how that
// collapses this class's TranscriptTiming shape. Chosen over Deepgram
// Flux/AssemblyAI Universal-3 Pro (both also semantic-endpointing,
// comparably fast per third-party benchmarks) because this project
// already has a Cartesia account/API key for TTS, and Cartesia's own
// AppTek benchmark specifically claims strength across accented English
// call-center audio (8% WER across 14 English accents) - relevant since
// this project's caller base is UK-accented and OpenAI was never
// benchmarked against that directly here.
export class CartesiaSTT {
  private socket: WebSocket | null = null
  private readonly resampler = new PcmResampler(48000, 24000)

  private turnStartedAt?: number
  private turnActive = false
  private interruptionFiredThisTurn = false

  private intentionalClose = false
  private reconnecting = false
  private reconnectAttempt = 0

  constructor(
    private readonly onTranscript?: (transcript: string, timing: TranscriptTiming) => void,
    private readonly onInterruption?: () => void,
    // Fired on every turn.start, mirroring OpenAIRealtimeSTT's
    // onSpeechStart - see that class for why test-token.ts wires this to
    // tts.warmUp?.().
    private readonly onSpeechStart?: () => void,
    // Fired when a turn that triggered onInterruption above (either via
    // turn.start or the local RMS gate) then finishes with an empty/non-
    // lexical transcript - i.e. we cut the assistant off for what turned
    // out to be a noise, not real speech. Lets the caller (test-token.ts)
    // recover instead of leaving dead air. Cartesia-only: this needs the
    // turn.start/turn.end lifecycle this class is built around, which
    // OpenAIRealtimeSTT's two-stage VAD+finalization model has no
    // equivalent signal for - the two classes' constructors are
    // otherwise intentionally identical (see the ternary in
    // test-token.ts that picks between them).
    private readonly onFalseInterruption?: () => void,
  ) { }

  async connect(): Promise<void> {
    this.intentionalClose = false

    // Mirrors OpenAIRealtimeSTT.connect(): the first attempt must never
    // throw past this point (real incident, 2026-09-01, see that file) -
    // log and start the same backoff retry loop instead of killing the
    // process before it ever joins the LiveKit room.
    try {
      await this.openSocket()
    } catch (error) {
      console.error(
        '[STT] [Cartesia] Initial connection attempt failed - will retry ' +
        'in the background rather than crash the process:',
        describeSocketError(error),
      )
      this.scheduleReconnect()
    }
  }

  private async openSocket(): Promise<void> {
    const apiKey = process.env.CARTESIA_API_KEY

    if (!apiKey)
      throw new Error('CARTESIA_API_KEY is not configured')

    const params = new URLSearchParams({
      model: MODEL_ID,
      encoding: 'pcm_s16le',
      // Matches PcmResampler's output rate below and CartesiaTTS.ts's
      // output rate - one sample rate for this whole call's audio path.
      sample_rate: '24000',
      cartesia_version: CARTESIA_VERSION,
      language: 'en',
      turn_start_threshold: String(TURN_START_THRESHOLD),
      turn_eager_end_threshold: String(TURN_EAGER_END_THRESHOLD),
      turn_end_threshold: String(TURN_END_THRESHOLD),
      turn_end_timeout_ms: String(TURN_END_TIMEOUT_MS),
    })

    // X-API-Key header, not the access_token query param - the docs
    // frame the query-param form as the client-side (browser) option and
    // the header as the server-side one, which is what this process is.
    const socket = new WebSocket(`${CARTESIA_STT_WS_URL}?${params.toString()}`, {
      headers: { 'X-API-Key': apiKey },
    })

    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })

    console.log('[STT] [Cartesia] connected')

    socket.on('error', event => {
      console.error('[STT] [Cartesia] socket error:', describeSocketError(event))

      if (this.socket === socket)
        this.scheduleReconnect()
    })

    socket.on('close', (code, reason) => {
      console.warn(
        `[STT] [Cartesia] socket closed (code=${code}, reason=${reason?.toString() || '(none)'})`,
      )

      if (this.socket === socket && !this.intentionalClose)
        this.scheduleReconnect()
    })

    socket.on('message', raw => {
      let event: any

      try {
        event = JSON.parse(raw.toString())
      } catch (error) {
        console.error('[STT] [Cartesia] unparseable message:', raw.toString())
        return
      }

      // Permanent, not temporary - see the top-of-file comment on why
      // this class's field-name assumptions aren't first-party-confirmed
      // yet. Skip turn.update specifically (2026-09-05): it fires once
      // per partial word while the caller is talking, far higher volume
      // than every other event type combined, and drowns out
      // [LLM SENTENCE]/[TTS] logging instead of being "cheap" next to it
      // as originally assumed here - the field-name-confirmation goal
      // this line exists for doesn't need every partial-word repeat, one
      // sample per turn.start/eager_end/resume/turn.end already covers
      // it just as well.
      if (event?.type !== 'turn.update')
        console.log('[STT] [Cartesia] RAW event:', JSON.stringify(event))

      this.handleEvent(event)
    })
  }

  private handleEvent(event: any): void {
    const type = event?.type as string | undefined

    if (type === 'turn.start') {
      this.turnStartedAt = Date.now()
      this.turnActive = true
      this.interruptionFiredThisTurn = false

      console.log('[STT] [Cartesia] turn started')

      this.onSpeechStart?.()

      // Same interruption-corroboration reasoning as
      // OpenAIRealtimeSTT's speech_started handler - see that file's
      // long comment history (Aug 29 2026 incidents) for why server-side
      // (here: Cartesia's own) speech/turn detection is allowed to
      // interrupt on its own past the grace window, independent of
      // whether the local RMS gate's own streak has completed yet.
      const pastGraceWindow = this.assistantSpeaking
        && Date.now() - this.assistantSpeakingStartedAt >= this.interruptionGraceMs

      if (pastGraceWindow) {
        // Reverted (2026-09-05): briefly required a short local-RMS
        // streak to corroborate turn.start, to filter background noise
        // (a door/window, a conversation elsewhere). That backfired -
        // turn.start fires right at speech onset, before local RMS has
        // had any chance to build up a streak, so it ended up blocking
        // real barge-in almost every time instead (confirmed live: a
        // sustained real interruption attempt got logged as "likely
        // background noise" and the assistant talked straight through
        // it). Trusting turn.start unconditionally again - a false
        // positive on noise is a better failure mode than swallowing a
        // genuine interruption.
        this.fireInterruption(
          'turn.start' +
          (this.rmsGatePendingSince !== null
            ? ' - also corroborates a pending RMS-gate streak'
            : ' - RMS gate never independently reached its own streak this time'),
        )
      }
    } else if (type === 'turn.update') {
      // Cumulative transcript-so-far for the still-open turn (per
      // livekit-plugins-cartesia's documented behavior) - not acted on
      // (see "speculative LLM start" note below) and not logged either:
      // it fires on every partial word within a turn, which drowned out
      // the rest of the per-call log for no benefit - the RAW event log
      // above already captures the same data if it's ever needed again.
      // Acting on this instead of waiting for turn.end would be the
      // "speculative LLM start" optimization flagged as a known-not-yet-
      // built lever; real risk of acting on text that still changes
      // before turn.end, same risk class as the fragment-cutoff bug
      // SILENCE_DURATION_MS's history already fought once - not
      // attempted here.
    } else if (type === 'turn.eager_end') {
      console.log(
        '[STT] [Cartesia] turn.eager_end (predicted wrap-up)' +
        (this.turnStartedAt ? ` - ${Date.now() - this.turnStartedAt} ms since turn.start` : ''),
      )
    } else if (type === 'turn.resume') {
      console.log(
        '[STT] [Cartesia] turn.resume (eager_end prediction was wrong, caller kept talking)',
      )
    } else if (type === 'turn.end') {
      // THE completion signal - this single event is what OpenAI needed
      // TWO events for (speech_stopped, then later
      // transcription.completed). speechStoppedAt/transcriptCompletedAt
      // collapse to the same timestamp (this message's arrival) and
      // vadSilenceDurationMs is 0, since there's no separate "audio
      // actually stopped" timestamp available from Cartesia to anchor on
      // instead.
      //
      // HONEST CAVEAT (confirmed reading real call logs, 2026-09-04):
      // this is NOT the same as saying that latency is "accounted for" -
      // it isn't. Whatever time Cartesia's own model spends deciding the
      // turn is over, plus the network hop back to us, elapses BEFORE
      // this message arrives and is invisible to every [Timing] number
      // downstream of it - unlike OpenAI, where speechStoppedAt fired at
      // the true moment of acoustic silence and the later finalization
      // wait was fully counted in the gap between it and the LLM call
      // starting. So this class's own PERCEIVED TOTAL numbers UNDER-
      // report true caller-perceived latency by however long Cartesia's
      // internal turn-end decision actually takes - there's no field in
      // this event payload (confirmed: just type/request_id/turn_id/
      // transcript, no timing info) to recover that gap from. The real
      // improvement over OpenAI is still very likely genuine (Cartesia's
      // own claims and comparable third-party-benchmarked semantic
      // endpointers both put that hidden stage in the 100-400ms range,
      // well under OpenAI's measured 700-1000ms) - just don't read the
      // raw before/after PERCEIVED TOTAL numbers as a like-for-like
      // comparison, because a whole latency stage quietly stopped being
      // measurable at all when this class replaced OpenAIRealtimeSTT.
      const transcriptCompletedAt = Date.now()
      const speechStoppedAt = transcriptCompletedAt

      this.turnActive = false
      this.turnStartedAt = undefined

      const transcript = (event?.transcript ?? event?.text ?? '').trim()

      if (!transcript || !/[\p{L}\p{N}]/u.test(transcript)) {
        if (this.interruptionFiredThisTurn) {
          console.log(
            '[STT] [Cartesia] turn.end came back empty/non-lexical after this ' +
            'turn interrupted the assistant - that interruption was a false ' +
            `alarm (background noise, not the caller): ${JSON.stringify(event?.transcript ?? event?.text ?? '')}`,
          )

          this.interruptionFiredThisTurn = false
          this.onFalseInterruption?.()
        } else {
          console.log(
            `[STT] [Cartesia] discarded empty/non-lexical turn.end transcript: ${JSON.stringify(event?.transcript ?? event?.text ?? '')}`,
          )
        }

        return
      }

      console.log(`[STT] [Cartesia] turn ended, final transcript: ${JSON.stringify(transcript)}`)

      this.onTranscript?.(transcript, {
        speechStoppedAt,
        transcriptCompletedAt,
        vadSilenceDurationMs: 0,
      })
    } else {
      console.log('[STT] [Cartesia] unhandled event type:', type)
    }
  }

  // Same capped exponential backoff as OpenAIRealtimeSTT - see that
  // file's scheduleReconnect for the full reasoning (guards against
  // duplicate reconnects, never fires after an intentional shutdown, a
  // call in progress when the drop happens loses STT for its remainder
  // but every call after a successful reconnect is fine).
  private scheduleReconnect(): void {
    if (this.intentionalClose || this.reconnecting)
      return

    this.reconnecting = true

    const attempt = this.reconnectAttempt++
    const delayMs = Math.min(1000 * 2 ** attempt, 15000)

    console.warn(
      `[STT] [Cartesia] connection lost - reconnecting in ${delayMs} ms ` +
      `(attempt ${attempt + 1}). Any call in progress right now has lost ` +
      'STT for its remainder; calls after this reconnect succeeds will be fine.',
    )

    setTimeout(async () => {
      try {
        await this.openSocket()

        this.reconnectAttempt = 0
        this.reconnecting = false

        console.log('[STT] [Cartesia] connection restored')
      } catch (error) {
        console.error('[STT] [Cartesia] Reconnect attempt failed, will retry:', describeSocketError(error))

        this.reconnecting = false
        this.scheduleReconnect()
      }
    }, delayMs)
  }

  // --- Local RMS interruption gate ---
  // Copied as close to verbatim as possible from OpenAIRealtimeSTT.ts's
  // own gate (same thresholds, same grace window, same corroboration
  // wait) rather than redesigned, on purpose: this logic is about mic
  // audio and playback timing, not about which STT provider is behind
  // it, and it was tuned against real call incidents (Aug 29 2026) that
  // have nothing to do with OpenAI specifically. Keeping the two
  // implementations comparable side by side also makes it obvious if a
  // future retune of one should apply to the other too. turn.start above
  // plays the exact corroboration role speech_started played there.
  private assistantSpeaking = false
  private interruptionFrames = 0
  private readonly interruptionThreshold = 3000
  private readonly interruptionRequiredFrames = 8
  private readonly interruptionGraceMs = 500
  private assistantSpeakingStartedAt = 0
  private rmsGatePendingSince: number | null = null
  private readonly interruptionConfirmMs = 600

  private measureRms(pcm: Int16Array): number {
    let sum = 0

    for (const sample of pcm)
      sum += sample * sample

    return Math.sqrt(sum / pcm.length)
  }

  private fireInterruption(reason: string): void {
    console.log(`[STT] [Cartesia] User interruption detected (${reason})`)

    this.onInterruption?.()
    this.interruptionFiredThisTurn = true

    this.assistantSpeaking = false
    this.interruptionFrames = 0
    this.rmsGatePendingSince = null
  }

  // Fires once per queued reply chunk that starts playing (see
  // TTSSentenceQueue's onPlaybackStarted), not once per whole reply.
  startAssistantSpeaking(): void {
    this.assistantSpeaking = true
    this.assistantSpeakingStartedAt = Date.now()
    this.interruptionFrames = 0
    this.rmsGatePendingSince = null

    // Catches a gap the other two interruption paths (turn.start above,
    // the local RMS gate below) both miss: the caller already mid-
    // utterance (turnActive) BEFORE our own reply even started playing -
    // e.g. they kept talking straight through the LLM+TTS gap without
    // waiting for a reply. Cartesia only fires turn.start once per turn,
    // so if that already happened before assistantSpeaking flipped true,
    // there is no future turn.start left for handleEvent to react to,
    // and the local RMS gate only helps if the caller happens to be
    // loud enough for long enough. Confirmed missing on a real call
    // (2026-09-05): a caller who started a new utterance right as their
    // previous turn ended, then kept talking straight through the
    // assistant's ~7s two-sentence reply, was never interrupted at all.
    //
    // This calls back into cancel() synchronously (via onInterruption
    // above test-token.ts's chain), from inside TTSSentenceQueue's own
    // playback loop - see the 2026-09-05 fix in TTSSentenceQueue.ts that
    // moves activeItemHasPublishedAudio=true before onPlaybackStarted()
    // specifically so that reentrant cancel() correctly treats this
    // item as cancellable rather than protecting it.
    if (this.turnActive)
      this.fireInterruption('turn already open when assistant started speaking')
  }

  stopAssistantSpeaking(): void {
    this.assistantSpeaking = false
    this.interruptionFrames = 0
    this.rmsGatePendingSince = null
  }

  pushAudio(frame: AudioFrame): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      return

    const pcm = this.resampler.process(frame)

    // Always forward audio regardless of assistantSpeaking - same reason
    // as OpenAIRealtimeSTT.ts: Cartesia's own turn detection needs
    // continuous audio to track turn state correctly, withholding it
    // during playback would leave a turn stuck open the same way it used
    // to for OpenAI's server VAD. The local RMS gate below still runs in
    // parallel purely to decide whether to interrupt.
    if (this.assistantSpeaking && Date.now() - this.assistantSpeakingStartedAt < this.interruptionGraceMs) {
      this.interruptionFrames = 0
      this.rmsGatePendingSince = null
    } else if (this.assistantSpeaking) {
      const rms = this.measureRms(pcm)

      if (rms > this.interruptionThreshold) {
        this.interruptionFrames++

        console.log(
          `[STT] [Cartesia] local RMS gate: frame rms=${rms.toFixed(0)} ` +
          `(threshold=${this.interruptionThreshold}) ` +
          `streak=${this.interruptionFrames}/${this.interruptionRequiredFrames}`,
        )

        if (this.interruptionFrames >= this.interruptionRequiredFrames) {
          if (this.turnActive) {
            this.fireInterruption('local RMS gate, corroborated by turn.start already active')
          } else if (this.rmsGatePendingSince === null) {
            this.rmsGatePendingSince = Date.now()

            console.log(
              '[STT] [Cartesia] local RMS gate streak reached but no turn.start ' +
              `yet - waiting up to ${this.interruptionConfirmMs} ms for ` +
              'corroboration before cutting the assistant off',
            )
          } else if (Date.now() - this.rmsGatePendingSince >= this.interruptionConfirmMs) {
            console.log(
              '[STT] [Cartesia] No turn.start corroboration arrived within the ' +
              'wait window - treating this as noise/echo, not a real ' +
              'interruption; the assistant keeps talking',
            )

            this.interruptionFrames = 0
            this.rmsGatePendingSince = null
          }
        }
      } else {
        if (this.interruptionFrames > 0) {
          console.log(
            `[STT] [Cartesia] local RMS gate: frame rms=${rms.toFixed(0)} back under ` +
            `threshold (${this.interruptionThreshold}) - streak reset from ` +
            `${this.interruptionFrames}/${this.interruptionRequiredFrames}` +
            (this.rmsGatePendingSince !== null
              ? ' (was waiting on turn.start corroboration - that wait is now abandoned)'
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

    this.socket.send(
      Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength),
    )
  }

  async close(): Promise<void> {
    this.intentionalClose = true

    if (!this.socket)
      return

    this.socket.close()
    this.socket = null
  }
}
