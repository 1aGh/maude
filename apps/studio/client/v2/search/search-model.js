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
    const where = isTool ? toolbar : menu[0] ? parentPath(menu[0].path) : '';
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
export function settingsSearchRows({
  cloud = null,
  readOnly = false,
  rows = SETTINGS_ROWS,
  run = () => {},
} = {}) {
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
    if (hit) hits.push({ row, score: hit.score, close: hit.close, marks: hit.marks });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.row.disabled) - Number(b.row.disabled) ||
      a.row.name.localeCompare(b.row.name)
  );
  return hits.slice(0, limit);
}

/** The canvases / artboards `/_api/index?q=` answered → result rows. */
export function remoteRows(result, { designRel = '.design' } = {}) {
  const out = [];
  for (const r of result?.rows ?? []) {
    const rel = r.key.split('#')[0];
    const board = r.group === 'artboards' ? r.key.split('#')[1] : null;
    const canvas = rel.replace(/^.*\//, '').replace(/\.tsx$/, '');
    out.push({
      group: board ? 'artboards' : 'canvases',
      id: `${board ? 'artboard' : 'canvas'}:${r.key}`,
      name: r.name,
      marks: r.marks ?? [],
      close: !!r.close,
      path: `${designRel}/${rel}`,
      artboardId: board,
      // "artboard in LetakA6 · print" / "ui/2026/combine"
      meta: board ? `artboard in ${canvas}` : (r.meta || '').trim(),
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
    byGroup.get(h.row.group)?.push({ ...h.row, marks: h.marks, close: h.close });
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
  const shown = groups.flatMap((g) => g.rows);
  const closeOnly = shown.length > 0 && shown.every((r) => r.close);
  const ask = canAskAI
    ? {
        group: 'ask-ai',
        id: 'ask-ai',
        name: q ? `Ask AI to find “${q}”` : 'Ask AI',
        meta: q ? ' — it looks inside canvases too' : ' — describe what you want on the canvas',
        keys: '⌘↵',
        icon: 'spark',
      }
    : null;
  return {
    groups,
    items: ask ? [...shown, ask] : shown,
    total,
    empty: Boolean(q) && total === 0,
    closeOnly,
    closeWord: closeOnly ? closeWordFor(q, shown[0]) : null,
    ask,
  };
}

/** The word the close matches stand for: "Nothing called “unifromy”. Showing close matches for uniformy." */
function closeWordFor(q, row) {
  const w = fold(q).split(/\s+/).filter(Boolean)[0];
  if (!w || !row) return null;
  for (const t of row.name.split(/[^\p{L}\p{N}]+/u)) {
    const f = fold(t);
    if (f && (withinOneEdit(w, f) || withinOneEdit(w, f.slice(0, w.length)))) return t;
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
