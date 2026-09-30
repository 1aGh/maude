// figma/to-strokes.ts — the FigJam → whiteboard mapping.
//
// Asserted against the PURPOSE-BUILT fixture board `Em6NOwaOFTYV7NlQT4NK8l`
// (`.ai/plans/notes/figma-import-fixtures.md`), where every node exists to
// exercise one named behaviour and node ids are stable — so these tests assert
// against SPECIFIC IDS rather than "a board".

import { describe, expect, test } from 'bun:test';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import { isBindable } from '../annotations-bindings.ts';
import type { ArrowStroke, SectionStroke, StickyStroke, Stroke } from '../annotations-model.ts';
import { STICKY_PALETTE, sanitizeAnnotationSvg, strokesToSvg } from '../annotations-model.ts';
import { nearestStickyColor, toBoardElements, toStrokes } from './to-strokes.ts';
import { normalizeDocument } from './types.ts';

const KEY = 'Em6NOwaOFTYV7NlQT4NK8l';

const solid = (r: number, g: number, b: number) => [
  { type: 'SOLID', visible: true, color: { r, g, b, a: 1 } },
];

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/**
 * A trimmed replica of the real fixture board. Coordinates deliberately start
 * deep in negative space, mirroring the measured real board (x ≈ −3 244…+11 037,
 * y ≈ −6 272…+23 488) — an untranslated import lands tens of thousands of px
 * off-screen, so the origin shift is part of what these tests cover.
 */
function fixtureBoard() {
  return {
    id: '0:0',
    name: 'Document',
    type: 'DOCUMENT',
    children: [
      {
        id: '0:1',
        name: 'Page 1',
        type: 'CANVAS',
        children: [
          // ── sections: outer + NESTED ──
          {
            id: '1:2',
            name: 'Sekce vnější',
            type: 'SECTION',
            absoluteBoundingBox: box(-3244, -6272, 2000, 1500),
            fills: solid(0.9, 0.9, 0.92),
            children: [
              {
                id: '1:3',
                name: 'Sekce vnitřní (nested)',
                type: 'SECTION',
                absoluteBoundingBox: box(-3000, -6000, 800, 600),
                children: [
                  {
                    id: '1:8',
                    name: 'Sticky yellow',
                    type: 'STICKY',
                    absoluteBoundingBox: box(-2900, -5900, 240, 240),
                    characters: 'Persona A',
                    fills: solid(0.99, 0.91, 0.65),
                  },
                ],
              },
            ],
          },
          // ── stickies: palette + the WIDE one ──
          {
            id: '1:12',
            name: 'Sticky green',
            type: 'STICKY',
            absoluteBoundingBox: box(0, 0, 240, 240),
            characters: 'Zelená',
            fills: solid(0.75, 0.89, 0.75),
          },
          {
            id: '1:20',
            name: 'Sticky wide',
            type: 'STICKY',
            absoluteBoundingBox: box(400, 0, 416, 240),
            characters: 'Široká',
            fills: solid(1, 1, 1),
          },
          // ── shapes: one per shapeType ──
          {
            id: '2:17',
            name: 'Příliš žluťoučký — "test" / <b> & \'x\'',
            type: 'SHAPE_WITH_TEXT',
            shapeType: 'SQUARE',
            absoluteBoundingBox: box(0, 400, 200, 200),
            characters: 'Čtverec',
            strokes: solid(0.1, 0.1, 0.1),
            fills: solid(1, 1, 1),
          },
          {
            id: '2:21',
            name: 'Ellipse',
            type: 'SHAPE_WITH_TEXT',
            shapeType: 'ELLIPSE',
            absoluteBoundingBox: box(300, 400, 200, 200),
          },
          {
            id: '2:24',
            name: 'Rounded',
            type: 'SHAPE_WITH_TEXT',
            shapeType: 'ROUNDED_RECTANGLE',
            absoluteBoundingBox: box(600, 400, 200, 200),
            cornerRadius: 16,
          },
          {
            id: '2:28',
            name: 'Diamond',
            type: 'SHAPE_WITH_TEXT',
            shapeType: 'DIAMOND',
            absoluteBoundingBox: box(900, 400, 200, 200),
          },
          {
            id: '2:32',
            name: 'TriUp',
            type: 'SHAPE_WITH_TEXT',
            shapeType: 'TRIANGLE_UP',
            absoluteBoundingBox: box(1200, 400, 200, 200),
          },
          {
            id: '2:36',
            name: 'TriDown',
            type: 'SHAPE_WITH_TEXT',
            shapeType: 'TRIANGLE_DOWN',
            absoluteBoundingBox: box(1500, 400, 200, 200),
          },
          // ── the two deliberately UNMAPPABLE shapes ──
          {
            id: '2:40',
            name: 'Parallelogram',
            type: 'SHAPE_WITH_TEXT',
            shapeType: 'PARALLELOGRAM_RIGHT',
            absoluteBoundingBox: box(1800, 400, 200, 200),
          },
          {
            id: '2:44',
            name: 'EngDatabase',
            type: 'SHAPE_WITH_TEXT',
            shapeType: 'ENG_DATABASE',
            absoluteBoundingBox: box(2100, 400, 200, 200),
          },
          // ── standalone TEXT (connector target C2) ──
          {
            id: '2:50',
            name: 'Archetyp',
            type: 'TEXT',
            absoluteBoundingBox: box(0, 800, 120, 30),
            characters: 'Archetyp',
            style: { fontSize: 16 },
          },
          // ── GROUP (connector target C3) ──
          {
            id: '2:62',
            name: 'Group 13935',
            type: 'GROUP',
            absoluteBoundingBox: box(400, 800, 300, 200),
            children: [
              {
                id: '2:54',
                name: 'member a',
                type: 'RECTANGLE',
                absoluteBoundingBox: box(400, 800, 100, 100),
              },
              {
                id: '2:58',
                name: 'member b',
                type: 'RECTANGLE',
                absoluteBoundingBox: box(550, 800, 100, 100),
              },
            ],
          },
          // ── rotation round-trip ──
          {
            id: '2:63',
            name: 'Rotated',
            type: 'SHAPE_WITH_TEXT',
            shapeType: 'SQUARE',
            absoluteBoundingBox: box(900, 800, 150, 150),
            rotation: 15,
          },
          // ── connectors ──
          {
            id: '2:67', // happy path: shape → shape
            name: 'C1',
            type: 'CONNECTOR',
            absoluteBoundingBox: box(200, 500, 100, 10),
            connectorStart: { endpointNodeId: '2:17' },
            connectorEnd: { endpointNodeId: '2:21' },
            connectorStartCap: 'NONE',
            connectorEndCap: 'ARROW_LINES',
            connectorLineType: 'ELBOWED',
          },
          {
            id: '2:71', // THE WIDENING CASE: → TEXT
            name: 'C2',
            type: 'CONNECTOR',
            absoluteBoundingBox: box(900, 600, 100, 10),
            connectorStart: { endpointNodeId: '2:28' },
            connectorEnd: { endpointNodeId: '2:50' },
            connectorEndCap: 'ARROW_LINES',
          },
          {
            id: '2:75', // THE MUST-DEGRADE CASE: → GROUP
            name: 'C3',
            type: 'CONNECTOR',
            absoluteBoundingBox: box(700, 600, 100, 10),
            connectorStart: { endpointNodeId: '2:24' },
            connectorEnd: { endpointNodeId: '2:62' },
            connectorEndCap: 'ARROW_EQUILATERAL',
          },
          {
            id: '2:79', // across a section boundary, sticky-as-host
            name: 'C4',
            type: 'CONNECTOR',
            absoluteBoundingBox: box(0, 200, 100, 10),
            connectorStart: { endpointNodeId: '1:8' },
            connectorEnd: { endpointNodeId: '2:17' },
          },
          {
            id: '2:83', // no arrowheads at all, STRAIGHT
            name: 'C5',
            type: 'CONNECTOR',
            absoluteBoundingBox: box(1300, 600, 100, 10),
            connectorStart: { endpointNodeId: '2:32' },
            connectorEnd: { endpointNodeId: '2:36' },
            connectorStartCap: 'NONE',
            connectorEndCap: 'NONE',
            connectorLineType: 'STRAIGHT',
          },
          {
            id: '2:99', // DEGENERATE self-connector (observed on the real board)
            name: 'C-self',
            type: 'CONNECTOR',
            absoluteBoundingBox: box(0, 0, 0, 0),
            connectorStart: { endpointNodeId: '2:62' },
            connectorEnd: { endpointNodeId: '2:62' },
          },
          // ── unmappable node types ──
          { id: '3:1', name: 'W', type: 'WIDGET', absoluteBoundingBox: box(0, 1200, 100, 100) },
          { id: '3:2', name: 'T', type: 'TABLE', absoluteBoundingBox: box(200, 1200, 100, 100) },
        ],
      },
    ],
  };
}

function translate() {
  const doc = normalizeDocument(fixtureBoard(), { fileKey: KEY, surface: 'board' });
  return toStrokes(doc, { resetIds: true });
}

const byFigmaNode = (result: ReturnType<typeof translate>, tool: string): Stroke[] =>
  result.strokes.filter((s) => s.tool === tool);

describe('coordinates', () => {
  test('the board is translated to a positive-space origin', () => {
    // Untranslated, this board starts at (−3244, −6272) — tens of thousands of
    // px off-screen. Every stroke must land at or after (0, 0).
    const { strokes, origin } = translate();
    expect(origin).toEqual({ x: -3244, y: -6272 });
    for (const s of strokes) {
      if ('x' in s && typeof s.x === 'number') expect(s.x).toBeGreaterThanOrEqual(0);
      if ('y' in s && typeof s.y === 'number') expect(s.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('stickies', () => {
  test('absolute geometry is PRESERVED — 240×240 and the 416-wide variant', () => {
    const stickies = byFigmaNode(translate(), 'sticky') as StickyStroke[];
    const sizes = stickies.map((s) => `${s.w}x${s.h}`).sort();
    // Never normalised to Maude's STICKY_DEFAULT_W (200) — that collapses layout.
    expect(sizes).toEqual(['240x240', '240x240', '416x240']);
  });

  test('colours snap onto the sticky paper palette', () => {
    const stickies = byFigmaNode(translate(), 'sticky') as StickyStroke[];
    for (const s of stickies) {
      expect(STICKY_PALETTE as readonly string[]).toContain(s.color);
    }
  });

  test('nearestStickyColor picks the closest paper tint', () => {
    expect(nearestStickyColor('#ffffff')).toBe('#ffffff');
    expect(nearestStickyColor('#fdf0b0')).toBe('#fce8a6');
    expect(nearestStickyColor(null)).toBe(STICKY_PALETTE[0]);
  });

  test('sticky body text survives', () => {
    const stickies = byFigmaNode(translate(), 'sticky') as StickyStroke[];
    expect(stickies.map((s) => s.text)).toContain('Persona A');
  });
});

describe('sections', () => {
  test('nested sections both land, FLAT — nesting survives as geometry', () => {
    const sections = byFigmaNode(translate(), 'section') as SectionStroke[];
    expect(sections.length).toBe(2);
    // SectionStroke has no parent field, by design.
    for (const s of sections) expect('parentId' in s).toBe(false);
    const [outer, inner] = sections.sort((a, b) => b.w - a.w);
    // The inner one is geometrically contained in the outer one — which is how
    // Maude sections carry their contents (drag carries what is inside).
    expect(inner.x).toBeGreaterThanOrEqual(outer.x);
    expect(inner.y).toBeGreaterThanOrEqual(outer.y);
    expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w);
  });

  test('section labels are carried', () => {
    const labels = (byFigmaNode(translate(), 'section') as SectionStroke[]).map((s) => s.label);
    expect(labels).toContain('Sekce vnitřní (nested)');
  });
});

describe('shape vocabulary', () => {
  test('the six mappable shapeTypes land on their Maude primitives', () => {
    const { strokes } = translate();
    const rects = strokes.filter((s) => s.tool === 'rect');
    const ellipses = strokes.filter((s) => s.tool === 'ellipse');
    const polys = strokes.filter((s) => s.tool === 'polygon');
    // SQUARE + ROUNDED_RECTANGLE + the rotated SQUARE + the two GROUP members.
    expect(rects.length).toBeGreaterThanOrEqual(3);
    expect(ellipses.length).toBe(1);
    expect(polys.map((s) => (s as { shape: string }).shape).sort()).toEqual([
      'diamond',
      'triangle',
      'triangle-down',
    ]);
  });

  test('ROUNDED_RECTANGLE carries its cornerRadius', () => {
    const { strokes } = translate();
    const rounded = strokes.find((s) => s.tool === 'rect' && 'cornerRadius' in s && s.cornerRadius);
    expect(rounded).toBeDefined();
  });

  test('the two unmappable shapeTypes are SKIPPED AND REPORTED, never approximated', () => {
    const { report, strokes } = translate();
    const unmappable = report.entries.filter((e) => e.disposition === 'unmappable-shape');
    expect(unmappable.map((e) => e.nodeId).sort()).toEqual(['2:40', '2:44']);
    expect(unmappable.map((e) => e.detail).sort()).toEqual(['ENG_DATABASE', 'PARALLELOGRAM_RIGHT']);
    // And nothing was emitted in their place.
    expect(strokes.some((s) => s.id.includes('_2_40_'))).toBe(false);
  });

  test('unmappable NODE TYPES are reported too', () => {
    const { report } = translate();
    const types = report.entries
      .filter((e) => e.disposition === 'unmappable-type')
      .map((e) => e.type)
      .sort();
    expect(types).toEqual(['TABLE', 'WIDGET']);
  });

  test('rotation round-trips (Figma CW → Maude CCW)', () => {
    const { strokes } = translate();
    const rotated = strokes.find((s) => 'rotation' in s && s.rotation);
    expect(rotated?.rotation).toBe(-15);
  });
});

describe('groups → the flat groupIds tag array', () => {
  test('members carry the group tag; no group STROKE is invented', () => {
    const { strokes } = translate();
    const members = strokes.filter((s) => s.groupIds?.length);
    expect(members.length).toBeGreaterThanOrEqual(2);
    // Maude has no group object — only tags.
    expect(strokes.some((s) => (s as { tool: string }).tool === 'group')).toBe(false);
  });

  test("a nested section's sticky carries no spurious group tag", () => {
    const { strokes } = translate();
    const persona = strokes.find((s) => s.tool === 'sticky' && s.text === 'Persona A');
    expect(persona?.groupIds).toBeUndefined();
  });
});

describe('connectors — the flagship', () => {
  const arrows = () => byFigmaNode(translate(), 'arrow') as ArrowStroke[];

  test('the happy path binds BOTH ends', () => {
    const { strokes } = translate();
    const all = strokes.filter((s) => s.tool === 'arrow') as ArrowStroke[];
    const bound = all.filter((a) => a.startBind && a.endBind);
    expect(bound.length).toBeGreaterThanOrEqual(3);
  });

  test('C2 (→ TEXT) produces a LIVE bind — the isBindable widening case', () => {
    // Before DDR-216 D9 this endpoint degraded to a frozen line. "Always
    // editable" means it stays a re-routable arrow.
    const { strokes } = translate();
    const textStroke = strokes.find((s) => s.tool === 'text' && s.text === 'Archetyp');
    expect(textStroke).toBeDefined();
    expect(isBindable(textStroke as Stroke)).toBe(true);
    const bound = (strokes.filter((s) => s.tool === 'arrow') as ArrowStroke[]).find(
      (a) => a.endBind?.hostId === textStroke?.id
    );
    expect(bound).toBeDefined();
  });

  test('C3 (→ GROUP) DEGRADES to the group bbox and reports it', () => {
    const { report } = translate();
    const degraded = report.entries.filter((e) => e.disposition === 'bind-degraded-to-bbox');
    expect(degraded.map((e) => e.nodeId)).toContain('2:75');
    expect(degraded[0].detail).toBe('group endpoint');
  });

  test('a degenerate self-connector is dropped, not emitted zero-length', () => {
    const { report, strokes } = translate();
    expect(report.entries.some((e) => e.disposition === 'bind-dropped-self-connector')).toBe(true);
    const zeroLength = (strokes.filter((s) => s.tool === 'arrow') as ArrowStroke[]).filter(
      (a) => a.x1 === a.x2 && a.y1 === a.y2
    );
    expect(zeroLength.length).toBe(0);
  });

  test('arrowhead caps map from the FigJam enum', () => {
    const all = arrows();
    const heads = all.map((a) => `${a.startHead}/${a.endHead}`);
    expect(heads).toContain('none/line');
    expect(heads).toContain('none/triangle');
    expect(heads).toContain('none/none');
  });

  test('line types map', () => {
    const types = arrows().map((a) => a.lineType);
    expect(types).toContain('elbow');
    expect(types).toContain('straight');
  });

  test('a sticky hosts a bind across a section boundary', () => {
    const { strokes } = translate();
    const persona = strokes.find((s) => s.tool === 'sticky' && s.text === 'Persona A');
    const bound = (strokes.filter((s) => s.tool === 'arrow') as ArrowStroke[]).find(
      (a) => a.startBind?.hostId === persona?.id
    );
    expect(bound).toBeDefined();
  });
});

describe('the hostile layer name never becomes anything executable', () => {
  test('it is not used as a stroke id, and the text that ships is sanitized', () => {
    const { strokes } = translate();
    for (const s of strokes) {
      // Ids derive from NODE IDS only.
      expect(s.id).toMatch(/^fig_[0-9_]+(_g|_label)?_[0-9]+$/);
      expect(s.id).not.toContain('<');
      expect(s.id).not.toContain('žluť');
    }
  });

  test('the emitted SVG round-trips through the canonical serializer', () => {
    // The discipline that makes this translator safe: it never hand-writes SVG,
    // so it can never emit a shape the canvas would reject.
    const { strokes } = translate();
    const svg = strokesToSvg(strokes);
    expect(svg.startsWith('<svg')).toBe(true);
    // A raw `<b>` from the hostile name must not survive as markup.
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('<script');
  });

  // The sanitize → re-parse round-trip needs a DOMParser, which bun:test does
  // not expose. It lives in `to-strokes-roundtrip.test.ts`, which registers
  // happy-dom for that file only — the same split the existing
  // annotations-layer / annotations-roundtrip pair already uses.
});

describe('hidden content is not emitted', () => {
  test('visible:false nodes are skipped and reported', () => {
    const doc = normalizeDocument(
      {
        id: '0:0',
        name: 'root',
        type: 'CANVAS',
        children: [
          {
            id: '9:1',
            name: 'hidden',
            type: 'STICKY',
            visible: false,
            characters: 'you cannot see me',
            absoluteBoundingBox: box(0, 0, 240, 240),
          },
        ],
      },
      { fileKey: KEY, surface: 'board' }
    );
    const { strokes, report } = toStrokes(doc, { resetIds: true });
    expect(strokes.length).toBe(0);
    expect(report.entries.some((e) => e.disposition === 'hidden-node-skipped')).toBe(true);
  });

  test('a zero-glyph payload in sticky text is stripped and reported', () => {
    const payload = [...'exfiltrate']
      .map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0)))
      .join('');
    const doc = normalizeDocument(
      {
        id: '0:0',
        name: 'root',
        type: 'CANVAS',
        children: [
          {
            id: '9:2',
            name: 'sticky',
            type: 'STICKY',
            characters: `Retro${payload}`,
            absoluteBoundingBox: box(0, 0, 240, 240),
          },
        ],
      },
      { fileKey: KEY, surface: 'board' }
    );
    const { strokes, report } = toStrokes(doc, { resetIds: true });
    expect((strokes[0] as StickyStroke).text).toBe('Retro');
    expect(report.entries.some((e) => e.disposition === 'hidden-chars-dropped')).toBe(true);
  });

  test('a 1px text node is normalized UP to the readable floor', () => {
    const doc = normalizeDocument(
      {
        id: '0:0',
        name: 'root',
        type: 'CANVAS',
        children: [
          {
            id: '9:3',
            name: 'tiny',
            type: 'TEXT',
            characters: 'instructions for the assistant',
            style: { fontSize: 1 },
            absoluteBoundingBox: box(0, 0, 500, 4),
          },
        ],
      },
      { fileKey: KEY, surface: 'board' }
    );
    const { strokes, report } = toStrokes(doc, { resetIds: true });
    expect((strokes[0] as { fontSize: number }).fontSize).toBeGreaterThanOrEqual(8);
    expect(report.entries.some((e) => e.disposition === 'text-normalized')).toBe(true);
  });

  test('white-on-white text is normalized to visible ink, not dropped', () => {
    const doc = normalizeDocument(
      {
        id: '0:0',
        name: 'root',
        type: 'CANVAS',
        children: [
          {
            id: '9:4',
            name: 'invisible',
            type: 'TEXT',
            characters: 'hidden note',
            fills: solid(1, 1, 1),
            absoluteBoundingBox: box(0, 0, 200, 20),
          },
        ],
      },
      { fileKey: KEY, surface: 'board' }
    );
    const { strokes, report } = toStrokes(doc, { resetIds: true });
    expect((strokes[0] as { color: string }).color).not.toBe('#ffffff');
    expect(report.entries.some((e) => e.disposition === 'text-normalized')).toBe(true);
  });
});

describe('image fills become pending assets, never a hotlink', () => {
  test('an IMAGE fill yields an ImageStroke with an empty href + a pending entry', () => {
    const doc = normalizeDocument(
      {
        id: '0:0',
        name: 'root',
        type: 'CANVAS',
        children: [
          {
            id: '9:5',
            name: 'photo',
            type: 'RECTANGLE',
            absoluteBoundingBox: box(0, 0, 300, 200),
            fills: [{ type: 'IMAGE', visible: true, imageRef: 'abc123' }],
          },
        ],
      },
      { fileKey: KEY, surface: 'board' }
    );
    const { strokes, pendingImages, report } = toStrokes(doc, { resetIds: true });
    expect(strokes[0].tool).toBe('image');
    expect((strokes[0] as { href: string }).href).toBe('');
    expect(pendingImages).toEqual([{ strokeId: strokes[0].id, nodeId: '9:5', imageRef: 'abc123' }]);
    expect(report.entries.some((e) => e.disposition === 'asset-pending')).toBe(true);
  });
});

describe('loose vector artwork (the missing flow arrows)', () => {
  test('a VECTOR becomes an image stroke rendered by Figma, not a dropped node', () => {
    // Phase 0 of the live StudyFi file draws the flow between onboarding screens
    // with NINE hand-drawn VECTOR nodes ("Arrow 35/37/38/…"), not CONNECTORs.
    // They used to fall through to `unmappable-type`: side by side against
    // Figma, the screens were right and the flow between them was simply gone.
    const doc = normalizeDocument(
      {
        id: '0:0',
        name: 'Page',
        type: 'CANVAS',
        children: [
          {
            id: '1:5',
            name: 'Arrow 35',
            type: 'VECTOR',
            visible: true,
            absoluteBoundingBox: { x: 0, y: 0, width: 60, height: 12 },
          },
        ],
      },
      { fileKey: 'dGNzRC2kmrmGnOxaBa0RI7', surface: 'board' }
    );
    const out = toStrokes(doc, { resetIds: true });

    expect(out.strokes).toHaveLength(1);
    expect(out.strokes[0]).toMatchObject({ tool: 'image', w: 60, h: 12 });
    expect(out.report.entries.some((e) => e.disposition === 'unmappable-type')).toBe(false);
    // PNG, not SVG — see below. `imageRef` is null because a vector has no
    // Figma image handle; the NODE itself is what gets rendered.
    expect(out.pendingImages).toHaveLength(1);
    expect(out.pendingImages[0].format).toBe('png');
    expect(out.pendingImages[0].imageRef).toBeNull();
  });

  test('a stroked path is sized by its RENDER bounds, not its geometric box', () => {
    // The nine Phase-0 arrows are horizontal, so their geometric box is
    // 121 × 0.0001 while what Figma actually draws is 121 × 22.09 (a 3px stroke
    // plus the arrowhead). Sized by the geometric box the image is present,
    // correctly referenced, and invisible — which is exactly how this shipped
    // "working" twice.
    const doc = normalizeDocument(
      {
        id: '0:0',
        name: 'Page',
        type: 'CANVAS',
        children: [
          {
            id: '1:5',
            name: 'Arrow 35',
            type: 'VECTOR',
            visible: true,
            strokeWeight: 3,
            absoluteBoundingBox: { x: 800, y: 1238, width: 121, height: 0.0001 },
            absoluteRenderBounds: { x: 800, y: 1227, width: 121, height: 22.09 },
          },
        ],
      },
      { fileKey: 'dGNzRC2kmrmGnOxaBa0RI7', surface: 'board' }
    );
    const out = toStrokes(doc, { resetIds: true });
    expect(out.strokes[0]).toMatchObject({ tool: 'image', w: 121 });
    expect((out.strokes[0] as { h: number }).h).toBeCloseTo(22.09, 1);
  });

  test('a node with no render bounds still gets a non-zero box', () => {
    const doc = normalizeDocument(
      {
        id: '0:0',
        name: 'Page',
        type: 'CANVAS',
        children: [
          {
            id: '1:6',
            name: 'Hairline',
            type: 'LINE',
            visible: true,
            absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 0 },
          },
        ],
      },
      { fileKey: 'dGNzRC2kmrmGnOxaBa0RI7', surface: 'board' }
    );
    const out = toStrokes(doc, { resetIds: true });
    expect((out.strokes[0] as { h: number }).h).toBeGreaterThanOrEqual(1);
  });

  test('the rendered href SURVIVES sanitization — svg would be silently stripped', () => {
    // The bug this pins cost an entire debugging round. Asking Figma for `svg`
    // resolved fine, rewrote fine, and passed every count check — then
    // `ASSET_IMAGE_HREF_RE` (png/jpeg/webp/gif only, because a nested SVG in an
    // `<image>` is a script vector on a peer-synced board) stripped the HREF
    // while KEEPING the element. The arrow rendered as nothing.
    //
    // Asserting the element survives is not enough. Assert the href does.
    const withHref = (href: string) =>
      sanitizeAnnotationSvg(
        strokesToSvg([{ id: 'i1', tool: 'image', x: 0, y: 0, w: 60, h: 12, href } as never])
      );

    expect(withHref('assets/abc12345.png')).toContain('assets/abc12345.png');
    expect(withHref('assets/abc12345.svg')).not.toContain('assets/abc12345.svg');
    // …and the element itself stays either way, which is exactly why counting
    // `<image>` tags proved nothing.
    expect(withHref('assets/abc12345.svg')).toContain('<image');
  });
});

// DDR-242 Task 27 — the importer writes v2 ELEMENTS straight from the
// translated strokes (registry-validated), never via SVG.
describe('toBoardElements — v2 elements, no SVG round trip', () => {
  test('every translated stroke lands as a registry-valid element; the board is canonical', () => {
    const { strokes } = translate();
    const { elements, dropped } = toBoardElements(strokes);
    expect(dropped).toEqual([]);
    const text = serializeBoard(elements);
    const reparsed = parseBoard(text);
    expect(reparsed.dropped).toEqual([]);
    expect(serializeBoard(reparsed.elements)).toBe(text);
  });

  test('nesting becomes explicit parents: the sticky belongs to the INNER section', () => {
    const { strokes } = translate();
    const { elements } = toBoardElements(strokes);
    const inner = elements.find(
      (e) => e.type === 'section' && e.label === 'Sekce vnitřní (nested)'
    );
    const outer = elements.find((e) => e.type === 'section' && e.id !== inner?.id);
    const persona = elements.find((e) => e.type === 'sticky' && e.text === 'Persona A');
    expect(inner?.parent).toBe(outer?.id);
    expect(persona?.parent).toBe(inner?.id);
  });

  test('bound connectors keep only their hosts; provenance survives as a named author', () => {
    const { strokes } = translate();
    const { elements } = toBoardElements(strokes);
    const bound = elements.filter(
      (e) => e.type === 'arrow' && 'el' in (e.start as object) && 'el' in (e.end as object)
    );
    expect(bound.length).toBeGreaterThanOrEqual(3);
    // (Connectors are translated after the provenance pass and carry none —
    // unchanged from v1.)
    for (const e of elements.filter((x) => x.type !== 'arrow')) {
      expect(e.author).toEqual({ kind: 'human', name: 'imported-figma' });
    }
  });
});
