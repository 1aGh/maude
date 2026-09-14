// A bounded metadata read queue. File walks/uploads have their own scheduler.
// A notification during a read requires another read: the first response may
// already describe the old head. Keep one pending pass, never an unbounded queue.
export function createDocumentDiscovery(opts: {
  run: () => Promise<void>;
  onError: (error: unknown) => void;
  delayMs?: number;
  minIntervalMs?: number;
  now?: () => number;
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? setTimeout;
  const clearTimer = opts.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let stopped = false;
  let lastStarted = -Infinity;
  let waiters: Array<() => void> = [];

  function arm(immediate = false) {
    if (stopped || running || timer !== null || !pending) return;
    const delay = Math.max(
      immediate ? 0 : (opts.delayMs ?? 50),
      (opts.minIntervalMs ?? 250) - (now() - lastStarted)
    );
    timer = setTimer(() => {
      timer = null;
      void drain();
    }, delay);
    timer.unref?.();
  }

  async function drain() {
    if (stopped || running || !pending) return;
    running = true;
    pending = false;
    lastStarted = now();
    const currentWaiters = waiters;
    waiters = [];
    try {
      await opts.run();
    } catch (error) {
      opts.onError(error);
    } finally {
      running = false;
      for (const resolve of currentWaiters) resolve();
      arm();
    }
  }

  return {
    schedule() {
      if (!stopped) {
        pending = true;
        arm();
      }
    },
    flush(): Promise<void> {
      if (stopped) return Promise.resolve();
      pending = true;
      const done = new Promise<void>((resolve) => waiters.push(resolve));
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      arm(true);
      return done;
    },
    stop() {
      stopped = true;
      pending = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
      for (const resolve of waiters) resolve();
      waiters = [];
    },
  };
}
