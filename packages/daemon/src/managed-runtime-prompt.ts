export type ManagedRuntimeMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ManagedRuntimePromptOptions = {
  description: string;
  messages?: ManagedRuntimeMessage[];
  systemPrompt?: string | null;
  orchestrationContext?: string | null;
  workspaceDir: string;
};

/**
 * OpenClaw and Hermes already provide their own tool instructions and runtime
 * operating context. Keep the CommonOS handoff focused on the assignment so
 * model time is spent answering instead of re-reading the native CLI manual.
 */
export function buildManagedRuntimePrompt({
  description,
  messages,
  systemPrompt,
  orchestrationContext,
  workspaceDir,
}: ManagedRuntimePromptOptions): string {
  const runtimeContext = [
    "Work autonomously from intent to a verified outcome.",
    "Use the runtime's built-in tools and the provided cli_* tools directly when action is needed.",
    `The shared CommonOS workspace is ${workspaceDir}.`,
    "Answer the latest user request only; keep prior turns as context.",
  ].join(" ");

  const conversation =
    messages && messages.length > 1
      ? [
          "## Recent conversation",
          messages
            .slice(-8)
            .map(
              (message) =>
                `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`
            )
            .join("\n\n"),
        ].join("\n\n")
      : ["## Current assignment", description].join("\n\n");

  return [
    systemPrompt?.trim()
      ? `## Role instructions\n\n${systemPrompt.trim()}`
      : "",
    `## CommonOS runtime\n\n${runtimeContext}`,
    orchestrationContext?.trim() ?? "",
    conversation,
  ]
    .filter(Boolean)
    .join("\n\n");
}
