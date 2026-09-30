/**
 * @file       annotations-bindings.ts — FigJam v3 connector binding
 * @scope      apps/studio/annotations-bindings.ts
 * @purpose    Pure helpers (no React, no DOM) for arrow ↔ shape magnetic
 *             binding. Semantics follow Excalidraw's binding system + FigJam's
 *             connector magnets: bind on proximity (~15 px at 100 % zoom,
 *             callers scale by 1/zoom), anchors snap to the {0, 0.5, 1} ×
 *             {0, 0.5, 1} magnet grid over the host bbox, bound endpoints are
 *             DERIVED from the host on every mutation (`recomputeBoundArrows`),
 *             and deleting a host strips the bind but keeps the arrow with the
 *             endpoint frozen in place (Excalidraw `fixBindingsAfterDeletion`).
 */

import { defOf } from './annotations/registry.ts';
import {
  type ArrowBind,
  type ArrowStroke,
  rotatePoint,
  type Stroke,
  strokeBBox,
  strokeHitTest,
  strokeRotation,
} from './annotations-model.ts';

/**
 * The largest bbox a TEXT stroke may present as a bind target, PER AXIS.
 *
 * A `TextStroke` has no stored `w`/`h` — `strokeBBox` SYNTHESIZES one from the
 * content (`max(8, longest * fontSize * 0.55)` wide). So a long single line can
 * project a bind strip tens of thousands of px wide, and `bindCandidate` scans
 * topmost-first with no area preference: one such stroke would silently become a
 * board-wide magnet that steals every endpoint the user drags. Text bigger than
 * a plausible label is therefore not offered as a host at all (DDR-216 D9).
 */
export const MAX_TEXT_BIND_W = 1200;
export const MAX_TEXT_BIND_H = 480;

/**
 * Hosts an arrow endpoint can attach to (shapes + cards, FigJam set).
 *
 * **Widened to `text` + `section` (DDR-216 D9).** FigJam binds connectors to
 * anything, and on the only real board measured 2/2 connectors had at least one
 * endpoint Maude could not bind — so an imported connector degraded to a frozen
 * line. It is also a plain native gap: you could not attach an arrow to a text
 * label or a section, independent of import.
 *
 * Three deliberate exclusions, each closing a regression the naive widening
 * would have introduced:
 *
 *  1. **ANCHORED text is still not bindable.** `bindCandidate`/`anchorPoint`/
 *     `recomputeBoundArrows` call `strokeBBox(s)` WITHOUT the anchors map, and
 *     for a text stroke with `anchorId` that returns `null`. Admitting it would
 *     mint a bind that `anchorPoint` can never resolve — and `applyEnd` would
 *     keep it (it only strips when the host stops being bindable), freezing the
 *     arrow at stale coordinates forever. That is strictly worse than today's
 *     honest "strip the bind, freeze the endpoint". Anchored text lives inside a
 *     host shape which is itself bindable, so nothing is lost: bind to the shape.
 *  2. **Oversized text is not offered** — see `MAX_TEXT_BIND_W`/`_H`.
 *  3. **Groups are not bindable by construction** — Maude groups are a flat
 *     `groupIds[]` tag array, not addressable objects. A group-targeted import
 *     endpoint falls back to the group's geometric bbox and is reported.
 */
export function isBindable(s: Stroke): boolean {
  if (s.tool === 'element') return !!defOf(s.el.type)?.caps.bindable;
  if (
    s.tool === 'rect' ||
    s.tool === 'ellipse' ||
    s.tool === 'polygon' ||
    s.tool === 'sticky' ||
    s.tool === 'image'
  ) {
    return true;
  }
  if (s.tool === 'section') return true;
  if (s.tool === 'text') {
    if (s.anchorId) return false; // (1) — no resolvable bbox without the anchors map
    const bb = strokeBBox(s);
    // Per-AXIS, not an area product: an area cap is satisfiable by a very wide,
    // very short strip, which is precisely the board-wide magnet shape. 4 000
    // chars at the fontSize floor of 8 gives w ≈ 17 600 × h ≈ 9.6 — area 168 960,
    // comfortably under a 640×480 product (post-implementation review F8).
    return !!bb && bb.w > 0 && bb.h > 0 && bb.w <= MAX_TEXT_BIND_W && bb.h <= MAX_TEXT_BIND_H; // (2)
  }
  return false;
}

/** Bind proximity threshold in world px at zoom 1 (Excalidraw's 15 px). */
export const BIND_THRESHOLD_PX = 15;

const MAGNETS = [0, 0.5, 1] as const;

function snapMagnet(v: number): number {
  let best: number = MAGNETS[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const m of MAGNETS) {
    const d = Math.abs(v - m);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Topmost bindable host within `threshold` of the world point, with the anchor
 * snapped to the nearest side/center magnet. `excludeIds` keeps an arrow from
 * binding to a host that is itself part of the current gesture.
 */
export function bindCandidate(
  wx: number,
  wy: number,
  strokes: readonly Stroke[],
  threshold: number,
  excludeIds?: ReadonlySet<string>
): ArrowBind | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (!s || !isBindable(s) || excludeIds?.has(s.id)) continue;
    const bb = strokeBBox(s);
    if (!bb || bb.w <= 0 || bb.h <= 0) continue;
    if (
      wx < bb.x - threshold ||
      wx > bb.x + bb.w + threshold ||
      wy < bb.y - threshold ||
      wy > bb.y + bb.h + threshold
    ) {
      continue;
    }
    // A SECTION is a large container, and the natural gesture is to draw one
    // AROUND existing notes — which puts it later in the array, i.e. topmost.
    // Testing its raw bbox would make the whole interior a magnet, so every
    // arrow drawn between two stickies inside a section would bind to the
    // section instead. `strokeHitTest` already encodes the right rule (a section
    // is grabbed by its BORDER or its label chip; the interior stays
    // click-through), so defer to it rather than inventing a second geometry.
    //
    // Deliberately NOT "prefer the smallest containing bbox": containment here
    // is over a bbox INFLATED by `threshold`, so smallest-area lets an 8×8 dot
    // 14 px AWAY beat the large rect the pointer is actually inside — and it
    // inverts the visual invariant, letting a shape hidden behind an opaque one
    // win a bind the user cannot see happening (DDR-216 D9 fix 4).
    if (s.tool === 'section' && !strokeHitTest(s, wx, wy, threshold)) continue;
    return {
      hostId: s.id,
      nx: snapMagnet(clamp01((wx - bb.x) / bb.w)),
      ny: snapMagnet(clamp01((wy - bb.y) / bb.h)),
    };
  }
  return null;
}

/** World position of a normalized anchor over the host's bbox. A rotated host
 *  carries its magnets with it (the anchor rotates around the bbox center). */
export function anchorPoint(host: Stroke, nx: number, ny: number): [number, number] | null {
  const bb = strokeBBox(host);
  if (!bb) return null;
  const px = bb.x + nx * bb.w;
  const py = bb.y + ny * bb.h;
  const rot = strokeRotation(host);
  if (rot === 0) return [px, py];
  return rotatePoint(px, py, bb.x + bb.w / 2, bb.y + bb.h / 2, rot);
}

/**
 * Re-derive every bound arrow endpoint from its host. Idempotent — an endpoint
 * already at its anchor is left referentially untouched, and the ORIGINAL
 * array is returned when nothing changed (so the drag-commit no-op checks keep
 * working). A bind whose host no longer exists (or stopped being bindable) is
 * stripped with the endpoint frozen in place — the arrow survives unbound.
 *
 * FigJam v3 auto-routing: an AUTO (non-pinned) bind re-picks the side magnet
 * FACING the arrow's other end on every recompute, so a connector keeps a
 * sensible direction as the shapes move around each other. A `pinned` bind
 * (explicit user re-anchor) keeps its magnet.
 */
export function recomputeBoundArrows(strokes: readonly Stroke[]): Stroke[] {
  const byId = new Map<string, Stroke>();
  for (const s of strokes) byId.set(s.id, s);
  let mutated = false;
  const out = strokes.map((s) => {
    if (s.tool !== 'arrow' || (!s.startBind && !s.endBind)) return s;
    let next: ArrowStroke = s;
    // Opposite-end reference points for the facing computation. When both
    // ends are bound, face the OTHER HOST's center (stable under endpoint
    // churn); a free end is its literal coordinate.
    const startHost = s.startBind ? byId.get(s.startBind.hostId) : undefined;
    const endHost = s.endBind ? byId.get(s.endBind.hostId) : undefined;
    const centerOf = (host: Stroke | undefined): [number, number] | null => {
      if (!host) return null;
      const bb = strokeBBox(host);
      return bb ? [bb.x + bb.w / 2, bb.y + bb.h / 2] : null;
    };
    const startRef: [number, number] = centerOf(endHost) ?? [s.x2, s.y2];
    const endRef: [number, number] = centerOf(startHost) ?? [s.x1, s.y1];
    const applyEnd = (
      bind: ArrowBind | undefined,
      end: 'start' | 'end',
      ref: [number, number]
    ): void => {
      if (!bind) return;
      const host = byId.get(bind.hostId);
      if (!host || !isBindable(host)) {
        const copy: ArrowStroke = { ...next };
        delete copy[end === 'start' ? 'startBind' : 'endBind'];
        next = copy;
        mutated = true;
        return;
      }
      let effective = bind;
      if (!bind.pinned) {
        const facing = facingAnchor(host, ref[0], ref[1]);
        if (facing && (facing.nx !== bind.nx || facing.ny !== bind.ny)) {
          effective = { ...bind, nx: facing.nx, ny: facing.ny };
          next =
            end === 'start' ? { ...next, startBind: effective } : { ...next, endBind: effective };
          mutated = true;
        }
      }
      const pt = anchorPoint(host, effective.nx, effective.ny);
      if (!pt) {
        // The host is bindable but its bbox is unresolvable right now (e.g. a
        // text stroke whose anchors map isn't reachable from here). Returning
        // silently would KEEP a bind that can never be honoured — the arrow
        // would freeze at stale coordinates permanently, across save/load,
        // while still claiming to be attached. Strip it instead: the arrow
        // survives unbound with its endpoint frozen, which is the same honest
        // degradation a deleted host already gets. (DDR-216 D9 fix 2 — inert
        // before the `isBindable` widening, load-bearing after it.)
        const copy: ArrowStroke = { ...next };
        delete copy[end === 'start' ? 'startBind' : 'endBind'];
        next = copy;
        mutated = true;
        return;
      }
      if (end === 'start') {
        if (next.x1 !== pt[0] || next.y1 !== pt[1]) {
          next = { ...next, x1: pt[0], y1: pt[1] };
          mutated = true;
        }
      } else if (next.x2 !== pt[0] || next.y2 !== pt[1]) {
        next = { ...next, x2: pt[0], y2: pt[1] };
        mutated = true;
      }
    };
    applyEnd(s.startBind, 'start', startRef);
    applyEnd(next.endBind, 'end', endRef);
    return next;
  });
  return mutated ? out : (strokes as Stroke[]);
}

/**
 * Side-magnet anchor on `host` facing the world point `(tx, ty)` — used by the
 * AI annotate verb + quick-create to pick a sensible attachment side without a
 * pointer position: the dominant axis of the direction vector decides the
 * side, the cross axis centers.
 */
export function facingAnchor(host: Stroke, tx: number, ty: number): ArrowBind | null {
  const bb = strokeBBox(host);
  if (!bb || bb.w <= 0 || bb.h <= 0) return null;
  const cx = bb.x + bb.w / 2;
  const cy = bb.y + bb.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  // Normalize by the half-extents so a wide-but-short card still picks the
  // side the target visually faces.
  const rx = Math.abs(dx) / Math.max(1, bb.w / 2);
  const ry = Math.abs(dy) / Math.max(1, bb.h / 2);
  if (rx >= ry) {
    return { hostId: host.id, nx: dx >= 0 ? 1 : 0, ny: 0.5 };
  }
  return { hostId: host.id, nx: 0.5, ny: dy >= 0 ? 1 : 0 };
}
