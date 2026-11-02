// S2.17 (ed-comp-instance) — an instance's blocks in the inspector frame: the kind chip, Component · Variant,
// Content (Text · Fill with the "Changed here" dot), "2 changes from Tlačítko." + Reset, Main component
// (Go to · Detach). Real markup and registry; only fetch is faked. Every change is ONE run-action asked of
// the canvas (the canvas measures what only it can and the studio writes the edit-op); nothing is written here.
// "Update … for every canvas…" and "Go to …" are S10's entries: hidden until the registry has their ids.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
const asked: string[] = [];
let answer: Record<string, unknown> | null = null;

const INFO = {
  component: 'Button',
  label: 'Tlačítko',
  wrapper: false,
  variant: 'primary',
  variants: [
    { key: 'primary', label: 'Primary' },
    { key: 'outline', label: 'Outline' },
  ],
  swappable: [
    { name: 'Button', label: 'Tlačítko' },
    { name: 'Chip', label: 'Štítek' },
  ],
  holdsText: true,
  text: 'REGISTRUJ SE',
  defaultText: 'Button',
  textInCode: false,
  overrides: { text: true, fill: true, props: ['background'], count: 2 },
  repeats: false,
};

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.startsWith('/_api/edit-instance')) {
      asked.push(u);
      return new Response(JSON.stringify({ ok: true, instance: answer }), { status: 200 });
    }
    if (u.endsWith('.css')) return new Response(':root{--accent:#f60;}', { status: 200 });
    return new Response(JSON.stringify({ ok: true, previous: null }), { status: 200 });
  }) as unknown as typeof fetch;
});

// The slot/kind registries are process-wide and other files rely on their state: this file registers no
// sections (the instance blocks need none) and takes back the one kind it registers.
afterAll(async () => {
  const { offInstance } = await import('../client/v2/inspector/kinds/instance.jsx');
  offInstance();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  asked.length = 0;
  answer = { ...INFO };
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
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
const click = async (el: Element | null, what = 'element') => {
  const e = must(el, what);
  await act(async () => {
    e.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
// a dispatched `input` event does not reach React's onChange under happy-dom: call the handler React attached
const type = async (el: Element | null, value: string) => {
  const e = must(el, 'input') as HTMLInputElement;
  const propsKey = Object.keys(e).find((k) => k.startsWith('__reactProps$')) as string;
  const p = (e as unknown as Record<string, { onChange: (ev: unknown) => void }>)[propsKey];
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set?.call(e, value);
    p?.onChange({ target: e, currentTarget: e });
  });
};

const FILE = '.design/ui/Home.tsx';
const REF = { artboard: 'desktop', element: 'cta' };
const BUTTON = {
  id: 'cta',
  index: 0,
  file: FILE,
  tag: 'button',
  classes: 'btn btn--primary',
  selector: '[data-dc-screen="desktop"] [data-cd-id="cta"]',
  text: 'REGISTRUJ SE',
  bounds: { x: 100, y: 100, w: 200, h: 44 },
  worldW: 200,
  worldH: 44,
  dom_path: ['article', 'button.btn'],
  authored: { background: 'var(--accent)' } as Record<string, string>,
  computed: {} as Record<string, string>,
  customStyles: {},
  attrs: {},
  artboardId: 'desktop',
  refs: [REF],
};
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};
const runs: Array<Record<string, unknown>> = [];
const shellRuns: Array<[string, Record<string, unknown>]> = [];

async function frame(selected: unknown = BUTTON) {
  const { registerInstanceKind } = await import('../client/v2/inspector/kinds/instance.jsx');
  registerInstanceKind();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  runs.length = 0;
  shellRuns.length = 0;
  return mount(
    <InspectorFrame
      {...({
        selected,
        layersTree: { artboardId: 'desktop', nodes: [] },
        cfg: CFG,
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
        onRunAction: (m: Record<string, unknown>) => runs.push(m),
        onShellAction: (id: string, p: Record<string, unknown>) => shellRuns.push([id, p]),
      } as never)}
    />
  );
}
const lastRun = () => runs[runs.length - 1] as { id: string; params: Record<string, unknown> };

describe('what the selection is', () => {
  test('the server is asked for a single object, by file and id, and the chip says Instance', async () => {
    const host = await frame();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(`/_api/edit-instance?file=${encodeURIComponent(FILE)}&id=cta`);
    expect(q(host, 'inspector-kind')?.textContent).toBe('Instance');
    expect(q(host, 'inspector-frame')?.getAttribute('data-kind')).toBe('instance');
  });

  test('an object the server does not call an instance keeps its own kind and gets no instance block', async () => {
    answer = null;
    const host = await frame();
    expect(q(host, 'inspector-kind')?.textContent).toBe('Button');
    expect(q(host, 'insp-sec-component')).toBeNull();
    expect(q(host, 'insp-sec-main')).toBeNull();
  });

  test('several objects are never asked', async () => {
    const host = await frame([
      BUTTON,
      { ...BUTTON, id: 'other', refs: [{ ...REF, element: 'other' }] },
    ]);
    expect(asked).toHaveLength(0);
    expect(q(host, 'inspector-kind')?.textContent).toBe('Mixed');
  });
});

describe('Component · Variant', () => {
  test('the system’s own words: Tlačítko, its variants, and the swaps; text and colour come along', async () => {
    const host = await frame();
    const comp = q(host, 'insp-component-select') as HTMLSelectElement;
    expect(Array.from(comp.options).map((o) => o.textContent)).toEqual(['Tlačítko', 'Štítek']);
    expect(comp.value).toBe('Button');
    const variant = q(host, 'insp-variant-select') as HTMLSelectElement;
    expect(Array.from(variant.options).map((o) => o.textContent)).toEqual([
      'Default',
      'Primary',
      'Outline',
    ]);
    expect(variant.value).toBe('primary');
    expect(q(host, 'insp-instance-hint')?.textContent).toBe('Your text and colour come along.');
  });

  test('another variant asks the canvas for component.swap-variant — nothing is written here', async () => {
    const host = await frame();
    await pick(q(host, 'insp-variant-select'), 'outline');
    expect(runs).toHaveLength(1);
    expect(lastRun()).toMatchObject({
      dgn: 'run-action',
      id: 'component.swap-variant',
      params: { targets: [REF], variant: 'outline' },
    });
  });

  test('Default is the master’s own look: variant null', async () => {
    const host = await frame();
    await pick(q(host, 'insp-variant-select'), '');
    expect(lastRun().params).toEqual({ targets: [REF], variant: null });
  });

  test('another component asks for the swap with that component', async () => {
    const host = await frame();
    await pick(q(host, 'insp-component-select'), 'Chip');
    expect(lastRun()).toMatchObject({
      id: 'component.swap-variant',
      params: { targets: [REF], component: 'Chip' },
    });
  });

  test('a component with no variants draws no Variant row; a variant set in code is shown as such', async () => {
    answer = { ...INFO, variants: [], variant: null };
    expect(q(await frame(), 'insp-variant-select')).toBeNull();
    answer = { ...INFO, variant: 'code' };
    const host = await frame();
    expect((q(host, 'insp-variant-select') as HTMLSelectElement).options[0]?.textContent).toBe(
      'Set in code'
    );
  });
});

describe('Content', () => {
  test('Text and Fill wear the dot when they differ from the master, and the line counts the changes', async () => {
    const host = await frame();
    expect((q(host, 'insp-content-text') as HTMLInputElement).value).toBe('REGISTRUJ SE');
    expect(q(host, 'insp-mod-content-text')?.getAttribute('aria-label')).toBe('Changed here');
    expect(q(host, 'insp-mod-content-fill')).not.toBeNull();
    expect(q(host, 'insp-instance-changes')?.textContent).toContain('2 changes from Tlačítko.');
  });

  test('no dots and no Reset when it follows the master', async () => {
    answer = {
      ...INFO,
      text: 'Button',
      overrides: { text: false, fill: false, props: [], count: 0 },
    };
    const host = await frame();
    expect(q(host, 'insp-mod-content-text')).toBeNull();
    expect(q(host, 'insp-mod-content-fill')).toBeNull();
    expect(q(host, 'insp-instance-reset')).toBeNull();
    expect(q(host, 'insp-instance-follows')?.textContent).toBe('Follows Tlačítko.');
  });

  test('one change says change, not changes', async () => {
    answer = { ...INFO, overrides: { text: true, fill: false, props: [], count: 1 } };
    const host = await frame();
    expect(q(host, 'insp-instance-changes')?.textContent).toContain('1 change from Tlačítko.');
  });

  test('Reset asks component.reset', async () => {
    const host = await frame();
    await click(q(host, 'insp-instance-reset'));
    expect(lastRun()).toMatchObject({ id: 'component.reset', params: { targets: [REF] } });
  });

  test('typing the words and leaving the field asks text.set; Escape takes it back; empty asks nothing', async () => {
    const host = await frame();
    const input = q(host, 'insp-content-text') as HTMLInputElement;
    await act(async () => input.focus());
    await type(input, 'ZAPIŠ SE');
    await act(async () => input.blur());
    await settle();
    expect(lastRun()).toMatchObject({
      id: 'text.set',
      params: { targets: [REF], text: 'ZAPIŠ SE' },
    });
    runs.length = 0;
    await act(async () => input.focus());
    await type(input, '   ');
    await act(async () => input.blur());
    await settle();
    expect(runs).toHaveLength(0);
  });

  test('words that are code are not ours: a disabled field, nothing to ask', async () => {
    answer = { ...INFO, text: null, textInCode: true };
    const host = await frame();
    const row = q(host, 'insp-row-content-text');
    expect(row?.querySelector('input')?.disabled).toBe(true);
  });

  test('a component that holds no words draws no Text row', async () => {
    answer = { ...INFO, component: 'Input', label: 'Input', holdsText: false, text: null };
    const host = await frame();
    expect(q(host, 'insp-row-content-text')).toBeNull();
  });

  test('"Update … for every canvas…" is drawn now that ds.review-update exists, and asks the shell for it', async () => {
    const { ACTIONS_BY_ID } = await import('../actions/index.ts');
    expect(ACTIONS_BY_ID.has('ds.review-update')).toBe(true);
    const host = await frame();
    const link = q(host, 'insp-instance-update');
    expect(link?.textContent).toBe('Update Tlačítko for every canvas…');
    await click(link);
    expect(shellRuns).toEqual([
      [
        'ds.review-update',
        {
          canvas: FILE,
          elementId: 'cta',
          target: { kind: 'component', name: 'Button', variant: 'primary' },
        },
      ],
    ]);
  });
});

describe('Main component', () => {
  test('Detach asks component.detach and says what it keeps', async () => {
    const host = await frame();
    expect(q(host, 'insp-instance-detach-line')?.textContent).toBe(
      'Detach keeps this exact look as a plain frame. Nothing breaks; it stops following Tlačítko.'
    );
    await click(q(host, 'insp-instance-detach'));
    expect(lastRun()).toMatchObject({ id: 'component.detach', params: { targets: [REF] } });
  });

  test('"Go to …" is drawn now that ds.go-to exists, and asks the shell for it', async () => {
    const { ACTIONS_BY_ID } = await import('../actions/index.ts');
    expect(ACTIONS_BY_ID.has('ds.go-to')).toBe(true);
    const host = await frame();
    await click(q(host, 'insp-instance-goto'));
    expect(shellRuns).toEqual([['ds.go-to', { component: 'Button' }]]);
  });
});

describe('an instance that repeats', () => {
  test('the controls are off and the inspector says why', async () => {
    answer = { ...INFO, repeats: true };
    const host = await frame();
    expect(q(host, 'insp-instance-repeats')?.textContent).toContain('repeats in the code');
    expect((q(host, 'insp-instance-detach') as HTMLButtonElement).disabled).toBe(true);
    expect((q(host, 'insp-instance-reset') as HTMLButtonElement).disabled).toBe(true);
    expect((q(host, 'insp-content-text') as HTMLInputElement).disabled).toBe(true);
  });
});
