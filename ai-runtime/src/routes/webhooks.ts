import express, { Router } from 'express'
import { WebhookReceiver } from 'livekit-server-sdk'

// LiveKit POSTs a signed event here every time something happens to a
// room - most importantly `room_started`, which is how this process
// finds out a new call has arrived (see setup-sip.ts's dispatch rule,
// `type: 'individual'`, which makes LiveKit create a brand-new room per
// inbound call instead of every call joining one fixed shared room).
// See the `webhook:` block added to infra/livekit/livekit.yaml, which
// points at this route.
//
// WebhookReceiver verifies the request actually came from this
// deployment's own LiveKit server (an HMAC over the raw request body,
// keyed by the same LIVEKIT_API_KEY/LIVEKIT_API_SECRET used everywhere
// else in this project) before anything in the event body is trusted -
// this matters because this route is reachable from inside the Docker
// network, not just from LiveKit itself.
export function createWebhookRouter(onRoomStarted: (roomName: string) => void): Router {
  const router = Router()

  const receiver = new WebhookReceiver(
    process.env.LIVEKIT_API_KEY ?? 'devkey',
    process.env.LIVEKIT_API_SECRET ?? '',
  )

  // Raw text body ONLY on this route (never express.json()) - receive()
  // verifies a signature computed over the exact bytes LiveKit sent; a
  // body that's already been JSON-parsed-and-restringified by another
  // middleware is not guaranteed to byte-for-byte match what was signed.
  router.post('/livekit', express.text({ type: '*/*' }), async (req, res) => {
    try {
      const event = await receiver.receive(req.body, req.header('Authorization'))

      console.log(
        `[Webhook] Received LiveKit event: ${event.event}` +
        (event.room?.name ? ` room="${event.room.name}"` : ''),
      )

      if (event.event === 'room_started' && event.room?.name) {
        onRoomStarted(event.room.name)
      }

      res.status(200).end()
    } catch (error: any) {
      console.error('[Webhook] Failed to verify/handle LiveKit webhook:', error?.message ?? error)
      res.status(400).end()
    }
  })

  return router
}
