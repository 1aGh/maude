// client/v2/ds/review-model.js — S10.8: the words and the arithmetic of "Update N canvases" (13 · ds-edit-review,
// ds-edit-master; V2-1.6 §5.11 c). Pure: no React, no fetch. The sheet draws it; the host fetches it.
//
// The server decides the defaults (ds/engine.ts `canvasRows`): a canvas that follows head is ticked; one a person
// left out ("Keep this version"), and one that is pinned, is not. This file only reads them, groups them and
// turns the ticks back into the request body. Words follow CONTRACT §3–§4: the title asks with the verb the
// primary button does ("Update canvases with the new Accent?" → "Update 4 canvases"), the other button is Cancel,
// a count names the noun for 1 and for many.

export const REVIEW_WORDS = Object.freeze({
  cancel: 'Cancel',
  fine: 'Fine in Light and Dark',
  before: 'Before',
  after: 'After',
  byFolder: 'by folder',
  noneWaiting: 'Nothing is waiting to update. Change something on the Design system canvas first.',
  headMoved: 'The design system changed while this was open. Open it again to see the new list.',
  outside: 'Changes made outside the app wait for a review first. Keep or Undo them, then update.',
  conflict: 'Pick one of the two values on the Design system canvas first.',
  failed: 'Not updated. Nothing changed; try again.',
  cancelFailed: 'Not cancelled. The changes are still waiting; try again.',
  nothingToPush:
    'Nothing on this element differs from the system, so there is nothing to update.',
  pushFailed: 'Not updated. Nothing changed; try again.',
  offline: "No project home answers right now — update when you're back online.",
  forbidden: 'Not updated. You can look here; ask to edit.',
});

/** Why a canvas keeps its look, in words (the engine's `reason` codes). */
const REASON_WORDS = {
  pinned: 'Pinned — keeps its look',
  'ds-level-11': 'Made before the schema — keeps its look',
  blocked: 'Blocked — keeps its look',
};
export const reasonWords = (reason) =>
  REASON_WORDS[reason] ?? (reason ? 'Kept as it is' : 'Kept as it is');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const canvasCount = (n) => plural(n, 'canvas', 'canvases');
export const placeCount = (n) => plural(n, 'place', 'places');

/** The primary button: "Update 4 canvases" (CONTRACT §3 — the title asks with the same verb). */
export function primaryWords(n) {
  if (!Number.isInteger(n) || n <= 0) return 'Update no canvases';
  return `Update ${canvasCount(n)}`;
}

/** The first label a change, or a component, goes by. */
const nameOf = (c) => (typeof c?.label === 'string' && c.label ? c.label : (c?.css ?? ''));

/**
 * "Update canvases with the new Accent?" — one change names it; several count them. `components` are the
 * names of masters with waiting declaration changes.
 */
export function reviewTitle({ changes = [], components = [] } = {}) {
  const n = changes.length + components.length;
  if (n === 1) {
    const name = changes.length === 1 ? nameOf(changes[0]) : components[0];
    return `Update canvases with the new ${name}?`;
  }
  return n > 1 ? `Update canvases with ${n} changes?` : 'Update canvases?';
}

/** The word the fine print uses for what stays: "the old Accent" (one change), else "the old look". */
export const keepsWords = (changes = []) =>
  changes.length === 1 ? `the old ${nameOf(changes[0])}` : 'the old look';

/** First value of a change's theme map (Light, else whichever). */
export const themeValue = (theme) => {
  if (!theme || typeof theme !== 'object') return null;
  return theme.light ?? Object.values(theme)[0] ?? null;
};

/**
 * "Fine in Light and Dark" is shown for a change that carries a value in both themes and whose contrast
 * check (the server's, S10.17) did not fail. A change with no `contrast` field is judged by its values alone.
 */
export function fineInBoth(change) {
  if (!change?.after || typeof change.after !== 'object') return false;
  if (!('light' in change.after) || !('dark' in change.after)) return false;
  const c = change.contrast;
  if (c && typeof c === 'object') {
    if (c.ok === false) return false;
    if (Object.values(c).some((v) => v === false)) return false;
  }
  return true;
}

// ── rows ────────────────────────────────────────────────────────────────────────────────────────

const nameFrom = (p) =>
  String(p)
    .replace(/^.*\//, '')
    .replace(/\.tsx$/i, '');

/**
 * One row per canvas, from the server's review body. `places` is `{ [path]: number }` (usage). Pinned and
 * blocked canvases cannot be ticked here: they keep their look until they are unpinned.
 */
export function rowsOf(canvases = [], places = {}) {
  return canvases.map((c) => {
    const locked =
      c.state === 'pinned' || (c.reason && c.state !== 'follows' && c.state !== 'left-out');
    return {
      path: c.path,
      name: nameFrom(c.path),
      folder: typeof c.folder === 'string' ? c.folder : '',
      state: c.state,
      locked: !!locked,
      reason: locked ? (c.reason ?? 'pinned') : null,
      ticked: !locked && c.ticked === true,
      places: Number.isFinite(places?.[c.path]) ? places[c.path] : null,
    };
  });
}

/** The defaults, as `{ [path]: boolean }`. */
export const defaultTicks = (rows) => Object.fromEntries(rows.map((r) => [r.path, r.ticked]));

/** rows with the person's ticks applied (a locked row never ticks). */
export const withTicks = (rows, ticks) =>
  rows.map((r) => ({ ...r, ticked: !r.locked && (ticks?.[r.path] ?? r.ticked) === true }));

/** 'all' | 'none' | 'mixed' over the rows that can tick. */
export function tickState(rows) {
  const free = rows.filter((r) => !r.locked);
  if (free.length === 0) return 'none';
  const on = free.filter((r) => r.ticked).length;
  return on === 0 ? 'none' : on === free.length ? 'all' : 'mixed';
}

/** "4 of 5 canvases in Studio site" — canvases that can tick are the denominator. */
export function headWords(rows, scope) {
  const free = rows.filter((r) => !r.locked);
  const on = free.filter((r) => r.ticked).length;
  const noun = free.length === 1 ? 'canvas' : 'canvases';
  return `${on} of ${free.length} ${noun}${scope ? ` in ${scope}` : ''}`;
}

/** The quiet line under a row's name. */
export function noteFor(row, { keeps = 'the old look' } = {}) {
  if (row.locked) return reasonWords(row.reason);
  if (row.ticked) return row.places == null ? 'Follows the system' : placeCount(row.places);
  if (row.state === 'left-out') return 'Already left out — keeps its version';
  return `Left out — keeps ${keeps}, gets an update dot`;
}

/** More than this many canvases, the list groups by folder (13 · ds-edit-master: 28 of 34). */
export const FOLDER_VIEW_FROM = 12;

export function groupByFolder(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = r.folder || '';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  return [...by.entries()]
    .map(([folder, list]) => ({ folder, rows: list, state: tickState(list), total: list.length }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

/** "6 canvases · left out" under a folder row that is not ticked. */
export function folderNote(group) {
  const n = group.rows.filter((r) => !r.locked).length;
  return group.state === 'none' ? `${canvasCount(n)} · left out` : canvasCount(n);
}

/** The fine print under the list. `openBy` is `{ name, canvas }` for someone with a ticked canvas open. */
export function finePrint({ changes = [], openBy = null } = {}) {
  const keeps = keepsWords(changes);
  const base = `Unticked canvases keep ${keeps} and show an update dot. Cancel puts the ${
    changes.length === 1 ? 'swatch' : 'changes'
  } back — nothing changes.`;
  return openBy?.name && openBy?.canvas
    ? `${base} ${openBy.name}'s open ${openBy.canvas} updates when ${openBy.name} next looks at it.`
    : base;
}

/** The request body for `POST /_api/ds/publish`: every row that can tick, with its tick. */
export function publishBody({ ds, expectHead }, rows) {
  return {
    ds,
    expectHead,
    canvases: rows.filter((r) => !r.locked).map((r) => ({ path: r.path, ticked: r.ticked })),
  };
}

/** A publish refusal code → the person's words. */
export function refusalWords(code, fallback = REVIEW_WORDS.failed) {
  switch (code) {
    case 'ds-head-moved':
      return REVIEW_WORDS.headMoved;
    case 'ds-outside-unreviewed':
      return REVIEW_WORDS.outside;
    case 'ds-conflict':
      return REVIEW_WORDS.conflict;
    case 'ds-nothing-to-push':
      return REVIEW_WORDS.nothingToPush;
    case 'ds-nothing-waiting':
      return REVIEW_WORDS.noneWaiting;
    case 'ds-kernel-unavailable':
      return REVIEW_WORDS.offline;
    case 'forbidden':
      return REVIEW_WORDS.forbidden;
    default:
      return fallback;
  }
}

/** The toast after Update. */
export const updatedWords = (updated, leftOut) =>
  leftOut > 0
    ? `Updated ${canvasCount(updated)}. ${leftOut} left out keep${leftOut === 1 ? 's' : ''} the old look.`
    : `Updated ${canvasCount(updated)}.`;
