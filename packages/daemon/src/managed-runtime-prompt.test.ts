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

  it("includes seven prior turns plus the current enriched assignment", () => {
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
    expect(prompt).toContain("turn-8");
    expect(prompt).not.toContain("turn-9");
    expect(prompt).toContain("latest enriched assignment");
  });

  it("removes repeated enrichment from historical user turns", () => {
    const prompt = buildManagedRuntimePrompt({
      description:
        "current request\n\n## Relevant Memories\ncurrent-memory\n\n## Agent skills\ncurrent-skill",
      messages: [
        {
          role: "user",
          content:
            "prior request\n\n## Relevant Memories\nold-memory\n\n## Agent skills\nold-skill",
        },
        { role: "assistant", content: "prior answer" },
        {
          role: "user",
          content:
            "current request\n\n## Relevant Memories\ncurrent-memory\n\n## Agent skills\ncurrent-skill",
        },
      ],
      workspaceDir: "/mnt/shared",
    });

    expect(prompt).toContain("prior request");
    expect(prompt).toContain("prior answer");
    expect(prompt).not.toContain("old-memory");
    expect(prompt).not.toContain("old-skill");
    expect(prompt.match(/current-memory/g)).toHaveLength(1);
    expect(prompt.match(/current-skill/g)).toHaveLength(1);
  });
});
