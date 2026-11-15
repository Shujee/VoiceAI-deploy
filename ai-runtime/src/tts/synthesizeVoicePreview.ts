// One-shot, non-streaming Cartesia synthesis for the admin dashboard's
// "hear a sample" button (VoiceController::preview() on the backend
// proxies here) - deliberately separate from CartesiaTTS.ts's
// synthesize(), which is built around the live-call pipeline's needs
// (a streaming AsyncGenerator of headerless raw PCM chunks, fed straight
// into streamPcmChunks()/LiveKitTransport). A preview has none of that:
// it's a single short clip a browser <audio> element needs to just play,
// so this asks Cartesia for a normal 'wav' container (with its header)
// instead of 'raw', and returns the whole buffer at once.
const CARTESIA_TTS_URL = 'https://api.cartesia.ai/tts/bytes'
const CARTESIA_VERSION = '2026-08-14'
const MODEL_ID = 'sonic-3.6'

// Same shape check CartesiaTTS.ts uses - only pass through something that
// actually looks like a Cartesia voice id, since this ultimately reaches
// an admin-triggered HTTP call and a malformed id should fail fast with a
// clear error rather than being sent to Cartesia as free-form input.
const CARTESIA_VOICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Generic - not business-specific, since the dashboard's voice picker is
// a global list (config/cartesia_voices.php on the backend), not scoped
// to one business's own knowledge base.
const PREVIEW_TEXT = 'Hi there! This is a quick preview of how I sound.'

export class InvalidVoiceIdError extends Error {}

export async function synthesizeVoicePreview(
  voiceId: string,
): Promise<{ buffer: Buffer, contentType: string }> {
  if (!CARTESIA_VOICE_ID_PATTERN.test(voiceId))
    throw new InvalidVoiceIdError(`"${voiceId}" doesn't look like a Cartesia voice id`)

  const apiKey = process.env.CARTESIA_API_KEY

  if (!apiKey)
    throw new Error('CARTESIA_API_KEY is not configured')

  const requestSentAt = Date.now()

  const response = await fetch(CARTESIA_TTS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Cartesia-Version': CARTESIA_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_id: MODEL_ID,
      transcript: PREVIEW_TEXT,
      voice: { id: voiceId },
      locale: 'en-GB',
      output_format: {
        // 'wav', unlike CartesiaTTS.ts's 'raw' - a browser <audio> element
        // needs the header to know how to decode the bytes that follow.
        container: 'wav',
        encoding: 'pcm_s16le',
        sample_rate: 24000,
      },
    }),
  })

  console.log(
    `[Timing] [Cartesia] Voice preview response headers: ${Date.now() - requestSentAt} ms ` +
    `since request sent (voice ${voiceId})`,
  )

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '(failed to read error body)')
    throw new Error(
      `[TTS] [Cartesia] preview request failed: ${response.status} ${response.statusText} - ${errorBody}`,
    )
  }

  const arrayBuffer = await response.arrayBuffer()

  return { buffer: Buffer.from(arrayBuffer), contentType: 'audio/wav' }
}
