// client/v2/search/search-projects.js — S1.5: ⌘K across projects (11 · pn-k-across).
//
// In a desktop project tab, ⌘K also asks the shell for the canvases and artboards of the person's OTHER
// projects (Rust `index_search`: the same account profile, minus this project — V2-1.1 §5.4, the Home
// index, no second index). Once a project other than this one answers, results group by project: this
// tab first, then the others in the order the shell answered, each under a square header that says where
// it is — "this tab" / "in another tab" / "not open — opens a tab". ↵ on another project's row calls
// `open_search_result({pid, canvas, artboard?})`: ids only, never a URL or a path; the shell switches
// to that tab (or opens one, open once) and goes to the canvas / artboard (decision
// v2-S1-cross-project-open-command).
//
// A browser tab has no other tabs and no shell: there is nothing to ask, so ⌘K searches this project
// only (`acrossProjects`, which shell-parity.js reads too).
//
// PURE but for `desktopProjectsEnv`, which binds the two shell calls; `invoke` is injected everywhere
// else, so tests need no Tauri.

import { assemble, remoteRows } from './search-model.js';

/** Where a project is, against the live windows (Rust `place_of`), in CONTRACT words. A resting tab is
 *  still a tab: it wakes when switched to. */
export const PLACE_ASIDE = Object.freeze({
  self: 'this tab',
  tab: 'in another tab',
  resting: 'in another tab',
  closed: 'not open — opens a tab',
});

/** Rows per other project on screen — the rest are one more word away (this tab keeps its 12). */
export const OTHER_PROJECT_CAP = 6;

/** The object tones a project square wears — Home's ProjectSquare (home-icons.jsx) picks the same one
 *  from the same id, so a project is the same colour on Home and in ⌘K. */
export const PROJECT_TONES = Object.freeze(['lilac', 'yellow', 'sky', 'green', 'coral', 'grey']);

/** `{ initial, tone }` of a project's square. */
export function projectSquare(pid, name) {
  let h = 0;
  for (const ch of String(pid || name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    initial: (String(name || '').trim()[0] || '·').toUpperCase(),
    tone: PROJECT_TONES[h % PROJECT_TONES.length],
  };
}

/** Whether a shell's ⌘K reaches other projects: the desktop app's only (its tabs, its Home index). */
export function acrossProjects({ native }) {
  return native
    ? { present: true, groups: 'by project once another project answers', opens: 'its tab' }
    : {
        present: false,
        why: 'a browser tab is one project: ⌘K searches this project only (other projects live in the desktop app’s tabs)',
      };
}

const PID_RE = /^l[0-9a-f]{16}$/;
/** The only picture a row may carry: the inlined JPEG Rust attached (`attach_thumbs`). */
const JPEG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

/** This window's own pid from its label (`p-<pid>`), or null. Only for the square's tone and a second
 *  guard against this project answering twice — Rust is what keeps it out (`index_scope`). */
export function ownPidOf(label) {
  const m = /^p-(l[0-9a-f]{16})$/.exec(String(label ?? ''));
  return m ? m[1] : null;
}

/**
 * `index_search`'s answer → one group per other project, rows in ⌘K's shape. A group of this project
 * (`ownPid`), a repeated pid, a malformed pid and a group with no rows are dropped.
 * @param result `{ groups: [{pid, name, place, rows}] }` from Rust
 */
export function projectGroups(result, { ownPid = null, query = '' } = {}) {
  const out = [];
  const seen = new Set();
  for (const g of result?.groups ?? []) {
    const pid = g?.pid;
    if (typeof pid !== 'string' || !PID_RE.test(pid) || pid === ownPid || seen.has(pid)) continue;
    seen.add(pid);
    const src = (Array.isArray(g.rows) ? g.rows : []).filter((r) => typeof r?.key === 'string');
    // remoteRows maps row for row, in order
    const rows = remoteRows({ rows: src }, { query }).map((r, i) => ({
      ...r,
      id: `project:${pid}:${r.id}`,
      pid,
      canvasRel: src[i].key.split('#')[0],
      path: null,
      thumb: JPEG_RE.test(src[i].thumb ?? '') ? src[i].thumb : null,
    }));
    if (!rows.length) continue;
    const name = String(g.name || 'Untitled project');
    out.push({ pid, name, place: PLACE_ASIDE[g.place] ? g.place : 'closed', rows });
  }
  return out;
}

const PROJECT_GROUPS = new Set(['canvases', 'artboards']);

/**
 * S15-A2: "Did you mean" is one flat list, so a row of ANOTHER project carries its project on the row
 * itself — the square, the name and where it is ("not open — opens a tab") — since ↵ on it switches
 * project. This tab's rows stay as they are.
 */
function labelledDidYouMean(view, others) {
  const byPid = new Map(
    others.map((g) => [
      g.pid,
      { name: g.name, square: projectSquare(g.pid, g.name), aside: PLACE_ASIDE[g.place] },
    ])
  );
  const label = (r) => (r.pid && byPid.has(r.pid) ? { ...r, project: byPid.get(r.pid) } : r);
  const groups = view.groups.map((g) => ({ ...g, rows: g.rows.map(label) }));
  const shown = groups.flatMap((g) => g.rows);
  return { ...view, groups, items: view.ask ? [...shown, view.ask] : shown };
}

/**
 * `assemble` with other projects in it. No other project answered → today's view, unchanged. Otherwise
 * this tab's canvases and artboards become ONE group under this project's square ("this tab"), first,
 * then one group per other project, then Actions · Tools · Settings. Counts, close matches and
 * "Did you mean" are over every row — a misspelling stays one list ("Did you mean"), whoever answered.
 * @param others projectGroups(...)
 * @param own    { pid, name } of this tab's project
 */
export function assembleAcross({
  query,
  local = [],
  remote = [],
  others = [],
  own = null,
  canAskAI = false,
}) {
  if (!others.length) return assemble({ query, local, remote, canAskAI });
  const theirs = others.flatMap((g) => g.rows);
  const view = assemble({ query, local, remote: [...remote, ...theirs], canAskAI });
  if (view.didYouMean) return labelledDidYouMean(view, others);
  const quiet = (r) => (r.close && r.weak ? { ...r, quiet: true } : r);
  const mine = view.groups
    .filter((g) => PROJECT_GROUPS.has(g.id))
    .flatMap((g) => g.rows)
    .filter((r) => !r.pid);
  const groups = [];
  if (mine.length) {
    const name = own?.name || 'This project';
    groups.push({
      id: 'project-self',
      title: name,
      square: projectSquare(own?.pid, name),
      aside: PLACE_ASIDE.self,
      rows: mine,
    });
  }
  for (const g of others)
    groups.push({
      id: `project-${g.pid}`,
      title: g.name,
      square: projectSquare(g.pid, g.name),
      aside: PLACE_ASIDE[g.place],
      rows: g.rows.slice(0, OTHER_PROJECT_CAP).map(quiet),
    });
  // 11 pn-k-across: across projects the tools group says how they are found
  groups.push(
    ...view.groups
      .filter((g) => !PROJECT_GROUPS.has(g.id))
      .map((g) =>
        g.title === 'Tools and settings' ? { ...g, aside: 'not on screen, found by search' } : g
      )
  );
  const shown = groups.flatMap((g) => g.rows);
  return { ...view, groups, items: view.ask ? [...shown, view.ask] : shown };
}

/**
 * Ask the shell (desktop project tab only). Resolves the raw `{groups}` or null — not in the app, nothing
 * asked, a stale keystroke, or the shell said no: this project's rows still answer.
 */
export async function searchProjects(query, { invoke, signal, limit = 50 } = {}) {
  const q = String(query ?? '').trim();
  if (!q || typeof invoke !== 'function') return null;
  try {
    const res = await invoke('index_search', { q: q.slice(0, 200), limit });
    if (signal?.aborted) return null;
    return Array.isArray(res?.groups) ? res : null;
  } catch {
    return null;
  }
}

/** ↵ on another project's row: ids only. Resolves `{label, opened}` or null when the shell refused. */
export async function openSearchResult(row, { invoke } = {}) {
  if (!row?.pid || !row.canvasRel || typeof invoke !== 'function') return null;
  try {
    return await invoke('open_search_result', {
      pid: row.pid,
      canvas: row.canvasRel,
      artboard: row.artboardId ?? null,
    });
  } catch {
    return null;
  }
}

/** What `bindPaletteEnv` takes from here in the desktop app; `{}` in a browser tab (no groups). */
export function desktopProjectsEnv({ win = globalThis, projectName = '' } = {}) {
  const t = win?.__TAURI__;
  const invoke = t?.core?.invoke ? (cmd, args) => t.core.invoke(cmd, args) : null;
  if (!invoke) return {};
  const meta = win.__TAURI_INTERNALS__?.metadata;
  const pid = ownPidOf(meta?.currentWebview?.label ?? meta?.currentWindow?.label);
  return {
    ownProject: { pid, name: projectName },
    searchProjects: (q, opts = {}) => searchProjects(q, { ...opts, invoke }),
    openSearchResult: (row) => openSearchResult(row, { invoke }),
  };
}
