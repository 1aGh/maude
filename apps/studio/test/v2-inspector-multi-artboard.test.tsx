// S2.9 (artboard ed-ab-tidy) — the inspector over several artboards: "4 artboards", Preset · Size · Position as the
// boards share them or "Mixed", Background the same way, "Changes go to all 4." Real markup, real registry (seated
// explicitly: the registry is process-wide and other inspector tests unregister theirs).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
});
const seated: Array<() => void> = [];
afterAll(() => {
  for (const off of seated.splice(0)) off();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const FILE = '.design/ui/Combine.tsx';
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};
const board = (id: string, x: number, y: number, bg = 'var(--green)') => ({
  selector: `[data-dc-screen="${id}"]`,
  tag: 'article',
  artboardId: id,
  file: FILE,
  attrs: { 'data-dc-kind': 'digital', 'data-dc-fixed': 'true', 'data-dc-bg': bg } as Record<
    string,
    string
  >,
  bounds: { x: 0, y: 0, w: 216, h: 384 },
  worldW: 1080,
  worldH: 1920,
  geometry: { x, y, w: 1080, h: 1920, parentW: 0, parentH: 0 },
});
const FOUR = [
  board('a', 750, 980),
  board('b', 1980, 1020),
  board('c', 3200, 820, 'var(--ink)'),
  board('d', 4500, 1110),
];

async function frame(selected: unknown) {
  const mab = await import('../client/v2/inspector/kinds/multi-artboard.jsx');
  mab.offMultiArtboard();
  seated.push(mab.registerMultiArtboardSlots());
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <InspectorFrame
        {...({
          selected,
          layersTree: null,
          cfg: CFG,
          canvasFile: FILE,
          onOptimistic: () => {},
          onRecordEdit: () => {},
          onReplaceMedia: () => {},
          onUndoRedo: () => {},
        } as never)}
      />
    )
  );
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('the model', () => {
  test('a field is the value the boards share, or Mixed', async () => {
    const { multiArtboardModel } = await import('../client/v2/inspector/kinds/multi-artboard.jsx');
    const m = multiArtboardModel(FOUR);
    expect(m.count).toBe(4);
    expect(m.w).toEqual({ mixed: false, value: 1080 });
    expect(m.h).toEqual({ mixed: false, value: 1920 });
    expect(m.x.mixed).toBe(true);
    expect(m.y.mixed).toBe(true);
    expect(m.bg.mixed).toBe(true);
    // after "align top" the y is shared
    const aligned = multiArtboardModel(
      FOUR.map((b) => ({ ...b, geometry: { ...b.geometry, y: 980 } }))
    );
    expect(aligned.y).toEqual({ mixed: false, value: 980 });
  });

  test('the title and the chip: "4 artboards" · Fixed size; boards of different kinds are "2 kinds"', async () => {
    const { titleOf } = await import('../client/v2/inspector/model.js');
    const { kindChipOf, resolveKind } = await import('../client/v2/inspector/kinds/index.js');
    expect(titleOf(FOUR, null)).toBe('4 artboards');
    expect(resolveKind(FOUR).id).toBe('multi-artboard');
    expect(kindChipOf(FOUR)).toBe('Fixed size');
    const web = { ...FOUR[0], attrs: { ...FOUR[0]?.attrs, 'data-dc-kind': 'web' } };
    expect(kindChipOf([web, FOUR[1]])).toBe('2 kinds'); // S7.21 (08 ak-mixed-select)
    // objects stay "N objects" and Mixed; a mix of a board and an object is still the objects' inspector
    const obj = { selector: '[data-cd-id="x"]', tag: 'div', id: 'x', artboardId: 'a', attrs: {} };
    expect(titleOf([obj, { ...obj, id: 'y' }], null)).toBe('2 objects');
    expect(resolveKind([FOUR[0], obj]).id).toBe('multi');
  });
});

describe('the inspector over four artboards', () => {
  test('"4 artboards", Mixed position, the shared size, the closing line', async () => {
    const host = await frame(FOUR);
    expect(q(host, 'inspector-title')?.textContent).toBe('4 artboards');
    expect(q(host, 'inspector-kind')?.textContent).toBe('Fixed size');
    expect(q(host, 'insp-mab-x')?.textContent).toBe('Mixed');
    expect(q(host, 'insp-mab-y')?.textContent).toBe('Mixed');
    expect(q(host, 'insp-mab-w')?.textContent).toBe('1080');
    expect(q(host, 'insp-mab-h')?.textContent).toBe('1920');
    expect(q(host, 'insp-mab-bg')?.textContent).toBe('Mixed');
    expect(q(host, 'insp-mab-note')?.textContent).toBe('Changes go to all 4.');
  });
});
