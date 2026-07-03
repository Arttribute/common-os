export function tenantScopedQuery(
	c: { get: (key: string) => unknown },
	query: Record<string, unknown>,
) {
	if (c.get("authType") === "service") return query;
	return {
		...query,
		tenantId: c.get("tenantId"),
	};
}
