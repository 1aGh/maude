// S5.18 (G10, 03 `ai-not-ready`) — the `ai-connected` gate's fact, signed-in aware.
//
// The outbox gate used to read `probeAcpAvailability().available`, which is true the moment `claude` is
// INSTALLED — before anyone signed in. A signed-out Mac therefore looked connected: the first prompt skipped
// the queue, started a run, the bridge failed on its first call, and the typed words were gone (the outbox
// stayed empty). The panel's own answer (`GET /_api/acp/status` → `probeAcpAvailabilityAuthed`) already knew
// better; this makes the queue ask the same question.
//
// The gate facts are SYNC (the drain reads them every pass), the sign-in check spawns `claude auth status`.
// So the fact is a small cache: `ensure()` is what the chat awaits before it decides "send now or keep"
// (a fresh answer is never re-asked within the ttl), `read()` is what the drain reads (the last answer, and it
// starts a refresh when the answer is stale), `note()` takes the answer a status probe already got, and the
// first time the answer turns true `onOpen` runs — the drain wakes and releases the prompts kept for it.

export interface ConnectedFactDeps {
  /** the full, signed-in-aware probe (`probeAcpAvailabilityAuthed`) */
  probe: () => Promise<{ available: boolean }>;
  /** the cheap answer used until the first full one lands (`probeAcpAvailability`) */
  sync: () => boolean;
  /** the answer turned from "not connected" to "connected" */
  onOpen?: () => void;
  /** how long a "connected" answer is trusted */
  openTtlMs?: number;
  /** how long a "not connected" answer is trusted (shorter: the user is signing in right now) */
  closedTtlMs?: number;
  now?: () => number;
}

export function createConnectedFact(deps: ConnectedFactDeps) {
  const now = deps.now ?? Date.now;
  const openTtl = deps.openTtlMs ?? 30_000;
  const closedTtl = deps.closedTtlMs ?? 2_000;
  let value: boolean | null = null;
  let at = 0;
  let inflight: Promise<boolean> | null = null;

  const fresh = () => value !== null && now() - at < (value ? openTtl : closedTtl);

  function set(next: boolean): boolean {
    const opened = next && value === false;
    value = next;
    at = now();
    if (opened) {
      try {
        deps.onOpen?.();
      } catch {
        /* a wake that throws must not take the answer with it */
      }
    }
    return next;
  }

  /** Ask the full probe (or take the fresh cached answer). Never throws: a probe that fails is "not connected". */
  function ensure(): Promise<boolean> {
    if (fresh()) return Promise.resolve(value === true);
    if (inflight) return inflight;
    inflight = deps
      .probe()
      .then((r) => set(r.available === true))
      .catch(() => set(false))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return {
    ensure,
    /** `ensure()` unless the answer is fresh: then null, so a caller that must stay synchronous can skip the wait. */
    pending: (): Promise<boolean> | null => (fresh() ? null : ensure()),
    /** The last answer (the sync fallback before the first one); a stale answer starts a refresh. */
    read(): boolean {
      if (!fresh()) void ensure();
      return value ?? deps.sync();
    },
    /** An answer somebody else already got (the status route, the preflight). */
    note(available: boolean): void {
      set(available === true);
    },
  };
}

export type ConnectedFact = ReturnType<typeof createConnectedFact>;
