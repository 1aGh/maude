// r4 #15 - a stamp could not be selected, moved or deleted: the cluster drew no data-id/data-tool the
// layer's pointer path (findStrokeId) keys on, and 'stamp' was not a selectable stroke tool.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnnotationScene } from '../annotations/ui/scene.tsx';
import { stampElement } from '../annotations/ui/stamps.ts';
import { isSelectableStrokeTool } from '../annotations/ui/tool-state.ts';

const stamp = stampElement({ kind: 'yes', who: { name: 'Michal' }, x: 400, y: 300 });
const render = () =>
  renderToStaticMarkup(
    createElement(AnnotationScene, {
      items: [{ el: stamp }] as never,
      interactive: true,
      quiet: false,
      editingId: null,
      edit: null,
      pending: null,
      resolveAsset: (h: string) => h,
    })
  );

describe('r4 #15 a stamp is a selectable annotation', () => {
  test('its face carries the id and tool the pointer path selects by', () => {
    const html = render();
    expect(html).toContain(`data-id="${stamp.id}"`);
    expect(html).toContain('data-tool="stamp"');
  });
  test('stamp is a selectable stroke tool, like a sticky or a shape', () => {
    expect(isSelectableStrokeTool('stamp')).toBe(true);
    expect(isSelectableStrokeTool('sticky')).toBe(true);
    expect(isSelectableStrokeTool('nonsense')).toBe(false);
  });
});
