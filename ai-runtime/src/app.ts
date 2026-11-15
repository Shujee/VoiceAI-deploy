import express, { Express } from 'express'
import { createHealthRouter } from './routes/health.js'
import { createVoicesRouter } from './routes/voices.js'
import { createWebhookRouter } from './routes/webhooks.js'

// Changed from a single exported `app` instance to a factory: this app
// now needs to be wired up with a caller-supplied `onRoomStarted`
// handler (see routes/webhooks.ts) so that test-token.ts's main() - the
// process that actually knows how to start a call session - can react
// to LiveKit's `room_started` webhook without app.ts/webhooks.ts needing
// to import anything back from test-token.ts. See the "Concurrent,
// multi-tenant call handling" plan this was built from for why this
// previously-unused scaffolding (see index.ts) is now the webhook
// listener instead of a third, parallel Express setup.
//
// No express.json() here (deliberately, and different from before)
// - createWebhookRouter's own route needs the RAW body for its
// signature check, not one already parsed into an object by a global
// json() middleware; nothing else on this app currently needs a parsed
// body.
export function createApp(onRoomStarted: (roomName: string) => void): Express {
  const app = express()

  app.use(createHealthRouter())
  app.use('/webhooks', createWebhookRouter(onRoomStarted))
  app.use('/voices', createVoicesRouter())

  return app
}
