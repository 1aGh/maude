// client/v2/search/search-model.js — V2-4.6: ⌘K as a render model.
//
// PURE (no DOM, no React). Search ⌘K finds, by name, everything the registry, the Settings sheet, the
// toolbars and the project index know — and every result carries WHERE it lives, so a person learns
// the way back (06 ad-search: "Every Search result carries its path … and ↵ runs it").
//
//   rows    = registry actions (visible, runnable) · toolbar tools · Settings rows   (local, sync)
//   remote  = canvases + artboards from /_api/index?q=                                 (async)
//   groups  = Canvases · Artboards · Actions · Tools · Settings · (Ask AI, last, desktop only)
//
// One matcher: index/match.ts `scoreRow` (accent fold, every word, any order) on a sanitised query —
// "New artboard — A4" has a dash a word-split would keep as a word and then fail on.
// Nothing here names a label or a key: labels, keys and visibility come from the registry at call time
// (V2-4.5b re-binds tool keys while this lands), settings labels from the Settings model.

import { ACTIONS, ACTIONS_BY_ID } from '../../../actions/index.ts';
import { menuPaths } from '../../../actions/menu.ts';
import { holds, isVisible } from '../../../actions/resolve.ts';
import { MODE_TOOLS } from '../../../bridge/canvas-modes.ts';
import { fold, scoreRow, withinOneEdit } from '../../../index/match.ts';
import { keyHint } from '../shell/project-menu-model.js';
import { rowShown, SETTINGS_ROWS } from '../settings/settings-model.js';
import { ACTION_KEYWORDS, SETTINGS_SEARCH } from './search-keywords.js';

/** Group order on screen. Ask AI is not a group: it is the last row (CONTRACT §4, S5). */
export const GROUPS = Object.freeze([
  { id: 'canvases', title: 'Canvases' },
  { id: 'artboards', title: 'Artboards' },
  { id: 'actions', title: 'Actions' },
  { id: 'tools', title: 'Tools' },
  { id: 'settings', title: 'Settings' },
]);

/** Rows per local group on screen — the rest are reachable by typing one more word. */
export const GROUP_CAP = 8;

/**
 * Registry actions that are real but not "things to look for": tab switching is the browser's habit,
 * Step back is esc, a held key and a nudge are not commands, and ⌘K is where you already are.
 * (Marking these `search: { hidden: true }` in the registry is the proper home — patch request;
 * until then this list is the one place.)
 */
const NOT_SEARCHABLE = [
  /^tab\./,
  /^ui\./,
  /^search\./,
  /^canvases\.(search|find)$/,
  /-hold$/,
  /\.nudge$/,
  /^timeline\./,
  /^annotation\./,
  /^object\./,
  /^select\.(none|all-annotations)$/,
  /^edit\.(copy|cut|paste)$/,
  /^home\.open$/,
  /^export\.canvas-dialog$/,
];

/** Modes ⌘K evaluates visibility in: a tool the other toolbar owns is still findable (the key
 *  switches to it); Present has no toolbar and no search. */
const SEARCH_MODES = ['edit', 'preview'];

/** Replace everything that is not a letter or a digit with a space — "New artboard — A4" → words. */
export function sanitizeQuery(q) {
  return String(q ?? '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** visible in some mode ⌘K searches in (rule 12: the same predicate every surface calls). */
function visibleSomewhere(def, ctx) {
  return SEARCH_MODES.some((mode) => isVisible(def, { ...ctx, mode }));
}

function disabledIn(def, ctx) {
  return !SEARCH_MODES.some((mode) => holds(def.enabled, { ...ctx, mode }));
}

/** "Menu › View › Advanced" — the path's parents; the row's own label is the result's name. */
function parentPath(path) {
  const at = path.lastIndexOf(' › ');
  return at < 0 ? path : path.slice(0, at);
}

const TOOL_ALIAS = Object.freeze({ select: 'move' });

/** The toolbar a `tool.*` action sits on, by MODE_TOOLS (slots name tools; labels are the fallback). */
export function toolbarOf(def, modeTools = MODE_TOOLS) {
  const tool = def.id.replace(/^tool\./, '');
  const want = TOOL_ALIAS[tool] ?? tool;
  const label = def.label.toLowerCase();
  const hit = [];
  for (const mode of ['edit', 'preview']) {
    const bar = modeTools[mode];
    if (!bar || bar.hidden) continue;
    const found = bar.slots.some((s) => {
      if (s.tool === want || s.lights?.includes(want) || s.tips?.includes(want)) return true;
      if (s.label.toLowerCase() === label) return true;
      return s.more?.some((m) => m.tool === want || m.label.toLowerCase() === label) ?? false;
    });
    if (found) hit.push(mode);
  }
  if (hit.length === 0) return null;
  // Hand sits on both; the Edit toolbar is the one a person starts on, so it names the home
  return `${hit[0] === 'edit' ? 'Edit' : 'Preview'} toolbar`;
}

/**
 * The registry as searchable rows.
 * @param ctx KeyCtx (`menuCtx()`)
 * @param opts.isRunnable (id) => boolean — a row nothing can run is not offered
 * @param opts.run (id) => void — what ↵ does
 */
export function actionSearchRows(
  ctx,
  {
    isRunnable = () => true,
    run = () => {},
    // false: build every row and let the caller ask `row.runnable()` when the list opens — the shell's
    // runner binds after the first render, so a build-time check would drop rows for good
    eager = true,
    actions = ACTIONS,
    byId = ACTIONS_BY_ID,
  } = {}
) {
  const paths = menuPaths(byId);
  const rows = [];
  const seen = new Set();
  for (const def of actions) {
    if (def.search?.hidden) continue;
    if (NOT_SEARCHABLE.some((re) => re.test(def.id))) continue;
    if (!visibleSomewhere(def, ctx)) continue;
    if (eager && !isRunnable(def.id)) continue;
    const isTool = def.kind === 'tool';
    // a tool no toolbar slot arms any more (Browse, the v1 Rect) has nothing to find: "?" › moved says where it went
    const toolbar = isTool ? toolbarOf(def) : null;
    if (isTool && !toolbar) continue;
    const menu = paths.get(def.id) ?? [];
    // a label shown twice (Export… sits in File and at the top level) is one result
    const key = `${isTool ? 'tool' : 'action'}:${def.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const advanced =
      menu.some((p) => p.advanced) || menu.some((p) => /^Menu › Diagnostics/.test(p.path));
    const where = isTool ? toolbar : menu[0] ? parentPath(menu[0].path) : (def.search?.where ?? '');
    rows.push({
      group: isTool ? 'tools' : 'actions',
      id: `${isTool ? 'tool' : 'action'}:${def.id}`,
      actionId: def.id,
      // A greyed row says where the thing lives (V2-4.9: "AI chat — in the desktop app").
      name:
        def.search?.note && disabledIn(def, ctx) ? `${def.label} — ${def.search.note}` : def.label,
      keys: keyHint(def, ctx),
      where,
      advanced,
      icon: def.icon ?? null,
      disabled: disabledIn(def, ctx),
      keywords: [...(ACTION_KEYWORDS[def.id] ?? []), ...(def.search?.keywords ?? [])],
      searchRow: true,
      runnable: () => isRunnable(def.id),
      run: () => run(def.id),
    });
  }
  return rows;
}

/** "Settings › Advanced › This project › Sync project files (…)" → the row's words + its path. */
function settingsPathOf(where) {
  const bare = where
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+—\s.*$/, '')
    .trim();
  const parts = bare.split(' › ');
  return { name: parts[parts.length - 1], parts };
}

/** The path shown beside a result: at most "Settings › Section › Group", never the row itself. */
function settingsWhere(parts, name) {
  const head = parts.slice(0, Math.min(3, parts.length - 1));
  if (head[head.length - 1] === name) head.pop();
  return head.join(' › ');
}

/**
 * The Settings sheet's rows as results. A local-machine row (`local`) is absent from a cloud tab and from a
 * read-only session, as it is in the sheet (`rowShown`); `open` is the section the sheet opens on.
 */
export function settingsSearchRows(opts = {}) {
  const { cloud = null, readOnly = false, rows = SETTINGS_ROWS, run = () => {} } = opts;
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    if (!rowShown(r, { cloud, readOnly })) continue;
    const extra = SETTINGS_SEARCH[r.testid] ?? {};
    const derived = settingsPathOf(r.where);
    const name = extra.label ?? derived.name;
    // Two rows of the same control (Sync project files) are one result
    const dedupe = `${r.section}:${name.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      group: 'settings',
      id: `setting:${r.section}:${r.testid}:${out.length}`,
      testid: r.testid,
      name,
      keys: '',
      where: settingsWhere(derived.parts, name),
      advanced: r.section === 'advanced',
      icon: 'settings',
      disabled: false,
      keywords: [...(extra.keywords ?? []), derived.name],
      section: r.section,
      searchRow: true,
      runnable: () => true,
      run: () => run(r.section, r),
    });
  }
  return out;
}

/** Score `rows` against a query. Every word must match; label beats keyword/path; `close` = typo. */
export function rankRows(rows, query, { limit = 200 } = {}) {
  const q = sanitizeQuery(query);
  if (!q) return [];
  const qWords = fold(q).split(/\s+/).filter(Boolean);
  const hits = [];
  for (const row of rows) {
    const hit = scoreRow(
      { key: row.id, name: row.name, meta: [...row.keywords, row.where].filter(Boolean).join(' ') },
      qWords
    );
    if (hit)
      hits.push({
        row,
        score: hit.score,
        close: hit.close,
        weak: hit.weak,
        // a typo's token is marked like an exact word (11 · pn-k-close: "Uniformy" lit for "unifromy")
        marks: mergeMarks(hit.marks, hit.closeMarks),
      });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.row.disabled) - Number(b.row.disabled) ||
      a.row.name.localeCompare(b.row.name)
  );
  return hits.slice(0, limit);
}

/** Two sorted lists of [start, end) ranges as one sorted list, overlaps merged. */
export function mergeMarks(...lists) {
  const all = lists.flat().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const r of all) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * A design-system specimen's meta line: "system/maude-v2/preview" → "Design system · maude-v2 · preview".
 * The index keeps these canvases in the same list as the project's own (kind `specimen`); the line says
 * what they are, so a person who typed "button" can tell the DS page from a canvas of theirs.
 */
export function canvasMeta(rel, folder) {
  const m = /^system\/([^/]+)\/(.*)$/.exec(rel);
  if (!m) return (folder || '').trim();
  const sub = m[2].split('/').slice(0, -1);
  return ['Design system', m[1], ...sub].join(' · ');
}

/**
 * The canvases / artboards `/_api/index?q=` answered → result rows.
 * `query` (what was asked) lets the row mark its meta line too — "artboard in LetakA6 · print" lights
 * LetakA6 when the person typed it — and tell a row that matched only through typos (`weak`) from one
 * that has a word right. Without it the server's own name marks stand.
 */
export function remoteRows(result, { designRel = '.design', query = '' } = {}) {
  const qWords = fold(sanitizeQuery(query)).split(/\s+/).filter(Boolean);
  const out = [];
  for (const r of result?.rows ?? []) {
    const rel = r.key.split('#')[0];
    const board = r.group === 'artboards' ? r.key.split('#')[1] : null;
    const canvas = rel.replace(/^.*\//, '').replace(/\.tsx$/, '');
    // "artboard in LetakA6 · print" / "ui/2026/combine"
    const meta = board ? `artboard in ${canvas}` : canvasMeta(rel, r.meta);
    // Re-score the strings the row SHOWS (the index matched on more: the folder, the kind).
    const shown = qWords.length ? scoreRow({ key: r.key, name: r.name, meta }, qWords) : null;
    out.push({
      group: board ? 'artboards' : 'canvases',
      id: `${board ? 'artboard' : 'canvas'}:${r.key}`,
      name: r.name,
      marks: shown ? mergeMarks(shown.marks, shown.closeMarks) : (r.marks ?? []),
      metaMarks: shown?.metaMarks ?? [],
      close: shown ? shown.close : !!r.close,
      weak: shown?.weak ?? false,
      path: `${designRel}/${rel}`,
      artboardId: board,
      meta,
      keys: '',
      where: '',
      advanced: false,
      icon: board ? 'frame' : 'file',
      disabled: false,
      keywords: [],
    });
  }
  return out;
}

/**
 * Everything on screen for a query.
 * @returns {{ groups: {id,title,aside?,rows:object[]}[], items: object[], total: number,
 *   empty: boolean, closeOnly: boolean, closeWord: string|null, ask: object|null }}
 *   `items` is `groups`' rows in order plus the Ask AI row — the list the arrow keys walk.
 */
export function assemble({ query, local = [], remote = [], canAskAI = false, cap = GROUP_CAP }) {
  const q = sanitizeQuery(query);
  const localHits = rankRows(local, q);
  const byGroup = new Map(GROUPS.map((g) => [g.id, []]));
  for (const h of localHits)
    byGroup.get(h.row.group)?.push({ ...h.row, marks: h.marks, close: h.close, weak: h.weak });
  for (const r of remote) byGroup.get(r.group)?.push(r);
  const groups = [];
  let total = 0;
  for (const g of GROUPS) {
    const all = byGroup.get(g.id) ?? [];
    if (all.length === 0) continue;
    total += all.length;
    const rows = all.slice(0, g.id === 'canvases' || g.id === 'artboards' ? 12 : cap);
    const hidden = all.filter((r) => r.advanced).length;
    groups.push({
      id: g.id,
      title: g.title,
      ...(g.id === 'actions' && hidden
        ? { aside: `${hidden} hidden ${hidden === 1 ? 'tool' : 'tools'}` }
        : {}),
      rows,
    });
  }
  const raw = groups.flatMap((g) => g.rows);
  const closeOnly = raw.length > 0 && raw.every((r) => r.close);
  // Every row got here through a typo and not one word was right (11 · pn-k-close, 05 · es-search-k):
  // that is a misspelling to correct, not a search that found things — "Did you mean".
  const didYouMean = closeOnly && raw.every((r) => r.weak);
  // Among rows that DO have a word right, a near miss with none is drawn quiet (after the hits).
  const hush = (r) => (!didYouMean && r.close && r.weak ? { ...r, quiet: true } : r);
  const outGroups = didYouMean
    ? [{ id: 'did-you-mean', title: 'Did you mean', rows: raw }]
    : groups.map((g) => ({ ...g, rows: g.rows.map(hush) }));
  const shown = outGroups.flatMap((g) => g.rows);
  const state = shown.length === 0 || didYouMean ? 'none' : 'hits';
  const ask = canAskAI ? askRow(q, state) : null;
  return {
    groups: outGroups,
    items: ask ? [...shown, ask] : shown,
    total,
    empty: Boolean(q) && total === 0,
    closeOnly,
    didYouMean,
    closeWord: closeOnly ? closeWordFor(q, shown) : null,
    ask,
  };
}

/**
 * The Ask AI row, last on every screen (CONTRACT §4, ⌘↵). Its words follow what is above it:
 *   none   nothing matched (or only a misspelling): "Ask AI to find “pricng” — it looks inside canvases too"
 *   hits   something matched: "Ask AI — find “letak a6 predni” by what it looks like"
 *   idle   nothing typed: "Ask AI — describe what you want on the canvas"
 *   first  nothing typed and nothing opened yet: "Ask AI — type what to make, or what to find"
 * @param state 'none' | 'hits' | 'idle' | 'first'
 */
export function askRow(query, state) {
  const q = sanitizeQuery(query);
  const base = { group: 'ask-ai', id: 'ask-ai', keys: '⌘↵', icon: 'spark' };
  if (q && state === 'none')
    return { ...base, name: `Ask AI to find “${q}”`, meta: ' — it looks inside canvases too' };
  if (q) return { ...base, name: 'Ask AI', meta: ` — find “${q}” by what it looks like` };
  return {
    ...base,
    name: 'Ask AI',
    meta:
      state === 'first'
        ? ' — type what to make, or what to find'
        : ' — describe what you want on the canvas',
  };
}

/**
 * The word the close matches stand for: "Nothing called “unifromy”. Showing close matches for uniformy."
 * It is the first query word that is NOT in any shown name as typed — "unifromy", not "2027".
 */
function closeWordFor(q, rows) {
  const row = rows[0];
  if (!row) return null;
  const typed = fold(q).split(/\s+/).filter(Boolean);
  const hay = fold(rows.map((r) => r.name).join(' '));
  for (const w of typed) {
    if (/\d/.test(w) || hay.includes(w)) continue;
    for (const r of rows)
      for (const t of r.name.split(/[^\p{L}\p{N}]+/u)) {
        const f = fold(t);
        if (f && (withinOneEdit(w, f) || withinOneEdit(w, f.slice(0, w.length)))) return t;
      }
  }
  return null;
}

/** CONTRACT §4: "Nothing called “pricng”. Try another word, or ask AI to find it." (no AI → no 2nd half) */
export function emptyCopy(query, canAskAI) {
  const q = String(query ?? '').trim();
  return {
    headline: `Nothing called “${q}”.`,
    next: canAskAI ? 'Try another word, or ask AI to find it.' : 'Try another word.',
  };
}

/** The footer count, CONTRACT §4: "N results" (never "1 results"). */
export function resultsCount(total) {
  return `${total} ${total === 1 ? 'result' : 'results'}`;
}

/** "1 close match" / "4 close matches" — the typo-only list's count (11 · pn-k-close). */
export function closeCount(total) {
  return `${total} close ${total === 1 ? 'match' : 'matches'}`;
}

/**
 * The footer's count for a typed query, CONTRACT §4:
 *   hits           "N results"
 *   typo-only      "4 close matches" (the note above says what they stand for)
 *   Did you mean   "0 results · 1 close match" (05 · es-search-k)
 */
export function footerCount(view) {
  if (view.didYouMean) return `${resultsCount(0)} · ${closeCount(view.total)}`;
  if (view.closeOnly) return closeCount(view.total);
  return resultsCount(view.total);
}
