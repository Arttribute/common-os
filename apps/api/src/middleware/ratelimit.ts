import { createMiddleware } from 'hono/factory'
import { createHash } from 'node:crypto'

const WINDOW_MS = 60_000
const LIMIT = 200
const AGENT_LIMIT = 2_000

const counts = new Map<string, { count: number; resetAt: number }>()

// Prune expired entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of counts) {
    if (entry.resetAt < now) counts.delete(key)
  }
}, 5 * 60_000).unref()

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  const authorization = c.req.header('Authorization')
  const key = authorization
    ? createHash('sha256').update(authorization).digest('hex')
    : c.req.header('CF-Connecting-IP') ?? 'unknown'

  const now = Date.now()
  const entry = counts.get(key)
  const limit = c.req.header('Authorization')?.startsWith('Bearer cos_agent_') ? AGENT_LIMIT : LIMIT

  if (!entry || entry.resetAt < now) {
    counts.set(key, { count: 1, resetAt: now + WINDOW_MS })
  } else if (entry.count >= limit) {
    return c.json({ error: 'rate limit exceeded' }, 429)
  } else {
    entry.count++
  }

  await next()
})
