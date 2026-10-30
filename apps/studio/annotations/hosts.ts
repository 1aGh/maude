/**
 * @file       annotations/hosts.ts — arrow ends bound to artboards / canvas elements
 * @scope      apps/studio/annotations/hosts.ts
 * @purpose    Pure (no React, no DOM) half of the S4 bound-arrow engine. An arrow
 *             end can name a CANVAS host — `ab:<artboard>` or
 *             `el:<artboard>/<id>[#occurrence]` (V2-1.4 §4.8) — through the
 *             extension fields `startHost` / `endHost` (contract S4 Q1). The
 *             arrow's own `x1..y2` stay free points that CACHE the last resolved
 *             endpoint, so a format-1 peer draws the arrow frozen where it was.
 *
 *             Resolution is injected (`HostResolver`): the layer builds one from
 *             the live `canvas-rects` manifest plus the live drag state, a test
 *             builds one from a literal. A host the resolver cannot find is
 *             DANGLING — derived on every call, never stored (Q2): the bind is
 *             kept, the endpoint stays at its cached point, and restoring the
 *             element re-attaches it. Only a person removes the bind.
 */

import type { ArrowStroke, Stroke } from '../annotations-model.ts';
import { parseHostRef } from './elements/_shared.ts';
import { facingAnchor } from './elements/arrow.model.ts';

/** A host's box in WORLD coordinates. */
export interface HostBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * World box for an `ab:` / `el:` ref, or null when it cannot be resolved right
 * now (artboard deleted, element id gone, malformed ref). Null never mutates
 * anything — it makes the end dangling.
 */
export type HostResolver = (ref: string) => HostBox | null;

/** The `startHost` / `endHost` value (`canvasHostField`, annotations/elements/_shared.ts). */
export interface CanvasHostBind {
  /** `ab:<artboard>` | `el:<artboard>/<id>[#n]`. */
  ref: string;
  /** Pinned magnet on the host box (both or neither). Absent = auto. */
  nx?: number;
  ny?: number;
  /** The name a dangling end's card shows. */
  label: string;
  /** The host's last resolved WORLD box. */
  box?: HostBox;
}

/** An arrow stroke that may carry canvas-host binds. */
export type HostedArrow = ArrowStroke & {
  startHost?: CanvasHostBind;
  endHost?: CanvasHostBind;
};

export type ArrowEndName = 'start' | 'end';

/** How far in from a corner an auto artboard end may slide along an edge. */
export const EDGE_INSET = 12;

const COORD_DP = 100;
const r2 = (v: number): number => Math.round(v * COORD_DP) / COORD_DP;

/** The canvas-host binds of an arrow stroke (typed view; absent keys stay absent). */
export function hostsOf(s: Stroke): { startHost?: CanvasHostBind; endHost?: CanvasHostBind } {
  if (s.tool !== 'arrow') return {};
  const h = s as HostedArrow;
  return { startHost: h.startHost, endHost: h.endHost };
}

function validBox(b: HostBox | null | undefined): b is HostBox {
  return !!b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.w > 0 && b.h > 0;
}

/**
 * Resolve a ref to a usable box. A ref that is not a well-formed `ab:` / `el:`
 * host, or a degenerate box, is unresolvable — the resolver is only trusted for
 * refs that parse.
 */
export function resolveHost(resolve: HostResolver, ref: string): HostBox | null {
  if (!parseHostRef(ref)) return null;
  const box = resolve(ref);
  return validBox(box) ? box : null;
}

/**
 * World point of a resolved host end.
 *
 * - **Pinned** (`nx`/`ny`): that point on the box, exactly.
 * - **Auto element**: the side magnet facing `ref` (the other end) — FigJam
 *   connector behaviour, the same rule stroke binds use.
 * - **Auto artboard**: the facing SIDE, but the end slides along that edge to the
 *   other end's coordinate (clamped `EDGE_INSET` in from the corners), so an
 *   arrow into a long artboard leaves it where it is pointing instead of from a
 *   fixed midpoint.
 */
export function hostEndpoint(
  box: HostBox,
  bind: Pick<CanvasHostBind, 'ref' | 'nx' | 'ny'>,
  ref: readonly [number, number]
): [number, number] {
  if (bind.nx !== undefined && bind.ny !== undefined) {
    return [r2(box.x + bind.nx * box.w), r2(box.y + bind.ny * box.h)];
  }
  const face = facingAnchor(box, ref[0], ref[1]);
  const px = box.x + face.nx * box.w;
  const py = box.y + face.ny * box.h;
  if (!bind.ref.startsWith('ab:')) return [r2(px), r2(py)];
  const slide = (v: number, lo: number, len: number): number => {
    const inset = Math.min(EDGE_INSET, len / 2);
    return Math.min(lo + len - inset, Math.max(lo + inset, v));
  };
  // Left / right edge slides along y; top / bottom along x.
  return face.nx === 0.5
    ? [r2(slide(ref[0], box.x, box.w)), r2(py)]
    : [r2(px), r2(slide(ref[1], box.y, box.h))];
}

/** Box centre — the reference point the OTHER end faces. */
export function boxCenter(b: HostBox): [number, number] {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** The shapes the `canvas-rects` manifest exposes (structural: no canvas-lib import). */
export interface HostRects {
  artboards: readonly { id: string; x: number; y: number; w: number; h: number }[];
  elements: readonly {
    cdId: string | null;
    artboard: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
  }[];
}

/**
 * A resolver over the `canvas-rects` manifest. `el:<artboard>/<id>#n` is the
 * n-th element of that artboard carrying that authored id, in manifest (DOM)
 * order; a bare ref is the first. Computed (8-hex) ids never resolve.
 */
export function resolverFromRects(rects: HostRects): HostResolver {
  const boards = new Map<string, HostBox>();
  for (const a of rects.artboards) boards.set(a.id, { x: a.x, y: a.y, w: a.w, h: a.h });
  const els = new Map<string, HostBox[]>();
  for (const e of rects.elements) {
    if (!e.cdId || !e.artboard) continue;
    const k = `${e.artboard}/${e.cdId}`;
    const list = els.get(k);
    const box = { x: e.x, y: e.y, w: e.w, h: e.h };
    if (list) list.push(box);
    else els.set(k, [box]);
  }
  return (ref) => {
    const p = parseHostRef(ref);
    if (!p) return null;
    const hit =
      p.kind === 'ab'
        ? boards.get(p.artboard)
        : els.get(`${p.artboard}/${p.element}`)?.[p.occurrence ?? 0];
    return validBox(hit) ? hit : null;
  };
}

export interface DanglingEnd {
  arrowId: string;
  end: ArrowEndName;
  ref: string;
  /** The label stored on the bind — what the dangling card shows. */
  label: string;
  /** Where the end is drawn: the cached point. */
  at: [number, number];
  /** The host's last resolved WORLD box (the bind's own `box`) - where the trashed target is outlined. */
  box?: HostBox;
}

/** Every arrow end whose canvas host the resolver cannot find right now. Derived, never stored. */
export function danglingEnds(strokes: readonly Stroke[], resolve: HostResolver): DanglingEnd[] {
  const out: DanglingEnd[] = [];
  for (const s of strokes) {
    if (s.tool !== 'arrow') continue;
    const { startHost, endHost } = hostsOf(s);
    if (startHost && !resolveHost(resolve, startHost.ref))
      out.push({
        arrowId: s.id,
        end: 'start',
        ref: startHost.ref,
        label: startHost.label,
        at: [s.x1, s.y1],
        ...(startHost.box ? { box: startHost.box } : {}),
      });
    if (endHost && !resolveHost(resolve, endHost.ref))
      out.push({
        arrowId: s.id,
        end: 'end',
        ref: endHost.ref,
        label: endHost.label,
        at: [s.x2, s.y2],
        ...(endHost.box ? { box: endHost.box } : {}),
      });
  }
  return out;
}

function sameBox(a: HostBox | undefined, b: HostBox): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Re-derive one canvas-host end. Returns the arrow unchanged (same object) when
 * nothing differs; a dangling end is left exactly as cached.
 */
export function applyHostEnd(
  arrow: ArrowStroke,
  end: ArrowEndName,
  bind: CanvasHostBind,
  box: HostBox | null,
  ref: readonly [number, number]
): ArrowStroke {
  if (!box) return arrow;
  const [x, y] = hostEndpoint(box, bind, ref);
  const cur = end === 'start' ? [arrow.x1, arrow.y1] : [arrow.x2, arrow.y2];
  const rounded: HostBox = { x: r2(box.x), y: r2(box.y), w: r2(box.w), h: r2(box.h) };
  const boxChanged = !sameBox(bind.box, rounded);
  if (cur[0] === x && cur[1] === y && !boxChanged) return arrow;
  const nextBind: CanvasHostBind = boxChanged ? { ...bind, box: rounded } : bind;
  return end === 'start'
    ? ({ ...arrow, x1: x, y1: y, startHost: nextBind } as ArrowStroke)
    : ({ ...arrow, x2: x, y2: y, endHost: nextBind } as ArrowStroke);
}
