// Scrub-to-change in the Inspector (R3, Michal: "I try to grab the icon or label and drag to change the width, but it
// doesn't work"). Real markup, real registry, real number fields; only fetch is faked.
//   · pointer-down on a number row's LABEL or its leading ICON, then a horizontal drag changes the value: 1 unit per px,
//     Shift ×10, Alt ×0.1, clamped, integers where the field is whole;
//   · the live element follows (preview), nothing is written until the release, then ONE write per property (so one
//     undo step), and Esc puts everything back;
//   · a click that never moves focuses the field; the ew-resize affordance exists only where a drag works.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
type Post = { url: string; body: Record<string, unknown> };
const posts: Post[] = [];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith('.css')) return new Response(':root{}', { status: 200 });
    if (init?.body) posts.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, previous: null }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(async () => {
  const { unregisterSections } = await import('../client/v2/inspector/sections/index.js');
  unregisterSections();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  posts.length = 0;
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await settle();
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const must = (el: Element | null, what: string) => {
  if (!el) throw new Error(`missing ${what}`);
  return el as HTMLElement;
};
const input = (host: HTMLElement, id: string) =>
  must(q(host, id)?.querySelector('input') ?? null, `input in ${id}`) as HTMLInputElement;

const FILE = '.design/ui/Homepage.tsx';
const BUTTON = {
  id: 'book-call',
  index: 0,
  file: FILE,
  tag: 'button',
  classes: 'cta',
  selector: 'button.cta',
  text: 'Book a call',
  bounds: { x: 1220, y: 22, w: 148, h: 44 },
  worldW: 148,
  worldH: 44,
  dom_path: ['div.nav', 'button.cta'],
  authored: { display: 'inline-flex', opacity: '0.5', 'border-radius': '8px' } as Record<
    string,
    string
  >,
  computed: { display: 'inline-flex', 'flex-direction': 'row', gap: '8px' } as Record<
    string,
    string
  >,
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
// a free-placed frame: it has its own X · Y and Rotation
const PLACED = {
  authored: {
    position: 'absolute',
    left: '10px',
    top: '20px',
    'border-radius': '8px',
    transform: 'rotate(20deg)',
  },
  computed: { position: 'absolute', display: 'block' },
  parentDisplay: 'block',
  parentFlexDirection: undefined,
  tag: 'div',
};
const recorded: Array<Record<string, unknown>> = [];
const optimistic: Array<Record<string, unknown>> = [];

async function frame(el: Record<string, unknown> = {}) {
  await import('../client/v2/inspector/sections/index.js');
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  recorded.length = 0;
  optimistic.length = 0;
  return mount(
    <InspectorFrame
      {...({
        selected: { ...BUTTON, ...el },
        layersTree: { artboardId: 'desktop', nodes: [] },
        cfg: CFG,
        canvasFile: FILE,
        onOptimistic: (m: Record<string, unknown>) => optimistic.push(m),
        onRecordEdit: (m: Record<string, unknown>) => recorded.push(m),
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
      } as never)}
    />
  );
}

// ── the pointer ──────────────────────────────────────────────────────────────────────────────────────────
type Mods = { shiftKey?: boolean; altKey?: boolean };
const ptr = (type: string, x: number, mods: Mods = {}) =>
  new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: 10,
    ...mods,
  });
const down = (el: Element, x: number) =>
  act(async () => {
    el.dispatchEvent(ptr('pointerdown', x));
  });
const move = (x: number, mods?: Mods) =>
  act(async () => {
    document.dispatchEvent(ptr('pointermove', x, mods));
  });
const up = async (x: number) => {
  await act(async () => {
    document.dispatchEvent(ptr('pointerup', x));
  });
  await settle();
};
const esc = () =>
  act(async () => {
    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

const label = (host: HTMLElement, row: string) =>
  must(q(host, `insp-row-${row}`)?.querySelector('.insp-row-k') ?? null, `label of ${row}`);
const handle = (host: HTMLElement, id: string) =>
  must(q(host, id)?.querySelector('[data-testid="insp-scrub-handle"]') ?? null, `handle in ${id}`);
const edits = () => posts.filter((p) => p.url === '/_api/edit-css');

describe('scrub on the row label', () => {
  test('dragging the Width label 30px right makes it 30 wider, live, and writes once on release', async () => {
    const host = await frame();
    const w = input(host, 'insp-num-width');
    expect(w.value).toBe('148');
    await down(label(host, 'width'), 100);
    await move(130);
    // preview: the field and the live element follow; the file is untouched
    expect(w.value).toBe('178');
    expect(optimistic.at(-1)).toMatchObject({ id: 'book-call', prop: 'width', value: '178px' });
    expect(edits()).toEqual([]);
    await up(130);
    // the whole drag is ONE write for the property: one undo entry
    expect(edits().length).toBe(1);
    expect(edits()[0].body).toMatchObject({ property: 'width', value: '178px' });
    expect(recorded.filter((r) => r.key === 'width').length).toBe(1);
  });

  test('many moves, still one write: nothing goes to the file per pixel', async () => {
    const host = await frame();
    await down(label(host, 'width'), 100);
    for (let x = 101; x <= 140; x += 3) await move(x);
    await up(140);
    expect(edits().length).toBe(1);
    expect(edits()[0].body.value).toBe('188px');
  });

  test('Shift makes it ×10, Alt ×0.1 (whole numbers stay whole)', async () => {
    const host = await frame();
    const w = input(host, 'insp-num-width');
    await down(label(host, 'width'), 100);
    await move(105, { shiftKey: true });
    expect(w.value).toBe('198'); // 148 + 5 × 10
    await move(120, { altKey: true });
    expect(w.value).toBe('150'); // 148 + 20 × 0.1 = 150
    await up(120);
    expect(edits()[0].body.value).toBe('150px');
  });

  test('it stops at the field’s minimum', async () => {
    const host = await frame();
    const w = input(host, 'insp-num-width');
    await down(label(host, 'width'), 400);
    await move(100);
    expect(w.value).toBe('0');
    await up(100);
    expect(edits()[0].body.value).toBe('0');
  });

  test('Opacity stops at 100 and counts in whole percent', async () => {
    const host = await frame();
    const o = input(host, 'insp-num-opacity');
    expect(o.value).toBe('50 %');
    await down(label(host, 'opacity'), 100);
    await move(400);
    expect(o.value).toBe('100 %');
    await move(110);
    expect(o.value).toBe('60 %');
    await up(110);
    expect(edits().length).toBe(1);
    expect(edits()[0].body).toMatchObject({ property: 'opacity', value: '0.6' });
  });

  test('Esc during the drag puts the value back, undoes the preview and writes nothing', async () => {
    const host = await frame();
    const w = input(host, 'insp-num-width');
    await down(label(host, 'width'), 100);
    await move(140);
    expect(w.value).toBe('188');
    await esc();
    expect(w.value).toBe('148');
    // the live element is told to drop the width it was shown
    expect(optimistic.at(-1)).toMatchObject({ prop: 'width', value: null });
    // the pointer coming up afterwards does not commit
    await up(140);
    expect(edits()).toEqual([]);
    expect(recorded).toEqual([]);
    // and a later drag still works (the cancelled one left nothing behind)
    await down(label(host, 'width'), 100);
    await move(110);
    await up(110);
    expect(edits()[0].body.value).toBe('158px');
  });

  test('a click that never moves focuses the field and writes nothing', async () => {
    const host = await frame();
    const w = input(host, 'insp-num-width');
    await down(label(host, 'width'), 100);
    await move(101);
    await up(101);
    expect(document.activeElement).toBe(w);
    expect(edits()).toEqual([]);
  });

  test('a corner radius scrubs from its label too', async () => {
    const host = await frame(PLACED);
    const r = must(q(host, 'insp-num-corners'), 'radius input') as HTMLInputElement;
    expect(r.value).toBe('8');
    await down(label(host, 'corners'), 100);
    await move(104);
    expect(r.value).toBe('12');
    expect(optimistic).toContainEqual(
      expect.objectContaining({ prop: 'border-radius', value: '12px' })
    );
    await up(104);
    expect(edits().map((e) => e.body)).toContainEqual(
      expect.objectContaining({ property: 'border-radius', value: '12px' })
    );
    const props = edits().map((e) => e.body.property);
    expect(new Set(props).size).toBe(props.length);
  });
});

describe('scrub on the icon', () => {
  test('the rotation icon drags the angle, Shift ×10, and it writes the transform once', async () => {
    const host = await frame(PLACED);
    const rot = input(host, 'insp-num-rotation');
    await down(handle(host, 'insp-num-rotation'), 100);
    await move(115, { shiftKey: true });
    expect(rot.value).toBe('170°'); // 20° + 15px × 10
    await up(115);
    // one write per property the angle owns — never one per pixel
    const props = edits().map((e) => e.body.property);
    expect(props).toContain('transform');
    expect(new Set(props).size).toBe(props.length);
  });
});

describe('the affordance is where the drag is', () => {
  test('a one-field row’s label shows ew-resize; a two-field row keeps a plain label and scrubs from the icons', async () => {
    const host = await frame(PLACED);
    expect(label(host, 'width').getAttribute('data-scrub')).toBe('true');
    expect(label(host, 'opacity').getAttribute('data-scrub')).toBe('true');
    // X · Y has two fields: "which one?" has no answer, so the label does not pretend
    expect(label(host, 'xy').getAttribute('data-scrub')).toBeNull();
  });

  test('an object that cannot be written (no id) has no scrub handle and no ew-resize label', async () => {
    const host = await frame({
      ...PLACED,
      id: undefined,
      selector: 'div.x',
      artboardId: undefined,
    });
    expect(label(host, 'width').getAttribute('data-scrub')).toBeNull();
    expect(
      q(host, 'insp-num-rotation')?.querySelector('[data-testid="insp-scrub-handle"]') ?? null
    ).toBe(null);
  });
});

describe('nothing is switched off any more', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.jsx$/.test(n)) out.push(p);
    }
    return out;
  };
  test('no Inspector number field passes scrub={false}', () => {
    const root = join(import.meta.dir, '..', 'client', 'v2', 'inspector');
    const hits = walk(root).filter((f) => readFileSync(f, 'utf8').includes('scrub={false}'));
    expect(hits).toEqual([]);
  });
});
