# ENS Integration Plan — Agent Discovery

## Overview

ENS (Ethereum Name Service) acts as the on-chain discovery layer for CommonOS agents. When an agent's pod boots and registers its Gensyn AXL peer info, the API server writes a subdomain entry to ENS on Sepolia. Any agent or external party can then resolve a human-readable name to find that agent's network address without going through the CommonOS API.

This is built **on top** of the existing stack — the core daemon loop and API are unaffected if ENS is not configured.

---

## Name Scheme

```
agent-{agentId}.agents.commonos.eth
```

Example:
```
agent-agt-1h2g3k4jabcdef12.agents.commonos.eth
```

AgentId underscores are replaced with hyphens to comply with ENS label rules.

---

## ENS Text Records

Each registered agent subdomain stores the following text records on the Public Resolver:

| Key | Value | Purpose |
|-----|-------|---------|
| `axl.multiaddr` | `/ip4/1.2.3.4/tcp/9000/p2p/QmAbc...` | AXL P2P address for direct messaging |
| `axl.peerid` | `QmAbc...` | Gensyn AXL peer ID |
| `cos.role` | `researcher` | Agent role label |
| `cos.fleet` | `flt_abc123` | Fleet the agent belongs to |

---

## One-Time Setup

The `ENS_SIGNER_KEY` wallet must own the parent domain `agents.commonos.eth` on Sepolia before any registration can happen. This is a one-time operation.

**Steps:**

1. Register `commonos.eth` on Sepolia at [app.ens.domains](https://app.ens.domains) (switch network to Sepolia). Sepolia ETH is free from a faucet.

2. Create the `agents` subdomain and transfer ownership to the platform wallet:

```bash
cast send 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "setSubnodeOwner(bytes32,bytes32,address)" \
  $(cast namehash commonos.eth) \
  $(cast keccak agents) \
  <ENS_SIGNER_KEY_address> \
  --rpc-url https://rpc.sepolia.org \
  --private-key <commonos-eth-owner-key>
```

3. Set environment variables on the API server (never commit these):

```
ENS_SIGNER_KEY=<hex private key of platform wallet, with or without 0x prefix>
ENS_PARENT_DOMAIN=agents.commonos.eth    # this is the default; set only to override
ETH_RPC_URL=https://rpc.sepolia.org      # this is the default; set to use a different RPC
```

If `ENS_SIGNER_KEY` is not set, all registration calls log a warning and return silently — nothing breaks.

---

## Registration Flow

```
Daemon boots
  → calls PATCH /fleets/:id/agents/:agentId  { axl.multiaddr, axl.peerId }
  
API PATCH handler
  → writes axl fields to MongoDB (existing behaviour, unchanged)
  → fires registerAgentENS(agentId, { multiaddr, peerId, role, fleetId })
     as a void (fire-and-forget) — does NOT block the HTTP response

registerAgentENS
  → reads parent resolver address from ENS Registry
  → checks if subdomain already owned by platform wallet
    → if not: calls registry.setSubnodeRecord(parentNode, label, owner, resolver, ttl=0)
               waits for tx confirmation
  → batches all four setText calls into a single resolver.multicall(data[]) tx
  → waits for tx confirmation
  → logs success or error (never throws)
```

---

## Lookup Flow

```
GET /agents/resolve/:name
  (name = agentId  OR  full ENS name like agent-agt-xyz.agents.commonos.eth)

  1. If name has no dot  →  try MongoDB first (fast, no RPC call)
     → if agent found with a multiaddr in DB  →  return immediately, source: "db"
  
  2. Fallback  →  lookupAgentENS(name)
     → reads resolver address from ENS Registry for the node
     → parallel readContract calls for axl.multiaddr, axl.peerid, cos.role, cos.fleet
     → returns record, source: "ens"
  
  3. Not found in DB or ENS  →  404
```

Response shape:
```json
{
  "agentId": "agt_1h2g3k4jabcdef12",
  "multiaddr": "/ip4/1.2.3.4/tcp/9000/p2p/QmAbc...",
  "peerId": "QmAbc...",
  "role": "researcher",
  "fleetId": "flt_abc123",
  "source": "db" | "ens"
}
```

---

## Files to Create / Modify

### New

**`apps/api/src/services/ens.ts`**

Exports two functions:
- `registerAgentENS(agentId, { multiaddr, peerId, role, fleetId })` — writes to ENS; graceful no-op if `ENS_SIGNER_KEY` not set
- `lookupAgentENS(agentIdOrName)` — reads text records from ENS; returns null fields if not found

Uses `viem` for all Ethereum interaction. No external ENS SDK dependency — talks directly to the ENS Registry (`0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`) and the resolver returned by the parent domain.

### Modified

**`apps/api/package.json`**
- Add `"viem": "^2.0.0"`

**`apps/api/src/routes/agents.ts`**
- In the `PATCH /fleets/:id/agents/:agentId` handler: after the MongoDB update, if `axl.multiaddr` is present in the body, fire `void registerAgentENS(...)` — fetch agent from DB to get role, pass fleetId from route param.

**`apps/api/src/routes/agentRuntime.ts`**
- Add `GET /agents/resolve/:name` endpoint. No fleet scoping — any authenticated agent token can call it to discover cross-fleet peers.

**`packages/sdk/src/index.ts`**
- Add `resolveAgent(name: string)` to `CommonOSAgentClient` — thin wrapper over `GET /agents/resolve/:name`.

---

## Contract Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| ENS Registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| Public Resolver | dynamically read from `registry.resolver(parentNode)` — not hardcoded |

The resolver address is read dynamically from the parent node so it works regardless of which resolver the domain owner chose.

---

## Graceful Degradation

| Condition | Behaviour |
|-----------|-----------|
| `ENS_SIGNER_KEY` not set | Registration skipped, warning logged, API response unaffected |
| Sepolia RPC unreachable | ENS registration fails silently; DB record still written |
| Agent not in ENS | Lookup returns 404; agents fall back to intra-fleet peer list |
| Parent domain has no resolver | Warning logged, registration skipped |

---

## Out of Scope for This Integration

- ENS on mainnet (Sepolia only for now)
- ENS NameWrapper / wrapped names
- Reverse records (`addr.reverse`)
- Per-tenant ENS namespaces
- Deregistration on agent termination (can be added trivially by calling `registerAgentENS` with empty strings in the DELETE handler)
