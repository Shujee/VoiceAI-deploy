import OpenAI from 'openai'
import type { ILLM, LLMTextHandler, LLMUsageTotals } from './ILLM.js'

// Fireworks' inference API is OpenAI-compatible (chat.completions) - same
// reuse-the-openai-package-with-a-custom-baseURL approach as GroqLLM.ts.
// Docs: https://docs.fireworks.ai/api-reference/post-chatcompletions
const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1'

// Added 2026-09-02 to test a specific hypothesis: this app's actual job
// (slot-filling a name/postcode/address/phone through a fixed PATH 1-4
// script, plus short KB lookups) may not need a 20B-120B model at all -
// Groq doesn't offer anything smaller than GPT-OSS 20B on the developer
// tier (Llama 3.1 8B and 3.3 70B were both moved to Enterprise-only on
// 2026-08-16 - see GroqLLM.ts - and that gating turned out to track
// model FAMILY, not size, so it didn't leave a small option there either).
// Fireworks hosts actual small Llama checkpoints on its normal serverless
// tier, so this is the option that can actually test the hypothesis:
// Llama 3.2 3B Instruct, $0.10/1M tok uniform in/out (Fireworks' flat
// <4B-parameter rate), 131K ctx. Together AI would be the other obvious
// candidate but its 3B Turbo endpoint is listed as "not available on
// Together's Serverless API" (launching soon) as of this writing.
//
// The real risk isn't latency - a 3B model should easily beat GPT-OSS
// 120B's ~600-1500ms TTFT - it's whether a much smaller model holds up
// the PATH 1-4 script as reliably across a 10-14 turn call the way
// 70B/120B-class models have (with real prompt-engineering effort, see
// buildSystemPrompt.ts's git history) after the client's original
// complaint was specifically about script adherence. Watch real call
// logs for drift (skipped acknowledgment, re-asking for info already
// given, wrong PATH) as closely as TTFT here.
const DEFAULT_MODEL = 'accounts/fireworks/models/llama-v3p2-3b-instruct'

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Unlike OpenAILLM's previous_response_id chaining, Fireworks (like Groq)
// needs the full message history resent on every call - see GroqLLM.ts's
// equivalent comment for the token-cost-grows-with-history trade-off,
// which applies identically here and is equally fine for these short
// calls.
export class FireworksLLM implements ILLM {
  private readonly client: OpenAI
  private readonly model: string
  private readonly messages: ChatMessage[]

  private promptTokens = 0
  private completionTokens = 0

  constructor(apiKey: string, systemPrompt: string) {
    this.client = new OpenAI({ apiKey, baseURL: FIREWORKS_BASE_URL })
    this.model = process.env.FIREWORKS_MODEL ?? DEFAULT_MODEL
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
          '[LLM] [Fireworks] Turn aborted mid-stream (caller interrupted) - stopping early',
        )
        return fullText
      }

      throw error
    }

    if (wasAborted) {
      console.log(
        '[LLM] [Fireworks] Turn aborted mid-stream (caller interrupted) - stopping early',
      )
      return fullText
    }

    this.messages.push({ role: 'assistant', content: fullText })

    return fullText
  }
}
