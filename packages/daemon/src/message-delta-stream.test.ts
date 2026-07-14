/// <reference types="jest" />

import { createMessageDeltaStream } from "./message-delta-stream";

describe("createMessageDeltaStream", () => {
  it("does not block emit while an event post is in flight", async () => {
    let release: (() => void) | undefined;
    const posted: string[] = [];
    let firstPost = true;
    const stream = createMessageDeltaStream(
      (delta) => {
        posted.push(delta);
        if (!firstPost) return Promise.resolve();
        firstPost = false;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      { flushIntervalMs: 10_000 }
    );

    await stream.emit("hello");
    await stream.emit(" world");

    expect(posted).toEqual(["hello"]);
    expect(stream.emittedLength()).toBe(11);
    release?.();
    await stream.flush();
    expect(posted).toEqual(["hello", " world"]);
  });

  it("coalesces pending text and preserves order on flush", async () => {
    const posted: string[] = [];
    const stream = createMessageDeltaStream(async (delta) => {
      posted.push(delta);
    }, { flushIntervalMs: 10_000 });

    await stream.emit("a");
    await stream.emit("b");
    await stream.emit("c");
    await stream.flush();

    expect(posted).toEqual(["a", "bc"]);
  });

  it("continues after a failed event post", async () => {
    const posted: string[] = [];
    let attempts = 0;
    const stream = createMessageDeltaStream(async (delta) => {
      attempts += 1;
      if (attempts === 1) throw new Error("unavailable");
      posted.push(delta);
    }, { flushIntervalMs: 10_000 });

    await stream.emit("first");
    await stream.emit("second");
    await stream.flush();

    expect(posted).toEqual(["second"]);
  });
});
