// editing/artboard-resize.ts — S2.8: the pure maths behind artboard resize, the preset ruler, the sticky
// name and the long-page minimap (14 Editing: ed-ab-select, ed-ab-resize, ed-edge-huge). No DOM, no React:
// the handles / ruler / chip / minimap components in this folder only measure and draw what this decides.
//
//   computeArtboardResize   a handle drag → the new box, snapped to a width preset (⌘ off, ⌥ from the centre,
//                           ⇧ keeps the ratio), and whether the height was touched (a bottom/top-edge drag
//                           switches the board to Fixed)
//   rulerStops / bubbleText the ruler's ticks and the words next to the pointer ("Laptop · 1280 × 1573")
//   stickyNameTop           where a tall page's name sits once its own label has scrolled away
//   visibleRange / …Sentence the part of a long page the window shows — "You're looking at 1727–5636 of 6000."
//   sectionsOf              the minimap's sections: the page's top-level children, in page px
//
// World units throughout (DDR-027: an artboard's size is JSX-authoritative world px; position is layout).

import { DEFAULT_SNAP_TOLERANCE } from '../use-artboard-drag.tsx';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface WidthPreset {
  label: string;
  w: number;
}

/** The widths the ruler offers — the registry's `artboard.new-*` web widths (Mobile · Tablet · Laptop · Desktop). */
export const WIDTH_PRESETS: readonly WidthPreset[] = Object.freeze([
  { label: 'Mobile', w: 390 },
  { label: 'Tablet', w: 834 },
  { label: 'Laptop', w: 1280 },
  { label: 'Desktop', w: 1440 },
]);

/** What `resize-artboard` accepts (api.ts `dim`): 64 … 8192 world px. */
export const MIN_SIZE = 64;
export const MAX_SIZE = 8192;
/** A snap reaches this far on SCREEN (px) so it still catches at 22 % zoom; never less than the grid snap's 8 world px. */
export const PRESET_SNAP_SCREEN_PX = 10;

export interface ResizeMods {
  /** ⌥ — resize from the centre */
  alt?: boolean;
  /** ⌘ (or ctrl) — ignore presets */
  meta?: boolean;
  /** ⇧ — keep the ratio (a corner) */
  shift?: boolean;
}

export interface ResizeResult {
  box: Box;
  /** the preset the width landed on, else null */
  preset: WidthPreset | null;
  widthChanged: boolean;
  heightChanged: boolean;
  /** a height the user set by hand: the board is Fixed from here on */
  fixedHeight: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** World-unit reach of a preset snap at this zoom. */
export const snapTolerance = (zoom: number): number =>
  Math.max(DEFAULT_SNAP_TOLERANCE, PRESET_SNAP_SCREEN_PX / (zoom > 0 ? zoom : 1));

/** The preset within reach of `w`, nearest first; null when none. */
export function presetNear(
  w: number,
  zoom: number,
  presets: readonly WidthPreset[] = WIDTH_PRESETS
): WidthPreset | null {
  const tol = snapTolerance(zoom);
  let best: WidthPreset | null = null;
  for (const p of presets) {
    const d = Math.abs(p.w - w);
    if (d <= tol && (!best || d < Math.abs(best.w - w))) best = p;
  }
  return best;
}

/** The preset a width IS (exact), for the inspector's Preset row. */
export const presetOf = (w: number, presets: readonly WidthPreset[] = WIDTH_PRESETS) =>
  presets.find((p) => p.w === w) ?? null;

/**
 * One handle drag. `dx`/`dy` are the pointer's travel in WORLD px since pointerdown.
 * Left/top edges move the origin so the opposite edge stays put; ⌥ grows both sides about the centre.
 */
export function computeArtboardResize(
  start: Box,
  handle: Handle,
  dx: number,
  dy: number,
  mods: ResizeMods = {},
  zoom = 1,
  presets: readonly WidthPreset[] = WIDTH_PRESETS
): ResizeResult {
  const east = handle.includes('e');
  const west = handle.includes('w');
  const south = handle.includes('s');
  const north = handle.includes('n');
  const horizontal = east || west;
  const vertical = south || north;
  const k = mods.alt ? 2 : 1;

  let w = start.w;
  let h = start.h;
  if (east) w = start.w + dx * k;
  else if (west) w = start.w - dx * k;
  if (south) h = start.h + dy * k;
  else if (north) h = start.h - dy * k;

  // ⇧ on a corner keeps the starting ratio, following whichever axis moved further (in relative terms)
  if (mods.shift && horizontal && vertical && start.w > 0 && start.h > 0) {
    const sx = w / start.w;
    const sy = h / start.h;
    const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    w = start.w * s;
    h = start.h * s;
  }

  w = clamp(Math.round(w), MIN_SIZE, MAX_SIZE);
  h = clamp(Math.round(h), MIN_SIZE, MAX_SIZE);

  // presets: width only, never with ⌘ held and never while the ratio is locked (the lock wins)
  let preset: WidthPreset | null = null;
  if (horizontal && !mods.meta && !mods.shift) {
    preset = presetNear(w, zoom, presets);
    if (preset) w = preset.w;
  }

  // origin: a left/top edge keeps the far edge still; ⌥ keeps the centre still
  let x = start.x;
  let y = start.y;
  if (mods.alt) {
    x = start.x - (w - start.w) / 2;
    y = start.y - (h - start.h) / 2;
  } else {
    if (west) x = start.x + start.w - w;
    if (north) y = start.y + start.h - h;
  }

  const widthChanged = w !== start.w;
  const heightChanged = h !== start.h;
  return {
    box: { x: Math.round(x), y: Math.round(y), w, h },
    preset,
    widthChanged,
    heightChanged,
    // only a height the pointer actually changed pins the board; a width-only drag keeps "Fits content"
    fixedHeight: vertical && heightChanged,
  };
}

/** The words beside the pointer while a handle is held: "Laptop · 1280 × 1573". */
export function bubbleText(box: Pick<Box, 'w' | 'h'>, preset: WidthPreset | null): string {
  const size = `${box.w} × ${box.h}`;
  return preset ? `${preset.label} · ${size}` : size;
}

/** The artboard's name chip text for a selected artboard: "1440 × 1573". */
export const sizeText = (w: number, h: number) => `${Math.round(w)} × ${Math.round(h)}`;

export interface RulerStop {
  label: string;
  w: number;
  /** px from the artboard's left edge on screen */
  left: number;
  /** the lit stop */
  on: boolean;
  /** which side its label hangs on so two near stops never overlap: the last stop's label ends at its tick, the first's starts at it */
  anchor?: 'start' | 'end';
}

/**
 * The ruler's ticks along the artboard's top edge. Only the stops near the artboard's width are drawn: the
 * ones either side of it plus anything within a screen's reach, so a 1440 board does not carry a Mobile tick at
 * 390 px inside a 38 % view. Everything the board could snap to stays reachable: a Mobile tick appears once the
 * drag goes below Tablet.
 */
export function rulerStops(
  width: number,
  zoom: number,
  lit: WidthPreset | null,
  presets: readonly WidthPreset[] = WIDTH_PRESETS
): RulerStop[] {
  const sorted = [...presets].sort((a, b) => a.w - b.w);
  // keep the stop just below, the stop just above, and every stop between width ± 40 %
  const lo = width * 0.6;
  const hi = width * 1.15;
  const keep = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i] as WidthPreset;
    if (p.w >= lo && p.w <= hi) keep.add(i);
    if (lit && lit.w === p.w) keep.add(i);
  }
  if (keep.size === 0) {
    // nothing near: the single nearest stop
    let near = 0;
    for (let i = 1; i < sorted.length; i++)
      if (
        Math.abs((sorted[i] as WidthPreset).w - width) <
        Math.abs((sorted[near] as WidthPreset).w - width)
      )
        near = i;
    keep.add(near);
  }
  const idx = [...keep].sort((a, b) => a - b);
  return idx.map((i, n) => {
    const p = sorted[i] as WidthPreset;
    const stop: RulerStop = {
      label: p.label,
      w: p.w,
      left: p.w * zoom,
      on: !!lit && lit.w === p.w,
    };
    if (idx.length > 1 && n === idx.length - 1) stop.anchor = 'start';
    if (idx.length > 1 && n === idx.length - 2) stop.anchor = 'end';
    return stop;
  });
}

// ── long pages ───────────────────────────────────────────────────────────────────────────────

/** A page this tall (world px) is a "long page": it gets the sticky name and the contextual minimap. */
export const LONG_PAGE_MIN = 3000;
export const isLongPage = (bodyHeight: number): boolean => bodyHeight >= LONG_PAGE_MIN;

/**
 * Where a tall page's name chip sits, in window px from the window's top. While the page's own label is
 * on screen the chip sits there; once it scrolls above the window the chip stays at `inset` and rides the page
 * up, never below the page's bottom edge. `null` = the page is off screen (draw no chip).
 */
export function stickyNameTop(
  labelTop: number,
  bodyBottom: number,
  chipHeight: number,
  inset = 8
): number | null {
  if (bodyBottom <= 0) return null;
  return Math.min(Math.max(labelTop, inset), bodyBottom - chipHeight);
}

/** The slice of a page (page px) that the window shows: `[from, to]`, clamped to the page. */
export function visibleRange(
  bodyTop: number,
  zoom: number,
  windowHeight: number,
  pageHeight: number
): { from: number; to: number } | null {
  if (!(zoom > 0) || !(pageHeight > 0)) return null;
  const from = clamp((0 - bodyTop) / zoom, 0, pageHeight);
  const to = clamp((windowHeight - bodyTop) / zoom, 0, pageHeight);
  if (to <= from) return null;
  return { from: Math.round(from), to: Math.round(to) };
}

/** The inspector's line for a long page. */
export const visibleSentence = (from: number, to: number, total: number): string =>
  `You're looking at ${from}–${to} of ${Math.round(total)}.`;

export interface PageSection {
  name: string;
  /** page px from the top */
  y: number;
  h: number;
}

export interface SectionNode {
  /** `data-dc-element` / aria-label / first heading / id / tag — whichever the node has first */
  name: string;
  top: number;
  height: number;
  hidden?: boolean;
}

/** The page's sections: its top-level children with a real height, named and in page order. */
export function sectionsOf(nodes: readonly SectionNode[]): PageSection[] {
  const out: PageSection[] = [];
  for (const n of nodes) {
    if (n.hidden || !(n.height >= 1)) continue;
    out.push({ name: n.name.trim() || 'Section', y: Math.round(n.top), h: Math.round(n.height) });
  }
  return out.sort((a, b) => a.y - b.y);
}

/** The section the window's middle is over (the "lit" row of the list). */
export function sectionAt(sections: readonly PageSection[], y: number): PageSection | null {
  return sections.find((s) => y >= s.y && y < s.y + s.h) ?? null;
}

/** A pure `animateTo` target that brings page-y `y` to the top of the window with a small margin. */
export function jumpTarget(
  vp: { x: number; y: number; zoom: number },
  bodyTopWorld: number,
  y: number,
  margin = 24
): { x: number; y: number; zoom: number } {
  // world → screen: screen = world * zoom + vp.y; we want (bodyTopWorld + y) * zoom + vp.y' = margin
  return { x: vp.x, y: margin - (bodyTopWorld + y) * vp.zoom, zoom: vp.zoom };
}
