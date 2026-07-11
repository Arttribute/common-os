import { qualifiedHermesModelId } from "./runtime-models";

export interface HermesGatewayConfigOptions {
  role: string;
  hermesConfig?: {
    modelProvider: string | null;
    modelId: string | null;
    toolsets: string[] | null;
  } | null;
}

/** Build the non-secret config persisted in the managed Hermes profile. */
export function buildHermesGatewayConfig(
  opts: HermesGatewayConfigOptions,
): Record<string, unknown> {
  return {
    model: { default: hermesModelId(opts), provider: "auto" },
    display: { branding: { agent_name: opts.role } },
    // Hermes 0.18+ ignores the deprecated top-level `toolsets` key. The
    // OpenAI-compatible gateway used by Agent Commons runs the CLI platform,
    // so configure its effective catalog through `platform_toolsets.cli`.
    platform_toolsets: {
      cli: opts.hermesConfig?.toolsets?.length
        ? opts.hermesConfig.toolsets
        : ["hermes-cli"],
    },
  };
}

function hermesModelId(opts: HermesGatewayConfigOptions): string {
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
  return qualifiedHermesModelId(provider, model);
}
