import type { HistoryEntry, ILLM, LLMTextHandler, LLMUsageTotals } from './ILLM.js'

// Wraps a primary ILLM with a fallback provider (LLM_FALLBACK_PROVIDER).
//
// History: added 2026-09-04 as a one-way switch - the first time the
// primary threw (Groq's 8K TPM ceiling), the rest of the call moved to
// the fallback for good. Changed 2026-10-07 to PER-TURN fallback: Groq is
// usually the faster provider (first text in ~0.4-0.7s vs Gemini's
// ~1.1-1.4s), and its failures come in short spells (a TPM window that
// resets within a minute, or a few turns of Groq-side queueing), so
// giving it up for the whole call threw away its speed for no reason.
//
// Now every turn tries the primary first; if it throws (429 with no
// retries, or GroqLLM's first-token timeout), that one turn is answered
// by the fallback. After a failure the primary is skipped for
// PRIMARY_COOLDOWN_MS, so a congested spell doesn't add the failed
// attempt's delay to every turn.
//
// Keeping two providers in step: each concrete ILLM keeps its own private
// history. This class keeps the canonical one (`history`) and, before a
// provider handles a turn, calls its setHistory() if it isn't the one that
// produced the latest entries (`inSync`). A provider that threw may hold a
// dangling user message, which that resync also overwrites.
//
// An aborted turn (caller interrupted / kept talking - see test-token.ts)
// is not an error: its user message is recorded without a reply, matching
// what the provider itself keeps, so a continuation is answered together
// with it whichever provider handles the next turn.
const PRIMARY_COOLDOWN_MS = 20_000

export class FallbackLLM implements ILLM {
  private readonly primary: ILLM
  private fallback: ILLM | null = null
  private readonly history: HistoryEntry[] = []
  // The provider whose own history currently matches `history`.
  private inSync: ILLM | null = null
  private primarySkippedUntil = 0
  private readonly logLabel: string

  constructor(
    primary: ILLM,
    private readonly createFallback: () => ILLM,
    logLabel = 'Fallback',
  ) {
    this.primary = primary
    this.logLabel = logLabel
  }

  primeGreeting(text: string): void {
    this.history.push({ role: 'assistant', text })
    this.primary.primeGreeting(text)
    this.inSync = this.primary
  }

  async seedTurn(userText: string, assistantText: string): Promise<void> {
    this.history.push({ role: 'user', text: userText }, { role: 'assistant', text: assistantText })
    await this.primary.seedTurn(userText, assistantText)
    this.inSync = this.primary
  }

  getUsageTotals(): LLMUsageTotals {
    const primaryUsage = this.primary.getUsageTotals()
    const fallbackUsage = this.fallback?.getUsageTotals()

    return {
      promptTokens: primaryUsage.promptTokens + (fallbackUsage?.promptTokens ?? 0),
      completionTokens: primaryUsage.completionTokens + (fallbackUsage?.completionTokens ?? 0),
    }
  }

  warmUp(): void {
    this.primary.warmUp?.()
    this.fallback?.warmUp?.()
  }

  close(): void {
    this.primary.close?.()
    this.fallback?.close?.()
  }

  private getFallback(): ILLM {
    this.fallback ??= this.createFallback()
    return this.fallback
  }

  private prepare(llm: ILLM): void {
    if (this.inSync === llm)
      return

    if (!llm.setHistory)
      throw new Error(`[${this.logLabel}] provider has no setHistory() - cannot hand it this conversation`)

    llm.setHistory(this.history)
    this.inSync = llm
  }

  private record(llm: ILLM, prompt: string, reply: string | null): void {
    this.history.push({ role: 'user', text: prompt })
    if (reply !== null)
      this.history.push({ role: 'assistant', text: reply })
    this.inSync = llm
  }

  private async run<T>(
    attempt: (llm: ILLM) => Promise<T>,
    describe: (result: T) => { prompt: string; reply: string | null },
    isAborted: () => boolean = () => false,
  ): Promise<T> {
    if (Date.now() >= this.primarySkippedUntil) {
      try {
        this.prepare(this.primary)
        const result = await attempt(this.primary)
        const { prompt, reply } = describe(result)
        this.record(this.primary, prompt, reply)
        return result
      } catch (error) {
        // The primary may now hold a dangling user message - force a
        // resync before it's used again.
        this.inSync = null

        // The caller interrupted - nothing to answer, so no fallback.
        if (isAborted())
          throw error
        this.primarySkippedUntil = Date.now() + PRIMARY_COOLDOWN_MS

        console.warn(
          `[LLM] [${this.logLabel}] Primary provider failed ` +
          `(${(error as { message?: string } | undefined)?.message ?? error}) - ` +
          `answering this turn with the fallback, primary skipped for ${PRIMARY_COOLDOWN_MS / 1000}s`,
        )
      }
    }

    const fallback = this.getFallback()
    this.prepare(fallback)

    try {
      const result = await attempt(fallback)
      const { prompt, reply } = describe(result)
      this.record(fallback, prompt, reply)
      return result
    } catch (error) {
      this.inSync = null
      throw error
    }
  }

  async generate(prompt: string): Promise<string> {
    return this.run(
      llm => llm.generate(prompt),
      text => ({ prompt, reply: text }),
    )
  }

  async generateStream(
    prompt: string,
    onText: LLMTextHandler,
    signal?: AbortSignal,
    contextNote?: string,
  ): Promise<string> {
    // A caller abort is never retried on the fallback: generateStream
    // returns (not throws) on abort, and the partial reply is discarded
    // by the caller, so only the user message is recorded.
    return this.run(
      llm => llm.generateStream(prompt, onText, signal, contextNote),
      text => ({ prompt, reply: signal?.aborted ? null : text }),
      () => !!signal?.aborted,
    )
  }
}
