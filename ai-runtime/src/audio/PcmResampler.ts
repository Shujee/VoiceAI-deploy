import { AudioFrame } from '@livekit/rtc-node'

export class PcmResampler {
  constructor(
    private readonly inputSampleRate: number,
    private readonly outputSampleRate: number,
  ) {}

  process(frame: AudioFrame): Int16Array {
    if (frame.sampleRate !== this.inputSampleRate)
      throw new Error(
        `Unexpected sample rate: ${frame.sampleRate} Hz, expected ${this.inputSampleRate} Hz`,
      )

    if (frame.channels !== 1)
      throw new Error(
        `Unexpected channel count: ${frame.channels}, expected mono`,
      )

    if (this.inputSampleRate % this.outputSampleRate !== 0)
      throw new Error(
        `Unsupported sample-rate conversion: ${this.inputSampleRate} -> ${this.outputSampleRate}`,
      )

    const ratio = this.inputSampleRate / this.outputSampleRate
    const outputLength = Math.floor(frame.data.length / ratio)
    const output = new Int16Array(outputLength)

    for (let i = 0; i < outputLength; i++) {
      let sum = 0

      for (let j = 0; j < ratio; j++)
        sum += frame.data[i * ratio + j]

      output[i] = Math.round(sum / ratio)
    }

    return output
  }
}