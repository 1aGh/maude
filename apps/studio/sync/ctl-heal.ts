// Poke → `fs:any` → the existing HMR heal — Sync v2 Increment 2 (DDR-226 §6).
//
// This is the last hop of the fix, and it deliberately adds no new UI path: the
// studio already knows how to repoint a broken `<img>` when a media file lands
// (`canvas-hmr {mode:'asset'}`, DDR-224) and how to hot-swap a stylesheet. All
// that was ever missing in a container was the EVENT — `fs.watch` does not fire
// for the hub process's atomic tmp+rename writes, so the child never learned.
//
// So: the hub pokes, this asks the journal WHICH paths moved, and emits the
// `fs:any` the watcher owed us. Everything downstream is unchanged.
//
// WHY IT ASKS INSTEAD OF BEING TOLD. The poke carries a head and nothing else,
// on purpose (DDR-054 — a frame carrying a path would be a path the hub chose).
// The journal read is authenticated and scope-filtered, its rows are re-shaped
// on arrival (`journal-client.ts`), and this only ever emits a bus event for a
// path — it materializes nothing. A hostile hub's best case here is making the
// child re-read files it already has.
//
// A LOST POKE COSTS LATENCY, NEVER CORRECTNESS. The cursor only ever moves
// forward on a page we actually parsed, and the 20 s reconciler poll is still
// underneath. If the channel is down for an hour, the heal is late by an hour;
// nothing diverges.

import { fetchJournal } from './journal-client.ts';

/** Coalesce a burst of pokes into one journal read. */
const READ_DEBOUNCE_MS = 150;

/** Paths whose last announced bytes are remembered (bounded, oldest out first). */
const ANNOUNCED_MEMO_CAP = 4096;

/** The "skipped a repeat" line is printed at most this often. */
const REPEAT_LOG_MS = 60_000;

export interface CtlHealerOptions {
  hubUrl: string;
  token: string;
  /** Emit the `fs:any` the container's watcher failed to (one per path). */
  emit: (rel: string) => void;
  fetchImpl?: typeof fetch;
  log?: Pick<Console, 'log' | 'warn'>;
  debounceMs?: number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  /** Clock for the repeat-log throttle (tests). */
  now?: () => number;
}

export interface CtlHealer {
  /** A poke arrived. `head` is the hub's hint; the journal is the answer. */
  onPoke(head: number): void;
  /**
   * Set the baseline from the hub's CURRENT head, replaying nothing.
   *
   * Without this the cursor is adopted from the FIRST POKE — and the hub pokes
   * only when the journal appends, so that first poke IS a change this child
   * has not seen. Adopting its head as the baseline therefore swallowed exactly
   * one change per boot: the first asset a peer delivered after a cell started
   * never healed an open canvas, and looked like the channel was dead. Called
   * once at attach; a failure is harmless (the first poke still anchors, as
   * before).
   */
  anchor(): Promise<void>;
  /** Read now (tests; boot). Resolves once the pass is done. */
  drain(): Promise<void>;
  stop(): void;
  /** Paths announced so far — the receiver half of the honesty counters. */
  healed(): number;
  /** Pokes whose head was at or below the cursor: pure noise, and expected. */
  ignored(): number;
  /** Rows skipped because their path was already announced at those bytes. */
  repeats(): number;
}

/**
 * Turn pokes into heal events.
 *
 * The cursor starts at the FIRST head we are told about rather than at 0. A
 * child that has just booted has already read the checkout from disk — every
 * row before now describes a file it can already see, so replaying them would
 * be a reload storm on every cell wake for zero benefit. What matters is
 * everything AFTER the child started looking.
 */
export function createCtlHealer(opts: CtlHealerOptions): CtlHealer {
  const log = opts.log ?? console;
  const debounceMs = opts.debounceMs ?? READ_DEBOUNCE_MS;
  const setTimeoutImpl = opts.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = opts.clearTimeoutImpl ?? clearTimeout;

  let cursor: number | null = null;
  let epoch: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let healed = 0;
  let ignored = 0;
  /**
   * The bytes each path was last announced at — ONE ANNOUNCEMENT PER STATE.
   *
   * A heal tells the canvas layer "this file is different now". A row naming
   * the bytes we already announced for that path says nothing new, and
   * re-announcing it re-runs every `fs:any` consumer (index rebuilds, HMR,
   * canvas rescans) for a file that did not change. A path stuck in a loop
   * upstream then spins every open canvas with it; this caps the cost at one
   * announcement per distinct version. A tombstone or a row with no hash
   * forgets the path, so the next real arrival is always announced.
   */
  const announcedAt = new Map<string, string>();
  let repeats = 0;
  let repeatLoggedAt = Number.NEGATIVE_INFINITY;
  const now = opts.now ?? Date.now;
  /**
   * Is there anything to read?
   *
   * Without this, `drain()` would fire a request every time it is called even
   * when nothing has moved — which on a quiet project is a poll we did not ask
   * for, against a route that is rate-limited. Only `schedule()` sets it, and
   * only a completed read clears it.
   */
  let dirty = false;

  async function readOnce(): Promise<void> {
    if (stopped || cursor === null || !dirty) return;
    dirty = false;
    const page = await fetchJournal({
      hubUrl: opts.hubUrl,
      token: opts.token,
      since: cursor,
      epoch,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    // Unreachable / refused / unparseable — ask again on the next poke or the
    // next poll. Never advance the cursor on a page we did not read, and stay
    // dirty so the retry actually retries rather than short-circuiting.
    if (page === null) {
      dirty = true;
      return;
    }

    if (page.reanchor) {
      // The log no longer contains our cursor (an epoch rotation, or a
      // compaction past it). For the HEAL path specifically there is nothing to
      // replay — the child re-reads the tree from disk on demand anyway — so
      // the honest move is to jump to the new head and say so, rather than
      // pretend a page arrived.
      log.warn?.(
        `[sync/ctl] the hub asked us to re-anchor (${page.reason ?? 'cursor not in this log'}); heal cursor moves to ${page.head}.`
      );
      cursor = page.head;
      epoch = page.epoch;
      return;
    }

    epoch = page.epoch;
    // WHAT THIS PASS ACTUALLY ANNOUNCED. The counters exist but nothing reads
    // them, so "the poke arrived but the canvas never repainted" was a question
    // with no evidence on either side of it. One line per non-empty pass, named
    // paths, capped — the receiving half of the "N poke(s) folded" line the
    // sender already prints.
    const announced: string[] = [];
    // The LAST row per path is the path's state after this page; earlier rows
    // for the same path are history the disk no longer shows.
    const latest = new Map<string, (typeof page.entries)[number]>();
    for (const entry of page.entries) {
      latest.delete(entry.path);
      latest.set(entry.path, entry);
      // A deletion inside the page still happened: what follows it is news.
      if (entry.deleted || entry.sha256 === null) announcedAt.delete(entry.path);
    }
    let repeated = 0;
    for (const entry of latest.values()) {
      // A tombstone is not a heal — Increment 6 owns deletion, and emitting
      // `fs:any` for a vanished path would make the canvas layer look for a
      // file that is deliberately gone.
      if (entry.deleted) continue;
      if (entry.sha256 !== null && announcedAt.get(entry.path) === entry.sha256) {
        repeated += 1;
        continue;
      }
      try {
        opts.emit(entry.path);
        healed += 1;
        announced.push(entry.path);
        announcedAt.delete(entry.path);
        if (entry.sha256 !== null) {
          announcedAt.set(entry.path, entry.sha256);
          if (announcedAt.size > ANNOUNCED_MEMO_CAP) {
            const oldest = announcedAt.keys().next().value;
            if (oldest !== undefined) announcedAt.delete(oldest);
          }
        }
      } catch (err) {
        log.warn?.(`[sync/ctl] heal emit failed for ${entry.path}: ${(err as Error).message}`);
      }
    }
    if (repeated > 0) {
      repeats += repeated;
      const at = now();
      if (at - repeatLoggedAt >= REPEAT_LOG_MS) {
        repeatLoggedAt = at;
        log.log?.(
          `[sync/ctl] ${repeats} journal row(s) named a file at bytes already healed — not announced again.`
        );
      }
    }
    if (announced.length > 0) {
      const shown = announced.slice(0, 5).join(', ');
      log.log?.(
        `[sync/ctl] healed ${announced.length} path(s) from the journal: ${shown}${
          announced.length > 5 ? `, +${announced.length - 5} more` : ''
        }`
      );
    }
    // Advance only over what we actually consumed. `truncated` means the next
    // pass has more, and the poke that follows (or the next drain) takes it.
    const last = page.entries.at(-1);
    cursor = last ? last.seq : page.head;
    if (page.truncated) schedule();
  }

  function schedule(): void {
    if (stopped) return;
    dirty = true;
    if (timer !== null) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      void drain();
    }, debounceMs);
    timer.unref?.();
  }

  async function drain(): Promise<void> {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        await readOnce();
      } finally {
        inFlight = null;
        if (again) {
          again = false;
          void drain();
        }
      }
    })();
    return inFlight;
  }

  return {
    async anchor(): Promise<void> {
      if (stopped || cursor !== null) return;
      const page = await fetchJournal({
        hubUrl: opts.hubUrl,
        token: opts.token,
        since: 0,
        epoch: null,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
      // Unreachable → stay unanchored; `onPoke` still has the old fallback.
      if (page === null || cursor !== null) return;
      cursor = page.head;
      epoch = page.epoch;
    },
    onPoke(head: number): void {
      if (stopped) return;
      // A HEAD BELOW THE CURSOR IS A QUESTION FOR THE JOURNAL, NOT NOISE.
      //
      // `reanchor` recovers from an epoch rotation, a compaction, or a
      // restore-from-backup — and every one of those moves the head BACKWARD,
      // which the "at or below the cursor is noise" rule below then swallowed.
      // The recovery path was therefore unreachable from precisely the states it
      // was written for, and a cursor parked above the log (an over-large head,
      // honest or not) left the healer permanently deaf.
      //
      // We do NOT move the cursor here — a coalesced or reordered frame can
      // carry a stale head, and trusting it would rewind a healthy cursor on the
      // hub's say-so. We only ASK: `GET /api/journal` answers `reanchor` when
      // `since > head` (its own rule), and the branch in `readOnce` then takes
      // the new head and epoch from a page we actually read.
      if (cursor !== null && Number.isFinite(head) && head < cursor) {
        schedule();
        return;
      }
      if (cursor === null) {
        // First contact: adopt the hub's head as the baseline. Everything
        // before it is already on disk and already rendered.
        cursor = head;
        return;
      }
      if (head <= cursor) {
        ignored += 1;
        return;
      }
      schedule();
    },
    drain,
    stop(): void {
      stopped = true;
      if (timer !== null) {
        clearTimeoutImpl(timer);
        timer = null;
      }
    },
    healed: () => healed,
    ignored: () => ignored,
    repeats: () => repeats,
  };
}
