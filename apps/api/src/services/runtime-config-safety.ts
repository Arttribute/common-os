import type { AgentDoc } from "../types.js";

const SECRET_KEY =
  /(?:secret|token|password|passphrase|api.?key|private.?key|client.?secret|authorization|cookie)/i;

function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? null : redactObject(item),
    ])
  );
}

/** Configuration safe to persist or return from the CommonOS control plane. */
export function persistedRuntimeConfig(config: {
  nativeConfig?: AgentDoc["config"]["nativeConfig"];
  openclawConfig?: AgentDoc["config"]["openclawConfig"];
  hermesConfig?: AgentDoc["config"]["hermesConfig"];
}) {
  return {
    nativeConfig: config.nativeConfig
      ? { ...config.nativeConfig, modelApiKey: null }
      : null,
    openclawConfig: config.openclawConfig
      ? {
          ...config.openclawConfig,
          modelApiKey: null,
          channels: redactObject(config.openclawConfig.channels) as NonNullable<
            AgentDoc["config"]["openclawConfig"]
          >["channels"],
        }
      : null,
    hermesConfig: config.hermesConfig
      ? {
          ...config.hermesConfig,
          modelApiKey: null,
          gatewayApiKey: null,
          channels: redactObject(config.hermesConfig.channels) as NonNullable<
            AgentDoc["config"]["hermesConfig"]
          >["channels"],
        }
      : null,
  };
}
