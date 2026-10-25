// P8 stage C round 10 (14 ed-lay-auto): the Layout card of an auto-layout frame ends on one line saying what the
// frame lays out — "3 frames, each Fills the width." (the selection's `kids`, read in the canvas).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) =>
    String(url).endsWith('.css')
      ? new Response(':root{--space-5:24px;}', { status: 200 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
});
afterAll(async () => {
  const { unregisterSections } = await import('../client/v2/inspector/sections/index.js');
  unregisterSections();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const FILE = '.design/ui/Homepage.tsx';
const SERVICES = {
  id: 'services',
  index: 0,
  file: FILE,
  tag: 'div',
  classes: '',
  selector: '[data-cd-id="services"]',
  text: 'Product design Brand systems Small apps',
  bounds: { x: 96, y: 644, w: 1296, h: 232 },
  worldW: 1296,
  worldH: 232,
  dom_path: ['section'],
  authored: { display: 'flex', gap: '24px' } as Record<string, string>,
  computed: { display: 'flex', position: 'static' } as Record<string, string>,
  customStyles: {},
  attrs: {},
  parentDisplay: 'block',
  parentFlexDirection: '',
  artboardId: 'desktop',
};
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};

async function frame(el: Record<string, unknown> = {}) {
  await import('../client/v2/inspector/sections/index.js');
  (await import('../client/v2/inspector/kinds/frame.jsx')).registerFrameSlots();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <InspectorFrame
        {...({
          selected: { ...SERVICES, ...el },
          layersTree: { artboardId: 'desktop', nodes: [] },
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
  await settle();
}

describe('14 ed-lay-auto: the Layout card names what the frame lays out', () => {
  test('an auto-layout frame of three growing cards: "3 frames, each Fills the width."', async () => {
    await frame({ kids: { count: 3, tag: 'div', width: 'fill' } });
    expect(q('insp-layout-kids')?.textContent).toBe('3 frames, each Fills the width.');
  });
  test('a frame whose children are not read (an old canvas) or a frame with no layout: no line', async () => {
    await frame();
    expect(q('insp-layout-kids')).toBeNull();
    document.body.innerHTML = '';
    await frame({
      authored: {},
      computed: { display: 'block' },
      kids: { count: 3, tag: 'div', width: 'fill' },
    });
    expect(q('insp-layout-kids')).toBeNull();
  });
});
