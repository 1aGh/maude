// S2.4 — Fill · Corners · Border · Effects · Type + Mixed, rendered in the inspector frame: real markup, real registry,
// real token chips and segmented controls; only fetch is faked. Every control writes through /_api/edit-css with the
// words → CSS writer, only with the names the system declares, and several objects get one write each.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SLOT_DEFAULTS } from '../edit-ops/slot-defaults.ts';

const realFetch = globalThis.fetch;
type Post = { url: string; body: Record<string, unknown> };
const posts: Post[] = [];
const SPACE = [0, 4, 8, 12, 16, 24, 32, 48, 64].map(
  (px, i) => `--space-${i}: ${px === 0 ? '0' : `${px}px`};`
);
const STUDIO_CSS = `:root{${[
  ...SPACE,
  '--ink: oklch(0.2 0.02 250);',
  '--paper: oklch(0.98 0.01 90);',
  '--accent: oklch(0.6 0.15 250);',
  '--radius-md: 10px;',
  '--radius-round: 16px;',
  '--radius-pill: 999px;',
  '--shadow-resting: 0 1px 2px oklch(0 0 0 / 0.1);',
  '--shadow-floating: 0 8px 24px oklch(0 0 0 / 0.12);',
  '--shadow-sheet: 0 24px 60px oklch(0 0 0 / 0.2);',
  '--type-body: 14px;',
  '--type-title: 24px;',
].join('\n')}}`;
const OTHER_CSS = `:root{${[
  '--bg-0: oklch(0.99 0 0);',
  '--fg-0: oklch(0.2 0 0);',
  '--shadow-sm: 0 1px 2px oklch(0 0 0 / 0.1);',
  '--shadow-md: 0 3px 10px oklch(0 0 0 / 0.1);',
  '--shadow-lg: 0 8px 24px oklch(0 0 0 / 0.1);',
].join('\n')}}`;
let tokensCss = STUDIO_CSS;
const DECLARED = new Set(
  [...STUDIO_CSS.matchAll(/(--[a-z0-9-]+):/g), ...OTHER_CSS.matchAll(/(--[a-z0-9-]+):/g)].map(
    (m) => m[1]
  )
);
let previous: string | null = 'before';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith('.css')) return new Response(tokensCss, { status: 200 });
    if (init?.body) posts.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, previous }), { status: 200 });
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
beforeEach(async () => {
  posts.length = 0;
  previous = 'before';
  tokensCss = STUDIO_CSS;
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
  (await import('../client/v2/inspector/sections/corners.jsx')).forgetCornerChoices();
  for (const f of forgets) f();
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
const click = async (el: Element | null, what = 'element') => {
  const e = must(el, what);
  await act(async () => {
    e.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};
const reactProps = (el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  return (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[key];
};
const enter = async (input: Element | null, value: string) => {
  const e = must(input, 'input') as HTMLInputElement;
  e.value = value;
  await act(async () => reactProps(e).onBlur({ currentTarget: e }));
  await settle();
};
const press = async (input: Element | null, key: string) => {
  const e = must(input, 'input') as HTMLInputElement;
  await act(async () => reactProps(e).onKeyDown({ key, currentTarget: e, preventDefault() {} }));
  await settle();
};
const typeIn = async (input: Element | null, value: string) => {
  const e = must(input, 'input') as HTMLInputElement;
  e.value = value;
  await act(async () => reactProps(e).onChange({ currentTarget: e, target: e }));
};
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
const openChip = (host: HTMLElement, ctl: string) =>
  click(must(q(host, ctl), ctl).querySelector('button.insp-chip'), `${ctl} chip`);
const segment = (host: HTMLElement, id: string, label: string) =>
  [...(must(q(host, id), id).querySelectorAll('button') as unknown as HTMLElement[])].find(
    (b) => b.textContent?.trim() === label
  ) ?? null;
const segLabels = (host: HTMLElement, id: string) =>
  [...(must(q(host, id), id).querySelectorAll('button') as unknown as HTMLElement[])].map((b) =>
    b.textContent?.trim()
  );

const FILE = '.design/ui/Homepage.tsx';
const BOX = {
  id: 'card',
  index: 0,
  file: FILE,
  tag: 'div',
  classes: 'card',
  selector: 'div.card',
  text: '',
  bounds: { x: 0, y: 0, w: 200, h: 100 },
  worldW: 200,
  worldH: 100,
  dom_path: ['div.card'],
  authored: { background: 'var(--ink)' } as Record<string, string>,
  computed: {} as Record<string, string>,
  customStyles: {},
  attrs: {},
  parentDisplay: 'block',
  parentFlexDirection: 'row',
  artboardId: 'desktop',
};
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};
const recorded: Array<Record<string, unknown>> = [];

// The registry is process-wide and another test file's afterAll may have emptied it (bun runs the files in one
// process): evaluate the section files again, under a new URL, so they register afresh.
const reregistered: Array<() => void> = [];
const forgets: Array<() => void> = [];
let generation = 0;
async function ensureSections() {
  await import('../client/v2/inspector/sections/index.js');
  const { slotsFor } = await import('../client/v2/inspector/slots.js');
  if (slotsFor('fill', 'frame').length) return;
  generation += 1;
  for (const f of [
    'sections/fill',
    'sections/corners',
    'sections/border',
    'sections/effects',
    'sections/type',
    'kinds/multi',
  ]) {
    const mod = (await import(`../client/v2/inspector/${f}.jsx?s24=${generation}`)) as Record<
      string,
      unknown
    >;
    for (const [k, v] of Object.entries(mod))
      if (/^off[A-Z]/.test(k) && typeof v === 'function') reregistered.push(v as () => void);
    if (typeof mod.forgetCornerChoices === 'function')
      forgets.push(mod.forgetCornerChoices as () => void);
  }
}

async function frame(selected: unknown, cfg: Record<string, unknown> = CFG) {
  await ensureSections();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  recorded.length = 0;
  return mount(
    <InspectorFrame
      {...({
        selected,
        layersTree: { artboardId: 'desktop', nodes: [] },
        cfg,
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: (m: Record<string, unknown>) => recorded.push(m),
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
      } as never)}
    />
  );
}
const one = (over: Record<string, unknown> = {}, cfg?: Record<string, unknown>) =>
  frame({ ...BOX, ...over }, cfg);
const edits = () => posts.filter((p) => p.url === '/_api/edit-css');
const written = () =>
  Object.fromEntries(edits().map((p) => [p.body.property, p.body.value ?? null]));

// r3 "a freshly drawn shape's Fill says None": a shape the tools draw is `background: var(--bg-3, #d4d4d8)`. A browser
// cannot expand a var() shorthand into longhands, so `authored` has no background-colour for it and the Fill row said
// "None" over a grey shape. The canvas reports the inline shorthand beside `authored` (`declared`) and the row reads it
// as a fallback, never as a write base (that would put `background: null` in a gradient patch and wipe the colour).
const FRESH_VAR = 'var(--bg-3, #d4d4d8)';
const fresh = (over: Record<string, unknown> = {}, cfg?: Record<string, unknown>) =>
  one(
    {
      authored: {},
      computed: { 'background-color': 'rgb(212, 212, 216)' },
      declared: { background: FRESH_VAR },
      ...over,
    },
    cfg
  );
const NO_DS = { designRel: '.design', designSystems: [], defaultDesignSystem: null };
const chipText = (host: HTMLElement) => q(host, 'insp-chip-fill')?.textContent ?? '';

describe('a freshly drawn shape: the Fill row shows its fill', () => {
  for (const [label, cfg] of [
    ['with a design system', CFG],
    ['without a design system', NO_DS],
  ] as const) {
    test(`${label}: a swatch, a readable name and the opacity, never "None"`, async () => {
      const host = await fresh({}, cfg);
      expect(chipText(host)).not.toContain('None');
      expect(chipText(host).trim()).not.toBe('');
      expect(q(host, 'insp-chip-fill')?.querySelectorAll('.insp-sw').length).toBe(1);
      const opacity = q(host, 'insp-opacity-fill')?.querySelector('input') as HTMLInputElement;
      expect(opacity.value).toContain('100');
    });
  }

  test('a token the system has reads as its name; without it the colour is said in words', async () => {
    tokensCss = STUDIO_CSS.replace(':root{', ':root{--bg-3: #d4d4d8;');
    const host = await fresh();
    expect(chipText(host)).toContain('Bg 3');
    document.body.innerHTML = '';
    tokensCss = STUDIO_CSS;
    const bare = await fresh({}, NO_DS);
    expect(chipText(bare)).toBe('Grey');
  });

  test('a bare literal reads as written', async () => {
    const lit = await fresh({ declared: { background: '#d4a017' } }, NO_DS);
    expect(chipText(lit).toLowerCase()).not.toContain('none');
    expect(chipText(lit).trim()).not.toBe('');
  });

  test('a pick shows the pick (not the old fill, not None) and writes the same source as before', async () => {
    const host = await fresh();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    (must(q(host, 'insp-colorin-fill'), 'input') as HTMLInputElement).value = '#008aff';
    await press(q(host, 'insp-colorin-fill'), 'Enter');
    expect(written()).toEqual({ background: '#008aff' });
    expect(chipText(host).toLowerCase()).toContain('blue');
  });

  test('None clears it and then reads None (the shorthand does not come back)', async () => {
    const host = await fresh();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-none-fill'));
    expect(edits().map((p) => [p.body.property, p.body.reset])).toEqual([['background', true]]);
    expect(chipText(host)).toContain('None');
  });

  // r6 (Michal): "+" opens the picker on Custom; Gradient is its tab (the old row of Colour · Gradient · Image is gone)
  test('+ then Gradient writes a gradient fill from the role colours, never currentColor', async () => {
    const host = await fresh();
    await click(q(host, 'insp-add-fill'));
    expect(q(host, 'insp-fill-add')).toBeNull();
    await click(q(host, 'insp-kind-gradient-fill'));
    const w = written();
    expect(w['background-image']).toStartWith('linear-gradient(180deg, ');
    expect(JSON.stringify(w)).not.toMatch(/currentcolor/i);
  });
});
