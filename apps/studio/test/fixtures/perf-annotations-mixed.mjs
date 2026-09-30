// perf-annotations-mixed.mjs — deterministic MIXED annotation board generator.
//
// The sticky-only field in perf-canvas.mjs measures one kind at scale. The
// annotations-v2 element-model work (.ai/plans/feature-annotations-v2-element-
// model.md, Task 3) needs a board that exercises EVERY v1 kind together, the way
// a real FigJam-style board does: sections (some nested) holding stickies,
// shapes with anchored text labels, arrows BOUND to those shapes, standalone
// text, pen ink and a few groups. It is both the perf baseline input and the
// v1→v2 migration test input, so it must be:
//
//   - canonical: serialized ONLY through `strokesToSvg` (annotations-model.ts),
//     never hand-written SVG — a hand-rolled string would drift from what the
//     app writes and the migration would be tested against a fiction;
//   - deterministic: a seeded PRNG (mulberry32), no Date.now()/Math.random(),
//     so two runs are byte-identical and baselines compare like with like;
//   - in view: laid out as a cluster grid from a caller-given origin (next to
//     the artboards), not parked at y=100000.
//
// Output is truncated to exactly `count` strokes. Strokes are emitted in
// dependency order inside each cluster (section → hosts → labels → arrows), so
// truncation never leaves an anchored label or a bound arrow pointing at a host
// that was cut.
//
// Runs under bun (perf.sh prefers bun; the .ts import needs it or Node ≥ 23's
// type stripping).

import {
  FILL_PALETTE,
  STICKY_PALETTE,
  STROKE_PALETTE,
  strokesToSvg,
} from '../../annotations-model.ts';

/** One cluster occupies a CELL_W × CELL_H cell of the annotation field. */
export const CELL_W = 1280;
export const CELL_H = 880;
export const CELL_COLS = 6;

const STICKY_TEXT = [
  'Ship the import path',
  'Cut the cold start',
  'Fewer modal steps',
  'Copy is too long',
  'Needs an empty state',
  'Great onboarding',
  'Slow on mobile',
  'Loved the polish',
  'Who owns this?',
  'Retest after fix',
];
const LABELS = ['Start', 'Decide', 'Review', 'Ship', 'Measure', 'Iterate', 'Block', 'Done'];
const NOTES = ['Open question', 'Follow up Friday', 'Risky path', 'See thread', 'v2 only'];
const SECTIONS = ['Discovery', 'Onboarding', 'Retro', 'Backlog', 'Now', 'Next', 'Later'];

/** mulberry32 — tiny, well-distributed, deterministic. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round to 1 decimal — mirrors what a pointer-driven stroke persists. */
const r1 = (n) => Math.round(n * 10) / 10;

/** Bound endpoint world position: the anchor normalized over the host bbox. */
function bindPoint(host, nx, ny) {
  if (host.tool === 'ellipse') {
    return [host.cx - host.rx + nx * 2 * host.rx, host.cy - host.ry + ny * 2 * host.ry];
  }
  return [host.x + nx * host.w, host.y + ny * host.h];
}

/**
 * One cluster's strokes, in dependency order. ~18 strokes (19 on nested-section
 * clusters); `k` is the cluster index, `ox/oy` its cell origin.
 */
function cluster(k, ox, oy, rnd) {
  const pick = (pool) => pool[Math.floor(rnd() * pool.length)];
  const jit = (n) => r1((rnd() - 0.5) * 2 * n);
  const id = (s) => `mx${k}_${s}`;
  const out = [];

  // Outer section — the cluster's organizing container.
  out.push({
    id: id('sec'),
    tool: 'section',
    x: ox,
    y: oy,
    w: CELL_W - 80,
    h: CELL_H - 80,
    label: `${pick(SECTIONS)} ${k}`,
    color: '#8b8b94',
  });

  // Every other cluster nests a section inside the outer one (depth 2).
  const nested = k % 2 === 0;
  if (nested) {
    out.push({
      id: id('sub'),
      tool: 'section',
      x: ox + 40,
      y: oy + 60,
      w: 520,
      h: 340,
      label: `Sub ${k}`,
      color: '#6b5bd6',
    });
  }

  // Four stickies — two inside the nested section when there is one.
  for (let s = 0; s < 4; s++) {
    const inSub = nested && s < 2;
    const bx = inSub ? ox + 70 + s * 240 : ox + 60 + s * 250;
    const by = inSub ? oy + 110 : oy + 440;
    out.push({
      id: id(`st${s}`),
      tool: 'sticky',
      color: pick(STICKY_PALETTE),
      x: r1(bx + jit(8)),
      y: r1(by + jit(8)),
      w: 200,
      h: 200,
      text: `${pick(STICKY_TEXT)} ${k}.${s}`,
      fontSize: 14,
    });
  }

  // Three hosts: rect, ellipse, diamond — each gets an anchored label.
  const hx = ox + 620;
  const rect = {
    id: id('rect'),
    tool: 'rect',
    color: pick(STROKE_PALETTE),
    width: 3,
    x: r1(hx + jit(6)),
    y: r1(oy + 80 + jit(6)),
    w: 160,
    h: 100,
    fill: pick(FILL_PALETTE),
    cornerRadius: k % 3 === 0 ? 12 : undefined,
  };
  const ellipse = {
    id: id('ell'),
    tool: 'ellipse',
    color: pick(STROKE_PALETTE),
    width: 3,
    cx: r1(hx + 360 + jit(6)),
    cy: r1(oy + 130 + jit(6)),
    rx: 80,
    ry: 50,
    fill: pick(FILL_PALETTE),
  };
  const poly = {
    id: id('poly'),
    tool: 'polygon',
    shape: ['diamond', 'triangle', 'triangle-down'][k % 3],
    color: pick(STROKE_PALETTE),
    width: 3,
    x: r1(hx + 180 + jit(6)),
    y: r1(oy + 260 + jit(6)),
    w: 140,
    h: 120,
    fill: null,
    dashed: k % 4 === 1 ? true : undefined,
  };
  out.push(rect, ellipse, poly);
  for (const host of [rect, ellipse, poly]) {
    out.push({
      id: `${host.id}_lbl`,
      tool: 'text',
      color: '#1f1f1f',
      fontSize: 16,
      text: pick(LABELS),
      anchorId: host.id,
    });
  }

  // Two arrows BOUND to the hosts (rect → ellipse, ellipse → diamond).
  const bound = (sid, from, fnx, fny, to, tnx, tny, extra) => {
    const [x1, y1] = bindPoint(from, fnx, fny);
    const [x2, y2] = bindPoint(to, tnx, tny);
    return {
      id: id(sid),
      tool: 'arrow',
      color: '#1f1f1f',
      width: 3,
      x1: r1(x1),
      y1: r1(y1),
      x2: r1(x2),
      y2: r1(y2),
      startBind: { hostId: from.id, nx: fnx, ny: fny },
      endBind: { hostId: to.id, nx: tnx, ny: tny },
      ...extra,
    };
  };
  out.push(bound('a0', rect, 1, 0.5, ellipse, 0, 0.5, {}));
  out.push(
    bound('a1', ellipse, 0.5, 1, poly, 1, 0.5, {
      lineType: k % 2 ? 'elbow' : 'curved',
      endHead: 'triangle-outline',
    })
  );

  // Standalone text + a pen squiggle.
  out.push({
    id: id('txt'),
    tool: 'text',
    color: '#1f1f1f',
    fontSize: 20,
    text: `${pick(NOTES)} (${k})`,
    x: r1(ox + 60 + jit(10)),
    y: r1(oy + 680 + jit(10)),
    bold: k % 5 === 0 ? true : undefined,
  });
  const pts = [];
  const px = ox + 620;
  const py = oy + 715;
  const amp = 15 + rnd() * 30;
  const phase = rnd() * Math.PI;
  for (let p = 0; p < 24; p++) {
    pts.push([r1(px + p * 20), r1(py + Math.sin(phase + p * 0.5) * amp)]);
  }
  out.push({
    id: id('pen'),
    tool: 'pen',
    color: pick(STROKE_PALETTE),
    width: 3,
    points: pts,
  });

  // A couple of groups per board: every 5th cluster groups its last two
  // stickies, and every 10th additionally nests that inside an outer group
  // together with the standalone text (groupIds are deepest → shallowest).
  if (k % 5 === 0) {
    const inner = `g${k}_in`;
    const outer = `g${k}_out`;
    const deep = k % 10 === 0;
    for (const s of out) {
      if (s.id === id('st2') || s.id === id('st3')) s.groupIds = deep ? [inner, outer] : [inner];
      if (deep && s.id === id('txt')) s.groupIds = [outer];
    }
  }

  return out;
}

/**
 * Build `count` strokes as a cluster grid starting at world (originX, originY).
 * Returns the stroke array (not yet serialized) so tests can inspect it.
 */
export function buildMixedStrokes(count, { originX = 0, originY = 0, seed = 0x5eed } = {}) {
  const rnd = mulberry32(seed);
  const strokes = [];
  for (let k = 0; strokes.length < count; k++) {
    const ox = originX + (k % CELL_COLS) * CELL_W;
    const oy = originY + Math.floor(k / CELL_COLS) * CELL_H;
    for (const s of cluster(k, ox, oy, rnd)) {
      // Drop undefined optional keys so the stroke matches what the app builds.
      for (const key of Object.keys(s)) if (s[key] === undefined) delete s[key];
      strokes.push(s);
    }
  }
  return strokes.slice(0, count);
}

/** Canonical legacy-v1 `.annotations.svg` for a `count`-element mixed board. */
export function renderMixedAnnotations(count, opts = {}) {
  if (count <= 0) return null;
  return strokesToSvg(buildMixedStrokes(count, opts));
}

/** Per-kind tally — handy for fixture sanity and the report. */
export function kindTally(strokes) {
  const t = {};
  for (const s of strokes) {
    const k = s.tool === 'text' ? (s.anchorId ? 'text(anchored)' : 'text') : s.tool;
    t[k] = (t[k] ?? 0) + 1;
  }
  t.bound_arrows = strokes.filter((s) => s.tool === 'arrow' && s.startBind && s.endBind).length;
  t.grouped = strokes.filter((s) => s.groupIds?.length).length;
  return t;
}
