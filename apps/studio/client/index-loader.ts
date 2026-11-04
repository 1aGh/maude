/** One project-index request at a time, with automatic transient recovery. */
export function createIndexLoader<T>({
  read,
  apply,
  onError,
  retryDelayMs = 500,
  maxRetryDelayMs = 5000,
  timeoutMs = 10000,
  maxTimeoutMs = 120000,
}: {
  read: (signal: AbortSignal) => Promise<T>;
  apply: (value: T) => void;
  onError: (error: unknown) => void;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  timeoutMs?: number;
  maxTimeoutMs?: number;
}) {
  let disposed = false;
  let dirty = false;
  let failures = 0;
  // #204 — a large index on a small cell answered after the fixed timeout, so it was aborted and
  // asked again forever (each retry another full build on the server). Each timeout in a row
  // doubles the next one's patience, up to `maxTimeoutMs`; any answer resets it.
  let timeoutsInARow = 0;
  // #204 — nothing drawn yet: the first answer is drawn even if a refresh is already queued behind
  // it (a materialising project asks for one per arriving file, so "only the freshest" was never).
  let appliedOnce = false;
  let pending: Promise<void> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const cancelRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };
  async function drain() {
    while (dirty && !disposed) {
      dirty = false;
      cancelRetry();
      const current = new AbortController();
      controller = current;
      let timedOut = false;
      const patience = Math.min(maxTimeoutMs, timeoutMs * 2 ** Math.min(timeoutsInARow, 10));
      const timeout = setTimeout(() => {
        timedOut = true;
        current.abort();
      }, patience);
      try {
        const value = await read(current.signal);
        timeoutsInARow = 0;
        // A mutation/refresh requested a newer index during this read. Do not
        // briefly restore the older tree; the next request serves all waiters —
        // unless there is no tree at all yet (#204): then this one is drawn.
        if (!disposed && (!dirty || !appliedOnce)) {
          apply(value);
          appliedOnce = true;
        }
        failures = 0;
      } catch (error) {
        if (disposed) return;
        if (timedOut) timeoutsInARow++;
        onError(error);
        const status = (error as { status?: number } | null)?.status;
        if (status == null || status === 408 || status === 429 || status >= 500) {
          const delay = Math.min(maxRetryDelayMs, retryDelayMs * 2 ** Math.min(failures++, 10));
          retryTimer = setTimeout(() => {
            void reload();
          }, delay);
        }
      } finally {
        clearTimeout(timeout);
        if (controller === current) controller = undefined;
      }
    }
  }
  function reload(): Promise<void> {
    if (disposed) return Promise.resolve();
    dirty = true;
    cancelRetry();
    if (!pending) {
      pending = drain().finally(() => {
        pending = null;
        // Cover a reload requested between drain's return and this microtask.
        if (dirty && !disposed) return reload();
      });
    }
    return pending;
  }
  return {
    reload,
    dispose() {
      disposed = true;
      dirty = false;
      cancelRetry();
      controller?.abort();
    },
  };
}
