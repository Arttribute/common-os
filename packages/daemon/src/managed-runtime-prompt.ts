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

const ENRICHED_CONTEXT_START =
  /\n+## (?:Relevant Memories|Shared Team Memory|Agent skills|Uploaded Files)\b/i;

function historicalMessageContent(message: ManagedRuntimeMessage): string {
  if (message.role === "assistant") return message.content;
  return message.content.split(ENRICHED_CONTEXT_START, 1)[0].trim();
}

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

  const priorConversation = (messages ?? [])
    // CommonOS history includes the current enriched instruction as its last
    // item. The current description below is the canonical copy.
    .slice(0, -1)
    .slice(-7)
    .map(
      (message) =>
        `${message.role === "assistant" ? "Assistant" : "User"}: ${historicalMessageContent(message)}`
    )
    .join("\n\n");

  const conversation = [
    priorConversation ? `## Recent conversation\n\n${priorConversation}` : "",
    `## Current assignment\n\n${description}`,
  ]
    .filter(Boolean)
    .join("\n\n");

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
