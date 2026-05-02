import { agents, worldStates } from "../db/mongo.js";
import type { AgentDoc } from "../types.js";

export const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isWalletAddress(value: string | null | undefined): value is string {
	return Boolean(value && ETH_ADDRESS_RE.test(value));
}

// The AGC runtime identity is the registryAgentId (UUID) returned from POST /v1/agents.
// Wallet routes are not available, so commons.agentId stores the registry UUID.
export function normalizeCommonsIdentity(
	commons: AgentDoc["commons"],
): AgentDoc["commons"] {
	// Prefer registryAgentId as the canonical runtime identity.
	// Fall back to whatever is stored in agentId (may already be a UUID or wallet).
	const runtimeId =
		commons.registryAgentId ??
		(commons.agentId && !isWalletAddress(commons.agentId) ? commons.agentId : null) ??
		commons.agentId ??
		null;

	const registryAgentId = commons.registryAgentId ?? runtimeId;

	return {
		agentId: runtimeId,
		apiKey: null,
		walletAddress: commons.walletAddress ?? null,
		registryAgentId,
	};
}

export async function persistNormalizedCommonsIdentity(agent: AgentDoc): Promise<AgentDoc["commons"]> {
	const commons = normalizeCommonsIdentity(agent.commons);

	await (await agents()).updateOne(
		{ _id: agent._id },
		{
			$set: {
				"commons.agentId": commons.agentId,
				"commons.apiKey": null,
				"commons.walletAddress": commons.walletAddress,
				"commons.registryAgentId": commons.registryAgentId ?? null,
				updatedAt: new Date(),
			},
		},
	);

	await (await worldStates()).updateOne(
		{ fleetId: agent.fleetId, "agents.agentId": agent._id },
		{
			$set: {
				"agents.$.commons": {
					agentId: commons.agentId,
					walletAddress: commons.walletAddress,
					registryAgentId: commons.registryAgentId ?? null,
				},
				updatedAt: new Date(),
			},
		},
	).catch(() => {});

	return commons;
}
