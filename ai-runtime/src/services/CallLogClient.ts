import axios, { AxiosInstance } from 'axios'

export type TranscriptTurn = {
  role: 'user' | 'assistant'
  text: string
  at: string
}

export type CallLogExtraction = {
  caller_name: string | null
  callback_number: string | null
  // Split out from address (2026-09-17) so AnswerPoint's createMessage push
  // can use its own dedicated 'postCode' field instead of folding it into
  // address1 - see AnswerPointClient::buildPayload().
  postcode: string | null
  address: string | null
  message: string | null
  call_type: string | null
}

export type CallLogPayload = {
  businessSlug: string
  livekitRoom: string
  callerNumber: string | null
  startedAt: string
  endedAt: string
  rawTranscript: TranscriptTurn[]
  llmPromptTokens: number
  llmCompletionTokens: number
  ttsCharacters: number
} & Partial<CallLogExtraction>

// Separate from LaravelClient.ts on purpose: this hits an internal,
// API-key-authenticated endpoint (POST /api/call-logs, guarded by
// VerifyRuntimeApiKey on the backend), not the session-cookie auth a
// browser would use, and not the future endpoint the client's CodeIgniter
// app will eventually push call records through (see
// voiceai_runtime_status.md - that's a separate, not-yet-built
// integration).
export class CallLogClient {
  private http: AxiosInstance

  constructor() {
    this.http = axios.create({
      baseURL: process.env.LARAVEL_URL ?? 'http://backend',
      timeout: 5000,
      headers: {
        'X-Runtime-Api-Key': process.env.RUNTIME_API_KEY ?? '',
      },
    })
  }

  // Deliberately never throws - call logging must never be allowed to
  // affect the live call it's reporting on. Failures are logged and
  // swallowed; see the caller in test-token.ts.
  async submit(payload: CallLogPayload): Promise<void> {
    try {
      await this.http.post('/api/call-logs', {
        business_slug: payload.businessSlug,
        livekit_room: payload.livekitRoom,
        caller_number: payload.callerNumber,
        started_at: payload.startedAt,
        ended_at: payload.endedAt,
        raw_transcript: payload.rawTranscript,
        caller_name: payload.caller_name ?? null,
        callback_number: payload.callback_number ?? null,
        postcode: payload.postcode ?? null,
        address: payload.address ?? null,
        message: payload.message ?? null,
        call_type: payload.call_type ?? null,
        llm_prompt_tokens: payload.llmPromptTokens,
        llm_completion_tokens: payload.llmCompletionTokens,
        tts_characters: payload.ttsCharacters,
      })

      console.log('[CallLog] Submitted to backend')
    } catch (error: any) {
      console.error(
        '[CallLog] Failed to submit call log (call itself was unaffected):',
        error?.response?.data ?? error?.message ?? error,
      )
    }
  }
}
