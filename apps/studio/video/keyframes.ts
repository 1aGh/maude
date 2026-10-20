// video/keyframes.ts — S7.18: the animation windows a comp draws with `interpolate(frame, [a, b], [x, y])`,
// and the one curve each can carry (07 ve-advanced "Easing", 06 ad-timeline).
//
// The PURE half of the easing write: where the calls are, what they say, how a curve is spelled. NO IMPORTS,
// on purpose — the Timeline's parser (client/panels/timeline-parse.js, also read by the server), the Advanced
// panel and the `video.easing.set` op all read the same windows, so the k-th keyframe the Timeline draws is
// the k-th call the op edits. A comp spells a curve `Easing.bezier(0.22, 1, 0.36, 1)` (remotion's own); the
// designer reads it as `cubic-bezier(0.22, 1, 0.36, 1)`, the CSS name of the same four numbers.
//
// Deterministic text work, not a TSX parser: the shapes the video-comp skill teaches (a named component whose
// body calls `interpolate(frame, …)`), found the way the Timeline already finds them.

/** One `interpolate(frame, …)` call inside a named component's body. */
export interface InterpolateCall {
  /** the call's ordinal among every `interpolate(frame, [a, b…` in the body — the id the op takes */
  index: number;
  /** offsets into the source: `interpolate(` … the closing `)` (end is exclusive) */
  start: number;
  end: number;
  /** the arguments, trimmed, with their absolute offsets */
  args: { start: number; end: number; text: string }[];
  /** the first two entries of the input range, as written (`10`, `T0 + 4`) */
  from: string;
  to: string;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** The same regex the Timeline has always used — kept in one place now. */
const CALL_RE = /interpolate\(\s*frame\s*,\s*\[\s*([^,\]]+?)\s*,\s*([^,\]]+?)\s*[,\]]/g;

/** The slice of a component's definition the Timeline reads (heuristic bounds, as before). */
export function componentWindow(
  source: string,
  name: string | null | undefined
): { offset: number; text: string } | null {
  if (!name || !IDENT.test(name)) return null;
  const def = source.search(new RegExp(`\\b(?:const|function)\\s+${name.replace(/\$/g, '\\$')}\\b`));
  if (def < 0) return null;
  const offset = def + name.length;
  const rest = source.slice(offset);
  const nextDef = rest.search(/\n(?:const|function)\s+[A-Z]/);
  return { offset, text: rest.slice(0, nextDef > 0 ? nextDef : 2400) };
}

/** Skip a string, template or comment starting at `i`; returns the index after it, or `i` if none starts there. */
function skipLiteral(s: string, i: number): number {
  const c = s[i];
  if (c === '"' || c === "'" || c === '`') {
    let j = i + 1;
    while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (c === '/' && s[i + 1] === '/') {
    const nl = s.indexOf('\n', i);
    return nl < 0 ? s.length : nl;
  }
  if (c === '/' && s[i + 1] === '*') {
    const e = s.indexOf('*/', i + 2);
    return e < 0 ? s.length : e + 2;
  }
  return i;
}

/** The top-level pieces of a bracketed list: `open` is the index of the opening bracket. */
export function splitTop(
  s: string,
  open: number
): { pieces: { start: number; end: number }[]; close: number } | null {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  if (!pairs[s[open]]) return null;
  const stack: string[] = [];
  const pieces: { start: number; end: number }[] = [];
  let from = open + 1;
  for (let i = open; i < s.length; i++) {
    const skipped = skipLiteral(s, i);
    if (skipped !== i) {
      i = skipped - 1;
      continue;
    }
    const c = s[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return null;
      if (stack.length === 0) {
        pieces.push({ start: from, end: i });
        return { pieces, close: i };
      }
    } else if (c === ',' && stack.length === 1) {
      pieces.push({ start: from, end: i });
      from = i + 1;
    }
  }
  return null;
}

/** Trim a piece to its content: `{ start, end, text }`. */
function trimmed(s: string, p: { start: number; end: number }) {
  let a = p.start;
  let b = p.end;
  while (a < b && /\s/.test(s[a])) a++;
  while (b > a && /\s/.test(s[b - 1])) b--;
  return { start: a, end: b, text: s.slice(a, b) };
}

/** Every `interpolate(frame, [a, b…` call in the component, in source order. */
export function interpolateCalls(
  source: string,
  component: string | null | undefined
): InterpolateCall[] {
  const win = componentWindow(source, component);
  if (!win) return [];
  const out: InterpolateCall[] = [];
  let index = 0;
  for (const m of win.text.matchAll(CALL_RE)) {
    const start = win.offset + (m.index as number);
    const open = start + 'interpolate'.length;
    const list = splitTop(source, open);
    const n = index++;
    if (!list) continue;
    out.push({
      index: n,
      start,
      end: list.close + 1,
      args: list.pieces.map((p) => trimmed(source, p)),
      from: m[1],
      to: m[2],
    });
  }
  return out;
}

// ── the curve ───────────────────────────────────────────────────────────────────────────────────────

export type Bezier = readonly [number, number, number, number];

export const EASE_OUT: Bezier = [0.22, 1, 0.36, 1];

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** `cubic-bezier(0.22, 1, 0.36, 1)` — the designer's spelling. */
export function formatBezier(b: Bezier): string {
  return `cubic-bezier(${b.map((n) => round3(n)).join(', ')})`;
}

/** `Easing.bezier(0.22, 1, 0.36, 1)` — what the comp holds. */
export function bezierExpr(b: Bezier): string {
  return `Easing.bezier(${b.map((n) => round3(n)).join(', ')})`;
}

/** Four finite numbers, x1 and x2 inside 0..1 (the curve stays a function of time), y within a sane overshoot. */
export function isBezier(v: unknown): v is Bezier {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    v[0] >= 0 &&
    v[0] <= 1 &&
    v[2] >= 0 &&
    v[2] <= 1 &&
    v[1] >= -2 &&
    v[1] <= 3 &&
    v[3] >= -2 &&
    v[3] <= 3
  );
}

/** The four numbers of an `Easing.bezier(a, b, c, d)` written as literals, else null. */
export function parseBezier(text: string): Bezier | null {
  const m = /^Easing\s*\.\s*bezier\s*\(([^()]*)\)$/.exec(text.trim());
  if (!m) return null;
  const parts = m[1].split(',').map((p) => p.trim());
  if (parts.length !== 4 || parts.some((p) => !/^-?(?:\d+\.?\d*|\.\d+)$/.test(p))) return null;
  const nums = parts.map(Number);
  return isBezier(nums) ? (nums as unknown as Bezier) : null;
}

/** Where the curve is at time `t` (0..1): the y of the cubic whose x is `t`. Newton, then bisection. */
export function bezierAt(b: Bezier, t: number): number {
  const [x1, y1, x2, y2] = b;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s;
  const Y = (s: number) => ((ay * s + by) * s + cy) * s;
  const dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  const x = Math.min(1, Math.max(0, t));
  let s = x;
  for (let i = 0; i < 6; i++) {
    const e = X(s) - x;
    if (Math.abs(e) < 1e-6) return Y(s);
    const d = dX(s);
    if (Math.abs(d) < 1e-6) break;
    s -= e / d;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 40; i++) {
    const e = X(s) - x;
    if (Math.abs(e) < 1e-6) break;
    if (e > 0) hi = s;
    else lo = s;
    s = (lo + hi) / 2;
  }
  return Y(s);
}

// ── reading a call ──────────────────────────────────────────────────────────────────────────────────

export type EasingRead =
  | { kind: 'none' }
  | { kind: 'bezier'; bezier: Bezier; css: string }
  | { kind: 'other'; text: string };

/** The options object (4th argument) of a call, as `{ props: [{key, start, end, valueStart}] }`, or null. */
function optionsOf(source: string, call: InterpolateCall) {
  const a = call.args[3];
  if (!a || !a.text.startsWith('{')) return null;
  const list = splitTop(source, a.start);
  if (!list) return null;
  const props = list.pieces
    .map((p) => trimmed(source, p))
    .filter((p) => p.text.length > 0)
    .map((p) => {
      const m = /^(?:([A-Za-z_$][\w$]*)|'([^']*)'|"([^"]*)")\s*:/.exec(p.text);
      return {
        key: m ? (m[1] ?? m[2] ?? m[3]) : null,
        start: p.start,
        end: p.end,
        valueStart: m ? p.start + m[0].length : p.start,
      };
    });
  return { open: a.start, close: list.close, props };
}

/** What a call says about its easing. */
export function readEasing(source: string, call: InterpolateCall): EasingRead {
  const opt = optionsOf(source, call);
  const prop = opt?.props.find((p) => p.key === 'easing');
  if (!prop) return { kind: 'none' };
  const text = source.slice(prop.valueStart, prop.end).trim();
  const bezier = parseBezier(text);
  return bezier ? { kind: 'bezier', bezier, css: formatBezier(bezier) } : { kind: 'other', text };
}

/** What the Advanced panel shows of one animation window. */
export interface KeyframeInfo {
  /** the call's ordinal in its component — the op's `index` */
  index: number;
  component: string;
  /** the name the value is bound to (`const y = interpolate(…)` → `y`), else null */
  prop: string | null;
  /** the output range's first and last entry as written (`48` → `0`) */
  values: [string, string] | null;
  easing: EasingRead;
}

/** `const y = ` / `y: ` / `opacity=` just before the call, else null. */
function boundName(source: string, at: number): string | null {
  const before = source.slice(Math.max(0, at - 80), at);
  const m = /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|([A-Za-z_$][\w$]*)\s*[:=]\s*\{?)\s*$/.exec(before);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/** The output range's first and last literal entries, e.g. `[48, 0]` → `['48', '0']`. */
function outputRange(source: string, call: InterpolateCall): [string, string] | null {
  const a = call.args[2];
  if (!a || !a.text.startsWith('[')) return null;
  const list = splitTop(source, a.start);
  if (!list || list.pieces.length < 2) return null;
  const items = list.pieces.map((p) => trimmed(source, p).text);
  return [items[0], items[items.length - 1]];
}

/** Every window of the component, with what the panel needs. */
export function describeKeyframes(
  source: string,
  component: string | null | undefined
): KeyframeInfo[] {
  if (!component) return [];
  return interpolateCalls(source, component).map((call) => ({
    index: call.index,
    component,
    prop: boundName(source, call.start),
    values: outputRange(source, call),
    easing: readEasing(source, call),
  }));
}

// ── writing a curve ─────────────────────────────────────────────────────────────────────────────────

export type EasingWrite =
  | { ok: true; source: string }
  | { ok: false; reason: 'no-call' | 'not-literal' | 'bad-curve' };

/**
 * Set (or, with null, take off) the easing of one call. The text outside the easing is untouched: a third
 * argument gains `{ easing: … }`, an options object gains or swaps its `easing`, and taking it off removes the
 * property (and the object, if it was the only thing in it).
 */
export function writeEasing(
  source: string,
  component: string,
  index: number,
  bezier: Bezier | null
): EasingWrite {
  if (bezier !== null && !isBezier(bezier)) return { ok: false, reason: 'bad-curve' };
  const call = interpolateCalls(source, component).find((c) => c.index === index);
  if (!call || call.args.length < 3) return { ok: false, reason: 'no-call' };
  const expr = bezier ? bezierExpr(bezier) : '';
  const fourth = call.args[3];
  if (!fourth) {
    if (!bezier) return { ok: true, source };
    const at = call.args[2].end;
    return { ok: true, source: `${source.slice(0, at)}, { easing: ${expr} }${source.slice(at)}` };
  }
  const opt = optionsOf(source, call);
  if (!opt) return { ok: false, reason: 'not-literal' };
  const existing = opt.props.find((p) => p.key === 'easing');
  if (existing) {
    if (bezier)
      return {
        ok: true,
        source: `${source.slice(0, existing.valueStart)} ${expr}${source.slice(existing.end)}`,
      };
    // take the property off, with its comma
    if (opt.props.length === 1) {
      return { ok: true, source: `${source.slice(0, call.args[2].end)}${source.slice(fourth.end)}` };
    }
    const k = opt.props.indexOf(existing);
    const [cutFrom, cutTo] =
      k === opt.props.length - 1
        ? [opt.props[k - 1].end, existing.end]
        : [existing.start, opt.props[k + 1].start];
    return { ok: true, source: `${source.slice(0, cutFrom)}${source.slice(cutTo)}` };
  }
  if (!bezier) return { ok: true, source };
  if (opt.props.length === 0)
    return { ok: true, source: `${source.slice(0, opt.open)}{ easing: ${expr} }${source.slice(opt.close + 1)}` };
  const at = opt.props[0].start;
  return { ok: true, source: `${source.slice(0, at)}easing: ${expr}, ${source.slice(at)}` };
}
