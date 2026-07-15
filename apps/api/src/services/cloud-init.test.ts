jest.mock("@kubernetes/client-node", () => ({}));
jest.mock("uuid", () => ({ v4: () => "test-session-id" }));

import {
  buildHermesGatewayConfig,
  hermesChannelEnvironment,
  type HermesGatewayConfigOptions,
} from "./hermes-config";
import { hermesWhatsAppCommand } from "./cloud-init";

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
  it("uses Hermes' direct OpenAI provider instead of auto-routing through OpenRouter", () => {
    expect(buildHermesGatewayConfig(launchOptions(null))).toMatchObject({
      model: { default: "gpt-5.4-mini", provider: "openai-api" },
      agent: { reasoning_effort: "low" },
    });
  });

  it("keeps OpenRouter model ownership while selecting the OpenRouter provider", () => {
    const opts = launchOptions(null);
    opts.hermesConfig = {
      ...opts.hermesConfig!,
      modelProvider: "openrouter",
      modelId: "openai/gpt-5.4-mini",
    };
    expect(buildHermesGatewayConfig(opts)).toMatchObject({
      model: { default: "openai/gpt-5.4-mini", provider: "openrouter" },
    });
  });

  it("declares OpenAI-compatible providers through Hermes custom providers", () => {
    const opts = launchOptions(null);
    opts.hermesConfig = {
      ...opts.hermesConfig!,
      modelProvider: "groq",
      modelId: "llama-3.3-70b-versatile",
    };
    expect(buildHermesGatewayConfig(opts)).toMatchObject({
      model: {
        default: "llama-3.3-70b-versatile",
        provider: "custom:groq",
      },
      custom_providers: [
        {
          name: "groq",
          base_url: "https://api.groq.com/openai/v1",
          key_env: "GROQ_API_KEY",
        },
      ],
    });
  });

  it("writes toolsets to the current CLI platform configuration", () => {
    const config = buildHermesGatewayConfig(
      launchOptions(["terminal", "file", "skills"])
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

  it("enables Hermes messaging toolsets only for configured channels", () => {
    const opts = launchOptions(["safe"]);
    opts.hermesConfig = {
      ...opts.hermesConfig!,
      channels: {
        telegram: { enabled: true },
        whatsapp: { enabled: true, mode: "cloud" },
        slack: { enabled: true },
        discord: { enabled: true },
      },
    };

    expect(buildHermesGatewayConfig(opts)).toMatchObject({
      platform_toolsets: {
        cli: ["safe"],
        telegram: ["hermes-telegram"],
        whatsapp_cloud: ["hermes-whatsapp"],
        slack: ["hermes-slack"],
        discord: ["hermes-discord"],
      },
    });
  });

  it("injects Hermes channel credentials and normalized allowlists", () => {
    const env = hermesChannelEnvironment({
      telegram: {
        enabled: true,
        botToken: "telegram-secret",
        allowFrom: ["123", "456"],
      },
      whatsapp: {
        enabled: true,
        mode: "cloud",
        phoneNumberId: "phone-id",
        accessToken: "whatsapp-secret",
        appSecret: "app-secret",
        verifyToken: "verify-secret",
        allowFrom: ["+254700000000"],
      },
      slack: {
        enabled: true,
        botToken: "xoxb-secret",
        appToken: "xapp-secret",
        allowFrom: ["U01ABC2DEF3"],
      },
      discord: {
        enabled: true,
        botToken: "discord-secret",
        allowFrom: ["284102345871466496"],
      },
    });

    expect(env).toMatchObject({
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      TELEGRAM_ALLOWED_USERS: "123,456",
      WHATSAPP_CLOUD_PHONE_NUMBER_ID: "phone-id",
      WHATSAPP_CLOUD_ACCESS_TOKEN: "whatsapp-secret",
      WHATSAPP_CLOUD_ALLOWED_USERS: "254700000000",
      SLACK_BOT_TOKEN: "xoxb-secret",
      SLACK_APP_TOKEN: "xapp-secret",
      SLACK_ALLOWED_USERS: "U01ABC2DEF3",
      DISCORD_BOT_TOKEN: "discord-secret",
      DISCORD_ALLOWED_USERS: "284102345871466496",
    });
    expect(env).not.toHaveProperty("WHATSAPP_ENABLED");
  });

  it("enables the persistent Hermes adapter before linked-device pairing", () => {
    expect(
      hermesChannelEnvironment({
        whatsapp: {
          enabled: true,
          mode: "self-chat",
          allowFrom: ["+254700000000"],
        },
      })
    ).toMatchObject({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "self-chat",
      WHATSAPP_ALLOWED_USERS: "254700000000",
    });
  });

  it("builds persistent Hermes WhatsApp QR commands", () => {
    const connect = hermesWhatsAppCommand({
      action: "connect",
      mode: "self-chat",
      allowedUsersBase64: Buffer.from("254700000000").toString("base64"),
    }).join("\n");
    const status = hermesWhatsAppCommand({
      action: "status",
      mode: "self-chat",
      allowedUsersBase64: "",
    }).join("\n");

    expect(connect).toContain("--pair-only --pair-json");
    expect(connect).toContain("data:image/png;base64,");
    expect(connect).toContain('WHATSAPP_MODE="%s"');
    expect(status).toContain("session/creds.json");
    expect(status).toContain('"status":"connected"');
  });
});
