// edit-ops/path-model.ts — the Pen's path as numbers (S2.14, ed-pen). Pure: no DOM, no IO, no React.
//
// A path is a list of sub-paths; a sub-path is anchors with optional Bézier handles (ABSOLUTE coordinates):
//   · a SHARP point has no handles, or handles that do not mirror each other;
//   · a SMOOTH point has an `in` and an `out` handle on one line through the anchor, on opposite sides
//     (the two ends of an open path have one handle at most, and it makes them smooth).
// The type is DERIVED, never stored — so a path survives a hand edit of its `d`, and a v1 peer reads the same
// plain `d`. `serializePath` writes the canonical form (absolute `M L C Z`, 2 decimals); `parsePathD` reads any
// `d` without arcs (relative commands, `H V S Q T` included, converted to cubics) and
// `serializePath(parsePathD(d))` is `d` for every canonical `d` (golden-tested).
//
// The same module shapes the Combine operands (a rounded rectangle, an ellipse, a polygon as sub-paths) and the
// point arithmetic the Pen overlay needs (insert at t, remove, move, bend, toggle smooth / sharp, 45° snap).

export interface Pt {
  x: number;
  y: number;
}
export interface PathPoint extends Pt {
  /** the handle leading INTO this anchor (absolute) */
  in?: Pt;
  /** the handle leading OUT of this anchor (absolute) */
  out?: Pt;
}
export interface SubPath {
  closed: boolean;
  points: PathPoint[];
}
export interface PathModel {
  subs: SubPath[];
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_POINTS = 2000;
const MAX_COORD = 100_000;
const EPS = 1e-6;

export class PathParseError extends Error {}

const r2 = (n: number): number => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};
const fmt = (n: number): string => String(r2(n));
const same = (a: Pt, b: Pt): boolean => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
const pt = (x: number, y: number): Pt => ({ x, y });

// ── parse ───────────────────────────────────────────────────────────────────────────────────

const TOKEN = /([MmLlHhVvCcSsQqTtZzAa])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

function tokens(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  TOKEN.lastIndex = 0;
  let last = 0;
  for (let m = TOKEN.exec(d); m; m = TOKEN.exec(d)) {
    if (/[^\s,]/.test(d.slice(last, m.index))) throw new PathParseError('not a path');
    out.push(m[1] ?? Number(m[2]));
    last = TOKEN.lastIndex;
  }
  if (/[^\s,]/.test(d.slice(last))) throw new PathParseError('not a path');
  return out;
}

/** Read an SVG `d`. Arcs are refused (the points of an arc are not Bézier points). */
export function parsePathD(d: string): PathModel {
  const t = tokens(d);
  const subs: SubPath[] = [];
  let sub: SubPath | null = null;
  let cur: Pt = pt(0, 0);
  let start: Pt = pt(0, 0);
  let lastCtl = null as Pt | null; // previous cubic's second control (for S) / quad's control (for T)
  let lastKind = null as 'c' | 'q' | null;
  let i = 0;
  let cmd = '';

  const take = (n: number): number[] => {
    const xs: number[] = [];
    for (let k = 0; k < n; k++) {
      const v = t[i++];
      if (typeof v !== 'number') throw new PathParseError('not a path');
      xs.push(v);
    }
    return xs;
  };
  const begin = (p: Pt) => {
    sub = { closed: false, points: [{ ...p }] };
    subs.push(sub);
    cur = p;
    start = p;
  };
  const cubic = (c1: Pt, c2: Pt, to: Pt) => {
    if (!sub) begin(cur);
    const s = sub as SubPath;
    const from = s.points[s.points.length - 1] as PathPoint;
    if (!same(c1, from)) from.out = c1;
    const p: PathPoint = { ...to };
    if (!same(c2, to)) p.in = c2;
    s.points.push(p);
    cur = to;
    lastCtl = c2;
    lastKind = 'c';
  };
  const line = (to: Pt) => {
    if (!sub) begin(cur);
    (sub as SubPath).points.push({ ...to });
    cur = to;
    lastKind = null;
  };

  while (i < t.length) {
    const head = t[i];
    if (typeof head === 'string') {
      cmd = head;
      i++;
      if (head === 'A' || head === 'a') throw new PathParseError('arc');
    } else if (!cmd || cmd === 'Z' || cmd === 'z') {
      throw new PathParseError('not a path');
    } else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';

    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const ox = rel ? cur.x : 0;
    const oy = rel ? cur.y : 0;
    const n = ARITY[up];
    if (n === undefined) throw new PathParseError('not a path');
    const a = take(n);
    switch (up) {
      case 'M':
        begin(pt((a[0] as number) + ox, (a[1] as number) + oy));
        lastKind = null;
        break;
      case 'L':
        line(pt((a[0] as number) + ox, (a[1] as number) + oy));
        break;
      case 'H':
        line(pt((a[0] as number) + ox, cur.y));
        break;
      case 'V':
        line(pt(cur.x, (a[0] as number) + oy));
        break;
      case 'C':
        cubic(
          pt((a[0] as number) + ox, (a[1] as number) + oy),
          pt((a[2] as number) + ox, (a[3] as number) + oy),
          pt((a[4] as number) + ox, (a[5] as number) + oy)
        );
        break;
      case 'S': {
        const c1 =
          lastKind === 'c' && lastCtl ? pt(2 * cur.x - lastCtl.x, 2 * cur.y - lastCtl.y) : cur;
        cubic(
          c1,
          pt((a[0] as number) + ox, (a[1] as number) + oy),
          pt((a[2] as number) + ox, (a[3] as number) + oy)
        );
        break;
      }
      case 'Q':
      case 'T': {
        const from = cur;
        let q: Pt;
        let to: Pt;
        if (up === 'Q') {
          q = pt((a[0] as number) + ox, (a[1] as number) + oy);
          to = pt((a[2] as number) + ox, (a[3] as number) + oy);
        } else {
          q = lastKind === 'q' && lastCtl ? pt(2 * cur.x - lastCtl.x, 2 * cur.y - lastCtl.y) : cur;
          to = pt((a[0] as number) + ox, (a[1] as number) + oy);
        }
        cubic(
          pt(from.x + (2 / 3) * (q.x - from.x), from.y + (2 / 3) * (q.y - from.y)),
          pt(to.x + (2 / 3) * (q.x - to.x), to.y + (2 / 3) * (q.y - to.y)),
          to
        );
        lastCtl = q;
        lastKind = 'q';
        break;
      }
      case 'Z': {
        if (sub) {
          const s = sub as SubPath;
          s.closed = true;
          const first = s.points[0] as PathPoint;
          const last = s.points[s.points.length - 1] as PathPoint;
          // `… L a Z` / `… C … a Z` where the last anchor IS the first: one point, not two
          if (s.points.length > 1 && same(first, last)) {
            if (last.in) first.in = last.in;
            s.points.pop();
          }
        }
        cur = start;
        lastKind = null;
        break;
      }
    }
  }
  if (subs.length === 0) throw new PathParseError('empty');
  return { subs };
}

// ── serialize ───────────────────────────────────────────────────────────────────────────────

const xy = (p: Pt) => `${fmt(p.x)} ${fmt(p.y)}`;

function segment(a: PathPoint, b: PathPoint): string {
  if (a.out || b.in) return `C${xy(a.out ?? a)} ${xy(b.in ?? b)} ${xy(b)}`;
  return `L${xy(b)}`;
}

/** The canonical `d`: absolute `M L C Z`, two decimals, no commas. */
export function serializePath(m: PathModel): string {
  const parts: string[] = [];
  for (const s of m.subs) {
    const first = s.points[0];
    if (!first) continue;
    let d = `M${xy(first)}`;
    for (let i = 1; i < s.points.length; i++)
      d += segment(s.points[i - 1] as PathPoint, s.points[i] as PathPoint);
    if (s.closed) {
      const last = s.points[s.points.length - 1] as PathPoint;
      if (s.points.length > 1 && (last.out || first.in)) d += segment(last, first);
      d += 'Z';
    }
    parts.push(d);
  }
  return parts.join('');
}

export const pointCount = (m: PathModel): number => m.subs.reduce((n, s) => n + s.points.length, 0);

/** Finite, sane, not enormous — what the server accepts from the canvas. */
export function isSanePath(m: unknown): m is PathModel {
  if (!m || typeof m !== 'object' || !Array.isArray((m as PathModel).subs)) return false;
  let n = 0;
  const ok = (p: unknown): p is Pt =>
    !!p &&
    typeof p === 'object' &&
    Number.isFinite((p as Pt).x) &&
    Number.isFinite((p as Pt).y) &&
    Math.abs((p as Pt).x) <= MAX_COORD &&
    Math.abs((p as Pt).y) <= MAX_COORD;
  for (const s of (m as PathModel).subs) {
    if (!s || typeof s.closed !== 'boolean' || !Array.isArray(s.points) || s.points.length === 0)
      return false;
    for (const p of s.points) {
      if (!ok(p) || (p.in !== undefined && !ok(p.in)) || (p.out !== undefined && !ok(p.out)))
        return false;
      n++;
    }
  }
  return n > 0 && n <= MAX_POINTS;
}

/** Keep only the model's own fields (a request is untrusted). */
export function cleanPath(m: PathModel): PathModel {
  return {
    subs: m.subs.map((s) => ({
      closed: s.closed,
      points: s.points.map((p) => ({
        x: p.x,
        y: p.y,
        ...(p.in ? { in: { x: p.in.x, y: p.in.y } } : {}),
        ...(p.out ? { out: { x: p.out.x, y: p.out.y } } : {}),
      })),
    })),
  };
}

// ── geometry ────────────────────────────────────────────────────────────────────────────────

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return pt(
    u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
  );
}

/** The roots of a cubic's derivative on (0, 1) along one axis. */
function extrema(a: number, b: number, c: number, d: number): number[] {
  const A = -a + 3 * b - 3 * c + d;
  const B = 2 * (a - 2 * b + c);
  const C = b - a;
  const out: number[] = [];
  if (Math.abs(A) < EPS) {
    if (Math.abs(B) > EPS) out.push(-C / B);
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-B + s) / (2 * A), (-B - s) / (2 * A));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** The drawn bounds (curve extremes, not the control hull). */
export function pathBounds(m: PathModel): Box {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const take = (p: Pt) => {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  };
  for (const s of m.subs) {
    for (const p of s.points) take(p);
    const n = s.points.length;
    const segs = s.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = s.points[i] as PathPoint;
      const b = s.points[(i + 1) % n] as PathPoint;
      if (!a.out && !b.in) continue;
      const c1 = a.out ?? a;
      const c2 = b.in ?? b;
      for (const t of [...extrema(a.x, c1.x, c2.x, b.x), ...extrema(a.y, c1.y, c2.y, b.y)])
        take(cubicAt(a, c1, c2, b, t));
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function translatePath(m: PathModel, dx: number, dy: number): PathModel {
  const mv = (p: Pt): Pt => pt(p.x + dx, p.y + dy);
  return {
    subs: m.subs.map((s) => ({
      closed: s.closed,
      points: s.points.map((p) => ({
        ...mv(p),
        ...(p.in ? { in: mv(p.in) } : {}),
        ...(p.out ? { out: mv(p.out) } : {}),
      })),
    })),
  };
}

export function scalePath(m: PathModel, sx: number, sy: number): PathModel {
  const mv = (p: Pt): Pt => pt(p.x * sx, p.y * sy);
  return {
    subs: m.subs.map((s) => ({
      closed: s.closed,
      points: s.points.map((p) => ({
        ...mv(p),
        ...(p.in ? { in: mv(p.in) } : {}),
        ...(p.out ? { out: mv(p.out) } : {}),
      })),
    })),
  };
}

// ── the point arithmetic of the Pen ─────────────────────────────────────────────────────────

export type PointType = 'smooth' | 'sharp';

/** Smooth: handles on both sides on one line (an open path's end: its one handle). Anything else is sharp. */
export function pointType(s: SubPath, i: number): PointType {
  const p = s.points[i] as PathPoint;
  const end = !s.closed && (i === 0 || i === s.points.length - 1);
  if (end) {
    const h = i === 0 ? p.out : p.in;
    return h && !same(h, p) ? 'smooth' : 'sharp';
  }
  if (!p.in || !p.out) return 'sharp';
  const a = pt(p.in.x - p.x, p.in.y - p.y);
  const b = pt(p.out.x - p.x, p.out.y - p.y);
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la < EPS || lb < EPS) return 'sharp';
  const cross = (a.x * b.y - a.y * b.x) / (la * lb);
  const dot = (a.x * b.x + a.y * b.y) / (la * lb);
  return Math.abs(cross) < 1e-3 && dot < 0 ? 'smooth' : 'sharp';
}

const neighbour = (s: SubPath, i: number, d: -1 | 1): PathPoint | null => {
  const n = s.points.length;
  const j = i + d;
  if (j >= 0 && j < n) return s.points[j] as PathPoint;
  return s.closed && n > 1 ? (s.points[(j + n) % n] as PathPoint) : null;
};

/** Smooth ↔ Sharp (double-click a point). The new handles run along the line through the neighbours, a third out. */
export function togglePointType(s: SubPath, i: number): SubPath {
  const points = s.points.map((p) => ({ ...p }));
  const p = points[i] as PathPoint;
  if (pointType(s, i) === 'smooth') {
    delete p.in;
    delete p.out;
    return { ...s, points };
  }
  const prev = neighbour(s, i, -1);
  const next = neighbour(s, i, 1);
  const a = prev ?? p;
  const b = next ?? p;
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  const len = Math.hypot(tx, ty);
  if (len < EPS) return { ...s, points };
  tx /= len;
  ty /= len;
  const lenOut = next ? Math.hypot(next.x - p.x, next.y - p.y) / 3 : 0;
  const lenIn = prev ? Math.hypot(prev.x - p.x, prev.y - p.y) / 3 : 0;
  if (next) p.out = pt(p.x + tx * lenOut, p.y + ty * lenOut);
  if (prev) p.in = pt(p.x - tx * lenIn, p.y - ty * lenIn);
  return { ...s, points };
}

/** Move an anchor; its handles go with it. */
export function movePoint(s: SubPath, i: number, to: Pt): SubPath {
  const p = s.points[i] as PathPoint;
  const dx = to.x - p.x;
  const dy = to.y - p.y;
  const points = s.points.map((q, k) =>
    k !== i
      ? q
      : {
          x: to.x,
          y: to.y,
          ...(q.in ? { in: pt(q.in.x + dx, q.in.y + dy) } : {}),
          ...(q.out ? { out: pt(q.out.x + dx, q.out.y + dy) } : {}),
        }
  );
  return { ...s, points };
}

/**
 * Bend: move one handle. A smooth point turns its other handle to stay opposite (its length is kept); ⌥
 * (`breakHandle`) moves only this one, which leaves the point sharp.
 */
export function moveHandle(
  s: SubPath,
  i: number,
  which: 'in' | 'out',
  to: Pt,
  breakHandle = false
): SubPath {
  const wasSmooth = pointType(s, i) === 'smooth';
  const points = s.points.map((q) => ({ ...q }));
  const p = points[i] as PathPoint;
  p[which] = to;
  const other = which === 'in' ? 'out' : 'in';
  const o = p[other];
  if (wasSmooth && !breakHandle && o) {
    const dx = p.x - to.x;
    const dy = p.y - to.y;
    const d = Math.hypot(dx, dy);
    const len = Math.hypot(o.x - p.x, o.y - p.y);
    if (d > EPS) p[other] = pt(p.x + (dx / d) * len, p.y + (dy / d) * len);
  }
  return { ...s, points };
}

/** A new point on a segment at parameter t (de Casteljau): the curve keeps its shape. */
export function insertPoint(s: SubPath, seg: number, t: number): SubPath {
  const n = s.points.length;
  const a = s.points[seg] as PathPoint;
  const bi = (seg + 1) % n;
  const b = s.points[bi] as PathPoint;
  const points = s.points.map((q) => ({ ...q }));
  let made: PathPoint;
  if (!a.out && !b.in) {
    made = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    // a straight segment stays straight: the new anchor is sharp
  } else {
    const p0 = pt(a.x, a.y);
    const p1 = a.out ?? p0;
    const p3 = pt(b.x, b.y);
    const p2 = b.in ?? p3;
    const lerp = (u: Pt, v: Pt): Pt => pt(u.x + (v.x - u.x) * t, u.y + (v.y - u.y) * t);
    const q0 = lerp(p0, p1);
    const q1 = lerp(p1, p2);
    const q2 = lerp(p2, p3);
    const r0 = lerp(q0, q1);
    const r1 = lerp(q1, q2);
    const m = lerp(r0, r1);
    (points[seg] as PathPoint).out = q0;
    (points[bi] as PathPoint).in = q2;
    made = { x: m.x, y: m.y, in: r0, out: r1 };
  }
  points.splice(seg + 1, 0, made);
  return { ...s, points };
}

/** Remove an anchor; a sub-path left with fewer than two points goes with it (null). */
export function removePoint(s: SubPath, i: number): SubPath | null {
  const points = s.points.filter((_, k) => k !== i).map((p) => ({ ...p }));
  if (points.length < 2) return null;
  return { closed: s.closed && points.length > 2, points };
}

/** ⇧: the segment from `from` keeps to the nearest 45° step at the same length. */
export function snap45(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return pt(from.x + Math.cos(a) * len, from.y + Math.sin(a) * len);
}

/** Where on the path, nearest a point: sub-path, segment, t and the distance. Flattened, 24 steps a segment. */
export function nearestOnPath(
  m: PathModel,
  at: Pt
): { sub: number; seg: number; t: number; dist: number } | null {
  let best: { sub: number; seg: number; t: number; dist: number } | null = null;
  m.subs.forEach((s, si) => {
    const n = s.points.length;
    const segs = s.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = s.points[i] as PathPoint;
      const b = s.points[(i + 1) % n] as PathPoint;
      const c1 = a.out ?? a;
      const c2 = b.in ?? b;
      const STEPS = 24;
      for (let k = 0; k <= STEPS; k++) {
        const t = k / STEPS;
        const p = cubicAt(a, c1, c2, b, t);
        const dist = Math.hypot(p.x - at.x, p.y - at.y);
        if (!best || dist < best.dist) best = { sub: si, seg: i, t, dist };
      }
    }
  });
  return best;
}

// ── operands for Combine (a box as a sub-path) ──────────────────────────────────────────────

/** Bézier circle constant: a quarter arc as one cubic. */
export const KAPPA = 0.5522847498307936;

/** A rounded rectangle; radii are clamped to half the short side, ↖ ↗ ↘ ↙. */
export function rectSub(box: Box, radii: [number, number, number, number] = [0, 0, 0, 0]): SubPath {
  const { x, y, w, h } = box;
  const max = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, max)));
  const pts: PathPoint[] = [];
  const corner = (cx: number, cy: number, r: number, dir: [number, number][]) => {
    // an arc corner is two anchors; a square corner is one
    if (r < EPS) {
      pts.push(pt(cx, cy));
      return;
    }
    const [a, b] = dir as [[number, number], [number, number]];
    const p1: PathPoint = { x: cx + a[0] * r, y: cy + a[1] * r };
    const p2: PathPoint = { x: cx + b[0] * r, y: cy + b[1] * r };
    p1.out = pt(p1.x - a[0] * r * KAPPA, p1.y - a[1] * r * KAPPA);
    p2.in = pt(p2.x - b[0] * r * KAPPA, p2.y - b[1] * r * KAPPA);
    pts.push(p1, p2);
  };
  corner(x, y, tl as number, [
    [0, 1],
    [1, 0],
  ]);
  corner(x + w, y, tr as number, [
    [-1, 0],
    [0, 1],
  ]);
  corner(x + w, y + h, br as number, [
    [0, -1],
    [-1, 0],
  ]);
  corner(x, y + h, bl as number, [
    [1, 0],
    [0, -1],
  ]);
  return { closed: true, points: pts };
}

/** An ellipse inscribed in the box: four smooth anchors, the first at the top. */
export function ellipseSub(box: Box): SubPath {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  return {
    closed: true,
    points: [
      { x: cx, y, in: pt(cx - rx * KAPPA, y), out: pt(cx + rx * KAPPA, y) },
      { x: x + w, y: cy, in: pt(x + w, cy - ry * KAPPA), out: pt(x + w, cy + ry * KAPPA) },
      { x: cx, y: y + h, in: pt(cx + rx * KAPPA, y + h), out: pt(cx - rx * KAPPA, y + h) },
      { x, y: cy, in: pt(x, cy + ry * KAPPA), out: pt(x, cy - ry * KAPPA) },
    ],
  };
}

/** A polygon from a CSS `clip-path: polygon(50% 0%, …)` string within the box; null when it is not one. */
export function polygonSubFromClip(clip: string, box: Box): SubPath | null {
  const m = /^polygon\((.*)\)$/.exec(clip.trim());
  if (!m) return null;
  const pts: PathPoint[] = [];
  for (const pair of (m[1] as string).split(',')) {
    const c = pair.trim().split(/\s+/);
    if (c.length !== 2) return null;
    const val = (v: string, size: number): number | null => {
      const q = /^(-?\d+(?:\.\d+)?)(%|px)$/.exec(v);
      if (!q) return null;
      return q[2] === '%' ? (Number(q[1]) / 100) * size : Number(q[1]);
    };
    const px = val(c[0] as string, box.w);
    const py = val(c[1] as string, box.h);
    if (px === null || py === null) return null;
    pts.push(pt(box.x + px, box.y + py));
  }
  return pts.length >= 3 ? { closed: true, points: pts } : null;
}

// ── winding (Combine keeps every operand clockwise so a union of overlaps never cancels) ────

/** The signed area of the sub-path flattened (positive = clockwise on a screen, y down). */
export function signedArea(s: SubPath): number {
  const n = s.points.length;
  if (n < 3) return 0;
  const segs = s.closed ? n : n - 1;
  const flat: Pt[] = [];
  for (let i = 0; i < segs; i++) {
    const a = s.points[i] as PathPoint;
    const b = s.points[(i + 1) % n] as PathPoint;
    flat.push(a);
    if (a.out || b.in) {
      const c1 = a.out ?? a;
      const c2 = b.in ?? b;
      for (let k = 1; k < 8; k++) flat.push(cubicAt(a, c1, c2, b, k / 8));
    }
  }
  if (!s.closed) flat.push(s.points[n - 1] as PathPoint);
  let sum = 0;
  for (let i = 0; i < flat.length; i++) {
    const p = flat[i] as Pt;
    const q = flat[(i + 1) % flat.length] as Pt;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** The same outline drawn the other way round (handles swap sides). */
export function reverseSub(s: SubPath): SubPath {
  const points = s.points
    .map((p) => ({
      x: p.x,
      y: p.y,
      ...(p.out ? { in: p.out } : {}),
      ...(p.in ? { out: p.in } : {}),
    }))
    .reverse();
  if (s.closed && points.length > 1) {
    // keep the first anchor first: closed [a b c d] reversed is [a d c b]
    const first = points.pop() as PathPoint;
    points.unshift(first);
  }
  return { closed: s.closed, points };
}

/** Clockwise, whatever it was. */
export const clockwise = (s: SubPath): SubPath => (signedArea(s) < 0 ? reverseSub(s) : s);

/** The four ways to combine shapes (S2-slices Q6). Here, not in combine.ts, so the canvas can import it without the writer. */
export const COMBINE_KINDS = ['union', 'subtract', 'intersect', 'exclude'] as const;
export type CombineKind = (typeof COMBINE_KINDS)[number];
