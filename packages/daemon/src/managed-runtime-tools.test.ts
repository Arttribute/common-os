/// <reference types="jest" />

import { selectManagedRuntimeToolNames } from "./managed-runtime-tools";

describe("selectManagedRuntimeToolNames", () => {
  it("does not duplicate native runtime tools for conversation", () => {
    expect(
      selectManagedRuntimeToolNames("Reply with exactly: pong")
    ).toEqual([]);
  });

  it("binds the Agent Commons bridge when skills are available", () => {
    expect(
      selectManagedRuntimeToolNames(
        "Draft a reply\n\n## Agent skills\n- release-check"
      )
    ).toEqual([
      "cli_agent_commons_list_tools",
      "cli_agent_commons_call_tool",
    ]);
  });

  it("binds wallet tools only for a wallet request", () => {
    expect(selectManagedRuntimeToolNames("Check my wallet balance")).toEqual([
      "cli_wallet_address",
      "cli_wallet_balance",
      "cli_wallet_send_transaction",
    ]);
  });

  it("ignores enriched memory text when selecting sensitive tools", () => {
    expect(
      selectManagedRuntimeToolNames(
        "Say hello\n\n## Relevant Memories\nThe user sent ETH yesterday"
      )
    ).toEqual([]);
  });
});
