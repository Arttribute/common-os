export interface HermesGatewayConfigOptions {
  role: string;
  hermesConfig?: {
    modelProvider: string | null;
    modelId: string | null;
    toolsets?: string[] | null;
    channels?: Record<string, Record<string, unknown>> | null;
  } | null;
}

export function hermesChannelEnvironment(
  channels: Record<string, Record<string, unknown>> | null | undefined
): Record<string, string> {
  const telegram = channels?.telegram;
  const whatsapp = channels?.whatsapp;
  const env: Record<string, string> = {};
  if (telegram?.enabled) {
    env.TELEGRAM_BOT_TOKEN = String(telegram.botToken ?? "");
    env.TELEGRAM_ALLOWED_USERS = stringList(telegram.allowFrom).join(",");
    if (telegram.homeTarget) {
      env.TELEGRAM_HOME_CHANNEL = String(telegram.homeTarget);
    }
  }
  if (whatsapp?.enabled && whatsapp.mode === "cloud") {
    env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = String(whatsapp.phoneNumberId ?? "");
    env.WHATSAPP_CLOUD_ACCESS_TOKEN = String(whatsapp.accessToken ?? "");
    env.WHATSAPP_CLOUD_APP_SECRET = String(whatsapp.appSecret ?? "");
    env.WHATSAPP_CLOUD_VERIFY_TOKEN = String(whatsapp.verifyToken ?? "");
    env.WHATSAPP_CLOUD_ALLOWED_USERS = stringList(whatsapp.allowFrom)
      .map((value) => value.replace(/^\+/, ""))
      .join(",");
  } else if (whatsapp?.enabled) {
    env.WHATSAPP_ENABLED = "true";
    env.WHATSAPP_MODE = whatsapp.mode === "self-chat" ? "self-chat" : "bot";
    env.WHATSAPP_ALLOWED_USERS = stringList(whatsapp.allowFrom)
      .map((value) => value.replace(/^\+/, ""))
      .join(",");
  }
  return env;
}

/** Build the non-secret config persisted in the managed Hermes profile. */
export function buildHermesGatewayConfig(
  opts: HermesGatewayConfigOptions
): Record<string, unknown> {
  const provider = hermesProviderId(opts);
  const customProvider = hermesCustomProvider(opts);
  const platformToolsets: Record<string, string[]> = {
    cli: opts.hermesConfig?.toolsets?.length
      ? opts.hermesConfig.toolsets
      : ["hermes-cli"],
  };
  for (const [name, channel] of Object.entries(
    opts.hermesConfig?.channels ?? {}
  )) {
    if (channel.enabled === false) continue;
    const platform =
      name === "whatsapp" && channel.mode === "cloud" ? "whatsapp_cloud" : name;
    platformToolsets[platform] = [
      name === "telegram" ? "hermes-telegram" : "hermes-whatsapp",
    ];
  }
  return {
    model: { default: hermesModelId(opts), provider },
    ...(customProvider ? { custom_providers: [customProvider] } : {}),
    display: { branding: { agent_name: opts.role } },
    // Hermes 0.18+ ignores the deprecated top-level `toolsets` key. The
    // OpenAI-compatible gateway used by Agent Commons runs the CLI platform,
    // so configure its effective catalog through `platform_toolsets.cli`.
    platform_toolsets: platformToolsets,
  };
}

export function hermesModelId(opts: HermesGatewayConfigOptions): string {
  const provider =
    opts.hermesConfig?.modelProvider ??
    process.env.HERMES_MODEL_PROVIDER ??
    "openai";
  const model =
    opts.hermesConfig?.modelId ??
    process.env.HERMES_MODEL_ID ??
    (provider === "anthropic"
      ? "anthropic/claude-sonnet-4-6"
      : provider === "openrouter"
      ? "openrouter/openai/gpt-5.4-mini"
      : provider === "google"
      ? "google/gemini-3-flash"
      : provider === "groq"
      ? "groq/openai/gpt-oss-120b"
      : "openai/gpt-5.4-mini");
  if (provider === "openrouter") return stripProvider(model, "openrouter");
  return stripProvider(model, provider);
}

function stripProvider(model: string, provider: string): string {
  return model.startsWith(`${provider}/`)
    ? model.slice(provider.length + 1)
    : model;
}

function configuredProvider(opts: HermesGatewayConfigOptions): string {
  return (
    opts.hermesConfig?.modelProvider ??
    process.env.HERMES_MODEL_PROVIDER ??
    "openai"
  ).toLowerCase();
}

function hermesProviderId(opts: HermesGatewayConfigOptions): string {
  const provider = configuredProvider(opts);
  if (provider === "openai") return "openai-api";
  if (provider === "google") return "gemini";
  if (provider === "groq" || provider === "mistral") {
    return `custom:${provider}`;
  }
  return provider;
}

function hermesCustomProvider(
  opts: HermesGatewayConfigOptions
): Record<string, string> | null {
  const provider = configuredProvider(opts);
  if (provider === "groq") {
    return {
      name: "groq",
      base_url: "https://api.groq.com/openai/v1",
      key_env: "GROQ_API_KEY",
    };
  }
  if (provider === "mistral") {
    return {
      name: "mistral",
      base_url: "https://api.mistral.ai/v1",
      key_env: "MISTRAL_API_KEY",
    };
  }
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}
