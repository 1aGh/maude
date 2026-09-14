/** One project-index request at a time, with automatic transient recovery. */
export function createIndexLoader<T>({
  read,
  apply,
  onError,
  retryDelayMs = 500,
  maxRetryDelayMs = 5000,
  timeoutMs = 10000,
}: {
  read: (signal: AbortSignal) => Promise<T>;
  apply: (value: T) => void;
  onError: (error: unknown) => void;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  timeoutMs?: number;
}) {
  let disposed = false;
  let dirty = false;
  let failures = 0;
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
      const timeout = setTimeout(() => current.abort(), timeoutMs);
      try {
        const value = await read(current.signal);
        // A mutation/refresh requested a newer index during this read. Do not
        // briefly restore the older tree; the next request serves all waiters.
        if (!disposed && !dirty) apply(value);
        failures = 0;
      } catch (error) {
        if (disposed) return;
        onError(error);
        const status = (error as { status?: number } | null)?.status;
        if (status == null || status === 408 || status === 429 || status >= 500) {
          const delay = Math.min(maxRetryDelayMs, retryDelayMs * 2 ** Math.min(failures++, 10));
          retryTimer = setTimeout(() => { void reload(); }, delay);
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
