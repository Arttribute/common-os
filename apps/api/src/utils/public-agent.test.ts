import { publicAgent } from "./public-agent";

describe("publicAgent", () => {
	it("redacts every stored model and gateway credential without mutating the agent", () => {
		const agent = {
			_id: "agt_test",
			config: {
				integrationPath: "hermes",
				nativeConfig: { modelProvider: "openai", modelApiKey: "native-secret" },
				openclawConfig: { modelProvider: "openai", modelApiKey: "openclaw-secret" },
				hermesConfig: {
					modelProvider: "anthropic",
					modelApiKey: "hermes-secret",
					gatewayApiKey: "gateway-secret",
				},
			},
		};

		const result = publicAgent(agent);

		expect(result.config?.nativeConfig?.modelApiKey).toBeNull();
		expect(result.config?.openclawConfig?.modelApiKey).toBeNull();
		expect(result.config?.hermesConfig?.modelApiKey).toBeNull();
		expect(result.config?.hermesConfig?.gatewayApiKey).toBeNull();
		expect(result.config?.integrationPath).toBe("hermes");
		expect(agent.config.nativeConfig.modelApiKey).toBe("native-secret");
	});
});
