import { ITTS } from './ITTS.js'
import { streamPcmChunks } from './streamPcmChunks.js'

// Rime's HTTP streaming TTS endpoint. Chosen over Rime's WebSocket
// streaming API (wss://users-ws.rime.ai/ws3) because our TTSSentenceQueue
// already treats each queued sentence as one independent, self-contained
// synthesize() call (see ITTS) rather than a persistent multi-turn
// session - the WebSocket API's real advantage (one connection reused
// across many synthesis requests, avoiding a fresh handshake each time)
// doesn't apply to how this app is structured, so the plain HTTP endpoint
// is the simpler, equally-capable choice here. Docs:
// https://docs.rime.ai/api-reference/endpoint/streaming-pcm
const RIME_TTS_URL = 'https://users.rime.ai/v1/rime-tts'

// Coda: Rime's flagship model - highest voice-quality/naturalness scores,
// sub-100ms time-to-first-byte per Rime's own docs. Picked over Mist v3
// (Rime's fastest, ~37ms P50 TTFA vs Coda's ~96ms) because naturalness was
// the explicit priority for this swap - Coda is still dramatically faster
// than what OpenAI was measured at in this app's own logs (1-2s+), so the
// ~60ms difference from Mist v3 isn't worth trading voice quality for.
// If pure lowest-latency ever becomes the priority instead, swap this to
// 'mistv3' - the request/response shape below is identical either way.
const MODEL_ID = 'coda'

// "Bright, lively Californian; quick and expressive." Full voice list:
// https://docs.rime.ai/docs/voices — this is now only the FALLBACK
// default (see constructor below), used when a business has no voice_id
// set. Exported so callers (test-token.ts) can log which voice actually
// ended up in use without duplicating this string.
export const DEFAULT_SPEAKER = 'astra'

export class RimeTTS implements ITTS {
  private readonly apiKey: string
  private readonly speaker: string

  // `speaker` is a business's chosen Rime voice id (its voice_id field -
  // see BusinessKnowledgeBase and backend/config/rime_voices.php for the
  // curated list the dashboard picker offers). Falls back to
  // DEFAULT_SPEAKER when null/undefined/empty, i.e. a business hasn't
  // picked one yet, or ai-runtime is running on FALLBACK_KNOWLEDGE_BASE
  // with no KB data at all.
  constructor(speaker?: string | null) {
    const apiKey = process.env.RIME_API_KEY

    if (!apiKey)
      throw new Error('RIME_API_KEY is not configured')

    this.apiKey = apiKey
    this.speaker = speaker || DEFAULT_SPEAKER
  }

  async *synthesize(
    text: string,
    signal?: AbortSignal,
  ): AsyncGenerator<Int16Array, void, void> {
    // Captured before the request is even sent, not after - the shared
    // streamPcmChunks() helper's firstByteAt log depends on this being the
    // true request-sent moment, not e.g. after headers already arrived.
    const requestSentAt = Date.now()

    const response = await fetch(RIME_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        // audio/L16 = headerless 16-bit little-endian linear PCM, same
        // wire format OpenAI's response_format: 'pcm' gives us - so
        // streamPcmChunks() needs no changes to consume either provider.
        'Accept': 'audio/L16',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        modelId: MODEL_ID,
        speaker: this.speaker,
        lang: 'eng',
        // Matches LiveKitTransport's AudioSource sample rate exactly (see
        // publishAudio in LiveKitTransport.ts) - zero resampling needed,
        // unlike a provider that only offers a fixed different rate.
        samplingRate: 24000,
      }),
      signal,
    })

    console.log(
      `[Timing] [Rime] TTS response headers: ${Date.now() - requestSentAt} ms ` +
      `since request sent`,
    )

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(failed to read error body)')
      throw new Error(
        `[TTS] [Rime] request failed: ${response.status} ${response.statusText} - ${errorBody}`,
      )
    }

    const body = response.body

    if (!body)
      throw new Error('[TTS] [Rime] streaming response has no body')

    yield* streamPcmChunks(body.getReader(), requestSentAt, text, signal, {
      providerLabel: 'Rime',
    })
  }

  // See ITTS.warmUp() for the full reasoning. Fires the same request
  // shape as synthesize() (a real, tiny, billable synthesis - Rime's API
  // has no cheaper "just open a connection" endpoint) but with a short
  // neutral placeholder that's never played back, and drains+discards the
  // response body instead of yielding it. Deliberately fire-and-forget:
  // a warm-up failure (network hiccup, rate limit) must never surface as
  // an error on the call - the next real synthesize() call will simply
  // pay the normal cold-connection cost it would have paid anyway.
  warmUp(): void {
    const requestSentAt = Date.now()

    fetch(RIME_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'audio/L16',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Hi',
        modelId: MODEL_ID,
        speaker: this.speaker,
        lang: 'eng',
        samplingRate: 24000,
      }),
    })
      .then(async response => {
        console.log(
          `[TTS] [Rime] Warm-up ping: ${Date.now() - requestSentAt} ms ` +
          `(response ${response.status})`,
        )
        // IMPORTANT: do NOT call response.body?.cancel() here. Canceling a
        // ReadableStream mid-flight aborts the underlying request and
        // destroys the socket instead of releasing it to the keep-alive
        // pool - which silently defeated this entire warm-up (confirmed by
        // a real call log: every turn's first TTS request still paid the
        // full ~1000ms cold-connection cost even after a logged
        // "successful" warm-up ping). Fully draining the body via
        // arrayBuffer() lets undici return the socket to the pool as a
        // genuinely reusable keep-alive connection, matching how a real
        // synthesize() call (which reads the whole stream for playback)
        // already keeps later same-turn requests fast.
        await response.arrayBuffer()
      })
      .catch(error => {
        console.warn('[TTS] [Rime] Warm-up ping failed (harmless, ignoring):', error)
      })
  }
}
