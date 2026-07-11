jest.mock("@kubernetes/client-node", () => ({}));
jest.mock("uuid", () => ({ v4: () => "test-session-id" }));

import {
  commonRuntimeEnv,
  type LaunchOptions,
} from "./cloud-init";

function options(
  integrationPath: LaunchOptions["integrationPath"],
): LaunchOptions {
  return {
    agentId: "agent-test",
    agentToken: "test-token",
    fleetId: "fleet-test",
    tenantId: "tenant-test",
    apiUrl: "https://example.test",
    role: "Runtime Test",
    systemPrompt: "Be helpful.",
    integrationPath,
    dockerImage: null,
    commonsApiKey: "commons-test-key",
    commonsAgentId: "commons-agent-test",
  };
}

function names(integrationPath: LaunchOptions["integrationPath"]): string[] {
  return commonRuntimeEnv(options(integrationPath), "example.test/agent:latest")
    .map((entry) => entry.name)
    .filter((name): name is string => Boolean(name));
}

describe("managed runtime environment isolation", () => {
  it("does not put Hermes or OpenClaw configuration in native computers", () => {
    expect(names("native")).not.toEqual(
      expect.arrayContaining([
        "HERMES_CONFIG_JSON",
        "HERMES_MODEL_ID",
        "OPENCLAW_CONFIG_JSON",
        "OPENCLAW_MODEL_ID",
      ]),
    );
  });

  it("puts only OpenClaw configuration in OpenClaw computers", () => {
    const environment = names("openclaw");
    expect(environment).toEqual(expect.arrayContaining(["OPENCLAW_CONFIG_JSON"]));
    expect(environment.some((name) => name.startsWith("HERMES_"))).toBe(false);
  });

  it("puts only Hermes configuration in Hermes computers", () => {
    const environment = names("hermes");
    expect(environment).toEqual(expect.arrayContaining(["HERMES_CONFIG_JSON"]));
    expect(environment.some((name) => name.startsWith("OPENCLAW_"))).toBe(false);
  });
});
