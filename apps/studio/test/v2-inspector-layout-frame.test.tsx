// S2.11 — what a Frame adds in the inspector: Position › Place freely (an object that sits in an auto
// layout) and Layout › Advanced › Convert children to absolute position. Both run the registry action
// through the menu runner (the canvas's run-action lane), so the inspector owns no write of its own.
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
const sent: Array<Record<string, unknown>> = [];
beforeEach(async () => {
  sent.length = 0;
  const { menuRunner } = await import('../client/v2/shell/menu-runner.js');
  menuRunner.bind({}, { postToActiveCanvas: (m: Record<string, unknown>) => sent.push(m) });
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
const CARD = {
  id: 'apps',
  index: 0,
  file: FILE,
  tag: 'div',
  classes: '',
  selector: '[data-cd-id="apps"]',
  text: 'Small apps',
  bounds: { x: 96, y: 644, w: 400, h: 232 },
  worldW: 400,
  worldH: 232,
  dom_path: ['section', 'div'],
  authored: {} as Record<string, string>,
  computed: { display: 'block', position: 'static' } as Record<string, string>,
  customStyles: {},
  attrs: {},
  parentDisplay: 'flex',
  parentFlexDirection: 'row',
  artboardId: 'desktop',
};
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};

async function frame(el: Record<string, unknown> = {}) {
  await import('../client/v2/inspector/sections/index.js');
  // another file's afterAll may have emptied the (process-wide) registry
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
          selected: { ...CARD, ...el },
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
  return host;
}
const click = async (el: Element | null) => {
  await act(async () => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};

describe('Position › Place freely', () => {
  test('a card in a row: the button runs object.place-freely, and ← → is said', async () => {
    await frame();
    expect(q('insp-place-freely')).not.toBeNull();
    expect(q('insp-reorder-note')?.textContent).toContain('← → move it earlier or later');
    await click(q('insp-place-freely'));
    expect(sent).toEqual([{ dgn: 'run-action', v: 1, id: 'object.place-freely' }]);
  });

  test('an object already placed freely, or in no layout: no button', async () => {
    await frame({ authored: { position: 'absolute' }, computed: { position: 'absolute' } });
    expect(q('insp-place-freely')).toBeNull();
    document.body.innerHTML = '';
    await frame({ parentDisplay: 'block' });
    expect(q('insp-place-freely')).toBeNull();
  });

  test('a grid parent can place freely too, but has no ← → line', async () => {
    await frame({ parentDisplay: 'grid' });
    expect(q('insp-place-freely')).not.toBeNull();
    expect(q('insp-reorder-note')).toBeNull();
  });
});

// V2-8.5 c3 (14 ed-inspector · ed-lay-free): Convert lives in the folded Advanced at the inspector's foot, never
// inline under Layout ("Convert layout to absolute" + its note, above the CSS the frame writes).
describe('Advanced › Convert layout to absolute', () => {
  const FRAME = {
    id: 'services',
    selector: '[data-cd-id="services"]',
    authored: { display: 'flex', gap: 'var(--space-5)' },
    computed: { display: 'flex', 'flex-direction': 'row', gap: '24px', position: 'static' },
    parentDisplay: 'block',
  };
  const openFold = async () => {
    const { foldStore } = await import('../client/v2/fold/use-fold.js');
    foldStore.set('inspector', true);
  };

  test('not inline under Layout: with the fold closed there is no Convert on the card', async () => {
    await frame(FRAME);
    expect(q('insp-layout-convert')).toBeNull();
    expect(q('insp-layout-advanced')).toBeNull();
  });

  test('a frame laid out by flex offers it in the open fold, in the board’s words; it runs the registry action', async () => {
    await openFold();
    await frame(FRAME);
    const btn = q('insp-layout-convert');
    expect(btn?.textContent).toContain('Convert layout to absolute');
    expect(btn?.closest('[data-testid="adv-group-css"]')).not.toBeNull();
    expect(btn?.closest('[data-testid="insp-sec-layout"]')).toBeNull();
    expect(q('insp-layout-convert-note')?.textContent).toContain('⌘Z brings the layout back');
    await click(btn);
    expect(sent).toEqual([{ dgn: 'run-action', v: 1, id: 'layout.convert-to-absolute' }]);
  });

  test('a frame that arranges nothing has no Convert', async () => {
    await openFold();
    await frame({ ...FRAME, authored: {}, computed: { display: 'block' } });
    expect(q('insp-layout-convert')).toBeNull();
  });
});
