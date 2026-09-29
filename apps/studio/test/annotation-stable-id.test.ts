// Annotation ids are what a comment on a sticky anchors to (#134/#136), and
// what the annotations-v2 element model inherits. An element written WITHOUT a
// `data-id` (hand-edited or externally generated SVG) used to get a fresh
// random id on every parse — a different id in every tab, peer and reload — so
// nothing could hold a reference to it.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { svgToStrokes } from '../annotations-layer.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const NO_IDS = `<svg xmlns="http://www.w3.org/2000/svg">
<g data-tool="sticky" data-r="4" data-fs="14"><rect x="10" y="10" width="120" height="80" fill="#fde68a"/><text x="20" y="30">Same</text></g>
<g data-tool="sticky" data-r="4" data-fs="14"><rect x="10" y="10" width="120" height="80" fill="#fde68a"/><text x="20" y="30">Same</text></g>
<g data-tool="sticky" data-r="4" data-fs="14"><rect x="300" y="10" width="120" height="80" fill="#fde68a"/><text x="310" y="30">Other</text></g>
</svg>`;

describe('annotation ids', () => {
  test('an element without data-id gets the same id on every parse', () => {
    const a = svgToStrokes(NO_IDS).map((s) => s.id);
    const b = svgToStrokes(NO_IDS).map((s) => s.id);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });

  test('identical elements still get distinct ids', () => {
    const ids = svgToStrokes(NO_IDS).map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
  });

  test('a written data-id always wins', () => {
    const svg = NO_IDS.replace('<g data-tool="sticky"', '<g data-id="s_keep" data-tool="sticky"');
    expect(svgToStrokes(svg)[0]?.id).toBe('s_keep');
  });
});
