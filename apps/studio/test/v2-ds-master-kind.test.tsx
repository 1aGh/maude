// S10.10 (13 · ds-edit-master) — a component master of the Design system canvas in the inspector: the kind, the frame
// that draws only its block, Corners · Fill · Text · Height written as ONE waiting declaration patch on blur, nothing
// written for an unchanged or unusable value, "N changes waiting" with the way to the review, and a viewer who can
// look but not change. Real markup and registry; only fetch is faked (the writer is proven against the real routes
// and a real publish in ds-master-write.test.ts).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;

type Patch = { selector: string; prop: string; value: string };
const MODEL = (patches: Patch[] = []) => ({
  format: 'maude.ds-board',
  v: 1,
  system: 'studio',
  label: 'Studio',
  rootClass: 'studio',
  themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
  converted: true,
  tokens: [],
  typeRoles: [],
  stateRules: [],
  components: [
    {
      name: 'Button',
      label: 'Tlačítko',
      className: 'btn',
      variants: [
        { name: 'primary', class: 'btn--primary' },
        { name: 'ghost', class: 'btn--ghost' },
        { name: 'plain', class: null },
        { name: 'danger', class: null },
      ],
      sizes: [
        { name: 'sm', class: 'btn--sm' },
        { name: 'lg', class: 'btn--lg' },
      ],
      used: 34,
      pending: patches.length > 0,
      specimen: null,
      states: ['hover', 'active', 'focus', 'disabled'],
      look: {
        'border-radius': '2px',
        background: 'var(--bg-3)',
        color: 'var(--fg-0)',
        height: '32px',
      },
      patches,
    },
    {
      name: 'Orphan',
      label: 'Orphan',
      className: null,
      variants: [],
      sizes: [],
      used: 0,
      pending: false,
      specimen: null,
      states: [],
      look: {},
      patches: [],
    },
  ],
  logos: [],
  pendingCount: patches.length,
  canvases: 34,
});

let board: ReturnType<typeof MODEL> = MODEL();
const posts: Array<Record<string, unknown>> = [];
let postStatus = 200;
let postBody: unknown = { action: 'pending' };

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.startsWith('/_api/ds/board')) return new Response(JSON.stringify(board), { status: 200 });
    if (u === '/_api/ds/pending' && init?.method === 'POST') {
      const body = JSON.parse(init.body ?? '{}');
      posts.push(body);
      if (postStatus === 200) {
        // what the server would now hold: the patch waits
        const next: Patch[] = [];
        for (const sels of Object.values(body.components ?? {}))
          for (const [selector, props] of Object.entries(sels as object))
            for (const [prop, e] of Object.entries(props as object))
              next.push({ selector, prop, value: (e as { value: string }).value });
        board = MODEL([...board.components[0].patches, ...next]);
      }
      return new Response(JSON.stringify(postBody), { status: postStatus });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
});
afterAll(async () => {
  const { offDsMaster } = await import('../client/v2/ds/kinds/master.jsx');
  offDsMaster();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  board = MODEL();
  posts.length = 0;
  postStatus = 200;
  postBody = { action: 'pending' };
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
  const { registerDsMasterKind } = await import('../client/v2/ds/kinds/master.jsx');
  registerDsMasterKind();
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
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
const propsOf = (el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  return (el as unknown as Record<string, Record<string, (ev: unknown) => void>>)[key];
};
const type = async (el: Element | null, value: string) => {
  const e = must(el, 'input') as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set?.call(e, value);
    propsOf(e).onChange({ target: e, currentTarget: e });
  });
};
const blur = async (el: Element | null) => {
  const e = must(el, 'input');
  await act(async () => {
    propsOf(e).onBlur({ target: e, currentTarget: e });
  });
  await settle();
};
const click = async (el: Element | null) => {
  const e = must(el, 'button');
  await act(async () => {
    e.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};

const FILE = '.design/system/studio/design-system.tsx';
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'studio', path: 'system/studio' }],
  defaultDesignSystem: 'studio',
};
const tile = (name: string, label: string) => ({
  tag: 'div',
  classes: 'ds-m',
  selector: `[data-ds-master="${name}"]`,
  text: label,
  artboardId: 'ds-components',
  index: 0,
  file: FILE,
  dom_path: ['article', 'div', 'div.ds-m'],
  bounds: { x: 10, y: 10, w: 300, h: 120 },
  authored: {},
  computed: {},
  customStyles: {},
  attrs: { 'data-ds-master': name, 'data-ds-label': label },
});
const BUTTON = tile('Button', 'Tlačítko');

async function frame(selected: unknown, over: Record<string, unknown> = {}) {
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  return mount(
    <InspectorFrame
      {...({
        selected,
        layersTree: { artboardId: 'ds-components', nodes: [] },
        cfg: CFG,
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
        onRunAction: () => {},
        ...over,
      } as never)}
    />
  );
}

describe('the kind', () => {
  test('a master tile is a Component; an empty or hostile name, and several tiles, are not', async () => {
    const { resolveKind, kindChipOf } = await import('../client/v2/inspector/kinds/index.js');
    expect(resolveKind(BUTTON).id).toBe('ds-master');
    expect(resolveKind(BUTTON).bare).toBe(true);
    expect(kindChipOf(BUTTON)).toBe('Component');
    expect(resolveKind({ ...BUTTON, attrs: {} }).id).not.toBe('ds-master');
    expect(resolveKind({ ...BUTTON, attrs: { 'data-ds-master': 'x"] , *' } }).id).not.toBe(
      'ds-master'
    );
    expect(resolveKind([BUTTON, tile('Card', 'Card')]).id).toBe('multi');
  });

  test('the title is the designer’s label, not the tile’s text', async () => {
    const { titleOf } = await import('../client/v2/inspector/model.js');
    expect(titleOf({ ...BUTTON, text: 'primary ghost plain' }, null)).toBe('Tlačítko');
  });
});

describe('the frame draws only the master block', () => {
  test('Corners · Fill · Text · Height with the file’s values, and where it is used', async () => {
    const host = await frame(BUTTON);
    expect(q(host, 'inspector-frame')?.getAttribute('data-kind')).toBe('ds-master');
    expect(q(host, 'inspector-title')?.textContent).toBe('Tlačítko');
    expect(q(host, 'insp-sec-ds-master')?.getAttribute('data-master')).toBe('Button');
    expect(q(host, 'insp-sec-position')).toBeNull();
    expect((q(host, 'ds-master-corners') as HTMLInputElement).value).toBe('2px');
    expect((q(host, 'ds-master-fill') as HTMLInputElement).value).toBe('var(--bg-3)');
    expect((q(host, 'ds-master-text') as HTMLInputElement).value).toBe('var(--fg-0)');
    expect((q(host, 'ds-master-height') as HTMLInputElement).value).toBe('32px');
    expect(q(host, 'ds-master-used')?.textContent).toContain(
      'Used in 34 canvases · 4 variants · 4 states · 2 sizes'
    );
    expect(q(host, 'ds-master-waiting')).toBeNull();
  });

  test('Corners 2 → 6: one waiting patch in the master’s class, then "1 change waiting"', async () => {
    const host = await frame(BUTTON);
    await type(q(host, 'ds-master-corners'), '6');
    await blur(q(host, 'ds-master-corners'));
    expect(posts).toEqual([
      { ds: 'studio', components: { Button: { '.btn': { 'border-radius': { value: '6px' } } } } },
    ]);
    // the panel read the system again: it shows the waiting value, flagged, with the way to the review
    expect((q(host, 'ds-master-corners') as HTMLInputElement).value).toBe('6px');
    expect(q(host, 'ds-master-edited')?.textContent).toBe('As edited');
    expect(q(host, 'ds-master-waiting')?.textContent).toContain('1 change waiting.');
  });

  test('"Update canvases…" asks the shell for the review (ds.publish) of this system', async () => {
    board = MODEL([{ selector: '.btn', prop: 'border-radius', value: '6px' }]);
    const asked: Array<[string, unknown]> = [];
    const host = await frame(BUTTON, {
      onShellAction: (id: string, p: unknown) => asked.push([id, p]),
    });
    await click(q(host, 'ds-master-update'));
    expect(asked).toEqual([['ds.publish', { ds: 'studio' }]]);
  });

  test('an unchanged value writes nothing; an unusable one says so and writes nothing', async () => {
    const host = await frame(BUTTON);
    await type(q(host, 'ds-master-corners'), '2px');
    await blur(q(host, 'ds-master-corners'));
    await type(q(host, 'ds-master-fill'), 'red; } body { display: none');
    await blur(q(host, 'ds-master-fill'));
    expect(posts).toEqual([]);
    expect(q(host, 'ds-master-note')?.textContent).toBe('That isn’t a value this can take.');
  });

  test('a refusal from the server is said in words and the panel still shows what is saved', async () => {
    postStatus = 403;
    postBody = { code: 'forbidden' };
    const host = await frame(BUTTON);
    await type(q(host, 'ds-master-height'), '40');
    await blur(q(host, 'ds-master-height'));
    expect(q(host, 'ds-master-note')?.textContent).toBe('You can look here; ask to edit.');
    expect((q(host, 'ds-master-height') as HTMLInputElement).value).toBe('32px');
  });

  test('a viewer can look but the boxes are disabled', async () => {
    const host = await frame(BUTTON, { editable: false });
    expect((q(host, 'ds-master-corners') as HTMLInputElement).disabled).toBe(true);
  });

  test('a component with no class says so and cannot be edited', async () => {
    const host = await frame(tile('Orphan', 'Orphan'));
    expect(q(host, 'ds-master-noclass')?.textContent).toBe(
      'This component has no style to change.'
    );
    expect((q(host, 'ds-master-corners') as HTMLInputElement).disabled).toBe(true);
  });
});
