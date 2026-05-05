import { Hono } from 'hono'
import { agents, walletTransactions } from '../db/mongo.js'
import {
  ensureAgentWallet,
  getWalletBalances,
  resolveAgentRecipient,
} from '../services/agentWallet.js'
import type { Env } from '../types.js'

const router = new Hono<Env>()

function chainName(chainId: number): string {
  if (chainId === 84532) return 'Base Sepolia'
  if (chainId === 8453) return 'Base'
  if (chainId === 11155111) return 'Sepolia'
  return `Chain ${chainId}`
}

// GET /fleets/:id/directory — one identity directory for AXL and wallet routing.
router.get('/:id/directory', async (c) => {
  try {
    const list = await (await agents())
      .find(
        {
          fleetId: c.req.param('id'),
          tenantId: c.get('tenantId'),
          status: { $ne: 'terminated' },
        },
        { _id: 1, permissionTier: 1, config: 1, axl: 1, commons: 1, wallet: 1, status: 1 },
      )
      .lean()

    return c.json(list.map((agent) => ({
      agentId: agent._id,
      role: agent.config?.role ?? null,
      handle: agent.config?.role ? agent.config.role.toLowerCase().replace(/[^a-z0-9]+/g, '-') : agent._id,
      permissionTier: agent.permissionTier,
      status: agent.status,
      axl: {
        peerId: agent.axl?.peerId ?? null,
        multiaddr: agent.axl?.multiaddr ?? null,
      },
      wallet: {
        address: agent.wallet?.address ?? agent.commons?.walletAddress ?? null,
        provider: agent.wallet?.provider ?? null,
        chainIds: agent.wallet?.chainIds ?? [84532],
      },
      commons: {
        agentId: agent.commons?.agentId ?? null,
        registryAgentId: agent.commons?.registryAgentId ?? null,
      },
    })))
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// GET /fleets/:id/directory/resolve/:name
router.get('/:id/directory/resolve/:name', async (c) => {
  try {
    const resolved = await resolveAgentRecipient(
      c.req.param('id'),
      c.get('tenantId'),
      c.req.param('name'),
    )
    return c.json(resolved)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'could not resolve recipient' }, 404)
  }
})

// GET /fleets/:id/agents/:agentId/wallet
router.get('/:id/agents/:agentId/wallet', async (c) => {
  try {
    const agent = await (await agents()).findOne({
      _id: c.req.param('agentId'),
      fleetId: c.req.param('id'),
      tenantId: c.get('tenantId'),
    }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)

    const wallet = await ensureAgentWallet(agent)
    const balances = await getWalletBalances(wallet)
    const transactions = await (await walletTransactions())
      .find({ agentId: agent._id, tenantId: agent.tenantId })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean()

    return c.json({
      address: wallet.address,
      provider: wallet.provider,
      signerRef: wallet.signerRef,
      chainIds: wallet.chainIds,
      chains: wallet.chainIds.map((chainId) => ({ chainId, name: chainName(chainId) })),
      balances,
      transactions,
      policy: agent.wallet?.policy ?? null,
    })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'wallet lookup failed' }, 503)
  }
})

// GET /fleets/:id/agents/:agentId/wallet/transactions
router.get('/:id/agents/:agentId/wallet/transactions', async (c) => {
  try {
    const agent = await (await agents()).findOne({
      _id: c.req.param('agentId'),
      fleetId: c.req.param('id'),
      tenantId: c.get('tenantId'),
    }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)

    const list = await (await walletTransactions())
      .find({ agentId: agent._id, tenantId: agent.tenantId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
    return c.json(list)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as walletsRouter }
