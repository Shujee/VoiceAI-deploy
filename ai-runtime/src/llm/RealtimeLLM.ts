import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket'
import type { ILLM, LLMTextHandler, LLMUsageTotals } from './ILLM.js'

// Added 2026-09-03: the user's own 1-second TTFA target made the ~800-
// 1000ms first-token time of every REST-based LLM tried so far (Groq,
// Gemini) the single biggest remaining chunk in the TTFA budget - see
// buildSystemPrompt.ts's history and this session's own TTFA breakdown.
// This tries a genuinely different shape instead of another REST model
// swap: OpenAI's Realtime API, the same product this app already uses
// for STT (see OpenAIRealtimeSTT.ts) - a persistent WebSocket instead of
// a fresh HTTPS request per turn, and (per OpenAI's own July 2026
// release notes) "at least a 25% reduction in p95 latency" for this
// exact model generation vs the prior Realtime models.
//
// gpt-realtime-2.1-mini specifically: the newest (July 2026) "distilled
// reasoning model for realtime voice" - mini pricing/speed tier, but
// with reasoning/tool-use the older gpt-realtime-mini lacked, at the
// same price. Not gpt-realtime-2.1 (full) - that one targets complex
// agent orchestration, not raw speed, and costs meaningfully more per
// token; not gemini's Live API - confirmed via docs
// (ai.google.dev/gemini-api/docs/live-api/capabilities) that Gemini's
// native-audio Live models ONLY support AUDIO response modality, so
// using it here would mean replacing Cartesia TTS entirely rather than
// slotting into the existing STT-transcript -> LLM-text -> TTS
// pipeline - a much bigger change than this first experiment calls for.
//
// SCOPE (deliberately the smaller of two options discussed): this is a
// drop-in ILLM, text-output-only, sitting in exactly the same place in
// the pipeline Groq/Gemini do today - STT still does its own separate
// transcription pass, TTS is still Cartesia. It does NOT merge STT+LLM
// into one Realtime session (an even bigger potential win - this
// process already holds a separate Realtime WebSocket open the whole
// call for STT, so the same audio could in principle feed straight into
// a single combined session and skip a whole network round-trip) - that
// is future work if this first, smaller experiment shows the Realtime
// transport itself (not just the model) is worth the added complexity.
const DEFAULT_MODEL = 'gpt-realtime-2.1-mini'

// Unlike every REST ILLM here (Groq/Gemini/Fireworks/OpenRouter/OpenAI),
// which resend the whole message history as JSON on every single
// request, the Realtime API keeps conversation state SERVER-SIDE for
// the life of the WebSocket connection - conversation.item.create adds
// one item at a time, and response.create asks the model to reply based
// on everything already in that connection's conversation. That's why
// this class has no `messages` array to maintain and resend, unlike its
// siblings - a nice side effect of the socket approach, not just the
// removed per-turn HTTPS setup cost.
type PendingTurn = {
  resolve: (text: string) => void
  reject: (error: unknown) => void
  onText: LLMTextHandler
  fullText: string
  contextNoteItemId?: string
}

function describeSocketError(error: unknown): unknown {
  const anyError = error as { error?: unknown; message?: unknown } | undefined
  return anyError?.error ?? anyError?.message ?? error
}

export class RealtimeLLM implements ILLM {
  private readonly apiKey: string
  private readonly model: string
  private readonly systemPrompt: string
  private readonly logLabel: string

  private socket: OpenAIRealtimeWebSocket | null = null
  private connectPromise: Promise<void> | null = null

  // primeGreeting() is synchronous (see ILLM.ts) and can be called before
  // the socket has even started connecting - queue it and flush once
  // session.updated confirms the connection is actually ready to accept
  // conversation.item.create events.
  private pendingGreeting: string | null = null

  // Only one turn is ever in flight at a time in this app (see
  // transcriptQueue in test-token.ts), so a single slot - rather than a
  // map keyed by response id - is enough to route response.output_text.delta/
  // response.done back to whichever generate()/generateStream() call is
  // currently waiting.
  private currentTurn: PendingTurn | null = null

  private promptTokens = 0
  private completionTokens = 0

  constructor(apiKey: string, systemPrompt: string, logLabel = 'Realtime') {
    this.apiKey = apiKey
    this.model = process.env.REALTIME_MODEL ?? DEFAULT_MODEL
    this.systemPrompt = systemPrompt
    this.logLabel = logLabel
  }

  primeGreeting(text: string): void {
    if (this.socket) {
      this.sendGreetingItem(text)
    } else {
      this.pendingGreeting = text
    }
  }

  private sendGreetingItem(text: string): void {
    this.socket!.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
        status: 'completed',
      },
    } as any)
  }

  async seedTurn(userText: string, assistantText: string): Promise<void> {
    await this.ensureConnected()

    this.socket!.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: userText }],
      },
    } as any)

    this.socket!.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: assistantText }],
        status: 'completed',
      },
    } as any)
  }

  getUsageTotals(): LLMUsageTotals {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
    }
  }

  private ensureConnected(): Promise<void> {
    if (this.connectPromise)
      return this.connectPromise

    this.connectPromise = this.openSocket()
    return this.connectPromise
  }

  private async openSocket(): Promise<void> {
    const socket = new OpenAIRealtimeWebSocket({
      model: this.model,
      apiKey: this.apiKey,
    } as any)

    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      socket.socket.addEventListener('open', () => resolve())
      socket.socket.addEventListener('error', reject)
    })

    // Same "an abrupt drop surfaces as 'error', not 'close'" behavior
    // OpenAIRealtimeSTT.ts already documented and handled - but unlike
    // STT (one process-global connection reused across every sequential
    // call, worth reconnecting), this connection is scoped to a single
    // call (see close() below). A drop mid-call has nothing useful to
    // reconnect to anyway (the in-flight turn's promise is rejected
    // below); the NEXT call simply constructs a fresh RealtimeLLM with
    // its own fresh connection, same as every other per-call ILLM here.
    socket.on('error', event => {
      console.error(`[LLM] [${this.logLabel}] Realtime error:`, describeSocketError(event))
      this.currentTurn?.reject(event)
      this.currentTurn = null
    })

    socket.on('response.output_text.delta', (event: any) => {
      const turn = this.currentTurn
      const delta = event?.delta

      if (turn && delta) {
        turn.fullText += delta
        turn.onText(delta)
      }
    })

    socket.on('response.done', (event: any) => {
      const turn = this.currentTurn
      const usage = event?.response?.usage

      if (usage) {
        this.promptTokens += usage.input_tokens ?? 0
        this.completionTokens += usage.output_tokens ?? 0
      }

      // Logged unconditionally rather than assumed - same lesson as
      // GroqLLM.ts/GeminiLLM.ts's cache-usage logging this session: get
      // the real shape from a real response instead of guessing from docs.
      //
      // CONFIRMED 2026-09-03, first real call: shape is
      // { total_tokens, input_tokens, output_tokens,
      //   input_token_details: { text_tokens, audio_tokens, image_tokens,
      //     cached_tokens, cached_tokens_details },
      //   output_token_details: { text_tokens, audio_tokens, reasoning_tokens } }.
      // Two things worth carrying forward from that call: (1) caching
      // here is real and substantial - cached_tokens landed at ~2240-2432
      // out of ~2290-2650 input_tokens on every turn after the first
      // (turn 1 was 0/2358, before the session prompt had anything to
      // cache) - unlike Gemini's implicit caching, which never fired at
      // all (see GeminiLLM.ts). (2) output_token_details.reasoning_tokens
      // was non-zero on every single turn (49-121 tokens) even for short
      // replies - gpt-realtime-2.1-mini always spends some reasoning
      // budget, and that fixed-per-turn cost is the likely reason this
      // model's first-token latency (~800-1050ms since the LLM call
      // started, steady state) came out roughly on par with
      // gemini-3.5-flash-lite rather than meaningfully faster - OpenAI's
      // "25% p95 reduction" claim is relative to older Realtime models,
      // not a promise of beating REST providers outright.
      console.log(
        `[Timing] [${this.logLabel}] response.done status=${event?.response?.status} ` +
        `usage=${JSON.stringify(usage)}`,
      )

      if (!turn)
        return

      this.currentTurn = null

      const status = event?.response?.status
      if (status === 'failed' || status === 'incomplete') {
        turn.reject(new Error(
          `[${this.logLabel}] Realtime response ended with status=${status}: ` +
          JSON.stringify(event?.response?.status_details),
        ))
        return
      }

      turn.resolve(turn.fullText)
    })

    socket.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['text'],
        instructions: this.systemPrompt,
      },
    } as any)

    if (this.pendingGreeting !== null) {
      this.sendGreetingItem(this.pendingGreeting)
      this.pendingGreeting = null
    }
  }

  async generate(prompt: string): Promise<string> {
    let fullText = ''
    await this.generateStream(prompt, delta => { fullText += delta })
    return fullText
  }

  async generateStream(
    prompt: string,
    onText: LLMTextHandler,
    signal?: AbortSignal,
    contextNote?: string,
  ): Promise<string> {
    const startedAt = Date.now()

    await this.ensureConnected()

    const socket = this.socket!

    // contextNote (see ILLM.ts): unlike GeminiLLM's fold-into-
    // systemInstruction approach, the Realtime API's conversation state
    // lives server-side for the life of the connection - there is no
    // per-request messages array to splice a one-off note into. Instead,
    // add it as its own conversation item right before the user's turn,
    // then delete it once this response is done, so it never lingers as
    // permanent conversation history for later turns.
    //
    // CONFIRMED 2026-09-03, first real call: this path was actually
    // exercised (caller interrupted the opening greeting, so the very
    // next turn carried a context note) - role: 'system' on a mid-
    // conversation item was accepted with no 'error' event, and the
    // model's reply correctly treated the bare "Yes," that followed as
    // an answer to the interrupted question rather than a fresh one.
    // That same turn was also the slowest of the call by a wide margin
    // (2859ms first-LLM-delta since speech_stopped vs. ~1170-1470ms for
    // every later turn) - input_token_details.cached_tokens was 0 on it
    // (vs. 2240+ on every turn after), so the gap looks like the first-
    // turn caching cold-start rather than the context note itself, but
    // this is only one data point - worth re-checking if an interrupted
    // turn is consistently the slowest one across more calls.
    let contextNoteItemId: string | undefined
    if (contextNote) {
      contextNoteItemId = `context-note-${startedAt}`
      socket.send({
        type: 'conversation.item.create',
        item: {
          id: contextNoteItemId,
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: contextNote }],
        },
      } as any)
    }

    socket.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    } as any)

    // Captured as a local so it can still be read after this.currentTurn
    // is nulled out (the response.done/error handlers above clear
    // this.currentTurn BEFORE resolving/rejecting, so by the time this
    // function's own catch block below runs, this.currentTurn is
    // already null - `turn` is the same object those handlers mutate
    // via onText, so turn.fullText still has whatever text streamed in
    // before an abort, even once this.currentTurn no longer points to it).
    const turn: PendingTurn = { resolve: () => {}, reject: () => {}, onText, fullText: '', contextNoteItemId }
    const resultPromise = new Promise<string>((resolve, reject) => {
      turn.resolve = resolve
      turn.reject = reject
      this.currentTurn = turn
    })

    socket.send({ type: 'response.create' } as any)

    const onAbort = () => {
      console.log(`[LLM] [${this.logLabel}] Turn aborted mid-stream (caller interrupted) - cancelling response`)
      socket.send({ type: 'response.cancel' } as any)
    }
    signal?.addEventListener('abort', onAbort)

    try {
      const text = await resultPromise
      console.log(`[Timing] [${this.logLabel}] LLM complete: ${Date.now() - startedAt} ms`)
      return text
    } catch (error) {
      if (signal?.aborted) {
        console.log(`[LLM] [${this.logLabel}] Turn aborted mid-stream (caller interrupted) - stopping early`)
        return turn.fullText
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)

      if (contextNoteItemId) {
        socket.send({
          type: 'conversation.item.delete',
          item_id: contextNoteItemId,
        } as any)
      }
    }
  }

  close(): void {
    if (!this.socket)
      return

    this.socket.close()
    this.socket = null
    this.connectPromise = null
  }
}
