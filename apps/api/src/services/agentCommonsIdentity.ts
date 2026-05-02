import { agents, worldStates } from "../db/mongo.js";
import type { AgentDoc } from "../types.js";

export const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isWalletAddress(value: string | null | undefined): value is string {
	return Boolean(value && ETH_ADDRESS_RE.test(value));
}

export function normalizeCommonsIdentity(
	commons: AgentDoc["commons"],
): AgentDoc["commons"] {
	const runtimeWallet = isWalletAddress(commons.agentId)
		? commons.agentId
		: isWalletAddress(commons.walletAddress)
			? commons.walletAddress
			: null;

	const registryAgentId =
		commons.registryAgentId ??
		(commons.agentId && !isWalletAddress(commons.agentId) ? commons.agentId : null);

	return {
		agentId: runtimeWallet,
		apiKey: null,
		walletAddress: runtimeWallet,
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
