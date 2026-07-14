jest.mock("@kubernetes/client-node", () => ({}));
jest.mock("uuid", () => ({ v4: () => "test-session-id" }));

import { keepsMessagingRuntimeWarm } from "./computer-reconciler";

describe("computer reconciler runtime policy", () => {
  it("keeps persistent messaging runtimes warm", () => {
    expect(keepsMessagingRuntimeWarm("openclaw")).toBe(true);
    expect(keepsMessagingRuntimeWarm("hermes")).toBe(true);
    expect(keepsMessagingRuntimeWarm("native")).toBe(false);
    expect(keepsMessagingRuntimeWarm("guest")).toBe(false);
  });
});
