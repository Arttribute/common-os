import { persistedRuntimeConfig } from "./runtime-config-safety";

describe("persistedRuntimeConfig", () => {
  it("removes provider, gateway, and nested channel credentials", () => {
    const result = persistedRuntimeConfig({
      openclawConfig: {
        modelProvider: "openai",
        modelId: "gpt-test",
        modelApiKey: "provider-secret",
        plugins: [],
        dmPolicy: "pairing",
        channels: {
          whatsapp: {
            accessToken: "channel-secret",
            accountId: "safe-id",
            nested: { client_secret: "nested-secret" },
          },
        },
      },
      hermesConfig: {
        modelProvider: "openai",
        modelId: "gpt-test",
        modelApiKey: "provider-secret",
        gatewayApiKey: "gateway-secret",
      },
    });

    expect(result.openclawConfig?.modelApiKey).toBeNull();
    expect(result.openclawConfig?.channels?.whatsapp).toEqual({
      accessToken: null,
      accountId: "safe-id",
      nested: { client_secret: null },
    });
    expect(result.hermesConfig?.modelApiKey).toBeNull();
    expect(result.hermesConfig?.gatewayApiKey).toBeNull();
  });
});
