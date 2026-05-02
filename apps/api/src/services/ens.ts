import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { labelhash, namehash, normalize } from 'viem/ens'

const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'
const DEFAULT_PARENT_DOMAIN = 'agents.commonos.eth'
const DEFAULT_RPC_URL = 'https://rpc.sepolia.org'

const registryAbi = [
  {
    type: 'function',
    name: 'resolver',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'setSubnodeRecord',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'label', type: 'bytes32' },
      { name: 'owner', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'ttl', type: 'uint64' },
    ],
    outputs: [],
  },
] as const

const resolverAbi = [
  {
    type: 'function',
    name: 'text',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'addr',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'setText',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setAddr',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'a', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'multicall',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
] as const

export interface AgentMetadata {
  ensName?: string | null
  fleetId?: string | null
  role?: string | null
  status?: string | null
  peerId?: string | null
  multiaddr?: string | null
  commonsAgentId?: string | null
  description?: string | null
  url?: string | null
}

export interface AgentENSRecord {
  name: string
  agentId: string | null
  fleetId: string | null
  role: string | null
  status: string | null
  peerId: string | null
  multiaddr: string | null
  commonsAgentId: string | null
  walletAddress: string | null
  url: string | null
  description: string | null
}

function ensParentDomain(): string {
  return normalize((process.env.ENS_PARENT_DOMAIN ?? DEFAULT_PARENT_DOMAIN).toLowerCase())
}

function signerKey(): Hex | null {
  const raw = process.env.ENS_SIGNER_KEY?.trim()
  if (!raw) return null
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex
}

function baseUrl(): string {
  return (process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
}

function defaultAgentUrl(agentId: string, fleetId?: string | null): string | null {
  const appUrl = baseUrl()
  if (!appUrl) return null
  if (fleetId) return `${appUrl}/world?fleet=${encodeURIComponent(fleetId)}`
  return `${appUrl}/settings`
}

function normalizeEnsName(value: string): string {
  return normalize(value.trim().toLowerCase())
}

export function buildAgentEnsLabel(agentId: string): string {
  return `agent-${agentId.toLowerCase().replace(/_/g, '-')}`
}

export function buildAgentEnsName(agentId: string, metadata: Pick<AgentMetadata, 'ensName'> = {}): string {
  if (metadata.ensName) {
    const raw = metadata.ensName.includes('.')
      ? metadata.ensName
      : `${metadata.ensName}.${ensParentDomain()}`
    return normalizeEnsName(raw)
  }
  return normalizeEnsName(`${buildAgentEnsLabel(agentId)}.${ensParentDomain()}`)
}

function resolveNameInput(nameOrAgentId: string): string {
  if (nameOrAgentId.includes('.')) return normalizeEnsName(nameOrAgentId)
  return buildAgentEnsName(nameOrAgentId)
}

function recordEntries(agentId: string, metadata: AgentMetadata): Array<[string, string]> {
  const description = metadata.description
    ?? (metadata.role ? `CommonOS ${metadata.role} agent` : 'CommonOS agent')

  const records: Array<[string, string | null | undefined]> = [
    ['com.commonos.agentId', agentId],
    ['com.commonos.agcAgentId', metadata.commonsAgentId],
    ['com.commonos.fleetId', metadata.fleetId],
    ['com.commonos.role', metadata.role],
    ['com.commonos.status', metadata.status],
    ['com.commonos.axl.peerId', metadata.peerId],
    ['com.commonos.axl.multiaddr', metadata.multiaddr],
    ['description', description],
    ['url', metadata.url ?? defaultAgentUrl(agentId, metadata.fleetId)],
  ]

  return records
    .map(([key, value]) => [key, value?.trim()] as [string, string | undefined])
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
}

function viemClients() {
  const key = signerKey()
  if (!key) return null

  const transport = http(process.env.ETH_RPC_URL ?? DEFAULT_RPC_URL)
  const account = privateKeyToAccount(key)
  return {
    account,
    publicClient: createPublicClient({ chain: sepolia, transport }),
    walletClient: createWalletClient({ account, chain: sepolia, transport }),
  }
}

export async function registerAgentENS(
  agentId: string,
  metadata: AgentMetadata,
  walletAddress?: string | null,
): Promise<string | null> {
  const clients = viemClients()
  if (!clients) {
    console.warn('[ens] ENS_SIGNER_KEY not configured, skipping registration')
    return null
  }

  const parentDomain = ensParentDomain()
  const ensName = buildAgentEnsName(agentId, metadata)
  const labels = ensName.split('.')
  const parentLabels = parentDomain.split('.')

  if (labels.length !== parentLabels.length + 1 || labels.slice(1).join('.') !== parentDomain) {
    console.warn(`[ens] ${ensName} is not a direct child of ${parentDomain}, skipping`)
    return null
  }

  const label = labels[0]!
  const parentNode = namehash(parentDomain)
  const node = namehash(ensName)

  try {
    const resolverAddress = await clients.publicClient.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: 'resolver',
      args: [parentNode],
    })

    if (!resolverAddress || resolverAddress === zeroAddress) {
      console.warn(`[ens] parent domain ${parentDomain} has no resolver configured`)
      return null
    }

    await clients.walletClient.writeContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: 'setSubnodeRecord',
      args: [parentNode, labelhash(label), clients.account.address, resolverAddress, 0n],
    })

    const data = recordEntries(agentId, metadata).map(([key, value]) =>
      encodeFunctionData({
        abi: resolverAbi,
        functionName: 'setText',
        args: [node, key, value],
      }),
    )

    const nextWalletAddress = walletAddress ?? null
    if (nextWalletAddress && isAddress(nextWalletAddress)) {
      data.push(
        encodeFunctionData({
          abi: resolverAbi,
          functionName: 'setAddr',
          args: [node, getAddress(nextWalletAddress)],
        }),
      )
    }

    if (data.length > 0) {
      await clients.walletClient.writeContract({
        address: resolverAddress,
        abi: resolverAbi,
        functionName: 'multicall',
        args: [data],
      })
    }

    return ensName
  } catch (err) {
    console.warn('[ens] registration failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function readTextRecord(
  resolverAddress: Address,
  node: Hex,
  key: string,
): Promise<string | null> {
  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.ETH_RPC_URL ?? DEFAULT_RPC_URL),
  })

  try {
    const value = await client.readContract({
      address: resolverAddress,
      abi: resolverAbi,
      functionName: 'text',
      args: [node, key],
    })
    return value || null
  } catch {
    return null
  }
}

export async function lookupAgentENS(nameOrAgentId: string): Promise<AgentENSRecord | null> {
  const ensName = resolveNameInput(nameOrAgentId)
  const node = namehash(ensName)
  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.ETH_RPC_URL ?? DEFAULT_RPC_URL),
  })

  try {
    const resolverAddress = await client.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: 'resolver',
      args: [node],
    })

    if (!resolverAddress || resolverAddress === zeroAddress) return null

    const [
      agentId,
      commonsAgentId,
      fleetId,
      role,
      status,
      peerId,
      multiaddr,
      description,
      url,
      walletAddress,
    ] = await Promise.all([
      readTextRecord(resolverAddress, node, 'com.commonos.agentId'),
      readTextRecord(resolverAddress, node, 'com.commonos.agcAgentId'),
      readTextRecord(resolverAddress, node, 'com.commonos.fleetId'),
      readTextRecord(resolverAddress, node, 'com.commonos.role'),
      readTextRecord(resolverAddress, node, 'com.commonos.status'),
      readTextRecord(resolverAddress, node, 'com.commonos.axl.peerId'),
      readTextRecord(resolverAddress, node, 'com.commonos.axl.multiaddr'),
      readTextRecord(resolverAddress, node, 'description'),
      readTextRecord(resolverAddress, node, 'url'),
      client.readContract({
        address: resolverAddress,
        abi: resolverAbi,
        functionName: 'addr',
        args: [node],
      }).catch(() => zeroAddress),
    ])

    const hasData = Boolean(
      agentId || commonsAgentId || fleetId || role || status || peerId || multiaddr || description || url || (walletAddress && walletAddress !== zeroAddress),
    )
    if (!hasData) return null

    return {
      name: ensName,
      agentId,
      commonsAgentId,
      fleetId,
      role,
      status,
      peerId,
      multiaddr,
      description,
      url,
      walletAddress: walletAddress && walletAddress !== zeroAddress ? walletAddress : null,
    }
  } catch {
    return null
  }
}
