// S2.14 (ed-pen) — a Pen path in the inspector: the "Pen · 4 points" chip, Stroke with its Ends row, and Combine shapes
// ("Two or more": greyed for one, live for several; one click = one run-action the canvas turns into ONE edit-op).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
const posts: Array<Record<string, unknown>> = [];
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith('.css'))
      return new Response(':root{--radius-md:8px;--accent:#000;}', { status: 200 });
    if (init?.body) {
      try {
        posts.push(JSON.parse(init.body));
      } catch {
        /* not a JSON write */
      }
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
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
  posts.length = 0;
});
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const FILE = '.design/ui/Post.tsx';
const base = (
  id: string,
  attrs: Record<string, string>,
  authored: Record<string, string> = {}
) => ({
  id,
  index: 0,
  file: FILE,
  tag: attrs['data-shape'] === 'path' ? 'svg' : 'div',
  classes: '',
  selector: `[data-cd-id="${id}"]`,
  text: '',
  bounds: { x: 24, y: 24, w: 216, h: 216 },
  worldW: 216,
  worldH: 216,
  dom_path: ['div'],
  authored,
  computed: { display: 'block', position: 'absolute' } as Record<string, string>,
  customStyles: {},
  attrs,
  parentDisplay: 'block',
  parentFlexDirection: 'row',
  artboardId: 'post',
});
const PATH = base(
  'path',
  { 'data-shape': 'path', 'data-dc-pen-points': '4' },
  { stroke: 'var(--accent)', 'stroke-width': '4px', 'stroke-linecap': 'round' }
);
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
  if (slotsFor('border', 'path').length) return;
  generation += 1;
  for (const f of ['sections/fill', 'sections/corners', 'sections/border', 'sections/effects']) {
    const mod = (await import(`../client/v2/inspector/${f}.jsx?s214=${generation}`)) as Record<
      string,
      unknown
    >;
    for (const [k, v] of Object.entries(mod))
      if (/^off[A-Z]/.test(k) && typeof v === 'function') reregistered.push(v as () => void);
  }
}

async function frame(selected: unknown, onRunAction: (m: unknown) => void = () => {}) {
  await ensureSections();
  const { registerShapeKind } = await import('../client/v2/inspector/kinds/shape.jsx');
  registerShapeKind();
  const { registerPathKind } = await import('../client/v2/inspector/kinds/path.jsx');
  registerPathKind();
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
          layersTree: { artboardId: 'post', nodes: [] },
          cfg: CFG,
          canvasFile: FILE,
          onOptimistic: () => {},
          onRecordEdit: () => {},
          onReplaceMedia: () => {},
          onUndoRedo: () => {},
          onRunAction,
        } as never)}
      />
    )
  );
  await settle();
  return host;
}

describe('a Pen path', () => {
  test('wears the "Pen · 4 points" chip; a path the canvas has not counted is just "Path"', async () => {
    await frame(PATH);
    expect(q('inspector-kind')?.textContent).toBe('Pen · 4 points');
    expect(q('inspector-frame')?.getAttribute('data-kind')).toBe('path');
    await act(async () => roots.pop()?.unmount());
    document.body.innerHTML = '';
    await frame({ ...PATH, attrs: { 'data-shape': 'path' } });
    expect(q('inspector-kind')?.textContent).toBe('Path');
  });

  test('Stroke has an Ends row — Round or Flat — only while there is a stroke; Flat writes butt', async () => {
    await frame(PATH);
    expect(q('insp-row-path-ends')).not.toBeNull();
    const flat = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="insp-ctl-path-ends"] button'),
    ].find((b) => b.textContent === 'Flat');
    expect(flat).toBeDefined();
    await act(async () => flat?.click());
    await settle();
    expect(posts.some((p) => p.property === 'stroke-linecap' && p.value === 'butt')).toBe(true);
    await act(async () => roots.pop()?.unmount());
    document.body.innerHTML = '';
    await frame(base('path', { 'data-shape': 'path' }, {}));
    expect(q('insp-row-path-ends')).toBeNull();
  });

  test('Combine shapes is greyed for one object: "Two or more"', async () => {
    const sent: unknown[] = [];
    await frame(PATH, (m) => sent.push(m));
    expect(q('insp-sec-combine')).not.toBeNull();
    expect(q('insp-row-combine')?.getAttribute('data-dim')).toBe('true');
    for (const kind of ['union', 'subtract', 'intersect', 'exclude'])
      expect((q(`insp-combine-${kind}`) as HTMLButtonElement).disabled, kind).toBe(true);
    await act(async () => q('insp-combine-union')?.click());
    expect(sent).toEqual([]);
  });

  test('several shapes light it: one click asks the canvas for ONE shape.combine.<kind>', async () => {
    const sent: unknown[] = [];
    const a = base('rectangle', { 'data-shape': 'rectangle' });
    const b = base('ellipse', { 'data-shape': 'ellipse' });
    await frame([a, b], (m) => sent.push(m));
    expect(q('insp-sec-combine')).not.toBeNull();
    expect(q('insp-row-combine')?.getAttribute('data-dim')).toBeNull();
    expect((q('insp-combine-subtract') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => q('insp-combine-subtract')?.click());
    expect(sent).toEqual([{ dgn: 'run-action', v: 1, id: 'shape.combine.subtract' }]);
  });

  test('a frame among them, or a line, keeps it greyed; a lone frame has no Combine section', async () => {
    const sent: unknown[] = [];
    const a = base('rectangle', { 'data-shape': 'rectangle' });
    const frameEl = base('hero', {});
    await frame([a, frameEl], (m) => sent.push(m));
    expect((q('insp-combine-union') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => roots.pop()?.unmount());
    document.body.innerHTML = '';
    await frame([a, base('line', { 'data-shape': 'line' })], (m) => sent.push(m));
    expect((q('insp-combine-union') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => roots.pop()?.unmount());
    document.body.innerHTML = '';
    await frame(frameEl);
    expect(q('insp-sec-combine')).toBeNull();
    expect(sent).toEqual([]);
  });
});
