import { qualifiedOpenClawModelId } from "./runtime-models";

describe("managed runtime model configuration", () => {
  it("qualifies Agent Commons model ids for OpenClaw", () => {
    expect(qualifiedOpenClawModelId("openai", "gpt-5.4-mini")).toBe(
      "openai/gpt-5.4-mini"
    );
    expect(
      qualifiedOpenClawModelId("anthropic", "anthropic/claude-opus-4-6")
    ).toBe("anthropic/claude-opus-4-6");
    expect(
      qualifiedOpenClawModelId("openrouter", "openai/gpt-5.4-mini")
    ).toBe("openrouter/openai/gpt-5.4-mini");
  });
});
