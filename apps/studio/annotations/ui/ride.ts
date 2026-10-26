/**
 * @file       annotations/ui/ride.ts — annotations ride with their artboard (S4.10)
 * @scope      apps/studio/annotations/ui/ride.ts
 * @purpose    S4 Q3 + contract `client/v2/contracts/S2-S4-artboard-motion-ids.md`
 *             §1–§2. Membership is `parentArtboard` (x/y stay WORLD, so a v1 peer
 *             sees members where they are); this module answers, purely:
 *
 *               - `membershipAt`   which artboard an element belongs to when it is
 *                                  created or dropped (its centre; empty canvas = none);
 *               - `rideSetFor`     what a drag moves: the members that translate
 *                                  rigidly, and the arrows whose ends must re-route;
 *               - `riderOps`       the ONE op batch a commit hands the bus — members'
 *                                  `x`/`y` (a marker's `points`), and the bound arrows'
 *                                  cached free points + host `box` — every field with
 *                                  `expect`, so the server's move-delta rule
 *                                  (`routes/canvas-meta-rider.ts`) accepts it and the
 *                                  legacy ⌘Z can invert it;
 *               - `createRideController`  the drag-bus frame subscriber: members on
 *                                  screen + live re-route, through an imperative sink.
 *                                  It never touches React state, so a 60 fps drag
 *                                  re-renders nothing (Risk 1).
 *
 *             A section owns its members ("section wins"): an item inside a section
 *             goes where its top-level section goes, whatever its own
 *             `parentArtboard` says. A locked item still follows (the rider is not a
 *             UI edit, so the lock guard does not apply). Loose notes — no
 *             `parentArtboard` — stay where they are.
 */

import { arrowPrimitives, type SvgPrimitive } from '../../canvas-arrowheads.ts';
import { artboardMembers } from '../artboard-members.ts';
import { parseHostRef } from '../elements/_shared.ts';
import { type CanvasHostBind, type HostBox, type HostRects, hostEndpoint } from '../hosts.ts';
import type { Op } from '../ops.ts';
import type { ArrowRouter, Point, RouteJob } from '../route.ts';
import { Scene } from '../scene.ts';
import type { AnnotationElement } from '../types.ts';

export type Rect = { x: number; y: number; w: number; h: number };
export type LayoutRect = Rect & { id: string };
export type Delta = { dx: number; dy: number };
export type MovedBoard = { id: string; dx: number; dy: number };

const r2 = (v: number): number => Math.round(v * 100) / 100;
const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isFree = (v: unknown): v is { x: number; y: number } =>
  isRec(v) &&
  !('el' in v) &&
  typeof v.x === 'number' &&
  typeof v.y === 'number' &&
  Number.isFinite(v.x) &&
  Number.isFinite(v.y);
const hostOf = (el: AnnotationElement, end: 'start' | 'end'): CanvasHostBind | null => {
  const h = el[end === 'start' ? 'startHost' : 'endHost'];
  return isRec(h) && typeof h.ref === 'string' && parseHostRef(h.ref)
    ? (h as unknown as CanvasHostBind)
    : null;
};
const hostArtboard = (bind: CanvasHostBind | null): string | null =>
  bind ? (parseHostRef(bind.ref)?.artboard ?? null) : null;
const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// ─────────────────────────────────────────────────────────────────────────────
// Membership on create / drop

/**
 * The artboard under a world point (the element's centre), or null on the empty
 * canvas. The TOP-most artboard wins where two overlap (later in the layout =
 * painted later).
 */
export function membershipAt(layout: readonly LayoutRect[], cx: number, cy: number): string | null {
  for (let i = layout.length - 1; i >= 0; i--) {
    const r = layout[i] as LayoutRect;
    if (inside(r, cx, cy)) return r.id;
  }
  return null;
}

/**
 * Membership for the elements a UI commit created or moved (`changed`), against
 * the committed layout: a top-level element's centre decides; an element inside a
 * section takes none (its section rides for it). Returns id → artboard | null
 * (null = drop the membership: it now sits on the empty canvas).
 */
export function membershipFor(
  next: ReadonlyMap<string, AnnotationElement>,
  changed: Iterable<string>,
  layout: readonly LayoutRect[]
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!layout.length) return out;
  const scene = new Scene(next.values());
  for (const id of changed) {
    const el = next.get(id);
    if (!el || el.parent !== undefined) continue;
    let cx: number;
    let cy: number;
    if (el.type === 'arrow') {
      const a = scene.arrowWorld(el);
      if (!a) continue;
      cx = (a.x1 + a.x2) / 2;
      cy = (a.y1 + a.y2) / 2;
    } else {
      const b = scene.worldBox(el);
      if (!b) continue;
      cx = b.x + b.w / 2;
      cy = b.y + b.h / 2;
    }
    out.set(id, membershipAt(layout, cx, cy));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// What a gesture moves

export interface RideSet {
  /** Element id → the delta it translates by (members, their nested items, rigid arrows). */
  rigid: Map<string, Delta>;
  /** Arrows whose ends move but not rigidly: they re-route live. */
  live: string[];
  /** A live arrow's carrier: the delta its FREE ends ride by (its own membership), when it has one. */
  carry: Map<string, Delta>;
  /** The artboard each rigid element / carried arrow rides with (a frame's delta is looked up here). */
  owner: Map<string, string>;
}

/**
 * Members of each moved artboard (`artboardMembers`: `parentArtboard`, sections
 * carry their items); an element claimed by two artboards takes the first. A
 * loose arrow (no `parentArtboard`) never rides as a whole — loose things stay —
 * so its free end stays put and only its bound ends follow (live).
 */
export function rideSetFor(
  elements: readonly AnnotationElement[],
  moved: readonly MovedBoard[]
): RideSet {
  const rigid = new Map<string, Delta>();
  const owner = new Map<string, string>();
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const m of moved) {
    for (const id of artboardMembers(elements, [m.id])) {
      if (owner.has(id)) continue;
      const el = byId.get(id);
      // artboardMembers' rule 3 (a loose arrow bound only to the artboard) is for trash, not riding.
      if (
        el &&
        el.type === 'arrow' &&
        el.parent === undefined &&
        typeof el.parentArtboard !== 'string'
      )
        continue;
      owner.set(id, m.id);
      rigid.set(id, { dx: m.dx, dy: m.dy });
    }
  }
  const movedIds = new Map(moved.map((m) => [m.id, m]));
  const live: string[] = [];
  const carry = new Map<string, Delta>();
  for (const el of elements) {
    if (el.type !== 'arrow') continue;
    // An arrow is rigid only when everything it is bound to rides with the SAME artboard.
    const ab = owner.get(el.id) ?? null;
    const ends: Array<string | null> = [];
    for (const end of ['start', 'end'] as const) {
      const host = hostArtboard(hostOf(el, end));
      if (host) {
        ends.push(movedIds.has(host) ? host : '');
        continue;
      }
      const v = el[end];
      if (isRec(v) && typeof v.el === 'string') ends.push(owner.get(v.el) ?? '');
      else ends.push(ab); // a free end goes where the arrow goes
    }
    if (ab !== null && ends.every((e) => e === ab)) continue;
    if (ab !== null) {
      carry.set(el.id, rigid.get(el.id) as Delta); // owner keeps the artboard
      rigid.delete(el.id);
    }
    if (ab !== null || ends.some((e) => e !== null && e !== '')) live.push(el.id);
  }
  return { rigid, live, carry, owner };
}

// ─────────────────────────────────────────────────────────────────────────────
// The commit: one op batch, every field with `expect`

/** A host's world box after the move, or null when it cannot be resolved. */
export type HostBoxAfter = (bind: CanvasHostBind) => HostBox | null;

/**
 * Host boxes after a move: an `ab:` host is its layout rect (+ its delta when it
 * moved); an `el:` host is its cached `box` (or the element snapshot) carried by
 * its artboard's delta.
 */
export function hostBoxesAfter(
  layout: readonly LayoutRect[],
  moved: readonly MovedBoard[],
  elementRects?: HostRects | null
): HostBoxAfter {
  const rects = new Map(layout.map((r) => [r.id, r]));
  const delta = new Map(moved.map((m) => [m.id, m]));
  const snap = new Map<string, Rect>();
  for (const e of elementRects?.elements ?? []) {
    if (!e.cdId || !e.artboard) continue;
    const k = `${e.artboard}/${e.cdId}`;
    if (!snap.has(k)) snap.set(k, { x: e.x, y: e.y, w: e.w, h: e.h });
  }
  return (bind) => {
    const p = parseHostRef(bind.ref);
    if (!p) return null;
    const d = delta.get(p.artboard);
    const dx = d?.dx ?? 0;
    const dy = d?.dy ?? 0;
    let base: Rect | null | undefined;
    if (p.kind === 'ab') base = rects.get(p.artboard) ?? bind.box;
    else base = (p.occurrence ? undefined : snap.get(`${p.artboard}/${p.element}`)) ?? bind.box;
    if (!base || !(base.w > 0) || !(base.h > 0)) return null;
    // A layout rect is the committed (pre-move) position; a cached box is too.
    return { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h };
  };
}

const boxR = (b: HostBox): HostBox => ({ x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) });
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The rider of one artboard-position commit. Only what the server's move-delta
 * rule admits (`routes/canvas-meta-rider.ts`): a TOP-LEVEL member's `x`/`y`
 * (a marker's `points`; a member arrow's free ends), shifted by exactly its
 * artboard's delta; and an arrow bound to a moved artboard (or an element on
 * it): its host ends' cached free points and the binds' `box`. Never a loose
 * note, never a put/delete/unset. Null when nothing rides.
 */
export function riderOps(
  elements: readonly AnnotationElement[],
  moved: readonly MovedBoard[],
  boxAfter: HostBoxAfter
): Op[] | null {
  if (!moved.length) return null;
  const delta = new Map(moved.map((m) => [m.id, m]));
  const scene = new Scene(elements);
  const ops: Op[] = [];
  const shiftPt = (p: { x: number; y: number }, d: Delta) => ({
    x: r2(p.x + d.dx),
    y: r2(p.y + d.dy),
  });
  for (const el of elements) {
    const parentAb = typeof el.parentArtboard === 'string' ? el.parentArtboard : null;
    const d = parentAb ? delta.get(parentAb) : undefined;
    // "Section wins": only a top-level element is a member in its own right.
    const member = !!d && el.parent === undefined;
    const set: Record<string, unknown> = {};
    const expect: Record<string, unknown> = {};
    const put = (k: string, before: unknown, after: unknown) => {
      if (sameJson(before, after)) return;
      set[k] = after;
      expect[k] = before;
    };
    if (el.type === 'arrow') {
      const hosts = { start: hostOf(el, 'start'), end: hostOf(el, 'end') };
      const hostMoved = (['start', 'end'] as const).some((k) => {
        const a = hostArtboard(hosts[k]);
        return a !== null && delta.has(a);
      });
      if (!member && !hostMoved) continue;
      const world = scene.arrowWorld(el);
      if (!world) continue;
      // The parent's origin AFTER the move: a section that rides carries its items.
      const o0 = scene.originOf(el);
      const top = scene.ancestors(el.id).at(-1);
      const topEl = top ? scene.get(top) : undefined;
      const td =
        topEl && typeof topEl.parentArtboard === 'string' && topEl.parent === undefined
          ? delta.get(topEl.parentArtboard)
          : undefined;
      const o = td ? { x: o0.x + td.dx, y: o0.y + td.dy } : o0;
      // World points after the move: free ends ride with a member arrow; el-bound ends are live.
      const pts = {
        start: { x: world.x1, y: world.y1 },
        end: { x: world.x2, y: world.y2 },
      };
      for (const k of ['start', 'end'] as const) {
        if (!hosts[k] && member && d && isFree(el[k])) pts[k] = shiftPt(pts[k], d);
      }
      const boxes = {
        start: hosts.start ? boxAfter(hosts.start) : null,
        end: hosts.end ? boxAfter(hosts.end) : null,
      };
      for (const k of ['start', 'end'] as const) {
        const bind = hosts[k];
        const box = boxes[k];
        if (!bind || !box) continue;
        const other = k === 'start' ? 'end' : 'start';
        const otherBox = boxes[other];
        const ref: [number, number] = otherBox
          ? [otherBox.x + otherBox.w / 2, otherBox.y + otherBox.h / 2]
          : [pts[other].x, pts[other].y];
        const [x, y] = hostEndpoint(box, bind, ref);
        pts[k] = { x, y };
      }
      for (const k of ['start', 'end'] as const) {
        const bind = hosts[k];
        const cur = el[k];
        if (!isFree(cur)) continue; // an end bound to an annotation resolves live
        const hostAb = hostArtboard(bind);
        const allowed = member || (hostAb !== null && delta.has(hostAb));
        if (!allowed) continue;
        if (!bind && !member) continue;
        put(k, cur, { x: r2(pts[k].x - o.x), y: r2(pts[k].y - o.y) });
        const box = boxes[k];
        if (bind && box) {
          const next = { ...bind, box: boxR(box) };
          put(k === 'start' ? 'startHost' : 'endHost', bind, next);
        }
      }
    } else if (member && d) {
      if (el.type === 'pen' && Array.isArray(el.points)) {
        const p = el.points as number[];
        put(
          'points',
          p,
          p.map((v, i) => r2(v + (i % 2 === 0 ? d.dx : d.dy)))
        );
      } else {
        if (typeof el.x === 'number') put('x', el.x, r2(el.x + d.dx));
        if (typeof el.y === 'number') put('y', el.y, r2(el.y + d.dy));
      }
    }
    if (Object.keys(set).length) ops.push({ op: 'patch', id: el.id, set, expect });
  }
  return ops.length ? ops : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live re-route

/** The first obstacle a straight segment crosses (Liang–Barsky against each rect), or null. */
export function straightCrosses<T extends Rect>(
  a: Point,
  b: Point,
  obstacles: readonly T[]
): T | null {
  for (const r of obstacles) {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    };
    if (
      clip(-dx, a.x - r.x) &&
      clip(dx, r.x + r.w - a.x) &&
      clip(-dy, a.y - r.y) &&
      clip(dy, r.y + r.h - a.y) &&
      t1 - t0 > 1e-6
    )
      return r;
  }
  return null;
}

/** The words of the refused-straight tag (CONTRACT §3 voice). */
export const crossTag = (label: string): string => `the straight line would cross ${label}`;

/** p8-r11-15 (15 an-follow): the bubble over a detoured route while the artboard is still in hand. */
export const ROUTE_BUBBLE = 'Let go — the shortest clean path';

/**
 * Where the bubble sits: the middle of the routed line's longest segment (the stretch that goes around the
 * obstacle). A route with no detour (two points) has none.
 */
export function routeBubbleAt(points: readonly Point[]): Point | null {
  if (points.length < 3) return null;
  let best = 0;
  let at: Point | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return at;
}

export interface LiveArrow {
  id: string;
  /** The arrow as it should be drawn this frame (WORLD points, routed when elbow). */
  points: Point[];
  /** SVG primitives (shaft + heads) for the sink to draw. */
  prims: SvgPrimitive[];
  color: string;
  width: number;
  /** The refused-straight tag, when the straight line would cross an artboard. */
  tag: { text: string; at: Point } | null;
  /** "Let go — the shortest clean path": while dragging, on a route that goes around an artboard; never at rest. */
  route: { text: string; at: Point } | null;
}

/** The imperative surface the controller draws through (the layer's DOM; a fake in tests). */
export interface RideSink {
  translate(id: string, dx: number, dy: number): void;
  /** Hide (true) / show (false) an element's own node while its live copy is drawn. */
  hide(id: string, hidden: boolean): void;
  arrow(a: LiveArrow, phase: 'drag' | 'settle'): void;
  /** Remove every translate, live arrow and tag; show every hidden node. */
  clear(): void;
}

export interface RideDeps {
  elements(): readonly AnnotationElement[];
  layoutRects(): readonly LayoutRect[];
  /** One `__maudeCanvasRects()` snapshot, taken at `start` only (no DOM in a move frame). */
  elementRects(): HostRects | null;
  labelOf(artboardId: string): string;
  router: ArrowRouter;
  sink: RideSink;
  /** Schedules the settle ticks (rAF in the layer). */
  schedule(fn: () => void): void;
  /** How long the overlay waits for the committed board before it lets go (ms). */
  holdMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface DragFrameLike {
  phase: 'start' | 'move' | 'end' | 'cancel';
  moved: ReadonlyArray<{ id: string; dx: number; dy: number }>;
  startRects: Readonly<Record<string, Rect>>;
  alt: boolean;
}

export interface RideController {
  onFrame(f: DragFrameLike): void;
  /** The board changed: drop the hold once the members are where the commit put them. */
  boardChanged(): void;
  /** True between `start` and the moment the committed board lands (or the hold expires). */
  active(): boolean;
  dispose(): void;
}

/**
 * The drag-bus subscriber (contract §1 "What S4.10 does with it"): members
 * translate on screen; non-rigid bound arrows re-route through the budgeted
 * router (grid 40 while dragging, grid 20 on settle). Writes nothing — the
 * commit goes through the bus rider.
 */
export function createRideController(deps: RideDeps): RideController {
  const holdMs = deps.holdMs ?? 4000;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let set: RideSet | null = null;
  let els: readonly AnnotationElement[] = [];
  let byId = new Map<string, AnnotationElement>();
  let scene: Scene | null = null;
  let snapshot: HostRects | null = null;
  let last: MovedBoard[] = [];
  let expected = new Map<string, unknown>();
  let hold: unknown = null;
  let settling = false;

  const reset = () => {
    if (hold !== null) clearTimer(hold);
    hold = null;
    set = null;
    settling = false;
    expected = new Map();
    deps.router.clear();
    deps.sink.clear();
  };

  const draw = (moved: readonly MovedBoard[], mode: 'drag' | 'settle'): number => {
    if (!set || !scene) return 0;
    const delta = new Map(moved.map((m) => [m.id, m]));
    // THIS frame's delta of the artboard an element rides with (never the start frame's).
    const own = set.owner;
    const dOf = (id: string): Delta | undefined => {
      const ab = own.get(id);
      return ab ? delta.get(ab) : undefined;
    };
    for (const id of set.rigid.keys()) {
      const d = dOf(id);
      if (d) deps.sink.translate(id, d.dx, d.dy);
    }
    if (!set.live.length) return 0;
    const layout = deps.layoutRects();
    const boards = layout.map((r) => {
      const d = delta.get(r.id);
      return d ? { ...r, x: r.x + d.dx, y: r.y + d.dy } : { ...r };
    });
    const boxAfter = hostBoxesAfter(layout, moved, snapshot);
    const jobs: RouteJob[] = [];
    const geo = new Map<
      string,
      { a: Point; b: Point; el: AnnotationElement; elbow: boolean; own: Set<string> }
    >();
    for (const id of set.live) {
      const el = byId.get(id);
      const w = el ? scene.arrowWorld(el) : null;
      if (!el || !w) continue;
      const pts = { start: { x: w.x1, y: w.y1 }, end: { x: w.x2, y: w.y2 } };
      const own = new Set<string>();
      const hosts = { start: hostOf(el, 'start'), end: hostOf(el, 'end') };
      const boxes: Record<'start' | 'end', HostBox | null> = { start: null, end: null };
      for (const k of ['start', 'end'] as const) {
        const bind = hosts[k];
        if (bind) {
          const ab = hostArtboard(bind);
          if (ab) own.add(ab);
          boxes[k] = boxAfter(bind);
          continue;
        }
        const v = el[k];
        if (isRec(v) && typeof v.el === 'string') {
          const d = set.rigid.has(v.el) ? dOf(v.el) : undefined;
          if (d) pts[k] = { x: pts[k].x + d.dx, y: pts[k].y + d.dy };
        } else {
          const d = set.carry.has(id) ? dOf(id) : undefined;
          if (d) pts[k] = { x: pts[k].x + d.dx, y: pts[k].y + d.dy };
        }
      }
      for (const k of ['start', 'end'] as const) {
        const bind = hosts[k];
        const box = boxes[k];
        if (!bind || !box) continue;
        const other = k === 'start' ? 'end' : 'start';
        const ob = boxes[other];
        const ref: [number, number] = ob
          ? [ob.x + ob.w / 2, ob.y + ob.h / 2]
          : [pts[other].x, pts[other].y];
        const [x, y] = hostEndpoint(box, bind, ref);
        pts[k] = { x, y };
      }
      // An artboard an end sits on is not an obstacle for that arrow.
      for (const b of boards) {
        if (inside(b, pts.start.x, pts.start.y) || inside(b, pts.end.x, pts.end.y)) own.add(b.id);
      }
      const elbow = el.line === 'elbow';
      geo.set(id, { a: pts.start, b: pts.end, el, elbow, own });
      if (elbow)
        jobs.push({
          id,
          start: pts.start,
          goal: pts.end,
          obstacles: boards
            .filter((b) => !own.has(b.id))
            .map((b) => ({ x: b.x, y: b.y, width: b.w, height: b.h })),
        });
    }
    const report = jobs.length ? deps.router.frame(jobs, mode) : null;
    for (const [id, g] of geo) {
      const routed = report?.routes.get(id)?.points;
      const points = g.elbow && routed && routed.length >= 2 ? routed : [g.a, g.b];
      let tag: LiveArrow['tag'] = null;
      if (g.elbow) {
        const hit = straightCrosses(
          g.a,
          g.b,
          boards.filter((b) => !g.own.has(b.id))
        );
        if (hit)
          tag = {
            text: crossTag(deps.labelOf(hit.id)),
            at: { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 },
          };
      }
      const prims = g.elbow ? polylinePrims(points, g.el) : primsFor(g.el, g.a, g.b);
      const bubbleAt = tag && mode === 'drag' ? routeBubbleAt(points) : null;
      deps.sink.arrow(
        {
          id,
          points,
          prims,
          color: typeof g.el.color === 'string' ? g.el.color : '#1a1a1a',
          width: typeof g.el.width === 'number' ? g.el.width : 2,
          tag,
          route: bubbleAt ? { text: ROUTE_BUBBLE, at: bubbleAt } : null,
        },
        mode
      );
    }
    return report?.pending ?? 0;
  };

  const settle = () => {
    if (!settling) return;
    const pending = draw(last, 'settle');
    if (pending > 0) deps.schedule(settle);
  };

  return {
    onFrame(f) {
      if (f.phase === 'start') {
        reset();
        if (f.alt || !f.moved.length) return;
        els = deps.elements();
        byId = new Map(els.map((e) => [e.id, e]));
        scene = new Scene(els);
        set = rideSetFor(els, f.moved);
        if (!set.rigid.size && !set.live.length) {
          set = null;
          return;
        }
        snapshot = set.live.length ? deps.elementRects() : null;
        for (const id of set.live) deps.sink.hide(id, true);
        last = f.moved.map((m) => ({ id: m.id, dx: m.dx, dy: m.dy }));
        draw(last, 'drag');
        return;
      }
      if (!set) return;
      if (f.phase === 'cancel') {
        reset();
        return;
      }
      last = f.moved.map((m) => ({ id: m.id, dx: m.dx, dy: m.dy }));
      if (f.phase === 'move') {
        draw(last, 'drag');
        return;
      }
      // end: settle at grid 20, then hold the picture until the committed board lands.
      settling = true;
      expected = new Map();
      const endDelta = new Map(last.map((m) => [m.id, m]));
      for (const id of set.rigid.keys()) {
        const ab = set.owner.get(id);
        const d = ab ? endDelta.get(ab) : undefined;
        const el = byId.get(id);
        if (!d) continue;
        if (el && el.parent === undefined && typeof el.x === 'number')
          expected.set(id, {
            x: r2(el.x + d.dx),
            y: typeof el.y === 'number' ? r2(el.y + d.dy) : null,
          });
      }
      settle();
      hold = setTimer(() => reset(), holdMs);
    },
    boardChanged() {
      if (!set || !settling) return;
      const now = new Map(deps.elements().map((e) => [e.id, e]));
      for (const [id, want] of expected) {
        const el = now.get(id);
        const w = want as { x: number; y: number | null };
        if (!el) continue;
        if (Math.abs((el.x as number) - w.x) > 0.5) return;
        if (w.y !== null && Math.abs((el.y as number) - w.y) > 0.5) return;
      }
      reset();
    },
    active: () => set !== null,
    dispose: reset,
  };
}

export function primsFor(el: AnnotationElement, a: Point, b: Point): SvgPrimitive[] {
  return arrowPrimitives({
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    width: typeof el.width === 'number' ? el.width : 2,
    color: typeof el.color === 'string' ? el.color : '#1a1a1a',
    ...(typeof el.startHead === 'string' ? { startHead: el.startHead } : {}),
    ...(typeof el.endHead === 'string' ? { endHead: el.endHead } : {}),
    ...(el.dashed === true ? { dashed: true } : {}),
    ...(typeof el.line === 'string' && el.line !== 'elbow' ? { lineType: el.line } : {}),
  } as Parameters<typeof arrowPrimitives>[0]);
}

/** A routed elbow: the polyline shaft plus the heads of its last / first segment. */
export function polylinePrims(points: readonly Point[], el: AnnotationElement): SvgPrimitive[] {
  const n = points.length;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${r2(p.x)} ${r2(p.y)}`).join(' ');
  const shaft: SvgPrimitive = { el: 'path', d, dash: el.dashed === true };
  // Heads: reuse arrowPrimitives on the two end segments, keep only the heads.
  const heads = (a: Point, b: Point, keep: 'start' | 'end'): SvgPrimitive[] =>
    primsFor(
      {
        ...el,
        line: 'straight',
        ...(keep === 'end' ? { startHead: 'none' } : { endHead: 'none' }),
      },
      a,
      b
    ).filter((p) => p.el !== 'line' && p.el !== 'path');
  return [
    shaft,
    ...heads(points[n - 2] as Point, points[n - 1] as Point, 'end'),
    ...heads(points[0] as Point, points[1] as Point, 'start'),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Membership on a UI commit

/**
 * `next` with membership refreshed for what this commit CREATED or MOVED (its
 * world box / arrow ends changed): a top-level element over an artboard joins
 * it, one dropped on the empty canvas leaves (S4 Q3: "set on create / drop from
 * the element's centre"). Everything else keeps what it had. Returns `next`
 * itself when nothing changes.
 */
export function withMembership(
  prev: ReadonlyMap<string, AnnotationElement>,
  next: Map<string, AnnotationElement>,
  layout: readonly LayoutRect[]
): Map<string, AnnotationElement> {
  if (!layout.length) return next;
  const before = new Scene(prev.values());
  const after = new Scene(next.values());
  const geom = (s: Scene, el: AnnotationElement): string => {
    if (el.type === 'arrow') {
      const a = s.arrowWorld(el);
      return a ? `${a.x1},${a.y1},${a.x2},${a.y2}` : '';
    }
    const b = s.worldBox(el);
    return b ? `${b.x},${b.y},${b.w},${b.h}` : '';
  };
  const changed: string[] = [];
  for (const [id, el] of next) {
    if (el.parent !== undefined) continue;
    const was = prev.get(id);
    if (!was || geom(before, was) !== geom(after, el)) changed.push(id);
  }
  if (!changed.length) return next;
  let out: Map<string, AnnotationElement> | null = null;
  for (const [id, ab] of membershipFor(next, changed, layout)) {
    const el = next.get(id) as AnnotationElement;
    const cur = typeof el.parentArtboard === 'string' ? el.parentArtboard : null;
    if (cur === ab) continue;
    if (ab !== null && !parseHostRef(`ab:${ab}`)) continue; // not a storable artboard id
    out ??= new Map(next);
    const rec: AnnotationElement = { ...el };
    if (ab === null) delete rec.parentArtboard;
    else rec.parentArtboard = ab;
    out.set(id, rec);
  }
  return out ?? next;
}

// ─────────────────────────────────────────────────────────────────────────────
// The layer's DOM sink (the one non-pure piece: React-free, imperative)

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Draws a ride into the world plane imperatively: members get a CSS `translate`
 * (composes with their `rotate`), live arrows an overlay `<g>` each, the
 * refused-straight tag a chip. Settle crossfades on `--dur-soft` (160 ms); with
 * reduced motion it jumps.
 */
/**
 * S4.18 (an-follow) — what rides is lifted above the dragged artboard for the gesture
 * (canvas-lib raises `.dc-artboard.dc-dragging` to z 5; the scene has no stacking context).
 */
export const RIDE_Z = 6;

export function createDomRideSink(
  world: () => HTMLElement | null,
  reducedMotion: () => boolean,
  /** The canvas zoom: the two chips are world-space nodes and keep their screen size by counter-scaling. */
  zoom: () => number = () => 1
): RideSink {
  const unscale = () => 1 / Math.max(zoom(), 0.01);
  const touched = new Set<HTMLElement>();
  const groups = new Map<string, SVGGElement>();
  const tags = new Map<string, HTMLElement>();
  const bubbles = new Map<string, HTMLElement>();
  let root: HTMLElement | null = null;
  let svg: SVGSVGElement | null = null;
  const nodeOf = (id: string): HTMLElement | null =>
    world()?.querySelector<HTMLElement>(
      `.dc-annot-scene > .dc-annot-el[data-id="${CSS.escape(id)}"]`
    ) ?? null;
  const ensure = (): SVGSVGElement | null => {
    const w = world();
    if (!w) return null;
    if (root && svg && root.parentElement === w) return svg;
    const doc = w.ownerDocument;
    root = doc.createElement('div');
    root.className = 'dc-annot-ride';
    root.style.zIndex = String(RIDE_Z);
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('data-testid', 'annot-ride');
    svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('class', 'dc-annot-ride-svg');
    root.appendChild(svg);
    w.appendChild(root);
    return svg;
  };
  const prim = (doc: Document, p: SvgPrimitive): SVGElement => {
    const n = doc.createElementNS(SVG_NS, p.el) as SVGElement;
    const a = (k: string, v: string | number) => n.setAttribute(k, String(v));
    switch (p.el) {
      case 'line':
        a('x1', p.x1);
        a('y1', p.y1);
        a('x2', p.x2);
        a('y2', p.y2);
        if (p.dash) a('stroke-dasharray', '6 4');
        break;
      case 'path':
        a('d', p.d);
        if (p.dash) a('stroke-dasharray', '6 4');
        break;
      case 'polyline':
      case 'polygon':
        a('points', p.points);
        a('fill', p.fill);
        break;
      case 'circle':
        a('cx', p.cx);
        a('cy', p.cy);
        a('r', p.r);
        a('fill', p.fill);
        break;
    }
    return n;
  };
  return {
    translate(id, dx, dy) {
      const n = nodeOf(id);
      if (!n) return;
      n.style.translate = `${dx}px ${dy}px`;
      n.style.zIndex = String(RIDE_Z);
      touched.add(n);
    },
    hide(id, hidden) {
      const n = nodeOf(id);
      if (!n) return;
      n.style.visibility = hidden ? 'hidden' : '';
      touched.add(n);
    },
    arrow(live, phase) {
      const s = ensure();
      if (!s) return;
      const doc = s.ownerDocument;
      const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
      g.setAttribute('data-ride-arrow', live.id);
      g.setAttribute('data-ride-phase', phase);
      g.setAttribute('stroke', live.color);
      g.setAttribute('stroke-width', String(live.width));
      g.setAttribute('stroke-linecap', 'round');
      g.setAttribute('stroke-linejoin', 'round');
      g.setAttribute('fill', 'none');
      for (const p of live.prims) g.appendChild(prim(doc, p));
      const old = groups.get(live.id);
      if (phase === 'settle' && old && !reducedMotion()) {
        // Ease the settled route in over the dragged one (--dur-soft, 160 ms).
        g.classList.add('is-settling');
        old.classList.add('is-leaving');
        s.appendChild(g);
        doc.defaultView?.requestAnimationFrame(() => g.classList.add('is-in'));
        doc.defaultView?.setTimeout(() => old.remove(), 200);
      } else {
        old?.remove();
        s.appendChild(g);
      }
      groups.set(live.id, g);
      // the let-go bubble rides with the live route and goes with the first frame that has none
      let bubble = bubbles.get(live.id);
      if (!live.route) {
        bubble?.remove();
        bubbles.delete(live.id);
      } else if (root) {
        if (!bubble) {
          bubble = doc.createElement('span');
          bubble.className = 'dc-annot-route';
          bubble.setAttribute('data-testid', 'annot-route-tag');
          root.appendChild(bubble);
          bubbles.set(live.id, bubble);
        }
        bubble.textContent = live.route.text;
        bubble.style.left = `${live.route.at.x}px`;
        bubble.style.top = `${live.route.at.y}px`;
        // bottom-centre on the point, 8 screen px above it, at the size of the page's own chips
        bubble.style.transformOrigin = '50% 100%';
        bubble.style.transform = `translate(-50%, calc(-100% - ${8 * unscale()}px)) scale(${unscale()})`;
      }
      let tag = tags.get(live.id);
      if (!live.tag) {
        tag?.remove();
        tags.delete(live.id);
        return;
      }
      if (!tag && root) {
        tag = doc.createElement('span');
        tag.className = 'dc-annot-cross';
        tag.setAttribute('data-testid', 'annot-cross-tag');
        root.appendChild(tag);
        tags.set(live.id, tag);
      }
      if (tag) {
        tag.textContent = live.tag.text;
        tag.style.left = `${live.tag.at.x}px`;
        tag.style.top = `${live.tag.at.y}px`;
        tag.style.transform = `translate(-50%, -50%) scale(${unscale()})`;
      }
    },
    clear() {
      for (const n of touched) {
        n.style.translate = '';
        n.style.visibility = '';
        n.style.zIndex = '';
      }
      touched.clear();
      groups.clear();
      tags.clear();
      bubbles.clear();
      root?.remove();
      root = null;
      svg = null;
    },
  };
}
