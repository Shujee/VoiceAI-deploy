import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'

// One-off utility: transcribes every .wav in ai-runtime/call-samples/ using
// OpenAI's transcription API and writes a sibling .txt next to each - not
// part of the runtime pipeline, just for turning client-provided real call
// recordings into text so they can be reviewed/pasted for prompt/KB work.
// Run from ai-runtime/: pnpm exec tsx scripts/transcribe-calls.ts
// (reads OPENAI_API_KEY from ai-runtime/.env same as the rest of the app)

async function main() {
  const dir = path.join(import.meta.dirname, '..', 'call-samples')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.wav'))
  if (files.length === 0) {
    console.log(`No .wav files found in ${dir}`)
    return
  }

  for (const file of files) {
    const wavPath = path.join(dir, file)
    const txtPath = wavPath.replace(/\.wav$/i, '.txt')
    process.stdout.write(`Transcribing ${file}... `)
    try {
      const result = await openai.audio.transcriptions.create({
        file: fs.createReadStream(wavPath),
        model: 'whisper-1',
      })
      fs.writeFileSync(txtPath, result.text, 'utf-8')
      console.log(`done -> ${path.basename(txtPath)}`)
    } catch (error) {
      console.log(`FAILED: ${(error as Error).message}`)
    }
  }
}

main()
