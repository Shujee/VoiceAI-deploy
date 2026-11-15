import dotenv from 'dotenv'

// IMPORTANT: this must be the first thing that runs in this file - `pnpm
// dev` (tsx watch) runs THIS file directly, not index.ts, and index.ts's
// own dotenv.config() call never executes on this path. Without this,
// the ONLY env vars this process would ever see are whatever Docker
// injected into the container from docker-compose.yml's env_file AT
// CONTAINER CREATION TIME - `docker compose exec ai-runtime pnpm dev`
// does NOT re-read env_file, so editing .env and just restarting `pnpm
// dev` would silently keep running on stale values from whenever the
// container was last created/recreated, with no error or warning.
//
// override:true is equally important, not just calling dotenv.config()
// bare - dotenv's default behavior is to leave an ALREADY-SET
// process.env value alone, so without override:true this would still
// prefer Docker's stale container-creation-time value over the current
// .env file's content whenever both happen to define the same key
// (which is every key, in practice). With override:true, this process
// always reflects EXACTLY what's on disk in .env right now, which is
// what makes "just restart pnpm dev" a real guarantee instead of a hope
// - see the [Startup] config block a few lines into main() below, which
// prints the resolved values so this is visible at a glance rather than
// asserted on faith.
dotenv.config({ override: true })

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import type { RemoteParticipant } from '@livekit/rtc-node'
import { LaravelClient } from './services/LaravelClient.js'
import { CallLogClient, TranscriptTurn } from './services/CallLogClient.js'
import { extractCallLogFields } from './services/CallLogExtractor.js'
import { LiveKitTransport } from './providers/livekit/LiveKitTransport.js'
import { OpenAIRealtimeSTT, TranscriptTiming } from './stt/OpenAIRealtimeSTT.js'
import { CartesiaSTT } from './stt/CartesiaSTT.js'
import { OpenAILLM } from './llm/OpenAILLM.js'
import { GroqLLM, warmUpGroqConnection } from './llm/GroqLLM.js'
import { FireworksLLM } from './llm/FireworksLLM.js'
import { OpenRouterLLM } from './llm/OpenRouterLLM.js'
import { GeminiLLM } from './llm/GeminiLLM.js'
import { RealtimeLLM } from './llm/RealtimeLLM.js'
import { FallbackLLM } from './llm/FallbackLLM.js'
import { RATE_LIMIT_FILLER, type ILLM } from './llm/ILLM.js'
import { OpenAITTS } from './tts/OpenAITTS.js'
import { RimeTTS, DEFAULT_SPEAKER } from './tts/RimeTTS.js'
import { CartesiaTTS, DEFAULT_VOICE_ID } from './tts/CartesiaTTS.js'
import { ITTS } from './tts/ITTS.js'
import { TTSSentenceQueue } from './tts/TTSSentenceQueue.js'
import { toSpeakable } from './tts/speakable.js'
import {
  buildSystemPrompt,
  buildGreetingText,
  cleanSpokenReply,
  FALLBACK_KNOWLEDGE_BASE,
  NO_REPLY_SENTINEL,
} from './knowledge-base/buildSystemPrompt.js'
import type { BusinessKnowledgeBase } from './knowledge-base/buildSystemPrompt.js'
import { createApp } from './app.js'

// Plain ANSI color codes, no dependency - deliberately NOT gated on
// process.stdout.isTTY: this process's stdout is usually piped straight
// into `docker compose logs`, which reports non-TTY even when the
// terminal actually viewing those logs supports color fine. Gating on
// NO_COLOR (the standard opt-out convention) instead means colors show
// up by default and can be killed with `NO_COLOR=1` if they ever look
// wrong in a particular setup.
const COLOR_ENABLED = !process.env.NO_COLOR

function color(code: string, text: string): string {
  return COLOR_ENABLED ? `\x1b[${code}m${text}\x1b[0m` : text
}

// See NO_REPLY_SENTINEL in buildSystemPrompt.ts for what this represents
// and why the classification lives in the prompt (full conversation
// context) rather than as a length/wording heuristic here. Matched with
// startsWith rather than strict equality so a model that doesn't follow
// "and nothing else" perfectly (adds trailing punctuation, or drifts and
// appends more text) still gets treated as suppressed rather than
// literally speaking the bracketed token to the caller - the failure
// mode of a stray real sentence going unsaid is much less bad than
// reading "bracket bracket no reply bracket bracket" out loud on a call.
function isNoReplySentinel(text: string): boolean {
  return text.trim().startsWith(NO_REPLY_SENTINEL)
}

// Masks a secret so [Startup] logging below can prove a key is SET and
// roughly what it is (useful for catching e.g. a stray leading/trailing
// space, or last call's copy-pasted key vs. this one) without ever
// printing anything usable if these logs are pasted somewhere.
function maskKey(value: string | undefined): string {
  if (!value) return 'NOT SET'
  if (value.length <= 8) return `set (${value.length} chars)`
  return `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`
}

// Fingerprints the .env file this process's dotenv.config({override:true})
// call (top of this file) actually read, so "did my edit take effect" has
// a yes/no answer instead of a guess: hash + mtime change on every real
// edit, regardless of which key changed, and this is read fresh every
// time this function runs (once, at startup) - not cached from whenever
// the ai-runtime CONTAINER was created, unlike Docker's env_file
// injection. If this doesn't match what you expect after an edit, the
// file being read isn't the one you edited (wrong path, wrong bind
// mount) - dig there rather than assuming pnpm dev needs a fuller
// restart.
function envFileFingerprint(): string {
  const envPath = resolvePath(process.cwd(), '.env')
  try {
    const raw = readFileSync(envPath)
    const stat = statSync(envPath)
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12)
    return `${envPath} (sha256:${hash}, mtime:${stat.mtime.toISOString()})`
  } catch (error: any) {
    return `${envPath} - could not read (${error?.message ?? error})`
  }
}

// Added 2026-09-04 after a Gemini failure logged as a completely bare
// `Error` with no message and no visible extra fields - console.error's
// default Error formatting only reliably shows name/message/stack, so an
// error thrown with an empty message (seen from @google/genai's runFetch
// wrapping a raw fetch()/network failure) prints as just "Error" with a
// stack trace and nothing else, even when the object carries a `.cause`
// (fetch's own network errors - ECONNRESET, ENOTFOUND, timeouts - almost
// always set this) or other own properties. This pulls every own
// property (via Object.getOwnPropertyNames, which JSON.stringify alone
// skips for non-enumerable fields like `message`/`stack` on a plain
// Error) plus `.cause`, recursively one level, so the NEXT time
// something like this happens the actual underlying network/SDK error is
// visible instead of a dead end.
function describeError(error: unknown): unknown {
  if (!(error instanceof Error))
    return error

  const own: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'stack')
      continue
    own[key] = (error as unknown as Record<string, unknown>)[key]
  }

  return {
    name: error.name,
    message: error.message || '(empty)',
    ...own,
    cause: error.cause !== undefined ? describeError(error.cause) : undefined,
    stack: error.stack,
  }
}

async function main() {
  const client = new LaravelClient()
  const callLogClient = new CallLogClient()

  // LLM_PROVIDER/TTS_PROVIDER pick the reasoning/voice BACKEND for this
  // deployment - a fixed choice across every business/call, unlike the
  // business itself (see beginCall below, which resolves per call from
  // the dialed phone number). Defaults to 'openai' (the known-good
  // baseline) so any other deployment/checkout that doesn't set these
  // explicitly keeps working; set LLM_PROVIDER=groq / TTS_PROVIDER=rime
  // to try Groq/Rime instead (see GroqLLM.ts/RimeTTS.ts).
  const llmProvider = process.env.LLM_PROVIDER ?? 'openai'
  const ttsProvider = process.env.TTS_PROVIDER ?? 'openai'
  const sttProvider = process.env.STT_PROVIDER ?? 'openai'

  console.log(`[LLM] Using provider: ${llmProvider}`)
  console.log(`[TTS] Using provider: ${ttsProvider}`)
  console.log(`[STT] Using provider: ${sttProvider}`)

  // Only implemented for Groq so far (see warmUpGroqConnection's own
  // comment for why - the other providers haven't shown this specific
  // cold-connection symptom). A no-op on any other LLM_PROVIDER.
  function warmUpLlmConnection(): void {
    if (llmProvider === 'groq' && process.env.GROQ_API_KEY)
      warmUpGroqConnection(process.env.GROQ_API_KEY)
  }

  // [Startup] Config freshness check - prints every behavior-relevant
  // resolved env value ONCE, at process start, so "is a bare `pnpm dev`
  // restart enough after editing .env, or do I need docker compose
  // down/up/build" has a concrete answer instead of a guess. This is only
  // trustworthy because of two things: (1) this file's very first line
  // calls dotenv.config({override:true}) - see that comment for why a
  // container-level env_file alone can't be trusted - and (2) the file
  // fingerprint below proves it actually read the CURRENT .env, not a
  // stale copy. A rebuild (docker compose build/down/up) is only ever
  // needed for package.json or Dockerfile changes - source edits
  // (including this file) are picked up live via the bind mount in
  // docker-compose.yml.
  console.log('[Startup] ---- config freshness check ----')
  console.log(`[Startup] .env file read: ${envFileFingerprint()}`)
  console.log(
    `[Startup] LLM_PROVIDER=${llmProvider}` +
    (llmProvider === 'groq'
      ? ` GROQ_MODEL=${process.env.GROQ_MODEL ?? '(default in GroqLLM.ts)'} GROQ_API_KEY=${maskKey(process.env.GROQ_API_KEY)}`
      : llmProvider === 'fireworks'
        ? ` FIREWORKS_MODEL=${process.env.FIREWORKS_MODEL ?? '(default in FireworksLLM.ts)'} FIREWORKS_API_KEY=${maskKey(process.env.FIREWORKS_API_KEY)}`
        : llmProvider === 'openrouter'
          ? ` OPENROUTER_MODEL=${process.env.OPENROUTER_MODEL ?? '(default in OpenRouterLLM.ts)'} OPENROUTER_API_KEY=${maskKey(process.env.OPENROUTER_API_KEY)}`
          : llmProvider === 'gemini'
            ? ` GEMINI_MODEL=${process.env.GEMINI_MODEL ?? '(default in GeminiLLM.ts)'} GEMINI_API_KEY=${maskKey(process.env.GEMINI_API_KEY)}`
            : llmProvider === 'realtime'
              ? ` REALTIME_MODEL=${process.env.REALTIME_MODEL ?? '(default in RealtimeLLM.ts)'} OPENAI_API_KEY=${maskKey(process.env.OPENAI_API_KEY)}`
              : ` OPENAI_API_KEY=${maskKey(process.env.OPENAI_API_KEY)}`),
  )
  console.log(
    `[Startup] TTS_PROVIDER=${ttsProvider}` +
    (ttsProvider === 'cartesia'
      ? ` CARTESIA_VOICE_ID=${process.env.CARTESIA_VOICE_ID ?? '(per-business default from backend)'} CARTESIA_API_KEY=${maskKey(process.env.CARTESIA_API_KEY)}`
      : ttsProvider === 'rime'
        ? ` RIME_API_KEY=${maskKey(process.env.RIME_API_KEY)}`
        : ` OPENAI_API_KEY=${maskKey(process.env.OPENAI_API_KEY)}`),
  )
  console.log(
    `[Startup] STT_PROVIDER=${sttProvider}` +
    (sttProvider === 'cartesia'
      // Reuses CARTESIA_API_KEY - same account/product CartesiaTTS.ts
      // already authenticates against, just a separate WebSocket
      // connection scoped to STT (see CartesiaSTT.ts).
      ? ` CARTESIA_API_KEY=${maskKey(process.env.CARTESIA_API_KEY)}`
      : ` OPENAI_API_KEY=${maskKey(process.env.OPENAI_API_KEY)}`),
  )
  console.log(
    `[Startup] LIVEKIT_URL=${process.env.LIVEKIT_URL ?? 'ws://livekit:7880'} ` +
    `BUSINESS_SLUG(fallback)=${process.env.BUSINESS_SLUG ?? 'xyz'}`,
  )
  console.log(
    `[Startup] LARAVEL_URL=${process.env.LARAVEL_URL ?? 'http://backend'} ` +
    `RUNTIME_API_KEY=${maskKey(process.env.RUNTIME_API_KEY)}`,
  )
  console.log(
    `[Startup] LLM_FALLBACK_PROVIDER=${process.env.LLM_FALLBACK_PROVIDER ?? '(none - no fallback)'}`,
  )
  console.log('[Startup] ---- end config freshness check ----')

  const identity = 'runtime'
  const url = process.env.LIVEKIT_URL ?? 'ws://livekit:7880'

  // Per-call state, rebuilt fresh by runCallSession() below every time
  // LiveKit creates a new room for an inbound call (see the `webhook:`
  // block in infra/livekit/livekit.yaml and setup-sip.ts's
  // `type: 'individual'` dispatch rule - each call now gets its OWN
  // room, discovered via a `room_started` webhook, instead of every
  // call joining one fixed shared room the way this process used to).
  // Which BUSINESS answers a call is resolved per call (see beginCall()
  // inside runCallSession below), so everything that depends on it
  // (llm/tts/ttsQueue/the system prompt/the whole conversation-
  // processing pipeline) is rebuilt fresh for every call - unchanged
  // from before this file supported more than one call at a time.
  type CallSession = {
    onTranscript: (transcript: string, timing: TranscriptTiming) => void
    onInterruption: () => void
    // Fired only by CartesiaSTT (see its constructor comment) when a turn
    // that interrupted the assistant turns out to have been background
    // noise, not the caller - the assistant has already gone silent
    // mid-reply for nothing. Optional because OpenAIRealtimeSTT has no
    // equivalent signal and never calls it.
    onFalseInterruption?: () => void
    // Fired the instant the caller starts talking again (see
    // OpenAIRealtimeSTT's onSpeechStart) - races the TTS connection
    // warm-up against STT+LLM instead of only starting it once a reply
    // is ready to speak. See ITTS.warmUp().
    warmUp: () => void
    clearPendingGreeting: () => void
    // Caller-continuation handling (see CONTINUATION_* in runCallSession).
    // Only OpenAIRealtimeSTT reports these; with CartesiaSTT they never
    // fire and that handling stays inert.
    onCallerSpeechStart?: () => void
    onCallerSpeechStop?: () => void
    onTranscriptDiscarded?: () => void
    finalize: () => Promise<void>
  }

  // One entry per call currently in progress, keyed by that call's own
  // LiveKit room name - replaces the old single `activeSession`/
  // `activeParticipantIdentity` pair from when this process only ever
  // handled one call at a time (see runCallSession below, where those
  // became a plain per-call `session` local instead, and see its own
  // comment on why the stale-session guard they enabled isn't needed
  // anymore rather than being ported over). Used by the webhook handler
  // further down (skip starting a session for a room already in
  // progress) and by the SIGINT/SIGTERM handlers (cleanly tear down
  // every in-progress call on shutdown, not just one).
  const sessions = new Map<string, { transport: LiveKitTransport; stt: CartesiaSTT | OpenAIRealtimeSTT }>()

  // A second, throwaway TTS instance used ONLY to keep a connection warm
  // (see ITTS.warmUp()) - separate from the real per-call `tts` instance
  // (built inside beginCall() once the business's actual voice_id is
  // known) because this one needs to fire BEFORE that KB lookup even
  // starts, so the connection has a head start on the call's opening
  // greeting too, not just mid-call replies. warmUp() only opens/reuses
  // an HTTP connection to the provider's host - which speaker id is in
  // the throwaway request body doesn't matter for that, so using
  // DEFAULT_SPEAKER here is fine even though the real call almost always
  // ends up using a different voice. Stays process-global (unlike the
  // real per-call `stt`/`tts`/`transport` below) - shared warm-up pings
  // cost nothing extra per concurrent call.
  const ttsWarmer: ITTS = ttsProvider === 'rime'
    ? new RimeTTS(DEFAULT_SPEAKER)
    : ttsProvider === 'cartesia'
      ? new CartesiaTTS()
      : new OpenAITTS()

  // Fired once now (so the very first call of this process's lifetime
  // isn't stuck with a stone-cold connection) and again at the start of
  // every beginCall() below (a real call's own `tts` instance is brand
  // new each time and has never sent a request yet, so it can't benefit
  // from whatever connection pooling happened on a PREVIOUS call).
  ttsWarmer.warmUp?.()
  // Same idea for the LLM connection (see warmUpLlmConnection above) -
  // a real call's own `llm` instance doesn't even exist yet at process
  // boot (built fresh per call inside beginCall(), once the business is
  // known), so this uses GROQ_API_KEY directly rather than an instance.
  warmUpLlmConnection()

  // Builds one ILLM instance for the given provider name + system prompt -
  // pulled out of beginCall() so both the call's primary LLM and, when
  // LLM_FALLBACK_PROVIDER is configured, a second instance for the
  // fallback path (see FallbackLLM.ts) share the exact same
  // provider-selection logic instead of it existing twice and drifting.
  // Normal Groq first-token time is ~0.4-0.7s (2026-10-07 calls); 1.2s
  // catches Groq-side queueing without tripping on a slow-normal turn.
  // A timed-out turn is answered by the fallback; Groq is tried again
  // after FallbackLLM's cooldown. See GroqLLM's firstTokenTimeoutMs.
  const GROQ_FIRST_TOKEN_TIMEOUT_MS = 1200

  function createLlm(provider: string, systemPrompt: string): ILLM {
    if (provider === 'groq') {
      // With a fallback configured, don't sit through Groq 429 retries -
      // fail over immediately (see GroqLLM's maxRateLimitRetries).
      const fallback = process.env.LLM_FALLBACK_PROVIDER
      const hasFallback = !!fallback && fallback !== 'groq'
      return new GroqLLM(
        process.env.GROQ_API_KEY!,
        systemPrompt,
        'Groq',
        hasFallback ? 0 : undefined,
        hasFallback ? GROQ_FIRST_TOKEN_TIMEOUT_MS : undefined,
      )
    } else if (provider === 'fireworks') {
      return new FireworksLLM(process.env.FIREWORKS_API_KEY!, systemPrompt)
    } else if (provider === 'openrouter') {
      return new OpenRouterLLM(process.env.OPENROUTER_API_KEY!, systemPrompt)
    } else if (provider === 'gemini') {
      return new GeminiLLM(process.env.GEMINI_API_KEY!, systemPrompt)
    } else if (provider === 'realtime') {
      // Reuses OPENAI_API_KEY - same product/account OpenAIRealtimeSTT.ts
      // already authenticates against for STT, just a separate
      // WebSocket connection scoped to this one call (see RealtimeLLM.ts).
      return new RealtimeLLM(process.env.OPENAI_API_KEY!, systemPrompt)
    } else if (provider === 'openai') {
      return new OpenAILLM(process.env.OPENAI_API_KEY!, systemPrompt)
    } else {
      throw new Error(
        `Unknown LLM provider "${provider}" - expected "openai", "groq", "fireworks", "openrouter", "gemini", or "realtime"`,
      )
    }
  }

  // Runs once per inbound call, from the moment LiveKit creates that
  // call's own room (see the `room_started` webhook handler near the
  // bottom of main()) until its caller disconnects. This whole function
  // - through the transport.connect() call near its end - used to be
  // process-global setup that ran once at boot for one fixed
  // `test-room`; it's now invoked fresh per call instead, so concurrent
  // calls each get a genuinely independent `session`/`stt`/`transport`
  // with no shared mutable state between them (see the "Concurrent,
  // multi-tenant call handling" plan this was built from).
  async function runCallSession(roomName: string): Promise<void> {
    let session: CallSession | null = null
    let transport: LiveKitTransport

    // Tags every log line from this call with its own room name, so two
    // calls' interleaved stdout can actually be told apart - almost all
    // of this file's logging (plain console.log/warn/error) predates
    // concurrent calls existing at all, back when there was only ever
    // one call's output on screen at a time. Scoped to this whole
    // function (covers beginCall/processTranscript/endThisCall below,
    // not just runCallSession's own setup/teardown lines).
    const callTag = `[call:${roomName}]`
    function log(...args: unknown[]): void {
      console.log(callTag, ...args)
    }
    function warn(...args: unknown[]): void {
      console.warn(callTag, ...args)
    }
    function error(...args: unknown[]): void {
      console.error(callTag, ...args)
    }

    // Per-call STT connection. This used to be ONE process-global,
    // persistent connection reused across sequential calls (its two
    // callbacks trampolining to whichever call was "currently active"
    // via a module-level `activeSession`) - since every call now gets
    // its own room, its own STT connection is the natural scope too.
    // The trampoline pattern (`session?.onTranscript` etc., rather than
    // calling straight into beginCall's own handlers) is kept because
    // beginCall() below is still async and hasn't finished building the
    // real handlers by the time this STT connection can start emitting
    // events.
    //
    // STT_PROVIDER (2026-09-04): defaults to 'openai' so pulling this
    // commit alone doesn't change behavior on the VM until the env var is
    // actually set - see CartesiaSTT.ts for why 'cartesia' is the one
    // worth switching to (collapses the old two-stage VAD+finalization
    // wait into one semantic turn.end, and Cartesia's own benchmark claims
    // particular strength on accented English call-center audio, relevant
    // to this project's UK-accented caller base). Both classes share the
    // exact same public surface (connect/pushAudio/close/
    // startAssistantSpeaking/stopAssistantSpeaking + 3-callback
    // constructor) so this ternary is the only place the choice is made.
    const stt = sttProvider === 'cartesia'
      ? new CartesiaSTT(
        (transcript, timing) => session?.onTranscript(transcript, timing),
        () => session?.onInterruption(),
        () => session?.warmUp(),
        () => session?.onFalseInterruption?.(),
      )
      : new OpenAIRealtimeSTT(
        (transcript, timing) => session?.onTranscript(transcript, timing),
        () => session?.onInterruption(),
        () => {
          session?.onCallerSpeechStart?.()
          session?.warmUp()
        },
        {
          onSpeechStop: () => session?.onCallerSpeechStop?.(),
          onTranscriptDiscarded: () => session?.onTranscriptDiscarded?.(),
        },
      )

  // Runs once per call, on LiveKit ParticipantConnected - resolves which
  // business this call belongs to from the dialed phone number, then
  // builds everything that depends on it (system prompt, LLM, TTS voice,
  // and the whole per-turn conversation-processing pipeline), exactly as
  // main() used to build once at process startup for a single hardcoded
  // BUSINESS_SLUG.
  async function beginCall(participant: RemoteParticipant): Promise<void> {
    // (No stale-session guard here anymore - see commit 3692344 for the
    // one this replaced. That guard existed because this whole process
    // used to share ONE `activeSession`/`stt`/`transport` across
    // sequential calls, so an abrupt hangup that left LiveKit slow to
    // report ParticipantDisconnected could let a new caller's audio flow
    // into the previous, unrelated conversation. Now that every call
    // gets its own room and its own runCallSession() closure (`session`/
    // `stt`/`transport` all freshly created per call, never reused), a
    // new participant connecting here can only ever be THIS room's one
    // caller - there is no other call's state left to collide with, so
    // the ambiguity the guard was defending against can't occur by
    // construction.)

    // Re-warm the TTS connection right away, in parallel with everything
    // below (KB fetch, LLM/TTS construction) - by the time the proactive
    // greeting is ready to speak a few lines down, this has had a real
    // head start. See ttsWarmer above and ITTS.warmUp().
    ttsWarmer.warmUp?.()
    // Same for the LLM connection, for the same reason - by the time the
    // call's own `llm` instance is constructed below (after the KB
    // fetch), this has already had a head start on the first real turn.
    warmUpLlmConnection()

    // Logged unconditionally and permanently (not just while debugging
    // this) - this is the only way to empirically confirm
    // sip.trunkPhoneNumber actually survives this project's specific LAN
    // topology (Linphone -> Kamailio SIP registrar -> livekit-sip), and
    // it's the one signal that the BUSINESS_SLUG fallback below isn't
    // silently masking a routing bug on a real call.
    log(
      '[Routing] participant.attributes:',
      JSON.stringify(participant.attributes ?? {}),
    )

    const dialedNumber = participant.attributes?.['sip.trunkPhoneNumber']

    let knowledgeBase: BusinessKnowledgeBase | null = null

    if (dialedNumber) {
      try {
        knowledgeBase = await client.getBusinessByPhone(dialedNumber)
        log(
          `[Routing] Dialed number "${dialedNumber}" -> business ` +
          `"${knowledgeBase.slug ?? knowledgeBase.name}"`,
        )

        // Business matched, but AnswerPoint has it marked inactive (see
        // BusinessController@kbPayload's 'status' field, set by
        // AnswerPointClientSync on sync) - drop this call outright,
        // never falling back to BUSINESS_SLUG (that would misroute the
        // caller into an unrelated business's script, which is worse
        // than dropping). Deliberately the risk-free version of this
        // (2026-09-17, pre-demo): by this point LiveKit has already
        // answered the SIP call (see runCallSession's transport.connect
        // above), so this is "never greet/converse with the caller and
        // hang up immediately," not a true unanswered/rejected call at
        // the telecom level - a real pre-answer SIP rejection would
        // need a separate change at Kamailio/the trunk config, not
        // attempted here on purpose.
        if (knowledgeBase.status === 'inactive') {
          log(
            `[Routing] Business "${knowledgeBase.slug ?? knowledgeBase.name}" ` +
            `is inactive - dropping this call without answering/greeting, ` +
            `no BUSINESS_SLUG fallback.`,
          )
          sessions.delete(roomName)
          await transport.disconnect().catch(err => {
            warn('[Routing] Error disconnecting transport for inactive-business call:', JSON.stringify(describeError(err), null, 2))
          })
          await stt.close().catch(err => {
            warn('[Routing] Error closing STT for inactive-business call:', JSON.stringify(describeError(err), null, 2))
          })
          return
        }
      } catch (error: any) {
        warn(
          `[Routing] No active business found for dialed number ` +
          `"${dialedNumber}" - falling back to BUSINESS_SLUG: ` +
          `${error?.message ?? error}`,
        )
      }
    } else {
      // Expected for the browser Test Call page (LiveKitTest.vue), which
      // joins as a plain participant with no SIP attributes at all - not
      // itself a routing failure.
      log(
        '[Routing] No sip.trunkPhoneNumber attribute on this participant ' +
        '(browser Test Call, or a real SIP call whose attributes haven\'t ' +
        'been confirmed to include it yet) - using BUSINESS_SLUG',
      )
    }

    // Fallback path: today's original behavior (single hardcoded
    // BUSINESS_SLUG), used whenever phone-based routing above doesn't
    // apply or fails. A routing miss must never hard-fail a call.
    const fallbackSlug = process.env.BUSINESS_SLUG ?? 'xyz'

    if (!knowledgeBase) {
      knowledgeBase = await client.getBusiness(fallbackSlug).catch(error => {
        warn(
          `[KnowledgeBase] Failed to fetch business "${fallbackSlug}" from ` +
          `backend, falling back to generic prompt (intake still works, just ` +
          `without business-specific answers): ${error?.message ?? error}`,
        )
        return FALLBACK_KNOWLEDGE_BASE
      })
    }

    const businessSlug = knowledgeBase.slug ?? fallbackSlug

    // Log a concise summary of what actually came back so a stale/
    // incomplete KB is visible in this process's own terminal output,
    // rather than only inferable from the LLM's phrasing on a live call.
    log(
      `[KnowledgeBase] Loaded "${knowledgeBase.name}" (business=${businessSlug}) - ` +
      `services=${knowledgeBase.services ? 'yes' : 'no'} ` +
      `pricing=${knowledgeBase.pricing ? 'yes' : 'no'} ` +
      `products=${knowledgeBase.products?.length ?? 0} ` +
      `faq=${knowledgeBase.faq?.length ?? 0}`,
    )

    let llm: ILLM

    // Read directly off the participant here (rather than waiting for
    // the `callerNumber` local declared further below) - this is the
    // earliest point in beginCall() with both the SIP attributes and the
    // knowledge base in hand, and buildSystemPrompt only needs the value
    // once, at construction time.
    const callerNumberForPrompt = participant.attributes?.['sip.phoneNumber'] ?? null
    const systemPrompt = buildSystemPrompt(knowledgeBase, callerNumberForPrompt)

    llm = createLlm(llmProvider, systemPrompt)

    // LLM_FALLBACK_PROVIDER (optional): when the primary provider's own
    // internal bounded retry (see GroqLLM.ts/GeminiLLM.ts's
    // withRateLimitRetry) still exhausts and throws - confirmed on real
    // calls to happen on this account's Groq org whenever a call runs
    // long enough to hit its 8000 TPM ceiling (see the [Conversation]
    // Error: RateLimitError entries in this process's own logs)
    // FallbackLLM.ts answers that turn with a different provider, handing
    // it the conversation so far so the caller never has to repeat
    // themselves, and tries the primary again on later turns (after a
    // short cooldown - see FallbackLLM.ts). Off by default (unset ->
    // createLlm()'s return value is used directly, zero behavior change)
    // since falling over to a different model/voice mid-call is a real
    // trade-off, not something to do unconditionally.
    const fallbackProvider = process.env.LLM_FALLBACK_PROVIDER
    if (fallbackProvider && fallbackProvider !== llmProvider) {
      llm = new FallbackLLM(
        llm,
        () => createLlm(fallbackProvider, systemPrompt),
        `Fallback:${llmProvider}->${fallbackProvider}`,
      )
    }

    let tts: ITTS

    if (ttsProvider === 'rime') {
      tts = new RimeTTS(knowledgeBase.voice_id)

      // Visibility for the voice-testing pass: confirms whether the
      // business's dashboard-selected voice_id actually made it here, or
      // whether it's silently on the fallback default. Per-call now
      // (rather than once at process startup) since the voice can
      // genuinely vary call to call.
      log(
        `[TTS] [Rime] Voice: ${knowledgeBase.voice_id || `${DEFAULT_SPEAKER} (default - business has no voice_id set)`}`,
      )
    } else if (ttsProvider === 'openai') {
      tts = new OpenAITTS()
    } else if (ttsProvider === 'cartesia') {
      // knowledgeBase.voice_id still holds Rime-era voice ids for most
      // seeded businesses ('vashti', 'albion', ...) - CartesiaTTS's
      // constructor guards against that (only a real Cartesia UUID is
      // used, everything else falls back to DEFAULT_VOICE_ID/Gemma), so
      // it's safe to pass through even before a real per-business
      // Cartesia voice mapping exists (mirroring
      // backend/config/rime_voices.php - still a fast-follow).
      const cartesiaTts = new CartesiaTTS(knowledgeBase.voice_id)
      tts = cartesiaTts

      // Logs the TRUE resolved voice id (cartesiaTts.voiceId), not the
      // raw knowledgeBase.voice_id - most seeded businesses still carry
      // a Rime-era id ('vashti', 'albion', ...) that CartesiaTTS's
      // constructor silently falls back away from, so echoing the raw
      // field here would misreport which voice is actually speaking.
      log(
        `[TTS] [Cartesia] Voice: ${cartesiaTts.voiceId}` +
        (cartesiaTts.voiceId === DEFAULT_VOICE_ID ? ' (default - Gemma)' : ''),
      )
    } else {
      throw new Error(
        `Unknown TTS_PROVIDER "${ttsProvider}" - expected "openai", "rime", or "cartesia"`,
      )
    }

  const ttsQueue = new TTSSentenceQueue(
    tts,
    (pcm, signal) => {
      // Commented out (Aug 29 2026, not deleted) - fires once per audio
      // chunk (dozens per sentence), one of the biggest contributors to
      // log volume; the regression it helped diagnose is fixed and
      // confirmed clean. Uncomment if that class of bug resurfaces.
      // log('[TTS] publishAudio called:', pcm.length, 'samples')
      return transport.publishAudio(pcm, signal)
    },

    () => transport.waitForPlayout(),

    () => {
      log('[TTS] playback started')
      ttsPlaying = true
      if (activeTurn)
        activeTurn.audible = true
      stt.startAssistantSpeaking()
    },

    () => {
      log('[TTS] playback finished')
      ttsPlaying = false
      stt.stopAssistantSpeaking()
    },
  )

  let transcriptQueue = Promise.resolve()
  let conversationGeneration = 0
  let ttsPlaying = false

  // Caller continuation (2026-10-07). Real call: a caller pausing mid-
  // answer ("It's one silk house ... Park Green") got split by server VAD
  // into two transcripts, and each got its own reply - the second reply
  // contradicting the first. Two cases, both keyed off the caller having
  // ALREADY started talking again:
  //  - the first fragment's transcript arrives while they're talking
  //    again -> hold it and merge it with the next transcript;
  //  - the first fragment's turn is already generating but nothing has
  //    been heard yet -> drop that reply (abort LLM, cancel TTS). The
  //    fragment stays in the LLM history as a user message, so the next
  //    transcript is answered together with it. If the "continuation"
  //    turns out to be noise (no transcript), the dropped turn is re-run.
  // Once any audio of a reply has played, the existing interruption path
  // handles it instead.
  const CONTINUATION_MAX_HOLD_MS = 8000
  const CONTINUATION_AFTER_STOP_MS = 2500
  let callerSpeaking = false
  let activeTurn: { transcript: string; timing: TranscriptTiming; llmDone: boolean; audible: boolean } | null = null
  let supersededTurn: { transcript: string; timing: TranscriptTiming } | null = null
  let supersededTimer: ReturnType<typeof setTimeout> | null = null

  // Real-call evidence (2026-09-02 test calls): a single warm-up ping
  // fired once at speech_start often wasn't enough on its own - if
  // STT+LLM took longer than the connection's keep-alive window (a long
  // caller utterance, or an occasional slow LLM response), the warmed
  // connection went idle and closed again before the real TTS request
  // could reuse it, and that turn paid the full ~1000ms cold-connection
  // cost anyway. Re-pinging every WARM_UP_REPEAT_MS keeps a fresh
  // connection alive for as long as the caller/LLM take, instead of
  // gambling on one ping surviving the whole wait. Cleared the instant
  // this turn's own first real TTS request goes out (see
  // firstSentenceQueuedAt below) - once that request is in flight, more
  // warm-up pings would only compete with it for the connection.
  const WARM_UP_REPEAT_MS = 2000
  let warmUpInterval: ReturnType<typeof setInterval> | null = null

  function stopWarmUpInterval(): void {
    if (warmUpInterval) {
      clearInterval(warmUpInterval)
      warmUpInterval = null
    }
  }

  // The in-flight turn's LLM call, so an interruption can cut it short
  // instead of letting it run to completion in the background producing
  // output nobody will hear. Before this existed, an interrupted turn's
  // generateStream() call kept running (no signal was ever passed to it),
  // which meant the NEXT turn's LLM call - chained via transcriptQueue
  // below - had to wait for that whole abandoned generation to finish
  // first. Real, measured cause of multi-second "queue wait" on
  // interrupted turns, independent of which LLM provider is active.
  let currentTurnAbortController: AbortController | null = null

  // Set true by onInterruption below, consumed (and cleared) by the very
  // next processTranscript() call. Real-call evidence (see
  // voiceai_runtime_status.md): when the caller talks over one of the
  // assistant's own not-yet-finished questions, the LLM call for that
  // question had almost always already completed and been recorded to
  // history in full BEFORE the interruption fired (interruptions are
  // detected from raw audio during TTS playback, well after the LLM
  // stream itself finished) - so the model's history shows it as fully
  // asked even though the caller may only have heard part of it. Without
  // this, a bare "yeah"/"sure" answering that half-heard question got
  // mistaken for something needing a fresh answer, and the model re-asked
  // a close paraphrase of the same question instead of accepting the
  // confirmation. This only adds context for exactly one turn, not every
  // turn after an interruption - a false-positive interruption (the known
  // RMS-gate-vs-background-noise issue) just means an unnecessary note
  // gets attached once, which is harmless, not a fresh bug.
  let lastTurnWasInterrupted = false

  // The full text of the most recent turn that actually got spoken (not
  // stale, not suppressed) - checked when an interruption fires so the
  // context note below only attaches when there's a real risk of it
  // mattering. Real-call evidence (Aug 29 2026): firing the note after
  // ANY interruption, including one that cut off a plain farewell
  // ("You're welcome! Have a great day.") with no pending question, gave
  // the model an opening to treat the caller's next line as needing a
  // "re-orient" - it picked a full canonical opening greeting instead of
  // continuing the conversation, which read as the call resetting itself
  // rather than continuing naturally. Gating on whether the interrupted
  // reply ends in "?" keeps the note for its actual purpose (a
  // half-heard QUESTION) without nudging the model to "reorient" after
  // something that was never a question in the first place.
  let lastAssistantResponseText = ''

  // Sept 5 2026: the local RMS gate that used to filter background
  // noise out of turn.start-triggered interrupts got reverted (it was
  // blocking real barge-in - see CartesiaSTT.ts's turn.start handler)
  // in favor of recovering AFTER a false alarm instead of trying to
  // predict one before the interrupt fires. This tracks which exact
  // reply text has already been replayed once, so a noisy room can't
  // loop the same reply over and over - one retry per reply, then it's
  // left as a normal (silent) false-positive same as before this fix.
  let lastFalseInterruptionReplayText: string | null = null

  const INTERRUPTED_CONTEXT_NOTE =
    'The caller spoke over your last message before you finished it, so ' +
    'they may only have heard part of it. If their reply below reads as a ' +
    'short confirmation or answer (e.g. "yeah," "sure," "okay," "that\'s ' +
    'right") rather than new information, treat it as confirming or ' +
    'answering what you were in the middle of saying or asking, and move ' +
    'the conversation forward - do not repeat or re-ask that same question ' +
    'in different words. If their reply is unrelated or genuinely unclear, ' +
    'it is fine to briefly re-orient, but do not just restate the ' +
    'interrupted question verbatim.'

  // Call-log bookkeeping (see CallLogClient.ts/CallLogExtractor.ts). Each
  // call gets its own room, its own runCallSession() closure, and its own
  // `stt`/`transport` now (see runCallSession above) - so all of this is
  // simply per-call local state, same as `llm`/`tts`. Side benefit of
  // `llm` being built fresh per call rather than shared across calls:
  // the previously-known history leak across sequential calls (a second
  // call carrying the first call's conversation) is fixed as a
  // consequence, not something that needs separate handling here.
  // (callLogClient itself stays the process-global instance created at
  // the top of main() - not recreated here.)
  let callStartedAt: Date | null = new Date()
  let callerNumber: string | null = participant.attributes?.['sip.phoneNumber'] ?? null
  let transcriptTurns: TranscriptTurn[] = []
  let ttsCharactersThisCall = 0
  let usageSnapshotAtCallStart = llm.getUsageTotals()

  log(
    `[CallLog] Call started - business=${businessSlug} caller=${callerNumber ?? 'unknown'}`,
  )

  // A bare greeting fragment ("Hello", "Hi", "Hey"...) with nothing else
  // is ambiguous mid-call - real-call evidence (Aug 29 2026) showed the
  // caller pausing briefly after it before continuing with the actual
  // reason they'd called ("Hello" ... "I'm Shujaat."), and the STT
  // genuinely split that into two separate transcripts with two separate
  // speech_started events (a real race, not a hallucination). Treating
  // "Hello" alone as a complete turn made the model re-ask a question it
  // had literally just asked, and left enough confusion in the history
  // that it later closed the call out without ever asking for the
  // address or callback number. Holding ONLY this narrow bare-greeting
  // case for a short grace window - not every short transcript - keeps
  // the added latency contained to a rare, specific pattern instead of
  // taxing every quick yes/no answer with an artificial delay.
  const GREETING_LEADIN = /^(?:hi|hello|hey|yo|hiya)\W*$/i
  const GREETING_LEADIN_HOLD_MS = 600
  const GREETING_LEADIN_MAX_HOLD_MS = 1500

  let pendingTranscript: string | null = null
  let pendingTiming: TranscriptTiming | null = null
  let pendingStartedAt = 0
  let pendingTimer: ReturnType<typeof setTimeout> | null = null

  function dispatchTranscript(transcript: string, timing: TranscriptTiming): void {
    // Anchor the whole turn's timeline on when the user actually stopped
    // talking (VAD speech_stopped), not on when the transcript arrived —
    // the gap between those two is largely the silence_duration_ms VAD
    // hangover, which is otherwise invisible in per-stage logs.
    const anchor = timing.speechStoppedAt ?? timing.transcriptCompletedAt

    log(
      `[Conversation] TRANSCRIPT RECEIVED ${JSON.stringify(transcript)} ` +
      `generation=${conversationGeneration} — ` +
      `${timing.transcriptCompletedAt - anchor} ms from speech_stopped to here ` +
      `(+ ${timing.vadSilenceDurationMs} ms of VAD silence wait that already elapsed BEFORE speech_stopped ` +
      `and is not included in this or any later [Timing] number)` +
      (timing.speechStoppedAt ? '' : ' (no speech_stopped timestamp, using transcript-complete as anchor)'),
    )

    // transcriptQueue is a strict serial chain: if a PREVIOUS turn's
    // processTranscript() (LLM + all its TTS) is still running, this one
    // waits for it to fully finish before even starting its own LLM
    // call — regardless of how fast STT transcribed it. Tried removing
    // the TTS-drain part of that wait (Aug 28 2026) on the theory that
    // the next turn's LLM call only needs the previous turn's reply
    // already in history, not its audio finished - reverted after a
    // real call showed why that's wrong: an utterance that arrives
    // during a long reply's still-draining TTS (Rime synthesizes one
    // sentence at a time - a multi-sentence reply can take far longer to
    // finish SPEAKING than it took to GENERATE) but that the RMS
    // interruption gate doesn't flag as an interruption used to be held
    // here until the current turn's TTS fully drained, so its own LLM
    // call always started into a quiet room. Removing that let two
    // turns' TTS output stack on the same shared queue with no gap
    // between them - see the Promise.all(ttsPromises) comment in
    // processTranscript. An interrupted previous turn's LLM call DOES
    // still get aborted instead of running to completion in the
    // background though (see currentTurnAbortController) - that part of
    // the same change was fine and stays. That wait is invisible unless
    // logged explicitly, so it's timestamped here and reported the
    // moment this turn actually starts (see "queue wait" in
    // processTranscript below).
    const receivedAt = Date.now()

    transcriptQueue = transcriptQueue
      .then(async () => {
        try {
          await processTranscript(transcript, timing, receivedAt)
        } finally {
          activeTurn = null
        }
      })
      .catch(err => {
        error('[Conversation] Error:', JSON.stringify(describeError(err), null, 2))

        // Added 2026-09-08: this catch used to be the end of the line - a
        // real call (Groq's bounded retries in withRateLimitRetry both
        // exhausted, LLM_FALLBACK_PROVIDER unset so FallbackLLM.ts's
        // provider switch never even ran) confirmed the caller is left in
        // total, unexplained silence for the rest of the turn: nothing
        // upstream of this catch ever speaks once processTranscript
        // throws. This is the last line of defense for ANY turn failure,
        // not just Groq's - LLM_FALLBACK_PROVIDER (see beginCall above)
        // is the real fix for a single provider's rate limit, but even
        // that only has one fallback level (see FallbackLLM.ts's own
        // comment), so this still needs to exist for whenever both are
        // exhausted, or the failure has nothing to do with the LLM at all
        // (a TTS enqueue error, etc). Deliberately short and generic -
        // never says "error"/"rate limit"/anything a real receptionist
        // wouldn't say - so it costs almost nothing even if it fires on
        // every turn during a bad patch.
        const apology = 'Sorry, I\'m having a little trouble on my end - could you say that again?'
        ttsCharactersThisCall += apology.length
        void ttsQueue.push(apology).catch(ttsError => {
          error(
            '[Conversation] Error speaking fallback apology (TTS itself failed too):',
            JSON.stringify(describeError(ttsError), null, 2),
          )
        })
      })
  }

  function flushPendingTranscript(): void {
    if (pendingTranscript === null || pendingTiming === null)
      return

    const transcript = pendingTranscript
    const timing = pendingTiming

    pendingTranscript = null
    pendingTiming = null
    pendingTimer = null

    dispatchTranscript(transcript, timing)
  }

  function clearSuperseded(): void {
    if (supersededTimer)
      clearTimeout(supersededTimer)
    supersededTimer = null
    supersededTurn = null
  }

  // The "continuation" that dropped a reply produced no transcript
  // (noise, a breath) - answer the original fragment after all.
  function rerunSuperseded(): void {
    const turn = supersededTurn
    clearSuperseded()

    if (!turn)
      return

    log(
      `[Conversation] No follow-on words arrived - answering the dropped turn ` +
      `${JSON.stringify(turn.transcript)} after all`,
    )

    dispatchTranscript(turn.transcript, turn.timing)
  }

  async function finalizeCallLog(): Promise<void> {
    if (!callStartedAt)
      return

    const startedAt = callStartedAt
    const endedAt = new Date()
    const turns = transcriptTurns
    const usageAtStart = usageSnapshotAtCallStart
    const ttsChars = ttsCharactersThisCall

    callStartedAt = null

    log(`[CallLog] Call ended - finalizing (turns=${turns.length})`)

    const extraction = await extractCallLogFields(turns)
    const usageNow = llm.getUsageTotals()

    // Only meaningful for a Realtime-API-backed ILLM (see RealtimeLLM.ts's
    // close()) - releases its persistent WebSocket now that this call is
    // over and this llm instance will never be used again. A no-op
    // optional chain for every REST-based provider, which has no
    // per-call connection of its own to release.
    llm.close?.()

    await callLogClient.submit({
      businessSlug,
      livekitRoom: roomName,
      callerNumber,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      rawTranscript: turns,
      llmPromptTokens: Math.max(0, usageNow.promptTokens - usageAtStart.promptTokens),
      llmCompletionTokens: Math.max(0, usageNow.completionTokens - usageAtStart.completionTokens),
      ttsCharacters: ttsChars,
      ...extraction,
    })
  }

    session = {
      onTranscript: (transcript, timing) => {
      if (supersededTurn) {
        log(
          `[Conversation] Answering ${JSON.stringify(transcript)} together with the ` +
          `earlier fragment ${JSON.stringify(supersededTurn.transcript)} (already in the LLM history)`,
        )
        clearSuperseded()
      }

      if (pendingTranscript !== null) {
        if (pendingTimer)
          clearTimeout(pendingTimer)

        const separator = /[.!?]$/.test(pendingTranscript.trim()) ? ' ' : '. '
        const merged = `${pendingTranscript.trim()}${separator}${transcript.trim()}`

        log(
          `[Conversation] Merging held fragment ${JSON.stringify(pendingTranscript)} ` +
          `with the next transcript ${JSON.stringify(transcript)} into one turn: ${JSON.stringify(merged)}`,
        )

        pendingTranscript = merged
        pendingTiming = timing

        const stillWithinBudget = Date.now() - pendingStartedAt < GREETING_LEADIN_MAX_HOLD_MS

        if (callerSpeaking)
          pendingTimer = setTimeout(flushPendingTranscript, CONTINUATION_MAX_HOLD_MS)
        else if (GREETING_LEADIN.test(transcript.trim()) && stillWithinBudget)
          pendingTimer = setTimeout(flushPendingTranscript, GREETING_LEADIN_HOLD_MS)
        else
          flushPendingTranscript()

        return
      }

      if (callerSpeaking) {
        log(
          `[Conversation] Caller is already talking again - holding ${JSON.stringify(transcript)} ` +
          `to merge with what they say next (see CONTINUATION_MAX_HOLD_MS)`,
        )

        pendingTranscript = transcript
        pendingTiming = timing
        pendingStartedAt = Date.now()
        pendingTimer = setTimeout(flushPendingTranscript, CONTINUATION_MAX_HOLD_MS)

        return
      }

      if (GREETING_LEADIN.test(transcript.trim())) {
        log(
          `[Conversation] Holding bare greeting ${JSON.stringify(transcript)} briefly in case ` +
          `the caller is still talking (see GREETING_LEADIN in this file)`,
        )

        pendingTranscript = transcript
        pendingTiming = timing
        pendingStartedAt = Date.now()
        pendingTimer = setTimeout(flushPendingTranscript, GREETING_LEADIN_HOLD_MS)

        return
      }

      dispatchTranscript(transcript, timing)
      },
      onInterruption: () => {
        log('[Conversation] User interrupted assistant')

      lastTurnWasInterrupted = /\?\s*$/.test(lastAssistantResponseText.trim())

      if (!lastTurnWasInterrupted && lastAssistantResponseText) {
        log(
          '[Conversation] Interrupted reply wasn\'t a pending question ' +
          '(e.g. a farewell/statement) - skipping the context note for the next turn',
        )
      }

      conversationGeneration++

      log(
        `[Conversation] INTERRUPT AFTER generation=${conversationGeneration}`,
      )

      ttsPlaying = false

      currentTurnAbortController?.abort()
      transport.clearAudioQueue()
      ttsQueue.cancel()
        stt.stopAssistantSpeaking()
      stopWarmUpInterval()
      },
      onFalseInterruption: () => {
        // The interruption above already happened - TTS is already cut
        // and cancelled - this only fires afterward, once CartesiaSTT
        // confirms that turn's final transcript came back empty/non-
        // lexical, i.e. there was never any real speech behind it. The
        // caller is just left mid-silence otherwise, with no idea why
        // the assistant stopped talking. Re-speaking the same reply from
        // the top is simpler and safer than trying to resume mid-
        // sentence (no partial-audio bookkeeping needed), at the cost of
        // synthesizing it twice - acceptable for a rare noise blip, not
        // for every interruption, which is why this is capped at one
        // retry per distinct reply (see lastFalseInterruptionReplayText).
        if (!lastAssistantResponseText) {
          log('[Conversation] False-alarm interruption with no prior reply to replay - ignoring')
          return
        }

        if (lastFalseInterruptionReplayText === lastAssistantResponseText) {
          log(
            '[Conversation] False-alarm interruption, but this reply was already ' +
            'replayed once - not retrying again to avoid looping in a noisy room',
          )
          return
        }

        lastFalseInterruptionReplayText = lastAssistantResponseText

        // 2026-10-11: a real call replayed a ~15s service list in full after
        // a noise blip. For a long reply, only its last sentence (normally
        // the question the caller still needs to answer) is repeated.
        const sentences = lastAssistantResponseText.split(/(?<=[.!?])\s+/)
        const replayText = lastAssistantResponseText.length > 120 && sentences.length > 1
          ? sentences[sentences.length - 1]
          : lastAssistantResponseText

        log(
          '[Conversation] False-alarm interruption (background noise, not the ' +
          'caller) - replaying the interrupted reply:',
          JSON.stringify(replayText),
        )

        ttsCharactersThisCall += replayText.length

        void ttsQueue.push(toSpeakable(replayText)).catch(err => {
          error(
            '[Conversation] Error replaying false-alarm-interrupted reply:',
            JSON.stringify(describeError(err), null, 2),
          )
        })
      },
      onCallerSpeechStart: () => {
        callerSpeaking = true

        if (supersededTimer) {
          clearTimeout(supersededTimer)
          supersededTimer = null
        }

        const turn = activeTurn
        if (!turn || turn.llmDone || turn.audible || turn.transcript === supersededTurn?.transcript)
          return

        log(
          `[Conversation] Caller kept talking before the reply to ${JSON.stringify(turn.transcript)} ` +
          'was heard - dropping that reply and answering both parts together',
        )

        supersededTurn = { transcript: turn.transcript, timing: turn.timing }
        conversationGeneration++
        currentTurnAbortController?.abort()
        transport.clearAudioQueue()
        ttsQueue.cancel()
      },
      onCallerSpeechStop: () => {
        callerSpeaking = false

        // A transcript normally follows within ~0.7s; if none does, don't
        // leave a held fragment or a dropped reply stranded.
        if (pendingTranscript !== null && pendingTimer) {
          clearTimeout(pendingTimer)
          pendingTimer = setTimeout(flushPendingTranscript, CONTINUATION_AFTER_STOP_MS)
        }

        if (supersededTurn)
          supersededTimer = setTimeout(rerunSuperseded, CONTINUATION_AFTER_STOP_MS)
      },
      onTranscriptDiscarded: () => {
        if (pendingTranscript !== null && !callerSpeaking) {
          if (pendingTimer)
            clearTimeout(pendingTimer)
          flushPendingTranscript()
        }

        if (supersededTurn && !callerSpeaking)
          rerunSuperseded()
      },
      clearPendingGreeting: () => {
        if (pendingTimer)
          clearTimeout(pendingTimer)
        pendingTranscript = null
        pendingTiming = null
      },
      warmUp: () => {
        log('[TTS] Warming up connection ahead of the next reply (caller started speaking)')
        tts.warmUp?.()
        // Same connection-warming idea, now for this call's own `llm`
        // instance (see ILLM.warmUp?() / GroqLLM's warmUpGroqConnection) -
        // the boot-time and beginCall()-start pings above only cover a
        // connection that's gone stone cold; this is what re-warms it
        // between ordinary turns too, same as tts.warmUp?.() already does.
        llm.warmUp?.()

        // Keep re-pinging every WARM_UP_REPEAT_MS until this turn's real
        // TTS request actually goes out (enqueueSentence below clears
        // this) - a single ping can go stale if STT+LLM takes a while.
        stopWarmUpInterval()
        warmUpInterval = setInterval(() => {
          tts.warmUp?.()
          llm.warmUp?.()
        }, WARM_UP_REPEAT_MS)
      },
      finalize: async () => {
        stopWarmUpInterval()
        await finalizeCallLog()
      },
    }

  // Real front-desk calls always speak first (see
  // ai-runtime/call-samples/*.txt, provided by the client) - the caller
  // picks up and immediately hears "Good morning/afternoon/evening,
  // {business}, how can I help?" rather than being the one who has to
  // speak first, which is how this app used to behave (it only ever
  // replied to the caller's own first utterance, dressed up as a
  // greeting). Spoken directly here, bypassing the LLM entirely -
  // buildGreetingText() produces the exact same text the system prompt
  // tells the model it already said (see buildSystemPrompt.ts), so
  // wording is guaranteed to match the sample calls exactly and there's
  // no LLM round-trip latency before the caller hears anything at all.
  // llm.primeGreeting() seeds this into the model's own conversation
  // history so it knows the greeting already happened and won't repeat
  // or re-introduce itself on the caller's first real turn.
  const greetingText = buildGreetingText(knowledgeBase)

  log(
    `[Conversation] Speaking proactive greeting: ${JSON.stringify(greetingText)}`,
  )

  llm.primeGreeting(greetingText)
  transcriptTurns.push({ role: 'assistant', text: greetingText, at: new Date().toISOString() })
  lastAssistantResponseText = greetingText
  lastFalseInterruptionReplayText = null
  ttsCharactersThisCall += greetingText.length

  // 2026-09-10: a real test call reported hearing only the tail of the
  // greeting ("...ing" of "Good morning") - every later turn in the same
  // call played fine, only ever the very first thing spoken. That points
  // at a one-time cold-start gap on the SIP/RTP side: this participant's
  // media path (LiveKit-SIP <-> Kamailio <-> the carrier) needs a brief
  // moment after answer to actually start relaying our published audio
  // track, but AudioSource.captureFrame() (LiveKitTransport.ts) starts
  // advancing its own real-time playout clock the instant we call it,
  // regardless of whether that relay is ready yet - so whatever we send
  // during that gap is never heard, not delayed/buffered. A brief pause
  // here, before anything is sent, is the standard fix for this class of
  // bug. Only applied to the greeting - by the time any later turn
  // plays, that same media path has been flowing for a while and this
  // gap no longer exists. 400ms is a starting guess, not measured from
  // real timing (this app's console logs don't carry timestamps) - if a
  // caller still loses leading audio, raise it; if greetings feel
  // sluggish and it's never clipped, lower it.
  const GREETING_AUDIO_START_DELAY_MS = 400
  await new Promise(resolve => setTimeout(resolve, GREETING_AUDIO_START_DELAY_MS))

  void ttsQueue.push(greetingText).catch(err => {
    error('[Conversation] Error speaking proactive greeting:', JSON.stringify(describeError(err), null, 2))
  })

  async function processTranscript(
    transcript: string,
    timing: TranscriptTiming,
    receivedAt: number,
  ): Promise<void> {
    const generation = conversationGeneration

    const thisTurn = { transcript, timing, llmDone: false, audible: false }
    activeTurn = thisTurn

    // Single anchor for the whole turn: "user stopped talking". Every
    // [Timing] log below reports elapsed-since-anchor so the stages can be
    // compared on one timeline instead of stitched together by hand from
    // several files' logs.
    const turnAnchor = timing.speechStoppedAt ?? timing.transcriptCompletedAt

    const queueWaitMs = Date.now() - receivedAt

    const contextNote = lastTurnWasInterrupted ? INTERRUPTED_CONTEXT_NOTE : undefined
    lastTurnWasInterrupted = false

    if (contextNote) {
      log(
        '[Conversation] Previous turn was interrupted - adding context note ' +
        'for this turn so a bare confirmation isn\'t mistaken for a fresh question',
      )
    }

    // Divider goes before START (not just before "USER TRANSCRIPT:") so the
    // whole new turn - including its own queue-wait/generation bookkeeping
    // line - reads as one visually separate block from the previous turn's
    // tail of [TTS]/[Timing] noise, rather than splitting the two.
    log(color('90', '\n' + '─'.repeat(70)))

    log(
      `[Conversation] START transcript=${JSON.stringify(transcript)} generation=${generation}` +
      (queueWaitMs > 50
        ? ` — queue wait: ${queueWaitMs} ms (this turn sat behind a still-running previous turn ` +
          `before its own LLM call could start — see transcriptQueue in this file)`
        : ''),
    )

    log(color('96;1', 'USER TRANSCRIPT:'), transcript)

    transcriptTurns.push({ role: 'user', text: transcript, at: new Date().toISOString() })

    const llmStartedAt = Date.now()
    let firstDeltaAt: number | undefined
    let firstSentenceQueuedAt: number | undefined

    let sentenceBuffer = ''
    // Holds a chunk extracted via extractTTSChunks' clause-based early
    // flush (its `premature` flag) instead of firing it immediately - see
    // that function's comment and the merge logic below/at the end of
    // this turn for why: firing a premature chunk right away risks
    // stranding whatever's left of that same sentence as its own
    // isolated, oddly-paced short utterance once the turn ends (real bug,
    // seen twice on real calls - "if any?" and similar short trailing
    // qualifiers spoken alone). Only ever holds ONE chunk at a time - as
    // soon as anything else is extracted (a genuine complete sentence, or
    // another premature clause), the held one is fired first, so this
    // adds at most one extra chunk's worth of streaming latency, only for
    // the relatively rare long-sentence-with-a-comma case.
    let heldPrematureChunk: string | null = null
    const ttsPromises: Promise<void>[] = []

    let spokeThisTurn = false
    // Set once the reply hits NO_REPLY_SENTINEL or has asked its question -
    // nothing after either is spoken (see cleanSpokenReply in
    // buildSystemPrompt.ts).
    let reachedSentinel = false
    let askedQuestion = false

    const enqueueSentence = (sentence: string) => {
      if (reachedSentinel)
        return

      if (askedQuestion) {
        log(
          color('93', '[Conversation] Reply ran on past its question - not speaking:'),
          JSON.stringify(sentence.trim()),
        )
        return
      }

      if (sentence.includes(NO_REPLY_SENTINEL)) {
        reachedSentinel = true

        if (isNoReplySentinel(sentence) && !spokeThisTurn) {
          log(
            color('93', '[Conversation] Suppressed reply (filler/no new info) - nothing will be spoken:'),
            JSON.stringify(sentence.trim()),
          )
        } else {
          log(
            color('93', '[Conversation] Reply ran on past [[NO_REPLY]] - dropping everything from there:'),
            JSON.stringify(sentence.slice(sentence.indexOf(NO_REPLY_SENTINEL))),
          )
        }
      }

      const text = cleanSpokenReply(sentence)

      // Nothing sayable (the bare sentinel, or a run of dots) - Cartesia
      // TTS 400s on a chunk with no words.
      if (isNoReplySentinel(text) || !/[\p{L}\p{N}]/u.test(text))
        return

      spokeThisTurn = true

      if (text.endsWith('?'))
        askedQuestion = true

      ttsCharactersThisCall += text.length

      if (generation !== conversationGeneration)
        return

      if (firstSentenceQueuedAt === undefined) {
        firstSentenceQueuedAt = Date.now()

        log(
          `[Timing] First sentence queued for TTS: ${firstSentenceQueuedAt - turnAnchor} ms since speech_stopped`,
        )

        // The real request for this turn is about to go out - stop
        // re-pinging so the warm-up pings don't compete with it.
        stopWarmUpInterval()
      }

      // Fires the instant this chunk is queued for TTS - i.e. before
      // it's actually synthesized/played - so this is the earliest
      // point the caller-side reader can see what's about to be said,
      // colored to match USER TRANSCRIPT/LLM RESPONSE below (2026-09-05,
      // added so the text log can substitute for turning the speaker up).
      log(color('95;1', 'ASSISTANT (about to say):'), text)

      ttsPromises.push(
        ttsQueue.push(toSpeakable(text)),
      )
    }

    const abortController = new AbortController()
    currentTurnAbortController = abortController

    const rawResponse = await llm.generateStream(
      transcript,
      delta => {
        // Both logs below commented out (Aug 29 2026, not deleted) - they
        // fire once per streamed token (dozens per reply), by far the
        // single biggest contributor to log volume. The
        // generation-staleness check itself stays live below; only the
        // per-delta tracing is silenced. The full text is still visible
        // afterward via "LLM RESPONSE:" and each extracted "[LLM
        // SENTENCE]". Uncomment if streaming/generation-mismatch behavior
        // needs tracing again.
        // log(
        //   `[Conversation] LLM delta generation=${generation} current=${conversationGeneration}`,
        // )

        if (generation !== conversationGeneration)
          return

        if (firstDeltaAt === undefined) {
          firstDeltaAt = Date.now()

          log(
            `[Timing] First LLM delta: ${firstDeltaAt - llmStartedAt} ms since LLM call started, ` +
            `${firstDeltaAt - turnAnchor} ms since speech_stopped`,
          )
        }

        // log('[LLM DELTA]', JSON.stringify(delta))

        // Rate-limit filler: speak it now, while the provider is still
        // waiting - see RATE_LIMIT_FILLER in ILLM.ts.
        if (delta === RATE_LIMIT_FILLER && !sentenceBuffer.trim()) {
          enqueueSentence(delta)
          return
        }

        sentenceBuffer += delta

        const extracted = extractTTSChunks(sentenceBuffer)

        for (const chunk of extracted.chunks) {
          // extractTTSChunks only ever returns chunks that already
          // cleared MIN_CHUNK_CHARS (premature or not), so it's always
          // safe to fire a previously-held chunk the moment anything new
          // shows up - the new arrival is never the short straggler this
          // hold exists to protect (see heldPrematureChunk above).
          if (heldPrematureChunk !== null) {
            enqueueSentence(heldPrematureChunk)
            heldPrematureChunk = null
          }

          if (chunk.premature)
            heldPrematureChunk = chunk.text
          else
            enqueueSentence(chunk.text)
        }

        sentenceBuffer = extracted.remainder
      },
      abortController.signal,
      contextNote,
    )

    thisTurn.llmDone = true

    // Same cleanup as enqueueSentence, so the call log, the false-
    // interruption replay and history match what was actually spoken.
    const response = cleanSpokenReply(rawResponse)

    log(
      `[Conversation] LLM returned generation=${generation} current=${conversationGeneration}`,
    )

    log(
      `[Timing] LLM complete: ${Date.now() - llmStartedAt} ms since LLM call started, ` +
      `${Date.now() - turnAnchor} ms since speech_stopped`,
    )

    log(color('92;1', 'LLM RESPONSE:'), response)

    if (generation !== conversationGeneration) {
      log('[Conversation] Discarding stale LLM response')
      return
    }

    // Only recorded once we know this turn wasn't discarded above - an
    // aborted/interrupted turn's (partial, never-heard) text has no
    // business in the call-log transcript. A suppressed (NO_REPLY_SENTINEL)
    // turn is skipped too - nothing was actually said to the caller, so
    // the raw transcript should show the caller's filler with no assistant
    // reply, not the internal control token.
    if (isNoReplySentinel(response)) {
      log(color('93', '[Conversation] Reply suppressed - not recording to call-log transcript'))
    } else {
      transcriptTurns.push({ role: 'assistant', text: response, at: new Date().toISOString() })
      lastAssistantResponseText = response
      lastFalseInterruptionReplayText = null
    }

    // Flush any remaining text that didn't end with punctuation. A
    // still-held premature chunk (see above) never got to see what
    // followed it while streaming was live - merge it with whatever's
    // left now rather than speaking either half as its own isolated
    // utterance (the actual fix for the "if any?" spoken-alone bug).
    const finalRemainder = sentenceBuffer.trim()

    if (heldPrematureChunk !== null)
      enqueueSentence(finalRemainder ? `${heldPrematureChunk} ${finalRemainder}` : heldPrematureChunk)
    else if (finalRemainder)
      enqueueSentence(finalRemainder)

    // REVERTED (Aug 28 2026): this used to be a fire-and-forget
    // `void Promise.all(ttsPromises).then(...)` instead of an awaited call,
    // on the theory that the next turn's LLM call only depends on this
    // turn's reply already being in history (true), not on this turn's TTS
    // having drained (seemed true, was NOT). In a real call it caused the
    // assistant to "talk over itself": a caller utterance that arrives
    // while a long, still-synthesizing reply is mid-playback but that
    // ISN'T picked up by the RMS interruption gate (different sensitivity
    // than STT's own VAD) used to be forced to wait until the CURRENT
    // turn's TTS fully drained before even starting its own LLM call - by
    // the time it started, nothing was still playing. With the wait
    // removed, that next turn's LLM call ran concurrently with the first
    // reply still being spoken (Rime synthesizes one sentence at a time,
    // sequentially - an 8-sentence reply can take 15-20+ real seconds to
    // finish speaking even though the LLM generated it in under a second),
    // and its sentences queued in right behind the still-draining first
    // reply on the same shared ttsQueue - two overlapping, half-redundant
    // replies stacked back to back with no gap. This "wait for TTS to
    // finish" wasn't just about avoiding wasted time, it was also the only
    // thing keeping two turns' TTS output from ever overlapping when an
    // utterance isn't cleanly flagged as an interruption. Back to awaiting
    // it. The AbortController/signal wiring added alongside this (see
    // currentTurnAbortController above) is unrelated and stays - it only
    // engages on an actual flagged interruption and has no part in this
    // regression.
    await Promise.all(ttsPromises)

    // Consolidated per-turn summary: everything above is scattered across
    // this file plus OpenAIRealtimeSTT.ts/LiveKitTransport.ts's own logs.
    // "PERCEIVED TOTAL" is the one number that matches what the caller
    // actually experiences: it adds back the VAD silence wait that elapsed
    // BEFORE speechStoppedAt (our anchor), which every other [Timing] line
    // omits. Ends at "last sentence's audio handed to LiveKit" — NOT
    // necessarily audible playback finish; see the captureFrame ratio log
    // for that distinction.
    if (generation === conversationGeneration) {
      const sinceAnchorMs = Date.now() - turnAnchor

      log(
        `[Timing] TURN TOTAL: ${sinceAnchorMs} ms from speech_stopped ` +
        `to last sentence's audio handed to LiveKit (generation=${generation}) — ` +
        `PERCEIVED TOTAL (from when the caller actually stopped talking): ` +
        `${sinceAnchorMs + timing.vadSilenceDurationMs} ms`,
      )
    }
  }

  }

  // Runs once a call ends, from LiveKit's ParticipantDisconnected.
  // (2026-09-01: a same-day Kamailio-side "fast hangup webhook" was
  // built and then removed here - the real bug turned out to be
  // kamailio.cfg routing in-dialog ACK/BYE to an unreachable address
  // (see its own ROOT CAUSE note), not a slow disconnect signal. Fixing
  // that made ParticipantDisconnected itself fire promptly, so the
  // separate fast-path was unneeded complexity and got reverted.)
  function endThisCall(reason: string): void {
    // Capture + clear immediately so a stray STT event arriving during
    // finalize (there shouldn't be one, but see the trampoline comment
    // above) can't be attributed to a call that's already ending.
    const endingSession = session
    session = null
    sessions.delete(roomName)

    if (!endingSession)
      return

    log(`[CallLog] Ending call in room "${roomName}" (${reason})`)

    // Don't let a still-held greeting fragment (see GREETING_LEADIN
    // above) fire into a call that has already ended.
    endingSession.clearPendingGreeting()
    void endingSession.finalize()

    // Release this call's own LiveKit room connection and STT socket now
    // that the caller is gone. Previously these were only ever closed on
    // full process shutdown (SIGINT/SIGTERM below) - every finished call
    // left its Room connection and STT websocket open and unreferenced-
    // but-not-explicitly-closed until process exit: an unbounded leak
    // that grows with call VOLUME (not just concurrency). Found while
    // investigating VM memory exhaustion after a two-call test (2026-09-09).
    void transport.disconnect().catch(err => {
      warn('[CallLog] Error disconnecting transport during cleanup:', JSON.stringify(describeError(err), null, 2))
    })
    void stt.close().catch(err => {
      warn('[CallLog] Error closing STT during cleanup:', JSON.stringify(describeError(err), null, 2))
    })
  }

  transport = new LiveKitTransport(
    frame => {
      stt.pushAudio(frame)
    },
    participant => {
      void beginCall(participant)
    },
    participant => {
      // No identity check needed here anymore (contrast with commit
      // 3692344, which added one for the old single-shared-room model) -
      // this room only ever has one caller, so any ParticipantDisconnected
      // firing here unambiguously belongs to THIS call.
      endThisCall(`LiveKit ParticipantDisconnected (${participant.identity})`)
    },
  )

  await stt.connect()

  log(`[CallLog] Requesting LiveKit token for room "${roomName}"...`)
  const token = await client.getLiveKitToken(identity, roomName)

  log(`[CallLog] Connecting to LiveKit room "${roomName}"...`)
  await transport.connect(token, url)
  log(`[CallLog] AI Runtime connected to room "${roomName}" - waiting for caller...`)

  sessions.set(roomName, { transport, stt })
  }

  // Express listener for LiveKit's `room_started` webhook (see the
  // `webhook:` block added to infra/livekit/livekit.yaml) - this is how
  // this process finds out a new call has arrived, since it no longer
  // connects to one fixed room at boot. Reuses the app.ts/routes/
  // health.ts scaffolding that used to sit unused alongside this file
  // (a leftover from an earlier, never-finished separate-entry-point
  // approach - see index.ts) rather than building a third, parallel
  // Express setup.
  const webhookPort = Number(process.env.PORT ?? 3001)

  const app = createApp(roomName => {
    if (sessions.has(roomName)) {
      console.warn(`[Webhook] Ignoring duplicate room_started for room "${roomName}" - already handling it`)
      return
    }

    // Fire-and-forget: runCallSession() only settles once that call's own
    // LiveKit room connect finishes, but the webhook response to LiveKit
    // itself must return promptly and doesn't need to wait for that.
    void runCallSession(roomName).catch(error => {
      console.error(
        `[Webhook] Failed to start call session for room "${roomName}":`,
        JSON.stringify(describeError(error), null, 2),
      )
    })
  })

  app.listen(webhookPort, () => {
    console.log(`[Webhook] Listening for LiveKit room_started webhooks on port ${webhookPort}`)
  })

  // Periodic process-wide memory sample, tagged with how many calls are
  // active right now - added 2026-09-09 after a two-simultaneous-call
  // test correlated with VM memory exhaustion, to get a direct log-line
  // answer to "does call volume/concurrency actually drive memory up"
  // instead of only ever seeing it via GCP monitoring after the fact.
  // MEMORY_WARN_RSS_MB should be set below whatever the VM's real total
  // RAM is (leave headroom for postgres/redis/livekit/kamailio/apache,
  // which run outside this process) - defaults to 1200MB, sized for a
  // 2GB box; adjust via env var if the VM is resized.
  const MEMORY_WARN_RSS_MB = Number(process.env.MEMORY_WARN_RSS_MB ?? 1200)
  const MEMORY_LOG_INTERVAL_MS = 60_000

  setInterval(() => {
    const mem = process.memoryUsage()
    const rssMB = Math.round(mem.rss / 1024 / 1024)
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024)
    const activeCalls = sessions.size

    console.log(`[Memory] rss=${rssMB}MB heapUsed=${heapUsedMB}MB activeCalls=${activeCalls}`)

    if (rssMB >= MEMORY_WARN_RSS_MB) {
      console.warn(
        `[Memory] WARNING: rss=${rssMB}MB at/above threshold ${MEMORY_WARN_RSS_MB}MB (activeCalls=${activeCalls}) - possible memory pressure`,
      )
    }
  }, MEMORY_LOG_INTERVAL_MS).unref()

  process.on('SIGINT', async () => {
    console.log(`Disconnecting ${sessions.size} in-progress call(s)...`)

    for (const { transport, stt } of sessions.values()) {
      await transport.disconnect()
      await stt.close()
    }

    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    for (const { transport } of sessions.values()) {
      await transport.disconnect()
    }

    process.exit(0)
  })
}

// Periods inside these must never be treated as sentence boundaries by
// extractTTSChunks below. Each sentence becomes its own independent
// OpenAI TTS call (see OpenAITTS.ts / TTSSentenceQueue.ts) with zero
// context from its neighbors — confirmed from a real call: "Okay, 4 to 6
// p.m. tomorrow." was split at the "p.m." abbreviation's own period into
// two separate calls, "Okay, 4 to 6 p.m." and "tomorrow.", and the
// isolated one-word fragment came out noticeably slower/more deliberate
// than its neighbor (gpt-4o-mini-tts is a generative, non-mechanical
// model — no fixed cadence across independent calls, so what looked like
// "the whole utterance" to each call differed, and that shifted
// delivery). This intake flow asks about availability constantly (a.m./
// p.m.) and addresses (St./Ave./etc.), so this isn't a one-off — worth
// guarding explicitly.
const ABBREVIATIONS = new Set([
  'a.m', 'p.m', 'mr', 'mrs', 'ms', 'dr', 'prof', 'jr', 'sr',
  'st', 'ave', 'blvd', 'rd', 'ln', 'apt', 'no', 'vs', 'etc', 'approx',
])

function endsWithAbbreviation(textUpToAndIncludingPunctuation: string): boolean {
  if (!textUpToAndIncludingPunctuation.endsWith('.'))
    return false

  const wordMatch = /([a-z]+(?:\.[a-z]+)*)\.$/i.exec(textUpToAndIncludingPunctuation)

  return !!wordMatch && ABBREVIATIONS.has(wordMatch[1].toLowerCase())
}

const TERMINAL_PUNCTUATION = /[.!?。！？]/gsu

// Finds the index right after the first GENUINE sentence-ending
// punctuation in `text` — one that isn't part of a known abbreviation
// (see endsWithAbbreviation above) and is followed by whitespace or the
// end of the string — or null if there isn't one yet. Skips past
// abbreviation periods (e.g. the one in "p.m.") instead of treating them
// as sentence boundaries, so the LLM gets a chance to stream the rest of
// the actual sentence first.
function findSentenceEnd(text: string): number | null {
  TERMINAL_PUNCTUATION.lastIndex = 0

  let match: RegExpExecArray | null

  while ((match = TERMINAL_PUNCTUATION.exec(text))) {
    const end = match.index + 1
    const candidate = text.slice(0, end)
    const after = text.slice(end)
    const followedByBoundary = after.length === 0 || /^\s/su.test(after)

    if (followedByBoundary && !endsWithAbbreviation(candidate))
      return end
  }

  return null
}

// Rime's Coda model synthesizes each TTS chunk as a fully independent,
// context-free HTTP call - it has no idea a chunk is one piece of a
// longer utterance. A short isolated fragment ("Sure.", "Thanks,
// Shujaat.") gets no cadence cues from its neighbors, so it's prone to
// coming out noticeably slower/faster or more/less deliberate than the
// sentences around it - heard as an abrupt, unnatural tempo change
// between chunks. Merging a too-short sentence forward with the next
// one(s) before it's ever sent to TTS means fewer, longer, more
// self-contained calls, which gives the model enough material to settle
// into a consistent pace. The trade-off: if the very first sentence of a
// reply is short, its TTS call now waits for the next sentence to arrive
// before firing, adding a little latency to the first audio.
const MIN_CHUNK_CHARS = 20

// A chunk's `premature` flag is true when it was produced by the
// clause-based early flush below rather than a genuine sentence-ending
// punctuation mark - i.e. it's a fragment of a sentence that hasn't
// actually finished yet. Callers (see generateStream in this file) hold
// a premature chunk back instead of firing its TTS call immediately,
// because whatever streams in next might turn out to be a short
// trailing qualifier ("if any?") that would otherwise get spoken alone
// as its own oddly-paced utterance once the reply ends - see
// MIN_CHUNK_CHARS below for the general short-fragment problem this is
// a variant of.
type TTSChunk = {
  text: string
  premature: boolean
}

function extractTTSChunks(buffer: string): {
  chunks: TTSChunk[]
  remainder: string
} {
  const chunks: TTSChunk[] = []

  // Accumulates one or more complete (but individually too-short)
  // sentences/clauses until they clear MIN_CHUNK_CHARS combined, then
  // gets flushed as a single TTS chunk.
  let pending = ''

  // Prefer complete sentences.
  while (true) {
    const end = findSentenceEnd(buffer)

    if (end === null)
      break

    const sentence = buffer.slice(0, end).trim()

    buffer = buffer.slice(end)
    pending = pending ? `${pending} ${sentence}` : sentence

    if (pending.length >= MIN_CHUNK_CHARS) {
      chunks.push({ text: pending, premature: false })
      pending = ''
    }
  }

  // If there is a reasonably long clause, don't wait for the
  // rest of the sentence.
  const clauseRegex = /^(.{45,}?[,;:，；：])(?:\s+|$)/su
  const clauseMatch = clauseRegex.exec(buffer)

  if (clauseMatch) {
    const clause = clauseMatch[1].trim()

    buffer = buffer.slice(clauseMatch[0].length)
    pending = pending ? `${pending} ${clause}` : clause

    if (pending.length >= MIN_CHUNK_CHARS) {
      chunks.push({ text: pending, premature: true })
      pending = ''
    }
  }

  // Anything still pending is a complete sentence/clause that hasn't
  // reached MIN_CHUNK_CHARS yet - put it back in front of the remainder
  // so the next call sees it again and can still merge it forward (or,
  // at end of stream, the unconditional final flush sends it as-is).
  return {
    chunks,
    remainder: pending ? `${pending} ${buffer}` : buffer,
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
