// "Changes" — how much work happened here, per day. Counts only.
//
// THE CONTRACT (read by the control plane from `/health` `stats`, and by this
// hub's own Overview — the field names are fixed):
//
//   changesByDay  [{ day: 'YYYY-MM-DD', count: <integer> }]
//                 the last CHANGE_DAYS UTC days, oldest first, every day
//                 present (a quiet day is `count: 0`)
//   changesWeek   <integer> — the last seven of those days, summed
//
// SOURCES OF TRUTH — two, because a canvas is saved one of two ways:
//
//   the file journal (journal.mjs). One row = one change, on the row's own
//   timestamp: an accepted write (or delete) by a PERSON to a canvas, its
//   board or its meta file (`PEOPLE_SOURCES`). The server's housekeeping —
//   walks, boot scans, refills, replays, quarantines — is not counted, and
//   neither are media or configuration files.
//
//   accepted revisions (DDR-241 — the project store: `project-store.sqlite`
//   on a team server, the cell's Durable Object in the cloud). A project in
//   format 2 saves every canvas edit as an ACTION there and writes NO journal
//   row for it, so the journal alone reads zero for the normal way a canvas
//   is edited (found end to end, cloud harness C6, 2026-11-25). One action
//   with at least one effect = one change, on its `committedAt`; the store's
//   own migration import, version names and comments are not changes.
//
//   live sync (the Yjs document path) on a project that does NOT save
//   through accepted revisions. The edit is a document update; the file the
//   hub then writes is recorded by its own walk, not by a person's source. So
//   it is counted where every such edit passes exactly once — the debounced
//   STORE of the document (`countSyncedChange`, a per-day counter on disk).
//   One flush = one change: a burst of keystrokes is one, not hundreds.
//
// No edit is recorded by two of them (in accepted revisions the documents are
// read-only and nothing is counted at the store hook), so a day's count is
// their sum.
//
// THREE-VALUED, like the rest of `stats` (tenant-stats.mjs): with no journal
// the fields are OMITTED. A zero says "nobody did anything"; an absent field
// says "this hub cannot tell" — an operator must be able to see the difference.
//
// COUNTS ONLY. No path, no name, no source, no address.
//
// CHEAP. One range scan over the journal's `at_ms` index, bounded to the
// window, and the answer is reused for a minute: `/health` is polled.

import { syncedChangeDays } from './audit-log.mjs';

/** How many UTC days the series covers. */
export const CHANGE_DAYS = 30;
/** How long an answer is reused. */
export const CHANGE_STATS_TTL_MS = 60_000;

const DAY_MS = 86_400_000;

/** One cached answer per journal handle. */
const cache = new WeakMap();
let generation = 0;

/** Test seam. */
export function _resetChangeStats() {
  generation += 1;
}

const dayName = (dayNumber) => new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);

/** The contract's two fields from a `UTC day number → count` map. */
function seriesOf(byDay, now) {
  const today = Math.floor(now / DAY_MS);
  const changesByDay = [];
  for (let d = today - (CHANGE_DAYS - 1); d <= today; d++) {
    changesByDay.push({ day: dayName(d), count: byDay.get(d) ?? 0 });
  }
  return {
    changesByDay,
    changesWeek: changesByDay.slice(-7).reduce((n, d) => n + d.count, 0),
  };
}

/**
 * @param {{ changeCounts: (sinceMs: number, untilMs: number) => Array<{day: number, n: number}> } | null} journal
 * @returns {{ changesByDay: Array<{day: string, count: number}>, changesWeek: number } | null}
 *   null when there is no journal, or when it cannot be read.
 */
export function changeStats(journal, { now = Date.now() } = {}) {
  if (!journal || typeof journal.changeCounts !== 'function') return null;
  const hit = cache.get(journal);
  if (hit && hit.generation === generation && now >= hit.at && now - hit.at < CHANGE_STATS_TTL_MS) {
    return hit.value;
  }
  const today = Math.floor(now / DAY_MS);
  const first = today - (CHANGE_DAYS - 1);
  let rows;
  try {
    // [start of the first day, end of today): nothing older, nothing stamped in the future.
    rows = journal.changeCounts(first * DAY_MS, (today + 1) * DAY_MS);
  } catch {
    // Health must not fail because a count did; "cannot tell" is the honest answer.
    return null;
  }
  const value = seriesOf(new Map(rows.map((r) => [Number(r.day), Number(r.n) || 0])), now);
  cache.set(journal, { at: now, generation, value });
  return value;
}

// ------------------------------------------------------------- live sync

/** The synced-edit counter as the contract's series, or null when nothing was ever counted. */
export function syncedChangeStats(dataDir, { now = Date.now() } = {}) {
  if (!dataDir) return null;
  const first = Math.floor(now / DAY_MS) - (CHANGE_DAYS - 1);
  const rows = syncedChangeDays(dataDir, first);
  if (!rows) return null;
  return seriesOf(new Map(rows.map((r) => [Number(r.day), Number(r.n) || 0])), now);
}

// ------------------------------------------------------ accepted revisions

/** One page of `store.history` (its own ceiling). */
const HISTORY_PAGE = 200;
/** One page of `store.revisions` (its own ceiling). */
const REVISIONS_PAGE = 1000;
/** The first fill reads at most this many pages back (5 000 actions). */
const MAX_FILL_PAGES = 25;
/** A refresh reads at most this many pages of new revisions. */
const MAX_REFRESH_PAGES = 5;

/**
 * Is this logged action something a PERSON did to a canvas?
 *
 * Counted: any action that changed at least one document — an edit, an undo or
 * redo, a trash or restore, an AI run's edit (a person asked for it).
 * Not counted: the hub's own migration import (`origin.client: 'hub'`, the
 * migration actor, a `migration.*` kind), a version NAME and a COMMENT (neither
 * changes a canvas), and an action with no effect at all.
 */
function isPersonChange(a) {
  if (!a || !Array.isArray(a.effects) || a.effects.length === 0) return false;
  const kind = String(a.kind ?? '');
  if (kind === 'name' || kind === 'comment' || kind.startsWith('migration')) return false;
  if (a.actor === 'maude-migration' || a.origin?.client === 'hub') return false;
  return Number.isFinite(a.committedAt);
}

/**
 * Per-day counts of accepted actions, kept in memory and topped up.
 *
 * The store may be a Durable Object one RPC away, so this never asks it for
 * the month on every probe: the FIRST call reads history newest-first until it
 * leaves the window (or MAX_FILL_PAGES), every later one — at most once a
 * minute — asks `state()` for the head and reads only the revisions after the
 * last one it saw. Only three store methods are used, all of which a remote
 * home already serves (`store-remote.mjs` METHODS).
 *
 * `stats()` resolves to the contract's two fields, or `null` when this project
 * does not save through accepted revisions, or the store cannot be read —
 * "cannot tell", never a zero.
 */
export function createAcceptedChanges(store, { maxPages = MAX_FILL_PAGES } = {}) {
  const byDay = new Map();
  let lastRev = null; // null = not filled yet
  let checkedAt = Number.NEGATIVE_INFINITY;
  let value = null;
  let inFlight = null;
  let touches = 0;

  const add = (a, firstDay, lastDay) => {
    if (!isPersonChange(a)) return;
    const d = Math.floor(a.committedAt / DAY_MS);
    if (d < firstDay || d > lastDay) return;
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  };

  async function refresh(now) {
    const state = await store.state();
    if (state?.mode !== 'transactions') return null;
    const today = Math.floor(now / DAY_MS);
    const firstDay = today - (CHANGE_DAYS - 1);
    const head = Number(state.revision) || 0;
    if (lastRev === null) {
      // First fill: newest first, until the window is behind us.
      let before = null;
      for (let page = 0; page < maxPages; page++) {
        const rows = await store.history({ ...(before ? { before } : {}), limit: HISTORY_PAGE });
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const a of rows) add(a, firstDay, today);
        const oldest = rows[rows.length - 1];
        if (rows.length < HISTORY_PAGE || oldest.committedAt < firstDay * DAY_MS) break;
        before = oldest.revision;
      }
      lastRev = head;
    } else if (head > lastRev) {
      for (let page = 0; page < MAX_REFRESH_PAGES && lastRev < head; page++) {
        const rows = await store.revisions({ after: lastRev, limit: REVISIONS_PAGE });
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const a of rows) add(a, firstDay, today);
        lastRev = Math.max(lastRev, Number(rows[rows.length - 1].revision) || lastRev);
      }
      // Further behind than a refresh reads (a burst of thousands): carry on next minute.
    }
    for (const d of byDay.keys()) if (d < firstDay) byDay.delete(d);
    return seriesOf(byDay, now);
  }

  return {
    /**
     * A revision was just committed through this hub: the next read asks the
     * store again instead of waiting out the minute. This is what makes the
     * number EXACT rather than "as of whenever somebody first asked" — the
     * cache only ever spans a stretch in which nothing was committed here.
     */
    touch() {
      touches += 1;
      checkedAt = Number.NEGATIVE_INFINITY;
    },
    async stats({ now = Date.now() } = {}) {
      if (!store || typeof store.state !== 'function') return null;
      if (now >= checkedAt && now - checkedAt < CHANGE_STATS_TTL_MS) return value;
      if (!inFlight) {
        const seen = touches;
        // A commit that lands while this read is in flight leaves the cache
        // open, so the read after it sees that commit too.
        const settle = () => {
          checkedAt = touches === seen ? now : Number.NEGATIVE_INFINITY;
        };
        inFlight = refresh(now)
          .then((v) => {
            value = v;
            settle();
            return v;
          })
          .catch(() => {
            // An unreachable store is "cannot tell" for this minute, then asked again.
            value = null;
            settle();
            return null;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    },
  };
}

/** The journal's series and the accepted one, added day by day. Either alone stands; neither is null. */
export function mergeChangeStats(a, b) {
  if (!a || !b) return a ?? b ?? null;
  const changesByDay = a.changesByDay.map((d, i) => ({
    day: d.day,
    count: d.count + (b.changesByDay[i]?.count ?? 0),
  }));
  return { changesByDay, changesWeek: a.changesWeek + b.changesWeek };
}

/**
 * The `stats` block with the two fields added — or exactly `stats` when
 * neither source can tell (fields omitted), and `null` when there are no stats
 * at all. `changes` is the already-merged series.
 */
export function withChanges(stats, changes) {
  if (!stats) return stats ?? null;
  return changes ? { ...stats, ...changes } : stats;
}

/**
 * The `stats` block with the two fields added — or exactly `stats` when there
 * is no journal (fields omitted), and `null` when there are no stats at all.
 */
export function withChangeStats(stats, journal, opts) {
  if (!stats) return stats ?? null;
  const changes = changeStats(journal, opts);
  return changes ? { ...stats, ...changes } : stats;
}
