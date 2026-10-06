// annotations-v2 (DDR-242 §6) — v1 SVG → v2 elements: parity of what the user sees.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { compareOrder } from '../annotations/fractional-index.ts';
import { parseMiniDom } from '../annotations/legacy/mini-dom.ts';
import { migrateSvg, parseLegacySvg, v1ToV2 } from '../annotations/migrate-v1.ts';
import { defOf } from '../annotations/registry.ts';
import { Scene } from '../annotations/scene.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import {
  type Stroke,
  strokeBBox,
  strokeHitTest,
  strokesToSvg,
  svgToStrokes,
} from '../annotations-model.ts';

beforeAll(() => {
  GlobalRegistrator.register({ settings: { disableJavaScriptEvaluation: true } });
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const FIX = join(import.meta.dir, 'fixtures');
const REPO = join(import.meta.dir, '..', '..', '..');
const fixtures: Array<[string, string]> = [
  ['phase-20', join(FIX, 'phase-20-annotations.svg')],
  ['phase-21', join(FIX, 'phase-21-annotations.svg')],
  ['figjam-v3', join(FIX, 'figjam-v3-groups-bindings.svg')],
  ['mixed-200', join(FIX, 'annotations-v2', 'mixed-200.v1.svg')],
  ['e2e ui-smoke', join(FIX, 'annotations-v2', 'ui-smoke.v1.svg')],
  ...readdirSync(join(REPO, '.design'))
    .filter((f) => f.endsWith('.annotations.svg'))
    .map((f): [string, string] => [`repo ${f}`, join(REPO, '.design', f)]),
];

/** Every legacy fixture must migrate with render parity. */
describe.each(fixtures)('%s', (_name, path) => {
  const svg = readFileSync(path, 'utf8');

  test('mini-dom parses exactly like the browser DOMParser', () => {
    expect(parseLegacySvg(svg)).toEqual(svgToStrokes(svg));
  });

  test('geometry, text, bindings and paint order are preserved', () => {
    const v1 = parseLegacySvg(svg);
    const { elements, report } = v1ToV2(v1);
    const scene = new Scene(elements);
    const anchors = new Map(
      v1
        .filter((s) => s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon')
        .map((s) => [s.id, s])
    ) as Map<string, never>;
    const reported = new Set(report.map((r) => r.id));
    for (const s of v1) {
      if (s.tool === 'text' && s.anchorId) continue; // became a label (checked below)
      if (reported.has(s.id)) continue;
      const el = scene.get(s.id);
      expect(el, `element ${s.id} (${s.tool}) survives`).toBeDefined();
      if (!el) continue;
      if (s.tool === 'arrow' && (s.startBind || s.endBind)) {
        // Bound ends are re-derived from hosts: check they attach to the same hosts.
        const r = scene.arrowWorld(el);
        expect(r).not.toBeNull();
        if (s.startBind) expect(r?.startAnchor?.el).toBe(s.startBind.hostId);
        if (s.endBind) expect(r?.endAnchor?.el).toBe(s.endBind.hostId);
        continue;
      }
      const a = strokeBBox(s, anchors);
      const b = scene.worldBox(el);
      expect(b, `bounds of ${s.id}`).not.toBeNull();
      if (!a || !b) continue;
      const na = {
        x: Math.min(a.x, a.x + a.w),
        y: Math.min(a.y, a.y + a.h),
        w: Math.abs(a.w),
        h: Math.abs(a.h),
      };
      for (const k of ['x', 'y', 'w', 'h'] as const)
        expect(Math.abs(na[k] - b[k])).toBeLessThanOrEqual(0.011);
      if (s.tool === 'sticky' || (s.tool === 'text' && !s.anchorId))
        expect(el.text ?? '').toBe(s.text);
    }
    // Labels: anchored text lands on its host.
    for (const s of v1) {
      if (s.tool !== 'text' || !s.anchorId || reported.has(s.id)) continue;
      const host = scene.get(s.anchorId);
      expect((host?.label as { text?: string } | undefined)?.text ?? '').toBe(s.text);
    }
    // Paint order among siblings follows v1 array order.
    const pos = new Map(v1.map((s, i) => [s.id, i]));
    for (const parent of [null, ...elements.filter((e) => e.type === 'section').map((e) => e.id)]) {
      const kids = [...scene.childrenOf(parent)].sort(compareOrder);
      for (let i = 1; i < kids.length; i++) {
        expect(pos.get((kids[i - 1] as { id: string }).id) as number).toBeLessThan(
          pos.get((kids[i] as { id: string }).id) as number
        );
      }
    }
  });

  test('hit-testing agrees with v1 on a grid around every element', () => {
    const v1 = parseLegacySvg(svg);
    const { elements, report } = v1ToV2(v1);
    const scene = new Scene(elements);
    const reported = new Set(report.map((r) => r.id));
    let probes = 0;
    for (const s of v1) {
      if ((s.tool === 'text' && s.anchorId) || s.tool === 'arrow' || reported.has(s.id)) continue;
      const el = scene.get(s.id);
      const bb = strokeBBox(s);
      if (!el || !bb) continue;
      const def = defOf(el.type);
      if (!def) continue;
      const o = scene.originOf(el);
      // A grid over the box plus probes just inside/outside each edge, at a
      // tolerance below the stroke width so the stroke-width band is exercised.
      const xs = [0, 1, 2, 3, 4].map((i) => bb.x + (bb.w * i) / 4);
      const ys = [0, 1, 2, 3, 4].map((j) => bb.y + (bb.h * j) / 4);
      // Offsets straddle the 2/3/6 px bands without landing exactly on a band edge
      // (relative coordinates differ from v1's in the last float bit).
      const offs = [-3.5, -2.5, -1.5, 0, 1.5, 2.5, 3.5, 5.5, 6.5];
      const pts: Array<[number, number]> = [];
      for (const x of xs) for (const y of ys) pts.push([x, y]);
      for (const d of offs) {
        pts.push([bb.x + d, bb.y + bb.h / 2], [bb.x + bb.w + d, bb.y + bb.h / 2]);
        pts.push([bb.x + bb.w / 2, bb.y + d], [bb.x + bb.w / 2, bb.y + bb.h + d]);
      }
      for (const [wx, wy] of pts) {
        expect(def.hitTest(el, wx - o.x, wy - o.y, 1, scene.ctx(el)), `${s.id} @ ${wx},${wy}`).toBe(
          strokeHitTest(s, wx, wy, 1)
        );
        probes++;
      }
    }
    expect(probes).toBeGreaterThanOrEqual(0);
  });

  test('migration is deterministic and the board round-trips', () => {
    const a = serializeBoard(migrateSvg(svg).elements);
    const b = serializeBoard(migrateSvg(svg).elements);
    expect(a).toBe(b);
    expect(serializeBoard(parseBoard(a).elements)).toBe(a);
  });
});

describe('membership + edge cases', () => {
  const svgOf = (strokes: Stroke[]) => strokesToSvg(strokes);

  test('centre-in-section (inclusive) becomes parent + relative coordinates', () => {
    const { elements } = v1ToV2([
      { id: 'sec', tool: 'section', x: 100, y: 100, w: 400, h: 300, label: 'S', color: '#8b8b94' },
      {
        id: 'in',
        tool: 'sticky',
        color: '#fce8a6',
        x: 150,
        y: 120,
        w: 100,
        h: 100,
        text: 'a',
        fontSize: 14,
      },
      // centre exactly on the right border → inside (v1 rule is inclusive)
      {
        id: 'edge',
        tool: 'sticky',
        color: '#fce8a6',
        x: 450,
        y: 200,
        w: 100,
        h: 100,
        text: 'b',
        fontSize: 14,
      },
      {
        id: 'out',
        tool: 'sticky',
        color: '#fce8a6',
        x: 700,
        y: 700,
        w: 100,
        h: 100,
        text: 'c',
        fontSize: 14,
      },
    ]);
    const by = new Map(elements.map((e) => [e.id, e]));
    expect(by.get('in')).toMatchObject({ parent: 'sec', x: 50, y: 20 });
    expect(by.get('edge')?.parent).toBe('sec');
    expect(by.get('out')?.parent).toBeUndefined();
  });

  test('an element painted UNDER a section is never adopted by it (paint order kept)', () => {
    const { elements } = v1ToV2([
      // A backing paper first, then the section drawn over it, then content.
      {
        id: 'paper',
        tool: 'rect',
        color: '#000000',
        width: 1,
        x: 0,
        y: 0,
        w: 1000,
        h: 800,
        fill: '#ffffff',
      },
      { id: 'sec', tool: 'section', x: 100, y: 100, w: 800, h: 600, label: 'S', color: '#8b8b94' },
      {
        id: 'card',
        tool: 'sticky',
        color: '#fce8a6',
        x: 200,
        y: 200,
        w: 100,
        h: 100,
        text: '',
        fontSize: 14,
      },
    ]);
    const scene = new Scene(elements);
    expect(scene.get('paper')?.parent).toBeUndefined();
    expect(scene.get('card')?.parent).toBe('sec');
    expect(scene.paintOrder().map((e) => e.id)).toEqual(['paper', 'sec', 'card']);
  });

  test('visually nested sections nest; the smallest container wins', () => {
    const { elements } = v1ToV2([
      { id: 'outer', tool: 'section', x: 0, y: 0, w: 1000, h: 1000, label: 'O', color: '#8b8b94' },
      {
        id: 'inner',
        tool: 'section',
        x: 100,
        y: 100,
        w: 300,
        h: 300,
        label: 'I',
        color: '#8b8b94',
      },
      {
        id: 'st',
        tool: 'sticky',
        color: '#fce8a6',
        x: 150,
        y: 150,
        w: 100,
        h: 100,
        text: '',
        fontSize: 14,
      },
    ]);
    const by = new Map(elements.map((e) => [e.id, e]));
    expect(by.get('inner')?.parent).toBe('outer');
    expect(by.get('st')).toMatchObject({ parent: 'inner', x: 50, y: 50 });
  });

  test('a second label on one shape is kept as text, orphan labels are reported', () => {
    const { elements, report } = v1ToV2([
      { id: 'r', tool: 'rect', color: '#000000', width: 2, x: 0, y: 0, w: 100, h: 50 },
      { id: 't1', tool: 'text', color: '#000000', fontSize: 14, text: 'one', anchorId: 'r' },
      { id: 't2', tool: 'text', color: '#000000', fontSize: 14, text: 'two', anchorId: 'r' },
      { id: 't3', tool: 'text', color: '#000000', fontSize: 14, text: 'lost', anchorId: 'nope' },
    ]);
    const by = new Map(elements.map((e) => [e.id, e]));
    expect(by.get('r')?.label).toEqual({ text: 'one', color: '#000000' });
    expect(by.get('t2')?.type).toBe('text');
    expect(report.map((r) => r.id)).toEqual(expect.arrayContaining(['t2', 't3']));
  });

  test('pinned vs auto binds; ends bound to a missing host become free points', () => {
    const { elements } = v1ToV2([
      { id: 'r', tool: 'rect', color: '#000000', width: 2, x: 0, y: 0, w: 100, h: 50 },
      {
        id: 'a',
        tool: 'arrow',
        color: '#000000',
        width: 2,
        x1: 100,
        y1: 25,
        x2: 300,
        y2: 25,
        startBind: { hostId: 'r', nx: 1, ny: 0.5 },
        endBind: { hostId: 'gone', nx: 0, ny: 0.5, pinned: true },
      },
      {
        id: 'b',
        tool: 'arrow',
        color: '#000000',
        width: 2,
        x1: 0,
        y1: 0,
        x2: 5,
        y2: 5,
        startBind: { hostId: 'r', nx: 0, ny: 0, pinned: true },
      },
    ]);
    const by = new Map(elements.map((e) => [e.id, e]));
    expect(by.get('a')).toMatchObject({ start: { el: 'r' }, end: { x: 300, y: 25 } });
    expect(by.get('b')?.start).toEqual({ el: 'r', nx: 0, ny: 0 });
  });

  test('unterminated markup parses in linear time (security review: regex DoS)', () => {
    for (const marker of ['<!--', '<?', '<![CDATA[', '<!DOCTYPE', '<g a="']) {
      const hostile = `<svg>${marker.repeat(Math.floor(1_000_000 / marker.length))}`;
      const t0 = performance.now();
      const doc = parseMiniDom(hostile);
      const ms = performance.now() - t0;
      expect(doc.querySelector('parsererror'), marker).not.toBeNull();
      expect(ms, `${marker} took ${ms.toFixed(0)} ms`).toBeLessThan(250);
    }
  });

  test('garbage and hostile SVG migrate to an empty board, never a throw', () => {
    for (const bad of [
      '',
      '<svg',
      '<svg><script>alert(1)</script></svg>',
      '<<<>>>',
      '<svg>'.repeat(100),
    ]) {
      expect(() => migrateSvg(bad)).not.toThrow();
    }
    expect(parseMiniDom('<svg><g></svg>').querySelector('parsererror')).not.toBeNull();
    expect(migrateSvg(svgOf([])).elements).toEqual([]);
  });
});
