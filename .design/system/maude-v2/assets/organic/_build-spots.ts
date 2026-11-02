/**
 * _build-spots.ts — the maude-v2 empty-state spot art, drawn as code (DDR-070).
 *
 * Every spot is built from engine primitives (rect / circle / line / polygon / polyline / group / place) —
 * no hand-written path coordinates. The only literal path is the CONTRACT comment glyph (the brand's own
 * 16-grid mark). Fills and strokes are design tokens only (`var(--x)`, no hex fallback), so the art follows
 * the app theme when inlined.
 *
 * Eight spots, one 240 × 160 viewBox: canvas · ai · none · comment · image · done · offline · trash.
 * `canvas` and `ai` and `none` are the shapes of spot-empty-canvas / spot-ai-ready / spot-no-results,
 * rebuilt token-only; `comment` `image` `done` `offline` `trash` are new.
 *
 * Run (from the repo root):
 *   bash apps/studio/bin/draw-build.sh --script .design/system/maude-v2/assets/organic/_build-spots.ts
 * Writes spot-{comment,image,done,offline,trash}.{svg,jsx} next to this file and the kit's
 * apps/studio/client/v2/empty/spot-art.jsx (the inline form S11's `Spot` renders; each landing sticky is
 * its own layer so the spring can move it alone).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const E = await import(process.env.MAUDE_DRAW_ENGINE as string);
const HERE = dirname(new URL(import.meta.url).pathname);
const REPO = resolve(HERE, '../../../../..');

type P = unknown;
const LINE = { stroke: 'var(--fg-2)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
const INK = 'var(--object-ink)';
/** 16-grid comment glyph (CONTRACT), one square corner. */
const COMMENT_D = 'M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z';

/* ── the dot field: three rings of the canvas grid fading out ─────────────────────────────────── */
const RINGS: [string, number][] = [
  [
    '88,40 104,40 120,40 136,40 152,40 56,56 72,56 88,56 104,56 120,56 136,56 152,56 168,56 184,56 56,72 72,72 88,72 104,72 120,72 136,72 152,72 168,72 184,72 56,88 72,88 88,88 104,88 120,88 136,88 152,88 168,88 184,88 56,104 72,104 88,104 104,104 120,104 136,104 152,104 168,104 184,104 88,120 104,120 120,120 136,120 152,120',
    1,
  ],
  [
    '72,24 88,24 104,24 120,24 136,24 152,24 168,24 40,40 56,40 72,40 168,40 184,40 200,40 40,56 200,56 24,72 40,72 200,72 216,72 24,88 40,88 200,88 216,88 40,104 200,104 40,120 56,120 72,120 168,120 184,120 200,120 72,136 88,136 104,136 120,136 136,136 152,136 168,136',
    0.6,
  ],
  [
    '72,8 88,8 104,8 120,8 136,8 152,8 168,8 40,24 56,24 184,24 200,24 24,40 216,40 8,56 24,56 216,56 232,56 8,72 232,72 8,88 232,88 8,104 24,104 216,104 232,104 24,120 216,120 40,136 56,136 184,136 200,136 72,152 88,152 104,152 120,152 136,152 152,152 168,152',
    0.3,
  ],
];
const dots = (): P[] =>
  RINGS.map(([pts, o]) =>
    E.group(
      pts.split(' ').map((pt) => {
        const [cx, cy] = pt.split(',').map(Number);
        return E.circle({ cx, cy, r: 1, fill: 'var(--canvas-dot)' });
      }),
      { opacity: o === 1 ? undefined : o }
    )
  );

/* ── parts, authored at the origin and placed ─────────────────────────────────────────────────── */
/** A rectangle card: soft shadow, fill, outline. */
const card = (w: number, h: number, rx: number, fill: string, o: Record<string, unknown> = {}): P[] => [
  E.rect({ x: 0, y: 2, width: w, height: h, rx, fill: INK, opacity: 0.08 }),
  E.rect({ x: 0, y: 0, width: w, height: h, rx, fill, ...LINE, ...o }),
];

/** A sticky note: shadow, fill, outline, two text strokes (or the AI's one spark stroke). */
function sticky(s: number, fill: string, lines = 2, spark = false): P[] {
  const p = s * 0.2;
  const text = spark
    ? [E.line({ x1: p, y1: 7.2, x2: p, y2: 19.2, stroke: 'var(--spark)', strokeWidth: 1.5, strokeLinecap: 'round' })]
    : [
        E.line({ x1: p, y1: p, x2: s - p, y2: p, stroke: INK, strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.35 }),
        ...(lines > 1
          ? [E.line({ x1: p, y1: p + 6, x2: p + (s - 2 * p) * 0.6, y2: p + 6, stroke: INK, strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.35 })]
          : []),
      ];
  return [...card(s, s, 4, fill), ...text];
}
const placeSticky = (x: number, y: number, s: number, rot: number, fill: string, lines = 2, spark = false) =>
  E.place(sticky(s, fill, lines, spark), { x, y, rotate: rot, originX: s / 2, originY: s / 2 });

/** The comment glyph as a bubble, scaled by k so the stroke stays 1.5. */
function bubble(k: number, fill: string, o: { dashed?: boolean; inner?: P[] } = {}): P[] {
  const body = E.path({
    d: COMMENT_D,
    fill,
    stroke: 'var(--fg-2)',
    strokeWidth: 1.5 / k,
    strokeLinejoin: 'round',
    ...(o.dashed ? { dash: [3 / k, 3 / k] } : {}),
  });
  const shadow = o.dashed ? [] : [E.path({ d: COMMENT_D, fill: INK, opacity: 0.08 })];
  return [...(o.dashed ? [] : [E.place(shadow, { y: 0.6 })]), body, ...(o.inner ?? [])];
}
const placeBubble = (x: number, y: number, k: number, fill: string, o: { dashed?: boolean; inner?: P[] } = {}) =>
  E.place(bubble(k, fill, o), { x, y, scale: k });

/** A photo card: shadow, fill, outline, a sun and a ridge. */
const photo = (fill: string): P[] => [
  ...card(80, 60, 6, fill),
  E.circle({ cx: 58, cy: 18, r: 6, fill: 'var(--object-yellow)', stroke: INK, strokeWidth: 1.5, strokeOpacity: 0.35 }),
  E.polyline({
    points: [{ x: 8, y: 50 }, { x: 26, y: 32 }, { x: 38, y: 42 }, { x: 50, y: 30 }, { x: 72, y: 50 }],
    fill: 'none', stroke: INK, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.4,
  }),
];

/** A four-point sparkle: the AI's mark, `inner` is the waist (the spec's 8.4 / 33). */
function star(cx: number, cy: number, R: number): P {
  const r = R * (8.4 / 33);
  const f = (n: number) => Math.round(n * 100) / 100;
  return E.polygon({
    points: [
      { x: cx, y: cy - R }, { x: f(cx + r), y: f(cy - r) }, { x: cx + R, y: cy }, { x: f(cx + r), y: f(cy + r) },
      { x: cx, y: cy + R }, { x: f(cx - r), y: f(cy + r) }, { x: cx - R, y: cy }, { x: f(cx - r), y: f(cy - r) },
    ],
    fill: 'var(--spark)',
  });
}

/** The search pill of the no-results spot. */
const pill = (): P[] => [
  ...card(128, 32, 16, 'var(--bg-1)'),
  E.circle({ cx: 18, cy: 16, r: 5, fill: 'none', ...LINE }),
  E.line({ x1: 21.54, y1: 19.54, x2: 24.36, y2: 22.36, ...LINE }),
  E.line({ x1: 36, y1: 16, x2: 76, y2: 16, ...LINE }),
  E.line({ x1: 82, y1: 10, x2: 82, y2: 22, stroke: 'var(--accent)', strokeWidth: 1.5, strokeLinecap: 'round' }),
];

/* ── the eight spots: { base, stickies[] } — a sticky is its own layer so the landing can move it ─ */
interface Spot { base: P[]; stickies: P[] }
const SPOTS: Record<string, Spot> = {
  canvas: {
    base: [
      E.place(
        [...card(96, 72, 8, 'var(--bg-1)'), E.line({ x1: 4, y1: -8, x2: 28, y2: -8, ...LINE, opacity: 0.55 })],
        { x: 116, y: 20 }
      ),
    ],
    stickies: [
      placeSticky(36, 96, 40, -6, 'var(--object-yellow)'),
      placeSticky(100, 76, 36, 5, 'var(--object-lilac)'),
      placeSticky(184, 116, 28, -3, 'var(--object-green)', 1),
    ],
  },
  ai: {
    base: [star(84, 76, 33), star(128, 36, 9.9)],
    stickies: [placeSticky(136, 56, 56, 4, 'var(--object-yellow)', 2, true)],
  },
  none: {
    base: [
      E.place(
        [E.rect({ x: 0, y: 0, width: 96, height: 64, rx: 10, fill: 'var(--object-sky)', fillOpacity: 0.55, ...LINE, dash: [4, 4] })],
        { x: 120, y: 80, rotate: -6, originX: 48, originY: 32 }
      ),
      E.place(pill(), { x: 20, y: 28 }),
    ],
    stickies: [],
  },
  comment: {
    base: [
      E.place(
        [
          ...card(112, 84, 8, 'var(--bg-1)'),
          E.line({ x1: 12, y1: 16, x2: 60, y2: 16, ...LINE, opacity: 0.55 }),
          E.line({ x1: 12, y1: 26, x2: 44, y2: 26, ...LINE, opacity: 0.55 }),
          E.rect({ x: 12, y: 38, width: 88, height: 34, rx: 4, fill: 'var(--object-sky)', fillOpacity: 0.45 }),
        ],
        { x: 52, y: 26 }
      ),
      placeBubble(140, 62, 3, 'var(--object-yellow)', {
        inner: [
          E.group(
            [5.5, 8, 10.5].map((cx) => E.circle({ cx, cy: 8, r: 0.6, fill: INK })),
            { opacity: 0.45 }
          ),
        ],
      }),
      placeBubble(22, 88, 2.25, 'none', { dashed: true }),
    ],
    stickies: [],
  },
  image: {
    base: [
      E.place(
        [E.rect({ x: 0, y: 0, width: 160, height: 104, rx: 12, fill: 'var(--object-sky)', fillOpacity: 0.22, ...LINE, dash: [4, 4] })],
        { x: 40, y: 40 }
      ),
      E.place(photo('var(--object-green)'), { x: 58, y: 56, rotate: -7, originX: 40, originY: 30 }),
      E.place(photo('var(--object-coral)'), { x: 104, y: 66, rotate: 6, originX: 40, originY: 30 }),
      E.line({ x1: 120, y1: 10, x2: 120, y2: 34, ...LINE }),
      E.polyline({ points: [{ x: 112, y: 27 }, { x: 120, y: 35 }, { x: 128, y: 27 }], fill: 'none', ...LINE }),
    ],
    stickies: [],
  },
  done: {
    base: [
      placeBubble(40, 58, 2.5, 'var(--object-lilac)'),
      placeBubble(160, 40, 2.25, 'var(--object-sky)'),
    ],
    stickies: [
      placeBubble(84, 24, 4.5, 'var(--object-green)', {
        inner: [
          E.polyline({
            points: [{ x: 5.5, y: 8.1 }, { x: 7.2, y: 9.8 }, { x: 10.5, y: 6.2 }],
            fill: 'none', stroke: INK, strokeWidth: 1.5 / 4.5, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.7,
          }),
        ],
      }),
    ],
  },
  /* offline: a laptop holding the work safe, the link to the cloud drawn broken */
  offline: {
    base: [
      E.place(card(104, 66, 8, 'var(--bg-1)'), { x: 68, y: 40 }),
      E.place(
        [E.rect({ x: 0, y: 0, width: 128, height: 8, rx: 4, fill: 'var(--bg-1)', ...LINE })],
        { x: 56, y: 108 }
      ),
      placeSticky(80, 52, 30, -4, 'var(--object-yellow)', 1),
      placeSticky(120, 58, 26, 5, 'var(--object-green)', 2),
      E.place(
        [E.rect({ x: 0, y: 0, width: 56, height: 28, rx: 14, fill: 'none', ...LINE, dash: [4, 4] })],
        { x: 168, y: 14 }
      ),
      E.line({ x1: 176, y1: 46, x2: 158, y2: 64, ...LINE, dash: [3, 4] }),
    ],
    stickies: [],
  },
  /* trash: the bin, the dashed place the artboard came from, a note waiting to be put back */
  trash: {
    base: [
      E.place(
        [E.rect({ x: 0, y: 0, width: 44, height: 60, rx: 6, fill: 'var(--object-sky)', fillOpacity: 0.35, ...LINE, dash: [4, 4] })],
        { x: 36, y: 62, rotate: -6, originX: 22, originY: 30 }
      ),
      E.ellipse({ cx: 120, cy: 128, rx: 34, ry: 3, fill: INK, opacity: 0.08 }),
      E.rect({ x: 108, y: 40, width: 24, height: 8, rx: 3, fill: 'var(--bg-1)', ...LINE }),
      E.line({ x1: 88, y1: 52, x2: 152, y2: 52, ...LINE }),
      E.polygon({
        points: [{ x: 92, y: 58 }, { x: 148, y: 58 }, { x: 142, y: 124 }, { x: 98, y: 124 }],
        fill: 'var(--bg-1)', ...LINE,
      }),
      ...[108, 120, 132].map((x) => E.line({ x1: x, y1: 72, x2: x, y2: 110, ...LINE, opacity: 0.55 })),
      placeSticky(164, 88, 32, 8, 'var(--object-yellow)', 1),
    ],
    stickies: [],
  },
};

/* ── write ────────────────────────────────────────────────────────────────────────────────────── */
const VB = '0 0 240 160';
const inner = (jsx: string) => jsx.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const layerJsx = (prims: P[]) => inner(E.toJsx(prims, { viewBox: VB }));
/** One root element needs no fragment; several do. */
const layer = (prims: P[]) => (prims.length === 1 ? `(${layerJsx(prims)})` : `(<>${layerJsx(prims)}</>)`);

const NEW_ASSETS: Record<string, string> = { comment: 'comment', image: 'image', done: 'done', offline: 'offline', trash: 'trash' };
for (const [name, file] of Object.entries(NEW_ASSETS)) {
  const all = [...dots(), ...SPOTS[name].base, ...SPOTS[name].stickies];
  const opts = { viewBox: VB, a11y: { decorative: true } };
  writeFileSync(join(HERE, `spot-${file}.svg`), E.optimizeSvg(E.toSvg(all, opts)));
  writeFileSync(join(HERE, `spot-${file}.jsx`), `// ${name} — generated by _build-spots.ts (maude-v2 spot art, draw engine)\n${E.toJsx(all, opts)}\n`);
}

let art = `// client/v2/empty/spot-art.jsx — S11.1: the eight empty-state spots as inline JSX (GENERATED).
//
// Source of truth: .design/system/maude-v2/assets/organic/_build-spots.ts, drawn with the draw
// engine (DDR-070) — do not hand-edit; regenerate with
//   bash apps/studio/bin/draw-build.sh --script .design/system/maude-v2/assets/organic/_build-spots.ts
// Token fills only (no hex). \`stickies\` are the landing layers (render functions): spot.jsx wraps each in <g class="es-st">
// so the spring moves one note at a time while \`base\` holds still.

export const SPOT_NAMES = Object.freeze(${JSON.stringify(Object.keys(SPOTS))});

/** The dot field every spot sits on (three rings of the canvas grid, fading out). */
export const DOTS = ${layer(dots())};

export const SPOT_ART = {
`;
for (const [name, s] of Object.entries(SPOTS)) {
  art += `  ${name}: {\n    base: ${layer(s.base)},\n    stickies: [\n${s.stickies.map((st) => `      () => ${layer([st])},\n`).join('')}    ],\n  },\n`;
}
art += '};\n';
writeFileSync(join(REPO, 'apps/studio/client/v2/empty/spot-art.jsx'), art);
console.log(`spots built: ${Object.keys(SPOTS).join(', ')}`);
