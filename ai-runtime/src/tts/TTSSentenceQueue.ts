import type { ITTS } from './ITTS.js'

interface QueueItem {
  id: number
  text: string
  resolve: () => void
  generation: number
}

export class TTSSentenceQueue {
  private queue: QueueItem[] = []
  private processing = false
  private activeAbortController?: AbortController
  private generation = 0
  private nextId = 1

  // Whether the item currently being synthesized has published at least
  // one audio chunk yet - i.e. whether the caller could plausibly have
  // heard ANY of it. cancel() uses this to decide whether there's
  // actually something to interrupt.
  private activeItemHasPublishedAudio = false
  // Set by cancel() when it protects an in-flight, not-yet-heard item
  // instead of aborting it (see cancel() below). The process() loop's
  // generation check treats this one generation as still valid, purely so
  // that ONE already-started item can finish; everything else queued
  // behind it is still dropped as normal. Cleared once that item's own
  // processing finishes.
  private protectedGeneration?: number

  constructor(
    private readonly tts: ITTS,
    private readonly publish: (
      pcm: Int16Array,
      signal: AbortSignal,
    ) => Promise<number>,
    // Real playback-finished signal from the transport (see
    // IVoiceTransport.waitForPlayout / LiveKitTransport). Replaces a
    // previous hand-rolled `durationMs + fixed guard` setTimeout, which
    // only tracked the last item's own duration. That stopped being
    // accurate once captureFrame() stopped blocking (queueSize bump on
    // AudioSource) — multiple items can now sit in the native audio buffer
    // at once, so a per-item timer could report "finished" while earlier
    // audio is still audibly playing.
    private readonly waitForPlayout: () => Promise<void>,
    private readonly onPlaybackStarted?: () => void,
    private readonly onPlaybackFinished?: () => void,
  ) { }

  // Strips markdown emphasis (**bold**, *italic*, `code`) before text ever
  // reaches the TTS engine. Root-caused from real call logs (2026-09-13):
  // the LLM sometimes wraps a confirmed value in markdown, e.g. the literal
  // string 'Got it—**GU15 3PQ**.' - Cartesia was handed those asterisks
  // as-is and audibly stumbled on them (reported by a tester as extra/
  // garbled sound prepended to the postcode), which also shows up
  // mechanically as this queue's own DURATION ANOMALY warning - 5200ms of
  // audio for a 20-char string that should take ~1667ms at a generous
  // speaking rate. The call-log transcript is unaffected: this only
  // touches the copy of the text that gets synthesized, not the original
  // string the caller (test-token.ts) already logged/recorded before
  // calling push().
  private static readonly MARKDOWN_EMPHASIS = /\*\*(.*?)\*\*|__(.*?)__|\*(.*?)\*|_(.*?)_|`([^`]*)`/g

  private stripMarkdownEmphasis(text: string): string {
    return text.replace(
      TTSSentenceQueue.MARKDOWN_EMPHASIS,
      (_match, boldStar, boldUnderscore, italicStar, italicUnderscore, code) =>
        boldStar ?? boldUnderscore ?? italicStar ?? italicUnderscore ?? code ?? '',
    )
  }

  push(text: string): Promise<void> {
    const generation = this.generation
    const sanitized = this.stripMarkdownEmphasis(text)

    return new Promise(resolve => {
      const id = this.nextId++

      this.queue.push({
        id,
        text: sanitized,
        resolve,
        generation,
      })

      console.log(
        `[TTS #${id}] queued generation=${generation} queue=${this.queue.length}`,
      )

      void this.process()
    })
  }

  cancel(): void {
    // If the item currently being synthesized hasn't published a single
    // chunk yet, the caller cannot have heard any of it - there is
    // nothing to interrupt. Aborting it anyway just silently throws away
    // real content (a whole sentence - sometimes the actual next
    // question) with nothing delivered in its place. Real-log evidence:
    // an "ack + next question" turn split into two TTS items, the second
    // one killed mid-synthesis before its first chunk, and the caller
    // never heard the question at all - just an unexplained pause. So:
    // let ONLY this one in-flight, unheard item keep going; everything
    // else (already-queued-but-not-started items, and any future pushes)
    // is still dropped like before.
    const protectActiveItem = !!this.activeAbortController && !this.activeItemHasPublishedAudio

    console.log(
      `[TTS] CANCEL generation=${this.generation + 1} ` +
      `queue=${this.queue.length} active=${this.activeAbortController ? 'yes' : 'no'}` +
      (this.activeAbortController
        ? ` activeItemHasPublishedAudio=${this.activeItemHasPublishedAudio}`
        : ''),
    )

    if (protectActiveItem) {
      console.log(
        '[TTS] Protecting in-flight item with no published audio yet - ' +
        'letting it finish/play instead of cancelling it',
      )
      this.protectedGeneration = this.generation
    }

    // Bump generation FIRST: armPlaybackFinishedWatcher() re-checks this
    // after waitForPlayout() resolves, and that's what stops a watcher
    // armed by a turn that's being cancelled right now from firing
    // onPlaybackFinished afterwards.
    this.generation++

    for (const item of this.queue)
      item.resolve()

    this.queue = []

    if (!protectActiveItem) {
      this.activeAbortController?.abort()
      this.activeAbortController = undefined
    }
  }

  private async process(): Promise<void> {
    if (this.processing)
      return

    this.processing = true

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!

        console.log(`[TTS #${item.id}] processing`)

        if (item.generation !== this.generation) {
          item.resolve()
          continue
        }

        const controller = new AbortController()
        this.activeAbortController = controller
        this.activeItemHasPublishedAudio = false

        try {
          console.log(
            `[TTS Queue] Synthesizing: ${JSON.stringify(item.text)}`,
          )

          const startedAt = Date.now()

          console.log(`[TTS #${item.id}] synth start`)

          let firstChunk = true
          let chunkIndex = 0
          let totalDurationMs = 0
          let interrupted = false

          for await (const pcm of this.tts.synthesize(
            item.text,
            controller.signal,
          )) {
            // item.generation !== this.generation normally means "a newer
            // turn superseded this one - stop." The protectedGeneration
            // exception is cancel()'s doing: it bumped this.generation
            // (so nothing ELSE treats this turn as current) but
            // deliberately did NOT abort this specific item because
            // nothing had been published yet - see cancel() for why.
            if (
              controller.signal.aborted ||
              (item.generation !== this.generation && item.generation !== this.protectedGeneration)
            ) {
              interrupted = true
              break
            }

            chunkIndex++

            if (firstChunk) {
              // This is now the real "first audio ready" moment — it fires
              // on the FIRST streamed chunk, not after the whole sentence
              // has finished synthesizing.
              console.log(
                `[Timing] TTS first chunk: ${Date.now() - startedAt} ms`,
              )
              console.log(`[TTS #${item.id}] playback started`)
              firstChunk = false

              // Set BEFORE onPlaybackStarted() (2026-09-05, was after) -
              // that callback can now call back into cancel() synchronously
              // (CartesiaSTT.startAssistantSpeaking() firing an
              // already-in-progress-turn interruption right as this item
              // starts). cancel()'s protectActiveItem check reads this flag
              // to decide "has the caller plausibly heard anything of this
              // item yet" - which is already true at this exact point (the
              // first chunk just became available), so it needs to be true
              // BEFORE that reentrant call, not one line later, or a
              // genuine interruption at this boundary would get its own
              // item wrongly protected/let through instead of cancelled.
              this.activeItemHasPublishedAudio = true
              this.onPlaybackStarted?.()
            }

            // Commented out (Aug 29 2026, not deleted) - per-chunk publish
            // logging was the single biggest contributor to log volume
            // (one pair of lines per audio chunk, dozens per sentence),
            // and the overlap/jitter regression it helped diagnose is
            // fixed and confirmed clean. Uncomment both if that class of
            // bug resurfaces and per-chunk publish timing is needed again.
            // console.log(
            //   `[TTS #${item.id}] publish chunk ${chunkIndex} start ` +
            //   `${pcm.length} samples`,
            // )

            const durationMs = await this.publish(pcm, controller.signal)

            if (controller.signal.aborted) {
              interrupted = true
              break
            }

            totalDurationMs += durationMs

            // console.log(
            //   `[TTS #${item.id}] publish chunk ${chunkIndex} returned ` +
            //   `duration=${durationMs}ms`,
            // )
          }

          console.log(`[TTS #${item.id}] synth complete`)

          // This item's own window to be "protected" (see cancel()) is
          // over either way, whether it finished cleanly or was cut off -
          // don't let a stale protectedGeneration linger and shield some
          // unrelated LATER item that happens to share the same
          // generation number after a future cancel() bump wraps around.
          if (this.protectedGeneration === item.generation)
            this.protectedGeneration = undefined

          // Resolve unconditionally, interrupted or not — synthesize() now
          // returns normally (doesn't throw) when it observes an aborted
          // signal mid-stream, so this is the only place left that resolves
          // an item cut short by an interruption.
          item.resolve()

          if (interrupted)
            continue

          // Speed log: requested explicitly because the tempo/speed
          // regression is still unresolved (Rime synthesizes each queued
          // chunk with zero cross-chunk context, so an isolated short
          // fragment gets no cadence cues from its neighbors - see
          // MIN_CHUNK_CHARS in test-token.ts, which mitigates but hasn't
          // fully fixed this). chars/sec here is the whole-chunk average
          // (item.text.length over the real published totalDurationMs,
          // not per-syllable) - crude, but it's exactly the granularity
          // the tempo complaints have been about ("abrupt ... between
          // sentences"), i.e. one chunk sounding noticeably faster/slower
          // than the one before or after it. Compare this number across
          // consecutive [TTS #n] lines in one call to spot the jump.
          const charsPerSec = totalDurationMs > 0
            ? item.text.length / (totalDurationMs / 1000)
            : 0

          console.log(
            `[TTS #${item.id}] all chunks published (${chunkIndex}), ` +
            `total duration=${totalDurationMs}ms, ${item.text.length} chars, ` +
            `speed=${charsPerSec.toFixed(1)} chars/sec — text: ${JSON.stringify(item.text)}`,
          )

          // Only the item that empties the queue arms a watcher — if more
          // items are already behind it, there's no point waiting yet.
          if (this.queue.length === 0)
            this.armPlaybackFinishedWatcher(item.id)
        } catch (error) {
          if (!controller.signal.aborted)
            console.error('[TTS Queue] Error:', error)

          item.resolve()
        } finally {
          if (this.activeAbortController === controller)
            this.activeAbortController = undefined
        }
      }
    } finally {
      this.processing = false

      if (this.queue.length > 0)
        void this.process()
    }
  }

  // Fire-and-forget: waits for the transport's real playout-finished signal
  // and then calls onPlaybackFinished(), but only if nothing has changed
  // since this watcher was armed — no new items queued, still idle, and
  // still the same generation (i.e. not superseded by an interruption).
  // Deliberately NOT awaited from process() — process() must stay free to
  // pick up the next push() immediately, exactly like the old setTimeout
  // approach was non-blocking.
  private armPlaybackFinishedWatcher(armedForItemId: number): void {
    const watcherGeneration = this.generation

    void this.waitForPlayout()
      .then(() => {
        if (
          !this.processing &&
          this.queue.length === 0 &&
          watcherGeneration === this.generation
        ) {
          console.log(
            `[TTS #${armedForItemId}] playout confirmed finished (waitForPlayout resolved)`,
          )
          this.onPlaybackFinished?.()
        } else {
          console.log(
            `[TTS #${armedForItemId}] playout watcher resolved but stale — ` +
            `processing=${this.processing} queue=${this.queue.length} ` +
            `generation=${this.generation} (armed at ${watcherGeneration})`,
          )
        }
      })
      .catch(error => {
        console.error('[TTS] waitForPlayout() error:', error)
      })
  }
}