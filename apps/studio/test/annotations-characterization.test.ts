// annotations-characterization.test.ts — annotations v2, plan Task 2
// (.ai/plans/feature-annotations-v2-element-model.md).
//
// Pins TODAY's (v1 Stroke model) semantics BEFORE the v2 element-model rewrite,
// so later milestones can prove they kept — or deliberately changed — each
// behaviour. Every non-todo test here PASSES on the current code. Tests that
// would encode a KNOWN BUG are `test.todo` with the v2 expectation + the bug's
// line ref; Milestone D flips them into real assertions.
//
// Already covered elsewhere — deliberately NOT duplicated here:
//   - byte-identical round trip of test/fixtures/phase-21-annotations.svg →
//     annotations-roundtrip.test.ts ("a frozen Phase-21 SVG round-trips BYTE-IDENTICAL")
//   - byte-identical round trip of test/fixtures/figjam-v3-groups-bindings.svg →
//     figjam-v3-model.test.ts ("figjam-v3 fixture canary")
//   - basic do/undo/label/deep-clone of the strokes command →
//     annotation-strokes-command.test.ts
//
// Logic characterized (line refs as of 2026-09-30, file-relative to apps/studio):
//   section drag carry (inline in React)   annotations-layer.tsx:2482-2498
//   section members (headless reader)      bin/read-annotations.mjs:690-747
//   grownStickyBox + STICKY_MAX_GROWN_H    annotations-model.ts:552, 570-584
//   strokeBBox / translateOne              annotations-model.ts:2066-2170
//   expandIdsToGroups / outermostGroupOf   annotations-groups.ts:18-53
//   duplicateStrokes                       annotations-groups.ts:157-212
//   recomputeBoundArrows / facingAnchor    annotations-bindings.ts:179-276
//   alignStrokes / distributeStrokes       annotations-align.ts:89-149
//   computeSnap                            annotations-snap.ts:85-165
//   createAnnotationStrokesCommand         commands/annotation-strokes-command.ts:60-78

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { alignStrokes, distributeStrokes } from '../annotations-align.ts';
import { anchorPoint, facingAnchor, recomputeBoundArrows } from '../annotations-bindings.ts';
import { expandIdsToGroups, outermostGroupOf } from '../annotations-groups.ts';
import {
  type AnchorHost,
  type ArrowStroke,
  type EllipseStroke,
  grownStickyBox,
  type ImageStroke,
  type LinkStroke,
  type MediaRefStroke,
  type PenStroke,
  type PolygonStroke,
  type RectStroke,
  type SectionStroke,
  STICKY_MAX_GROWN_H,
  type StickyStroke,
  type Stroke,
  strokeBBox,
  strokesToSvg,
  svgToStrokes,
  type TextStroke,
  translateOne,
} from '../annotations-model.ts';
import { computeSnap } from '../annotations-snap.ts';
import { attachSectionMembers, parseAnnotations } from '../bin/read-annotations.mjs';
import { createAnnotationStrokesCommand } from '../commands/annotation-strokes-command.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — one of every Stroke kind.

const pen: PenStroke = {
  id: 'pen',
  tool: 'pen',
  color: '#000',
  width: 3,
  points: [
    [10, 20],
    [30, 5],
    [50, 40],
  ],
};
const rect: RectStroke = {
  id: 'rect',
  tool: 'rect',
  color: '#000',
  width: 3,
  x: 100,
  y: 100,
  w: 80,
  h: 40,
  fill: null,
};
const ellipse: EllipseStroke = {
  id: 'ell',
  tool: 'ellipse',
  color: '#000',
  width: 3,
  cx: 300,
  cy: 200,
  rx: 30,
  ry: 20,
  fill: null,
};
const polygon: PolygonStroke = {
  id: 'poly',
  tool: 'polygon',
  shape: 'diamond',
  color: '#000',
  width: 3,
  x: 400,
  y: 100,
  w: 60,
  h: 60,
  fill: null,
};
const arrow: ArrowStroke = {
  id: 'arr',
  tool: 'arrow',
  color: '#000',
  width: 3,
  x1: 200,
  y1: 50,
  x2: 150,
  y2: 90,
};
const anchoredText: TextStroke = {
  id: 'lbl',
  tool: 'text',
  color: '#000',
  fontSize: 16,
  text: 'Label',
  anchorId: 'rect',
};
const standaloneText: TextStroke = {
  id: 'txt',
  tool: 'text',
  color: '#000',
  fontSize: 20,
  text: 'hello\nworld!',
  x: 500,
  y: 500,
};
const sticky: StickyStroke = {
  id: 'stk',
  tool: 'sticky',
  color: '#fef08a',
  x: 600,
  y: 100,
  w: 200,
  h: 200,
  text: 'note',
  fontSize: 16,
};
const image: ImageStroke = {
  id: 'img',
  tool: 'image',
  x: 700,
  y: 400,
  w: 120,
  h: 90,
  href: 'assets/abcd1234.png',
  alt: 'pic',
};
const link: LinkStroke = {
  id: 'lnk',
  tool: 'link',
  x: 50,
  y: 600,
  w: 260,
  h: 76,
  url: 'https://example.com/a',
  title: 'Example',
  domain: 'example.com',
};
const mediaref: MediaRefStroke = {
  id: 'med',
  tool: 'mediaref',
  x: 400,
  y: 600,
  w: 280,
  h: 76,
  src: 'assets/beef0001.mp4',
  mediaKind: 'video',
  title: 'clip.mp4',
};
const section: SectionStroke = {
  id: 'sec',
  tool: 'section',
  x: 0,
  y: 800,
  w: 480,
  h: 320,
  label: 'Section',
  color: '#8b8b94',
};

const ALL_KINDS: Stroke[] = [
  section,
  pen,
  rect,
  anchoredText,
  ellipse,
  polygon,
  arrow,
  standaloneText,
  sticky,
  image,
  link,
  mediaref,
];

// ─────────────────────────────────────────────────────────────────────────────
// strokeBBox / translateOne — every kind.

describe('strokeBBox — every stroke kind', () => {
  const anchors = new Map<string, AnchorHost>([['rect', rect]]);
  const cases: Array<[string, Stroke, { x: number; y: number; w: number; h: number } | null]> = [
    ['pen = extent of its points', pen, { x: 10, y: 5, w: 40, h: 35 }],
    ['rect = x/y/w/h', rect, { x: 100, y: 100, w: 80, h: 40 }],
    ['ellipse = centre ± radii', ellipse, { x: 270, y: 180, w: 60, h: 40 }],
    ['polygon = its stored box (not its vertices)', polygon, { x: 400, y: 100, w: 60, h: 60 }],
    ['arrow = endpoint extent (heads ignored)', arrow, { x: 150, y: 50, w: 50, h: 40 }],
    ['sticky = box', sticky, { x: 600, y: 100, w: 200, h: 200 }],
    ['image = box', image, { x: 700, y: 400, w: 120, h: 90 }],
    ['link = box', link, { x: 50, y: 600, w: 260, h: 76 }],
    ['mediaref = box', mediaref, { x: 400, y: 600, w: 280, h: 76 }],
    ['section = box', section, { x: 0, y: 800, w: 480, h: 320 }],
  ];
  for (const [name, s, want] of cases) {
    test(name, () => {
      expect(strokeBBox(s)).toEqual(want);
    });
  }

  test('anchored text = its HOST bbox with the anchors map, null without it', () => {
    expect(strokeBBox(anchoredText, anchors)).toEqual({ x: 100, y: 100, w: 80, h: 40 });
    expect(strokeBBox(anchoredText)).toBeNull();
  });

  test('standalone text = SYNTHETIC bbox (0.55·fontSize per char of the longest line)', () => {
    // 'hello\nworld!' → 2 lines, longest 6 chars; 2 lines × 20 × 1.25 = 50 tall.
    const bb = strokeBBox(standaloneText);
    expect(bb).not.toBeNull();
    expect(bb?.x).toBe(500);
    expect(bb?.y).toBe(500);
    expect(bb?.w).toBeCloseTo(6 * 20 * 0.55, 10);
    expect(bb?.h).toBe(50);
    // single line keeps the legacy 1.2 line-box
    expect(strokeBBox({ ...standaloneText, text: 'hi' })?.h).toBe(24);
    // list markers pad 3 chars; min width 8
    expect(strokeBBox({ ...standaloneText, text: 'a', listType: 'bullet' })?.w).toBeCloseTo(
      4 * 20 * 0.55,
      10
    );
    expect(strokeBBox({ ...standaloneText, text: '', fontSize: 1 })?.w).toBe(8);
  });

  test('negative w/h boxes are normalized (rect, polygon, sticky, section…)', () => {
    for (const s of [rect, polygon, sticky, image, link, mediaref, section] as const) {
      const flipped = { ...s, x: s.x + s.w, y: s.y + s.h, w: -s.w, h: -s.h } as Stroke;
      expect(strokeBBox(flipped)).toEqual(strokeBBox(s));
    }
  });

  test('empty pen has no bbox', () => {
    expect(strokeBBox({ ...pen, points: [] })).toBeNull();
  });

  test('rotation is IGNORED by strokeBBox (it is the unrotated local box)', () => {
    expect(strokeBBox({ ...rect, rotation: 45 })).toEqual(strokeBBox(rect));
  });
});

describe('translateOne — every stroke kind', () => {
  const dx = 7;
  const dy = -3;
  test('each positioned kind shifts its bbox by exactly (dx, dy)', () => {
    for (const s of ALL_KINDS) {
      if (s.tool === 'text' && s.anchorId) continue;
      const before = strokeBBox(s);
      const after = strokeBBox(translateOne(s, dx, dy));
      expect(before).not.toBeNull();
      expect(after?.x).toBeCloseTo((before?.x ?? 0) + dx, 10);
      expect(after?.y).toBeCloseTo((before?.y ?? 0) + dy, 10);
      expect(after?.w).toBeCloseTo(before?.w ?? 0, 10);
      expect(after?.h).toBeCloseTo(before?.h ?? 0, 10);
    }
  });

  test('never mutates the input; returns a new object for positioned kinds', () => {
    const snap = structuredClone(ALL_KINDS);
    for (const s of ALL_KINDS) {
      const out = translateOne(s, dx, dy);
      if (!(s.tool === 'text' && s.anchorId)) expect(out).not.toBe(s);
    }
    expect(ALL_KINDS).toEqual(snap);
  });

  test('anchored text is returned by REFERENCE (it rides its host)', () => {
    expect(translateOne(anchoredText, dx, dy)).toBe(anchoredText);
  });

  test('arrow translate moves BOTH endpoints but keeps its binds untouched', () => {
    const bound: ArrowStroke = { ...arrow, startBind: { hostId: 'rect', nx: 1, ny: 0.5 } };
    const out = translateOne(bound, dx, dy) as ArrowStroke;
    expect([out.x1, out.y1, out.x2, out.y2]).toEqual([207, 47, 157, 87]);
    expect(out.startBind).toEqual(bound.startBind);
  });

  test('standalone text with no x/y translates from (0, 0)', () => {
    const t = translateOne({ ...standaloneText, x: undefined, y: undefined }, dx, dy) as TextStroke;
    expect([t.x, t.y]).toEqual([dx, dy]);
  });

  test('negative-extent boxes keep their sign (translate does not normalize)', () => {
    const r = translateOne({ ...rect, w: -80 }, dx, dy) as RectStroke;
    expect(r.w).toBe(-80);
  });

  test('zero delta still allocates (drag-back-to-origin relies on reference restore instead)', () => {
    expect(translateOne(rect, 0, 0)).not.toBe(rect);
    expect(translateOne(rect, 0, 0)).toEqual(rect);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SVG round trip over every kind (the fixtures are pinned elsewhere — see header).

describe('svg round trip — every stroke kind', () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });

  test('strokesToSvg ∘ svgToStrokes is a fixed point on a one-of-each scene', () => {
    const svg = strokesToSvg(ALL_KINDS);
    expect(strokesToSvg(svgToStrokes(svg))).toBe(svg);
  });

  test('parse recovers kinds + ids in document (z) order', () => {
    const back = svgToStrokes(strokesToSvg(ALL_KINDS));
    expect(back.map((s) => [s.id, s.tool])).toEqual(ALL_KINDS.map((s) => [s.id, s.tool]));
  });

  test('parse recovers each kind geometrically (bbox equal after round trip)', () => {
    const back = svgToStrokes(strokesToSvg(ALL_KINDS));
    const anchorsA = new Map<string, AnchorHost>([['rect', rect]]);
    const anchorsB = new Map<string, AnchorHost>();
    for (const s of back) if (s.tool === 'rect') anchorsB.set(s.id, s);
    for (let i = 0; i < ALL_KINDS.length; i++) {
      const a = ALL_KINDS[i] as Stroke;
      const b = back[i] as Stroke;
      expect(strokeBBox(b, anchorsB)).toEqual(strokeBBox(a, anchorsA));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section membership — centre-in-box.
//
// The LAYER's rule is inline in the React pointerdown handler
// (annotations-layer.tsx:2482-2498) and is not exported, so it is replicated
// VERBATIM below as the executable spec of today's rule. The HEADLESS rule is
// the real exported `attachSectionMembers` (bin/read-annotations.mjs:690-747),
// tested directly. The two implementations agree on box-shaped kinds and
// DIVERGE on standalone text (see the drift test).

/** Verbatim replica of annotations-layer.tsx:2482-2498 (drag-start carry set). */
function layerDragCarrySet(snapshot: readonly Stroke[], ids: readonly string[]): Set<string> {
  const movedSet = new Set(ids);
  for (const s of snapshot) {
    if (s.tool !== 'section' || !movedSet.has(s.id)) continue;
    const sx = Math.min(s.x, s.x + s.w);
    const sy = Math.min(s.y, s.y + s.h);
    const sx2 = sx + Math.abs(s.w);
    const sy2 = sy + Math.abs(s.h);
    for (const t of snapshot) {
      if (movedSet.has(t.id) || t.tool === 'section') continue;
      const bb = strokeBBox(t);
      if (!bb) continue;
      const ccx = bb.x + bb.w / 2;
      const ccy = bb.y + bb.h / 2;
      if (ccx >= sx && ccx <= sx2 && ccy >= sy && ccy <= sy2) movedSet.add(t.id);
    }
  }
  return movedSet;
}

/** Headless: real serializer → real reader → real attachSectionMembers. */
function readerMembers(strokes: readonly Stroke[], sectionId: string): string[] {
  const anns = attachSectionMembers(parseAnnotations(strokesToSvg(strokes)));
  const sec = anns.find((a: { id: string }) => a.id === sectionId);
  return (sec?.members ?? []).map((m: { id: string }) => m.id);
}

const sec100: SectionStroke = { ...section, id: 's', x: 0, y: 0, w: 100, h: 100 };
/** A 20×20 rect whose CENTRE is at (cx, cy). */
const rectAt = (id: string, cx: number, cy: number): RectStroke => ({
  ...rect,
  id,
  x: cx - 10,
  y: cy - 10,
  w: 20,
  h: 20,
});

describe('section membership — layer drag carry (replica of annotations-layer.tsx:2482-2498)', () => {
  test('a stroke whose bbox CENTRE is inside is carried', () => {
    const got = layerDragCarrySet([sec100, rectAt('in', 50, 50)], ['s']);
    expect([...got].sort()).toEqual(['in', 's']);
  });

  test('centre EXACTLY on the border (all four edges + corner) is carried — inclusive', () => {
    const strokes = [
      sec100,
      rectAt('l', 0, 50),
      rectAt('r', 100, 50),
      rectAt('t', 50, 0),
      rectAt('b', 50, 100),
      rectAt('c', 100, 100),
    ];
    const got = layerDragCarrySet(strokes, ['s']);
    expect([...got].sort()).toEqual(['b', 'c', 'l', 'r', 's', 't']);
  });

  test('centre just outside is NOT carried even when the bbox overlaps the section heavily', () => {
    const big: RectStroke = { ...rect, id: 'o', x: -200, y: 0, w: 399, h: 100 }; // centre x=-0.5
    const got = layerDragCarrySet([sec100, big], ['s']);
    expect(got.has('o')).toBe(false);
  });

  test('a stroke fully inside is carried; a stroke whose centre is out is not, regardless of z', () => {
    // Section is behind (index 0) or in front — z order does not matter.
    const a = rectAt('a', 90, 90);
    const b = rectAt('b', 111, 50);
    expect([...layerDragCarrySet([a, sec100, b], ['s'])].sort()).toEqual(['a', 's']);
  });

  test('a negative-extent section is normalized before the test', () => {
    const flipped: SectionStroke = { ...sec100, x: 100, y: 100, w: -100, h: -100 };
    expect(layerDragCarrySet([flipped, rectAt('in', 50, 50)], ['s']).has('in')).toBe(true);
  });

  test('rotation is ignored (unrotated bbox centre)', () => {
    const r = { ...rectAt('rot', 95, 50), w: 60, x: 65, rotation: 90 } as RectStroke;
    expect(layerDragCarrySet([sec100, r], ['s']).has('rot')).toBe(true);
  });

  test('pen / arrow / ellipse use their bbox centre too', () => {
    const p: PenStroke = {
      ...pen,
      id: 'p',
      points: [
        [10, 10],
        [90, 90],
      ],
    };
    const ar: ArrowStroke = { ...arrow, id: 'ar', x1: 60, y1: 60, x2: 200, y2: 60 }; // centre 130 → out
    const e: EllipseStroke = { ...ellipse, id: 'e', cx: 80, cy: 20, rx: 50, ry: 50 };
    const got = layerDragCarrySet([sec100, p, ar, e], ['s']);
    expect(got.has('p')).toBe(true);
    expect(got.has('ar')).toBe(false);
    expect(got.has('e')).toBe(true);
  });

  test('ANCHORED text is never in the set (no bbox without anchors) — it rides its host', () => {
    const host = rectAt('h', 50, 50);
    const lbl: TextStroke = { ...anchoredText, anchorId: 'h' };
    const got = layerDragCarrySet([sec100, host, lbl], ['s']);
    expect(got.has('h')).toBe(true);
    expect(got.has(lbl.id)).toBe(false);
  });

  test('only SELECTED sections carry; an unselected section carries nothing', () => {
    expect([...layerDragCarrySet([sec100, rectAt('in', 50, 50)], [])]).toEqual([]);
  });

  test('a NESTED inner section is not carried, but its contents are (centre inside outer)', () => {
    // Today's behaviour — the frame of an inner section stays behind while the
    // strokes sitting on it move with the outer one.
    const outer: SectionStroke = { ...sec100, id: 'outer', w: 400, h: 400 };
    const inner: SectionStroke = { ...sec100, id: 'inner', x: 50, y: 50, w: 100, h: 100 };
    const onInner = rectAt('on', 100, 100);
    const got = layerDragCarrySet([outer, inner, onInner], ['outer']);
    expect(got.has('inner')).toBe(false);
    expect(got.has('on')).toBe(true);
  });

  test('a stroke inside TWO selected overlapping sections is carried once', () => {
    const s2: SectionStroke = { ...sec100, id: 's2', x: 50 };
    const got = layerDragCarrySet([sec100, s2, rectAt('in', 75, 50)], ['s', 's2']);
    expect([...got].sort()).toEqual(['in', 's', 's2']);
  });
});

describe('section membership — headless reader (bin/read-annotations.mjs attachSectionMembers)', () => {
  test('centre-in-box, border-inclusive — agrees with the layer on box kinds', () => {
    const strokes: Stroke[] = [
      sec100,
      rectAt('in', 50, 50),
      rectAt('edge', 100, 50),
      rectAt('out', 111, 50),
      { ...sticky, id: 'stk', x: 20, y: 20, w: 40, h: 40 },
    ];
    const reader = readerMembers(strokes, 's').sort();
    const layer = [...layerDragCarrySet(strokes, ['s'])].filter((id) => id !== 's').sort();
    expect(reader).toEqual(['edge', 'in', 'stk']);
    expect(reader).toEqual(layer);
  });

  test('members come back in SPATIAL reading order (rows, then x), not z order', () => {
    const strokes: Stroke[] = [
      sec100,
      rectAt('bottom', 20, 80),
      rectAt('topRight', 80, 20),
      rectAt('topLeft', 20, 22), // same row band as topRight (band ≥ 16)
    ];
    expect(readerMembers(strokes, 's')).toEqual(['topLeft', 'topRight', 'bottom']);
  });

  test('nested sections are never members of the outer section', () => {
    const outer: SectionStroke = { ...sec100, id: 'outer', w: 400, h: 400 };
    const inner: SectionStroke = { ...sec100, id: 'inner', x: 50, y: 50 };
    expect(readerMembers([outer, inner, rectAt('on', 100, 100)], 'outer')).toEqual(['on']);
  });

  test('DRIFT: standalone text — reader uses its (x, y) POINT, layer uses its bbox centre', () => {
    // Text anchored at (90, 90) with a long line: bbox centre is far right of
    // the section, but the reader has no w/h for text and uses (x, y) itself.
    const t: TextStroke = { ...standaloneText, id: 't', text: 'a long label here', x: 90, y: 90 };
    const strokes: Stroke[] = [sec100, t];
    expect(readerMembers(strokes, 's')).toEqual(['t']);
    expect(layerDragCarrySet(strokes, ['s']).has('t')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sticky grow-only.

describe('grownStickyBox — grow-only, capped, normalized', () => {
  const s = { x: 10, y: 20, w: 200, h: 200 };

  test('null when the text already fits (measured ≤ current height)', () => {
    expect(grownStickyBox(s, 150)).toBeNull();
    expect(grownStickyBox(s, 200)).toBeNull();
  });

  test('never shrinks — a roomy note stays roomy', () => {
    expect(grownStickyBox({ ...s, h: 900 }, 300)).toBeNull();
  });

  test('grows to ceil(measured) when the text overflows', () => {
    expect(grownStickyBox(s, 240.2)).toEqual({ x: 10, y: 20, w: 200, h: 241 });
  });

  test('non-finite / non-positive measurements are ignored', () => {
    for (const m of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      expect(grownStickyBox(s, m)).toBeNull();
    }
  });

  test(`caps at STICKY_MAX_GROWN_H (${STICKY_MAX_GROWN_H})`, () => {
    expect(STICKY_MAX_GROWN_H).toBe(8000);
    expect(grownStickyBox(s, 1e9)?.h).toBe(STICKY_MAX_GROWN_H);
    // already at / past the cap → nothing to grow
    expect(grownStickyBox({ ...s, h: STICKY_MAX_GROWN_H }, 1e9)).toBeNull();
    expect(grownStickyBox({ ...s, h: 9000 }, 1e9)).toBeNull();
  });

  test('negative w/h is normalized on the way out (top-left + positive extents)', () => {
    // A sticky dragged bottom-up/right-to-left: x/y is the bottom-right corner.
    const flipped = { x: 210, y: 220, w: -200, h: -200 };
    expect(grownStickyBox(flipped, 300)).toEqual({ x: 10, y: 20, w: 200, h: 300 });
    // |h| is what "fits" is compared against
    expect(grownStickyBox(flipped, 199)).toBeNull();
  });

  test('growth keeps the TOP edge — the note grows downward', () => {
    const out = grownStickyBox(s, 500);
    expect(out?.y).toBe(s.y);
    expect(out?.x).toBe(s.x);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Groups.

describe('group expansion — outermost group', () => {
  // groupIds are DEEPEST → SHALLOWEST; the outermost is the LAST element.
  const a: RectStroke = { ...rectAt('a', 0, 0), groupIds: ['inner', 'outer'] };
  const b: RectStroke = { ...rectAt('b', 50, 0), groupIds: ['inner', 'outer'] };
  const c: RectStroke = { ...rectAt('c', 100, 0), groupIds: ['outer'] };
  const d: RectStroke = { ...rectAt('d', 150, 0), groupIds: ['other'] };
  const e: RectStroke = rectAt('e', 200, 0);
  const strokes = [e, c, a, d, b];

  test('outermostGroupOf is the last groupIds element; null when ungrouped / empty', () => {
    expect(outermostGroupOf(a)).toBe('outer');
    expect(outermostGroupOf(e)).toBeNull();
    expect(outermostGroupOf({ ...e, groupIds: [] })).toBeNull();
  });

  test('a member of a NESTED inner group expands to the whole OUTERMOST group', () => {
    expect(expandIdsToGroups(['a'], strokes)).toEqual(['c', 'a', 'b']);
  });

  test('result is in document (z) order, deduped', () => {
    expect(expandIdsToGroups(['b', 'a', 'b'], strokes)).toEqual(['c', 'a', 'b']);
  });

  test('ungrouped ids pass through; separate groups expand independently', () => {
    expect(expandIdsToGroups(['e', 'd'], strokes)).toEqual(['e', 'd']);
    expect(expandIdsToGroups(['e', 'c', 'd'], strokes)).toEqual(['e', 'c', 'a', 'd', 'b']);
  });

  test('stale ids (no live stroke) are preserved at the END, not dropped', () => {
    expect(expandIdsToGroups(['ghost', 'c'], strokes)).toEqual(['c', 'a', 'b', 'ghost']);
  });

  test('there is no way to select only the inner group by id expansion', () => {
    // Today's model has no "enter group" step in the pure helper — any member
    // resolves to the outermost group.
    expect(expandIdsToGroups(['b'], strokes)).toEqual(expandIdsToGroups(['c'], strokes));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bound arrows — facing anchor recompute.

describe('bound arrows — facing-anchor recompute when a host moves', () => {
  const A: RectStroke = { ...rect, id: 'A', x: 0, y: 0, w: 100, h: 100 };
  const B: RectStroke = { ...rect, id: 'B', x: 300, y: 0, w: 100, h: 100 };
  const link2 = (pinned = false): ArrowStroke => ({
    ...arrow,
    id: 'L',
    x1: 100,
    y1: 50,
    x2: 300,
    y2: 50,
    startBind: { hostId: 'A', nx: 1, ny: 0.5 },
    endBind: { hostId: 'B', nx: 0, ny: 0.5, ...(pinned ? { pinned: true } : {}) },
  });

  test('settled auto binds are a referential no-op (same array returned)', () => {
    const strokes = [A, B, link2()];
    expect(recomputeBoundArrows(strokes)).toBe(strokes);
  });

  test('AUTO binds re-pick the side FACING the other host when a host moves', () => {
    // Move B below A: the connector should leave A from the bottom and enter B
    // from the top.
    const Bbelow = { ...B, x: 0, y: 400 };
    const out = recomputeBoundArrows([A, Bbelow, link2()]);
    const l = out[2] as ArrowStroke;
    expect(l.startBind).toEqual({ hostId: 'A', nx: 0.5, ny: 1 });
    expect(l.endBind).toEqual({ hostId: 'B', nx: 0.5, ny: 0 });
    expect([l.x1, l.y1, l.x2, l.y2]).toEqual([50, 100, 50, 400]);
  });

  test('PINNED binds keep their magnet; only the endpoint position is re-derived', () => {
    const Bbelow = { ...B, x: 0, y: 400 };
    const out = recomputeBoundArrows([A, Bbelow, link2(true)]);
    const l = out[2] as ArrowStroke;
    expect(l.startBind).toEqual({ hostId: 'A', nx: 0.5, ny: 1 }); // auto end still re-routes
    expect(l.endBind).toEqual({ hostId: 'B', nx: 0, ny: 0.5, pinned: true });
    expect([l.x2, l.y2]).toEqual([0, 450]); // left-middle of the moved B
  });

  test('both-bound: each end faces the OTHER HOST CENTRE (not the other endpoint)', () => {
    // B moved diagonally down-right, dominant axis x (normalized by half-extents).
    const Bdiag = { ...B, x: 300, y: 200 };
    const l = recomputeBoundArrows([A, Bdiag, link2()])[2] as ArrowStroke;
    expect(l.startBind).toMatchObject({ nx: 1, ny: 0.5 });
    expect(l.endBind).toMatchObject({ nx: 0, ny: 0.5 });
  });

  test('a single-bound arrow faces its FREE endpoint coordinate', () => {
    const free: ArrowStroke = {
      ...arrow,
      id: 'F',
      x1: 100,
      y1: 50,
      x2: 50,
      y2: -300, // free end straight above A
      startBind: { hostId: 'A', nx: 1, ny: 0.5 },
    };
    const l = recomputeBoundArrows([A, free])[1] as ArrowStroke;
    expect(l.startBind).toEqual({ hostId: 'A', nx: 0.5, ny: 0 });
    expect([l.x1, l.y1]).toEqual([50, 0]);
    expect([l.x2, l.y2]).toEqual([50, -300]); // free end untouched
  });

  test('deleted host → bind stripped, endpoint frozen, arrow survives', () => {
    const l = recomputeBoundArrows([A, link2()])[1] as ArrowStroke;
    expect(l.endBind).toBeUndefined();
    expect([l.x2, l.y2]).toEqual([300, 50]);
    expect(l.startBind).toBeDefined();
  });

  test('a rotated host carries its magnets (anchor rotates about the bbox centre)', () => {
    const rot = { ...A, rotation: 90 };
    const [px, py] = anchorPoint(rot, 1, 0.5) ?? [Number.NaN, Number.NaN];
    expect(px).toBeCloseTo(50, 9);
    expect(py).toBeCloseTo(100, 9);
  });

  test('facingAnchor: dominant axis picks the side, normalized by half-extents; tie → horizontal', () => {
    expect(facingAnchor(A, 500, 50)).toEqual({ hostId: 'A', nx: 1, ny: 0.5 });
    expect(facingAnchor(A, -500, 50)).toEqual({ hostId: 'A', nx: 0, ny: 0.5 });
    expect(facingAnchor(A, 50, 500)).toEqual({ hostId: 'A', nx: 0.5, ny: 1 });
    expect(facingAnchor(A, 50, -500)).toEqual({ hostId: 'A', nx: 0.5, ny: 0 });
    // exact diagonal → rx === ry → horizontal side wins
    expect(facingAnchor(A, 150, 150)).toEqual({ hostId: 'A', nx: 1, ny: 0.5 });
    // wide card: a target at 45° visually "below" picks the bottom side
    const wide: RectStroke = { ...A, w: 400, h: 50 };
    expect(facingAnchor(wide, 300, 225)).toEqual({ hostId: 'A', nx: 0.5, ny: 1 });
    // degenerate host → null
    expect(facingAnchor({ ...A, w: 0 }, 1, 1)).toBeNull();
  });

  test('bound arrows are STORED with re-derived x1..y2 (derived data persisted)', () => {
    const Bbelow = { ...B, x: 0, y: 400 };
    const svg = strokesToSvg(recomputeBoundArrows([A, Bbelow, link2()]));
    expect(svg).toContain('x1="50"');
    expect(svg).toContain('y2="400"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Align / distribute / snap — only the parts v2 must keep or change.

describe('align / distribute — sections and groups', () => {
  const s1: SectionStroke = { ...sec100, id: 's1', x: 0, y: 0 };
  const onS1 = rectAt('on', 50, 50);
  const r2 = rectAt('r2', 300, 300);

  test('groups align as ONE unit (their union bbox)', () => {
    const g1 = { ...rectAt('g1', 100, 0), groupIds: ['G'] };
    const g2 = { ...rectAt('g2', 200, 50), groupIds: ['G'] };
    const l = rectAt('l', 0, 400);
    const out = alignStrokes([g1, g2, l], ['g1', 'l'], 'left');
    const byId = new Map(out.map((s) => [s.id, s]));
    // union of the group starts at x=90; the group's internal offset is kept
    expect((byId.get('g1') as RectStroke).x).toBe(-10);
    expect((byId.get('g2') as RectStroke).x).toBe(90);
    expect((byId.get('l') as RectStroke).x).toBe(-10);
  });

  test('fewer than 2 units (align) / 3 units (distribute) → same array back', () => {
    const arr = [r2];
    expect(alignStrokes(arr, ['r2'], 'left')).toBe(arr);
    const arr2 = [r2, s1];
    expect(distributeStrokes(arr2, ['r2', 's1'], 'h')).toBe(arr2);
  });

  test('today: aligning a section moves ONLY the section frame (contents stay put)', () => {
    // Pinned here as the current observable result so Milestone D's change is
    // visible; the v2 expectation is the todo below.
    const out = alignStrokes([s1, onS1, r2], ['s1', 'r2'], 'right');
    const byId = new Map(out.map((s) => [s.id, s]));
    expect((byId.get('s1') as SectionStroke).x).toBe(210);
    expect(byId.get('on')).toBe(onS1);
  });

  test.todo(
    'align / distribute a section carries its contents — expected v2 behaviour: containment is explicit (parent id) and every section op moves children; bug ref annotations-layer.tsx:1356 (translateStrokes/applyToStrokes ignore sections), annotations-align.ts:46-76 (unitsOf has no section expansion)'
  );
});

describe('computeSnap — tie-breaking + grid fallback', () => {
  test('nearest line within threshold wins; equal distance → FIRST candidate', () => {
    const m = { x: 0, y: 0, w: 10, h: 10 };
    const r = computeSnap(
      m,
      [
        { x: 13, y: 100, w: 10, h: 10 },
        { x: -13, y: 200, w: 10, h: 10 },
      ],
      5
    );
    // candidate 1: left edge 13 vs moving right edge 10 → +3; candidate 2:
    // right edge -3 vs moving left 0 → -3. Tie → first wins.
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
  });

  test('grid is a per-axis FALLBACK only when no smart guide matched, leading edge only', () => {
    const r = computeSnap({ x: 22, y: 50, w: 10, h: 10 }, [], 3, { grid: 24 });
    expect(r.dx).toBe(2); // 22 → 24
    expect(r.dy).toBe(-2); // 50 → 48 (within threshold 3)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Undo of a multi-select move (commands/annotation-strokes-command.ts).

describe('undo of a multi-select move', () => {
  const A: RectStroke = { ...rect, id: 'A', x: 0, y: 0, w: 100, h: 100 };
  const B: RectStroke = { ...rect, id: 'B', x: 300, y: 0, w: 100, h: 100 };
  const S: StickyStroke = { ...sticky, id: 'S', x: 0, y: 300 };
  const Lbl: TextStroke = { ...anchoredText, id: 'Lbl', anchorId: 'A' };
  const L: ArrowStroke = {
    ...arrow,
    id: 'L',
    x1: 100,
    y1: 50,
    x2: 300,
    y2: 50,
    startBind: { hostId: 'A', nx: 1, ny: 0.5 },
    endBind: { hostId: 'B', nx: 0, ny: 0.5 },
  };
  const before: Stroke[] = [A, Lbl, B, S, L];
  // What the layer does for a nudge / drag of the selection {A, S}:
  // translate the selected ids, then re-derive bound arrows
  // (annotations-layer.tsx:1356-1362).
  const moved = new Set(['A', 'S']);
  const after = recomputeBoundArrows(
    before.map((s) => (moved.has(s.id) ? translateOne(s, 0, 250) : s))
  );

  test('the move itself: selected strokes shift, bound arrow re-routes, others untouched', () => {
    const byId = new Map(after.map((s) => [s.id, s]));
    expect((byId.get('A') as RectStroke).y).toBe(250);
    expect((byId.get('S') as StickyStroke).y).toBe(550);
    expect(byId.get('B')).toBe(B);
    expect(byId.get('Lbl')).toBe(Lbl); // anchored label is not in the record's diff
    const l = byId.get('L') as ArrowStroke;
    expect(l).not.toBe(L); // the arrow is REWRITTEN though it was not selected
    expect(l.startBind).toMatchObject({ hostId: 'A' });
  });

  test('do() puts AFTER (with BEFORE as baseline); undo() puts BEFORE (with AFTER as baseline)', async () => {
    const putFn = mock((_n: readonly Stroke[], _b: readonly Stroke[]) => Promise.resolve());
    const cmd = createAnnotationStrokesCommand({ before, after, putFn });
    await cmd.do();
    await cmd.undo();
    expect(putFn).toHaveBeenCalledTimes(2);
    expect(putFn.mock.calls[0]?.[0]).toEqual(after);
    expect(putFn.mock.calls[0]?.[1]).toEqual(before);
    expect(putFn.mock.calls[1]?.[0]).toEqual(before);
    expect(putFn.mock.calls[1]?.[1]).toEqual(after);
  });

  test('the record is a FULL-ARRAY snapshot pair (every stroke, not a per-element diff)', async () => {
    const putFn = mock((_n: readonly Stroke[], _b: readonly Stroke[]) => Promise.resolve());
    const cmd = createAnnotationStrokesCommand({ before, after, putFn });
    await cmd.undo();
    // All five strokes travel, including the three that did not change.
    expect(putFn.mock.calls[0]?.[0]).toHaveLength(5);
  });

  test('each call hands out FRESH clones (callers may mutate them freely)', async () => {
    const putFn = mock((_n: readonly Stroke[], _b: readonly Stroke[]) => Promise.resolve());
    const cmd = createAnnotationStrokesCommand({ before, after, putFn });
    await cmd.undo();
    await cmd.undo();
    const first = putFn.mock.calls[0]?.[0];
    const second = putFn.mock.calls[1]?.[0];
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first?.[0]).not.toBe(second?.[0]);
    expect(first?.[0]).not.toBe(A);
  });

  test('default label for a same-count move is "edit N strokes" (the layer overrides it with "move N")', () => {
    const cmd = createAnnotationStrokesCommand({ before, after, putFn: () => undefined });
    expect(cmd.label).toBe('edit 5 strokes');
  });

  test('undo restores BEFORE wholesale — a peer change made after the move would be reverted by the snapshot', async () => {
    // Characterizes plan Problem §7: the command replays a full snapshot; any
    // concurrent change is only protected by the layer's reconcileCommit, not
    // by the command itself.
    const peerAdded: RectStroke = rectAt('peer', 900, 900);
    let state: readonly Stroke[] = [...after, peerAdded];
    const putFn = (next: readonly Stroke[]) => {
      state = next;
    };
    const cmd = createAnnotationStrokesCommand({ before, after, putFn });
    await cmd.undo();
    expect(state.some((s) => s.id === 'peer')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Known bugs — flipped to real assertions in Milestone D.

describe('known bugs (Milestone D flips these)', () => {
  test.todo(
    'nudge (arrow keys) moves a section AND its contents — expected v2 behaviour: nudge goes through the same containment-aware move as drag; bug ref annotations-layer.tsx:1356 (translateStrokes translates only the selected ids)'
  );
  test.todo(
    'a marquee STARTED inside a section interior does not select the section — expected v2 behaviour: the marquee selects only the strokes it touches inside the section, the section itself only when fully enclosed; bug ref annotations-layer.tsx:2643-2653 (bbox-intersection test includes the section containing the marquee)'
  );
  test.todo(
    'Alt-duplicate of a section drags the CLONE plus cloned contents and leaves the original contents in place — expected v2 behaviour: duplicate clones the section subtree and moves only clones; bug ref annotations-layer.tsx:2462-2497 (duplicateStrokes clones only the frame, then the carry set is computed over the snapshot that still holds the ORIGINAL children, so they move)'
  );
  test.todo(
    'a nested inner section drawn inside an outer one renders in FRONT of the outer — expected v2 behaviour: z-order by containment (child above parent); bug ref annotations-layer.tsx:2189 (every new section is prepended to the back of the array)'
  );
  test.todo(
    'dragging an outer section carries a nested inner section frame together with its contents — expected v2 behaviour: nested sections move as a subtree; bug ref annotations-layer.tsx:2491 (t.tool === "section" is excluded from the carry set)'
  );
  test.todo(
    'delete / copy / duplicate of a section include its contents — expected v2 behaviour: section ops act on the subtree; bug ref annotations-layer.tsx:1340-1354 (delete filters selected ids only), annotations-groups.ts:157-212 (duplicateStrokes has no section expansion)'
  );
  test.todo(
    'a peer deleting the element I am editing does not drop my typed text — expected v2 behaviour: the local draft survives (re-create or prompt), never silently lost; bug ref annotations-layer.tsx:2974-2978 (commitEditing returns early when editingTarget resolved to null after the peer delete)'
  );
  test.todo(
    'headless reader and layer agree on standalone-text section membership — expected v2 behaviour: one containment rule (explicit parent id) shared by both; drift ref bin/read-annotations.mjs:693-696 (w/h null → centre = (x,y)) vs annotations-layer.tsx:2492-2495 (strokeBBox centre)'
  );
});
