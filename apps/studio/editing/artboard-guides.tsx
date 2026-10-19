// editing/artboard-guides.tsx — S2.9 (artboards ed-ab-arrange): what the canvas says while ONE artboard is dragged.
//
// The snap engine (`use-snap-guides.tsx`, `SnapGuideOverlay`) keeps drawing the edge it snapped to, in the guide
// colour (S2.8 made it `--guide`). This is the rest of the picture, from the same drag state — nothing is read from
// the DOM and nothing is written:
//
//   · the soft guide  — an edge that also lines up (the bottom, when the top is what snapped), thinner and paler;
//   · equal gaps      — when the board lands so that three or more gaps in a row are the same, a chip in each:
//                       "80" "80" "80";
//   · the bubble      — "X 3480 · Y 0" beside the pointer (world px), the position the drop will commit;
//   · the lifted shadow on the board in the air (`.dc-dragging`).
//
// Everything is in `--guide`, never the selection's azure (the colour says "this is a measurement", not "this is
// selected"). Same mechanism as the snap overlay: `position: fixed` divs, world → screen by the live viewport, so a
// line is 1 px at any zoom. Chrome only — `aria-hidden`, `pointer-events: none`, gone on release. The maths is pure
// and exported for tests.

import { type ReactElement, useMemo } from 'react';

import { useArtboardsContext, useDragStateContext } from '../canvas-lib.tsx';
import type { Rect, SnapGuide } from '../use-snap-guides.tsx';

/** Two edges "line up" within half a world pixel (the layout lane stores whole pixels). */
export const GUIDE_EPS = 0.5;

export interface SoftGuide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

export interface GapChip {
  axis: 'x' | 'y';
  gap: number;
  /** the gap's span along its axis, world px */
  from: number;
  to: number;
  /** where across the row/column the chip sits, world px */
  cross: number;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= GUIDE_EPS;

// ── soft guides ───────────────────────────────────────────────────────────────────────────────

/**
 * Edges of the dragged board that line up with an edge of another board, other than the ones the snap engine already
 * drew (`snapped`). Edges only: a centre that matches is the engine's to draw, when it snapped to it.
 */
export function softGuides(
  leader: Rect,
  others: readonly Rect[],
  snapped: readonly Pick<SnapGuide, 'axis' | 'pos'>[]
): SoftGuide[] {
  const out: SoftGuide[] = [];
  const edgesOf = (axis: 'x' | 'y', r: Rect): number[] =>
    axis === 'x' ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
  const spanOf = (axis: 'x' | 'y', r: Rect): [number, number] =>
    axis === 'x' ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
  for (const axis of ['y', 'x'] as const) {
    for (const edge of edgesOf(axis, leader)) {
      if (snapped.some((g) => g.axis === axis && near(g.pos, edge))) continue;
      if (out.some((g) => g.axis === axis && near(g.pos, edge))) continue;
      let [from, to] = spanOf(axis, leader);
      let hit = false;
      for (const o of others) {
        if (!edgesOf(axis, o).some((e) => near(e, edge))) continue;
        hit = true;
        const [a, b] = spanOf(axis, o);
        from = Math.min(from, a);
        to = Math.max(to, b);
      }
      if (hit) out.push({ axis, pos: edge, from, to });
    }
  }
  return out;
}

// ── equal gaps ────────────────────────────────────────────────────────────────────────────────

/** Boards sharing the leader's band on the other axis, in order along `axis`, leader included. */
function row(leader: Rect, others: readonly Rect[], axis: 'x' | 'y'): Rect[] {
  const cross = (r: Rect): [number, number] => (axis === 'x' ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);
  const [l0, l1] = cross(leader);
  const band = others.filter((o) => {
    const [a, b] = cross(o);
    return Math.min(l1, b) - Math.max(l0, a) > 0;
  });
  return [...band, leader].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
}

/**
 * The chips for the equal gaps the dragged board takes part in: the longest run of identical, positive gaps along a
 * row or a column that touches it, two gaps at least (a single gap is just a distance, not a rhythm).
 */
export function equalGapChips(leader: Rect, others: readonly Rect[]): GapChip[] {
  let best: GapChip[] = [];
  for (const axis of ['x', 'y'] as const) {
    const line = row(leader, others, axis);
    const at = line.indexOf(leader);
    const start = (r: Rect) => (axis === 'x' ? r.x : r.y);
    const size = (r: Rect) => (axis === 'x' ? r.w : r.h);
    const gaps = line
      .slice(1)
      .map((r, i) => start(r) - (start(line[i] as Rect) + size(line[i] as Rect)));
    // runs of equal positive gaps that include a gap beside the leader (gap k sits between line[k] and line[k+1])
    for (const seed of [at - 1, at]) {
      const v = gaps[seed];
      if (v === undefined || v <= GUIDE_EPS) continue;
      let lo = seed;
      let hi = seed;
      while (lo > 0 && near(gaps[lo - 1] as number, v)) lo--;
      while (hi < gaps.length - 1 && near(gaps[hi + 1] as number, v)) hi++;
      if (hi - lo + 1 < 2 || hi - lo + 1 <= best.length) continue;
      const chips: GapChip[] = [];
      for (let k = lo; k <= hi; k++) {
        const a = line[k] as Rect;
        const b = line[k + 1] as Rect;
        const centre = (r: Rect) => (axis === 'x' ? r.y + r.h / 2 : r.x + r.w / 2);
        chips.push({
          axis,
          gap: Math.round(gaps[k] as number),
          from: start(a) + size(a),
          to: start(b),
          cross: (centre(a) + centre(b)) / 2,
        });
      }
      best = chips;
    }
  }
  return best;
}

// ── the bubble ────────────────────────────────────────────────────────────────────────────────

export function bubbleText(at: { x: number; y: number }): string {
  return `X ${Math.round(at.x)} · Y ${Math.round(at.y)}`;
}

// ── the chrome ────────────────────────────────────────────────────────────────────────────────

const GUIDE = 'var(--guide, oklch(0.55 0.20 328))';
const GUIDE_FG = 'var(--guide-fg, oklch(1 0 0))';

export const GUIDES_CSS = `
.dc-canvas .dc-artboard.dc-dragging {
  box-shadow: var(--shadow-lg, 0 18px 44px var(--maude-chrome-shadow, rgba(0,0,0,0.28)), 0 2px 8px var(--maude-chrome-shadow, rgba(0,0,0,0.28)));
}
.ed-guide-soft { position: fixed; z-index: 5; pointer-events: none; background: color-mix(in oklab, ${GUIDE} 45%, transparent); }
.ed-gap { position: fixed; z-index: 6; pointer-events: none; display: flex; align-items: center; justify-content: center; }
.ed-gap[data-axis="y"] { flex-direction: column; }
.ed-gap-line { position: absolute; background: ${GUIDE}; }
.ed-gap[data-axis="x"] .ed-gap-line { left: 0; right: 0; top: 50%; height: 1px; }
.ed-gap[data-axis="y"] .ed-gap-line { top: 0; bottom: 0; left: 50%; width: 1px; }
.ed-gap-chip {
  position: relative; padding: 0 5px; border-radius: 3px; background: ${GUIDE}; color: ${GUIDE_FG};
  font: 600 10px/14px var(--maude-chrome-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums;
}
.ed-ab-bubble-pos {
  position: fixed; z-index: 7; pointer-events: none; padding: 2px 7px; border-radius: 4px; white-space: nowrap;
  background: ${GUIDE}; color: ${GUIDE_FG};
  font: 600 11px/16px var(--maude-chrome-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums;
}
`.trim();

const MIN_CHIP_SPAN_PX = 14;

/** What the view needs of a drag in flight (a slice of the drag hook's `dragging` state). */
export interface GuideDrag {
  leaderRect: Rect;
  others: readonly Rect[];
  snap: { guides: readonly SnapGuide[] };
  cursorClientX: number;
  cursorClientY: number;
}

export function ArtboardGuides({ readOnly = false }: { readOnly?: boolean }): ReactElement | null {
  const bus = useDragStateContext();
  const world = useArtboardsContext();
  const s = bus?.current;
  const vp = world?.viewport ?? null;
  // Alt held = snapping is off, so there is nothing to confirm
  const dragging = !readOnly && s?.kind === 'dragging' && !s.alt ? s : null;
  if (!dragging || !vp) return null;
  return <ArtboardGuidesView dragging={dragging} vp={vp} />;
}

/** The chrome for one drag (presentational: no context, renders anywhere). */
export function ArtboardGuidesView({
  dragging,
  vp,
}: {
  dragging: GuideDrag;
  vp: { x: number; y: number; zoom: number };
}): ReactElement {
  const soft = useMemo(
    () => softGuides(dragging.leaderRect, dragging.others, dragging.snap.guides),
    [dragging]
  );
  const chips = useMemo(() => equalGapChips(dragging.leaderRect, dragging.others), [dragging]);
  const sx = (w: number) => vp.x + w * vp.zoom;
  const sy = (w: number) => vp.y + w * vp.zoom;
  const { leaderRect } = dragging;
  return (
    <>
      <style>{GUIDES_CSS}</style>
      <div aria-hidden="true" data-testid="edit-ab-guides">
        {soft.map((g) => {
          const key = `${g.axis}-${g.pos}`;
          const style =
            g.axis === 'x'
              ? {
                  left: sx(g.pos),
                  top: sy(g.from),
                  width: 1,
                  height: Math.max(1, (g.to - g.from) * vp.zoom),
                }
              : {
                  left: sx(g.from),
                  top: sy(g.pos),
                  width: Math.max(1, (g.to - g.from) * vp.zoom),
                  height: 1,
                };
          return (
            <span
              key={key}
              className="ed-guide-soft"
              data-testid="edit-ab-guide-soft"
              data-axis={g.axis}
              style={style}
            />
          );
        })}
        {chips.map((c) => {
          const span = (c.to - c.from) * vp.zoom;
          const box =
            c.axis === 'x'
              ? { left: sx(c.from), top: sy(c.cross) - 8, width: span, height: 16 }
              : { left: sx(c.cross) - 12, top: sy(c.from), width: 24, height: span };
          return (
            <span
              key={`${c.axis}-${c.from}`}
              className="ed-gap"
              data-testid="edit-ab-gap"
              data-axis={c.axis}
              data-gap={c.gap}
              style={box}
            >
              <i className="ed-gap-line" />
              {span >= MIN_CHIP_SPAN_PX ? <span className="ed-gap-chip">{c.gap}</span> : null}
            </span>
          );
        })}
        <span
          className="ed-ab-bubble-pos"
          data-testid="edit-ab-bubble"
          style={{ left: dragging.cursorClientX + 18, top: dragging.cursorClientY + 20 }}
        >
          {bubbleText(leaderRect)}
        </span>
      </div>
    </>
  );
}
