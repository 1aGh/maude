/**
 * @file       use-snap-guides.tsx — Phase 4.2 snap math + guide-line shapes
 * @scope      apps/studio/use-snap-guides.tsx
 * @purpose    Pure function `computeSnap` that returns a snapped (x, y) for a
 *             proposed artboard rect plus the guide lines that should render
 *             as visual feedback. No React state; the drag controller calls
 *             this on every pointermove tick.
 *
 * Two snap kinds:
 *
 *   Grid     — every `gridSize` world-units. Applied to top-left corner of
 *              `proposed` (left edge for X, top edge for Y).
 *   Sibling  — alignment with other artboard rects: left↔left, right↔right,
 *              left↔right, right↔left, centerX↔centerX on the X-axis (and
 *              the matching top/bottom/centerY set on the Y-axis).
 *
 * Tolerance is in world units, not screen pixels (DDR-028) — snap feel stays
 * consistent across zoom levels.
 *
 * The X-axis and Y-axis are independent: a proposed rect can snap X to a
 * sibling edge and Y to a grid line simultaneously. Both guides render.
 *
 * Closest candidate wins per axis (smallest |delta|). When multiple sibling
 * candidates land on the exact same `pos` (e.g. two artboards' right edges
 * stacked at the same x), we render one merged guide whose from/to spans the
 * union of every aligned rect's perpendicular extent.
 *
 * `disabled: true` (Alt held) short-circuits with `{ x, y, guides: [] }`.
 */

export interface Rect {
  /** Optional rect id — used by the drag controller to filter self / followers
   *  out of the snap candidate set. `computeSnap` itself ignores it. */
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SnapAxis = 'x' | 'y';

/** DDR-046 — `kind` lets SnapGuideOverlay route grid vs sibling guides to
 *  different visual treatments (grid = lighter gray fallback; sibling = full
 *  magenta confidence). `delta` is the signed correction the snap applied;
 *  the overlay renders a `Δ{Math.round(delta)}` pill mid-span when |delta| > 0
 *  and the guide span > 60 px. `guide` (feature-1-artboard-kinds-foundation
 *  T7) is a third source — an artboard's own generic layout guide lines
 *  (T5), offered the same confidence treatment as `sibling`. */
export type SnapKind = 'grid' | 'sibling' | 'guide';

export interface SnapGuide {
  /** `"x"` → vertical line (snapping X coord). Line sits at `pos` on X,
   *  spans `from..to` on Y. `"y"` is the dual: horizontal line at `pos` on Y,
   *  spans `from..to` on X. */
  axis: SnapAxis;
  pos: number;
  from: number;
  to: number;
  /** Signed pixel delta the snap corrected (additive: `proposed + delta`).
   *  Optional for back-compat with pre-DDR-046 readers. */
  delta?: number;
  /** Whether the winning candidate came from the grid pass or a sibling edge.
   *  Optional for back-compat. */
  kind?: SnapKind;
}

export interface SnapResult {
  /** Possibly-snapped top-left X of the proposed rect (in world coords). */
  x: number;
  /** Possibly-snapped top-left Y. */
  y: number;
  /** Guides to render. 0..2 entries in the common case (one per axis). */
  guides: SnapGuide[];
}

/**
 * T7 — a single generic-layout-guide line (T5) in WORLD coordinates, ready to
 * snap against. The caller (canvas-lib/canvas-shell) resolves an artboard's
 * `guides` prop (columns/rows/grid, artboard-LOCAL coordinates) into these
 * world-space lines — `computeSnap` itself stays artboard-agnostic, same as
 * it already is for sibling rects.
 */
export interface GuideLineCandidate {
  axis: SnapAxis;
  pos: number;
  from: number;
  to: number;
}

/**
 * T7 — the two snap-source presets: `layout` (default) offers sibling edges/
 * centers AND guide lines, falling back to the grid; `pixel` offers ONLY the
 * grid — for pixel-precise placement work where guide/sibling magnetism would
 * get in the way. Affinity's "2 intent presets, not 15 toggles" call (see the
 * plan's Design Decision 4).
 */
export type SnapIntent = 'layout' | 'pixel';

export interface SnapOptions {
  /** World-units between grid lines. Default 40. */
  gridSize: number;
  /** Max world-unit distance at which a candidate is considered "close". */
  tolerance: number;
  /** Skip all snap math + return proposed unchanged (Alt-held bypass). */
  disabled: boolean;
  /** Generic layout guide lines to snap against, in world coordinates. */
  guideLines?: GuideLineCandidate[];
  /** Which candidate sources are active. Default `'layout'` when omitted, so
   *  every existing call site (pre-T7) keeps today's sibling+grid behavior. */
  intent?: SnapIntent;
}

interface AxisCandidate {
  /** Shift to apply to proposed on this axis. */
  delta: number;
  /** Position of the guide line in world coords (on the snapped axis). */
  pos: number;
  /** Perpendicular extent — `from..to` of the would-be guide. */
  from: number;
  to: number;
  /** Whether this candidate came from the grid pass or the sibling pass. */
  kind: SnapKind;
  /** S2.22 — a landing that continues an equal-gap rhythm: it beats every other candidate in tolerance. */
  rhythm?: boolean;
}

function nearestGridDelta(coord: number, gridSize: number, tolerance: number): number | null {
  if (!Number.isFinite(coord) || gridSize <= 0) return null;
  const nearest = Math.round(coord / gridSize) * gridSize;
  const delta = nearest - coord;
  return Math.abs(delta) <= tolerance ? delta : null;
}

const TIE = 1e-9;

function pickClosest(all: AxisCandidate[]): AxisCandidate | null {
  if (all.length === 0) return null;
  // S2.22 — an equal-gap landing (the rhythm of the boards already in the row) beats the grid and the edges:
  // 3794 wins over the grid's 3800 when both are in reach.
  const rhythm = all.filter((c) => c.rhythm);
  const cands = rhythm.length ? rhythm : all;
  let best = cands[0] as AxisCandidate;
  let bestAbs = Math.abs(best.delta);
  for (let i = 1; i < cands.length; i++) {
    const c = cands[i] as AxisCandidate;
    const a = Math.abs(c.delta);
    // a tie goes to the board's edge, never to the grid: the guide the designer sees is the sibling's
    if (a < bestAbs - TIE || (a < bestAbs + TIE && best.kind === 'grid' && c.kind !== 'grid')) {
      best = c;
      bestAbs = a;
    }
  }
  return best;
}

/**
 * S2.22 (ed-ab-arrange) — where `proposed` lands to carry on the rhythm of the boards in its row (axis 'x') or
 * column ('y'): one gap past the last, one gap before the first, or the middle of a free gap between two.
 * Needs two boards in the band; only positive gaps count. Returns top-left coordinates on `axis`.
 */
export function equalGapLandings(
  proposed: Rect,
  others: readonly Rect[],
  axis: SnapAxis
): number[] {
  const start = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const size = (r: Rect) => (axis === 'x' ? r.w : r.h);
  const crossLo = (r: Rect) => (axis === 'x' ? r.y : r.x);
  const crossSize = (r: Rect) => (axis === 'x' ? r.h : r.w);
  const band = others
    .filter(
      (o) =>
        Math.min(crossLo(o) + crossSize(o), crossLo(proposed) + crossSize(proposed)) -
          Math.max(crossLo(o), crossLo(proposed)) >
        0
    )
    .sort((a, b) => start(a) - start(b));
  if (band.length < 2) return [];
  const out: number[] = [];
  const first = band[0] as Rect;
  const last = band[band.length - 1] as Rect;
  const gapAfter =
    start(last) - (start(band[band.length - 2] as Rect) + size(band[band.length - 2] as Rect));
  const gapBefore = start(band[1] as Rect) - (start(first) + size(first));
  if (gapAfter > 0) out.push(start(last) + size(last) + gapAfter);
  if (gapBefore > 0) out.push(start(first) - gapBefore - size(proposed));
  for (let i = 0; i + 1 < band.length; i++) {
    const a = band[i] as Rect;
    const b = band[i + 1] as Rect;
    const free = start(b) - (start(a) + size(a)) - size(proposed);
    if (free > 0) out.push(start(a) + size(a) + free / 2);
  }
  return out;
}

/**
 * Among `cands`, find every entry whose `pos` matches `winner.pos` (within a
 * tiny epsilon to absorb floating-point noise) and union their from/to into
 * one guide. Returns the merged guide.
 */
function mergeAtPos(axis: SnapAxis, winner: AxisCandidate, cands: AxisCandidate[]): SnapGuide {
  let from = winner.from;
  let to = winner.to;
  let worstDelta = winner.delta;
  for (const c of cands) {
    if (Math.abs(c.pos - winner.pos) > 0.001) continue;
    if (c.from < from) from = c.from;
    if (c.to > to) to = c.to;
    // Distance pill shows the worst-case correction among merged candidates,
    // not the average (per DDR-046 — "render the pixels the user actually
    // had to be corrected by").
    if (Math.abs(c.delta) > Math.abs(worstDelta)) worstDelta = c.delta;
  }
  return { axis, pos: winner.pos, from, to, delta: worstDelta, kind: winner.kind };
}

export function computeSnap(proposed: Rect, others: Rect[], opts: SnapOptions): SnapResult {
  if (opts.disabled) {
    return { x: proposed.x, y: proposed.y, guides: [] };
  }
  const { gridSize, tolerance } = opts;
  const intent = opts.intent ?? 'layout';
  const propLeft = proposed.x;
  const propRight = proposed.x + proposed.w;
  const propCenterX = proposed.x + proposed.w / 2;
  const propTop = proposed.y;
  const propBottom = proposed.y + proposed.h;
  const propCenterY = proposed.y + proposed.h / 2;

  const xCands: AxisCandidate[] = [];
  const yCands: AxisCandidate[] = [];

  // Grid candidates — left edge for X, top edge for Y. Perpendicular extent
  // is just the proposed rect's own range (no sibling involved). Grid is the
  // one source active under BOTH intent presets (T7 Design Decision 4).
  const gridX = nearestGridDelta(propLeft, gridSize, tolerance);
  if (gridX !== null) {
    xCands.push({
      delta: gridX,
      pos: propLeft + gridX,
      from: propTop,
      to: propBottom,
      kind: 'grid',
    });
  }
  const gridY = nearestGridDelta(propTop, gridSize, tolerance);
  if (gridY !== null) {
    yCands.push({
      delta: gridY,
      pos: propTop + gridY,
      from: propLeft,
      to: propRight,
      kind: 'grid',
    });
  }

  // T7 — generic-layout-guide-line candidates ("Layout" intent only). Each
  // world-space line is tested the same three ways a sibling edge/center is
  // (leading edge, trailing edge, center) — Figma's own layout-guide snap
  // behavior — so a guide line snaps whichever part of the proposed rect
  // lands closest, not just its leading edge (unlike the grid pass above).
  if (intent === 'layout') {
    for (const g of opts.guideLines ?? []) {
      if (g.axis === 'x') {
        for (const propCoord of [propLeft, propRight, propCenterX]) {
          const delta = g.pos - propCoord;
          if (Math.abs(delta) > tolerance) continue;
          xCands.push({
            delta,
            pos: g.pos,
            from: Math.min(propTop, g.from),
            to: Math.max(propBottom, g.to),
            kind: 'guide',
          });
        }
      } else {
        for (const propCoord of [propTop, propBottom, propCenterY]) {
          const delta = g.pos - propCoord;
          if (Math.abs(delta) > tolerance) continue;
          yCands.push({
            delta,
            pos: g.pos,
            from: Math.min(propLeft, g.from),
            to: Math.max(propRight, g.to),
            kind: 'guide',
          });
        }
      }
    }
  }

  // Sibling candidates ("Layout" intent only — "Pixel" is grid-only per T7
  // Design Decision 4).
  for (const other of intent === 'layout' ? others : []) {
    const oLeft = other.x;
    const oRight = other.x + other.w;
    const oCenterX = other.x + other.w / 2;
    const oTop = other.y;
    const oBottom = other.y + other.h;
    const oCenterY = other.y + other.h / 2;

    // X-axis pairs: (propCoord, otherCoord).
    const xPairs: Array<[number, number]> = [
      [propLeft, oLeft],
      [propRight, oRight],
      [propLeft, oRight],
      [propRight, oLeft],
      [propCenterX, oCenterX],
    ];
    for (const [propCoord, otherCoord] of xPairs) {
      const delta = otherCoord - propCoord;
      if (Math.abs(delta) > tolerance) continue;
      xCands.push({
        delta,
        pos: otherCoord,
        from: Math.min(propTop, oTop),
        to: Math.max(propBottom, oBottom),
        kind: 'sibling',
      });
    }

    // Y-axis pairs.
    const yPairs: Array<[number, number]> = [
      [propTop, oTop],
      [propBottom, oBottom],
      [propTop, oBottom],
      [propBottom, oTop],
      [propCenterY, oCenterY],
    ];
    for (const [propCoord, otherCoord] of yPairs) {
      const delta = otherCoord - propCoord;
      if (Math.abs(delta) > tolerance) continue;
      yCands.push({
        delta,
        pos: otherCoord,
        from: Math.min(propLeft, oLeft),
        to: Math.max(propRight, oRight),
        kind: 'sibling',
      });
    }
  }

  // S2.22 — equal-gap landings (Layout intent: they are siblings' business, not the grid's)
  if (intent === 'layout') {
    for (const axis of ['x', 'y'] as const) {
      const prop = axis === 'x' ? propLeft : propTop;
      for (const land of equalGapLandings(proposed, others, axis)) {
        const delta = land - prop;
        if (Math.abs(delta) > tolerance) continue;
        (axis === 'x' ? xCands : yCands).push({
          delta,
          pos: land,
          from: axis === 'x' ? propTop : propLeft,
          to: axis === 'x' ? propBottom : propRight,
          kind: 'sibling',
          rhythm: true,
        });
      }
    }
  }

  const winX = pickClosest(xCands);
  const winY = pickClosest(yCands);

  const guides: SnapGuide[] = [];
  // a rhythm landing draws no line of its own: the equal-gap chips are its picture
  if (winX && !winX.rhythm) guides.push(mergeAtPos('x', winX, xCands));
  if (winY && !winY.rhythm) guides.push(mergeAtPos('y', winY, yCands));

  return {
    x: proposed.x + (winX ? winX.delta : 0),
    y: proposed.y + (winY ? winY.delta : 0),
    guides,
  };
}
