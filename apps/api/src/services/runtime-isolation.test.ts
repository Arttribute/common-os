jest.mock("@kubernetes/client-node", () => ({}));
jest.mock("uuid", () => ({ v4: () => "test-session-id" }));

import {
  commonRuntimeEnv,
  buildOpenClawGatewayConfig,
  openClawRuntimeContainer,
  parseOpenClawAdminRpcResponse,
  isRuntimeContainerStartingError,
  runtimeStorageInitContainer,
  type LaunchOptions,
} from "./cloud-init";

function options(
  integrationPath: LaunchOptions["integrationPath"]
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
      ])
    );
  });

  it("puts only OpenClaw configuration in OpenClaw computers", () => {
    const environment = names("openclaw");
    expect(environment).toEqual(
      expect.arrayContaining(["OPENCLAW_CONFIG_JSON"])
    );
    expect(environment.some((name) => name.startsWith("HERMES_"))).toBe(false);
  });

  it("loads the WhatsApp connector from the process-owned plugin cache", () => {
    const opts = options("openclaw");
    opts.openclawConfig = {
      modelProvider: "openai",
      modelId: "gpt-5.4-mini",
      modelApiKey: null,
      channels: { whatsapp: { enabled: true } },
      plugins: [],
      dmPolicy: "allowlist",
    };
    const config = JSON.parse(
      commonRuntimeEnv(opts, "example.test/agent:latest").find(
        (entry) => entry.name === "OPENCLAW_CONFIG_JSON"
      )?.value ?? "{}"
    );

    expect(config.plugins).toMatchObject({
      load: {
        paths: ["/home/node/.commonos-openclaw/extensions/whatsapp"],
      },
      entries: {
        "admin-http-rpc": { enabled: true },
        whatsapp: { enabled: true },
      },
    });
    expect(config.plugins).not.toHaveProperty("allow");
  });

  it("extracts persisted channel plugins instead of copying them on every boot", () => {
    const opts = options("openclaw");
    opts.dockerImage = "example.test/openclaw:latest";
    const command = openClawRuntimeContainer(opts, [])?.args?.join("\n") ?? "";

    expect(command).toContain(
      'tar -xzf "$plugin_archive" -C "$plugin_state/extensions/$plugin"'
    );
    expect(command).not.toContain(
      'cp -R "$plugin_cache" "$plugin_state/extensions/$plugin"'
    );
    expect(command).not.toContain(
      'ln -s "$plugin_cache" "$plugin_state/extensions/$plugin"'
    );
    expect(command).toContain("$plugin-$OPENCLAW_PLUGIN_VERSION.tar.gz");
    expect(command).toContain(
      "clawhub:@openclaw/$plugin@$OPENCLAW_PLUGIN_VERSION"
    );
    expect(command).toContain('HOME="$plugin_state"');
    expect(command).toContain(
      "DELETE FROM installed_plugin_index WHERE index_key = ?"
    );
    expect(command).toContain(
      'record.installPath.startsWith(process.env.HOME + "/.openclaw/extensions/")'
    );
    expect(command.indexOf("DELETE FROM installed_plugin_index")).toBeLessThan(
      command.indexOf('fs.renameSync(tempPath, configPath)')
    );
    expect(command).not.toContain("const externalChannels = new Set");
    expect(command).toContain("touch /tmp/commonos-openclaw-configured");
    const environment = openClawRuntimeContainer(opts, [])?.env ?? [];
    expect(environment).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "OPENCLAW_DISABLE_PLUGIN_REGISTRY_MIGRATION",
          value: "1",
        }),
      ])
    );
  });

  it("configures low-latency defaults and official Slack and Discord plugins", () => {
    const opts = options("openclaw");
    opts.openclawConfig = {
      modelProvider: "openai",
      modelId: "gpt-5.4-mini",
      modelApiKey: null,
      channels: {
        slack: {
          enabled: true,
          botToken: "xoxb-secret",
          appToken: "xapp-secret",
        },
        discord: { enabled: true, botToken: "discord-secret" },
      },
      plugins: [],
      dmPolicy: "allowlist",
    };

    const config = buildOpenClawGatewayConfig(opts) as any;
    expect(config.agents.defaults).toMatchObject({
      thinkingDefault: "low",
      contextInjection: "continuation-skip",
    });
    expect(config.agents.list[0].fastModeDefault).toBe("auto");
    expect(config.channels.slack).toMatchObject({
      mode: "socket",
      botToken: "xoxb-secret",
      appToken: "xapp-secret",
    });
    expect(config.channels.discord).toMatchObject({
      token: "discord-secret",
    });
    expect(config.plugins.load.paths).toEqual([
      "/home/node/.commonos-openclaw/extensions/slack",
      "/home/node/.commonos-openclaw/extensions/discord",
    ]);
  });

  it("unwraps OpenClaw admin RPC responses and preserves errors", () => {
    expect(
      parseOpenClawAdminRpcResponse(
        JSON.stringify({ ok: true, payload: { connected: false } })
      )
    ).toEqual({ connected: false });
    expect(() =>
      parseOpenClawAdminRpcResponse(
        JSON.stringify({ ok: false, error: { message: "not linked" } })
      )
    ).toThrow("not linked");
  });

  it("recognizes transient runtime container exec races", () => {
    expect(
      isRuntimeContainerStartingError(
        new Error(
          'unable to upgrade connection: container not found ("openclaw-runtime")'
        )
      )
    ).toBe(true);
    expect(
      isRuntimeContainerStartingError(new Error("permission denied"))
    ).toBe(false);
  });

  it("puts only Hermes configuration in Hermes computers", () => {
    const environment = names("hermes");
    expect(environment).toEqual(expect.arrayContaining(["HERMES_CONFIG_JSON"]));
    expect(environment.some((name) => name.startsWith("OPENCLAW_"))).toBe(
      false
    );
  });

  it("initializes only the selected managed runtime's storage", () => {
    const openclaw = runtimeStorageInitContainer(options("openclaw"));
    const hermes = runtimeStorageInitContainer(options("hermes"));

    expect(openclaw?.args?.join(" ")).toContain("/mnt/shared/openclaw");
    expect(openclaw?.args?.join(" ")).not.toContain("/mnt/shared/hermes");
    expect(hermes?.args?.join(" ")).toContain("/mnt/shared/hermes");
    expect(hermes?.args?.join(" ")).not.toContain("/mnt/shared/openclaw");
    expect(runtimeStorageInitContainer(options("native"))).toBeNull();
  });

  it("does not send a platform provider key to a different managed provider", () => {
    const previousProvider = process.env.HERMES_MODEL_PROVIDER;
    const previousKey = process.env.HERMES_MODEL_API_KEY;
    process.env.HERMES_MODEL_PROVIDER = "openai";
    process.env.HERMES_MODEL_API_KEY = "platform-openai-key";
    try {
      const opts = options("hermes");
      opts.hermesConfig = {
        modelProvider: "openrouter",
        modelId: "openai/gpt-5.4-mini",
        modelApiKey: null,
        gatewayApiKey: null,
        toolsets: null,
      };
      const environment = commonRuntimeEnv(opts, "example.test/agent:latest");
      expect(
        environment.find((entry) => entry.name === "OPENROUTER_API_KEY")?.value
      ).toBe("");
    } finally {
      if (previousProvider === undefined)
        delete process.env.HERMES_MODEL_PROVIDER;
      else process.env.HERMES_MODEL_PROVIDER = previousProvider;
      if (previousKey === undefined) delete process.env.HERMES_MODEL_API_KEY;
      else process.env.HERMES_MODEL_API_KEY = previousKey;
    }
  });
});
