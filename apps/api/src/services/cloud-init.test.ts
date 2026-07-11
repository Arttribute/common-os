import {
  buildHermesGatewayConfig,
  type HermesGatewayConfigOptions,
} from "./hermes-config";

function launchOptions(toolsets: string[] | null): HermesGatewayConfigOptions {
  return {
    role: "Hermes Test",
    hermesConfig: {
      modelProvider: "openai",
      modelId: "gpt-5.4-mini",
      toolsets,
    },
  };
}

describe("Hermes managed configuration", () => {
  it("writes toolsets to the current CLI platform configuration", () => {
    const config = buildHermesGatewayConfig(
      launchOptions(["terminal", "file", "skills"]),
    );

    expect(config).not.toHaveProperty("toolsets");
    expect(config).toMatchObject({
      platform_toolsets: { cli: ["terminal", "file", "skills"] },
    });
  });

  it("uses the Hermes CLI preset when no explicit toolsets are configured", () => {
    expect(buildHermesGatewayConfig(launchOptions(null))).toMatchObject({
      platform_toolsets: { cli: ["hermes-cli"] },
    });
  });
});
