import { tenantScopedQuery } from "./tenant-scope";

function context(authType: string, tenantId = "tenant_123") {
	return {
		get: (key: string) => {
			if (key === "authType") return authType;
			if (key === "tenantId") return tenantId;
			return undefined;
		},
	};
}

describe("tenantScopedQuery", () => {
	it("preserves caller tenant scope for tenant requests", () => {
		expect(tenantScopedQuery(context("tenant"), { _id: "agt_1" })).toEqual({
			_id: "agt_1",
			tenantId: "tenant_123",
		});
	});

	it("does not force tenantId='*' onto trusted service requests", () => {
		expect(tenantScopedQuery(context("service", "*"), { _id: "agt_1" })).toEqual({
			_id: "agt_1",
		});
	});
});
