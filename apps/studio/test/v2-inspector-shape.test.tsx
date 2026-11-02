// S2.13 (ed-shape) — a drawn shape in the inspector: the "Shape" chip, the Kind row, and the sections every box
// already has (Corners, Fill, Border, Effects) applying to it. A Frame (no `data-shape`) stays a Frame.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) =>
    String(url).endsWith('.css')
      ? new Response(':root{--radius-md:8px;--shadow-resting:0 1px 2px #000;}', { status: 200 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
});
afterAll(async () => {
  const { unregisterSections } = await import('../client/v2/inspector/sections/index.js');
  unregisterSections();
  for (const off of reregistered.splice(0)) off();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const FILE = '.design/ui/Post.tsx';
const SHAPE = {
  id: 'rectangle',
  index: 0,
  file: FILE,
  tag: 'div',
  classes: '',
  selector: '[data-cd-id="rectangle"]',
  text: '',
  bounds: { x: 24, y: 24, w: 216, h: 216 },
  worldW: 216,
  worldH: 216,
  dom_path: ['div'],
  authored: { 'border-radius': '8px', background: 'var(--accent)' } as Record<string, string>,
  computed: { display: 'block', position: 'absolute' } as Record<string, string>,
  customStyles: {},
  attrs: { 'data-shape': 'rectangle' } as Record<string, string>,
  parentDisplay: 'block',
  parentFlexDirection: 'row',
  artboardId: 'post',
};
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};

// The registry is process-wide and another test file's afterAll may have emptied it (bun runs the files in one
// process): evaluate the section files again, under a new URL, so they register afresh.
const reregistered: Array<() => void> = [];
let generation = 0;
async function ensureSections() {
  await import('../client/v2/inspector/sections/index.js');
  const { slotsFor } = await import('../client/v2/inspector/slots.js');
  if (slotsFor('corners', 'shape').length) return;
  generation += 1;
  for (const f of ['sections/fill', 'sections/corners', 'sections/border', 'sections/effects']) {
    const mod = (await import(`../client/v2/inspector/${f}.jsx?s213=${generation}`)) as Record<
      string,
      unknown
    >;
    for (const [k, v] of Object.entries(mod))
      if (/^off[A-Z]/.test(k) && typeof v === 'function') reregistered.push(v as () => void);
  }
}

async function frame(el: Record<string, unknown> = {}) {
  await ensureSections();
  // another file's afterAll may have emptied the (process-wide) registry
  (await import('../client/v2/inspector/kinds/shape.jsx')).registerShapeKind();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <InspectorFrame
        {...({
          selected: { ...SHAPE, ...el },
          layersTree: { artboardId: 'post', nodes: [] },
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

describe('a drawn shape', () => {
  test('wears the Shape chip and says which kind it is', async () => {
    await frame({ attrs: { 'data-shape': 'ellipse' } });
    expect(q('inspector-kind')?.textContent).toBe('Shape');
    expect(q('inspector-frame')?.getAttribute('data-kind')).toBe('shape');
    expect(q('insp-shape-kind')?.textContent).toBe('Ellipse');
  });

  test('a kind this build does not know still reads "Shape"', async () => {
    await frame({ attrs: { 'data-shape': 'star' } });
    expect(q('insp-shape-kind')?.textContent).toBe('Shape');
  });

  test('has Corners, Fill, Border and Effects like every box', async () => {
    await frame();
    for (const id of ['corners', 'fill', 'border', 'effects'])
      expect(q(`insp-sec-${id}`), id).not.toBeNull();
  });

  test('a frame (no data-shape) stays a Frame and has no Kind row', async () => {
    await frame({ attrs: {}, id: 'frame' });
    expect(q('inspector-kind')?.textContent).toBe('Frame');
    expect(q('insp-shape-kind')).toBeNull();
  });
});
