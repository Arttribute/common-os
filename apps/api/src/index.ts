import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { WebSocketServer } from 'ws'
import { createHash } from 'crypto'
import { authMiddleware } from './middleware/auth.js'
import { rateLimitMiddleware } from './middleware/ratelimit.js'
import { authRouter } from './routes/auth.js'
import { fleetsRouter } from './routes/fleets.js'
import { agentsRouter } from './routes/agents.js'
import { tasksRouter } from './routes/tasks.js'
import { eventsRouter } from './routes/events.js'
import { agentRuntimeRouter } from './routes/agentRuntime.js'
import { streamRouter } from './routes/stream.js'
import { tenants, agents, worldStates, ensureIndexes } from './db/mongo.js'
import { subscribeToFleet, unsubscribeFromFleet } from './db/memory.js'
import type { Env } from './types.js'

const app = new Hono<Env>()

app.use('*', logger())
app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }))
app.use('*', rateLimitMiddleware)

// Health check — no auth
app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }))

// Auth endpoints — /auth/tenant is public; /auth/me uses authMiddleware internally
app.route('/auth', authRouter)

// All other routes require authentication
app.use('/fleets/*', authMiddleware)
app.use('/agents/*', authMiddleware)
app.use('/events', authMiddleware)

app.route('/fleets', fleetsRouter)
app.route('/fleets', agentsRouter)
app.route('/fleets', tasksRouter)
app.route('/fleets', streamRouter)
app.route('/agents', agentRuntimeRouter)
app.route('/events', eventsRouter)

const port = Number(process.env.PORT ?? 3001)
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`CommonOS API running on http://localhost:${port}`)
})

void ensureIndexes()

// WebSocket server attached to the same HTTP server
// GET /fleets/:id/stream?token=<api-key-or-agent-token>
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const match = url.pathname.match(/^\/fleets\/([^/]+)\/stream$/)
  if (!match) {
    socket.destroy()
    return
  }

  const fleetId = match[1]!
  const token = url.searchParams.get('token') ?? ''

  wss.handleUpgrade(req, socket, head, (ws) => {
    void (async () => {
      // Auth: resolve tenantId from token
      let tenantId: string | null = null
      try {
        if (token.startsWith('cos_live_')) {
          const hash = createHash('sha256').update(token).digest('hex')
          const tenant = await (await tenants()).findOne({ apiKeyHash: hash }).lean()
          tenantId = tenant?._id ?? null
        } else if (token.startsWith('cos_agent_')) {
          const hash = createHash('sha256').update(token).digest('hex')
          const agent = await (await agents()).findOne({ agentTokenHash: hash }).lean()
          tenantId = agent?.tenantId ?? null
        }
      } catch { /* db not ready */ }

      if (!tenantId) {
        ws.close(4001, 'unauthorized')
        return
      }

      subscribeToFleet(fleetId, ws)

      // Send current world state snapshot on connect
      try {
        const state = await (await worldStates()).findOne({ fleetId, tenantId }).lean()
        if (state) ws.send(JSON.stringify({ type: 'snapshot', data: state }))
      } catch { /* db not configured — client will retry */ }

      ws.on('close', () => unsubscribeFromFleet(fleetId, ws))
    })()
  })
})

export default app
