// client/v2/canvases/sort.js — S1.1: how the Canvases panel orders what it shows (11 · pn-organise).
//
// Three orders — Recently opened, Name, Kind — and a "Folders on top" switch (Q7 of S1-slices.md). The
// choice is a per-project, per-Mac view preference: `canvasesSort[<project id>]` in the ui-prefs store
// (`~/.config/maude/prefs.json`), never keyed by a port. Pure: no DOM, no fetch — the pref plumbing is
// `use-canvases-sort.js`.

/** Sort ids, in the order the menu lists them. */
export const SORT_BYS = Object.freeze(['recent', 'name', 'kind']);

/** The menu's words (11 · pn-organise: "Recently opened · Name · Kind"). */
export const SORT_LABELS = Object.freeze({
  recent: 'Recently opened',
  name: 'Name',
  kind: 'Kind',
});

/** The short word the project row shows beside its name ("Recent ▾"). */
export const SORT_ASIDE = Object.freeze({ recent: 'Recent', name: 'Name', kind: 'Kind' });

/** A list this short fits the panel: there is nothing to put in order, so the project row says how many
 *  canvases (the board's "6 canvases", 01 / 02 / 05) and keeps the Sort a quiet control behind it. */
export const SORT_QUIET_MAX = 12;

/**
 * What the project row's Sort control reads and what it is called. A short list in the default order reads
 * its count ("6 canvases"); a long list, or any order the person chose, reads the order ("Recent"). The
 * accessible name always holds the visible words (WCAG 2.5.3).
 */
export function sortControl({ by, total }) {
  const quiet = by === 'recent' && total <= SORT_QUIET_MAX;
  if (quiet) {
    const text = `${total} ${total === 1 ? 'canvas' : 'canvases'}`;
    return { quiet, text, label: `${text} — sort canvases (${SORT_LABELS.recent})` };
  }
  return { quiet, text: SORT_ASIDE[by], label: `Sort canvases — ${SORT_LABELS[by]}` };
}

/** The note under "Kind" — the order kinds sort in (the artboard's own words). */
export const KIND_NOTE = 'web · social · print · video';

export const DEFAULT_SORT = Object.freeze({ by: 'recent', foldersOnTop: true });

/** Whatever was stored → a sort that is always valid. Unknown ids fall back; a bad flag keeps the default. */
export function normaliseSort(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    by: SORT_BYS.includes(o.by) ? o.by : DEFAULT_SORT.by,
    foldersOnTop: typeof o.foldersOnTop === 'boolean' ? o.foldersOnTop : DEFAULT_SORT.foldersOnTop,
  };
}

/** Lower-case, no diacritics: "Leták" and "letak" are the same word. */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Kinds a canvas can show, in sort order. Index kinds are web | digital | print | video; "digital" is the
 *  artboard's "social" slot. */
const KIND_RANK = { web: 0, digital: 1, print: 2, video: 3 };

/** A canvas's rank under Kind: its first artboard kind in KIND_RANK order, or last when it has none. */
export function kindRank(kinds) {
  let best = 4;
  for (const k of kinds || []) {
    const r = KIND_RANK[k];
    if (r !== undefined && r < best) best = r;
  }
  return best;
}

const byName = (a, b) =>
  fold(a.name).localeCompare(fold(b.name), 'en', { numeric: true, sensitivity: 'base' }) ||
  a.name.localeCompare(b.name);

/**
 * Sort `items` (canvas or folder nodes: `{ type, name, openedAt, mtimeMs, kinds }`) — a new array.
 *  - recent: opened desc, then modified desc, then name. A folder takes its newest descendant's time.
 *  - name:   natural, accent-insensitive ("Test2" before "Test10").
 *  - kind:   web, social, print, video, none; name within a kind. A folder counts as no kind (after the
 *            kinds, unless folders sit on top).
 * `foldersOnTop` lifts every folder above the canvases at its level; off, they mix by the same order.
 */
export function sortItems(items, sort) {
  const s = normaliseSort(sort);
  const cmp = (a, b) => {
    if (s.foldersOnTop && a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    if (s.by === 'name') return byName(a, b);
    if (s.by === 'kind') {
      const d = kindRank(a.kinds) - kindRank(b.kinds);
      return d || byName(a, b);
    }
    const ta = a.openedAt ?? 0;
    const tb = b.openedAt ?? 0;
    return tb - ta || (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || byName(a, b);
  };
  return [...items].sort(cmp);
}

// ── the stored preference ───────────────────────────────────────────────────────────────────────────

/** The ui-prefs key. One map for the whole Mac: `canvasesSort: { <project id>: { by, foldersOnTop } }`. */
export const SORT_PREF_KEY = 'canvasesSort';

/** A project id, as the index and Home mint it (`l` + 16 hex for a local project; a cloud id for a team one). */
export const isProjectId = (v) =>
  typeof v === 'string' &&
  /^[A-Za-z0-9._:-]{1,128}$/.test(v) &&
  v !== '__proto__' &&
  v !== 'constructor' &&
  v !== 'prototype';

/**
 * This project's sort out of the prefs object `GET /_api/ui-prefs` answered. Keyed by the PROJECT, never
 * by the page's port: a port changes every launch and the preference followed it away (the
 * prefs-follow-port bug), so a project that is not identified yet reads the default and writes nothing.
 */
export function readSortPref(prefs, projectId) {
  if (!isProjectId(projectId)) return normaliseSort(null);
  const all = prefs?.[SORT_PREF_KEY];
  const mine = all && typeof all === 'object' && !Array.isArray(all) ? all[projectId] : null;
  return normaliseSort(mine);
}

/** The body for `POST /_api/ui-prefs`: this project's sort alone (the server merges it into the map). */
export function sortPrefPatch(projectId, sort) {
  if (!isProjectId(projectId)) return null;
  return { [SORT_PREF_KEY]: { [projectId]: normaliseSort(sort) } };
}
