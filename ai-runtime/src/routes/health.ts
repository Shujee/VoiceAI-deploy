import { Router } from 'express'

export function createHealthRouter() {
  const router = Router()

  router.get('/health', (_, res) => {
    res.json({
      status: 'ok',
      service: 'ai-runtime',
    })
  })

  return router
}