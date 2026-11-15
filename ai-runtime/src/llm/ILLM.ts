export type LLMTextHandler = (text: string) => void

// Spoken while a provider waits out a rate-limit retry. Passed through
// onText like any other delta, but test-token.ts recognises this exact
// string and sends it straight to TTS: at 19 characters it is under
// MIN_CHUNK_CHARS, so the sentence chunker used to hold it until the real
// reply arrived and the caller heard both back to back (2026-10-07).
export const RATE_LIMIT_FILLER = 'One moment, please. '

// Running totals for one call's whole conversation (one ILLM instance =
// one call, per how OpenAILLM/GroqLLM are both constructed in
// test-token.ts) - used only for the call-log usage estimate on the
// dashboard's Usage page (see CallLogClient.ts), not on any latency-
// critical path.
// One spoken turn of the conversation, provider-neutral. Used by
// FallbackLLM to keep two providers' histories in step (see setHistory).
export type HistoryEntry = {
  role: 'user' | 'assistant'
  text: string
}

export type LLMUsageTotals = {
  promptTokens: number
  completionTokens: number
}

export interface ILLM {
  // Seeds the conversation history with an assistant-authored message
  // that was already spoken to the caller BEFORE any real LLM call ran -
  // the proactive greeting (see buildGreetingText() in
  // buildSystemPrompt.ts and beginCall() in test-token.ts, which speaks
  // it directly via the TTS queue without an LLM round-trip at all).
  // Without this, the model has no way of knowing the greeting already
  // happened and would be liable to repeat/re-introduce itself on the
  // first real turn. Must be called at most once, before the first
  // generate()/generateStream() call - implementations are free to
  // assume that ordering.
  primeGreeting(text: string): void

  // Appends one already-completed user/assistant exchange directly into
  // this instance's own conversation history, with NO API call - used
  // only by FallbackLLM.ts to replay the conversation so far into a
  // freshly-constructed fallback provider at the moment of a mid-call
  // provider switch (see FallbackLLM.ts), so the fallback's first real
  // request already has full context instead of starting blind or
  // making the caller repeat themselves. Must be called only before this
  // instance's own generate()/generateStream() has run for the first
  // time (mirrors primeGreeting()'s ordering requirement) -
  // implementations are free to assume that ordering. Async-capable
  // (RealtimeLLM needs its socket connected first) even though most
  // implementations are synchronous - callers always await it.
  seedTurn(userText: string, assistantText: string): void | Promise<void>

  generate(prompt: string): Promise<string>

  // signal: aborted when the caller interrupts the assistant mid-turn (see
  // test-token.ts's onInterruption handler). Implementations must return
  // whatever partial text was generated so far rather than throwing - same
  // "stop early, return gracefully, let the caller's generation check
  // discard it" contract TTSSentenceQueue.synthesize() already uses for
  // TTS. Without this, an interrupted turn's LLM call previously kept
  // running to completion in the background even though its output was
  // being thrown away, which held up the next turn's LLM call behind it
  // (see the transcriptQueue serialization in test-token.ts) - up to
  // several real seconds of dead air on a real call.
  // contextNote: an optional one-off note injected as extra context for
  // THIS call only (not meant to become a permanent part of the
  // conversation) - currently used by test-token.ts to tell the model
  // when the caller's previous message interrupted one of the
  // assistant's own not-yet-finished questions, so a short reply like
  // "yeah"/"sure" that follows is read as answering/confirming that
  // question instead of prompting the model to just re-ask it (observed
  // on real calls - see voiceai_runtime_status.md). GroqLLM keeps this
  // out of its persistent message-history array; OpenAILLM's
  // previous_response_id chaining can't offer that same guarantee (see
  // the comment on OpenAILLM's buildInput) but the note is harmless if it
  // lingers.
  generateStream(
    prompt: string,
    onText: LLMTextHandler,
    signal?: AbortSignal,
    contextNote?: string,
  ): Promise<string>

  getUsageTotals(): LLMUsageTotals

  // Fire-and-forget: opens/refreshes the provider connection ahead of an
  // anticipated real generate()/generateStream() call. Mirrors
  // ITTS.warmUp() (see ITTS.ts for the full connection-pooling
  // rationale) - added for GroqLLM specifically after a real call showed
  // its first request of a freshly-started process cost 3+ extra
  // seconds just establishing a connection (see GroqLLM.ts's
  // warmUpGroqConnection). Optional: a provider with no such connection-
  // setup cost worth guarding against (or that hasn't implemented this
  // yet) can simply omit it - callers use optional chaining
  // (llm.warmUp?.()) rather than assuming it exists.
  warmUp?(): void

  // Replaces the conversation history (everything after the system
  // prompt). FallbackLLM calls this before switching a turn to a
  // provider that didn't produce the latest turns.
  setHistory?(entries: HistoryEntry[]): void

  // Fire-and-forget: releases whatever underlying connection this
  // implementation opened, once a call has ended and this instance will
  // never be used again. Added alongside RealtimeLLM (see
  // RealtimeLLM.ts) - unlike every REST-based ILLM (Groq/Gemini/
  // Fireworks/OpenRouter/OpenAI), a Realtime-API-backed implementation
  // holds an actual persistent WebSocket open for the connection's own
  // lifetime, not just for the duration of one HTTP request - without an
  // explicit teardown hook, that connection would just leak (stay open
  // until GC finalizes it, with no guaranteed timing) across every
  // sequential call this process ever handles. Optional for the same
  // reason warmUp?() is: a REST-based provider has no connection of its
  // own to release, so it can simply omit this - callers use optional
  // chaining (llm.close?.()) rather than assuming it exists.
  close?(): void
}
