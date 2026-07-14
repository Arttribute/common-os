export type MessageDeltaStreamOptions = {
  flushIntervalMs?: number;
  maxChunkLength?: number;
  onError?: (error: unknown) => void;
};

export function createMessageDeltaStream(
  post: (delta: string) => Promise<void>,
  options: MessageDeltaStreamOptions = {}
): {
  emit: (delta: string) => Promise<void>;
  flush: () => Promise<void>;
  emittedLength: () => number;
} {
  const flushIntervalMs = options.flushIntervalMs ?? 100;
  const maxChunkLength = options.maxChunkLength ?? 400;
  let pending = "";
  let chain = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastQueuedAt = 0;
  let emitted = 0;

  function queuePending(): void {
    if (!pending) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const chunk = pending;
    pending = "";
    emitted += chunk.length;
    lastQueuedAt = Date.now();
    chain = chain.then(() => post(chunk)).catch((error) => {
      options.onError?.(error);
    });
  }

  function scheduleFlush(): void {
    if (timer) return;
    const elapsed = Date.now() - lastQueuedAt;
    timer = setTimeout(() => {
      timer = null;
      queuePending();
    }, Math.max(0, flushIntervalMs - elapsed));
  }

  async function emit(delta: string): Promise<void> {
    if (!delta) return;
    pending += delta;

    // Queue the first visible text immediately. Later text is coalesced, but
    // model stream consumption never waits for control-plane persistence.
    if (emitted === 0 || pending.length >= maxChunkLength) {
      queuePending();
    } else {
      scheduleFlush();
    }
  }

  async function flush(): Promise<void> {
    queuePending();
    await chain;
  }

  return { emit, flush, emittedLength: () => emitted + pending.length };
}
