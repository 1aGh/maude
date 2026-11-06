/**
 * One project-index request at a time, with automatic recovery from a real error.
 *
 * #207 — a request that is still pending is never aborted and never asked again: the server keeps
 * every request for the index on ONE build (index-cache.ts), so a client timeout only threw the
 * answer away and showed "taking a while — trying again…" on a project whose files are all local
 * (StudyFi: 13 s per build, a 10 s client timeout). Only a failed request (an error status, a
 * dropped connection) is retried, with a backoff.
 *
 * A previous run's copy (`isStale`) is drawn at once and then asked for again with `fresh`, which
 * the server answers once its own build is done.
 */
export function createIndexLoader<T>({
  read,
  apply,
  onError,
  isStale,
  retryDelayMs = 500,
  maxRetryDelayMs = 5000,
  staleRetryMs = 250,
  maxStaleRetryMs = 2000,
}: {
  read: (signal: AbortSignal, opts: { fresh: boolean }) => Promise<T>;
  apply: (value: T) => void;
  onError: (error: unknown) => void;
  /** The answer is a previous run's copy: draw it, then ask for a fresh one. */
  isStale?: (value: T) => boolean;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  staleRetryMs?: number;
  maxStaleRetryMs?: number;
}) {
  let disposed = false;
  let dirty = false;
  let failures = 0;
  // A fresh answer is owed (the last one drawn was a copy); how many copies in a row.
  let wantFresh = false;
  let staleInARow = 0;
  // #204 — nothing drawn yet: the first answer is drawn even if a refresh is already queued behind
  // it (a materialising project asks for one per arriving file, so "only the freshest" was never).
  let appliedOnce = false;
  let appliedReal = false;
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
      try {
        const value = await read(current.signal, { fresh: wantFresh });
        const stale = isStale?.(value) === true;
        // A mutation/refresh requested a newer index during this read. Do not
        // briefly restore the older tree; the next request serves all waiters —
        // unless there is no tree at all yet (#204): then this one is drawn.
        if (!disposed && (!dirty || !appliedOnce)) {
          // A copy never replaces a real answer already drawn.
          if (!(stale && appliedReal)) apply(value);
          appliedOnce = true;
          if (!stale) appliedReal = true;
        }
        failures = 0;
        if (stale && !disposed) {
          // Ask again for the real one. A server that honours `fresh` answers once its build is
          // done; one that does not (an older server) is asked again with a backoff.
          wantFresh = true;
          const delay = Math.min(maxStaleRetryMs, staleRetryMs * 2 ** Math.min(staleInARow++, 10));
          retryTimer = setTimeout(() => {
            void reload();
          }, delay);
        } else {
          wantFresh = false;
          staleInARow = 0;
        }
      } catch (error) {
        if (disposed) return;
        onError(error);
        const status = (error as { status?: number } | null)?.status;
        if (status == null || status === 408 || status === 429 || status >= 500) {
          const delay = Math.min(maxRetryDelayMs, retryDelayMs * 2 ** Math.min(failures++, 10));
          retryTimer = setTimeout(() => {
            void reload();
          }, delay);
        }
      } finally {
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
