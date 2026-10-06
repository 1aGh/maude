/**
 * Arrow / connector (DDR-242). Stores its two ENDS only — never its computed
 * endpoints. An end is either free (`{x, y}`, parent space) or bound to an
 * element: `{el}` = auto (re-faces the other end as things move, FigJam
 * connector behaviour), `{el, nx, ny}` = pinned to a magnet on the host's box.
 * Moving a host therefore writes only the host; every reader derives the
 * endpoints through `arrowEnds`.
 */

import { ARROW_HEADS, ARROW_LINES, DEFAULT_INK } from '../constants.ts';
import { bool, color, type FieldSpec, id, num, oneOf, round } from '../fields.ts';
import type { AnnotationElement, ArrowEnd, Box, ElementDef, GeomCtx } from '../types.ts';
import { get, pointSegmentDist, rotatePoint } from './_shared.ts';

const MAGNETS = [0, 0.5, 1] as const;

/** Snap a normalized coordinate to the nearest {0, ½, 1} magnet. */
export function snapMagnet(v: number): number {
  let best: number = MAGNETS[0];
  for (const m of MAGNETS) if (Math.abs(v - m) < Math.abs(v - best)) best = m;
  return best;
}

const elId = id(true);
const coord = num({ required: true });
const unit = num({ min: 0, max: 1, dp: 3 });

/** An arrow end: `{el}` | `{el, nx, ny}` | `{x, y}`. Half-specified magnets collapse to auto. */
export function arrowEnd(): FieldSpec<ArrowEnd> {
  return {
    required: true,
    eq: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    parse(raw) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
      const r = raw as Record<string, unknown>;
      if (r.el !== undefined) {
        const el = elId.parse(r.el);
        if (el === undefined) return undefined;
        const nx = unit.parse(r.nx);
        const ny = unit.parse(r.ny);
        return nx !== undefined && ny !== undefined ? { el, nx, ny } : { el };
      }
      const x = coord.parse(r.x);
      const y = coord.parse(r.y);
      return x !== undefined && y !== undefined ? { x, y } : undefined;
    },
  };
}

const FIELDS = {
  start: arrowEnd(),
  end: arrowEnd(),
  color: color(DEFAULT_INK),
  width: num({ min: 0.5, max: 64, dp: 1, def: 2 }),
  startHead: oneOf(ARROW_HEADS, 'none'),
  endHead: oneOf(ARROW_HEADS, 'triangle'),
  dashed: bool(),
  line: oneOf(ARROW_LINES, 'straight'),
};

export interface ResolvedArrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The magnet each bound end actually attaches to (auto ends: the facing side). */
  startAnchor?: { el: string; nx: number; ny: number };
  endAnchor?: { el: string; nx: number; ny: number };
}

/** Side magnet of `box` facing the world point (tx, ty) — FigJam auto-routing. */
export function facingAnchor(box: Box, tx: number, ty: number): { nx: number; ny: number } {
  const dx = tx - (box.x + box.w / 2);
  const dy = ty - (box.y + box.h / 2);
  const rx = Math.abs(dx) / Math.max(1, box.w / 2);
  const ry = Math.abs(dy) / Math.max(1, box.h / 2);
  return rx >= ry ? { nx: dx >= 0 ? 1 : 0, ny: 0.5 } : { nx: 0.5, ny: dy >= 0 ? 1 : 0 };
}

/** World point of a normalized anchor on a (possibly rotated) box. */
export function anchorPoint(box: Box, rot: number, nx: number, ny: number): [number, number] {
  return rotatePoint(
    box.x + nx * box.w,
    box.y + ny * box.h,
    box.x + box.w / 2,
    box.y + box.h / 2,
    rot
  );
}

/**
 * Resolve both endpoints in PARENT space. A bound end whose host is missing or
 * no longer bindable resolves to null (the op layer freezes such ends into free
 * points at delete time — see ops.ts `unbindFrom`).
 */
export function arrowEnds(el: AnnotationElement, ctx: GeomCtx): ResolvedArrow | null {
  const start = el.start as ArrowEnd | undefined;
  const end = el.end as ArrowEnd | undefined;
  if (!start || !end) return null;
  const host = (e: ArrowEnd) => ('el' in e ? ctx.resolve(e.el) : null);
  const sHost = host(start);
  const eHost = host(end);
  if (('el' in start && !sHost?.bindable) || ('el' in end && !eHost?.bindable)) return null;
  const world = (e: ArrowEnd): [number, number] | null =>
    'el' in e ? null : [e.x + ctx.origin.x, e.y + ctx.origin.y];
  const center = (h: { box: Box } | null): [number, number] | null =>
    h ? [h.box.x + h.box.w / 2, h.box.y + h.box.h / 2] : null;
  // Auto ends face the OTHER end: its host's center, else its free point.
  const startRef = center(eHost) ?? world(end) ?? [0, 0];
  const endRef = center(sHost) ?? world(start) ?? [0, 0];
  const out: Partial<ResolvedArrow> = {};
  const place = (e: ArrowEnd, h: typeof sHost, ref: [number, number], which: 'start' | 'end') => {
    let p: [number, number];
    if ('el' in e && h) {
      const mag =
        e.nx !== undefined && e.ny !== undefined
          ? { nx: e.nx, ny: e.ny }
          : facingAnchor(h.box, ref[0], ref[1]);
      p = anchorPoint(h.box, h.rot, mag.nx, mag.ny);
      out[which === 'start' ? 'startAnchor' : 'endAnchor'] = { el: e.el, ...mag };
    } else {
      p = world(e) as [number, number];
    }
    const x = round(p[0] - ctx.origin.x, 2);
    const y = round(p[1] - ctx.origin.y, 2);
    if (which === 'start') {
      out.x1 = x;
      out.y1 = y;
    } else {
      out.x2 = x;
      out.y2 = y;
    }
  };
  place(start, sHost, startRef, 'start');
  place(end, eHost, endRef, 'end');
  return out as ResolvedArrow;
}

export const arrow: ElementDef = {
  type: 'arrow',
  fields: FIELDS,
  caps: {
    box: false,
    rotatable: false,
    resizable: true,
    bindable: false,
    container: false,
    textSlot: null,
  },
  bounds(el, ctx) {
    const r = arrowEnds(el, ctx);
    if (!r) return null;
    return {
      x: Math.min(r.x1, r.x2),
      y: Math.min(r.y1, r.y2),
      w: Math.abs(r.x2 - r.x1),
      h: Math.abs(r.y2 - r.y1),
    };
  },
  hitTest(el, px, py, tol, ctx) {
    const r = arrowEnds(el, ctx);
    if (!r) return false;
    const t = Math.max(tol, get<number>(FIELDS, el, 'width'));
    return pointSegmentDist(px, py, r.x1, r.y1, r.x2, r.y2) <= t;
  },
  // Only FREE ends move; bound ends follow their hosts.
  translate(el, dx, dy) {
    const patch: Record<string, unknown> = {};
    for (const k of ['start', 'end'] as const) {
      const e = el[k] as ArrowEnd | undefined;
      if (e && !('el' in e)) patch[k] = { x: e.x + dx, y: e.y + dy };
    }
    return patch;
  },
  resize(el, box, ctx) {
    const r = arrowEnds(el, ctx);
    const cur = arrow.bounds(el, ctx);
    if (!r || !cur) return {};
    const sx = cur.w > 0 ? box.w / cur.w : 1;
    const sy = cur.h > 0 ? box.h / cur.h : 1;
    const patch: Record<string, unknown> = {};
    for (const k of ['start', 'end'] as const) {
      const e = el[k] as ArrowEnd | undefined;
      if (!e || 'el' in e) continue;
      patch[k] = { x: box.x + (e.x - cur.x) * sx, y: box.y + (e.y - cur.y) * sy };
    }
    return patch;
  },
  meaningful(el) {
    const s = el.start as ArrowEnd | undefined;
    const e = el.end as ArrowEnd | undefined;
    if (!s || !e) return false;
    if ('el' in s || 'el' in e) return !('el' in s && 'el' in e && s.el === e.el);
    return Math.hypot(e.x - s.x, e.y - s.y) >= 4;
  },
};
