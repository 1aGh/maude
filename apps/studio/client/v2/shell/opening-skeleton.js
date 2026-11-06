// client/v2/shell/opening-skeleton.js — 2.0.7 (B1): while a canvas opens, every artboard shows at once as a
// skeleton at its final place and size, and the real canvas replaces them all when it reports `canvas-rendered`.
//
// PURE. The studio draws the skeletons itself, over the frame, from what it already knows before the canvas
// module builds: the index row (artboard ids in the canvas's order, their JSX width/height, labels, kinds) and
// the canvas meta (`layout.artboards[]` positions, the per-person `viewport`). The frame never draws them, so a
// capture or an export — a frame with no studio around it — can never show one, and the frame's live/sleep
// rules (artboard-live.ts) and WebGL budget are untouched.
//
// Lining up with the frame's camera: the layout and the camera here are canvas-lib's own rules, restated —
// `initialArtboards()` (JSX size, meta position, meta w/h when present, the default grid for a board the meta
// does not place) and `getInitial()` (the stored viewport, else `computeFit` with a 24 px pad inside the
// occluded insets). test/v2-opening-skeleton.test.tsx holds both against canvas-lib's exported functions.
//
// When the rules cannot be followed exactly the answer is `null` and the studio keeps its "Opening …" card:
// an artboard whose size is not a literal, a dynamic canvas (its artboards are made when it runs), no index.

import { visibleRect } from '../../../bridge/occlusion.ts';

/** canvas-lib's `VP_GRID` (the default grid for artboards the meta does not place) and its fit pad. */
export const SKELETON_GRID = Object.freeze({ cols: 3, w: 1280, h: 820, gutter: 80 });
export const FIT_PAD = 24;
/** Under this many screen px a canvas-lib name collapses to nothing (`.dc-artboard-label` max-width). */
export const NAME_MIN_PX = 24;

const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const fin = (n) => typeof n === 'number' && Number.isFinite(n);

/** The index row of `path` (repo-relative) in an index snapshot, or null. */
export function indexRowOf(snapshot, path) {
  const rows = Array.isArray(snapshot?.canvases) ? snapshot.canvases : null;
  if (!rows || typeof path !== 'string') return null;
  const root = (snapshot?.project?.designRel || '').replace(/^\/+|\/+$/g, '');
  const rel = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  return rows.find((c) => c && c.rel === rel) || null;
}

/**
 * The artboards as canvas-lib will place them: [{ id, label, kind, x, y, w, h }] in the canvas's order, or null
 * when that cannot be known before the canvas runs.
 */
export function skeletonBoards({ row, meta }) {
  const list = Array.isArray(row?.artboards) ? row.artboards.filter((a) => a && a.id) : [];
  if (!list.length) return null;
  // a dynamic canvas makes artboards when it runs: the parse has only some of them, and the grid would shift
  if (row.dynamic && row.artboardsFrom !== 'runtime') return null;
  const placed = new Map();
  const metaBoards = meta?.layout?.artboards;
  if (Array.isArray(metaBoards)) for (const m of metaBoards) if (m && m.id) placed.set(m.id, m);
  // the default grid's cell is the largest JSX size (synthDefaultGrid) — needed only for a board the meta leaves out
  const needsGrid = list.some((a) => {
    const m = placed.get(a.id);
    return !(m && fin(m.x) && fin(m.y));
  });
  if (needsGrid && list.some((a) => !pos(a.w) || !pos(a.h))) return null;
  const cellW = needsGrid ? Math.max(...list.map((a) => a.w)) : 0;
  const cellH = needsGrid ? Math.max(...list.map((a) => a.h)) : 0;
  const G = SKELETON_GRID;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const m = placed.get(a.id);
    const w = m && pos(m.w) ? m.w : a.w;
    const h = m && pos(m.h) ? m.h : a.h;
    if (!pos(w) || !pos(h)) return null;
    const x = m && fin(m.x) ? m.x : (i % G.cols) * (cellW + G.gutter);
    const y = m && fin(m.y) ? m.y : Math.floor(i / G.cols) * (cellH + G.gutter);
    out.push({ id: a.id, label: a.label || a.id, kind: a.kind || 'digital', x, y, w, h });
  }
  return out;
}

/**
 * The camera canvas-lib opens on: the stored viewport when there is one, else the boards fitted (24 px pad) in
 * the part of the canvas the shell's panels leave free. `width`/`height` are the frame's size.
 */
export function skeletonCamera({ boards, width, height, insets, viewport }) {
  if (viewport && fin(viewport.x) && fin(viewport.y) && fin(viewport.zoom))
    return { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  if (!boards?.length) return { x: 0, y: 0, zoom: 1 };
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const r of boards) {
    xMin = Math.min(xMin, r.x);
    yMin = Math.min(yMin, r.y);
    xMax = Math.max(xMax, r.x + r.w);
    yMax = Math.max(yMax, r.y + r.h);
  }
  const bw = xMax - xMin;
  const bh = yMax - yMin;
  if (!width || !height || bw <= 0 || bh <= 0) return { x: 0, y: 0, zoom: 1 };
  const v = visibleRect(width, height, insets || { top: 0, right: 0, bottom: 0, left: 0 });
  const zoom = Math.min((v.w - FIT_PAD * 2) / bw, (v.h - FIT_PAD * 2) / bh, 1.0);
  return {
    x: v.x + (v.w - bw * zoom) / 2 - xMin * zoom,
    y: v.y + (v.h - bh * zoom) / 2 - yMin * zoom,
    zoom,
  };
}

/**
 * The boards in screen px under `cam`, only those that show in a `width` x `height` frame (a big canvas
 * zoomed in draws a handful, not hundreds). `named` follows canvas-lib's collapse of a too-narrow name.
 */
export function screenBoards(boards, cam, width, height) {
  const out = [];
  for (const b of boards || []) {
    const left = cam.x + b.x * cam.zoom;
    const top = cam.y + b.y * cam.zoom;
    const w = b.w * cam.zoom;
    const h = b.h * cam.zoom;
    if (width && height && (left > width || top > height || left + w < 0 || top + h < 0)) continue;
    out.push({ ...b, left, top, sw: w, sh: h, named: w >= NAME_MIN_PX });
  }
  return out;
}
