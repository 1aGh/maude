/**
 * @file       draw/serialize-animate.ts — IR Timeline → animated SVG/JSX
 * @scope      apps/studio/draw/serialize-animate.ts
 * @purpose    Time-generalize the DDR-067 single-source invariant: ONE node tree
 *             + ONE {@link Timeline} emits BOTH an animated SVG (on-disk `.svg`
 *             form) AND an animated JSX string (inline canvas-preview form). Both
 *             render the SAME tree — `primitivesToNodes` from `serialize.ts` with
 *             SMIL animation children injected onto each track's target — so the
 *             two forms can never structurally drift (the test asserts this).
 *
 *             Mechanism (per the DDR-094 conversion rules + `references/draw/motion-rules`):
 *               • `d` shape morph → `<animate attributeName="d" calcMode="spline">`
 *                 (NEVER CSS `d:path()`, which doesn't animate live).
 *               • opacity / fill / stroke → `<animate>`.
 *               • translate / scale / rotate → `<animateTransform additive="sum">`
 *                 — the position-vs-animation split: animated transforms compose
 *                 with (never clobber) a static `transform=` attribute.
 *               • Per-segment easing → `keySplines` + `calcMode="spline"`, taken
 *                 verbatim from the IR `cubic-bezier` handles (overshoot survives).
 *
 *             Reduced motion: emitted as a `<style>` `prefers-reduced-motion`
 *             gate for the SVG form (CSS-driven host). SMIL itself ignores the
 *             CSS catch-all (a re-discovered gotcha — DDR-094 background); the
 *             durable RM story is the host wrapper (`useReducedMotion`) for JSX
 *             and the Lottie host for production. Documented in `references/draw/motion-rules.md`.
 *
 *             Production delivery is Lottie (DDR-094) — this is the maude
 *             authoring/preview form. React-free (DDR-067): JSX is a STRING.
 */

import type { CubicBezierHandles, Repeat, Timeline, Track, TrackValue } from './animate.ts';
import { resolveStagger } from './animate.ts';
import type { DrawPrimitive, Point } from './primitives.ts';
import {
  type Dialect,
  primitivesToNodes,
  renderNode,
  type SerializeOpts,
  type SvgNode,
} from './serialize.ts';

/** Per-target renderer for a `d`-morph track's vertex arrays → a path string. */
export type PathRenderer = (vertices: Point[]) => string;

export interface AnimateOpts extends SerializeOpts {
  /**
   * Per-target path renderers for `d`-morph tracks (a {@link Track} on `d`
   * carries vertex arrays; rendering them to `d` strings needs the shared
   * command template). Wire `{ [targetId]: morphResult.toPath }`. A `d` track
   * whose target has no renderer throws.
   */
  pathRenderers?: Record<string, PathRenderer>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation plan — the dialect-neutral intermediate both forms share
// ─────────────────────────────────────────────────────────────────────────────

/** Properties driven through `<animateTransform>` rather than `<animate>`. */
const TRANSFORM_TYPES: Record<string, 'translate' | 'scale' | 'rotate'> = {
  translate: 'translate',
  scale: 'scale',
  rotate: 'rotate',
};

/** Logical property → SMIL `attributeName` (transforms handled separately). */
const ATTR_NAME: Record<string, string> = {
  d: 'd',
  opacity: 'opacity',
  fillOpacity: 'fill-opacity',
  strokeOpacity: 'stroke-opacity',
  fill: 'fill',
  stroke: 'stroke',
};

/** One resolved, normalized animation (a single SMIL element's worth). */
export interface AnimEntry {
  target: string;
  property: string;
  /** SMIL element to emit. */
  kind: 'animate' | 'animateTransform';
  /** `attributeName` (animate) or transform `type` (animateTransform). */
  attr: string;
  /** Serialized keyframe values (`;`-joined at render). */
  values: string[];
  /** Normalized 0–1 keyframe times (first 0, last 1). */
  keyTimes: number[];
  /** `n-1` `"x1 y1 x2 y2"` splines when any segment eases; else undefined. */
  keySplines?: string[];
  /** Animation window start (seconds). */
  begin: number;
  /** Animation window duration (seconds). */
  dur: number;
  repeat: Repeat;
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e4) / 1e4);
}

function serializeValue(
  property: string,
  v: TrackValue,
  pathRenderers: Record<string, PathRenderer>,
  target: string
): string {
  if (property === 'd') {
    const r = pathRenderers[target];
    if (!r) {
      throw new Error(
        `serialize-animate: d-morph track on "${target}" needs a pathRenderer ` +
          '(pass { pathRenderers: { [target]: morphResult.toPath } })'
      );
    }
    return r(v as Point[]);
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return num(v);
  if (Array.isArray(v)) {
    // number[] (transform components / stops). Point[] only valid for `d` (above).
    return (v as number[]).map(num).join(' ');
  }
  throw new Error(`serialize-animate: unserializable value for "${property}"`);
}

function splineStr(h: CubicBezierHandles): string {
  return h.map(num).join(' ');
}

/** Resolve one track into an {@link AnimEntry} (normalize times, splines). */
function planTrack(
  tr: Track,
  pathRenderers: Record<string, PathRenderer>,
  repeat: Repeat
): AnimEntry | null {
  const target = tr.target;
  if (!target) return null; // untargeted tracks can't be serialized
  const kfs = tr.keyframes;
  if (kfs.length < 2) return null;

  const begin = kfs[0].t;
  const dur = kfs[kfs.length - 1].t - begin;
  if (dur <= 0) return null;

  const keyTimes = kfs.map((k) => Math.min(1, Math.max(0, (k.t - begin) / dur)));
  const values = kfs.map((k) => serializeValue(tr.property, k.value, pathRenderers, target));

  // keySplines: one per interval. Present only if at least one segment eases.
  const hasEase = kfs.slice(0, -1).some((k) => k.ease);
  let keySplines: string[] | undefined;
  if (hasEase) {
    keySplines = kfs.slice(0, -1).map((k) => splineStr(k.ease ?? [0, 0, 1, 1]));
  }

  const transformType = TRANSFORM_TYPES[tr.property];
  const entry: AnimEntry = transformType
    ? {
        target,
        property: tr.property,
        kind: 'animateTransform',
        attr: transformType,
        values,
        keyTimes,
        begin,
        dur,
        repeat,
      }
    : {
        target,
        property: tr.property,
        kind: 'animate',
        attr: ATTR_NAME[tr.property] ?? tr.property,
        values,
        keyTimes,
        begin,
        dur,
        repeat,
      };
  if (keySplines) entry.keySplines = keySplines;
  return entry;
}

/**
 * Build the dialect-neutral animation plan from a timeline. Resolves `stagger`,
 * normalizes each track to its own [0,1] window, and maps property → SMIL kind.
 * Both serializers consume this — it IS the single source the parity test checks.
 */
export function buildAnimPlan(
  timeline: Timeline,
  opts: { pathRenderers?: Record<string, PathRenderer> } = {}
): AnimEntry[] {
  const tl = resolveStagger(timeline);
  const repeat: Repeat = tl.repeat ?? 'indefinite';
  const renderers = opts.pathRenderers ?? {};
  const out: AnimEntry[] = [];
  for (const tr of tl.tracks) {
    const e = planTrack(tr, renderers, repeat);
    if (e) out.push(e);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// SMIL node injection
// ─────────────────────────────────────────────────────────────────────────────

function repeatCount(r: Repeat): string {
  return r === 'indefinite' ? 'indefinite' : String(r);
}

/** An {@link AnimEntry} → a leaf {@link SvgNode} (`<animate>`/`<animateTransform>`). */
function entryToNode(e: AnimEntry): SvgNode {
  const attrs: Array<[string, string]> = [];
  if (e.kind === 'animateTransform') {
    attrs.push(['attributeName', 'transform']);
    attrs.push(['type', e.attr]);
    attrs.push(['additive', 'sum']); // compose, never clobber a static transform=
  } else {
    attrs.push(['attributeName', e.attr]);
  }
  attrs.push(['values', e.values.join(';')]);
  attrs.push(['keyTimes', e.keyTimes.map(num).join(';')]);
  if (e.keySplines) {
    attrs.push(['calcMode', 'spline']);
    attrs.push(['keySplines', e.keySplines.join(';')]);
  }
  if (e.begin > 0) attrs.push(['begin', `${num(e.begin)}s`]);
  attrs.push(['dur', `${num(e.dur)}s`]);
  attrs.push(['repeatCount', repeatCount(e.repeat)]);
  if (e.repeat !== 'indefinite') attrs.push(['fill', 'freeze']);
  return { tag: e.kind, attrs, children: [] };
}

/** Find a node by `id` (depth-first) and append animation children to it. */
function injectAnimations(
  root: SvgNode,
  plan: AnimEntry[]
): { injected: number; missing: string[] } {
  const byTarget = new Map<string, AnimEntry[]>();
  for (const e of plan) {
    const list = byTarget.get(e.target) ?? [];
    list.push(e);
    byTarget.set(e.target, list);
  }
  const found = new Set<string>();

  const walk = (node: SvgNode): void => {
    const id = node.attrs.find(([k]) => k === 'id')?.[1];
    if (id && byTarget.has(id)) {
      for (const e of byTarget.get(id) as AnimEntry[]) node.children.push(entryToNode(e));
      found.add(id);
    }
    for (const c of node.children) walk(c);
  };
  walk(root);

  const missing = [...byTarget.keys()].filter((t) => !found.has(t));
  return { injected: found.size, missing };
}

/** Reduced-motion `<style>` (CSS-host best-effort; SMIL caveat documented). */
function reducedMotionStyle(): SvgNode {
  const css =
    '@media (prefers-reduced-motion: reduce){' +
    '*{animation-duration:.001ms!important;animation-iteration-count:1!important;' +
    'transition-duration:.001ms!important}}';
  return { tag: 'style', attrs: [], children: [], text: css };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public serializers
// ─────────────────────────────────────────────────────────────────────────────

function buildAnimatedTree(
  primitives: DrawPrimitive[],
  timeline: Timeline,
  opts: AnimateOpts,
  dialect: Dialect
): { tree: SvgNode; missing: string[] } {
  const tree = primitivesToNodes(primitives, opts);
  const plan = buildAnimPlan(timeline, opts);
  const { missing } = injectAnimations(tree, plan);
  // Only the SVG form gets a live <style> RM gate — a CSS `{}` block can't be a
  // JSX text child without entity-escaping the braces; JSX hosts gate via
  // useReducedMotion (see references/draw/motion-rules.md).
  if (dialect === 'svg') tree.children.unshift(reducedMotionStyle());
  return { tree, missing };
}

/**
 * Serialize primitives + a timeline to an animated SVG document string (SMIL +
 * a `prefers-reduced-motion` `<style>` gate). Throws if a track targets an id
 * not present in the tree (fail loud — a typo'd target silently animates nothing).
 */
export function toAnimatedSvg(
  primitives: DrawPrimitive[],
  timeline: Timeline,
  opts: AnimateOpts
): string {
  const { tree, missing } = buildAnimatedTree(primitives, timeline, opts, 'svg');
  if (missing.length) {
    throw new Error(`toAnimatedSvg: track target(s) not found in tree: ${missing.join(', ')}`);
  }
  return renderNode(tree, 'svg', '');
}

/**
 * Serialize primitives + a timeline to an animated JSX string for inline canvas
 * embedding. Renders the SAME SMIL node tree in the JSX dialect (React renders
 * SMIL inside an `<svg>`), so the on-disk and on-canvas animated forms are
 * structurally identical. The reduced-motion gate is the host's responsibility
 * (`useReducedMotion`) — see `references/draw/motion-rules.md`.
 */
export function toAnimatedJsx(
  primitives: DrawPrimitive[],
  timeline: Timeline,
  opts: AnimateOpts
): string {
  const { tree, missing } = buildAnimatedTree(primitives, timeline, opts, 'jsx');
  if (missing.length) {
    throw new Error(`toAnimatedJsx: track target(s) not found in tree: ${missing.join(', ')}`);
  }
  return renderNode(tree, 'jsx', '');
}
