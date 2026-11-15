import { Router } from 'express'
import { InvalidVoiceIdError, synthesizeVoicePreview } from '../tts/synthesizeVoicePreview.js'

// Backend-only route (never called directly by the dashboard's browser
// JS): VoiceController::preview() on the Laravel side proxies to this,
// because CARTESIA_API_KEY only lives in this process's env, not
// backend's. Not exposed to the host (no `ports:` entry for ai-runtime
// in docker-compose.yml) - only reachable from other containers on the
// `voice-ai` network, same trust boundary as the LiveKit webhook route.
// No auth on top of that here: the worst a same-network caller can do is
// trigger a Cartesia API call (a small real cost, no secret exposure,
// nothing written anywhere) - not worth the complexity of a shared-secret
// header for that, unlike webhooks.ts's HMAC check which guards against
// a spoofed CALL EVENT, a materially bigger deal.
export function createVoicesRouter(): Router {
  const router = Router()

  router.get('/:voiceId/preview', async (req, res) => {
    try {
      const { buffer, contentType } = await synthesizeVoicePreview(req.params.voiceId)

      res.set('Content-Type', contentType)
      res.set('Cache-Control', 'no-store')
      res.send(buffer)
    } catch (error: any) {
      if (error instanceof InvalidVoiceIdError) {
        res.status(400).json({ error: error.message })
        return
      }

      console.error('[Voices] Preview synthesis failed:', error?.message ?? error)
      res.status(502).json({ error: 'Failed to synthesize voice preview' })
    }
  })

  return router
}
