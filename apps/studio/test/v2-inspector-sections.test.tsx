// S2.3 — Position · Size · Layout rendered in the inspector frame: real markup, real registry, real number field /
// segmented control / token chip; only fetch is faked. Every control writes through /_api/edit-css with the words
// → CSS writer, Tier-1 names only, and records the undo entry from what the server says it replaced.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
type Post = { url: string; body: Record<string, unknown> };
const posts: Post[] = [];
const TOKENS_CSS = [0, 4, 8, 12, 16, 24, 32, 48, 64]
  .map((px, i) => `--space-${i}: ${px === 0 ? '0' : `${px}px`};`)
  .join('\n');
const STOPS = new Set(Array.from({ length: 9 }, (_, i) => `--space-${i}`));
let previous: string | null = 'before';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith('.css')) return new Response(`:root{${TOKENS_CSS}}`, { status: 200 });
    if (init?.body) posts.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, previous }), { status: 200 });
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
  previous = 'before';
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
/** Choose an option: a native change event (React hears it on a <select> without a polyfill). */
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
/** A switch is a checkbox: a click flips it and React hears it. */
const check = async (el: Element | null, checked: boolean) => {
  const e = must(el, 'checkbox') as HTMLInputElement;
  if (e.checked === checked) return;
  await click(e, 'checkbox');
};
/** Type into a number field / chip number input and leave it. */
const enter = async (input: Element | null, value: string) => {
  const e = must(input, 'input') as HTMLInputElement;
  e.value = value;
  await act(async () => reactProps(e).onBlur({ currentTarget: e }));
  await settle();
};
const inner = (host: HTMLElement, id: string, sel = 'input') =>
  must(q(host, id)?.querySelector(sel) ?? null, `${sel} in ${id}`);

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
  authored: {
    display: 'inline-flex',
    gap: 'var(--space-2)',
    padding: '10px var(--space-5)',
  } as Record<string, string>,
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
const recorded: Array<Record<string, unknown>> = [];
const optimistic: Array<Record<string, unknown>> = [];

async function frame(over: Record<string, unknown> = {}, el: Record<string, unknown> = {}) {
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
        ...over,
      } as never)}
    />
  );
}
const lastPost = () => posts[posts.length - 1]?.body;
const edits = () => posts.filter((p) => p.url === '/_api/edit-css');
const written = () =>
  Object.fromEntries(edits().map((p) => [p.body.property, p.body.value ?? null]));

describe('the three sections', () => {
  test('Position, Size and Layout are drawn for a button, and Advanced starts folded', async () => {
    const host = await frame();
    expect(q(host, 'insp-sec-position')?.getAttribute('data-n')).toBe('1');
    expect(q(host, 'insp-sec-size')?.getAttribute('data-n')).toBe('2');
    expect(q(host, 'insp-sec-layout')?.getAttribute('data-n')).toBe('3');
    expect(q(host, 'fold-inspector-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });
  test('text lays nothing out: no Layout section for it', async () => {
    const host = await frame({}, { tag: 'p', authored: {}, computed: {} });
    expect(q(host, 'insp-sec-size')).not.toBeNull();
    expect(q(host, 'insp-sec-layout')).toBeNull();
  });
  test('an object without an id says why nothing writes', async () => {
    const host = await frame({}, { id: undefined, selector: 'div.x', artboardId: undefined });
    expect(q(host, 'insp-size-locked')).not.toBeNull();
    await pick(q(host, 'insp-mode-width'), 'hug');
    expect(posts).toEqual([]);
  });
});

describe('Size', () => {
  test('Fixed shows the measured size; Hug writes width: fit-content and nothing else', async () => {
    const host = await frame();
    expect((inner(host, 'insp-num-width') as HTMLInputElement).value).toBe('148');
    expect((q(host, 'insp-mode-width') as HTMLSelectElement).value).toBe('fixed');
    await pick(q(host, 'insp-mode-width'), 'hug');
    expect(posts.map((p) => p.url)).toEqual(['/_api/edit-css']);
    expect(lastPost()).toEqual({
      canvas: FILE,
      id: 'book-call',
      property: 'width',
      value: 'fit-content',
    });
    expect((q(host, 'insp-mode-width') as HTMLSelectElement).value).toBe('hug');
    // the live element moved before the reload
    expect(optimistic[0]).toMatchObject({ id: 'book-call', prop: 'width', value: 'fit-content' });
  });
  test('Fill in a flex row is flex: 1; going back to Fixed removes it', async () => {
    const host = await frame();
    await pick(q(host, 'insp-mode-width'), 'fill');
    expect(lastPost()).toMatchObject({ property: 'flex', value: '1' });
    await pick(q(host, 'insp-mode-width'), 'fixed');
    expect(written().flex).toBeNull();
    expect(written().width).toBe('148px');
    expect(posts.find((p) => p.body.property === 'flex' && p.body.reset)).toBeTruthy();
  });
  test('Height fills across a row with align-self: stretch', async () => {
    const host = await frame();
    await pick(q(host, 'insp-mode-height'), 'fill');
    expect(lastPost()).toMatchObject({ property: 'align-self', value: 'stretch' });
  });
  test('typing a number makes it Fixed; leaving the field untouched writes nothing', async () => {
    const host = await frame();
    await enter(inner(host, 'insp-num-width'), '148');
    expect(posts).toEqual([]);
    await enter(inner(host, 'insp-num-width'), '200');
    expect(lastPost()).toMatchObject({ property: 'width', value: '200px' });
  });
  test('Clip content is overflow: hidden, and off removes it', async () => {
    const host = await frame();
    await check(inner(host, 'insp-ctl-clip'), true);
    expect(lastPost()).toMatchObject({ property: 'overflow', value: 'hidden' });
    await check(inner(host, 'insp-ctl-clip'), false);
    expect(lastPost()).toMatchObject({ property: 'overflow', reset: true });
  });
  test('each write records its own undo entry from what the server replaced', async () => {
    previous = '120px';
    const host = await frame();
    await enter(inner(host, 'insp-num-width'), '200');
    expect(recorded).toEqual([
      { op: 'css', canvas: FILE, id: 'book-call', key: 'width', before: '120px', after: '200px' },
    ]);
    posts.length = 0;
    recorded.length = 0;
    previous = '200px'; // the server says the value was already there: nothing to undo
    await enter(inner(host, 'insp-num-width'), '220');
    expect(recorded.length).toBe(1);
    previous = '300px';
    await pick(q(host, 'insp-mode-width'), 'hug');
    expect(recorded[1]).toMatchObject({ key: 'width', before: '300px', after: 'fit-content' });
  });
});

describe('Layout', () => {
  test('Direction writes display / flex-direction only', async () => {
    const host = await frame();
    await click(q(host, 'insp-ctl-direction')?.querySelector('[aria-label="Column"]') ?? null);
    expect(written()).toEqual({ 'flex-direction': 'column' });
    posts.length = 0;
    await click(q(host, 'insp-ctl-direction')?.querySelector('[aria-label="Grid"]') ?? null);
    expect(written().display).toBe('inline-grid');
    expect(posts.every((p) => p.body.property !== 'padding')).toBe(true);
  });
  test('Gap reads as a chip, "Space 8", and the menu lists the system’s stops', async () => {
    const host = await frame();
    expect(q(host, 'insp-chip-gap')?.textContent).toBe('Space 8');
    await click(q(host, 'insp-ctl-gap')?.querySelector('button.insp-chip') ?? null);
    const menu = q(host, 'insp-menu-gap');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Space 24');
    expect(menu?.textContent).toContain('A number, no token…');
    await click(q(host, 'insp-stop-gap-16'));
    expect(lastPost()).toMatchObject({ property: 'gap', value: 'var(--space-4)' });
    expect(q(host, 'insp-chip-gap')?.textContent).toBe('Space 16');
  });
  test('"A number, no token…" writes a plain number, and that number offers Bind', async () => {
    const host = await frame();
    await click(q(host, 'insp-ctl-gap')?.querySelector('button.insp-chip') ?? null);
    await click(q(host, 'insp-number-gap'));
    expect(q(host, 'insp-chip-gap')).toBeNull(); // now a number field
    await enter(q(host, 'insp-num-gap'), '10');
    expect(lastPost()).toMatchObject({ property: 'gap', value: '10px' });
    expect(q(host, 'insp-bind-gap')).not.toBeNull();
    await click(q(host, 'insp-bind-gap'));
    // 10 sits between 8 and 12: the tie goes to the smaller stop
    expect(lastPost()).toMatchObject({ property: 'gap', value: 'var(--space-2)' });
  });
  test('Padding H 24 · V 10: the plain V shows "not a token" with Bind, and Bind keeps H', async () => {
    const host = await frame();
    expect(q(host, 'insp-chip-pad-h')?.textContent).toBe('Space 24');
    expect((q(host, 'insp-num-pad-v') as HTMLInputElement).value).toBe('10');
    expect(q(host, 'insp-bind-pad-v')).not.toBeNull();
    expect(q(host, 'insp-bind-pad-h')).toBeNull();
    await click(q(host, 'insp-bind-pad-v'));
    expect(lastPost()).toMatchObject({
      property: 'padding',
      value: 'var(--space-2) var(--space-5)',
    });
  });
  test('Padding with all four sides alike is ONE chip (14 ed-lay-auto); the sides open from the section header', async () => {
    const host = await frame({}, { authored: { ...BUTTON.authored, padding: 'var(--space-5)' } });
    expect(q(host, 'insp-chip-pad-all')?.textContent).toBe('Space 24');
    expect(q(host, 'insp-ctl-pad-h')).toBeNull();
    expect(q(host, 'insp-ctl-pad-v')).toBeNull();
    // the toggle is the Layout header's icon, not a button in the Padding row
    const toggle = q(host, 'insp-sides');
    expect(toggle?.closest('[data-testid="insp-row-padding"]')).toBeNull();
    expect(toggle?.closest('[data-testid="insp-sec-layout"]')).not.toBeNull();
    expect(q(host, 'insp-row-pad-top')).toBeNull();
    await click(toggle);
    for (const side of ['top', 'right', 'bottom', 'left'])
      expect(q(host, `insp-row-pad-${side}`)).not.toBeNull();
    // one value for every side: the chip writes the whole shorthand
    await click(q(host, 'insp-chip-pad-all')?.closest('button') ?? null);
    await click(q(host, 'insp-stop-pad-all-16'));
    expect(lastPost()).toMatchObject({ property: 'padding', value: 'var(--space-4)' });
  });
  test('Padding per side opens four rows; an uneven box says Mixed', async () => {
    const host = await frame(
      {},
      { authored: { ...BUTTON.authored, padding: '4px 8px 12px 16px' } }
    );
    expect(q(host, 'insp-mixed-h')).not.toBeNull();
    for (const s of ['top', 'right', 'bottom', 'left'])
      expect(q(host, `insp-row-pad-${s}`)).not.toBeNull();
  });
  test('Spacing: Space between is justify-content, and Gap says Auto while it is on', async () => {
    const host = await frame();
    await click(q(host, 'insp-ctl-spacing')?.querySelector('[role="radio"]:last-child') ?? null);
    expect(lastPost()).toMatchObject({ property: 'justify-content', value: 'space-between' });
    expect(q(host, 'insp-chip-gap')?.textContent).toBe('Auto');
    await click(q(host, 'insp-ctl-spacing')?.querySelector('[role="radio"]:first-child') ?? null);
    expect(lastPost()).toMatchObject({ property: 'justify-content', reset: true });
    expect(q(host, 'insp-chip-gap')?.textContent).toBe('Space 8');
  });
  test('the Gap menu’s Auto row is the same property as the Spacing segment', async () => {
    const host = await frame();
    await click(q(host, 'insp-ctl-gap')?.querySelector('button.insp-chip') ?? null);
    await click(q(host, 'insp-extra-gap-auto'));
    expect(lastPost()).toMatchObject({ property: 'justify-content', value: 'space-between' });
    const seg = q(host, 'insp-ctl-spacing')?.querySelector('[aria-checked="true"]');
    expect(seg?.textContent).toBe('Space between');
  });
  test('Align: the 3×3 pad writes both axes for a row; with Space between only the cross axis moves', async () => {
    const host = await frame();
    await click(q(host, 'insp-ctl-align')?.querySelector('[aria-label="align br"]') ?? null);
    expect(written()).toEqual({ 'justify-content': 'flex-end', 'align-items': 'flex-end' });
    posts.length = 0;
    await click(q(host, 'insp-ctl-spacing')?.querySelector('[role="radio"]:last-child') ?? null);
    posts.length = 0;
    await click(q(host, 'insp-ctl-align')?.querySelector('[aria-label="align tl"]') ?? null);
    expect(written()['justify-content']).toBeUndefined(); // still space-between
    expect(written()['align-items']).toBe('flex-start');
  });
  // p8-sweep-advanced — under Space between the pad's other columns write nothing (the dead-control crawl clicked six
  // of them): they are greyed with the reason instead of looking like buttons.
  test('Align: with Space between the cells that cannot move anything are greyed and say why', async () => {
    const host = await frame();
    const cell = (c: string) =>
      q(host, 'insp-ctl-align')?.querySelector(`[aria-label="align ${c}"]`) as HTMLElement | null;
    expect(cell('tr')?.getAttribute('aria-disabled')).toBeNull();
    await click(q(host, 'insp-ctl-spacing')?.querySelector('[role="radio"]:last-child') ?? null);
    for (const c of ['tc', 'tr', 'cc', 'cr', 'bc', 'br']) {
      expect(cell(c)?.getAttribute('aria-disabled')).toBe('true');
      expect(cell(c)?.getAttribute('title')).toBe('Space between sets this one');
    }
    for (const c of ['tl', 'cl', 'bl']) expect(cell(c)?.getAttribute('aria-disabled')).toBeNull();
    posts.length = 0;
    await click(cell('br'));
    expect(posts.length).toBe(0);
    await click(cell('bl'));
    expect(written()['align-items']).toBe('flex-end');
  });
  test('only Tier-1 names are ever written', async () => {
    const host = await frame();
    await click(q(host, 'insp-ctl-gap')?.querySelector('button.insp-chip') ?? null);
    await click(q(host, 'insp-stop-gap-48'));
    await click(q(host, 'insp-bind-pad-v'));
    const names = posts
      .flatMap((p) => String(p.body.value ?? '').match(/--[a-z0-9-]+/g) ?? [])
      .filter(Boolean);
    expect(names.length).toBeGreaterThan(1);
    for (const n of names) expect(STOPS.has(n)).toBe(true);
    for (const p of posts) expect(String(p.body.property).startsWith('data-cd-')).toBe(false);
  });
});

describe('Position pins go through object.constrain (S2.11b)', () => {
  const GEO = { x: 1296, y: 486, w: 80, h: 44, parentW: 1440, parentH: 600 };
  const FREE = {
    authored: { position: 'absolute', left: '1296px', top: '486px' },
    computed: { position: 'absolute' },
    geometry: GEO,
    refs: [{ artboard: 'desktop', element: 'book-call' }],
  };
  const ran: Array<Record<string, unknown>> = [];
  const over = { onRunAction: (m: Record<string, unknown>) => ran.push(m) };
  beforeEach(() => {
    ran.length = 0;
  });
  test('Right then Bottom: each pin is ONE run-action carrying both edges and the measured box; no edit-css', async () => {
    const host = await frame(over, FREE);
    await pick(q(host, 'insp-pin-h'), 'right');
    expect(ran.length).toBe(1);
    expect(ran[0]).toEqual({
      dgn: 'run-action',
      v: 1,
      id: 'object.constrain',
      params: {
        targets: [{ artboard: 'desktop', element: 'book-call' }],
        h: 'right',
        v: 'top',
        geometry: GEO,
      },
    });
    // the second pin builds on the first (the file has not reloaded yet): 64 from the corner
    await pick(q(host, 'insp-pin-v'), 'bottom');
    expect(ran.length).toBe(2);
    expect(ran[1]?.params).toMatchObject({ h: 'right', v: 'bottom' });
    expect(posts).toEqual([]);
  });
  test('the pin picture toggles an edge the same way', async () => {
    const host = await frame(over, FREE);
    await click(host.querySelector('[aria-label="Pin right"]'), 'pin right');
    expect(ran[0]?.params).toMatchObject({ h: 'both', v: 'top' });
  });
  test('an old canvas bundle (no refs) or no way to run an action keeps the edit-css path', async () => {
    const host = await frame(over, { ...FREE, refs: undefined });
    await pick(q(host, 'insp-pin-h'), 'both');
    expect(ran).toEqual([]);
    expect(edits().length).toBeGreaterThan(0);
    posts.length = 0;
    const host2 = await frame({}, FREE);
    await pick(q(host2, 'insp-pin-h'), 'both');
    expect(edits().length).toBeGreaterThan(0);
  });
});

// V2-8.5 c6 (14 ed-lay-auto vs ed-obj-enter): who leads the card depends on who places the object.
describe('Section order for a frame', () => {
  const order = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLElement>('[data-testid^="insp-sec-"]')]
      .map((n) => n.getAttribute('data-testid')?.replace('insp-sec-', '') ?? '')
      .slice(0, 3);
  const FRAME = {
    tag: 'div',
    authored: { display: 'flex' },
    computed: { display: 'flex', position: 'static' },
    childCount: 3,
  };
  test('an auto-layout frame no layout places leads with Layout, then Size', async () => {
    const host = await frame({}, { ...FRAME, parentDisplay: 'block' });
    expect(order(host)).toEqual(['layout', 'size', 'position']);
  });
  test('the same frame inside another layout keeps Position first (who places it)', async () => {
    const host = await frame({}, { ...FRAME, parentDisplay: 'flex' });
    expect(order(host)).toEqual(['position', 'size', 'layout']);
  });
});

describe('Position', () => {
  const PLACED = {
    authored: { position: 'absolute', left: '1220px', top: '22px' },
    computed: { position: 'absolute' },
  };
  test('inside auto layout (14 ed-obj-enter): "In <frame> · Set by <frame> · 2 of 3" — no X · Y, no Rotation', async () => {
    const host = await frame({
      layersTree: {
        artboardId: 'desktop',
        nodes: [
          {
            id: 'services',
            index: 0,
            label: 'Services',
            tag: 'div',
            children: [
              { id: 'a', index: 0, label: 'A', tag: 'div' },
              { id: BUTTON.id, index: BUTTON.index ?? 0, label: 'Book', tag: 'button' },
              { id: 'c', index: 0, label: 'C', tag: 'div' },
            ],
          },
        ],
      },
    });
    expect(q(host, 'insp-row-in-layout')?.textContent).toContain('In Services');
    expect(q(host, 'insp-in-layout')?.textContent).toBe('Set by Services · 2 of 3');
    expect(q(host, 'insp-row-xy')).toBeNull();
    expect(q(host, 'insp-row-rotation')).toBeNull();
    expect(q(host, 'insp-position-auto')).toBeNull();
    expect(q(host, 'insp-cons')).toBeNull();
  });
  test('inside auto layout with a tree that does not know the object: "Set by its frame", no count', async () => {
    const host = await frame();
    expect(q(host, 'insp-in-layout')?.textContent).toBe('Set by its frame');
  });
  test('a placed object: X and Y are left and top', async () => {
    const host = await frame({}, PLACED);
    expect((inner(host, 'insp-num-x') as HTMLInputElement).value).toBe('1220');
    await enter(inner(host, 'insp-num-x'), '1000');
    expect(written()).toEqual({ left: '1000px' });
    posts.length = 0;
    await enter(inner(host, 'insp-num-y'), '30');
    expect(written()).toEqual({ top: '30px' });
  });
  test('Rotation writes the transform and keeps what else it says', async () => {
    const host = await frame(
      {},
      { authored: { ...PLACED.authored, transform: 'translateX(4px)' }, computed: PLACED.computed }
    );
    await enter(inner(host, 'insp-num-rotation'), '30');
    expect(written()).toEqual({ transform: 'translateX(4px) rotate(30deg)' });
    posts.length = 0;
    await enter(inner(host, 'insp-num-rotation'), '0');
    expect(written()).toEqual({ transform: 'translateX(4px)' });
  });
  test('Constraints show what the file says; without a measurement they do not write', async () => {
    const host = await frame(
      {},
      {
        authored: { position: 'absolute', right: '72px', top: '22px' },
        computed: { position: 'absolute' },
      }
    );
    expect((q(host, 'insp-pin-h') as HTMLSelectElement).value).toBe('right');
    expect((q(host, 'insp-pin-v') as HTMLSelectElement).value).toBe('top');
    expect(q(host, 'insp-pin-unmeasured')).not.toBeNull();
    await pick(q(host, 'insp-pin-h'), 'left');
    expect(posts).toEqual([]);
  });
  test('with the object measured, a pin converts its distance: Right · Top → Left & Right', async () => {
    const host = await frame(
      {},
      {
        authored: { position: 'absolute', right: '72px', top: '22px', width: '148px' },
        computed: { position: 'absolute' },
        geometry: { x: 1220, y: 22, w: 148, h: 44, parentW: 1440, parentH: 600 },
      }
    );
    expect(q(host, 'insp-pin-unmeasured')).toBeNull();
    await pick(q(host, 'insp-pin-h'), 'both');
    // right already says 72px: only what changes is written
    expect(written()).toEqual({ left: '1220px', width: null });
  });
});
