/**
 * @file       annotations-align.ts — FigJam v3 align + distribute
 * @scope      apps/studio/annotations-align.ts
 * @purpose    Pure bbox math (no React, no DOM) for the multi-select Align
 *             cluster. Units follow FigJam: a whole group aligns as ONE box
 *             (its members translate together), an ungrouped stroke is its own
 *             unit. Align needs ≥ 2 units, distribute ≥ 3 (first/last pinned,
 *             gaps equalized — Figma "distribute spacing" semantics).
 */

import { expandIdsToGroups, outermostGroupOf } from './annotations-groups.ts';
import { type AnchorHost, type Stroke, strokeBBox, translateOne } from './annotations-model.ts';

export type AlignEdge = 'left' | 'h-center' | 'right' | 'top' | 'v-center' | 'bottom';
export type DistributeAxis = 'h' | 'v';

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AlignUnit {
  ids: Set<string>;
  bbox: BBox;
}

function unionBox(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * Partition the (expanded) selection into alignment units. Anchored text is
 * skipped (it has no independent bbox and rides its host via `translateOne`'s
 * no-op); arrows participate — bound endpoints get re-pinned by the caller's
 * `recomputeBoundArrows` pass after the translate.
 */
function unitsOf(strokes: readonly Stroke[], ids: readonly string[]): AlignUnit[] {
  const anchors = new Map<string, AnchorHost>();
  for (const s of strokes) {
    if (s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon') anchors.set(s.id, s);
  }
  const sel = new Set(expandIdsToGroups(ids, strokes));
  const byGroup = new Map<string, AlignUnit>();
  const units: AlignUnit[] = [];
  for (const s of strokes) {
    if (!sel.has(s.id)) continue;
    if (s.tool === 'text' && s.anchorId) continue; // rides its host
    const bb = strokeBBox(s, anchors);
    if (!bb) continue;
    const g = outermostGroupOf(s);
    if (g != null) {
      const existing = byGroup.get(g);
      if (existing) {
        existing.ids.add(s.id);
        existing.bbox = unionBox(existing.bbox, bb);
      } else {
        const unit: AlignUnit = { ids: new Set([s.id]), bbox: bb };
        byGroup.set(g, unit);
        units.push(unit);
      }
    } else {
      units.push({ ids: new Set([s.id]), bbox: bb });
    }
  }
  return units;
}

/** A unit moves with everything inside it (its contents follow its delta). */
function setUnitDelta(
  deltas: Map<string, readonly [number, number]>,
  u: AlignUnit,
  d: readonly [number, number],
  contents?: (id: string) => readonly string[]
): void {
  for (const id of u.ids) {
    deltas.set(id, d);
    if (contents) for (const c of contents(id)) if (!deltas.has(c)) deltas.set(c, d);
  }
}

function applyDeltas(
  strokes: readonly Stroke[],
  deltas: Map<string, readonly [number, number]>
): Stroke[] {
  if (deltas.size === 0) return strokes as Stroke[];
  return strokes.map((s) => {
    const d = deltas.get(s.id);
    return d ? translateOne(s, d[0], d[1]) : s;
  });
}

/** Align every unit's edge/center to the selection's union bbox. */
export function alignStrokes(
  strokes: readonly Stroke[],
  ids: readonly string[],
  edge: AlignEdge,
  /** A unit's contents (a section's subtree) — moved by the unit's delta. */
  contents?: (id: string) => readonly string[]
): Stroke[] {
  const units = unitsOf(strokes, ids);
  if (units.length < 2) return strokes as Stroke[];
  let sel = units[0]?.bbox;
  if (!sel) return strokes as Stroke[];
  for (let i = 1; i < units.length; i++) {
    const u = units[i];
    if (u) sel = unionBox(sel, u.bbox);
  }
  const deltas = new Map<string, readonly [number, number]>();
  for (const u of units) {
    let dx = 0;
    let dy = 0;
    if (edge === 'left') dx = sel.x - u.bbox.x;
    else if (edge === 'h-center') dx = sel.x + sel.w / 2 - (u.bbox.x + u.bbox.w / 2);
    else if (edge === 'right') dx = sel.x + sel.w - (u.bbox.x + u.bbox.w);
    else if (edge === 'top') dy = sel.y - u.bbox.y;
    else if (edge === 'v-center') dy = sel.y + sel.h / 2 - (u.bbox.y + u.bbox.h / 2);
    else dy = sel.y + sel.h - (u.bbox.y + u.bbox.h);
    if (dx !== 0 || dy !== 0) setUnitDelta(deltas, u, [dx, dy], contents);
  }
  return applyDeltas(strokes, deltas);
}

/**
 * Equalize the gaps between units along one axis. First and last unit (by
 * leading edge) stay pinned; everything between shifts so every gap is equal.
 */
export function distributeStrokes(
  strokes: readonly Stroke[],
  ids: readonly string[],
  axis: DistributeAxis,
  /** A unit's contents (a section's subtree) — moved by the unit's delta. */
  contents?: (id: string) => readonly string[]
): Stroke[] {
  const units = unitsOf(strokes, ids);
  if (units.length < 3) return strokes as Stroke[];
  const lead = (u: AlignUnit): number => (axis === 'h' ? u.bbox.x : u.bbox.y);
  const size = (u: AlignUnit): number => (axis === 'h' ? u.bbox.w : u.bbox.h);
  const sorted = [...units].sort((a, b) => lead(a) - lead(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return strokes as Stroke[];
  const span = lead(last) + size(last) - lead(first);
  const total = sorted.reduce((m, u) => m + size(u), 0);
  const gap = (span - total) / (sorted.length - 1);
  const deltas = new Map<string, readonly [number, number]>();
  let cursor = lead(first);
  for (const u of sorted) {
    const d = cursor - lead(u);
    if (d !== 0) {
      setUnitDelta(deltas, u, axis === 'h' ? ([d, 0] as const) : ([0, d] as const), contents);
    }
    cursor += size(u) + gap;
  }
  return applyDeltas(strokes, deltas);
}
