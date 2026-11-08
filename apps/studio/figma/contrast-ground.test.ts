// #155 §5 (T4.1, D8) — the contrast floor is measured against the REAL ground,
// and is off when that ground is not flat.
//
// The old rule measured every text node against its parent frame's first flat
// fill, so white text on a frame whose real background was a gradient, a photo
// or a blurred blob was "corrected" to black.

import { describe, expect, test } from 'bun:test';
import { toArtboard } from './to-artboard.ts';
import { normalizeDocument } from './types.ts';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const rgb = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });
const solid = (r: number, g: number, b: number, opacity = 1) => ({
  type: 'SOLID',
  visible: true,
  opacity,
  color: rgb(r, g, b),
});
const stops = [
  { position: 0, color: rgb(0.05, 0.05, 0.2) },
  { position: 1, color: rgb(0.1, 0.2, 0.4) },
];
const gradient = {
  type: 'GRADIENT_LINEAR',
  visible: true,
  gradientStops: stops,
  gradientHandlePositions: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
};

const text = (id: string, ink: [number, number, number], at = box(20, 20, 120, 24)) => ({
  id,
  name: 'label',
  type: 'TEXT',
  characters: 'Hello world',
  absoluteBoundingBox: at,
  style: { fontFamily: 'Inter', fontSize: 16 },
  fills: [solid(...ink)],
});
const shape = (id: string, extra: Record<string, unknown>, at = box(0, 0, 400, 300)) => ({
  id,
  name: 'shape',
  type: 'RECTANGLE',
  absoluteBoundingBox: at,
  ...extra,
});

function run(frameFills: unknown[], children: unknown[], frameExtra: Record<string, unknown> = {}) {
  const doc = normalizeDocument(
    {
      id: '0:0',
      name: 'Page',
      type: 'CANVAS',
      children: [
        {
          id: '2:1',
          name: 'Frame',
          type: 'FRAME',
          absoluteBoundingBox: box(0, 0, 400, 300),
          fills: frameFills,
          children,
          ...frameExtra,
        },
      ],
    },
    { fileKey: 'figTESTKEY0123456789', surface: 'design' }
  );
  const frame = doc.root.children?.[0];
  if (!frame) throw new Error('no frame');
  const out = toArtboard(doc, frame, { tokens: [] });
  const line = out.tsx.split('\n').find((l) => l.includes('<p ')) ?? '';
  const color = /color: "([^"]+)"/.exec(line)?.[1];
  const floored = out.report.entries.some((e) => e.detail === 'contrast floor');
  return { color, floored };
}

describe('#155 §5 — a flat ground keeps the floor (unchanged behaviour)', () => {
  test('white text on a flat white frame is corrected to a readable ink', () => {
    const r = run([solid(1, 1, 1)], [text('3:1', [1, 1, 1])]);
    expect(r.color).toBe('#000000');
    expect(r.floored).toBe(true);
  });

  test('readable text is left alone', () => {
    const r = run([solid(1, 1, 1)], [text('3:1', [0, 0, 0])]);
    expect(r.color).toBe('#000000');
    expect(r.floored).toBe(false);
  });

  test('an unrelated gradient far from the text does not switch the floor off', () => {
    const r = run(
      [solid(1, 1, 1)],
      [shape('3:2', { fills: [gradient] }, box(200, 150, 100, 100)), text('3:1', [1, 1, 1])]
    );
    expect(r.floored).toBe(true);
  });
});

describe('#155 §5 — the floor is off when the real ground is not flat', () => {
  test('a gradient frame: white text stays white', () => {
    const r = run([gradient], [text('3:1', [1, 1, 1])]);
    expect(r.color).toBe('#ffffff');
    expect(r.floored).toBe(false);
  });

  test('an image frame: the ground is a picture, not a colour', () => {
    const r = run(
      [{ type: 'IMAGE', visible: true, imageRef: 'aabbccddeeff00112233' }],
      [text('3:1', [1, 1, 1])]
    );
    expect(r.floored).toBe(false);
  });

  test('a gradient child BEHIND the text decides, not the frame fill', () => {
    const r = run([solid(1, 1, 1)], [shape('3:2', { fills: [gradient] }), text('3:1', [1, 1, 1])]);
    expect(r.color).toBe('#ffffff');
    expect(r.floored).toBe(false);
  });

  test('a blurred blob behind the text switches the floor off', () => {
    const blob = shape(
      '3:2',
      {
        fills: [solid(0.1, 0.1, 0.6)],
        effects: [{ type: 'LAYER_BLUR', visible: true, radius: 60 }],
      },
      box(0, 0, 200, 100)
    );
    const r = run([solid(1, 1, 1)], [blob, text('3:1', [1, 1, 1])]);
    expect(r.color).toBe('#ffffff');
    expect(r.floored).toBe(false);
  });

  test('a shape only PARTLY behind the text makes the ground uneven', () => {
    const half = shape('3:2', { fills: [solid(0, 0, 0)] }, box(0, 0, 70, 300));
    const r = run([solid(1, 1, 1)], [half, text('3:1', [1, 1, 1])]);
    expect(r.floored).toBe(false);
  });
});

describe('#155 §5 — the real flat ground is the one that is measured', () => {
  test('white text on a dark panel over a white frame is already readable', () => {
    const panel = shape('3:2', { fills: [solid(0.05, 0.05, 0.1)] }, box(0, 0, 400, 300));
    const r = run([solid(1, 1, 1)], [panel, text('3:1', [1, 1, 1])]);
    expect(r.color).toBe('#ffffff');
    expect(r.floored).toBe(false);
  });

  test('dark text on that dark panel IS corrected, against the panel', () => {
    const panel = shape('3:2', { fills: [solid(0.05, 0.05, 0.1)] }, box(0, 0, 400, 300));
    const r = run([solid(1, 1, 1)], [panel, text('3:1', [0.05, 0.05, 0.1])]);
    expect(r.color).toBe('#ffffff');
    expect(r.floored).toBe(true);
  });

  test('a translucent panel is blended onto what is under it', () => {
    // black at 70 % over white = #4d4d4d: white text on it is fine, though the
    // frame under the panel is white.
    const dark = shape('3:2', { fills: [solid(0, 0, 0, 0.7)] }, box(0, 0, 400, 300));
    const ok = run([solid(1, 1, 1)], [dark, text('3:1', [1, 1, 1])]);
    expect(ok.color).toBe('#ffffff');
    expect(ok.floored).toBe(false);
    // black at 20 % over white = #cccccc: white text on it fails, though the
    // panel's own colour (black) would have passed.
    const pale = shape('3:2', { fills: [solid(0, 0, 0, 0.2)] }, box(0, 0, 400, 300));
    const bad = run([solid(1, 1, 1)], [pale, text('3:1', [1, 1, 1])]);
    expect(bad.floored).toBe(true);
    expect(bad.color).toBe('#000000');
  });

  test('a translucent panel over an unknown ground stays unknown', () => {
    const panel = shape('3:2', { fills: [solid(0, 0, 0, 0.5)] }, box(0, 0, 400, 300));
    const r = run([gradient], [panel, text('3:1', [1, 1, 1])]);
    expect(r.floored).toBe(false);
  });

  test('a nested container fill is the ground of its text', () => {
    const card = {
      id: '3:5',
      name: 'card',
      type: 'FRAME',
      absoluteBoundingBox: box(10, 10, 200, 100),
      fills: [solid(0.1, 0.1, 0.1)],
      children: [text('3:6', [1, 1, 1], box(20, 20, 100, 20))],
    };
    const r = run([solid(1, 1, 1)], [card]);
    expect(r.color).toBe('#ffffff');
    expect(r.floored).toBe(false);
  });
});
