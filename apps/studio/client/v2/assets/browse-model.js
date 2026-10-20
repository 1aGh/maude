// client/v2/assets/browse-model.js — what the wide Browse view draws (S8.13; 12 · ia-assets-browse).
//
// "Photos 120 ›" widens into big pictures: the same rows as the narrow tab, one kind, a sort and a size. Newest first is
// grouped by the day each file arrived (the heading over each run, "27 Sep"); the other sorts are one run with no heading,
// because a day heading over a name-sorted list would lie. Pure: rows in, runs out.

/** Case-insensitive name search. @returns the assets whose name contains every word typed. */
export function filterAssets(assets, query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return assets;
  return assets.filter((a) => {
    const n = String(a.name || a.path || '').toLowerCase();
    return words.every((w) => n.includes(w));
  });
}

/** @type {ReadonlyArray<{ id: 'newest' | 'oldest' | 'name' | 'size', label: string }>} */
export const SORTS = Object.freeze([
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name', label: 'By name' },
  { id: 'size', label: 'Biggest first' },
]);

export const SIZES = Object.freeze([
  { id: 'large', label: 'Large' },
  { id: 'small', label: 'Small' },
]);

export const KIND_WORDS = Object.freeze({
  image: { title: 'Photos', search: 'Search photos' },
  video: { title: 'Video', search: 'Search video' },
  audio: { title: 'Sound', search: 'Search sound' },
});

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });

/** The rows of one kind that match the search, in the order the sort says. */
export function browseRows(assets, kind, query, sort = 'newest') {
  const rows = filterAssets(
    (assets || []).filter((a) => a.kind === kind),
    query
  );
  const out = rows.slice();
  if (sort === 'name') out.sort(byName);
  else if (sort === 'size') out.sort((a, b) => b.size - a.size || byName(a, b));
  else if (sort === 'oldest') out.sort((a, b) => a.mtimeMs - b.mtimeMs || byName(a, b));
  else out.sort((a, b) => b.mtimeMs - a.mtimeMs || byName(a, b));
  return out;
}

/** "27 Sep" (and the year when it is not this one). */
export function dayWords(mtimeMs, now = Date.now()) {
  if (!Number(mtimeMs)) return 'Earlier';
  const d = new Date(mtimeMs);
  const thisYear = new Date(now).getFullYear() === d.getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(thisYear ? {} : { year: 'numeric' }),
  });
}

/**
 * The runs the view draws: `[{ key, title | null, rows }]`. Newest first (and oldest first) group by day; name and size
 * are one run without a heading.
 */
export function runsOf(rows, sort, now = Date.now()) {
  if (sort !== 'newest' && sort !== 'oldest')
    return rows.length ? [{ key: 'all', title: null, rows }] : [];
  const runs = [];
  for (const r of rows) {
    const title = dayWords(r.mtimeMs, now);
    const last = runs[runs.length - 1];
    if (last && last.title === title) last.rows.push(r);
    else runs.push({ key: `${title}:${runs.length}`, title, rows: [r] });
  }
  return runs;
}

/** The ids in the order the runs draw them (what ⇧ ranges and ↵ fill-in-order read). */
export const drawOrder = (runs) => runs.flatMap((run) => run.rows.map((r) => r.path));

/** "Place 6 in Fotky ze zápasu" · "Place 6" when no artboard name is known. */
export function placeWords(n, label) {
  return label ? `Place ${n} in ${label}` : `Place ${n}`;
}
