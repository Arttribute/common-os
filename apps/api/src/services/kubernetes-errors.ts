export function kubernetesStatusCode(error: unknown): number | undefined {
  const value = error as {
    statusCode?: number;
    code?: number;
    body?: unknown;
    response?: { status?: number; statusCode?: number };
  };
  const direct =
    value.statusCode ??
    value.code ??
    value.response?.statusCode ??
    value.response?.status;
  if (Number.isFinite(Number(direct))) return Number(direct);

  let body = value.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  if (body && typeof body === "object") {
    const bodyCode = (body as { code?: unknown }).code;
    if (Number.isFinite(Number(bodyCode))) return Number(bodyCode);
  }
  return undefined;
}
