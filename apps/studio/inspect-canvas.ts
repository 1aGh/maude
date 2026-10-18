/**
 * @file       inspect-canvas.ts — S3.11 (04 Modes · md-inspect)
 * @scope      apps/studio/inspect-canvas.ts
 * @purpose    The canvas-side decisions of Inspect, pure so a test can hold them without a DOM:
 *               · `inspectsSelection(mode, tool)` — is the current selection an inspection (outline + size
 *                 tag, no handles)? Preview and Viewing, or the `inspect` tool on a canvas with no shell.
 *               · `shouldFlipToMove(tool, mode)` — v1's ⌘-click-from-Browse escape hatch arms Move; in a
 *                 governed Preview it must not (⌘-click inspects there, ↵ goes to Edit).
 *               · `neighbourOf(self, others, zoom)` — the gap to the nearest sibling, in world px, named
 *                 ("Gap to About 48"), for the panel's Size and spacing rows.
 *             Erasable TypeScript, no imports of the DOM — it ships in the canvas bundle.
 */

import type { CanvasModeV2 } from './bridge/canvas-modes.ts';
import { modeShows } from './bridge/mode-shows.ts';

/** An inspection: Preview/Viewing, or the `inspect` tool armed while no shell governs the canvas. */
export function inspectsSelection(mode: CanvasModeV2 | null, tool: string): boolean {
  if (mode === null) return tool === 'inspect';
  return modeShows(mode, 'inspect-panel');
}

/** ⌘-click from Browse flips to Move on a free canvas; a governed Preview keeps its mode (inspect). */
export function shouldFlipToMove(tool: string, mode: CanvasModeV2 | null): boolean {
  return tool === 'browse' && mode === null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type NeighbourSide = 'left' | 'right' | 'top' | 'bottom';
export interface Neighbour {
  name: string;
  /** World px (screen px ÷ zoom), rounded. */
  gap: number;
  side: NeighbourSide;
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/**
 * The sibling nearest `self` along a side it faces head-on (ranges overlap on the other axis); an
 * overlapping or touching sibling has no gap and is skipped. Screen boxes in, world px out.
 */
export function neighbourOf(
  self: Box,
  others: ReadonlyArray<{ name: string; rect: Box }>,
  zoom: number
): Neighbour | null {
  const z = zoom > 0 ? zoom : 1;
  let best: { name: string; gap: number; side: NeighbourSide } | null = null;
  for (const o of others) {
    const r = o.rect;
    const rows = overlap(self.y, self.y + self.h, r.y, r.y + r.h);
    const cols = overlap(self.x, self.x + self.w, r.x, r.x + r.w);
    const cand: Array<[NeighbourSide, number]> = [];
    if (rows) {
      cand.push(['left', self.x - (r.x + r.w)]);
      cand.push(['right', r.x - (self.x + self.w)]);
    }
    if (cols) {
      cand.push(['top', self.y - (r.y + r.h)]);
      cand.push(['bottom', r.y - (self.y + self.h)]);
    }
    for (const [side, g] of cand) {
      if (g > 0 && (!best || g < best.gap)) best = { name: o.name, gap: g, side };
    }
  }
  return best ? { name: best.name, gap: Math.round(best.gap / z), side: best.side } : null;
}
