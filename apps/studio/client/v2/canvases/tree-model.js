// client/v2/canvases/tree-model.js — S1.1: the Canvases panel as data (11 · pn-organise, 01 · cf-big-tree).
//
// Pure: groups + the project index + pins → the flat list of rows the panel draws. No DOM, no fetch, so the
// sort, the counts, the Pinned group, the empty-folder state, the window the panel renders and the keyboard
// moves are all pinned by `test/v2-canvases-tree-model.test.ts`.
//
// Where the rows come from. Structure (which folders exist — empty ones too — and which canvas files are
// in them, `.html` legacy canvases included) is the `/_index-data` groups the tree always had. Everything a
// row says about a canvas beyond its name — artboard kinds, "made by AI", the cover picture, when it was
// last touched — is the project index (`/_api/index`, V2-1.17), joined on the designRoot-relative path.
// A canvas the index has not seen yet is still a row; it just has no badges.

import { DYNAMIC_NOTE, hasJumpList, jumpFoot, jumpIsOpen, normaliseKind } from './jump-model.js';
import { searchCanvases } from './panel-search.js';
import { DEFAULT_SORT, fold, normaliseSort, sortItems } from './sort.js';

const CANVAS_EXT = /\.(tsx|html?)$/i;
const TSX_EXT = /\.tsx$/i;

/** One row's height; the empty-folder card is taller. Fixed heights are what make the window cheap. */
export const ROW_H = 30;
/** S11.9 — a canvas row that also shows its file name (Canvases › Advanced › Show file names): two lines. */
export const ROW_H_FILE = 42;
export const EMPTY_H = 104;
/** Rows drawn beyond the viewport on each side, and the most rows the panel ever puts in the DOM. */
export const OVERSCAN = 6;
export const DOM_CAP = 60;

const dirname = (p) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
export const stripExt = (n) => n.replace(CANVAS_EXT, '');

/** "1 canvas", "93 canvases" — never "canvas(es)" (CONTRACT §4). */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The groups that hold canvases a person made (not the Design system, not Project / Runtime files). */
export function canvasGroups(groups) {
  return (groups || []).filter((g) => g.kind === 'canvas' && g.label !== 'Design system');
}

/** The repo-relative design root (".design"): the index says; without it, the first segment of a group root. */
export function designRelOf(snapshot, groups) {
  const fromIndex = snapshot?.project?.designRel;
  if (typeof fromIndex === 'string' && fromIndex) return fromIndex;
  const g = canvasGroups(groups)[0] || (groups || []).find((x) => x.fullPath);
  return g?.fullPath ? g.fullPath.split('/')[0] : '';
}

/** The designRoot-relative key pins and "opened" use: ".design/ui/A.tsx" → "ui/A.tsx". */
export function relOf(path, designRel) {
  return designRel && path.startsWith(`${designRel}/`) ? path.slice(designRel.length + 1) : path;
}

/**
 * The index snapshot → per-canvas meta, keyed by repo-relative path.
 *  kinds: the badge kinds (print, video — web and digital are the default and show nothing),
 *  allKinds: every artboard kind, in index order (the Kind sort reads these).
 */
export function indexMeta(snapshot, designRel) {
  const out = new Map();
  const rows = Array.isArray(snapshot?.canvases) ? snapshot.canvases : [];
  const root = snapshot?.project?.designRel || designRel;
  for (const c of rows) {
    if (!c || typeof c.rel !== 'string') continue;
    const boards = Array.isArray(c.artboards) ? c.artboards : [];
    const allKinds = [...new Set(boards.map((a) => a?.kind).filter(Boolean))];
    out.set(root ? `${root}/${c.rel}` : c.rel, {
      kind: c.kind || 'canvas',
      allKinds,
      kinds: allKinds.filter((k) => k === 'print' || k === 'video'),
      artboards: boards.length,
      // the jump list and the panel search read these (id, label, kind) — nothing else of an artboard
      boards: boards
        .filter((a) => a && typeof a.id === 'string')
        .map((a) => ({ id: a.id, label: a.label || a.id, kind: normaliseKind(a.kind) || 'web' })),
      ai: !!c.madeByAi,
      dynamic: !!c.dynamic,
      cover: c.cover?.key || null,
      mtimeMs: Number.isFinite(c.mtimeMs) ? c.mtimeMs : 0,
    });
  }
  return out;
}

/**
 * Groups + index meta → the tree. One node per folder (counted recursively) and per canvas file.
 * `opened` is `{ <rel>: ms }` — when each canvas was last opened on this Mac.
 *
 * Shape: `{ roots: Folder[], single: boolean, total: number, byPath: Map }`. A project with one canvas
 * group (the usual case) is `single`: its folders sit straight under the project row. With several, each
 * group is a root folder named after it.
 */
export function buildTree({ groups, meta = new Map(), designRel = '', opened = {}, ghosts = [] }) {
  const roots = [];
  const byPath = new Map();
  let total = 0;
  for (const g of canvasGroups(groups)) {
    if (!g.fullPath) continue;
    const root = makeFolder(g.fullPath, g.label);
    root.groupLabel = g.label;
    roots.push(root);
    byPath.set(root.path, root);
    const ensure = (dirPath) => {
      if (byPath.has(dirPath)) return byPath.get(dirPath);
      const parent = dirPath.startsWith(`${g.fullPath}/`) ? ensure(dirname(dirPath)) : root;
      const f = makeFolder(dirPath, basename(dirPath));
      byPath.set(dirPath, f);
      parent.folders.push(f);
      return f;
    };
    for (const d of g.dirs || []) if (d.startsWith(`${g.fullPath}/`)) ensure(d);
    for (const p of g.paths || []) {
      if (!CANVAS_EXT.test(p) || !p.startsWith(`${g.fullPath}/`)) continue;
      const dir = ensure(dirname(p));
      const file = basename(p);
      const rel = relOf(p, designRel);
      const m = meta.get(p);
      dir.canvases.push({
        type: 'canvas',
        path: p,
        rel,
        name: stripExt(file),
        file,
        dir: dir.path,
        pinnable: TSX_EXT.test(p),
        kinds: m?.kinds || [],
        sortKinds: m?.allKinds || [],
        artboards: m?.artboards || 0,
        boards: m?.boards || [],
        ai: !!m?.ai,
        dynamic: !!m?.dynamic,
        cover: m?.cover || null,
        mtimeMs: m?.mtimeMs || 0,
        openedAt: opened[rel] ?? null,
      });
      total++;
    }
  }
  placeGhosts(roots, byPath, ghosts, designRel);
  for (const r of roots) tally(r);
  return { roots, single: roots.length === 1, total, byPath };
}

/**
 * T-S1a — ghost rows: a canvas that is open in a tab but gone from the index (trashed while open). Each one
 * is kept on its folder's `ghosts` list — never on `canvases`, so it is not counted, not searchable, not
 * pinnable and not a move target. `ghost.path` is the repo path or the designRoot-relative one; a folder that
 * no longer exists falls back to its nearest surviving ancestor, then to the first group's root.
 */
function placeGhosts(roots, byPath, ghosts, designRel) {
  if (!ghosts?.length || !roots.length) return;
  for (const g of ghosts) {
    if (!g || typeof g.path !== 'string' || !g.path) continue;
    const path =
      designRel && !g.path.startsWith(`${designRel}/`) ? `${designRel}/${g.path}` : g.path;
    let dir = dirname(path);
    while (dir && !byPath.has(dir) && dir !== dirname(dir)) dir = dirname(dir);
    const folder = byPath.get(dir) ?? roots.find((r) => path.startsWith(`${r.path}/`)) ?? roots[0];
    folder.ghosts.push({
      type: 'ghost',
      path,
      rel: relOf(path, designRel),
      name: g.name || stripExt(basename(path)),
      cover: g.cover || null,
      slot: g.slot || null,
      onOpen: typeof g.onOpen === 'function' ? g.onOpen : null,
      dir: folder.path,
    });
  }
}

function makeFolder(path, name) {
  return {
    type: 'folder',
    path,
    name,
    folders: [],
    canvases: [],
    ghosts: [],
    count: 0,
    openedAt: null,
    mtimeMs: 0,
  };
}

/** Counts and "newest descendant" times, bottom-up. */
function tally(f) {
  let count = f.canvases.length;
  let openedAt = null;
  let mtimeMs = 0;
  for (const c of f.canvases) {
    if (c.openedAt != null && (openedAt === null || c.openedAt > openedAt)) openedAt = c.openedAt;
    if (c.mtimeMs > mtimeMs) mtimeMs = c.mtimeMs;
  }
  for (const s of f.folders) {
    tally(s);
    count += s.count;
    if (s.openedAt != null && (openedAt === null || s.openedAt > openedAt)) openedAt = s.openedAt;
    if (s.mtimeMs > mtimeMs) mtimeMs = s.mtimeMs;
  }
  f.count = count;
  f.openedAt = openedAt;
  f.mtimeMs = mtimeMs;
}

/** Every canvas in the tree, in tree order. */
export function allCanvases(tree) {
  const out = [];
  const walk = (f) => {
    for (const c of f.canvases) out.push(c);
    for (const s of f.folders) walk(s);
  };
  for (const r of tree.roots) walk(r);
  return out;
}

/** `${folder} · ${path under the group}` for a search hit's meta ("2026/combine"). */
export function folderLabel(canvas, tree) {
  const root = tree.roots.find((r) => canvas.dir === r.path || canvas.dir.startsWith(`${r.path}/`));
  if (!root) return '';
  const sub = canvas.dir === root.path ? '' : canvas.dir.slice(root.path.length + 1);
  if (tree.single) return sub;
  return sub ? `${root.name}/${sub}` : root.name;
}

/** Every word of `query` (accent- and case-insensitive) is somewhere in the canvas's name or folder. */
export function matchesQuery(canvas, query, tree) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${canvas.name} ${folderLabel(canvas, tree)}`);
  return words.every((w) => hay.includes(w));
}

/**
 * The rows the panel draws, in order:
 *   [Pinned head, pinned canvases…,] project head, then folders and canvases (sorted, open folders only),
 *   or — while a query is typed — the matching canvases, flat.
 * Every row: `{ key, type: 'head'|'folder'|'canvas'|'empty', depth, level, posinset, setsize }`.
 * `expanded(path)` says whether a folder is open; `pins` is a Set of rels, `pinOrder` the rels in pin order.
 */
export function visibleRows(
  tree,
  {
    sort = DEFAULT_SORT,
    pins = new Set(),
    pinOrder = [],
    expanded = () => false,
    query = '',
    projectLabel = '',
    activePath = null,
    jumpOpen = new Map(), // S1.3 — path → boolean: the canvases whose artboard list the person opened/closed
    activeArtboard = null, // S1.3 — the artboard in view on the open canvas
    fileNames = false, // S11.9 — Show file names: each canvas row carries `fileName` (a second mono line)
  } = {}
) {
  const s = normaliseSort(sort);
  const rows = [];
  const decorate = (c, extra) => ({
    ...c,
    pinned: pins.has(c.rel),
    current: c.path === activePath,
    ...(fileNames && c.type === 'canvas' ? { fileName: basename(c.path) } : null),
    ...extra,
  });

  // S1.3 — the artboards a canvas lists under its row: `list` = [{ id, label, kind, marks? }]
  const boardRows = (c, list, { depth, level, activeBoard }) => {
    const out = list.map((b, i) => ({
      key: `board:${c.path}#${b.id}`,
      type: 'board',
      path: c.path,
      artboardId: b.id,
      name: b.label || b.id,
      kind: normaliseKind(b.kind) || 'web',
      nameMarks: b.marks || [],
      current: c.path === activePath && activeBoard != null && b.id === activeBoard,
      depth,
      level,
      posinset: i + 1,
      setsize: list.length,
    }));
    if (c.dynamic)
      out.push({
        key: `note:${c.path}`,
        type: 'note',
        path: c.path,
        text: DYNAMIC_NOTE,
        depth,
        level,
      });
    return out;
  };

  if (query.trim()) {
    const ordered = sortItems(allCanvases(tree), s);
    const hits = searchCanvases(ordered, query, {
      folderOf: (c) => folderLabel(c, tree),
      order: ordered,
    });
    hits.forEach((h, i) => {
      const c = h.canvas;
      const jumpable = hasJumpList(c);
      const open = jumpable && jumpIsOpen(jumpOpen, c, { viaBoards: h.viaBoards });
      // collapsed, an artboard hit says which artboard it was; open, the artboards say it themselves
      const quoted = h.viaBoards && !open && h.boardSub;
      rows.push(
        decorate(c, {
          key: `hit:${c.path}`,
          depth: 0,
          level: 1,
          posinset: i + 1,
          setsize: hits.length,
          sub: quoted ? h.boardSub.text : h.folder,
          subMarks: quoted ? h.boardSub.marks : h.folderMarks,
          nameMarks: h.nameMarks,
          jumpable,
          jumpOpen: open,
          boardCount: c.boards.length,
        })
      );
      if (open) {
        // the person opened it: every artboard; it opened itself: the ones that matched
        const all = jumpOpen.get(c.path) === true;
        const byId = new Map(h.matched.map((m) => [m.id, m]));
        const list = all
          ? c.boards.map((b) => ({ ...b, marks: byId.get(b.id)?.marks || [] }))
          : h.matched;
        rows.push(...boardRows(c, list, { depth: 1, level: 2, activeBoard: activeArtboard }));
      }
    });
    return rows;
  }

  const byRel = new Map(allCanvases(tree).map((c) => [c.rel, c]));
  const pinned = pinOrder.map((rel) => byRel.get(rel)).filter(Boolean);
  if (pinned.length) {
    rows.push({
      key: 'head:pinned',
      type: 'head',
      id: 'pinned',
      label: 'Pinned',
      aside: String(pinned.length),
    });
    pinned.forEach((c, i) => {
      rows.push(
        decorate(c, {
          key: `pin:${c.path}`,
          depth: 0,
          level: 1,
          posinset: i + 1,
          setsize: pinned.length,
          inPinned: true,
        })
      );
    });
  }
  rows.push({
    key: 'head:project',
    type: 'head',
    id: 'project',
    label: projectLabel,
    rootPath: tree.single ? tree.roots[0]?.path : null,
  });

  const walk = (f, depth) => {
    const kids = sortItems(
      [
        ...f.folders.map((n) => ({
          type: 'folder',
          name: n.name,
          openedAt: n.openedAt,
          mtimeMs: n.mtimeMs,
          kinds: [],
          node: n,
        })),
        ...f.canvases.map((n) => ({
          type: 'canvas',
          name: n.name,
          openedAt: n.openedAt,
          mtimeMs: n.mtimeMs,
          kinds: n.sortKinds,
          node: n,
        })),
        // T-S1a — ghosts sort with the canvases around them (as canvases: only a folder sorts first). It is
        // open in a tab, so under "Recently opened" it leads its folder.
        ...f.ghosts.map((n) => ({
          type: 'canvas',
          name: n.name,
          openedAt: Number.MAX_SAFE_INTEGER,
          mtimeMs: 0,
          kinds: [],
          node: n,
        })),
      ],
      s
    ).map((k) => k.node);
    kids.forEach((n, i) => {
      const place = { depth, level: depth + 1, posinset: i + 1, setsize: kids.length };
      if (n.type === 'folder') {
        const open = !!expanded(n.path);
        rows.push({
          key: `dir:${n.path}`,
          type: 'folder',
          path: n.path,
          name: n.name,
          count: n.count,
          open,
          hasChildren: n.folders.length + n.canvases.length + n.ghosts.length > 0,
          ...place,
        });
        if (open) {
          if (n.folders.length + n.canvases.length + n.ghosts.length === 0) {
            rows.push({
              key: `empty:${n.path}`,
              type: 'empty',
              folderPath: n.path,
              folderName: n.name,
              depth: depth + 1,
              level: depth + 2,
              posinset: 1,
              setsize: 1,
            });
          } else walk(n, depth + 1);
        }
      } else if (n.type === 'ghost') {
        rows.push({
          key: `ghost:${n.path}`,
          type: 'ghost',
          path: n.path,
          rel: n.rel,
          name: n.name,
          cover: n.cover,
          slot: n.slot,
          onOpen: n.onOpen,
          dir: n.dir,
          ...place,
        });
      } else {
        const jumpable = hasJumpList(n);
        const open = jumpable && jumpIsOpen(jumpOpen, n);
        rows.push(
          decorate(n, {
            key: `row:${n.path}`,
            ...place,
            jumpable,
            jumpOpen: open,
            boardCount: n.boards.length,
          })
        );
        if (open)
          rows.push(
            ...boardRows(n, n.boards, {
              depth: depth + 1,
              level: depth + 2,
              activeBoard: activeArtboard,
            })
          );
      }
    });
  };
  if (tree.single) walk(tree.roots[0], 0);
  else {
    // several groups: each is a top-level folder named after it
    tree.roots.forEach((r, i) => {
      const open = !!expanded(r.path);
      rows.push({
        key: `dir:${r.path}`,
        type: 'folder',
        path: r.path,
        name: r.name,
        count: r.count,
        open,
        hasChildren: r.folders.length + r.canvases.length + r.ghosts.length > 0,
        depth: 0,
        level: 1,
        posinset: i + 1,
        setsize: tree.roots.length,
      });
      if (open) walk(r, 1);
    });
  }
  return rows;
}

/**
 * The line under the list and which fact it is: `{ text, tone?, source }`, `source` one of
 * 'sync' | 'jump' | 'access' | 'default' (T-S1a — the contract's one-line precedence: the offline foot is the
 * most urgent, then the artboard count while a canvas's artboards are listed, then the canvas-only foot,
 * then "93 canvases · ⌘K searches every project"). `foots` is `{ sync?, access? }` from the row-slots store.
 */
export function panelFootLine({ total, shown, searching, jump = null, foots = null }) {
  if (foots?.sync) return { ...foots.sync, source: 'sync' };
  // S11.4 — a project still coming down says how far it has got (05 · es-arriving)
  if (foots?.arriving) return { ...foots.arriving, source: 'arriving' };
  // S1.3 — while a canvas's artboards are listed, the foot counts them (11 · pn-jump)
  if (jump) return { text: jumpFoot(jump.boards, { dynamic: jump.dynamic }), source: 'jump' };
  if (foots?.access) return { ...foots.access, source: 'access' };
  const n = searching ? plural(shown, 'result', 'results') : plural(total, 'canvas', 'canvases');
  return { text: `${n} · ⌘K searches every project`, source: 'default' };
}

/** The words under the list: "93 canvases · ⌘K searches every project" / "3 results · …". */
export function panelFoot(args) {
  return panelFootLine(args).text;
}

/** What a search that found nothing says (CONTRACT §4). */
export function nothingCalled(query) {
  return `Nothing called “${query.trim()}”. Try another word, or ask AI to find it.`;
}

/** The empty-folder card (05 · es-panels-canvas). */
export function emptyFolderWords(folderName) {
  return {
    title: `Nothing in ${folderName} yet.`,
    body: 'Drag canvases in, or start one here.',
    action: `New canvas in ${folderName}`,
  };
}

// ── virtualisation ──────────────────────────────────────────────────────────────────────────────────

/** Row tops and the list's height. */
export function layoutRows(rows) {
  const tops = new Array(rows.length);
  let y = 0;
  for (let i = 0; i < rows.length; i++) {
    tops[i] = y;
    y += rowHeight(rows[i]);
  }
  return { tops, height: y };
}

export const rowHeight = (row) =>
  row.type === 'empty' ? EMPTY_H : row.fileName ? ROW_H_FILE : ROW_H;

/**
 * The slice of rows to put in the DOM: what the viewport shows plus OVERSCAN either side, never more than
 * DOM_CAP. A viewport the browser has not measured yet (0) is treated as 600px.
 */
export function windowRange(rows, layout, scrollTop, viewport) {
  const n = rows.length;
  if (!n) return { start: 0, end: 0 };
  const vh = viewport > 0 ? viewport : 600;
  const top = Math.max(0, scrollTop);
  // first row whose bottom edge is below the top of the viewport (binary search on tops)
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (layout.tops[mid] + rowHeight(rows[mid]) <= top) lo = mid + 1;
    else hi = mid;
  }
  const start = Math.max(0, lo - OVERSCAN);
  let end = lo;
  while (end < n && layout.tops[end] < top + vh) end++;
  end = Math.min(n, end + OVERSCAN);
  if (end - start > DOM_CAP) end = start + DOM_CAP;
  return { start, end };
}

/** The scrollTop that brings row `index` into view (unchanged when it already is). */
export function scrollToReveal(rows, layout, index, scrollTop, viewport) {
  if (index < 0 || index >= rows.length) return scrollTop;
  const vh = viewport > 0 ? viewport : 600;
  const top = layout.tops[index];
  const bottom = top + rowHeight(rows[index]);
  if (top < scrollTop) return top;
  if (bottom > scrollTop + vh) return bottom - vh;
  return scrollTop;
}

// ── keyboard ────────────────────────────────────────────────────────────────────────────────────────

const isItem = (r) =>
  r && (r.type === 'folder' || r.type === 'canvas' || r.type === 'board' || r.type === 'ghost');

/**
 * The tree keys the old FileTree answered, on the flat list. Returns what to do:
 *   { focus: index } | { toggle: index } | { toggleJump: index } | { jump: index } | { activate: index } | null
 * (not a tree key). S1.3: → / ← open and close a canvas's artboard list; ↵ on an artboard jumps to it.
 * ↑ ↓ Home End move; → opens a closed folder, else steps into it; ← closes an open folder, else goes to its
 * parent; ↵ and Space open a canvas or toggle a folder; a letter jumps to the next row starting with it.
 */
export function navigate(rows, index, key) {
  const items = [];
  rows.forEach((r, i) => {
    if (isItem(r)) items.push(i);
  });
  if (!items.length) return null;
  const at = items.indexOf(index);
  const cur = rows[index];
  switch (key) {
    case 'ArrowDown':
      return { focus: items[Math.min(at + 1, items.length - 1)] };
    case 'ArrowUp':
      return { focus: items[Math.max(at - 1, 0)] };
    case 'Home':
      return { focus: items[0] };
    case 'End':
      return { focus: items[items.length - 1] };
    case 'ArrowRight':
      if (cur?.type === 'folder') {
        if (!cur.open) return { toggle: index };
        const next = rows[index + 1];
        return isItem(next) && next.depth > cur.depth ? { focus: index + 1 } : null;
      }
      // S1.3 — → opens a canvas's artboard list, then steps into it
      if (cur?.type === 'canvas' && cur.jumpable && !cur.inPinned) {
        if (!cur.jumpOpen) return { toggleJump: index };
        return rows[index + 1]?.type === 'board' ? { focus: index + 1 } : null;
      }
      return null;
    case 'ArrowLeft': {
      if (cur?.type === 'folder' && cur.open) return { toggle: index };
      if (cur?.type === 'canvas' && cur.jumpOpen && !cur.inPinned) return { toggleJump: index };
      if (cur?.type === 'board') {
        for (let i = index - 1; i >= 0; i--) if (rows[i].type === 'canvas') return { focus: i };
      }
      if (cur?.inPinned) return null;
      for (let i = index - 1; i >= 0; i--) {
        if (rows[i].type === 'folder' && rows[i].depth < (cur?.depth ?? 0)) return { focus: i };
      }
      return null;
    }
    case 'Enter':
    case ' ':
      if (cur?.type === 'board') return { jump: index };
      return cur?.type === 'folder' ? { toggle: index } : cur ? { activate: index } : null;
    default: {
      if (key.length !== 1) return null;
      const ch = fold(key);
      const ordered = [...items.slice(at + 1), ...items.slice(0, at + 1)];
      const hit = ordered.find((i) => fold(rows[i].name).startsWith(ch));
      return hit === undefined ? null : { focus: hit };
    }
  }
}
