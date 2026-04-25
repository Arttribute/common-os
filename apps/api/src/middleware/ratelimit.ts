import { createMiddleware } from 'hono/factory'

const WINDOW_MS = 60_000
const LIMIT = 200

const counts = new Map<string, { count: number; resetAt: number }>()

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  const key =
    c.req.header('Authorization')?.slice(0, 20) ??
    c.req.header('CF-Connecting-IP') ??
    'unknown'

  const now = Date.now()
  const entry = counts.get(key)

  if (!entry || entry.resetAt < now) {
    counts.set(key, { count: 1, resetAt: now + WINDOW_MS })
  } else if (entry.count >= LIMIT) {
    return c.json({ error: 'rate limit exceeded' }, 429)
  } else {
    entry.count++
  }

  await next()
})
