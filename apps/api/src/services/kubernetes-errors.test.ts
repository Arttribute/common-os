import { kubernetesStatusCode } from "./kubernetes-errors";

describe("Kubernetes API errors", () => {
  it("reads status codes from generated client exception bodies", () => {
    expect(
      kubernetesStatusCode({
        body: JSON.stringify({
          status: "Failure",
          reason: "Conflict",
          code: 409,
        }),
      })
    ).toBe(409);
    expect(kubernetesStatusCode({ body: { code: 404 } })).toBe(404);
  });

  it("supports top-level and response status codes", () => {
    expect(kubernetesStatusCode({ statusCode: 409 })).toBe(409);
    expect(kubernetesStatusCode({ response: { status: 404 } })).toBe(404);
  });
});
