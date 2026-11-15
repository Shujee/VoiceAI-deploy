import OpenAI from 'openai'
import type { ILLM, LLMTextHandler, LLMUsageTotals } from './ILLM.js'

// Model: gpt-5.6-luna (OpenAI's current budget/fast tier, successor to
// gpt-4.1-nano/gpt-5-nano). Swapped from gpt-4.1-mini to cut LLM
// time-to-first-token latency — the single largest recurring cost in the
// per-turn budget (see voice-ai-runtime-handoff-v2.md §6.A). Average
// customer-intake calls (name/address/problem/availability) don't need
// gpt-4.1-mini-level reasoning, so this trades a little headroom for
// speed. Re-evaluate if call quality (misheard corrections, off-script
// replies) regresses in testing.
export class OpenAILLM implements ILLM {
  private readonly client: OpenAI
  private previousResponseId?: string

  // Set by primeGreeting(), spliced into buildInput() on the FIRST real
  // call only (same one-shot timing as this.systemPrompt below) - there
  // is no local message-history array to push onto the way GroqLLM.ts
  // does (previous_response_id chaining lives server-side, keyed by real
  // response ids this class never fakes), so priming has to ride along
  // with the first actual request instead of happening immediately.
  private pendingGreeting?: string

  // Buffered by seedTurn() (see ILLM.ts) when this instance is being
  // stood up as a FallbackLLM.ts fallback target mid-call - unlike every
  // other ILLM here, there's no local messages array to push onto
  // (previous_response_id chaining carries history forward server-side,
  // keyed by a REAL prior response id this class never fakes), so
  // instead these are spliced into the very first real request's `input`
  // array (see buildInput below) and never touched again once
  // previousResponseId takes over.
  private pendingHistory: { role: 'user' | 'assistant'; content: string }[] = []

  // Accumulated across every generate()/generateStream() call this
  // instance makes - read via getUsageTotals() at call end for the
  // call-log POST. Responses API field names (input_tokens/output_tokens)
  // differ from chat.completions' (prompt_tokens/completion_tokens, see
  // GroqLLM.ts) - normalized to the same ILLM shape here.
  private promptTokens = 0
  private completionTokens = 0

  // systemPrompt is now built per-conversation from a business's knowledge
  // base (see knowledge-base/buildSystemPrompt.ts + test-token.ts) instead
  // of being a hardcoded module constant — one agent process can now serve
  // any business without a code change.
  constructor(apiKey: string, private readonly systemPrompt: string) {
    this.client = new OpenAI({ apiKey })
  }

  primeGreeting(text: string): void {
    this.pendingGreeting = text
  }

  seedTurn(userText: string, assistantText: string): void {
    this.pendingHistory.push({ role: 'user', content: userText })
    this.pendingHistory.push({ role: 'assistant', content: assistantText })
  }

  getUsageTotals(): LLMUsageTotals {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
    }
  }

  // First call in the chain: send the persona as a developer message plus
  // the caller's line. Every call after that: just the caller's new line —
  // previous_response_id carries the developer message and prior turns
  // forward automatically.
  //
  // Verified against OpenAI's own docs and community-confirmed behavior
  // (not assumed): the top-level `instructions` param on the Responses API
  // is explicitly a ONE-SHOT instruction — it does NOT carry forward
  // through previous_response_id chaining, so it has to be resent on every
  // single call to keep the persona intact. A `developer`-role message in
  // `input`, by contrast, DOES persist automatically across a
  // previous_response_id chain (confirmed both by OpenAI's
  // EasyInputMessage type docs — "messages with the developer or system
  // role take precedence... assistant messages are presumed to have been
  // generated in previous interactions" — and by a verified demonstration
  // in OpenAI's developer community). So: send this once, on the FIRST
  // call only, cutting the whole system prompt (persona + KB block) out of
  // the request payload on every turn but the first.
  // contextNote (see ILLM.ts): unlike GroqLLM, which can splice a note
  // into just the messages array sent for one call without storing it in
  // its own persistent history, the Responses API's previous_response_id
  // chaining persists everything sent as `input` on the SERVER side once
  // that response is chained forward - so a contextNote sent here doesn't
  // stay one-off the way it does for Groq. Not worth engineering around:
  // OpenAILLM isn't the currently active LLM_PROVIDER, and a lingering
  // note ("the caller may not have heard your last question in full") is
  // harmless extra context on later turns, just a little wasted context/
  // token cost - not a correctness problem.
  private buildInput(prompt: string, contextNote?: string) {
    const messages: { role: 'developer' | 'system' | 'assistant' | 'user'; content: string }[] = []

    if (!this.previousResponseId) {
      messages.push({ role: 'developer', content: this.systemPrompt })

      if (this.pendingGreeting)
        messages.push({ role: 'assistant', content: this.pendingGreeting })

      for (const turn of this.pendingHistory)
        messages.push(turn)
    }

    if (contextNote)
      messages.push({ role: 'system', content: contextNote })

    messages.push({ role: 'user', content: prompt })

    return messages.length === 1 ? prompt : messages
  }

  async generate(prompt: string): Promise<string> {
    const startedAt = Date.now()

    const response = await this.client.responses.create({
      model: 'gpt-5.6-luna',

      input: this.buildInput(prompt),

      ...(this.previousResponseId
        ? { previous_response_id: this.previousResponseId }
        : {}),
    })

    console.log(
      `[Timing] LLM complete: ${Date.now() - startedAt} ms`,
    )

    this.previousResponseId = response.id

    if (response.usage) {
      this.promptTokens += response.usage.input_tokens ?? 0
      this.completionTokens += response.usage.output_tokens ?? 0
    }

    return response.output_text
  }

  async generateStream(
    prompt: string,
    onText: LLMTextHandler,
    signal?: AbortSignal,
    contextNote?: string,
  ): Promise<string> {
    const stream = await this.client.responses.create(
      {
        model: 'gpt-5.6-luna',
        input: this.buildInput(prompt, contextNote),
        stream: true,
        ...(this.previousResponseId
          ? { previous_response_id: this.previousResponseId }
          : {}),
      },
      { signal },
    )

    let fullText = ''

    try {
      for await (const event of stream) {
        if (signal?.aborted)
          break

        if (event.type === 'response.output_text.delta') {
          fullText += event.delta
          onText(event.delta)
        }

        if (event.type === 'response.completed') {
          this.previousResponseId = event.response.id

          if (event.response.usage) {
            this.promptTokens += event.response.usage.input_tokens ?? 0
            this.completionTokens += event.response.usage.output_tokens ?? 0
          }
        }
      }
    } catch (error) {
      // Same reasoning as GroqLLM.ts: an aborted signal makes the SDK
      // throw mid-stream rather than just ending the iterator - this is
      // the caller interrupting the assistant (see test-token.ts), not a
      // real failure. Return the partial text instead of throwing.
      // previousResponseId simply won't get updated in this case (no
      // response.completed event fired), which is actually the right
      // behavior here - the next turn's chain naturally excludes the
      // interrupted, never-spoken content instead of needing an explicit
      // "don't record this" step like GroqLLM.ts's message-history array
      // needs.
      if (signal?.aborted) {
        console.log(
          '[LLM] [OpenAI] Turn aborted mid-stream (caller interrupted) - stopping early',
        )
        return fullText
      }

      throw error
    }

    return fullText
  }
}
