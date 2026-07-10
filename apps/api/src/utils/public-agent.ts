type SecretConfig = {
	modelApiKey?: string | null;
	[key: string]: unknown;
};

type HermesSecretConfig = SecretConfig & {
	gatewayApiKey?: string | null;
};

type AgentWithConfig = {
	config?: {
		nativeConfig?: SecretConfig | null;
		openclawConfig?: SecretConfig | null;
		hermesConfig?: HermesSecretConfig | null;
		[key: string]: unknown;
	};
};

/**
 * Return an API-safe copy of an agent without provider or gateway credentials.
 * The stored document is never mutated.
 */
export function publicAgent<T extends AgentWithConfig>(agent: T): T {
	return {
		...agent,
		config: agent.config
			? {
					...agent.config,
					nativeConfig: agent.config.nativeConfig
						? { ...agent.config.nativeConfig, modelApiKey: null }
						: agent.config.nativeConfig,
					openclawConfig: agent.config.openclawConfig
						? { ...agent.config.openclawConfig, modelApiKey: null }
						: agent.config.openclawConfig,
					hermesConfig: agent.config.hermesConfig
						? {
								...agent.config.hermesConfig,
								modelApiKey: null,
								gatewayApiKey: null,
							}
						: agent.config.hermesConfig,
				}
			: agent.config,
	} as T;
}
