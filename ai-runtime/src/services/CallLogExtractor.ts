import { GroqLLM } from '../llm/GroqLLM.js'
import type { CallLogExtraction, TranscriptTurn } from './CallLogClient.js'

// One extra, off-the-hot-path LLM call at the END of a call (never during
// it) to pull structured fields out of the raw transcript for the
// dashboard's Call Logs page. Deliberately always uses Groq directly,
// independent of LLM_PROVIDER - this doesn't need low latency (nothing is
// waiting on it live) but does benefit from being cheap, and gpt-oss-20b
// is plenty for a summarization/extraction task. If GROQ_API_KEY isn't
// set, this is skipped entirely (call log still gets saved, just without
// the structured fields) rather than erroring the whole call-log POST.
const EXTRACTION_SYSTEM_PROMPT = `You will be given the full transcript of one phone call between an AI receptionist and a caller. Extract the following as JSON and output ONLY the JSON object, nothing else - no markdown fences, no commentary:

{
  "caller_name": string or null,
  "callback_number": string or null (a phone number, only if one was actually discussed),
  "postcode": string or null (a UK postcode normalized to "OUTWARD INWARD" form, e.g. "SW1A 1AA", only if one was actually given - AnswerPoint has its own dedicated field for this, so keep it separate from "address" below and never repeat it there),
  "address": string or null (house number/name if given, street and town - never include the postcode here, it has its own field above),
  "message": string or null (a short plain-English summary of what the call was about and what the caller wants the team to do - and list any questions the caller asked that the receptionist could not answer, e.g. "Asked whether they are insured and how long the job takes"),
  "call_type": one of "quote_request", "complaint", "callback", "message", "faq", "cold_call", or null if none clearly fits
}

Use null for anything not actually present in the transcript - never invent a value. If the caller corrected a detail (e.g. "sorry, I meant LU3"), use the corrected value only.`

const EMPTY_EXTRACTION: CallLogExtraction = {
  caller_name: null,
  callback_number: null,
  postcode: null,
  address: null,
  message: null,
  call_type: null,
}

export async function extractCallLogFields(
  transcript: TranscriptTurn[],
): Promise<CallLogExtraction> {
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    console.warn('[CallLog] GROQ_API_KEY not set - skipping structured extraction')
    return EMPTY_EXTRACTION
  }

  if (transcript.length === 0)
    return EMPTY_EXTRACTION

  const transcriptText = transcript
    .map(turn => `${turn.role === 'user' ? 'Caller' : 'Assistant'}: ${turn.text}`)
    .join('\n')

  try {
    const extractor = new GroqLLM(apiKey, EXTRACTION_SYSTEM_PROMPT, 'CallLogExtractor')
    const raw = await extractor.generate(transcriptText)

    // Models occasionally wrap JSON in ```json fences despite being told
    // not to - strip those before parsing rather than failing on them.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')

    const parsed = JSON.parse(cleaned)

    return {
      caller_name: parsed.caller_name ?? null,
      callback_number: parsed.callback_number ?? null,
      postcode: parsed.postcode ?? null,
      address: parsed.address ?? null,
      message: parsed.message ?? null,
      call_type: parsed.call_type ?? null,
    }
  } catch (error) {
    console.error('[CallLog] Structured extraction failed, saving raw transcript only:', error)
    return EMPTY_EXTRACTION
  }
}
