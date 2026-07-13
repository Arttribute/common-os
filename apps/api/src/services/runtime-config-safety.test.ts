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
        toolsets: ["safe"],
        channels: {
          telegram: {
            botToken: "telegram-secret",
            allowFrom: ["123"],
          },
          whatsapp: {
            accessToken: "whatsapp-secret",
            phoneNumberId: "safe-phone-id",
          },
        },
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
    expect(result.hermesConfig?.channels).toEqual({
      telegram: { botToken: null, allowFrom: ["123"] },
      whatsapp: { accessToken: null, phoneNumberId: "safe-phone-id" },
    });
  });
});
