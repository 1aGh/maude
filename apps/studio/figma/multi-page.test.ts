// #155 §7 — a multi-page file keeps every page.
//
// Boards: every page used to be translated into ONE world, stacked on the same
// coordinates. Frames: only the first page was read.

import { describe, expect, test } from 'bun:test';
import type { ArrowStroke, StickyStroke } from '../annotations-model.ts';
import { toStrokes } from './to-strokes.ts';
import { normalizeDocument } from './types.ts';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const sticky = (id: string, at: ReturnType<typeof box>, characters: string) => ({
  id,
  name: 's',
  type: 'STICKY',
  absoluteBoundingBox: at,
  characters,
  fills: [{ type: 'SOLID', visible: true, color: { r: 0.99, g: 0.91, b: 0.65, a: 1 } }],
});

function board(pages: unknown[]) {
  return normalizeDocument(
    { id: '0:0', name: 'Doc', type: 'DOCUMENT', children: pages },
    { fileKey: 'figTESTKEY0123456789', surface: 'board' }
  );
}
const page = (id: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  name: `Page ${id}`,
  type: 'CANVAS',
  children,
  ...extra,
});

const stickies = (doc: ReturnType<typeof board>) =>
  toStrokes(doc, { resetIds: true }).strokes.filter((s): s is StickyStroke => s.tool === 'sticky');

describe('#155 §7 — board pages are laid out side by side', () => {
  test('two pages that share coordinates no longer overlap', () => {
    const doc = board([
      page('0:1', [
        sticky('1:1', box(100, 100, 240, 240), 'A'),
        sticky('1:2', box(500, 100, 240, 240), 'B'),
      ]),
      page('0:2', [sticky('2:1', box(100, 100, 240, 240), 'C')]),
    ]);
    const all = stickies(doc);
    const a = all.find((s) => s.text === 'A');
    const b = all.find((s) => s.text === 'B');
    const c = all.find((s) => s.text === 'C');
    if (!a || !b || !c) throw new Error('missing sticky');
    // page 1 keeps its own layout, normalised to the origin
    expect(a.x).toBe(0);
    expect(b.x).toBe(400);
    // page 2 starts to the right of page 1's right edge (640) plus a gap
    expect(c.x).toBeGreaterThan(b.x + 240);
    expect(c.y).toBe(0);
  });

  test('a page at far-away coordinates still lands next to its neighbour', () => {
    const doc = board([
      page('0:1', [sticky('1:1', box(-5000, -5000, 240, 240), 'A')]),
      page('0:2', [sticky('2:1', box(30000, 9000, 240, 240), 'C')]),
    ]);
    const all = stickies(doc);
    const a = all.find((s) => s.text === 'A');
    const c = all.find((s) => s.text === 'C');
    if (!a || !c) throw new Error('missing sticky');
    expect(a.x).toBe(0);
    expect(c.x).toBeLessThan(2000);
    expect(c.x).toBeGreaterThan(240);
    expect(c.y).toBe(0);
  });

  test('a single page is unchanged', () => {
    const doc = board([page('0:1', [sticky('1:1', box(100, 100, 240, 240), 'A')])]);
    expect(stickies(doc)[0]).toMatchObject({ x: 0, y: 0 });
  });

  test('a hidden page is not laid out', () => {
    const doc = board([
      page('0:1', [sticky('1:1', box(100, 100, 240, 240), 'A')]),
      page('0:2', [sticky('2:1', box(100, 100, 240, 240), 'HIDDEN')], { visible: false }),
      page('0:3', [sticky('3:1', box(100, 100, 240, 240), 'C')]),
    ]);
    const all = stickies(doc);
    expect(all.some((s) => s.text === 'HIDDEN')).toBe(false);
    const c = all.find((s) => s.text === 'C');
    expect(c?.x).toBe(240 + 400);
  });

  test('a connector stays with its own page', () => {
    const connector = (id: string, from: string, to: string) => ({
      id,
      name: 'c',
      type: 'CONNECTOR',
      absoluteBoundingBox: box(100, 100, 100, 0),
      connectorStart: { endpointNodeId: from },
      connectorEnd: { endpointNodeId: to },
    });
    const doc = board([
      page('0:1', [sticky('1:1', box(100, 100, 240, 240), 'A')]),
      page('0:2', [
        sticky('2:1', box(100, 100, 240, 240), 'C'),
        sticky('2:2', box(500, 100, 240, 240), 'D'),
        connector('2:3', '2:1', '2:2'),
      ]),
    ]);
    const { strokes } = toStrokes(doc, { resetIds: true });
    const arrow = strokes.find((s): s is ArrowStroke => s.tool === 'arrow');
    const c = strokes.find((s): s is StickyStroke => s.tool === 'sticky' && s.text === 'C');
    if (!arrow || !c) throw new Error('missing stroke');
    // the arrow starts on page 2's sticky, not back at page 1
    expect(arrow.x1).toBeGreaterThanOrEqual(c.x);
  });
});
