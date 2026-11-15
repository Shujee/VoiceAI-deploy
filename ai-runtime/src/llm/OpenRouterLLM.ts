import OpenAI from 'openai'
import type { ILLM, LLMTextHandler, LLMUsageTotals } from './ILLM.js'

// OpenRouter's API is OpenAI-compatible (chat.completions) - same
// reuse-the-openai-package-with-a-custom-baseURL approach as
// GroqLLM.ts/FireworksLLM.ts. Docs: https://openrouter.ai/docs/quickstart
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

// Added 2026-09-02 as the no-card alternative to FireworksLLM.ts: same
// hypothesis (does this app's structured PATH 1-4 slot-filling script
// need a 20B-120B model at all, or would something much smaller do),
// but Fireworks now requires a payment method on signup with no free
// starter credit, which blocked testing it. OpenRouter's free-tier
// models (":free" suffix) need no credit card at all - just an API key -
// though they're rate-limited (20 req/min, 200 req/day as of this
// writing), which is plenty for this app's one-call-at-a-time LAN POC
// but would need revisiting before any real production traffic.
//
// liquid/lfm-2.5-2.6b:free is the smallest general-purpose free model
// currently listed (2.6B params, LiquidAI's LFM architecture - NOT a
// Llama/GPT checkpoint, so its instruction-following characteristics on
// a long branching script are genuinely untested here, unlike the
// Llama-family models this app has tuned prompts against so far).
// google/gemma-4-26b-a4b-it:free is the other free option if 2.6B proves
// too weak to hold the script - bigger, but still free/no-card, and a
// more conventional dense/instruction-tuned lineage than LFM.
const DEFAULT_MODEL = 'liquid/lfm-2.5-2.6b:free'

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Same full-message-history-resend trade-off as GroqLLM.ts/
// FireworksLLM.ts - fine for these short calls.
export class OpenRouterLLM implements ILLM {
  private readonly client: OpenAI
  private readonly model: string
  private readonly messages: ChatMessage[]

  private promptTokens = 0
  private completionTokens = 0

  constructor(apiKey: string, systemPrompt: string) {
    this.client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL })
    this.model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL
    this.messages = [{ role: 'system', content: systemPrompt }]
  }

  primeGreeting(text: string): void {
    this.messages.push({ role: 'assistant', content: text })
  }

  seedTurn(userText: string, assistantText: string): void {
    this.messages.push({ role: 'user', content: userText })
    this.messages.push({ role: 'assistant', content: assistantText })
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

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: this.messages,
    })

    const text = response.choices[0]?.message?.content ?? ''

    if (response.usage) {
      this.promptTokens += response.usage.prompt_tokens ?? 0
      this.completionTokens += response.usage.completion_tokens ?? 0
    }

    console.log(
      `[Timing] LLM complete: ${Date.now() - startedAt} ms`,
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
    this.messages.push({ role: 'user', content: prompt })

    // contextNote (see ILLM.ts) is spliced into the array sent to the API
    // for THIS call only, right before the new user message - never
    // pushed into `this.messages` itself. Same approach as GroqLLM.ts.
    const requestMessages: ChatMessage[] = contextNote
      ? [
          ...this.messages.slice(0, -1),
          { role: 'system', content: contextNote },
          this.messages[this.messages.length - 1],
        ]
      : this.messages

    let fullText = ''
    let wasAborted = false

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: requestMessages,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal },
      )

      for await (const chunk of stream) {
        if (signal?.aborted) {
          wasAborted = true
          break
        }

        const delta = chunk.choices[0]?.delta?.content
        if (delta) {
          fullText += delta
          onText(delta)
        }

        if (chunk.usage) {
          this.promptTokens += chunk.usage.prompt_tokens ?? 0
          this.completionTokens += chunk.usage.completion_tokens ?? 0
        }
      }
    } catch (error) {
      // Same interruption-vs-real-failure distinction as GroqLLM.ts - the
      // openai SDK throws on an aborted request instead of just ending the
      // async iterator.
      if (signal?.aborted) {
        console.log(
          '[LLM] [OpenRouter] Turn aborted mid-stream (caller interrupted) - stopping early',
        )
        return fullText
      }

      throw error
    }

    if (wasAborted) {
      console.log(
        '[LLM] [OpenRouter] Turn aborted mid-stream (caller interrupted) - stopping early',
      )
      return fullText
    }

    this.messages.push({ role: 'assistant', content: fullText })

    return fullText
  }
}
