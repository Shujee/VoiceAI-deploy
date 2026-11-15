import OpenAI from 'openai'
import { ITTS } from './ITTS.js'
import { streamPcmChunks } from './streamPcmChunks.js'

export class OpenAITTS implements ITTS {
  private readonly client: OpenAI

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey)
      throw new Error('OPENAI_API_KEY is not configured')

    this.client = new OpenAI({ apiKey })
  }

  async *synthesize(
    text: string,
    signal?: AbortSignal,
  ): AsyncGenerator<Int16Array, void, void> {
    // Captured before the request is even sent, not after - the shared
    // streamPcmChunks() helper's firstByteAt log depends on this being the
    // true request-sent moment, not e.g. after headers already arrived.
    const requestSentAt = Date.now()

    const response = await this.client.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      // Character: soft-spoken, friendly female agent. Speed is left at
      // default (no `speed` param) - that's a straight audio-level
      // time-stretch and isn't what makes delivery sound robotic, and
      // there's no latency reason to touch it right now.
      //
      // `instructions` came back after being pulled earlier this session
      // over a false-interruption scare (see git history) - re-examined
      // since: the real causes of every false/bad interruption turned out
      // to be the sentence-splitter mis-detecting abbreviations as
      // sentence ends (fixed in test-token.ts's extractTTSChunks) and
      // TTSSentenceQueue cancelling an item before its first published
      // chunk (fixed via activeItemHasPublishedAudio/protectedGeneration).
      // Both are fixed now. This instructions string is scoped to TONE
      // ONLY, not pace/energy, specifically avoiding words like "brisk"
      // or "quickly" that plausibly drove the original echo-triggered
      // false positives - if the same [STT] local RMS gate pattern shows
      // up again right after a turn finishes with nothing queued/active,
      // suspect this line first.
      voice: 'shimmer',
      instructions: 'Speak naturally, like a real person on the phone - warm and conversational, with normal pitch variation and sentence rhythm. Avoid a flat, monotonous, or robotic reading-off-a-script tone.',
      input: text,
      response_format: 'pcm',
    }, {
      signal,
    })

    console.log(
      `[Timing] [OpenAI] TTS response headers: ${Date.now() - requestSentAt} ms ` +
      `since request sent`,
    )

    const body = response.body

    if (!body)
      throw new Error('[TTS] [OpenAI] streaming response has no body')

    yield* streamPcmChunks(body.getReader(), requestSentAt, text, signal, {
      providerLabel: 'OpenAI',
    })
  }

  // See ITTS.warmUp() for the full reasoning (this app doesn't currently
  // run with TTS_PROVIDER=openai, but keeping this implementation
  // consistent with RimeTTS.ts avoids silently losing the optimization if
  // that ever changes).
  warmUp(): void {
    const requestSentAt = Date.now()

    this.client.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'shimmer',
      input: 'Hi',
      response_format: 'pcm',
    })
      .then(async response => {
        console.log(
          `[TTS] [OpenAI] Warm-up ping: ${Date.now() - requestSentAt} ms`,
        )
        // IMPORTANT: do NOT call response.body?.cancel() here - it aborts
        // the request and destroys the socket instead of releasing it to
        // the keep-alive pool, silently defeating this warm-up (see
        // RimeTTS.ts's warmUp() for the full story - confirmed via a real
        // call log where every turn's first TTS request still paid the
        // full cold-connection cost despite a logged "successful" ping).
        // Fully draining the body lets the socket go back to the pool.
        await response.arrayBuffer()
      })
      .catch(error => {
        console.warn('[TTS] [OpenAI] Warm-up ping failed (harmless, ignoring):', error)
      })
  }
}
