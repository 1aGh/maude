// editing/draw-geometry.ts — the arithmetic of the Frame / Shape / Export-area drag (S2.13, ed-shape). Pure: numbers in,
// numbers out, no DOM — the drag overlay (draw-tools.tsx) measures, this decides.
//
//   · a drag is a box between the press and the pointer; ⇧ makes it square, ⌥ draws it from the centre;
//   · a Line is two points; ⇧ snaps its angle to 45° steps;
//   · a click without a drag draws the default box (a frame or a shape, 100 × 100) — never a speck;
//   · the live tag says what the drag is making and how big, as the name tag of a selection does:
//     "Rectangle · 216 × 216", "Line · 142 px", "Export area · 640 × 360".

import { nameTag } from './crumbs.ts';

/** The canvas tools that draw by dragging. `ellipse`, `line`, `polygon` and `slice` sit behind More. */
export const DRAW_TOOLS = ['frame', 'el-shape', 'ellipse', 'line', 'polygon', 'slice'] as const;
export type DrawTool = (typeof DRAW_TOOLS)[number];
export const isDrawTool = (t: string | null | undefined): t is DrawTool =>
  !!t && (DRAW_TOOLS as readonly string[]).includes(t);

/** The drag tool a registry action arms (`tool.line` → 'line'), or null. ⌘K and the More popover use these. */
export function drawToolOfAction(id: unknown): DrawTool | null {
  if (typeof id !== 'string' || !id.startsWith('tool.')) return null;
  const t = id.slice(5);
  return isDrawTool(t) ? t : null;
}

/** What a tool makes: the kind `object.insert-shape` takes, or the Export area (writes nothing). */
export type DrawKind = 'frame' | 'rectangle' | 'ellipse' | 'line' | 'polygon' | 'area';
export const KIND_OF_TOOL: Readonly<Record<DrawTool, DrawKind>> = {
  frame: 'frame',
  'el-shape': 'rectangle',
  ellipse: 'ellipse',
  line: 'line',
  polygon: 'polygon',
  slice: 'area',
};
/** CONTRACT §3 words. */
export const KIND_LABEL: Readonly<Record<DrawKind, string>> = {
  frame: 'Frame',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  polygon: 'Polygon',
  area: 'Export area',
};

/** A press that moves less than this is a click, not a drag (screen px). */
export const DRAG_THRESHOLD = 4;
/** What a click draws (container px). */
export const CLICK_SIZE = 100;

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Mods {
  shift: boolean;
  alt: boolean;
}

/** The box between `from` and `to`. ⇧ makes it square (the longer side wins); ⌥ grows it from `from`. */
export function dragBox(from: Pt, to: Pt, mods: Mods): Box {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (mods.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  if (mods.alt) {
    return {
      x: from.x - Math.abs(dx),
      y: from.y - Math.abs(dy),
      w: Math.abs(dx) * 2,
      h: Math.abs(dy) * 2,
    };
  }
  return {
    x: Math.min(from.x, from.x + dx),
    y: Math.min(from.y, from.y + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}

/** Where a Line ends: the pointer, or — ⇧ — the nearest 45° step at the same length. */
export function lineEnd(from: Pt, to: Pt, mods: Pick<Mods, 'shift'>): Pt {
  if (!mods.shift) return to;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

/** A press-and-release that stayed put. */
export const isClick = (from: Pt, to: Pt): boolean =>
  Math.hypot(to.x - from.x, to.y - from.y) < DRAG_THRESHOLD;

/** The default box a click draws, centred nowhere: its top-left is the click. */
export const clickBox = (at: Pt, size = CLICK_SIZE): Box => ({
  x: at.x,
  y: at.y,
  w: size,
  h: size,
});

/** "Rectangle · 216 × 216" — a line says its length instead. */
export function liveTag(kind: DrawKind, box: Box, line?: { from: Pt; to: Pt }): string {
  if (kind === 'line' && line) {
    return `${KIND_LABEL.line} · ${Math.round(Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y))} px`;
  }
  return nameTag(KIND_LABEL[kind], box.w, box.h);
}

/** A screen box → the container's own px: `origin` is its content corner on screen, `k` screen px per px. */
export function toLocal(screen: Box, origin: Pt, k: number): Box {
  const s = k > 0 ? k : 1;
  return {
    x: (screen.x - origin.x) / s,
    y: (screen.y - origin.y) / s,
    w: screen.w / s,
    h: screen.h / s,
  };
}
/** A screen point → the container's own px. */
export function pointToLocal(p: Pt, origin: Pt, k: number): Pt {
  const s = k > 0 ? k : 1;
  return { x: (p.x - origin.x) / s, y: (p.y - origin.y) / s };
}
/** A screen point → world px (the canvas pan/zoom: world = (screen − pan) / zoom). */
export function toWorld(p: Pt, vp: { x: number; y: number; zoom: number }): Pt {
  const z = vp.zoom || 1;
  return { x: (p.x - vp.x) / z, y: (p.y - vp.y) / z };
}

const round = (n: number) => Math.round(n);
/** Whole pixels for the write (the tag already shows them rounded). */
export const roundBox = (b: Box): Box => ({
  x: round(b.x),
  y: round(b.y),
  w: Math.max(1, round(b.w)),
  h: Math.max(1, round(b.h)),
});
