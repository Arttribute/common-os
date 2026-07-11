export function qualifiedOpenClawModelId(
  provider: string,
  model: string
): string {
  if (model.startsWith(`${provider}/`)) return model;
  if (provider === "openrouter") return `openrouter/${model}`;
  return model.includes("/") ? model : `${provider}/${model}`;
}
