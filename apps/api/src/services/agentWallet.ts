import { createHash, randomBytes } from 'crypto'
import { PrivyClient } from '@privy-io/node'
import { agents, walletTransactions, worldStates } from '../db/mongo.js'
import type { AgentDoc, WalletTransactionDoc } from '../types.js'

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const DEFAULT_CHAIN_IDS = (process.env.AGENT_WALLET_CHAIN_IDS ?? '84532')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isInteger(v) && v > 0)

export interface AgentWalletRecord {
  address: string
  provider: 'privy' | 'dev'
  signerRef: string
  chainIds: number[]
}

export interface WalletBalance {
  chainId: number
  symbol: string
  balanceWei: string | null
  formatted: string | null
  rpcConfigured: boolean
  error?: string
}

export interface SendTransactionInput {
  to?: string
  recipient?: string
  valueWei?: string
  valueEth?: string
  chainId?: number
  data?: string | null
}

function walletMode(): 'privy' | 'dev' {
  if (process.env.AGENT_WALLET_MODE === 'dev') return 'dev'
  return process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET ? 'privy' : 'dev'
}

function defaultPolicy(): NonNullable<AgentDoc['wallet']>['policy'] {
  return {
    dailyLimitWei: process.env.AGENT_WALLET_DAILY_LIMIT_WEI ?? '100000000000000000',
    requireApprovalAboveWei: process.env.AGENT_WALLET_APPROVAL_ABOVE_WEI ?? '10000000000000000',
    allowedContracts: [],
  }
}

function devWalletFor(agentId: string): AgentWalletRecord {
  const digest = createHash('sha256').update(`common-os-agent-wallet:${agentId}`).digest('hex')
  return {
    address: `0x${digest.slice(-40)}`,
    provider: 'dev',
    signerRef: `dev:${agentId}`,
    chainIds: DEFAULT_CHAIN_IDS.length > 0 ? DEFAULT_CHAIN_IDS : [84532],
  }
}

async function createPrivyWallet(): Promise<AgentWalletRecord> {
  const appId = process.env.PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) throw new Error('Privy app credentials are not configured')

  const privy = new PrivyClient({ appId, appSecret })
  const created = await privy.wallets().create({ chain_type: 'ethereum' })
  const address = created.address
  if (!address || !ETH_ADDRESS_RE.test(address)) {
    throw new Error('Privy wallet create response did not include an EVM address')
  }

  return {
    address,
    provider: 'privy',
    signerRef: created.id,
    chainIds: DEFAULT_CHAIN_IDS.length > 0 ? DEFAULT_CHAIN_IDS : [84532],
  }
}

export async function ensureAgentWallet(agent: AgentDoc): Promise<AgentWalletRecord> {
  if (agent.wallet?.address && agent.wallet.signerRef && agent.wallet.provider) {
    return {
      address: agent.wallet.address,
      provider: agent.wallet.provider,
      signerRef: agent.wallet.signerRef,
      chainIds: agent.wallet.chainIds?.length ? agent.wallet.chainIds : DEFAULT_CHAIN_IDS,
    }
  }

  let wallet: AgentWalletRecord
  if (walletMode() === 'privy') {
    try {
      wallet = await createPrivyWallet()
    } catch (err) {
      console.warn('[wallet] Privy wallet creation failed; falling back to dev wallet:', err instanceof Error ? err.message : err)
      wallet = devWalletFor(agent._id)
    }
  } else {
    wallet = devWalletFor(agent._id)
  }

  const now = new Date()
  await (await agents()).updateOne(
    { _id: agent._id },
    {
      $set: {
        'commons.walletAddress': wallet.address,
        wallet: {
          address: wallet.address,
          provider: wallet.provider,
          signerRef: wallet.signerRef,
          chainIds: wallet.chainIds,
          policy: agent.wallet?.policy ?? defaultPolicy(),
          createdAt: agent.wallet?.createdAt ?? now,
          updatedAt: now,
        },
        updatedAt: now,
      },
    },
  )

  await (await worldStates()).updateOne(
    { fleetId: agent.fleetId, 'agents.agentId': agent._id },
    {
      $set: {
        'agents.$.commons.walletAddress': wallet.address,
        updatedAt: now,
      },
    },
  ).catch(() => {})

  return wallet
}

function rpcUrlFor(chainId: number): string | null {
  return process.env[`RPC_URL_${chainId}`] ?? process.env.AGENT_WALLET_RPC_URL ?? null
}

function formatWei(value: string): string {
  const wei = BigInt(value)
  const base = 10n ** 18n
  const whole = wei / base
  const frac = wei % base
  const fracText = frac.toString().padStart(18, '0').replace(/0+$/, '').slice(0, 6)
  return fracText ? `${whole}.${fracText}` : whole.toString()
}

async function jsonRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`RPC returned ${res.status}`)
  const body = await res.json() as { result?: T; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? 'RPC error')
  if (body.result === undefined) throw new Error('RPC response missing result')
  return body.result
}

export async function getWalletBalances(wallet: AgentWalletRecord): Promise<WalletBalance[]> {
  return Promise.all(wallet.chainIds.map(async (chainId) => {
    const rpcUrl = rpcUrlFor(chainId)
    if (!rpcUrl) {
      return { chainId, symbol: 'ETH', balanceWei: null, formatted: null, rpcConfigured: false }
    }

    try {
      const hex = await jsonRpc<string>(rpcUrl, 'eth_getBalance', [wallet.address, 'latest'])
      const balanceWei = BigInt(hex).toString()
      return {
        chainId,
        symbol: 'ETH',
        balanceWei,
        formatted: formatWei(balanceWei),
        rpcConfigured: true,
      }
    } catch (err) {
      return {
        chainId,
        symbol: 'ETH',
        balanceWei: null,
        formatted: null,
        rpcConfigured: true,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }))
}

function parseEthToWei(value: string): string {
  const normalized = value.trim()
  if (!/^\d+(\.\d{1,18})?$/.test(normalized)) throw new Error('valueEth must be a decimal ETH amount')
  const [whole, frac = ''] = normalized.split('.')
  return (BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, '0'))).toString()
}

function assertAddress(address: string, label: string): void {
  if (!ETH_ADDRESS_RE.test(address)) throw new Error(`${label} must be an EVM address`)
}

export async function resolveAgentRecipient(
  fleetId: string,
  tenantId: string,
  recipient: string,
): Promise<{ address: string; agentId: string | null }> {
  const raw = recipient.trim().replace(/^@/, '')
  if (ETH_ADDRESS_RE.test(raw)) return { address: raw, agentId: null }

  const alias = raw.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
  const list = await (await agents())
    .find({ fleetId, tenantId, status: { $ne: 'terminated' } })
    .lean()

  const match = list.find((candidate) => {
    const role = candidate.config?.role ?? ''
    const candidates = [
      candidate._id,
      role,
      role.replace(/\s+agent$/i, ''),
      role.replace(/[-_]+/g, ' '),
      role.replace(/\s+/g, ''),
    ].map((v) => v.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' '))
    return candidates.includes(alias)
  })

  if (!match) throw new Error(`Could not resolve recipient: ${recipient}`)
  const wallet = await ensureAgentWallet(match)
  return { address: wallet.address, agentId: match._id }
}

async function sendWithPrivy(walletId: string, input: {
  chainId: number
  to: string
  valueWei: string
  data: string | null
}): Promise<string> {
  const appId = process.env.PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) throw new Error('Privy app credentials are not configured')

  const privy = new PrivyClient({ appId, appSecret })
  const response = await privy.wallets().ethereum().sendTransaction(walletId, {
    caip2: `eip155:${input.chainId}`,
    params: {
      transaction: {
        to: input.to,
        value: `0x${BigInt(input.valueWei).toString(16)}`,
        chain_id: input.chainId,
        ...(input.data ? { data: input.data } : {}),
      },
    },
  })
  if (!response.hash) throw new Error('Privy sendTransaction response did not include a transaction hash')
  return response.hash
}

export async function sendAgentTransaction(
  agent: AgentDoc,
  input: SendTransactionInput,
  requestedBy: 'agent' | 'tenant',
): Promise<WalletTransactionDoc> {
  const wallet = await ensureAgentWallet(agent)
  const chainId = Number(input.chainId ?? wallet.chainIds[0] ?? 84532)
  if (!wallet.chainIds.includes(chainId)) throw new Error(`chain ${chainId} is not enabled for this wallet`)

  const recipient = input.recipient ?? input.to
  if (!recipient) throw new Error('recipient or to is required')
  const resolved = await resolveAgentRecipient(agent.fleetId, agent.tenantId, recipient)
  assertAddress(resolved.address, 'recipient')

  const valueWei = input.valueWei ?? (input.valueEth ? parseEthToWei(input.valueEth) : null)
  if (!valueWei || BigInt(valueWei) < 0n) throw new Error('valueWei or valueEth is required')

  const data = input.data ?? null
  if (data && !/^0x[a-fA-F0-9]*$/.test(data)) throw new Error('data must be hex')

  const now = new Date()
  const txId = `wtx_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
  const col = await walletTransactions()
  const base: WalletTransactionDoc = {
    _id: txId,
    agentId: agent._id,
    fleetId: agent.fleetId,
    tenantId: agent.tenantId,
    walletAddress: wallet.address,
    direction: 'outbound',
    status: 'requested',
    chainId,
    txHash: null,
    toAddress: resolved.address,
    toAgentId: resolved.agentId,
    valueWei,
    data,
    error: null,
    requestedBy,
    createdAt: now,
    updatedAt: now,
  }
  await col.create(base as never)

  try {
    const txHash = wallet.provider === 'privy'
      ? await sendWithPrivy(wallet.signerRef, { chainId, to: resolved.address, valueWei, data })
      : `0x${createHash('sha256').update(`${txId}:${wallet.address}:${resolved.address}:${valueWei}`).digest('hex')}`
    const status = wallet.provider === 'privy' ? 'submitted' : 'simulated'
    await col.updateOne({ _id: txId }, { $set: { txHash, status, updatedAt: new Date() } })
    if (resolved.agentId) {
      await col.create({
        ...base,
        _id: `wtx_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`,
        agentId: resolved.agentId,
        walletAddress: resolved.address,
        direction: 'inbound',
        status,
        txHash,
        toAgentId: resolved.agentId,
        updatedAt: new Date(),
      } as never).catch(() => {})
    }
    return { ...base, txHash, status, updatedAt: new Date() }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await col.updateOne({ _id: txId }, { $set: { status: 'failed', error, updatedAt: new Date() } })
    return { ...base, status: 'failed', error, updatedAt: new Date() }
  }
}
