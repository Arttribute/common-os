/**
 * Agent Commons stores provider and model separately (for example,
 * `openai` + `gpt-5.4-mini`), while OpenClaw and Hermes both require a
 * provider-qualified model id. OpenRouter ids already contain an upstream
 * provider but still need the OpenRouter prefix.
 */
export function qualifiedRuntimeModelId(
  provider: string,
  model: string
): string {
  if (model.startsWith(`${provider}/`)) return model;
  if (provider === "openrouter") return `openrouter/${model}`;
  return model.includes("/") ? model : `${provider}/${model}`;
}

export const qualifiedOpenClawModelId = qualifiedRuntimeModelId;
export const qualifiedHermesModelId = qualifiedRuntimeModelId;
