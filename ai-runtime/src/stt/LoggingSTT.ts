import { AudioFrame } from '@livekit/rtc-node'
import { ISTT } from './ISTT.js'
import { PcmResampler } from '../audio/PcmResampler.js'

export class LoggingSTT implements ISTT {
  private frameCount = 0
  private sampleCount = 0

  private readonly resampler = new PcmResampler(48000, 24000)

  pushAudio(frame: AudioFrame): void {
    const output = this.resampler.process(frame)

    this.frameCount++
    this.sampleCount += output.length

    if (this.frameCount === 1) {
      console.log('Resampled first audio frame:', {
        inputSampleRate: frame.sampleRate,
        inputSamples: frame.data.length,
        outputSampleRate: 24000,
        outputSamples: output.length,
      })
    }

    if (this.frameCount % 100 === 0) {
      console.log('Resampled audio:', {
        frames: this.frameCount,
        samples: this.sampleCount,
      })
    }
  }

  async close(): Promise<void> {
    console.log('STT closed')
  }
}