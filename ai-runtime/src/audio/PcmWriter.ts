import { writeFile } from 'node:fs/promises'

export async function writeWav(
  filename: string,
  pcm: Int16Array,
): Promise<void> {
  const sampleRate = 24000
  const channels = 1
  const bitsPerSample = 16

  const dataSize = pcm.byteLength
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)

  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)              // PCM header size
  buffer.writeUInt16LE(1, 20)               // PCM format
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(
    sampleRate * channels * bitsPerSample / 8,
    28,
  )
  buffer.writeUInt16LE(
    channels * bitsPerSample / 8,
    32,
  )
  buffer.writeUInt16LE(bitsPerSample, 34)

  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  Buffer.from(
    pcm.buffer,
    pcm.byteOffset,
    pcm.byteLength,
  ).copy(buffer, 44)

  await writeFile(filename, buffer)

  console.log(`[TTS] WAV written: ${filename}`)
}