const AGENT_COMMONS_TOOLS = [
  "cli_agent_commons_list_tools",
  "cli_agent_commons_call_tool",
];
const WALLET_TOOLS = [
  "cli_wallet_address",
  "cli_wallet_balance",
  "cli_wallet_send_transaction",
];
const CHANNEL_TOOLS = ["cli_send_channel_message"];

export function selectManagedRuntimeToolNames(description: string): string[] {
  const currentRequest = description
    .split(
      /\n+## (?:Relevant Memories|Shared Team Memory|Agent skills|Uploaded Files)\b/i,
      1
    )[0]
    .trim();
  const selected = new Set<string>();

  // OpenClaw and Hermes already expose native browser, terminal, filesystem,
  // web, memory, and channel tools. Bind only capabilities that live in the
  // CommonOS/Agent Commons bridge so ordinary chat avoids duplicate schemas.
  if (
    /## Agent skills\b/i.test(description) ||
    /\b(?:agent commons tool|connected tool|mcp tool|invoke[_ -]?skill|use (?:a|the) skill)\b/i.test(
      currentRequest
    )
  ) {
    AGENT_COMMONS_TOOLS.forEach((name) => selected.add(name));
  }
  if (
    /\b(?:x|twitter|tweet|post|repost|retweet)\b/i.test(currentRequest) &&
    /\b(?:read|search|find|publish|post|reply|quote|delete|remove|who\s+am\s+i|profile)\b/i.test(
      currentRequest
    )
  ) {
    // X is an Agent Commons OAuth connector rather than a runtime channel.
    // Both OpenClaw and Hermes reach the same explicitly assigned tools via
    // the managed bridge, so account tokens never need to enter their pods.
    AGENT_COMMONS_TOOLS.forEach((name) => selected.add(name));
  }
  if (
    /\b(?:wallet|wallet address|balance|payment|transaction|crypto|eth|ethereum|wei)\b/i.test(
      currentRequest
    ) ||
    /\b(?:send|transfer|pay)\s+(?:[\d.]+\s*)?(?:money|funds|crypto|eth|ethereum)\b/i.test(
      currentRequest
    )
  ) {
    WALLET_TOOLS.forEach((name) => selected.add(name));
  }
  if (
    /\b(?:axl|fleet message|message another agent|contact another agent|ask another agent)\b/i.test(
      currentRequest
    )
  ) {
    selected.add("cli_send_axl_message");
  }
  if (
    /\b(?:telegram|whats ?app|discord|slack)\b/i.test(currentRequest) &&
    /\b(?:send|say|message|text|notify|post|ping|dm)\b/i.test(currentRequest)
  ) {
    CHANNEL_TOOLS.forEach((name) => selected.add(name));
  }

  return [...selected];
}
