// P8 stage C round 8 (14 ed-obj-multi): "Layers shows the same selection" — with three objects selected every one of
// their rows is lit, not only the first.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LayerRow } from '../client/inspector/layers.jsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const node = (id: string, index = 0) => ({ id, index, tag: 'div', label: id, children: [] });

describe('Layers mirrors a multi-selection', () => {
  test('the first object and every other selected one carry is-sel; an unselected row does not', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const rows = [node('headline'), node('sub'), node('see-work'), node('footer')];
    await act(async () =>
      root.render(
        <div role="tree">
          {rows.map((n) => (
            <LayerRow
              key={n.id}
              node={n as never}
              depth={0}
              selectedId="headline"
              selectedIndex={0}
              selectedAlso={[{ id: 'sub', index: 0 }, { id: 'see-work' }]}
              collapsed={new Set()}
              onToggle={() => {}}
              onSelect={() => {}}
              onHover={() => {}}
            />
          ))}
        </div>
      )
    );
    const lit = [...host.querySelectorAll('.is-sel')].map(
      (e) =>
        e.closest('[data-layer-key]')?.getAttribute('data-layer-key') ??
        e.getAttribute('data-layer-key')
    );
    expect(lit).toEqual(['headline:0', 'sub:0', 'see-work:0']);
  });
});
