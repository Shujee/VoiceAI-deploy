import OpenAI from 'openai'
import { RATE_LIMIT_FILLER, type HistoryEntry, type ILLM, type LLMTextHandler, type LLMUsageTotals } from './ILLM.js'
import { cleanSpokenReply } from '../knowledge-base/buildSystemPrompt.js'

// Groq's inference API is OpenAI-compatible (chat.completions, not the
// Responses API OpenAILLM.ts uses) - reusing the `openai` package with a
// custom baseURL avoids pulling in Groq's own SDK for what is otherwise an
// identical request shape. Docs: https://console.groq.com/docs/openai
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'

// Back to gpt-oss-120b (2026-09-02, again) after root-causing the
// latency spikes that drove the earlier switch to qwen3.6-27b: every
// stall on either model - 12.4s (gpt-oss-20b), 18.4s/21.7s (gpt-oss-
// 120b), 5.3s/16.4s (qwen3.6-27b) - was the openai SDK silently
// retrying a Groq 429 (see withRateLimitRetry below and the
// [RateLimit] header logging), driven by this account's flat 8K TPM
// cap on ALL three models (confirmed directly against Groq's rate-
// limits docs for the Free plan; CORRECTED 2026-10-07: the pay-as-you-go
// Developer plan does raise TPM well above 8K - Groq's own 429 message
// says so). It was never a gpt-oss-specific quirk.
// gpt-oss-120b gets the edge back because Groq's prompt caching (50%
// discount AND cached tokens don't count against TPM at all - see
// console.groq.com/docs/prompt-caching) currently only covers the
// GPT-OSS family, not Qwen - so this is the one of the two that can
// actually claw back TPM headroom on a cache hit, on top of the
// system-prompt trim and the bounded-retry/filler fallback below for
// whenever a cache miss (or the first turn of a call, always a miss)
// still hits the wall.
const DEFAULT_MODEL = 'openai/gpt-oss-120b'

// Qwen3.6 supports an explicit thinking/non-thinking switch via
// reasoning_effort ("default" = thinking mode, for complex reasoning/
// math/coding; "none" = non-thinking, for efficient general dialogue -
// this app's case). reasoning_format=hidden additionally strips any
// reasoning content from the response entirely, as a defensive backstop
// so a stray thinking-mode leak can never end up read aloud to a caller
// (the same class of failure as gpt-oss's harmony-format leak, just for
// a different model family). Only sent for Qwen models - other models
// (Llama, gpt-oss) don't document these params and there's no reason to
// risk sending them somewhere unproven.
const REASONING_PARAMS = { reasoning_effort: 'none' as const, reasoning_format: 'hidden' as const }

// Added 2026-09-02 after a real call showed ONE ordinary turn ("thanks,
// I'll pass that along...") take 6+ seconds to produce its first token
// with no rate-limit involved at all (remaining-tokens had plenty of
// headroom, no 429/retry fired) - every other turn that same call was
// under 1.7s. Groq's docs confirm gpt-oss-120b/20b support
// reasoning_effort (low/medium/high - "low" means "the model will use a
// small number of reasoning tokens") and, unlike Qwen, gpt-oss does NOT
// support reasoning_format at all - it uses a separate include_reasoning
// boolean instead (Groq's docs: "excludes reasoning from the response").
// This app's job (slot-filling/routing, not math/coding) never needs
// gpt-oss's default (undocumented, presumably not minimal) reasoning
// effort - same rationale as REASONING_PARAMS above for Qwen.
// include_reasoning: false is a secondary bonus, not just a latency
// lever: it should also stop Groq mixing internal reasoning-channel
// markers into the visible response, which is the same class of failure
// as the harmony-format leak (see recoverToolUseFailedText above) - so
// this may incidentally reduce how often that recovery path is needed
// too. Whether reasoning_effort actually explains THIS spike is a
// hypothesis, not a confirmed root cause - watch the new cache/latency
// logging below on future calls to see if it holds up.
const GPT_OSS_REASONING_PARAMS = { reasoning_effort: 'low' as const, include_reasoning: false as const }

function reasoningParamsFor(model: string) {
  if (model.startsWith('qwen/'))
    return REASONING_PARAMS
  if (model.startsWith('openai/gpt-oss'))
    return GPT_OSS_REASONING_PARAMS
  return {}
}

// Added 2026-09-02 while chasing multi-second-to-20+-second LLM stalls
// that have now shown up on THREE different models (gpt-oss-20b,
// gpt-oss-120b, qwen3.6-27b) - ruling out "it's a quirk of one model
// family" as the explanation. The next-likeliest cause is Groq-side
// rate limiting/throttling (this dev-tier account has been hammered
// with a lot of back-to-back test calls across many models today) -
// Groq returns the same x-ratelimit-* headers OpenAI's API does on
// every response, success or error, so logging them turns "is this
// rate limiting?" from a guess into something directly checkable
// against whatever [Timing] gap shows up next to it in the log.
function logRateLimitHeaders(response: Response, logLabel: string): void {
  const remainingRequests = response.headers.get('x-ratelimit-remaining-requests')
  const remainingTokens = response.headers.get('x-ratelimit-remaining-tokens')
  const resetRequests = response.headers.get('x-ratelimit-reset-requests')
  const resetTokens = response.headers.get('x-ratelimit-reset-tokens')
  const retryAfter = response.headers.get('retry-after')

  if (remainingRequests === null && remainingTokens === null && retryAfter === null)
    return

  console.log(
    `[RateLimit] [${logLabel}] remaining-requests=${remainingRequests} ` +
    `remaining-tokens=${remainingTokens} reset-requests=${resetRequests} ` +
    `reset-tokens=${resetTokens}` +
    (retryAfter ? ` retry-after=${retryAfter}` : ''),
  )
}


// Added 2026-09-02 alongside logRateLimitHeaders above - now that TPM
// exhaustion is confirmed as the root cause of the recurring multi-
// second-to-20+-second stalls (see DEFAULT_MODEL's comment history), it
// turned out the openai SDK's own default behavior was the actual
// mechanism producing those stalls: by default the SDK silently retries
// a 429 (honoring Retry-After/backoff) with NOTHING surfaced to this
// code - what looked like "the LLM is just slow this one time" was
// really "the SDK is quietly waiting out a rate limit and then
// succeeding." The client is now constructed with maxRetries: 0 to
// disable that invisible behavior, and this helper replaces it with a
// bounded, OBSERVABLE retry (logged, capped wait, capped attempt count)
// - a real 429 still gets a short retry instead of an instant failed
// call, but never a silent 20+ second hang, and generateStream's caller
// gets the chance to speak a short filler during the wait instead of
// leaving the caller in dead air (see the onRetrying callback wired up
// in generateStream below).
const MAX_RATE_LIMIT_RETRIES = 2
const RATE_LIMIT_RETRY_CAP_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Groq's 429 error carries a Retry-After header same as the rate-limit
// headers logged above - prefer it when present (Groq knows exactly how
// long until the window resets), but always cap it, since honoring an
// arbitrarily long Retry-After unbounded would just recreate the
// original silent-multi-second-hang problem this is meant to fix.
function extractRetryAfterMs(error: unknown): number | undefined {
  const headers = (error as { headers?: unknown } | undefined)?.headers
  if (!headers)
    return undefined

  const raw = typeof (headers as Headers).get === 'function'
    ? (headers as Headers).get('retry-after')
    : (headers as Record<string, string>)['retry-after']

  if (!raw)
    return undefined

  const seconds = Number(raw)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

async function withRateLimitRetry<T>(
  attempt: (tryNum: number) => Promise<T>,
  onRetrying?: (waitMs: number, tryNum: number) => void,
  maxRetries = MAX_RATE_LIMIT_RETRIES,
): Promise<T> {
  for (let tryNum = 0; ; tryNum++) {
    try {
      return await attempt(tryNum)
    } catch (error) {
      const status = (error as { status?: number } | undefined)?.status

      if (status !== 429 || tryNum >= maxRetries)
        throw error

      const waitMs = Math.min(
        extractRetryAfterMs(error) ?? RATE_LIMIT_RETRY_CAP_MS,
        RATE_LIMIT_RETRY_CAP_MS,
      )

      console.warn(
        `[LLM] [Groq] Rate limited (429) - retrying in ${waitMs} ms ` +
        `(attempt ${tryNum + 1}/${maxRetries})`,
      )

      onRetrying?.(waitMs, tryNum)

      await sleep(waitMs)
    }
  }
}

// Groq's prompt caching (console.groq.com/docs/prompt-caching - 50%
// discount AND cached tokens exempt from TPM, gpt-oss-120b/20b only, not
// Qwen - see DEFAULT_MODEL's comment history) reports its hit rate in
// the same usage.prompt_tokens_details.cached_tokens shape OpenAI uses.
// Logging it per turn is what actually lets "is caching landing hits on
// this account" move from a hope to something checkable against the
// [Timing]/[RateLimit] lines already next to it - in particular, whether
// a cache MISS correlates with the rare multi-second stalls (Groq's own
// docs claim caching "improves response times" but don't say what a
// miss costs relative to no caching at all).
function logCacheUsage(
  usage: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null | undefined,
  logLabel: string,
): void {
  // Added 2026-09-02: this used to silently no-op whenever cached_tokens
  // was undefined, on the assumption Groq would still send
  // prompt_tokens_details (just with cached_tokens: 0) on a cache miss,
  // matching OpenAI's shape - a real call at the time showed it never
  // fired across 6 turns of the same conversation resending an identical
  // system-prompt prefix, which is surprising enough (docs claim caching
  // is fully automatic, no opt-in) that it seemed worth seeing the RAW
  // shape Groq actually sends rather than continuing to guess.
  //
  // CORRECTED 2026-09-08, more calls later: it does fire, just not every
  // turn - real logs from the same account/model show cached_tokens
  // present with a real, consistent hit (e.g. "1792/1835 tokens cached",
  // "1792/2596 tokens cached" - always ~1792, the fixed system-prompt+KB
  // portion, with only the newest incremental turn ever uncached) on
  // some turns, and genuinely absent on others within the SAME call,
  // prompt-size and everything else about the request being equal. Best
  // explanation (Groq's docs don't say either way, and there's no
  // request-level control over this): a prefix cache is very likely
  // sharded across backend replicas behind Groq's load balancer, so
  // whether a given request lands on a replica that already has this
  // conversation's prefix warm is probabilistic, not just a function of
  // "has this exact prefix been sent before." Practical upshot: caching
  // is real and worth keeping (see DEFAULT_MODEL above), but it cannot
  // be relied on for every turn, so it's not a substitute for keeping
  // the absolute prompt small - a smaller prompt is cheaper on both a
  // cache hit AND a miss, caching just isn't a case where "make it work
  // more" is a lever this code has any control over.
  //
  // Keep this log line unconditional either way (not just on a miss) -
  // it's still the only way to see the RAW shape (prompt_tokens_details
  // present-with-zero vs. genuinely absent) if Groq's behavior changes
  // again.
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens

  console.log(
    `[Timing] [${logLabel}] Prompt cache: ` +
    (cachedTokens !== undefined
      ? `${cachedTokens}/${usage?.prompt_tokens ?? 0} tokens cached`
      : `prompt_tokens_details absent (raw usage: ${JSON.stringify(usage)})`),
  )
}

// Added 2026-09-02 after a real call showed the first LLM request of a
// freshly-started process take 3+ SECONDS just to get response headers
// back (see the [Timing] LLM response headers log in generateStream
// below) - every later turn that same call got headers back in well
// under 1.2s, confirming this was a cold TCP+TLS handshake to
// api.groq.com, not a generation delay. Mirrors ITTS.warmUp() (see
// CartesiaTTS.ts) - deliberately hits GET /models (a lightweight,
// non-inference listing endpoint) rather than a real chat.completions
// request: unlike Cartesia's "Hi" TTS warm-up ping, a real Groq
// completion would itself cost completion tokens AND count against this
// account's already razor-thin 8K TPM budget every time it fires, which
// would make the rate-limit problem worse, not better. GET /models
// shares the exact same underlying keep-alive connection pool (Node's
// fetch/undici pools by origin - api.groq.com - not by path), so warming
// it here warms the connection a real chat.completions call will reuse.
// Exported standalone (not just as an instance method) because it's
// useful before any GroqLLM instance exists yet - see main() in
// test-token.ts, which fires this once at process boot using
// GROQ_API_KEY directly, well before the first call ever connects.
export function warmUpGroqConnection(apiKey: string, logLabel = 'Groq'): void {
  const requestSentAt = Date.now()

  fetch(`${GROQ_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
    .then(async response => {
      console.log(
        `[LLM] [${logLabel}] Warm-up ping: ${Date.now() - requestSentAt} ms ` +
        `(response ${response.status})`,
      )

      // Fully draining the body (not canceling) is what actually releases
      // the connection back to the keep-alive pool for reuse - same
      // lesson learned the hard way in CartesiaTTS.ts's warmUp().
      await response.arrayBuffer()
    })
    .catch(error => {
      console.warn(`[LLM] [${logLabel}] Warm-up ping failed (harmless, ignoring):`, error)
    })
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// GPT-OSS models on Groq occasionally leak their internal "harmony" format
// channel markers (e.g. `assistant<|channel|>final`) into the raw
// completion, and Groq's server-side tool-call detector misidentifies that
// as an attempted tool call - even though this app never sends any `tools`
// or `tool_choice` in the request (confirmed by inspecting the request
// below: only `model` and `messages` are ever sent). This is a known,
// intermittent gpt-oss-on-Groq quirk (matching reports against both
// gpt-oss-20b and gpt-oss-120b in Groq's own community forum and several
// GitHub issues - OpenHands #10187/#11725, zeroclaw-labs/zeroclaw #970),
// not a bug in this app's request shape, and Groq has no documented fix or
// request parameter to prevent it as of this writing.
//
// The useful part: Groq still includes the model's actual intended reply
// in the error body's `failed_generation` field - as a slightly malformed,
// not-quite-JSON string (observed shape:
// `{"name": "assistant<|channel|>final", "arguments": <the real reply text, unquoted>}`).
// Rather than dropping the whole turn (which would leave a live caller in
// silence - see the `.catch` around processTranscript() in test-token.ts),
// extract that text and use it as the response.
// Both known variants of the gpt-oss harmony-leak quirk (see
// recoverToolUseFailedText below and the first-delta check in
// generateStream) end up as a JSON object whose only useful content is a
// single string value under one of a few likely key names - never the
// same key twice so far (`content` via the tool_use_failed recovery
// path, `response` via a normal completion that never even errored).
// Centralizing the "is this just a JSON-wrapped reply" check means any
// future key name this quirk uses gets caught by both call sites without
// having to track it down twice again.
function tryUnwrapJsonEnvelope(text: string): string | undefined {
  const trimmed = text.trim()

  if (!trimmed.startsWith('{') || !trimmed.endsWith('}'))
    return undefined

  try {
    const parsed: unknown = JSON.parse(trimmed)

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return undefined

    for (const key of ['response', 'content', 'text', 'message', 'reply']) {
      const value = (parsed as Record<string, unknown>)[key]

      if (typeof value === 'string')
        return value
    }
  } catch {
    // Not valid JSON after all - just a reply that happens to start/end
    // with brace-like characters. Fall through and let the caller decide
    // what to do with the original text.
  }

  return undefined
}

function recoverToolUseFailedText(error: unknown): string | undefined {
  const failedGeneration = (error as { error?: { failed_generation?: string } } | undefined)
    ?.error?.failed_generation

  if (typeof failedGeneration !== 'string')
    return undefined

  const match = failedGeneration.match(/"arguments":\s*(.*)\}\s*$/s)
  if (!match)
    return undefined

  const captured = match[1].trim()

  // Real bug hit on a live call (Aug 29 2026): `arguments` isn't always a
  // bare/quoted string - it was once a nested JSON object
  // (`{"content": "...", "role": "assistant"}`, the whole assistant
  // message shape, not just its text), and the old
  // `.replace(/^"|"$/g, '')` quote-stripping is a no-op on a string that
  // starts with `{` instead of `"` - so the caller heard the RAW JSON
  // text read aloud verbatim instead of just the reply. Detect that shape
  // first (see tryUnwrapJsonEnvelope above) and pull the real text back
  // out; only fall back to the quote-stripped-string handling (the
  // originally observed shape) if this one doesn't parse or doesn't look
  // like it.
  const unwrapped = tryUnwrapJsonEnvelope(captured)
  if (unwrapped !== undefined)
    return unwrapped

  return captured.replace(/^"|"$/g, '')
}

// Unlike OpenAILLM's previous_response_id chaining (an OpenAI Responses
// API convenience that doesn't exist on Groq's chat.completions
// endpoint), Groq needs the full message history resent on every call -
// this class keeps that array in memory for the life of one call, exactly
// mirroring what previous_response_id was doing server-side on OpenAI's
// end. Trade-off: token cost per turn grows with conversation length
// instead of staying flat (as previous_response_id chaining allowed) -
// not a concern for the short, task-focused calls this app handles, but
// worth knowing if this pattern gets reused somewhere with longer
// conversations.
export class GroqLLM implements ILLM {
  private readonly client: OpenAI
  private readonly apiKey: string
  private readonly model: string
  private readonly messages: ChatMessage[]
  private readonly logLabel: string
  private readonly maxRateLimitRetries: number
  private readonly firstTokenTimeoutMs: number | undefined

  // Accumulated across every generate()/generateStream() call this
  // instance makes - i.e. the whole call's usage, not just the latest
  // turn. Read via getUsageTotals() at call end for the call-log POST.
  private promptTokens = 0
  private completionTokens = 0

  // logLabel: distinguishes this instance's "[Timing] LLM complete" lines
  // in the process log. Matters because CallLogExtractor.ts also
  // constructs a GroqLLM directly (always Groq, regardless of
  // LLM_PROVIDER) for its one-off end-of-call field-extraction request -
  // without this, that call's timing line is textually IDENTICAL to a
  // live conversational turn's, and it fires during finalizeCallLog(),
  // squeezed between "[CallLog] Call ended - finalizing" and
  // "[CallLog] Submitted to backend" - easy to misread as some kind of
  // out-of-order/concurrent turn when it's actually a separate, always-
  // sequential, always-Groq call that has nothing to do with the active
  // LLM_PROVIDER (confirmed on a real call: this line appeared even
  // while LLM_PROVIDER=openrouter). Default 'Groq' covers every existing
  // call site (test-token.ts never passed a third argument before this).
  // maxRateLimitRetries: 0 when an LLM_FALLBACK_PROVIDER is configured
  // (see createLlm in test-token.ts) - a 429 then hands the turn straight
  // to the fallback (~1.2s) instead of waiting out up to two 3s retries
  // that, on this account's 8K TPM cap, usually 429 again anyway.
  // firstTokenTimeoutMs: also set only with a fallback configured. Real
  // calls on 2026-10-07 saw Groq-side queue_time of 2.5-4s on some turns
  // (normally ~0.2-0.5s); if no reply text has arrived by this deadline
  // the request is abandoned and generateStream throws, so FallbackLLM
  // moves the call to the fallback provider instead of leaving the
  // caller waiting.
  constructor(
    apiKey: string,
    systemPrompt: string,
    logLabel = 'Groq',
    maxRateLimitRetries = MAX_RATE_LIMIT_RETRIES,
    firstTokenTimeoutMs?: number,
  ) {
    this.client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 0 })
    this.apiKey = apiKey
    this.model = process.env.GROQ_MODEL ?? DEFAULT_MODEL
    this.messages = [{ role: 'system', content: systemPrompt }]
    this.logLabel = logLabel
    this.maxRateLimitRetries = maxRateLimitRetries
    this.firstTokenTimeoutMs = firstTokenTimeoutMs
  }

  primeGreeting(text: string): void {
    this.messages.push({ role: 'assistant', content: text })
  }

  seedTurn(userText: string, assistantText: string): void {
    this.messages.push({ role: 'user', content: userText })
    this.messages.push({ role: 'assistant', content: assistantText })
  }

  warmUp(): void {
    warmUpGroqConnection(this.apiKey, this.logLabel)
  }

  setHistory(entries: HistoryEntry[]): void {
    this.messages.splice(1, Infinity, ...entries.map(({ role, text }) => ({ role, content: text })))
  }

  getUsageTotals(): LLMUsageTotals {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
    }
  }

  async generate(prompt: string): Promise<string> {
    const startedAt = Date.now()

    this.messages.push({ role: 'user', content: prompt })

    let text: string

    try {
      const { data: response, response: rawResponse } = await withRateLimitRetry(() =>
        this.client.chat.completions.create({
          model: this.model,
          messages: this.messages,
          ...reasoningParamsFor(this.model),
        }).withResponse(),
        undefined,
        this.maxRateLimitRetries,
      )

      logRateLimitHeaders(rawResponse, this.logLabel)

      text = response.choices[0]?.message?.content ?? ''

      if (response.usage) {
        this.promptTokens += response.usage.prompt_tokens ?? 0
        this.completionTokens += response.usage.completion_tokens ?? 0
        logCacheUsage(response.usage, this.logLabel)
      }
    } catch (error) {
      const recovered = recoverToolUseFailedText(error)
      if (recovered === undefined)
        throw error

      console.warn(
        `[LLM] [Groq] Recovered from tool_use_failed quirk (harmony-format ` +
        `leak, no tools were sent in this request) - using the model's actual ` +
        `reply from failed_generation instead of dropping the turn: ` +
        `${JSON.stringify(recovered)}`,
      )

      text = recovered
    }

    console.log(
      `[Timing] [${this.logLabel}] LLM complete: ${Date.now() - startedAt} ms`,
    )

    this.messages.push({ role: 'assistant', content: text })

    return text
  }

  async generateStream(
    prompt: string,
    onText: LLMTextHandler,
    signal?: AbortSignal,
    contextNote?: string,
  ): Promise<string> {
    const startedAt = Date.now()

    this.messages.push({ role: 'user', content: prompt })

    // contextNote (see ILLM.ts) is spliced into the array sent to the API
    // for THIS call only, right before the new user message - never
    // pushed into `this.messages` itself, so it never becomes a
    // permanent part of the resent history on later turns.
    const requestMessages: ChatMessage[] = contextNote
      ? [
          ...this.messages.slice(0, -1),
          { role: 'system', content: contextNote },
          this.messages[this.messages.length - 1],
        ]
      : this.messages

    let fullText = ''
    let wasAborted = false
    // Real bug hit on a live call (Aug 29 2026): the harmony-leak quirk
    // (see recoverToolUseFailedText above) doesn't only show up as a Groq
    // tool_use_failed error - this time the model's completion came back
    // as a normal, error-free stream whose entire content was a single
    // JSON-wrapped chunk (`{"response":"..."}`), which went straight to
    // TTS and was read aloud verbatim, quotes and all. Both times this
    // quirk has been seen, the JSON-wrapped text arrived as one complete
    // chunk rather than token-by-token like every normal reply in this
    // app's logs - so checking only the FIRST content-bearing delta of a
    // stream catches this without adding any buffering/latency to the
    // normal case (a real reply is never itself parseable JSON, so the
    // check is a no-op for every ordinary turn).
    let checkedFirstDeltaForJson = false

    const requestController = new AbortController()
    const onOuterAbort = () => requestController.abort()
    signal?.addEventListener('abort', onOuterAbort, { once: true })

    let firstTokenTimedOut = false
    let firstTokenTimer: ReturnType<typeof setTimeout> | undefined =
      this.firstTokenTimeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            firstTokenTimedOut = true
            requestController.abort()
          }, this.firstTokenTimeoutMs)

    const clearFirstTokenTimer = () => {
      if (firstTokenTimer !== undefined) {
        clearTimeout(firstTokenTimer)
        firstTokenTimer = undefined
      }
    }

    try {
      const { data: stream, response: rawResponse } = await withRateLimitRetry(
        () =>
          this.client.chat.completions.create(
            {
              model: this.model,
              messages: requestMessages,
              stream: true,
              // Without this, streaming responses never include a usage field
              // at all (OpenAI-compatible streaming default) - the final chunk
              // (empty choices, populated usage) is where it shows up.
              stream_options: { include_usage: true },
              ...reasoningParamsFor(this.model),
            },
            { signal: requestController.signal },
          ).withResponse(),
        (waitMs, tryNum) => {
          // Only announce once (first retry) - a second retry piling on
          // another "One moment, please." would sound worse than silence.
          // Speaking it here (rather than after the retry resolves) is the
          // whole point: it fills the dead air *during* the wait, not
          // after - architecturally indistinguishable from the model's own
          // reply text once it goes through onText/fullText.
          if (tryNum !== 0) return
          fullText += RATE_LIMIT_FILLER
          onText(RATE_LIMIT_FILLER)
        },
        this.maxRateLimitRetries,
      )

      logRateLimitHeaders(rawResponse, this.logLabel)

      // Added 2026-09-02 alongside the reasoning_effort change above -
      // splits "time until Groq even responded" from test-token.ts's own
      // "First LLM delta" log (time until the first actual content
      // token). The gap between the two is time spent between headers
      // arriving and content actually starting to stream - on the 6s
      // single-turn stall that prompted this, there was no way to tell
      // whether that gap was a slow/queued connection or the model
      // genuinely taking that long to start generating after already
      // being connected. Next occurrence, this pins down which.
      console.log(
        `[Timing] [${this.logLabel}] LLM response headers: ${Date.now() - startedAt} ms since call started`,
      )

      for await (const chunk of stream) {
        if (firstTokenTimedOut)
          break

        if (signal?.aborted) {
          wasAborted = true
          break
        }

        let delta = chunk.choices[0]?.delta?.content
        if (delta) {
          clearFirstTokenTimer()

          if (!checkedFirstDeltaForJson) {
            checkedFirstDeltaForJson = true

            const unwrapped = tryUnwrapJsonEnvelope(delta)
            if (unwrapped !== undefined) {
              console.warn(
                `[LLM] [Groq] Normal completion came back JSON-wrapped ` +
                `(harmony-leak quirk, no tool_use_failed error this time) - ` +
                `unwrapping before speaking it: ${JSON.stringify(delta)} -> ` +
                `${JSON.stringify(unwrapped)}`,
              )
              delta = unwrapped
            }
          }

          fullText += delta
          onText(delta)
        }

        if (chunk.usage) {
          this.promptTokens += chunk.usage.prompt_tokens ?? 0
          this.completionTokens += chunk.usage.completion_tokens ?? 0
          logCacheUsage(chunk.usage, this.logLabel)
        }
      }
    } catch (error) {
      if (firstTokenTimedOut && !signal?.aborted)
        throw new Error(`[Groq] no reply text within ${this.firstTokenTimeoutMs} ms (Groq-side queueing)`)

      // The openai SDK throws (rather than just stopping the async
      // iterator) when the request is aborted mid-stream - this is the
      // caller interrupting the assistant (see test-token.ts's
      // onInterruption -> currentTurnAbortController.abort()), not a real
      // failure. Return whatever text streamed before the abort instead of
      // throwing - the caller's own generation check already discards it,
      // and NOT pushing an assistant reply to history below is deliberate:
      // nothing was actually said to the caller, so the message history
      // shouldn't claim otherwise.
      if (signal?.aborted) {
        console.log(
          '[LLM] [Groq] Turn aborted mid-stream (caller interrupted) - stopping early',
        )
        return fullText
      }

      // Only safe to recover if nothing has streamed yet - if part of a
      // reply already went out via onText and then the stream errored, we
      // don't know whether failed_generation is a duplicate of what's
      // already been said or a continuation, so in that case fall through
      // to the normal error path (turn gets dropped/logged, same as before)
      // rather than risk a garbled or repeated reply on a live call.
      const recovered = fullText ? undefined : recoverToolUseFailedText(error)
      if (recovered === undefined)
        throw error

      console.warn(
        `[LLM] [Groq] Recovered from tool_use_failed quirk (harmony-format ` +
        `leak, no tools were sent in this request) - using the model's actual ` +
        `reply from failed_generation instead of dropping the turn: ` +
        `${JSON.stringify(recovered)}`,
      )

      fullText = recovered
      onText(recovered)
    }

    finally {
      clearFirstTokenTimer()
      signal?.removeEventListener('abort', onOuterAbort)
    }

    if (firstTokenTimedOut && !signal?.aborted && !fullText)
      throw new Error(`[Groq] no reply text within ${this.firstTokenTimeoutMs} ms (Groq-side queueing)`)

    if (wasAborted) {
      console.log(
        '[LLM] [Groq] Turn aborted mid-stream (caller interrupted) - stopping early',
      )
      return fullText
    }

    const reply = cleanSpokenReply(fullText)
    this.messages.push({ role: 'assistant', content: reply })

    return reply
  }
}
