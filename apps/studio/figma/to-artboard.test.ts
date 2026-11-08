// figma/to-artboard.ts + style-map.ts — the frame → canvas path.
//
// Asserted against the purpose-built design fixture `dGNzRC2kmrmGnOxaBa0RI7`
// (`.ai/plans/notes/figma-import-fixtures.md`). The three cases the whole phase
// hinges on are pinned to their real node ids: the auto-layout frames (1:2 /
// 1:9), the absolute fallback (1:15), the THREE nested styleless wrappers
// (2:8 → 2:7 → 2:6) and the FOUR vector leaves forming one mark (2:2…2:5).

import { describe, expect, test } from 'bun:test';
import { ImportReport } from './sanitize.ts';
import {
  isValidColorValue,
  isValidDimension,
  mapAutoLayout,
  mapNodeStyle,
  mapTypeStyle,
  perceptualDistance,
  resolveColor,
} from './style-map.ts';
import {
  flattenWrappers,
  isStylelessWrapper,
  isVectorCluster,
  MAX_WRAPPER_DEPTH,
  toArtboard,
  toCanvas,
} from './to-artboard.ts';
import { normalizeDocument } from './types.ts';

const KEY = 'dGNzRC2kmrmGnOxaBa0RI7';
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const solid = (r: number, g: number, b: number) => [
  { type: 'SOLID', visible: true, color: { r, g, b, a: 1 } },
];

const TOKENS = [
  { name: '--accent', hex: '#5b4bd6' },
  { name: '--bg-0', hex: '#ffffff' },
  { name: '--fg-0', hex: '#1a1a1a' },
];

function frameDoc(frame: unknown) {
  const doc = normalizeDocument(
    { id: '0:0', name: 'Page', type: 'CANVAS', children: [frame] },
    { fileKey: KEY, surface: 'design' }
  );
  return { doc, frame: doc.root.children?.[0] };
}

function build(frame: unknown, opts = {}) {
  const { doc, frame: node } = frameDoc(frame);
  return toArtboard(doc, node!, { tokens: TOKENS, ...opts });
}

// ── The flatten case ────────────────────────────────────────────────────────

describe('flatten styleless GROUP wrappers (mandatory, DDR-216 D8)', () => {
  const bare = (id: string, children?: unknown[]) => ({
    id,
    name: `Group ${id}`,
    type: 'GROUP',
    absoluteBoundingBox: box(0, 0, 100, 100),
    ...(children ? { children } : {}),
  });

  test('a bare GROUP is a styleless wrapper', () => {
    const { frame } = frameDoc(bare('2:8', [bare('2:7')]));
    expect(isStylelessWrapper(frame!)).toBe(true);
  });

  test.each([
    ['a fill', { fills: solid(1, 0, 0) }],
    ['a stroke', { strokes: solid(0, 0, 0) }],
    ['an effect', { effects: [{ type: 'DROP_SHADOW', visible: true, radius: 4 }] }],
    ['a corner radius', { cornerRadius: 8 }],
    ['clipping', { clipsContent: true }],
    ['rotation', { rotation: 15 }],
    ['partial opacity', { opacity: 0.5 }],
    ['auto-layout', { layoutMode: 'HORIZONTAL' }],
  ])('a GROUP carrying %s is NOT styleless — it stays', (_label, extra) => {
    const { frame } = frameDoc({ ...bare('2:8'), ...(extra as object) });
    expect(isStylelessWrapper(frame!)).toBe(false);
  });

  test('THREE nested wrappers collapse to their content (the real logo case)', () => {
    // Reproduces `2:8 → 2:7 → 2:6`, which reproduces the real data.Brno logo
    // sitting under seven such wrappers.
    const leaf = {
      id: '2:6',
      name: 'Mark',
      type: 'RECTANGLE',
      absoluteBoundingBox: box(0, 0, 90, 72),
      fills: solid(0.3, 0.3, 0.8),
    };
    const { doc } = frameDoc(bare('2:8', [bare('2:7', [leaf])]));
    const report = new ImportReport();
    const flat = flattenWrappers(doc.root.children ?? [], report);
    // The three wrappers are gone; the leaf is hoisted all the way up.
    expect(flat.length).toBe(1);
    expect(flat[0].id).toBe('2:6');
    expect(report.entries.filter((e) => e.detail === 'styleless wrapper flattened').length).toBe(2);
  });

  test('a HIDDEN styleless wrapper is skipped whole, not hoisted (#155 §2)', () => {
    // A hidden "glass card" group used to resurface: flattening hoisted its
    // (visible) children into the parent and they rendered as opaque boxes.
    const kid = {
      id: '2:6',
      name: 'Card',
      type: 'RECTANGLE',
      absoluteBoundingBox: box(0, 0, 90, 72),
      fills: solid(1, 1, 1),
    };
    const { doc } = frameDoc({ ...bare('2:8', [kid]), visible: false });
    const report = new ImportReport();
    const flat = flattenWrappers(doc.root.children ?? [], report);
    expect(flat).toEqual([]);
    expect(
      report.entries.some((e) => e.nodeId === '2:8' && e.disposition === 'hidden-node-skipped')
    ).toBe(true);
  });

  test('a hidden wrapper nested inside a visible one drops only its own subtree', () => {
    const rect = (id: string) => ({
      id,
      name: id,
      type: 'RECTANGLE',
      absoluteBoundingBox: box(0, 0, 10, 10),
      fills: solid(1, 0, 0),
    });
    const { doc } = frameDoc(
      bare('2:1', [{ ...bare('2:2', [rect('2:3')]), visible: false }, rect('2:4')])
    );
    const flat = flattenWrappers(doc.root.children ?? [], new ImportReport());
    expect(flat.map((n) => n.id)).toEqual(['2:4']);
  });

  test('flattening is depth-agnostic (the shallower 2:11 → 2:10 → 2:9 case)', () => {
    const leaf = {
      id: '2:9',
      name: 'r',
      type: 'RECTANGLE',
      absoluteBoundingBox: box(0, 0, 10, 10),
    };
    const { doc } = frameDoc(bare('2:11', [bare('2:10', [leaf])]));
    const flat = flattenWrappers(doc.root.children ?? [], new ImportReport());
    expect(flat[0].id).toBe('2:9');
  });

  test('the emitted JSX has no wrapper chain left', () => {
    const leaf = {
      id: '2:6',
      name: 'Mark',
      type: 'RECTANGLE',
      absoluteBoundingBox: box(0, 0, 90, 72),
    };
    const result = build({
      id: '1:1',
      name: 'Frame',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [bare('2:8', [bare('2:7', [leaf])])],
    });
    expect(result.metrics.maxDepth).toBeLessThanOrEqual(MAX_WRAPPER_DEPTH);
    // Exactly one element for the leaf — not three nested divs.
    expect((result.tsx.match(/data-dc-element/g) ?? []).length).toBe(1);
  });
});

// ── The collapse case ───────────────────────────────────────────────────────

describe('collapse a vector cluster to ONE export (mandatory, DDR-216 D8)', () => {
  const vec = (id: string) => ({
    id,
    name: `vec ${id}`,
    type: 'VECTOR',
    absoluteBoundingBox: box(0, 0, 20, 20),
  });

  test('a group of only vectors IS a cluster', () => {
    const { frame } = frameDoc({
      id: '2:1',
      name: 'Mark wrapper',
      type: 'GROUP',
      absoluteBoundingBox: box(0, 0, 90, 72),
      children: [vec('2:2'), vec('2:3'), vec('2:4'), vec('2:5')],
    });
    expect(isVectorCluster(frame!)).toBe(true);
  });

  test('a group with a non-vector child is NOT a cluster', () => {
    const { frame } = frameDoc({
      id: '2:1',
      name: 'mixed',
      type: 'GROUP',
      absoluteBoundingBox: box(0, 0, 90, 72),
      children: [vec('2:2'), { id: '2:3', name: 't', type: 'TEXT', characters: 'hi' }],
    });
    expect(isVectorCluster(frame!)).toBe(false);
  });

  test('FOUR vector leaves become ONE asset, not four', () => {
    // The whole point: Figma's own translator exploded one logo into ~14 `<img>`
    // exports. One object is the editability fix AND the IMAGE_COST fix.
    const result = build({
      id: '1:1',
      name: 'Frame',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        {
          id: '2:1',
          name: 'Mark wrapper',
          type: 'GROUP',
          absoluteBoundingBox: box(0, 0, 90, 72),
          children: [vec('2:2'), vec('2:3'), vec('2:4'), vec('2:5')],
        },
      ],
    });
    expect(result.pendingExports.length).toBe(1);
    expect(result.pendingExports[0]).toMatchObject({
      nodeId: '2:1',
      format: 'svg',
      collapsed: true,
    });
    expect((result.tsx.match(/<img /g) ?? []).length).toBe(1);
  });

  test('flatten must NOT dissolve a cluster wrapper — collapse wins', () => {
    // Regression: the two mandatory mitigations interact. A logo's wrapper IS
    // styleless (that is the complaint about it) but it is ALSO the collapse
    // anchor. Flattening first left four bare leaves and produced four exports
    // — exactly the fourteen-`<img>` outcome the collapse exists to prevent.
    const cluster = {
      id: '2:1',
      name: 'Mark wrapper',
      type: 'GROUP',
      absoluteBoundingBox: box(0, 0, 90, 72),
      children: [vec('2:2'), vec('2:3'), vec('2:4'), vec('2:5')],
    };
    const { doc } = frameDoc(cluster);
    const flat = flattenWrappers(doc.root.children ?? [], new ImportReport());
    expect(flat.length).toBe(1);
    expect(flat[0].id).toBe('2:1');
    expect(flat[0].children?.length).toBe(4);
  });

  test('the collapsed export references a local placeholder, never a figma URL', () => {
    const result = build({
      id: '1:1',
      name: 'F',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 200, 200),
      children: [vec('2:2')],
    });
    expect(result.tsx).toContain('/assets/pending-');
    expect(result.tsx).not.toContain('figma.com');
    expect(result.tsx).not.toContain('http');
  });
});

// ── Layout model ────────────────────────────────────────────────────────────

describe('auto-layout → flex; everything else → absolute', () => {
  test('horizontal auto-layout maps to a flex row with gap + padding (fixture 1:2)', () => {
    const { frame } = frameDoc({
      id: '1:2',
      name: 'AL Horizontal (-> flex row)',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      paddingTop: 20,
      paddingRight: 24,
      paddingBottom: 20,
      paddingLeft: 24,
      absoluteBoundingBox: box(0, 0, 400, 100),
    });
    expect(mapAutoLayout(frame!)).toMatchObject({
      display: 'flex',
      flexDirection: 'row',
      gap: '16px',
      padding: '20px 24px 20px 24px',
    });
  });

  test('vertical auto-layout maps cross-axis alignment (fixture 1:9)', () => {
    const { frame } = frameDoc({
      id: '1:9',
      name: 'AL Vertical (-> flex column)',
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      counterAxisAlignItems: 'CENTER',
      absoluteBoundingBox: box(0, 0, 200, 400),
    });
    expect(mapAutoLayout(frame!)).toMatchObject({
      flexDirection: 'column',
      alignItems: 'center',
    });
  });

  test('a child INSIDE auto-layout flows — no absolute, so the handles work', () => {
    const result = build({
      id: '1:2',
      name: 'AL',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      absoluteBoundingBox: box(0, 0, 400, 100),
      children: [
        { id: '1:3', name: 'Chip One', type: 'RECTANGLE', absoluteBoundingBox: box(0, 0, 80, 40) },
        { id: '1:4', name: 'Chip Two', type: 'RECTANGLE', absoluteBoundingBox: box(96, 0, 80, 40) },
      ],
    });
    expect(result.tsx).not.toContain('position');
    expect(result.metrics.absoluteLeaves).toBe(0);
  });

  test('children WITHOUT auto-layout fall back to absolute offsets (fixture 1:15)', () => {
    const result = build({
      id: '1:15',
      name: 'Absolutely positioned children (-> fallback)',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        {
          id: '1:16',
          name: 'Abs box 1',
          type: 'RECTANGLE',
          absoluteBoundingBox: box(20, 30, 80, 40),
        },
        {
          id: '1:17',
          name: 'Abs box 2',
          type: 'RECTANGLE',
          absoluteBoundingBox: box(140, 90, 80, 40),
        },
      ],
    });
    expect(result.tsx).toContain('position: "absolute"');
    expect(result.tsx).toContain('left: "20px"');
    expect(result.metrics.absoluteLeaves).toBe(2);
  });

  test('offsets are relative to the FRAME, not to the Figma canvas origin', () => {
    // A real page sits far from (0,0); an un-shifted offset would push
    // everything off the artboard.
    const result = build({
      id: '1:15',
      name: 'F',
      type: 'FRAME',
      absoluteBoundingBox: box(5000, 9000, 400, 300),
      children: [
        { id: '1:16', name: 'b', type: 'RECTANGLE', absoluteBoundingBox: box(5020, 9030, 80, 40) },
      ],
    });
    expect(result.tsx).toContain('left: "20px"');
    expect(result.tsx).toContain('top: "30px"');
  });
});

// ── Sanitization of the generated JSX ───────────────────────────────────────

describe('the generated JSX is executed — nothing hostile survives', () => {
  const HOSTILE = 'Karta — "uvozovky" / <script> & {curly} → šipka';

  function hostileFrame() {
    return build({
      id: '2:23',
      name: HOSTILE,
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        {
          id: '2:20',
          name: HOSTILE,
          type: 'TEXT',
          characters: '</p><script>alert(1)</script>{evil}',
          style: { fontSize: 32, fontWeight: 700, lineHeightPx: 40 },
          absoluteBoundingBox: box(0, 0, 300, 40),
        },
      ],
    });
  }

  test('no raw script or brace from the name/text reaches the source', () => {
    const { tsx } = hostileFrame();
    expect(tsx).not.toContain('<script>');
    expect(tsx).not.toContain('{evil}');
    expect(tsx).not.toContain('{curly}');
  });

  test('text is emitted as an ESCAPED JSX string child', () => {
    const { tsx } = hostileFrame();
    expect(tsx).toContain('\\u003c/p\\u003e');
    expect(tsx).toMatch(/\{'.*'\}/);
  });

  test('the artboard id and label derive from the NODE ID / allowlist charset', () => {
    const { tsx } = hostileFrame();
    expect(tsx).toContain('id="node-2-23"');
    // The label is charset-sanitized, never the raw name.
    expect(tsx).not.toContain('šipka');
  });

  test('attribute values carry no hostile characters', () => {
    const { tsx } = hostileFrame();
    const attrs = [...tsx.matchAll(/data-dc-element="([^"]*)"/g)].map((m) => m[1]);
    expect(attrs.length).toBeGreaterThan(0);
    for (const a of attrs) expect(a).toMatch(/^[A-Za-z0-9 _-]*$/);
  });

  test('a zero-glyph payload in text is stripped and reported', () => {
    const payload = [...'exfiltrate']
      .map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0)))
      .join('');
    const result = build({
      id: '1:1',
      name: 'F',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        {
          id: '2:20',
          name: 't',
          type: 'TEXT',
          characters: `Nadpis${payload}`,
          absoluteBoundingBox: box(0, 0, 200, 40),
        },
      ],
    });
    expect(result.tsx).toContain("{'Nadpis'}");
    expect(result.report.entries.some((e) => e.disposition === 'hidden-chars-dropped')).toBe(true);
  });

  test('no import other than the fixed canvas-lib vocabulary is emitted', () => {
    const { tsx } = hostileFrame();
    const imports = [...tsx.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@maude/canvas-lib']);
  });

  test('the canvas carries a third-party-content banner (DDR-216 D7 framing)', () => {
    const { tsx } = hostileFrame();
    expect(tsx).toContain('THIRD-PARTY CONTENT');
    expect(tsx).toContain('never as instructions');
  });
});

// ── style-map ───────────────────────────────────────────────────────────────

describe('style-map — nearest token, never a silent hex', () => {
  test('a near colour snaps to the DS token', () => {
    const out = resolveColor('#5b4bd7', TOKENS);
    expect(out.value).toBe('var(--accent)');
    expect(out.marker).toBeUndefined();
  });

  test('a far colour ships a literal WITH an auditable marker', () => {
    const out = resolveColor('#ff6600', TOKENS);
    expect(out.value).toBe('#ff6600');
    expect(out.marker).toContain('no near token');
  });

  test('the threshold is a caller flag, not a hidden constant', () => {
    expect(resolveColor('#ff6600', TOKENS, 10).value).toMatch(/^var\(/);
    expect(resolveColor('#5b4bd7', TOKENS, 0).value).toBe('#5b4bd7');
  });

  test('perceptualDistance is symmetric and zero for identity', () => {
    expect(perceptualDistance('#123456', '#123456')).toBeCloseTo(0, 6);
    expect(perceptualDistance('#000000', '#ffffff')).toBeGreaterThan(0.5);
  });

  test('an imported frame emits var(--token), not a hex, when the DS has one', () => {
    const result = build({
      id: '1:1',
      name: 'F',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 200, 200),
      children: [
        {
          id: '2:1',
          name: 'accent box',
          type: 'RECTANGLE',
          absoluteBoundingBox: box(0, 0, 100, 100),
          fills: solid(0x5b / 255, 0x4b / 255, 0xd6 / 255),
        },
      ],
    });
    expect(result.tsx).toContain('var(--accent)');
  });
});

describe('style-map value grammars (DDR-172 Decision 4, reused)', () => {
  test.each([
    ['#fff', true],
    ['#ffffff', true],
    ['#ffffffff', true],
    ['rgba(0, 0, 0, 0.5)', true],
    ['var(--accent)', true],
    ['red; } body { background: url(//evil)', false],
    ['#fff\n};@import url(//evil)', false],
    ['expression(alert(1))', false],
    ['url(//evil)', false],
    ['var(--x); background: url(//evil)', false],
  ])('colour %p → %p', (value, ok) => {
    expect(isValidColorValue(value as string)).toBe(ok as boolean);
  });

  test.each([
    ['0', true],
    ['16px', true],
    ['1.5rem', true],
    ['-4px', true],
    ['99999999px', false],
    ['16px; color: red', false],
    ['16', false],
  ])('dimension %p → %p', (value, ok) => {
    expect(isValidDimension(value as string)).toBe(ok as boolean);
  });

  test('a pathological magnitude is rejected, not rendered', () => {
    const { frame } = frameDoc({
      id: '2:1',
      name: 'huge',
      type: 'RECTANGLE',
      absoluteBoundingBox: box(0, 0, 10, 10),
      cornerRadius: 9_999_999,
    });
    const out = mapNodeStyle(frame!, { tokens: TOKENS });
    expect(out.declarations.borderRadius).toBeUndefined();
    expect(out.rejected).toContain('borderRadius');
  });

  test('a font family is never written verbatim — it maps onto a fixed stack (#155 §3, D8)', () => {
    const out = mapTypeStyle({ fontFamily: 'Evil"); }', fontSize: 16 }, { tokens: TOKENS });
    expect(out.declarations.fontFamily).not.toContain('Evil');
    expect(out.declarations.fontFamily).not.toContain(';');
    expect(out.declarations.fontSize).toBe('16px');
  });

  test('a gradient becomes CSS built only from validated colours', () => {
    const { frame } = frameDoc({
      id: '2:18',
      name: 'gradient',
      type: 'RECTANGLE',
      absoluteBoundingBox: box(0, 0, 100, 100),
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          visible: true,
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
          gradientHandlePositions: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ],
    });
    const out = mapNodeStyle(frame!, { tokens: TOKENS });
    // camelCase — these keys go into a JSX style OBJECT, where `background-image`
    // is a syntax error that takes the whole canvas down with it.
    expect(out.declarations['background-image']).toBeUndefined();
    expect(out.declarations.backgroundImage).toMatch(
      /^linear-gradient\(\d+deg, #ff0000 0%, #0000ff 100%\)$/
    );
  });

  test('every emitted style key is a legal JS identifier (the canvas-killer guard)', () => {
    // The regression this locks: ONE hyphenated key anywhere on a page made the
    // generated .tsx unparseable, so the canvas rendered nothing at all.
    const { frame } = frameDoc({
      id: '2:20',
      name: 'gradient-key-shape',
      type: 'RECTANGLE',
      absoluteBoundingBox: box(0, 0, 100, 100),
      cornerRadius: 8,
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          visible: true,
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
          gradientHandlePositions: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ],
    });
    const out = mapNodeStyle(frame!, { tokens: TOKENS });
    for (const key of Object.keys(out.declarations)) {
      expect(key).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    }
  });

  test('a drop shadow becomes a strict-numeric box-shadow (fixture 2:19)', () => {
    const { frame } = frameDoc({
      id: '2:19',
      name: 'shadowed',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          offset: { x: 0, y: 4 },
          radius: 16,
          color: { r: 0, g: 0, b: 0, a: 0.25 },
        },
      ],
    });
    const out = mapNodeStyle(frame!, { tokens: TOKENS });
    // The 25 % alpha is carried (#155 §4): a dim shadow is not a black one.
    expect(out.declarations.boxShadow).toBe('0px 4px 16px 0px rgba(0, 0, 0, 0.25)');
  });

  test('a hiding opacity is dropped rather than reproduced (D6b)', () => {
    const { frame } = frameDoc({
      id: '2:1',
      name: 'ghost',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
      opacity: 0.02,
    });
    const out = mapNodeStyle(frame!, { tokens: TOKENS });
    expect(out.declarations.opacity).toBeUndefined();
    expect(out.rejected).toContain('opacity');
  });

  test('a legitimate partial opacity IS carried', () => {
    const { frame } = frameDoc({
      id: '2:1',
      name: 'faded',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
      opacity: 0.6,
    });
    expect(mapNodeStyle(frame!, { tokens: TOKENS }).declarations.opacity).toBe('0.6');
  });
});

// ── Provenance + meta ───────────────────────────────────────────────────────

describe('meta.json carries identifiers only (DDR-216 D7)', () => {
  test('kind + source, positions only, and NO Figma name anywhere', () => {
    const result = build({
      id: '2:23',
      name: 'Karta — "uvozovky" / <script>',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 400, 300),
    });
    expect(result.meta.kind).toBe('imported-figma');
    expect(result.meta.source).toMatchObject({ fileKey: KEY, nodeId: '2:23' });
    const serialized = JSON.stringify(result.meta);
    expect(serialized).not.toContain('Karta');
    expect(serialized).not.toContain('script');
    // Size is JSX-authoritative (DDR-027) — meta carries positions only.
    const artboards = (result.meta.layout as { artboards: Array<Record<string, unknown>> })
      .artboards;
    expect(artboards[0]).toEqual({ id: 'node-2-23', x: 0, y: 0 });
    expect(artboards[0].w).toBeUndefined();
  });

  test('the artboard size comes from the JSX props', () => {
    const result = build({
      id: '1:1',
      name: 'F',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 1440, 4677),
    });
    expect(result.tsx).toContain('width={1440}');
    expect(result.tsx).toContain('height={4677}');
  });
});

describe('D8 gates are measurable', () => {
  test('metrics report depth, absolute share and byte size', () => {
    const result = build({
      id: '1:1',
      name: 'F',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        { id: '1:2', name: 'a', type: 'RECTANGLE', absoluteBoundingBox: box(0, 0, 10, 10) },
        { id: '1:3', name: 'b', type: 'RECTANGLE', absoluteBoundingBox: box(20, 0, 10, 10) },
      ],
    });
    expect(result.metrics.totalLeaves).toBe(2);
    expect(result.metrics.absoluteLeaves).toBe(2);
    expect(result.metrics.bytes).toBe(result.tsx.length);
    expect(result.metrics.maxDepth).toBe(0);
  });

  test('a hidden node is not emitted and is reported', () => {
    const result = build({
      id: '1:1',
      name: 'F',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 400, 300),
      children: [
        {
          id: '9:1',
          name: 'hidden',
          type: 'TEXT',
          visible: false,
          characters: 'invisible instructions',
          absoluteBoundingBox: box(0, 0, 100, 20),
        },
      ],
    });
    expect(result.tsx).not.toContain('invisible instructions');
    expect(result.report.entries.some((e) => e.disposition === 'hidden-node-skipped')).toBe(true);
  });
});

describe('the frame fill becomes the ARTBOARD background (real-data regression)', () => {
  test('a white Figma frame does not import as a black artboard', () => {
    // Shipped broken: the fill was computed for the contrast reference and then
    // thrown away, so every artboard used the canvas default — dark in a
    // dark-themed project — and text contrast-checked against the frame's real
    // white ground came out dark-on-dark.
    const result = build({
      id: '417:10793',
      name: 'Onboarding-Step-1',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 375, 812),
      fills: solid(1, 1, 1),
    });
    expect(result.tsx).toContain('background="#ffffff"');
  });

  test('a frame with no fill emits no background prop (canvas default wins)', () => {
    const result = build({
      id: '1:1',
      name: 'F',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
    });
    expect(result.tsx).not.toContain('background=');
  });

  test('text on a white frame stays dark — contrast resolves against the real ground', () => {
    const result = build({
      id: '1:1',
      name: 'F',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 400, 300),
      fills: solid(1, 1, 1),
      children: [
        {
          id: '2:1',
          name: 't',
          type: 'TEXT',
          characters: 'Welcome to StudyFi',
          fills: solid(0, 0, 0),
          absoluteBoundingBox: box(0, 0, 200, 24),
        },
      ],
    });
    expect(result.tsx).toContain('background="#ffffff"');
    expect(result.tsx).toContain('color: "#000000"');
  });
});

describe('toCanvas surfaces LOOSE page content instead of dropping it', () => {
  const frame = (id: string) => ({
    id,
    name: `Frame ${id}`,
    type: 'FRAME',
    absoluteBoundingBox: box(0, 0, 375, 812),
  });
  const note = (id: string, type = 'TEXT') => ({
    id,
    name: 'note',
    type,
    characters: 'Předvolby',
    absoluteBoundingBox: box(900, 100, 200, 40),
  });

  function page(children: unknown[]) {
    const doc = normalizeDocument(
      { id: '0:1', name: 'Page', type: 'CANVAS', children },
      { fileKey: KEY, surface: 'design' }
    );
    return { doc, page: doc.root };
  }

  test('a page with BOTH frames and loose content keeps both', () => {
    // The bug: `loose` was computed and then used only in the no-frames branch,
    // so on the live file 55 top-level nodes across 4 pages vanished with no
    // disposition entry at all.
    const { doc, page: p } = page([frame('1:1'), note('2:1'), note('2:2', 'RECTANGLE')]);
    const out = toCanvas(doc, p);
    expect(out.artboardCount).toBe(1);
    expect(out.annotations.map((n) => n.id).sort()).toEqual(['2:1', '2:2']);
  });

  test('a page of ONLY loose content still wraps it in one artboard', () => {
    const { doc, page: p } = page([note('2:1'), note('2:2')]);
    const out = toCanvas(doc, p);
    expect(out.artboardCount).toBe(1);
    expect(out.annotations).toEqual([]);
  });

  test('a page of only frames has no annotation layer', () => {
    const { doc, page: p } = page([frame('1:1'), frame('1:2')]);
    const out = toCanvas(doc, p);
    expect(out.artboardCount).toBe(2);
    expect(out.annotations).toEqual([]);
  });

  test('the page origin comes back so the layer lines up with the artboards', () => {
    const { doc, page: p } = page([
      { ...frame('1:1'), absoluteBoundingBox: box(-2585, 2094, 375, 812) },
      note('2:1'),
    ]);
    const out = toCanvas(doc, p);
    expect(out.origin).toEqual({ x: -2585, y: 100 });
  });

  test('flow-diagram nodes on a design page reach the annotation layer', () => {
    // CONNECTOR / SHAPE_WITH_TEXT are FigJam vocabulary that a design page can
    // legitimately carry. The frame translator has no mapping for them; the
    // whiteboard translator does.
    const { doc, page: p } = page([
      frame('1:1'),
      { id: '3:1', name: 'c', type: 'CONNECTOR', absoluteBoundingBox: box(400, 0, 100, 10) },
      {
        id: '3:2',
        name: 's',
        type: 'SHAPE_WITH_TEXT',
        shapeType: 'SQUARE',
        absoluteBoundingBox: box(600, 0, 100, 100),
      },
    ]);
    const out = toCanvas(doc, p);
    expect(out.annotations.map((n) => n.type).sort()).toEqual(['CONNECTOR', 'SHAPE_WITH_TEXT']);
  });
});
