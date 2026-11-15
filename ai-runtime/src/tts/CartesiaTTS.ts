import { ITTS } from './ITTS.js'
import { streamPcmChunks } from './streamPcmChunks.js'

// Cartesia's HTTP TTS endpoint (POST, complete-response - not the
// WebSocket streaming API). Mirrors the same choice already made for
// Rime (see RimeTTS.ts): TTSSentenceQueue treats each queued sentence as
// one independent synthesize() call, not a persistent multi-turn
// session, so the plain HTTP endpoint is the simpler, equally-capable
// choice here too. Docs: https://docs.cartesia.ai/api-reference/tts/bytes
const CARTESIA_TTS_URL = 'https://api.cartesia.ai/tts/bytes'

// Required on every request as of this writing - Cartesia versions its
// API via this header rather than the URL path. Bump this if Cartesia
// ships a newer version and this one gets deprecated.
const CARTESIA_VERSION = '2026-08-14'

// sonic-3.6: Cartesia's newest/highest-quality model at the time this was
// written - #1 on Artificial Analysis's speech leaderboards (both
// Provider Voice and Controlled Voice categories), which is the whole
// reason Cartesia is being evaluated as a Rime replacement in the first
// place. If a faster/cheaper tier is ever needed instead, Cartesia also
// offers sonic-3 and a "Turbo" mode - swap MODEL_ID, request/response
// shape below is unaffected.
const MODEL_ID = 'sonic-3.6'

// Gemma - "a confident, crisp British voice" (see
// https://cartesia.ai/voices/british-accent) - confirmed by real-call
// testing (2026-09-02) as the voice we're actually settling on, same
// role as RimeTTS.ts's DEFAULT_SPEAKER. Exported so callers (test-token.ts)
// can log which voice ended up in use without duplicating this string.
export const DEFAULT_VOICE_ID = '62ae83ad-4f6a-430b-af41-a9bede9286ca'

// Businesses' voice_id column currently stores RIME voice ids ('vashti',
// 'albion', ...) from before this switch - those aren't valid Cartesia
// voice ids, so blindly passing one through would make every synthesize()
// call fail. This guards against that: only a value that's actually
// shaped like a Cartesia voice id (a UUID) is used; anything else
// (including a Rime-style name, null, or unset) falls back to
// DEFAULT_VOICE_ID. A real per-business Cartesia voice picker/config
// (mirroring backend/config/rime_voices.php, offering Gemma/Archie/
// Benedict/Claire) is still a fast-follow - until then every business
// speaks as Gemma.
const CARTESIA_VOICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class CartesiaTTS implements ITTS {
  private readonly apiKey: string
  // Public (not private, unlike RimeTTS's speaker) specifically so
  // callers can log the TRUE resolved voice id - since this class can
  // silently fall back away from whatever was passed in (see the guard
  // in the constructor below), echoing the raw input elsewhere would be
  // misleading about what's actually being spoken.
  readonly voiceId: string

  // `voiceId` mirrors RimeTTS's `speaker` param - a business's voice_id,
  // when it happens to actually be a valid Cartesia voice id. Falls back
  // to CARTESIA_VOICE_ID (handy for testing a different voice without a
  // code change) and finally to DEFAULT_VOICE_ID (Gemma), same fallback
  // chain shape as RimeTTS's DEFAULT_SPEAKER.
  constructor(voiceId?: string | null) {
    const apiKey = process.env.CARTESIA_API_KEY

    if (!apiKey)
      throw new Error('CARTESIA_API_KEY is not configured')

    const candidates = [voiceId, process.env.CARTESIA_VOICE_ID]
    const resolved = candidates.find(id => id && CARTESIA_VOICE_ID_PATTERN.test(id))

    this.apiKey = apiKey
    this.voiceId = resolved ?? DEFAULT_VOICE_ID
  }

  private requestBody(text: string) {
    return JSON.stringify({
      model_id: MODEL_ID,
      transcript: text,
      voice: { id: this.voiceId },
      // "locale" (not "language") biases pronunciation/normalization
      // toward British English - Cartesia's docs are explicit that
      // language and locale are mutually exclusive, so language is
      // deliberately omitted here.
      locale: 'en-GB',
      output_format: {
        // Headerless raw PCM - same wire format Rime's audio/L16 and
        // OpenAI's response_format: 'pcm' already give us, so
        // streamPcmChunks() needs no changes to consume this too. NOT
        // 'wav' - that would prepend a 44-byte header streamPcmChunks
        // doesn't know to skip.
        container: 'raw',
        encoding: 'pcm_s16le',
        // Matches LiveKitTransport's AudioSource sample rate exactly,
        // same reasoning as RimeTTS.ts - zero resampling needed.
        sample_rate: 24000,
      },
    })
  }

  async *synthesize(
    text: string,
    signal?: AbortSignal,
  ): AsyncGenerator<Int16Array, void, void> {
    const requestSentAt = Date.now()

    const response = await fetch(CARTESIA_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Cartesia-Version': CARTESIA_VERSION,
        'Content-Type': 'application/json',
      },
      body: this.requestBody(text),
      signal,
    })

    console.log(
      `[Timing] [Cartesia] TTS response headers: ${Date.now() - requestSentAt} ms ` +
      `since request sent`,
    )

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(failed to read error body)')
      throw new Error(
        `[TTS] [Cartesia] request failed: ${response.status} ${response.statusText} - ${errorBody}`,
      )
    }

    const body = response.body

    if (!body)
      throw new Error('[TTS] [Cartesia] streaming response has no body')

    yield* streamPcmChunks(body.getReader(), requestSentAt, text, signal, {
      providerLabel: 'Cartesia',
    })
  }

  // See ITTS.warmUp() and RimeTTS.ts's warmUp() for the full reasoning
  // and the arrayBuffer()-not-cancel() lesson learned there (canceling a
  // ReadableStream mid-flight destroys the socket instead of releasing it
  // to the keep-alive pool - fully draining it is what actually lets the
  // connection be reused).
  warmUp(): void {
    const requestSentAt = Date.now()

    fetch(CARTESIA_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Cartesia-Version': CARTESIA_VERSION,
        'Content-Type': 'application/json',
      },
      body: this.requestBody('Hi'),
    })
      .then(async response => {
        console.log(
          `[TTS] [Cartesia] Warm-up ping: ${Date.now() - requestSentAt} ms ` +
          `(response ${response.status})`,
        )
        await response.arrayBuffer()
      })
      .catch(error => {
        console.warn('[TTS] [Cartesia] Warm-up ping failed (harmless, ignoring):', error)
      })
  }
}
