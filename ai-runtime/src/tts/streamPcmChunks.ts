// Shared streaming-PCM buffering/instrumentation, factored out of
// OpenATTS.ts so every ITTS provider (OpenAI, Rime, ...) goes through
// identical jitter-buffering and timing logic - otherwise a latency
// comparison between providers would be comparing their network/synthesis
// speed AND two hand-copied buffering implementations that could quietly
// drift apart, not an apples-to-apples test of the providers themselves.
//
// Assumes the provider streams raw headerless 16-bit little-endian PCM
// (what every provider wired in so far requests via response_format/Accept)
// at 24000 Hz mono - the sample rate LiveKitTransport's AudioSource is
// hardcoded to. A provider that can't natively return 24kHz PCM would need
// its own resampling step (see PcmResampler, used on the STT input side)
// before/after this helper, not a change to this file.

// Buffer at least this many samples before yielding a chunk, so we're not
// firing captureFrame() off every tiny raw HTTP chunk (observed OpenAI TTS
// chunk sizes are irregular, sometimes just a few hundred bytes). The
// append/flush-on-2-byte-alignment reconstruction below was verified
// standalone against 8 synthetic edge cases (tiny 1-3 byte chunks, a huge
// single chunk, exact boundary, empty source, odd-length source, genuine
// mid-stream truncation) before being adapted into this file.
//
// The FIRST chunk of each sentence gets a bigger floor than the rest.
// Shipping with a flat 200ms floor caused audible jitter: the first chunk
// handed to the AudioSource gives playback only as much runway as its own
// duration before the queue is exposed to real network-arrival jitter for
// the first time. 1000ms of pre-roll gives real playback a much bigger
// cushion to absorb that. Steady-state chunks after the first stay small
// (200ms) so we're not adding needless latency once the runway exists.
const FIRST_CHUNK_MIN_SAMPLES = 24000
const STEADY_STATE_MIN_SAMPLES = 4800

export interface PcmStreamLogContext {
  // Prefixes every log line so OpenAI vs Rime output is distinguishable
  // when both are being compared side by side (e.g. "OpenAI TTS", "Rime TTS").
  providerLabel: string
}

export async function* streamPcmChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  requestSentAt: number,
  text: string,
  signal: AbortSignal | undefined,
  { providerLabel }: PcmStreamLogContext,
): AsyncGenerator<Int16Array, void, void> {
  let pending = new Uint8Array(0)
  let totalSamples = 0
  let chunksYielded = 0
  let lastChunkAudioMs = 0
  const startedAt = Date.now()
  let lastYieldAt = startedAt

  const appendChunk = (bytes: Uint8Array) => {
    const merged = new Uint8Array(pending.length + bytes.length)
    merged.set(pending, 0)
    merged.set(bytes, pending.length)
    pending = merged
  }

  // Diagnostic for the jitter regression: logs the gap between one chunk
  // becoming ready and the next, alongside the previous chunk's own audio
  // duration. If the gap to produce chunk N exceeds how much audio chunk
  // N-1 was worth, chunk N-1's runway alone wouldn't have covered
  // real-time playback until chunk N arrived — a plausible underrun. This
  // is a single-chunk heuristic (it doesn't account for multiple chunks
  // already queued ahead in the AudioSource's own buffer), so treat it as
  // a lead, not proof.
  const logYield = (samples: number) => {
    const now = Date.now()
    const audioMs = samples / 24000 * 1000
    const gapMs = now - lastYieldAt
    const underrunFlag = chunksYielded > 1 && gapMs > lastChunkAudioMs
      ? ` — possible underrun: took longer to arrive than the previous ` +
        `chunk's ${lastChunkAudioMs.toFixed(0)} ms of audio`
      : ''

    // Commented out (Aug 29 2026, not deleted) - the jitter/overlap
    // regression this was diagnosing is fixed and confirmed clean, and at
    // one line per audio chunk (dozens per sentence) this was by far the
    // single biggest contributor to log volume. Uncomment if a
    // jitter/underrun regression resurfaces and this per-chunk detail is
    // needed again.
    // console.log(
    //   `[TTS] [${providerLabel}] chunk ${chunksYielded} ready: ${gapMs} ms ` +
    //   `since previous chunk was ready (${now - startedAt} ms since synth ` +
    //   `start), ${audioMs.toFixed(0)} ms of audio${underrunFlag}`,
    // )

    lastYieldAt = now
    lastChunkAudioMs = audioMs
  }

  // Separate from the "[Timing] TTS first chunk" log below: that one fires
  // only once FIRST_CHUNK_MIN_SAMPLES (1000ms of audio) has been buffered,
  // so it conflates the provider's actual network time-to-first-byte with
  // our own deliberate buffering floor. This one is measured from
  // requestSentAt (before the request left this process) - if this number
  // is small and "TTS first chunk" is still ~1-2s, the gap is our own
  // buffering choice, not the provider/network being slow; if this number
  // itself is already large, that's genuine network/provider latency.
  let firstByteAt: number | undefined

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        return
      }

      const { done, value } = await reader.read()

      if (done)
        break

      if (value && value.length > 0) {
        if (!firstByteAt) {
          firstByteAt = Date.now()
          console.log(
            `[Timing] [${providerLabel}] TTS raw first byte (network TTFB): ` +
            `${firstByteAt - requestSentAt} ms since request sent`,
          )
        }
        appendChunk(value)
      }

      const threshold = chunksYielded === 0
        ? FIRST_CHUNK_MIN_SAMPLES
        : STEADY_STATE_MIN_SAMPLES

      const flushable = pending.length - (pending.length % 2)

      if (flushable >= threshold * 2) {
        const slice = pending.subarray(0, flushable)
        const copy = new Uint8Array(flushable)
        copy.set(slice)
        pending = pending.subarray(flushable)

        totalSamples += flushable / 2
        chunksYielded++
        logYield(flushable / 2)

        yield new Int16Array(copy.buffer, 0, flushable / 2)
      }
    }

    if (signal?.aborted)
      return

    // Final flush: whatever's left, even under the buffering floor —
    // there's no more stream to wait for more from.
    const flushable = pending.length - (pending.length % 2)

    if (flushable > 0) {
      const slice = pending.subarray(0, flushable)
      const copy = new Uint8Array(flushable)
      copy.set(slice)

      totalSamples += flushable / 2
      chunksYielded++
      logYield(flushable / 2)

      yield new Int16Array(copy.buffer, 0, flushable / 2)
    }

    if (pending.length % 2 !== 0)
      console.warn(`[TTS] [${providerLabel}] leftover odd trailing byte discarded`)
  } finally {
    reader.releaseLock()
  }

  // Sanity check, not a fix: TTS providers can occasionally return audio
  // that's way longer than the input text should produce (observed once
  // with OpenAI: a 30-char sentence came back as 9.3s of audio — 3.5x
  // longer than a similar-length sentence a few turns later). Checked
  // against the accumulated total across all streamed chunks. Skipped on
  // abort, since a cancelled stream's partial length says nothing about
  // the anomaly this check is for. ~12 chars/sec is a generous (slow)
  // speaking-rate floor; skip very short text where the ratio math is
  // noisy anyway.
  const actualMs = totalSamples / 24000 * 1000
  const expectedMs = text.length / 12 * 1000

  if (text.length >= 10 && actualMs > expectedMs * 2.5) {
    console.warn(
      `[TTS] [${providerLabel}] DURATION ANOMALY: ${actualMs.toFixed(0)} ms ` +
      `of audio for ${text.length}-char text ${JSON.stringify(text)} — ` +
      `expected roughly ${expectedMs.toFixed(0)} ms at a generous speaking ` +
      `rate. This came back from the provider as-is; nothing on our side ` +
      `altered it.`,
    )
  }
}
