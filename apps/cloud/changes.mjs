// "Changes" — how much a project's canvases were changed, per UTC day. Pure.
//
// The cell counts them (its journal) and reports them in the same tenant
// stats the hourly sweep already reads from `/health`:
//
//   changesByDay: [{ day: 'YYYY-MM-DD', count: int }]   30 UTC days, oldest first
//   changesWeek:  int
//
// Both are ABSENT on a cell that predates the fields or has no journal. This
// module is the two halves the control plane adds: what of a cell's report is
// believed (`changesFromStats`), and what an owner is shown from what was
// stored (`changesView`).
//
// THE CELL IS UNTRUSTED TO THE CONTROL PLANE (DDR-054). It runs a customer's
// project; its `/health` body is whatever that process says. Nothing here
// trusts a shape, a length, a date or a number, and what survives is plain
// integers and ISO days — nothing that could ever be markup.

const DAY_MS = 86_400_000;

/** The most changes one project is believed to have in one day. */
export const CHANGES_DAY_CAP = 100_000;

/** The contract is 30 days; one more is a clock on the other side of midnight. */
const MAX_REPORTED_DAYS = 31;

/** How many days the chart shows. */
export const CHANGES_DAYS = 30;

/** A reported week figure is "this week" for this long after it was read. */
const WEEK_FRESH_MS = 36 * 3600_000;

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** A real calendar day in `YYYY-MM-DD`, as ms at 00:00 UTC — or null. */
function dayMs(day) {
  if (typeof day !== 'string' || !DAY_SHAPE.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  // `Date.parse` rolls 2026-02-31 over; a day that does not exist is not a day.
  return Number.isFinite(ms) && utcDay(ms) === day ? ms : null;
}

const count = (v, cap) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= cap ? v : null;

/**
 * What of a cell's stats is kept: `{ byDay: [{day, count}], week: int|null }`,
 * or null when it reports nothing usable (which the caller stores as nothing —
 * never as zeros).
 *
 *   - `changesByDay` must be an array of at most 31 entries, or none of it is
 *     believed (a five-thousand-row array is not this contract misread);
 *   - an entry is kept only as a real UTC day inside the last 31 days (not the
 *     future) with a whole, non-negative count no larger than the cap; a day
 *     named twice keeps its first entry;
 *   - `changesWeek` is kept only as such a count too.
 */
export function changesFromStats(stats, { now = Date.now() } = {}) {
  if (!stats || typeof stats !== 'object') return null;
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
  const oldest = today - MAX_REPORTED_DAYS * DAY_MS;
  const raw = stats.changesByDay;
  const byDay = [];
  if (Array.isArray(raw) && raw.length <= MAX_REPORTED_DAYS) {
    const seen = new Set();
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const at = dayMs(entry.day);
      const n = count(entry.count, CHANGES_DAY_CAP);
      // Nothing in the future (a cell's clock is not ours to follow) and
      // nothing older than the contract's window.
      if (at === null || n === null || at < oldest || at > today || seen.has(entry.day)) continue;
      seen.add(entry.day);
      byDay.push({ day: entry.day, count: n });
    }
    byDay.sort((a, b) => (a.day < b.day ? -1 : 1));
  }
  const week = count(stats.changesWeek, CHANGES_DAY_CAP * 7);
  if (byDay.length === 0 && week === null) return null;
  return { byDay, week };
}

/** What is stored on the project row: the kept report and when it was read. */
export function changesRecord(kept, { now = Date.now() } = {}) {
  return JSON.stringify({ at: now, week: kept.week, byDay: kept.byDay });
}

/** Parse a stored record, re-validated (a row somebody edited is not trusted either). */
function parse(stored, now) {
  if (typeof stored !== 'string' || !stored) return null;
  try {
    const rec = JSON.parse(stored);
    const at = Number(rec?.at);
    if (!Number.isFinite(at) || at > now + DAY_MS) return null;
    // Validated against the moment it was READ: those were its last 31 days.
    const kept = changesFromStats({ changesByDay: rec.byDay, changesWeek: rec.week }, { now: at });
    return kept ? { at, ...kept } : null;
  } catch {
    return null;
  }
}

/**
 * What an owner (or the operator) is shown for a set of projects, or null
 * when NONE of them has a report that still says anything.
 *
 * `days` is exactly CHANGES_DAYS UTC days ending today, summed over the
 * projects that report; a day no project named is 0 — which is honest only
 * because at least one project does report, and that is the condition for
 * returning anything at all. `week` is the cells' own figure while it is
 * fresh, and otherwise the sum of the last seven days that were reported.
 *
 * @param {{id: string, name?: string, changes?: string|null}[]} projects
 */
export function changesView(projects, { now = Date.now() } = {}) {
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
  const window = Array.from({ length: CHANGES_DAYS }, (_, i) =>
    utcDay(today - (CHANGES_DAYS - 1 - i) * DAY_MS)
  );
  const inWindow = new Set(window);
  const lastWeek = new Set(window.slice(-7));
  const totals = new Map(window.map((d) => [d, 0]));
  const perProject = [];
  for (const p of projects ?? []) {
    const rec = parse(p?.changes, now);
    if (!rec) continue;
    const mine = rec.byDay.filter((d) => inWindow.has(d.day));
    const fresh = now - rec.at <= WEEK_FRESH_MS && rec.week !== null;
    // A report whose days have all aged out, and whose week figure is old, no
    // longer says anything about now.
    if (mine.length === 0 && !fresh) continue;
    for (const d of mine) totals.set(d.day, totals.get(d.day) + d.count);
    const week = fresh
      ? rec.week
      : mine.filter((d) => lastWeek.has(d.day)).reduce((n, d) => n + d.count, 0);
    perProject.push({ id: p.id, name: p.name || p.id, week });
  }
  if (perProject.length === 0) return null;
  perProject.sort((a, b) => b.week - a.week || String(a.name).localeCompare(String(b.name)));
  return {
    days: window.map((day) => ({ day, count: totals.get(day) })),
    week: perProject.reduce((n, p) => n + p.week, 0),
    perProject,
    reporting: perProject.length,
    of: (projects ?? []).length,
  };
}
