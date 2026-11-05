// perf-annot-zoom (retention-ladder, 714 elements, 221 stickies): "pan/zoom stutters badly on an annotations-only
// canvas". Safari studio lane, zoom p95 200-470 ms a frame; pan stayed at 18 ms.
//
// Two things made every ZOOM frame expensive on WebKit, where the world layer re-rasters at each new scale:
//   1. every sticky painted an SVG `feDropShadow` (`filter="url(#dc-sticky-shadow)"`) - 221 software filters
//      per frame (CSS `filter:none` on them alone: zoom p95 232 -> 19 ms); link and media cards did the same;
//   2. the per-frame camera variable `--dc-zoom` inherited into all ~3.6k annotation nodes, so each frame
//      re-resolved their style and invalidated their paint (reset alone: 232 -> 50 ms). r4 #5
//      (decision v2-r4-5-zoom-var-stops-at-design-surface) stopped it at `.dc-artboard-body`; the scene missed it.
// Both together: 17 ms, the same as with the whole annotation scene hidden.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AnnotationElement } from '../annotations/types.ts';
import { ElementNode } from '../annotations/ui/element-node.tsx';
import { LOD_CSS } from '../annotations/ui/lod.tsx';
import { TEXT_LAYER_CSS } from '../annotations/ui/text-style.ts';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => GlobalRegistrator.unregister());

const draw = (el: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(ElementNode, {
      el: { index: 'a0', ...el } as unknown as AnnotationElement,
      interactive: true,
      edit: null,
      resolveAsset: (h: string) => h,
    })
  );

// the look the SVG filter had: feDropShadow dx 0 dy 4 stdDeviation 8 #000 @ 0.28 (CSS blur = 2 x stdDeviation)
const SHADOW = /box-shadow:\s*0(?:px)?\s+4px\s+16px\s+rgba\(0,\s*0,\s*0,\s*0\.28\)/;

describe('a zoom frame does not repaint expensive annotation content', () => {
  test('a sticky casts its shadow with a CSS box-shadow, not an SVG filter', () => {
    for (const author of [undefined, { kind: 'ai' }]) {
      const html = draw({
        id: 's1',
        type: 'sticky',
        x: 0,
        y: 0,
        w: 160,
        h: 120,
        text: 'Yearly is easy to miss',
        fill: '#fce8a6',
        ...(author ? { author } : {}),
      });
      expect(html).not.toMatch(/filter="url\(/);
      expect(html).toMatch(SHADOW);
      expect(html).toMatch(/border-radius:\s*4px/);
    }
  });

  test('a link card and a media card cast the same shadow, rounded like the card (8px)', () => {
    const link = draw({
      id: 'l1',
      type: 'link',
      x: 0,
      y: 0,
      w: 280,
      h: 72,
      url: 'https://example.com/a',
      title: 'A page',
      domain: 'example.com',
    });
    const media = draw({
      id: 'm1',
      type: 'mediaref',
      media: 'video',
      x: 0,
      y: 0,
      w: 280,
      h: 160,
      src: 'a.mp4',
      title: 'A clip',
    });
    for (const html of [link, media]) {
      expect(html).not.toMatch(/filter="url\(/);
      expect(html).toMatch(SHADOW);
      expect(html).toMatch(/border-radius:\s*8px/);
    }
  });

  test('the scene and the mosaic stop the per-frame --dc-zoom from inheriting into the elements', () => {
    const rulesOf = (css: string) =>
      [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        sel: (m[1] as string).trim(),
        body: m[2] as string,
      }));
    const rules = [...rulesOf(TEXT_LAYER_CSS), ...rulesOf(LOD_CSS)];
    for (const root of ['.dc-annot-scene', '.dc-annot-lod']) {
      const reset = rules.find(
        (r) =>
          r.sel.split(',').some((s) => s.trim() === root) && /--dc-zoom\s*:\s*initial/.test(r.body)
      );
      expect(reset).toBeDefined();
    }
    // nothing in the scene reads it (it would be stuck at the fallback)
    expect(
      rules.filter(
        (r) => r.body.includes('var(--dc-zoom') && /\.dc-annot-(scene|el|lod)/.test(r.sel)
      )
    ).toEqual([]);
  });
});
