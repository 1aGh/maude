// annotations-v2 security (Milestone E review, A1/B1) — an element whose type
// names an Object.prototype member must never take a canvas down.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateElement } from '../annotations/registry.ts';
import { AnnotationScene } from '../annotations/ui/scene.tsx';

const render = (type: string) =>
  renderToStaticMarkup(
    createElement(AnnotationScene, {
      items: [
        {
          el: { id: 'ok', type: 'sticky', index: 'a0', x: 0, y: 0, w: 100, h: 100, text: 'fine' },
        },
        { el: { id: 'x', type, index: 'a1', x: 0, y: 0 } as never },
      ],
      interactive: true,
      editingId: null,
      edit: null,
      pending: null,
      resolveAsset: (h: string) => h,
    })
  );

describe('hostile element types', () => {
  test.each([
    'constructor',
    'tostring',
    'valueof',
    'hasownproperty',
  ])('"%s" renders a placeholder and the rest of the board survives', (type) => {
    const html = render(type);
    expect(html).toContain('fine');
    expect(html).toContain('data-id="x"');
  });

  test('Object.prototype names are refused as element types', () => {
    expect(validateElement({ id: 'x', type: 'constructor', index: 'a0' }).ok).toBe(false);
  });
});
