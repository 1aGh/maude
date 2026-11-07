// #155 §10 — a file's frames as ONE canvas, one artboard per frame.

import { describe, expect, test } from 'bun:test';
import { JsxTooLargeError, PAGE_GAP, toFramesCanvases } from './to-artboard.ts';
import { normalizeDocument } from './types.ts';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const textNode = (id: string, family: string) => ({
  id,
  name: 'label',
  type: 'TEXT',
  characters: 'Hello world',
  absoluteBoundingBox: box(10, 10, 100, 20),
  style: { fontFamily: family, fontSize: 16 },
  fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }],
});
const frame = (id: string, at: ReturnType<typeof box>, children: unknown[] = []) => ({
  id,
  name: `Frame ${id}`,
  type: 'FRAME',
  absoluteBoundingBox: at,
  fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
  children,
});

function build(pages: Array<unknown[]>) {
  const doc = normalizeDocument(
    {
      id: '0:0',
      name: 'Doc',
      type: 'DOCUMENT',
      children: pages.map((children, i) => ({
        id: `0:${i + 1}`,
        name: `Page ${i + 1}`,
        type: 'CANVAS',
        children,
      })),
    },
    { fileKey: 'figTESTKEY0123456789', surface: 'design', origin: 'fig' }
  );
  const groups = (doc.root.children ?? []).map((page) => ({
    page,
    frames: page.children ?? [],
  }));
  return { doc, groups };
}

const artboards = (tsx: string) => (tsx.match(/<DCArtboard/g) ?? []).length;

describe('#155 §10 — one canvas for a file', () => {
  test('every frame of every page becomes an artboard of ONE canvas', () => {
    const { doc, groups } = build([
      [frame('1:1', box(0, 0, 400, 300)), frame('1:2', box(500, 0, 400, 300))],
      [frame('2:1', box(0, 0, 400, 300))],
    ]);
    const out = toFramesCanvases(doc, groups);
    expect(out).toHaveLength(1);
    expect(artboards(out[0].tsx)).toBe(3);
    expect(out[0].artboardCount).toBe(3);
    expect(out[0].tsx).toContain("from '@maude/canvas-lib'");
  });

  test('pages sit side by side, each keeping its own frames’ arrangement', () => {
    const { doc, groups } = build([
      [frame('1:1', box(100, 100, 400, 300)), frame('1:2', box(600, 100, 400, 300))],
      [frame('2:1', box(100, 100, 400, 300))],
    ]);
    const [canvas] = toFramesCanvases(doc, groups);
    const pos = (canvas.meta.layout as { artboards: Array<{ id: string; x: number; y: number }> })
      .artboards;
    const at = (needle: string) => pos.find((p) => p.id.endsWith(needle));
    expect(at('1-1')).toMatchObject({ x: 0, y: 0 });
    expect(at('1-2')).toMatchObject({ x: 500, y: 0 });
    // page 1 is 900 wide; page 2 starts after it plus the gap
    expect(at('2-1')).toMatchObject({ x: 900 + PAGE_GAP, y: 0 });
  });

  test('artboard ids are unique', () => {
    const { doc, groups } = build([
      [frame('1:1', box(0, 0, 100, 100)), frame('1:2', box(0, 0, 100, 100))],
      [frame('2:1', box(0, 0, 100, 100))],
    ]);
    const [canvas] = toFramesCanvases(doc, groups);
    const ids = [...canvas.tsx.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a font family is reported once for the whole canvas, with its count', () => {
    const { doc, groups } = build([
      [
        frame('1:1', box(0, 0, 400, 300), [textNode('1:5', 'Nunito')]),
        frame('1:2', box(500, 0, 400, 300), [textNode('1:6', 'Nunito')]),
      ],
    ]);
    const [canvas] = toFramesCanvases(doc, groups);
    const subs = canvas.report.entries.filter((e) => e.disposition === 'font-substituted');
    expect(subs).toHaveLength(1);
    expect(subs[0].detail).toBe('Nunito x2');
  });

  test('pending assets of every frame are collected on the canvas that carries them', () => {
    const imageFrame = (id: string) =>
      frame(id, box(0, 0, 200, 200), [
        {
          id: `${id}9`,
          name: 'photo',
          type: 'RECTANGLE',
          absoluteBoundingBox: box(0, 0, 100, 100),
          fills: [{ type: 'IMAGE', visible: true, imageRef: 'aabbccddeeff0011' }],
        },
      ]);
    const { doc, groups } = build([[imageFrame('1:1'), imageFrame('1:2')]]);
    const [canvas] = toFramesCanvases(doc, groups);
    expect(canvas.pendingExports).toHaveLength(2);
  });
});

describe('#155 §10 — a file too large for one canvas is split, not refused', () => {
  const many = (n: number) =>
    build([
      Array.from({ length: n }, (_, i) =>
        frame(`1:${i + 1}`, box(i * 500, 0, 400, 300), [textNode(`2:${i + 1}`, 'Inter')])
      ),
    ]);

  test('canvases stay under the cap and together hold every frame exactly once', () => {
    const { doc, groups } = many(12);
    const one = toFramesCanvases(doc, groups)[0].tsx.length;
    const cap = Math.round(one / 3);
    const out = toFramesCanvases(doc, groups, { maxBytes: cap });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.tsx.length).toBeLessThanOrEqual(cap + 400);
    expect(out.reduce((n, c) => n + artboards(c.tsx), 0)).toBe(12);
    const ids = out.flatMap((c) => [...c.tsx.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('positions in a later canvas restart at its own corner', () => {
    const { doc, groups } = many(12);
    const one = toFramesCanvases(doc, groups)[0].tsx.length;
    const out = toFramesCanvases(doc, groups, { maxBytes: Math.round(one / 3) });
    for (const c of out) {
      const xs = (c.meta.layout as { artboards: Array<{ x: number }> }).artboards.map((a) => a.x);
      expect(Math.min(...xs)).toBe(0);
    }
  });

  test('a single frame bigger than the cap still refuses', () => {
    const { doc, groups } = many(1);
    expect(() => toFramesCanvases(doc, groups, { maxBytes: 600 })).toThrow(JsxTooLargeError);
  });
});
