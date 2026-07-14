/// <reference types="jest" />

import { buildManagedRuntimePrompt } from "./managed-runtime-prompt";

describe("buildManagedRuntimePrompt", () => {
  it("keeps a first-turn managed runtime handoff concise", () => {
    const prompt = buildManagedRuntimePrompt({
      description: "Reply with exactly: pong",
      systemPrompt: "You are a precise assistant.",
      orchestrationContext: "## Fleet Coordination\nCoordinate conservatively.",
      workspaceDir: "/mnt/shared",
    });

    expect(prompt).toContain("You are a precise assistant.");
    expect(prompt).toContain("Reply with exactly: pong");
    expect(prompt).toContain("provided cli_* tools");
    expect(prompt).toContain("/mnt/shared");
    expect(prompt).not.toContain("Available CLI tools");
    expect(prompt).not.toContain("Current file system");
  });

  it("includes only the eight most recent turns", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `turn-${index}`,
    }));

    const prompt = buildManagedRuntimePrompt({
      description: "latest enriched assignment",
      messages,
      workspaceDir: "/mnt/shared",
    });

    expect(prompt).not.toContain("turn-0");
    expect(prompt).not.toContain("turn-1");
    expect(prompt).toContain("turn-2");
    expect(prompt).toContain("turn-9");
    expect(prompt).not.toContain("latest enriched assignment");
  });
});
