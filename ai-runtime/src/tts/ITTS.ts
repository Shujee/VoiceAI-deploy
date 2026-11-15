export interface ITTS {
  // Streaming shape: yields PCM16 chunks as they arrive from the provider
  // instead of resolving once with the full buffer. Each yielded Int16Array
  // is immediately playable audio (2-byte aligned, ready for captureFrame).
  synthesize(
    text: string,
    signal?: AbortSignal,
  ): AsyncGenerator<Int16Array, void, void>

  // Fire-and-forget: opens/refreshes the provider connection ahead of an
  // anticipated real synthesize() call, without playing anything back.
  // Real-call evidence (Sep 2026): Rime's OWN measured response-header
  // latency dropped from ~1000-1200ms on a turn's FIRST sentence to
  // ~400-500ms on that same turn's LATER sentences (same TCP/TLS
  // connection reused for the fast-follow-up requests) - the fresh-
  // connection tax is real and is the single biggest lever on our
  // measured time-to-first-audible-reply, well before the LLM/business
  // logic even produces a sentence to speak. Undici's default keep-alive
  // window (a few seconds) covers back-to-back sentences within one
  // reply, but a caller's next turn is almost always spaced out further
  // than that, so the connection has usually gone cold again by the time
  // it's needed - warmUp() is meant to be called the INSTANT the caller
  // starts speaking again (see OpenAIRealtimeSTT's onSpeechStart in
  // test-token.ts), so the connection has a real head start racing
  // against STT+LLM before the actual synthesize() call needs it.
  // Optional: a provider with no such connection-setup cost (or that
  // hasn't implemented this yet) can simply omit it - callers use
  // optional chaining (tts.warmUp?.()) rather than assuming it exists.
  warmUp?(): void
}