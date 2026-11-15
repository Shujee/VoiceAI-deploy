import dotenv from 'dotenv'
dotenv.config()

import { createApp } from './app.js'

// This standalone entry point (package.json's `start`/`build` scripts)
// predates test-token.ts's own LiveKit webhook listener (see main() and
// the "Concurrent, multi-tenant call handling" plan) and isn't part of
// the actual dev/deploy path - `pnpm dev` runs test-token.ts directly,
// and docs/gcp-deployment.md's manual start command does too. Left here,
// updated just enough to keep compiling against app.ts's new
// createApp() factory, only so `pnpm build && pnpm start` still serves
// the health check rather than failing outright. No onRoomStarted
// wiring here - this process never starts call sessions.
const port = Number(process.env.PORT ?? 3001)

const app = createApp(() => {})

app.listen(port, () => {
  console.log(`AI Runtime listening on ${port}`)
})
