// The change signal — hub → its own cell's Durable Object (2026-10-05, "an
// idle desktop lets its cloud cell sleep").
//
// A parked desktop has closed its sockets and its poll so the cell can sleep.
// It still has to learn when ANOTHER member changed something, and it learns
// that from `GET /_cell/state`, which the DO answers by itself — never through
// the container, so asking never wakes or warms the cell. For the DO to know
// "something changed", the hub has to tell it.
//
// PUSH, NEVER PULL. A DO that asked the hub (`/health`, a journal head) would
// go through `containerFetch` and renew the very timer the park exists to let
// run out — the loop render had to escape. So the hub pushes, on the outbound
// route the container already uses for its project store
// (`http://project-store.internal`, DDR-241): the tenant is fixed by the DO the
// runtime routes the request to, never by anything the container says.
//
// NEVER ON THE WRITE PATH. `note()` returns at once and never throws; a send
// that fails is retried a bounded number of times and then dropped. A missed
// signal costs a parked desktop latency (it resyncs on its next local edit, or
// on the 6 h backstop), never data.
//
// A self-hosted hub has no store URL and never sleeps: everything here is a
// no-op there.

/** Path on the project-store host. Not a store method — the DO answers it. */
export const CHANGE_SIGNAL_PATH = '/cell/changed';
/** At most one signal per this window; a burst of edits is one send. */
export const CHANGE_SIGNAL_MIN_MS = 10_000;
/** Retries after a failed send, then give up until the next change. */
const RETRY_DELAYS_MS = [2_000, 10_000];

/**
 * @param {object} opts
 * @param {string | null | undefined} opts.url  `MAUDE_PROJECT_STORE_URL`, or nothing
 * @param {string | null} [opts.token]
 */
export function createCellChangeSignal({
  url,
  token = null,
  fetchImpl = fetch,
  minIntervalMs = CHANGE_SIGNAL_MIN_MS,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  log = console,
} = {}) {
  const base = url ? String(url).replace(/\/+$/, '') : null;
  let lastSentAt = -Infinity;
  let timer = null;
  let inFlight = false;
  let dirty = false;
  let stopped = false;
  let sent = 0;
  let failed = 0;

  const arm = (ms, fn) => {
    timer = setTimeoutImpl(() => {
      timer = null;
      fn();
    }, ms);
    timer?.unref?.();
  };

  const send = async (attempt = 0) => {
    if (stopped || !base) return;
    inFlight = true;
    dirty = false;
    lastSentAt = now();
    let ok = false;
    try {
      const res = await fetchImpl(`${base}${CHANGE_SIGNAL_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: '{}',
        signal: AbortSignal.timeout(5_000),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    inFlight = false;
    if (ok) {
      sent += 1;
    } else if (attempt < RETRY_DELAYS_MS.length && !stopped) {
      dirty = true;
      if (timer === null) arm(RETRY_DELAYS_MS[attempt], () => void send(attempt + 1));
      return;
    } else {
      failed += 1;
      if (failed === 1) {
        log.warn?.(
          '[hub] could not tell the cell a change landed — a parked desktop learns of it on its next edit instead.'
        );
      }
    }
    // A change that arrived while this one was out still has to be said.
    if (dirty && timer === null && !stopped) schedule();
  };

  const schedule = () => {
    const wait = Math.max(0, lastSentAt + minIntervalMs - now());
    if (wait === 0 && !inFlight) {
      void send();
      return;
    }
    if (timer === null && !inFlight) arm(wait, () => void send());
  };

  return {
    /** An accepted content change happened. Never blocks, never throws. */
    note() {
      if (stopped || !base) return;
      dirty = true;
      if (timer !== null || inFlight) return;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeoutImpl(timer);
        timer = null;
      }
    },
    enabled: () => base !== null,
    sent: () => sent,
    failed: () => failed,
  };
}
