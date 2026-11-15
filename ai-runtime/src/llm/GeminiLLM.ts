import { GoogleGenAI, type Content } from '@google/genai'
import { RATE_LIMIT_FILLER, type HistoryEntry, type ILLM, type LLMTextHandler, type LLMUsageTotals } from './ILLM.js'
import { cleanSpokenReply } from '../knowledge-base/buildSystemPrompt.js'

// CHANGED 2026-09-03 (same day as the first version of this file): the
// OpenAI-compatible endpoint this file originally used
// (generativelanguage.googleapis.com/v1beta/openai/chat/completions) 404'd
// on the very first real call. Root cause, confirmed via web search against
// Google's own AI Studio forum: AI Studio now issues API keys with an "AQ."
// prefix by default (the older "AIzaSy..." format is being phased out this
// same month), and AQ.-prefixed keys have a documented, still-unresolved
// bug where they don't work reliably against the OpenAI-compatible route -
// reported variously as 404, 401 invalid_api_key, and "Multiple
// authentication credentials received" depending on account/timing (see
// https://discuss.ai.google.dev/t/new-aq-prefix-api-keys-fail-on-openai-compatible-endpoints-with-multiple-authentication-credentials-received/140545
// and https://discuss.ai.google.dev/t/account-restricted-to-aq-keys-all-return-401-access-token-type-unsupported-on-generativelanguage-googleapis-com-requesting-fix-aiza-restoration/175424).
// AQ. keys DO work against Gemini's native API - which is what this
// rewrite uses instead, via Google's official @google/genai SDK
// (`pnpm add @google/genai` needed once inside the ai-runtime container -
// this dependency didn't exist in package.json before). This sidesteps
// the whole key-format issue rather than depending on Google fixing it,
// and should keep working whichever key format this account ends up with.
const DEFAULT_MODEL = 'gemini-2.5-flash-lite'

// Gemini's own docs (ai.google.dev/gemini-api/docs/caching) name the
// implicit-caching usage field usage.total_cached_tokens for the OpenAI-
// compatible route; the native API (used here) reports the same
// information as usageMetadata.cachedContentTokenCount instead - yet
// another shape difference on top of the AQ-key issue above. Logging the
// raw usageMetadata object unconditionally (rather than gating on one
// field name that may turn out wrong) is the same lesson learned on
// GroqLLM.ts's logCacheUsage: get the real shape from a real response
// instead of guessing further from docs.
//
// UPDATE 2026-09-03, first real call: cachedContentTokenCount never
// appeared once across a whole conversation (9 turns, prompt growing
// 2354 -> 2510 tokens, comfortably above the documented 2,048-token
// minimum for this model). Same dead end as Groq's caching investigation
// (see GroqLLM.ts) - but this time it's independently corroborated by
// Google's own AI Studio forum: "Gemini 2.5 Flash Lite: Implicit Caching
// Not Working Despite Meeting Documented Requirements" (one user: zero
// cache hits across 377 calls at ~1551 tokens/request; others report the
// real-world threshold behaves more like 3,000+ tokens regardless of
// what the docs say) - a separate thread even notes flash-lite is
// missing from the caching docs' model table entirely. Conclusion: this
// is a genuine, unresolved platform-level gap on Google's side, not
// something wrong with this integration - leaving the unconditional log
// in place in case that ever changes, but not worth chasing further.
function logCacheUsage(usageMetadata: unknown, logLabel: string): void {
  console.log(
    `[Timing] [${logLabel}] Usage (checking for cache fields): ${JSON.stringify(usageMetadata)}`,
  )
}

// Added 2026-09-03 after the first real multi-turn call showed one
// ordinary turn ("Sure.", expected to be a near-instant [[NO_REPLY]])
// take 16.4 SECONDS to complete, stalling the next turn behind it in
// the transcript queue for another 10+ seconds on top of that - the
// exact "silent SDK retry masquerading as a slow model" shape already
// root-caused once this session for Groq (see GroqLLM.ts's
// withRateLimitRetry comment history). Confirmed here too: @google/genai
// retries HTTP 408/429/5xx automatically by default, up to 5 attempts,
// 1s initial delay doubling each time (uncapped by us) up to a 60s max -
// a worst case of tens of seconds of dead air on a live call, with
// NOTHING surfaced to this code to explain it. Fixed the same way:
// retryOptions: { attempts: 1 } on the client (see the constructor
// below) disables the SDK's own retry entirely, replaced with the same
// bounded/observable retry + spoken-filler pattern as GroqLLM.ts.
const MAX_RATE_LIMIT_RETRIES = 2
const RATE_LIMIT_RETRY_CAP_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// @google/genai's ApiError exposes a numeric `status` (see
// https://googleapis.github.io/js-genai/release_docs/classes/errors.ApiError.html)
// but no response-header access, so unlike GroqLLM.ts's
// extractRetryAfterMs there's no Retry-After to prefer - every retry
// here just waits the flat capped delay. Retrying on 5xx in addition to
// 429 matches the SDK's own default retryable-status list (408/429/5xx)
// rather than assuming this is only ever a rate-limit issue the way
// Groq's version does.
async function withRateLimitRetry<T>(
  attempt: (tryNum: number) => Promise<T>,
  onRetrying?: (waitMs: number, tryNum: number) => void,
): Promise<T> {
  for (let tryNum = 0; ; tryNum++) {
    try {
      return await attempt(tryNum)
    } catch (error) {
      const status = (error as { status?: number } | undefined)?.status
      const isRetryable = status === 429 || (status !== undefined && status >= 500)

      if (!isRetryable || tryNum >= MAX_RATE_LIMIT_RETRIES)
        throw error

      console.warn(
        `[LLM] [Gemini] Retryable error (status ${status}) - retrying in ` +
        `${RATE_LIMIT_RETRY_CAP_MS} ms (attempt ${tryNum + 1}/${MAX_RATE_LIMIT_RETRIES})`,
      )

      onRetrying?.(RATE_LIMIT_RETRY_CAP_MS, tryNum)

      await sleep(RATE_LIMIT_RETRY_CAP_MS)
    }
  }
}

export class GeminiLLM implements ILLM {
  private readonly client: GoogleGenAI
  private readonly model: string
  private readonly systemInstruction: string
  private readonly history: Content[] = []
  private readonly logLabel: string

  private promptTokens = 0
  private completionTokens = 0

  constructor(apiKey: string, systemPrompt: string, logLabel = 'Gemini') {
    // retryOptions: { attempts: 1 } ("If 0 or 1, it means no retries" -
    // see withRateLimitRetry above) disables the SDK's own silent retry
    // so withRateLimitRetry is the only thing ever waiting out a
    // 429/5xx, with a capped, observable delay instead of an
    // unbounded one.
    //
    // timeout: added 2026-09-08 - previously unset, which per
    // @google/genai's HttpOptions type has no documented default,
    // meaning a single attempt that never errors and never responds
    // (a stalled connection, not a 429/5xx) could hang indefinitely -
    // worse than the dead air this same day's fix closed off in
    // GroqLLM.ts/test-token.ts, since nothing would ever throw for
    // withRateLimitRetry or dispatchTranscript's own catch to react to.
    // 10s comfortably covers every real completion seen so far (under
    // 2s normally) plus headroom, without letting one stuck request
    // silently stall an entire call.
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: { retryOptions: { attempts: 1 }, timeout: 10_000 },
    })
    this.model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL
    // Unlike the OpenAI-compatible chat.completions shape, the native API
    // takes the system prompt as its own top-level config field rather
    // than a message in the array - see generate()/generateStream() below.
    this.systemInstruction = systemPrompt
    this.logLabel = logLabel
  }

  primeGreeting(text: string): void {
    this.history.push({ role: 'model', parts: [{ text }] })
  }

  seedTurn(userText: string, assistantText: string): void {
    this.history.push({ role: 'user', parts: [{ text: userText }] })
    this.history.push({ role: 'model', parts: [{ text: assistantText }] })
  }

  setHistory(entries: HistoryEntry[]): void {
    this.history.splice(
      0,
      Infinity,
      ...entries.map(({ role, text }) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text }] })),
    )
  }

  getUsageTotals(): LLMUsageTotals {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
    }
  }

  private recordUsage(usageMetadata: unknown): void {
    logCacheUsage(usageMetadata, this.logLabel)
    const usage = usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number }
      | null
      | undefined
    if (usage) {
      this.promptTokens += usage.promptTokenCount ?? 0
      this.completionTokens += usage.candidatesTokenCount ?? 0
    }
  }

  async generate(prompt: string): Promise<string> {
    const startedAt = Date.now()

    this.history.push({ role: 'user', parts: [{ text: prompt }] })

    const response = await withRateLimitRetry(() =>
      this.client.models.generateContent({
        model: this.model,
        contents: this.history,
        config: { systemInstruction: this.systemInstruction },
      }),
    )

    const text = response.text ?? ''

    if (response.usageMetadata) {
      this.recordUsage(response.usageMetadata)
    }

    console.log(
      `[Timing] [${this.logLabel}] LLM complete: ${Date.now() - startedAt} ms`,
    )

    this.history.push({ role: 'model', parts: [{ text }] })

    return text
  }

  async generateStream(
    prompt: string,
    onText: LLMTextHandler,
    signal?: AbortSignal,
    contextNote?: string,
  ): Promise<string> {
    const startedAt = Date.now()

    this.history.push({ role: 'user', parts: [{ text: prompt }] })

    // contextNote (see ILLM.ts): the native API has no per-turn 'system'
    // role to splice this into mid-conversation the way GroqLLM.ts/the
    // old OpenAI-compat version of this file did - contents only supports
    // 'user'/'model'. systemInstruction IS meant for exactly this kind of
    // steering note, so fold it in there instead, for this one request
    // only (this.systemInstruction itself is never mutated).
    const systemInstruction = contextNote
      ? `${this.systemInstruction}\n\n${contextNote}`
      : this.systemInstruction

    let fullText = ''
    let wasAborted = false

    try {
      const stream = await withRateLimitRetry(
        () =>
          this.client.models.generateContentStream({
            model: this.model,
            contents: this.history,
            config: { systemInstruction, abortSignal: signal },
          }),
        (waitMs, tryNum) => {
          // Only announce once (first retry) - see GroqLLM.ts's identical
          // reasoning: filling the dead air during the wait, not after.
          if (tryNum !== 0) return
          fullText += RATE_LIMIT_FILLER
          onText(RATE_LIMIT_FILLER)
        },
      )

      for await (const chunk of stream) {
        if (signal?.aborted) {
          wasAborted = true
          break
        }

        const delta = chunk.text ?? ''
        if (delta) {
          fullText += delta
          onText(delta)
        }

        if (chunk.usageMetadata) {
          this.recordUsage(chunk.usageMetadata)
        }
      }
    } catch (error) {
      // Same interruption-vs-real-failure distinction as GroqLLM.ts - an
      // aborted request can surface as a thrown error here (fetch/
      // AbortController shape) rather than the async iterator just
      // ending on its own.
      if (signal?.aborted) {
        console.log(
          '[LLM] [Gemini] Turn aborted mid-stream (caller interrupted) - stopping early',
        )
        return fullText
      }

      throw error
    }

    if (wasAborted) {
      console.log(
        '[LLM] [Gemini] Turn aborted mid-stream (caller interrupted) - stopping early',
      )
      return fullText
    }

    console.log(
      `[Timing] [${this.logLabel}] LLM complete: ${Date.now() - startedAt} ms`,
    )

    const reply = cleanSpokenReply(fullText)
    this.history.push({ role: 'model', parts: [{ text: reply }] })

    return reply
  }
}
