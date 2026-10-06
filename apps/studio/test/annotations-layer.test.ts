// annotations-layer — Phase 5 pure helpers (no DOM render).
//
// Covers: SVG round-trip (strokesToSvg + svgToStrokes), pen path serialization,
// arrow-head geometry, eraser hit-test across all three shapes.
//
// `svgToStrokes` reads via DOMParser; bun:test exposes one through happy-dom
// when imported transitively. We dodge that here by parsing the regex-friendly
// shapes directly and only exercising the parser in the integration test.

import { describe, expect, test } from 'bun:test';

import {
  type ArrowStroke,
  arrowHeadPoints,
  type EllipseStroke,
  type ImageStroke,
  type LinkStroke,
  type PenStroke,
  type PolygonStroke,
  penPathD,
  polygonPoints,
  polygonVertices,
  type RectStroke,
  resolveImageUploadSwap,
  rid,
  STICKY_PALETTE,
  type StickyStroke,
  type Stroke,
  strokeBBox,
  strokeHitTest,
  strokesShallowEqual,
  strokesToSvg,
  type TextStroke,
} from '../annotations-layer.tsx';
import { grownStickyBox, STICKY_MAX_GROWN_H } from '../annotations-model.ts';

describe('annotations-layer / penPathD', () => {
  test('empty points → empty string', () => {
    expect(penPathD([])).toBe('');
  });

  test('single point → M only', () => {
    expect(penPathD([[10, 20]])).toBe('M10 20');
  });

  test('multiple points → M then L per next', () => {
    expect(
      penPathD([
        [0, 0],
        [10, 10],
        [20, 5],
      ])
    ).toBe('M0 0 L10 10 L20 5');
  });
});

describe('annotations-layer / arrowHeadPoints', () => {
  test('horizontal arrow head is symmetric around the tip', () => {
    const pts = arrowHeadPoints(0, 0, 100, 0, 2);
    // "ax,ay x2,y2 bx,by" — y of the two wings symmetric across y=0
    const tokens = pts.split(' ');
    expect(tokens).toHaveLength(3);
    const [a, tip, b] = tokens.map((t) => t.split(',').map(Number));
    expect(tip).toEqual([100, 0]);
    expect(a?.[1]).toBeCloseTo(-(b?.[1] ?? 0), 4);
    // The wings sit BEFORE the tip on x.
    expect(a?.[0]).toBeLessThan(100);
    expect(b?.[0]).toBeLessThan(100);
  });

  test('zero-length arrow degenerates safely (no NaN)', () => {
    const pts = arrowHeadPoints(50, 50, 50, 50, 2);
    for (const t of pts.split(/[ ,]/)) {
      expect(Number.isFinite(Number(t))).toBe(true);
    }
  });
});

describe('annotations-layer / strokesToSvg', () => {
  test('empty list → self-closing svg shell', () => {
    expect(strokesToSvg([])).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1"></svg>'
    );
  });

  test('pen stroke → <path data-tool="pen" d=...>', () => {
    const pen: PenStroke = {
      id: 'p1',
      tool: 'pen',
      color: '#d63b1f',
      width: 2,
      points: [
        [0, 0],
        [10, 10],
      ],
    };
    const svg = strokesToSvg([pen]);
    expect(svg).toContain('data-id="p1"');
    expect(svg).toContain('data-tool="pen"');
    expect(svg).toContain('d="M0 0 L10 10"');
    expect(svg).toContain('stroke="#d63b1f"');
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
  });

  test('rect with negative w/h is clamped to 0 in serialization', () => {
    const rect: RectStroke = {
      id: 'r1',
      tool: 'rect',
      color: '#1d6cf0',
      width: 2,
      x: 10,
      y: 10,
      w: -5,
      h: -8,
    };
    const svg = strokesToSvg([rect]);
    expect(svg).toContain('width="0"');
    expect(svg).toContain('height="0"');
  });

  test('arrow renders as <g> with <line> + <polyline> head', () => {
    const arrow: ArrowStroke = {
      id: 'a1',
      tool: 'arrow',
      color: '#1a8f3e',
      width: 2,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 0,
    };
    const svg = strokesToSvg([arrow]);
    expect(svg).toContain('data-tool="arrow"');
    expect(svg).toContain('<line x1="0" y1="0" x2="100" y2="0"');
    expect(svg).toContain('<polyline points=');
  });

  test('color value is HTML-escaped on output (no tag injection)', () => {
    const pen: PenStroke = {
      id: 'p2',
      tool: 'pen',
      color: '"><script>',
      width: 2,
      points: [
        [0, 0],
        [1, 1],
      ],
    };
    const svg = strokesToSvg([pen]);
    // The `<` of <script> and the `"` that would close the attribute are
    // both escaped — those are the two chars that could break out of the
    // stroke="..." attribute. `>` is harmless inside an attribute value, so
    // we don't waste bytes encoding it.
    expect(svg).toContain('stroke="&quot;>&lt;script>"');
    // Belt-and-suspenders: no live <script tag survives anywhere in output.
    expect(svg).not.toMatch(/<script[\s>]/);
  });
});

describe('annotations-layer / strokeHitTest', () => {
  const pen: PenStroke = {
    id: 'p',
    tool: 'pen',
    color: '#000',
    width: 2,
    points: [
      [0, 0],
      [100, 0],
      [100, 100],
    ],
  };

  test('pen hit near the first segment', () => {
    expect(strokeHitTest(pen, 50, 2, 4)).toBe(true);
  });

  test('pen miss far from any segment', () => {
    expect(strokeHitTest(pen, 50, 50, 4)).toBe(false);
  });

  test('pen hit near the corner (transition between segments)', () => {
    expect(strokeHitTest(pen, 101, 50, 4)).toBe(true);
  });

  test('single-point pen stroke is hit-testable as a disk', () => {
    const dot: PenStroke = {
      id: 'd',
      tool: 'pen',
      color: '#000',
      width: 2,
      points: [[10, 10]],
    };
    expect(strokeHitTest(dot, 11, 11, 4)).toBe(true);
    expect(strokeHitTest(dot, 50, 50, 4)).toBe(false);
  });

  test('rect: hit on edge, miss in interior', () => {
    const r: RectStroke = {
      id: 'r',
      tool: 'rect',
      color: '#000',
      width: 2,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    };
    expect(strokeHitTest(r, 0, 50, 4)).toBe(true); // left edge
    expect(strokeHitTest(r, 100, 50, 4)).toBe(true); // right edge
    expect(strokeHitTest(r, 50, 100, 4)).toBe(true); // bottom edge
    expect(strokeHitTest(r, 50, 50, 4)).toBe(false); // interior
    expect(strokeHitTest(r, 500, 500, 4)).toBe(false); // far outside
  });

  test('arrow: hit near shaft, miss otherwise', () => {
    const a: ArrowStroke = {
      id: 'a',
      tool: 'arrow',
      color: '#000',
      width: 2,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 0,
    };
    expect(strokeHitTest(a, 50, 1, 4)).toBe(true);
    expect(strokeHitTest(a, 50, 50, 4)).toBe(false);
  });

  test('tolerance widens with stroke width', () => {
    const wide: PenStroke = {
      id: 'w',
      tool: 'pen',
      color: '#000',
      width: 20,
      points: [
        [0, 0],
        [100, 0],
      ],
    };
    // 8 world units away vertically, with tol=4 → would miss a thin stroke,
    // but here width 20 raises the floor.
    expect(strokeHitTest(wide, 50, 8, 4)).toBe(true);
  });
});

describe('annotations-layer / rid', () => {
  test('generates a string with the `s_` prefix', () => {
    const id = rid();
    expect(id.startsWith('s_')).toBe(true);
    expect(id.length).toBeGreaterThan(2);
  });

  test('subsequent calls are distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(rid());
    expect(seen.size).toBe(50);
  });
});

describe('annotations-layer / Phase 5.1 ellipse + fill + text + thickness', () => {
  test('ellipse stroke → <ellipse data-tool="ellipse" cx= cy= rx= ry=>', () => {
    const e: EllipseStroke = {
      id: 'e1',
      tool: 'ellipse',
      color: '#7a4ad3',
      width: 2,
      cx: 50,
      cy: 60,
      rx: 30,
      ry: 20,
      fill: null,
    };
    const svg = strokesToSvg([e]);
    expect(svg).toContain('data-id="e1"');
    expect(svg).toContain('data-tool="ellipse"');
    expect(svg).toContain('cx="50"');
    expect(svg).toContain('cy="60"');
    expect(svg).toContain('rx="30"');
    expect(svg).toContain('ry="20"');
    expect(svg).toContain('fill="none"');
  });

  test('rect with fill is serialized with fill="..." (not none)', () => {
    const r: RectStroke = {
      id: 'r-fill',
      tool: 'rect',
      color: '#1d6cf0',
      width: 2,
      x: 0,
      y: 0,
      w: 50,
      h: 50,
      fill: '#fff4d6',
    };
    const svg = strokesToSvg([r]);
    expect(svg).toContain('fill="#fff4d6"');
    expect(svg).not.toContain('fill="none"');
  });

  test('ellipse with explicit fill survives serialization', () => {
    const e: EllipseStroke = {
      id: 'e-fill',
      tool: 'ellipse',
      color: '#1a8f3e',
      width: 2,
      cx: 100,
      cy: 100,
      rx: 40,
      ry: 25,
      fill: '#e6f4ea',
    };
    const svg = strokesToSvg([e]);
    expect(svg).toContain('fill="#e6f4ea"');
  });

  test('text stroke → <text data-tool="text" data-anchor-id= data-font-size=>', () => {
    const t: TextStroke = {
      id: 't1',
      tool: 'text',
      color: '#1a1a1a',
      fontSize: 14,
      text: 'needs padding',
      anchorId: 'r-host',
    };
    const svg = strokesToSvg([t]);
    expect(svg).toContain('data-tool="text"');
    expect(svg).toContain('data-anchor-id="r-host"');
    expect(svg).toContain('data-font-size="14"');
    expect(svg).toContain('>needs padding</text>');
  });

  test('text content is HTML-escaped (no tag injection)', () => {
    const t: TextStroke = {
      id: 't2',
      tool: 'text',
      color: '#000',
      fontSize: 14,
      text: '<script>alert(1)</script>',
      anchorId: 'host',
    };
    const svg = strokesToSvg([t]);
    expect(svg).toContain('&lt;script>alert(1)&lt;/script>');
    expect(svg).not.toMatch(/<script[\s>]/);
  });

  test('pen thickness round-trips via stroke-width (thin=2 / thick=6)', () => {
    const thick: PenStroke = {
      id: 'pT',
      tool: 'pen',
      color: '#000',
      width: 6,
      points: [
        [0, 0],
        [10, 10],
      ],
    };
    const svg = strokesToSvg([thick]);
    expect(svg).toContain('stroke-width="6"');
  });

  test('ellipse hit-test: stroke band detection (no fill)', () => {
    const e: EllipseStroke = {
      id: 'e',
      tool: 'ellipse',
      color: '#000',
      width: 2,
      cx: 100,
      cy: 100,
      rx: 50,
      ry: 50,
      fill: null,
    };
    // On the perimeter
    expect(strokeHitTest(e, 150, 100, 4)).toBe(true);
    // Inside (no fill) → miss
    expect(strokeHitTest(e, 100, 100, 4)).toBe(false);
    // Far outside → miss
    expect(strokeHitTest(e, 300, 300, 4)).toBe(false);
  });

  test('ellipse hit-test: filled ellipse hits inside', () => {
    const e: EllipseStroke = {
      id: 'e-fill',
      tool: 'ellipse',
      color: '#000',
      width: 2,
      cx: 100,
      cy: 100,
      rx: 50,
      ry: 50,
      fill: '#fff',
    };
    expect(strokeHitTest(e, 100, 100, 4)).toBe(true);
    expect(strokeHitTest(e, 300, 300, 4)).toBe(false);
  });
});

describe('annotations-layer / strokes round-trip is stable for arrays', () => {
  // We don't run svgToStrokes here (DOMParser is environment-bound under
  // bun:test). Instead we assert serialization is deterministic + stable so
  // the wire format doesn't drift across edits.
  const sample: Stroke[] = [
    {
      id: 'p1',
      tool: 'pen',
      color: '#000',
      width: 2,
      points: [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    },
    {
      id: 'r1',
      tool: 'rect',
      color: '#111',
      width: 2,
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    },
  ];

  test('identical input yields identical output (no randomness)', () => {
    expect(strokesToSvg(sample)).toBe(strokesToSvg(sample));
  });
});

describe('annotations-layer / resolveImageUploadSwap (delete-during-upload must not resurrect)', () => {
  // Adversarial-review finding: dropping an image, then Backspacing it
  // before its upload resolves, used to resurrect it once the upload
  // landed — the swap read "id absent from `before`" as render lag
  // unconditionally, with no way to tell that apart from a genuine delete.
  const optimistic: ImageStroke = {
    id: 'img-1',
    tool: 'image',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    href: 'blob:optimistic-preview',
  };
  const sibling: RectStroke = {
    id: 'sib',
    tool: 'rect',
    color: '#000',
    width: 2,
    x: 20,
    y: 0,
    w: 10,
    h: 10,
  };

  test('deleted before the chain caught up to the optimistic insert (common case) → stays gone, no undo record', () => {
    const before = [sibling]; // render lag — optimistic insert not reflected yet
    const result = resolveImageUploadSwap(before, 'img-1', optimistic, 'assets/real.png', true);
    expect(result).toBeNull();
  });

  test('deleted after the chain already had the optimistic entry → explicitly stripped from `after`', () => {
    const before = [sibling, optimistic];
    const result = resolveImageUploadSwap(before, 'img-1', optimistic, 'assets/real.png', true);
    expect(result?.after).toEqual([sibling]);
  });

  test('NOT deleted + render lag (the original, still-valid case) → swaps to the real href', () => {
    const before = [sibling]; // optimistic insert hasn't rendered into `before` yet
    const result = resolveImageUploadSwap(before, 'img-1', optimistic, 'assets/real.png', false);
    const img = result?.after.find((s) => s.id === 'img-1') as unknown as { href: string };
    expect(img?.href).toBe('assets/real.png');
    expect(result?.commitBefore).toEqual([sibling]); // undo excludes the never-committed blob: entry
  });

  test('NOT deleted, already present in `before` → swaps in place, sibling order preserved', () => {
    const before = [sibling, optimistic];
    const result = resolveImageUploadSwap(before, 'img-1', optimistic, 'assets/real.png', false);
    expect(result?.after.map((s) => s.id)).toEqual(['sib', 'img-1']);
    const img = result?.after.find((s) => s.id === 'img-1') as unknown as { href: string };
    expect(img?.href).toBe('assets/real.png');
  });
});

describe('annotations-layer / strokesShallowEqual (drag no-op gate)', () => {
  const pen: PenStroke = {
    id: 'p',
    tool: 'pen',
    color: '#000',
    width: 2,
    points: [[0, 0]],
  };
  const rect: RectStroke = {
    id: 'r',
    tool: 'rect',
    color: '#000',
    width: 2,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    fill: null,
  };

  test('same reference → true', () => {
    const arr = [pen, rect];
    expect(strokesShallowEqual(arr, arr)).toBe(true);
  });

  test('different references but same entries (same order) → true', () => {
    expect(strokesShallowEqual([pen, rect], [pen, rect])).toBe(true);
  });

  test('different entry reference at any slot → false', () => {
    const penClone: PenStroke = { ...pen };
    expect(strokesShallowEqual([pen, rect], [penClone, rect])).toBe(false);
  });

  test('different length → false', () => {
    expect(strokesShallowEqual([pen], [pen, rect])).toBe(false);
  });

  test('empty arrays → true', () => {
    expect(strokesShallowEqual([], [])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 21 — sticky / standalone-text / rect-radius / arrow-heads write path.
// Parse + byte-identical round-trip live in annotations-roundtrip.test.ts
// (they need a DOMParser, registered there via happy-dom).

describe('annotations-layer / Phase 21 sticky serialization', () => {
  const sticky: StickyStroke = {
    id: 'st1',
    tool: 'sticky',
    color: STICKY_PALETTE[0],
    x: 40,
    y: 50,
    w: 200,
    h: 160,
    text: 'approve copy?',
    fontSize: 14,
    cornerRadius: 8,
  };

  test('sticky → <g data-tool="sticky"> with rect + inert <text> body', () => {
    const svg = strokesToSvg([sticky]);
    expect(svg).toContain('data-id="st1"');
    expect(svg).toContain('data-tool="sticky"');
    expect(svg).toContain('data-r="8"');
    expect(svg).toContain('data-fs="14"');
    expect(svg).toContain(`fill="${STICKY_PALETTE[0]}"`);
    expect(svg).toContain('<rect x="40" y="50" width="200" height="160" rx="8" ry="8"/>');
    // Body text lives in an allowlisted <text> (survives sanitizeAnnotationSvg,
    // which strips <foreignObject>). NEVER a foreignObject in the persisted SVG.
    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('>approve copy?</text>');
  });

  test('sticky default color is the muted yellow paper tint (slot 0); 10 muted tints (Phase 24)', () => {
    expect(STICKY_PALETTE[0]).toBe('#fce8a6');
    expect(STICKY_PALETTE).toHaveLength(10);
  });

  test('sticky body text is HTML-escaped (no tag injection)', () => {
    const svg = strokesToSvg([{ ...sticky, text: '<script>x</script>' }]);
    expect(svg).toContain('&lt;script>x&lt;/script>');
    expect(svg).not.toMatch(/<script[\s>]/);
  });
});

describe('annotations-layer / Phase 21 rect corner radius serialization', () => {
  const base: RectStroke = {
    id: 'r',
    tool: 'rect',
    color: '#1d6cf0',
    width: 2,
    x: 0,
    y: 0,
    w: 50,
    h: 50,
  };

  test('cornerRadius 0 (or absent) emits NO rx/ry/data-r (byte-compat)', () => {
    expect(strokesToSvg([base])).not.toContain('rx=');
    expect(strokesToSvg([{ ...base, cornerRadius: 0 }])).not.toContain('data-r=');
  });

  test('cornerRadius 8 emits rx/ry + data-r', () => {
    const svg = strokesToSvg([{ ...base, cornerRadius: 8 }]);
    expect(svg).toContain('rx="8" ry="8" data-r="8"');
  });

  test('cornerRadius 999 (pill) round-trips the literal value', () => {
    expect(strokesToSvg([{ ...base, cornerRadius: 999 }])).toContain('data-r="999"');
  });
});

describe('annotations-layer / Phase 21 arrow heads + dash serialization', () => {
  const base: ArrowStroke = {
    id: 'a',
    tool: 'arrow',
    color: '#1a8f3e',
    width: 2,
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 0,
  };

  test('default arrow (endHead triangle, no start, solid) emits the legacy form', () => {
    const svg = strokesToSvg([base]);
    // Exactly one polyline (the end head), no data-* head attrs, no dasharray.
    expect(svg.match(/<polyline/g) ?? []).toHaveLength(1);
    expect(svg).not.toContain('data-start-head');
    expect(svg).not.toContain('data-end-head');
    expect(svg).not.toContain('data-dash');
    expect(svg).not.toContain('stroke-dasharray');
  });

  test('no heads (line) emits zero polylines + data-end-head="none"', () => {
    const svg = strokesToSvg([{ ...base, startHead: 'none', endHead: 'none' }]);
    expect(svg.match(/<polyline/g) ?? []).toHaveLength(0);
    expect(svg).toContain('data-end-head="none"');
    expect(svg).not.toContain('data-start-head');
  });

  test('both heads emit two polylines + data-start-head="triangle"', () => {
    const svg = strokesToSvg([{ ...base, startHead: 'triangle', endHead: 'triangle' }]);
    expect(svg.match(/<polyline/g) ?? []).toHaveLength(2);
    expect(svg).toContain('data-start-head="triangle"');
    expect(svg).not.toContain('data-end-head'); // triangle is the default
  });

  test('start-only head: one polyline + both head data-attrs', () => {
    const svg = strokesToSvg([{ ...base, startHead: 'triangle', endHead: 'none' }]);
    expect(svg.match(/<polyline/g) ?? []).toHaveLength(1);
    expect(svg).toContain('data-start-head="triangle"');
    expect(svg).toContain('data-end-head="none"');
  });

  test('dashed arrow emits stroke-dasharray + data-dash="1"', () => {
    const svg = strokesToSvg([{ ...base, dashed: true }]);
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain('data-dash="1"');
  });
});

describe('annotations-layer / Phase 21 standalone text serialization', () => {
  test('standalone text writes x/y and OMITS data-anchor-id', () => {
    const t: TextStroke = {
      id: 't-std',
      tool: 'text',
      color: '#1a1a1a',
      fontSize: 14,
      text: 'label',
      x: 120,
      y: 80,
    };
    const svg = strokesToSvg([t]);
    expect(svg).toContain('data-tool="text"');
    expect(svg).toContain('x="120"');
    expect(svg).toContain('y="80"');
    expect(svg).not.toContain('data-anchor-id');
    expect(svg).toContain('>label</text>');
  });

  test('anchored text still writes data-anchor-id (back-compat, unchanged)', () => {
    const t: TextStroke = {
      id: 't-anc',
      tool: 'text',
      color: '#1a1a1a',
      fontSize: 14,
      text: 'anchored',
      anchorId: 'r-host',
    };
    const svg = strokesToSvg([t]);
    expect(svg).toContain('data-anchor-id="r-host"');
    expect(svg).not.toContain('x=');
  });
});

describe('annotations-layer / Phase 21 sticky + standalone-text geometry', () => {
  const sticky: StickyStroke = {
    id: 'st',
    tool: 'sticky',
    color: STICKY_PALETTE[2],
    x: 10,
    y: 20,
    w: 200,
    h: 160,
    text: 'note',
    fontSize: 14,
  };

  test('sticky bbox is its rect extent', () => {
    expect(strokeBBox(sticky)).toEqual({ x: 10, y: 20, w: 200, h: 160 });
  });

  test('sticky bbox normalizes negative extent (mid-drag)', () => {
    expect(strokeBBox({ ...sticky, x: 100, y: 100, w: -40, h: -30 })).toEqual({
      x: 60,
      y: 70,
      w: 40,
      h: 30,
    });
  });

  test('sticky is a filled-rect hit anywhere inside', () => {
    expect(strokeHitTest(sticky, 100, 100, 4)).toBe(true); // interior
    expect(strokeHitTest(sticky, 10, 20, 4)).toBe(true); // corner
    expect(strokeHitTest(sticky, 500, 500, 4)).toBe(false); // far outside
  });

  test('standalone text has a synthetic selectable bbox at its (x, y)', () => {
    const t: TextStroke = {
      id: 't',
      tool: 'text',
      color: '#000',
      fontSize: 14,
      text: 'hello',
      x: 50,
      y: 60,
    };
    const bb = strokeBBox(t);
    expect(bb?.x).toBe(50);
    expect(bb?.y).toBe(60);
    expect(bb?.w).toBeGreaterThan(0);
    expect(bb?.h).toBeCloseTo(14 * 1.2, 4);
  });

  test('standalone text is eraser-hittable; anchored text is not', () => {
    const std: TextStroke = {
      id: 't',
      tool: 'text',
      color: '#000',
      fontSize: 14,
      text: 'hi',
      x: 0,
      y: 0,
    };
    expect(strokeHitTest(std, 2, 2, 4)).toBe(true);
    const anchored: TextStroke = {
      id: 't2',
      tool: 'text',
      color: '#000',
      fontSize: 14,
      text: 'hi',
      anchorId: 'host',
    };
    expect(strokeHitTest(anchored, 2, 2, 4)).toBe(false);
  });
});

describe('annotations-layer / Phase 23 image + link geometry', () => {
  const image: ImageStroke = {
    id: 'im',
    tool: 'image',
    x: 30,
    y: 40,
    w: 200,
    h: 150,
    href: 'assets/deadbeef.png',
  };
  const link: LinkStroke = {
    id: 'lk',
    tool: 'link',
    x: 30,
    y: 40,
    w: 260,
    h: 76,
    url: 'https://example.com',
    title: 'Example',
    domain: 'example.com',
  };

  test('image bbox is its rect extent (normalizes negative extent)', () => {
    expect(strokeBBox(image)).toEqual({ x: 30, y: 40, w: 200, h: 150 });
    expect(strokeBBox({ ...image, x: 230, y: 190, w: -200, h: -150 })).toEqual({
      x: 30,
      y: 40,
      w: 200,
      h: 150,
    });
  });

  test('link bbox is its card extent', () => {
    expect(strokeBBox(link)).toEqual({ x: 30, y: 40, w: 260, h: 76 });
  });

  test('image + link are filled-card hits anywhere inside', () => {
    expect(strokeHitTest(image, 100, 100, 4)).toBe(true); // interior
    expect(strokeHitTest(image, 30, 40, 4)).toBe(true); // corner
    expect(strokeHitTest(image, 999, 999, 4)).toBe(false); // far outside
    expect(strokeHitTest(link, 100, 60, 4)).toBe(true);
    expect(strokeHitTest(link, 999, 999, 4)).toBe(false);
  });

  test('image serializes a same-origin <image> with preserveAspectRatio', () => {
    const svg = strokesToSvg([image]);
    expect(svg).toContain('<image');
    expect(svg).toContain('data-tool="image"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).toContain('href="assets/deadbeef.png"');
  });

  test('link serializes a card <g> carrying its data-* payload', () => {
    const svg = strokesToSvg([link]);
    expect(svg).toContain('data-tool="link"');
    expect(svg).toContain('data-url="https://example.com"');
    expect(svg).toContain('data-domain="example.com"');
    expect(svg).toContain('<rect');
  });
});

describe('annotations-layer / Phase 24 polygon geometry', () => {
  test('polygonVertices span the full bbox for every shape', () => {
    for (const shape of ['diamond', 'triangle', 'triangle-down'] as const) {
      const pts = polygonVertices(shape, 10, 20, 80, 60);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      expect(Math.min(...xs)).toBeCloseTo(10, 4);
      expect(Math.max(...xs)).toBeCloseTo(90, 4);
      expect(Math.min(...ys)).toBeCloseTo(20, 4);
      expect(Math.max(...ys)).toBeCloseTo(80, 4);
    }
  });

  test('diamond has 4 vertices; triangles have 3', () => {
    expect(polygonVertices('diamond', 0, 0, 10, 10)).toHaveLength(4);
    expect(polygonVertices('triangle', 0, 0, 10, 10)).toHaveLength(3);
    expect(polygonVertices('triangle-down', 0, 0, 10, 10)).toHaveLength(3);
  });

  test('polygonPoints serializes vertices as an SVG points string', () => {
    expect(polygonPoints('diamond', 0, 0, 10, 10)).toBe('5,0 10,5 5,10 0,5');
  });

  test('polygon serializes as <polygon data-tool="polygon" data-shape=...>', () => {
    const p: PolygonStroke = {
      id: 'pg',
      tool: 'polygon',
      shape: 'triangle',
      color: '#e5484d',
      width: 2,
      x: 0,
      y: 0,
      w: 40,
      h: 40,
    };
    const svg = strokesToSvg([p]);
    expect(svg).toContain('data-tool="polygon"');
    expect(svg).toContain('data-shape="triangle"');
    expect(svg).toContain('points="20,0 40,40 0,40"');
  });

  test('polygon bbox is its normalized extent', () => {
    const p: PolygonStroke = {
      id: 'pg',
      tool: 'polygon',
      shape: 'diamond',
      color: '#000',
      width: 2,
      x: 100,
      y: 100,
      w: -40,
      h: -30,
    };
    expect(strokeBBox(p)).toEqual({ x: 60, y: 70, w: 40, h: 30 });
  });

  test('filled diamond hit-tests inside; stroke-only hits the edge not the centre', () => {
    const filled: PolygonStroke = {
      id: 'd',
      tool: 'polygon',
      shape: 'diamond',
      color: '#000',
      width: 2,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      fill: '#eee',
    };
    expect(strokeHitTest(filled, 50, 50, 4)).toBe(true); // centre, filled
    expect(strokeHitTest(filled, 5, 5, 4)).toBe(false); // outside the diamond (in a bbox corner)
    const outline: PolygonStroke = { ...filled, fill: null };
    expect(strokeHitTest(outline, 50, 50, 4)).toBe(false); // centre, not filled
    expect(strokeHitTest(outline, 25, 25, 4)).toBe(true); // on the NW edge midpoint line
  });
});

// issue-106 — a sticky's card never grew, and `.dc-sticky-body` is
// `overflow: hidden`, so past its capacity every further line was invisible:
// Shift+Enter on a full note looked like it did nothing at all.
describe('annotations-model / grownStickyBox (a sticky grows to fit its text)', () => {
  const box = { x: 10, y: 20, w: 200, h: 200 };

  test('text that already fits asks for no growth', () => {
    expect(grownStickyBox(box, 180)).toBeNull();
  });

  test('exactly-full is still no growth (the boundary the bug lives on)', () => {
    expect(grownStickyBox(box, 200)).toBeNull();
  });

  test('one line over capacity grows the card to fit it', () => {
    expect(grownStickyBox(box, 217)).toEqual({ x: 10, y: 20, w: 200, h: 217 });
  });

  test('a fractional measurement rounds UP, never leaving a clipped sliver', () => {
    expect(grownStickyBox(box, 217.2)?.h).toBe(218);
  });

  test('grows only — a roomy sticky is never shrunk by a text edit', () => {
    expect(grownStickyBox({ ...box, h: 600 }, 217)).toBeNull();
  });

  test('a bottom-up sticky (negative w/h) is normalized, keeping its visual box', () => {
    // Drawn from (210, 220) back to (10, 20): same pixels, negative extents.
    expect(grownStickyBox({ x: 210, y: 220, w: -200, h: -200 }, 260)).toEqual({
      x: 10,
      y: 20,
      w: 200,
      h: 260,
    });
  });

  test('growth is capped — a peer-inflated fontSize cannot persist a giant card', () => {
    expect(grownStickyBox(box, 1e9)).toEqual({ x: 10, y: 20, w: 200, h: STICKY_MAX_GROWN_H });
  });

  test('a sticky already at the cap asks for no further growth', () => {
    expect(grownStickyBox({ ...box, h: STICKY_MAX_GROWN_H }, 1e9)).toBeNull();
  });

  test('an unusable measurement is ignored rather than collapsing the card', () => {
    expect(grownStickyBox(box, 0)).toBeNull();
    expect(grownStickyBox(box, Number.NaN)).toBeNull();
    expect(grownStickyBox(box, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
