// S2.4 — Fill · Corners · Border · Effects · Type + Mixed, rendered in the inspector frame: real markup, real registry,
// real token chips and segmented controls; only fetch is faked. Every control writes through /_api/edit-css with the
// words → CSS writer, only with the names the system declares, and several objects get one write each.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

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

async function frame(selected: unknown) {
  await ensureSections();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  recorded.length = 0;
  return mount(
    <InspectorFrame
      {...({
        selected,
        layersTree: { artboardId: 'desktop', nodes: [] },
        cfg: CFG,
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: (m: Record<string, unknown>) => recorded.push(m),
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
      } as never)}
    />
  );
}
const one = (over: Record<string, unknown> = {}) => frame({ ...BOX, ...over });
const edits = () => posts.filter((p) => p.url === '/_api/edit-css');
const written = () =>
  Object.fromEntries(edits().map((p) => [p.body.property, p.body.value ?? null]));

describe('Fill', () => {
  test('the section is drawn, the chip names the token the way the system does, the opacity is a number', async () => {
    const host = await one();
    expect(q(host, 'insp-sec-fill')?.getAttribute('data-n')).toBe('4');
    expect(q(host, 'insp-chip-fill')?.textContent).toContain('Ink');
    expect(q(host, 'insp-add-fill')).not.toBeNull();
    expect(q(host, 'insp-opacity-fill')).not.toBeNull();
  });

  test('picking another token writes var(--paper) — the system’s own name — and records the undo entry', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    const names = [...host.querySelectorAll('[data-testid^="insp-color-fill-"]')].map((e) =>
      e.getAttribute('data-testid')
    );
    expect(names).toContain('insp-color-fill-paper');
    await click(q(host, 'insp-color-fill-paper'));
    expect(written()).toEqual({ background: 'var(--paper)' });
    expect(recorded.at(-1)).toMatchObject({ key: 'background', after: 'var(--paper)' });
  });

  test('opacity below 100 is a colour-mix of the token; typing it writes once', async () => {
    const host = await one();
    await enter(q(host, 'insp-opacity-fill')?.querySelector('input') ?? null, '40');
    expect(written()).toEqual({ background: 'color-mix(in srgb, var(--ink) 40%, transparent)' });
  });

  test('None removes the fill', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-none-fill'));
    expect(edits().map((p) => [p.body.property, p.body.reset])).toEqual([['background', true]]);
  });

  test('+ offers a gradient: it is a layer over the colour, written as longhands', async () => {
    const host = await one();
    await click(q(host, 'insp-add-fill'));
    expect(q(host, 'insp-fill-add')).not.toBeNull();
    await click(q(host, 'insp-fill-add-gradient'));
    const w = written();
    expect(w['background-image']).toMatch(
      /^linear-gradient\(180deg, var\(--[a-z-]+\), var\(--[a-z-]+\)\)$/
    );
    expect(w['background-color']).toBe('var(--ink)');
    expect(w.background).toBeNull();
  });

  test('+ an image: a script address is refused with the reason and writes nothing; a project path is written', async () => {
    const host = await one();
    await click(q(host, 'insp-add-fill'));
    const input = q(host, 'insp-fill-add-image');
    await typeIn(input, 'javascript:alert(1)');
    await press(input, 'Enter');
    expect(q(host, 'insp-fill-image-error')?.textContent).toContain('https://');
    expect(edits()).toEqual([]);
    await typeIn(q(host, 'insp-fill-add-image'), 'assets/hero.png');
    await press(q(host, 'insp-fill-add-image'), 'Enter');
    expect(written()['background-image']).toBe('url("assets/hero.png")');
    expect(written()['background-size']).toBe('cover');
  });

  test('a layer the file already has can be removed', async () => {
    const host = await one({
      authored: { 'background-color': 'var(--ink)', 'background-image': 'url("a.png")' },
    });
    expect(q(host, 'insp-row-fill-layer-0')).not.toBeNull();
    await click(q(host, 'insp-fill-remove-0'));
    expect(written()['background-image']).toBeNull();
  });

  test('a custom colour is accepted only if it is one colour', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-colorcss-fill'));
    const input = q(host, 'insp-colorin-fill');
    (must(input, 'input') as HTMLInputElement).value = 'red; position: fixed';
    await press(input, 'Enter');
    expect(edits()).toEqual([]);
    (must(q(host, 'insp-colorin-fill'), 'input') as HTMLInputElement).value = 'oklch(0.7 0.1 30)';
    await press(q(host, 'insp-colorin-fill'), 'Enter');
    expect(written()).toEqual({ background: 'oklch(0.7 0.1 30)' });
  });
});

describe('Corners', () => {
  test('one value: the system’s radius steps, in its own names, write var(--radius-…)', async () => {
    const host = await one({ authored: { 'border-radius': 'var(--radius-md)' } });
    expect(q(host, 'insp-sec-corners')?.getAttribute('data-n')).toBe('5');
    expect(q(host, 'insp-chip-corners')?.textContent).toBe('MD');
    await openChip(host, 'insp-ctl-corners');
    await click(q(host, 'insp-stop-corners-16'));
    expect(written()).toEqual({ 'border-radius': 'var(--radius-round)' });
  });

  test('a plain number shows plainly with Bind; Bind takes the nearest of the system’s steps', async () => {
    const host = await one({ authored: { 'border-radius': '11px' } });
    expect(q(host, 'insp-num-corners')).not.toBeNull();
    await click(q(host, 'insp-bind-corners'));
    expect(written()).toEqual({ 'border-radius': 'var(--radius-md)' });
  });

  test('unlink sets each corner: ↖ ↗ ↙ ↘, written as four values in CSS order, the others untouched', async () => {
    const host = await one({ authored: { 'border-radius': '40px' } });
    await click(q(host, 'insp-corners-unlink'));
    expect(q(host, 'insp-corners')).not.toBeNull();
    for (const k of ['tl', 'tr', 'bl', 'br'])
      expect(q(host, `insp-ctl-corner-${k}`)).not.toBeNull();
    await enter(q(host, 'insp-num-corner-bl'), '8');
    expect(written()).toEqual({ 'border-radius': '40px 40px 40px 8px' });
  });

  test('corners that already differ open unlinked on their own', async () => {
    const host = await one({ authored: { 'border-radius': '40px 40px 8px 40px' } });
    expect(q(host, 'insp-corners')).not.toBeNull();
    expect(q(host, 'insp-corners-unlink')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Border', () => {
  test('empty until you add one with +: None, then the system’s ink-like token, 1, Inside', async () => {
    const host = await one({ authored: {} });
    expect(q(host, 'insp-border-none')).not.toBeNull();
    await click(q(host, 'insp-add-border'));
    expect(written()['box-shadow']).toBe('inset 0 0 0 1px var(--ink)');
  });

  test('Position: Centre and Outside are an outline; the shadow beside it survives', async () => {
    const host = await one({
      authored: { 'box-shadow': 'inset 0 0 0 3px var(--ink), var(--shadow-resting)' },
    });
    expect(q(host, 'insp-chip-border')?.textContent).toContain('Ink');
    await click(segment(host, 'insp-ctl-border-position', 'Centre'));
    const w = written();
    expect(w.outline).toBe('3px solid var(--ink)');
    expect(w['outline-offset']).toBe('-1.5px');
    expect(w['box-shadow']).toBe('var(--shadow-resting)');
  });

  test('width: a number; 0 removes the border', async () => {
    const host = await one({ authored: { border: '1.5px solid var(--ink)' } });
    await enter(q(host, 'insp-num-border-width')?.querySelector('input') ?? null, '2');
    expect(written()).toEqual({ border: '2px solid var(--ink)' });
  });

  test('a line or a Pen path calls it Stroke, with no position', async () => {
    const host = await one({
      tag: 'path',
      authored: { stroke: 'var(--ink)', 'stroke-width': '2px' },
    });
    expect(q(host, 'insp-sec-border')?.getAttribute('aria-label')).toBe('Stroke');
    expect(q(host, 'insp-row-border-position')).toBeNull();
    await enter(q(host, 'insp-num-border-width')?.querySelector('input') ?? null, '3');
    expect(written()).toEqual({ 'stroke-width': '3px' });
  });
});

describe('Effects', () => {
  test('the Shadow segment is built from the system’s own elevation names', async () => {
    const host = await one({ authored: { 'box-shadow': 'var(--shadow-resting)' } });
    expect(segLabels(host, 'insp-ctl-shadow')).toEqual(['Flat', 'Resting', 'Floating', 'Sheet']);
    await click(segment(host, 'insp-ctl-shadow', 'Floating'));
    expect(written()).toEqual({ 'box-shadow': 'var(--shadow-floating)' });
  });

  test('another system gets its own names — not this list', async () => {
    tokensCss = OTHER_CSS;
    const host = await one({ authored: {} });
    expect(segLabels(host, 'insp-ctl-shadow')).toEqual(['Flat', 'SM', 'MD', 'LG']);
    await click(segment(host, 'insp-ctl-shadow', 'MD'));
    expect(written()).toEqual({ 'box-shadow': 'var(--shadow-md)' });
  });

  test('Flat removes the shadow and leaves the border ring', async () => {
    const host = await one({
      authored: { 'box-shadow': 'inset 0 0 0 2px var(--ink), var(--shadow-sheet)' },
    });
    await click(segment(host, 'insp-ctl-shadow', 'Flat'));
    expect(written()).toEqual({ 'box-shadow': 'inset 0 0 0 2px var(--ink)' });
  });

  test('+ takes the lowest step of the system; Opacity is a percent', async () => {
    const host = await one({ authored: {} });
    await click(q(host, 'insp-add-effects'));
    expect(written()).toEqual({ 'box-shadow': 'var(--shadow-resting)' });
    posts.length = 0;
    await enter(q(host, 'insp-num-opacity')?.querySelector('input') ?? null, '50');
    expect(written()).toEqual({ opacity: '0.5' });
  });
});

describe('Type', () => {
  const text = { tag: 'p', text: 'Hello', authored: { 'font-size': '14px', 'font-weight': '500' } };
  test('size, weight and colour of the text inside', async () => {
    const host = await one(text);
    expect(q(host, 'insp-sec-type')?.getAttribute('data-n')).toBe('8');
    await openChip(host, 'insp-ctl-type-colour');
    await click(q(host, 'insp-color-type-colour-paper'));
    expect(written()).toEqual({ color: 'var(--paper)' });
    posts.length = 0;
    await pick(q(host, 'insp-weight'), '600');
    expect(written()).toEqual({ 'font-weight': '600' });
  });
  test('size is a number or one of the system’s steps', async () => {
    const host = await one(text);
    await enter(q(host, 'insp-num-font-size'), '16');
    expect(written()).toEqual({ 'font-size': '16px' });
  });
});

describe('several objects: Mixed', () => {
  const a = { ...BOX, id: 'a', authored: { background: 'var(--ink)' } };
  const b = { ...BOX, id: 'b', index: 1, authored: { background: 'var(--paper)' } };
  const c = { ...BOX, id: 'c', index: 2, authored: { background: 'var(--ink)' } };

  test('different fills say Mixed with their swatches; the same fill is shown as it is', async () => {
    const host = await frame([a, b, c]);
    expect(q(host, 'insp-chip-fill')?.getAttribute('data-mixed')).toBe('true');
    expect(q(host, 'insp-chip-fill')?.textContent).toContain('Mixed');
    expect(q(host, 'insp-chip-fill')?.querySelectorAll('.insp-sw').length).toBe(2);
    const same = await frame([a, c]);
    expect(same.querySelector('[data-mixed="true"]')).toBeNull();
    expect(same.textContent).toContain('Ink');
  });

  test('a pick goes to all three — one write each — and the line says so', async () => {
    const host = await frame([a, b, c]);
    expect(q(host, 'insp-multi-note')?.textContent).toBe(
      'Changes go to all 3. Text settings show when only text is selected.'
    );
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-color-fill-accent'));
    expect(edits().map((p) => p.body.id)).toEqual(['a', 'b', 'c']);
    expect(edits().every((p) => p.body.property === 'background')).toBe(true);
    expect(edits().every((p) => p.body.value === 'var(--accent)')).toBe(true);
  });

  test('an object that already has the value is not written again', async () => {
    const host = await frame([a, b, c]);
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-color-fill-ink'));
    expect(edits().map((p) => p.body.id)).toEqual(['b']);
  });

  test('Opacity sits under Fill for several, and reads Mixed where they differ', async () => {
    const o = { ...a, authored: { background: 'var(--ink)', opacity: '0.5' } };
    const host = await frame([o, b]);
    expect(
      q(host, 'insp-sec-fill')?.querySelector('[data-testid="insp-row-opacity"]')
    ).not.toBeNull();
    expect(q(host, 'insp-mixed-opacity')).not.toBeNull();
    expect(q(host, 'insp-sec-effects')).toBeNull();
  });

  test('G2: Position and Size are drawn for several, with Mixed where the objects differ', async () => {
    const at = (id: string, i: number, left: string, width: string) => ({
      ...BOX,
      id,
      index: i,
      worldW: Number.parseInt(width, 10),
      authored: { position: 'absolute', left, top: '10px', width },
    });
    const host = await frame([at('a', 0, '64px', '200px'), at('b', 1, '70px', '240px')]);
    const order = [...host.querySelectorAll('[data-testid^="insp-sec-"]')].map((e) =>
      e.getAttribute('data-testid')
    );
    expect(order.slice(0, 3)).toEqual(['insp-sec-position', 'insp-sec-size', 'insp-sec-fill']);
    expect(q(host, 'insp-mixed-x')).not.toBeNull();
    expect(q(host, 'insp-mixed-y')).toBeNull();
    expect(q(host, 'insp-mixed-width')).not.toBeNull();
    expect(q(host, 'insp-num-rotation')).not.toBeNull();
    // one value for every object, one write each where it differs: X typed once puts b where a already is
    await enter(q(host, 'insp-num-x')?.querySelector('input') ?? null, '64');
    expect(edits().map((p) => [p.body.id, p.body.property, p.body.value])).toEqual([
      ['b', 'left', '64px'],
    ]);
  });

  test('G2: when they agree, nothing says Mixed', async () => {
    const same = (id: string, i: number) => ({
      ...BOX,
      id,
      index: i,
      authored: { position: 'absolute', left: '8px', top: '8px', width: '200px' },
    });
    const host = await frame([same('a', 0), same('b', 1)]);
    expect(q(host, 'insp-mixed-x')).toBeNull();
    expect(q(host, 'insp-mixed-width')).toBeNull();
  });

  test('text settings show only when every object is text', async () => {
    const t = (id: string, i: number) => ({
      ...BOX,
      id,
      index: i,
      tag: 'p',
      text: 'Hello',
      authored: { color: 'var(--ink)' },
    });
    const allText = await frame([t('x', 0), t('y', 1)]);
    expect(q(allText, 'insp-sec-type')).not.toBeNull();
    const mixedKinds = await frame([t('x', 0), a]);
    expect(q(mixedKinds, 'insp-sec-type')).toBeNull();
  });
});

describe('nothing written is an alias or a canvas-only name', () => {
  test('every var(--…) the sections wrote is one the system declares', async () => {
    const host = await one({ authored: { background: 'var(--ink)' } });
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-color-fill-accent'));
    await click(q(host, 'insp-add-border'));
    await click(q(host, 'insp-add-effects'));
    const values = edits().flatMap((p) => String(p.body.value ?? '').match(/--[a-z0-9-]+/g) ?? []);
    expect(values.length).toBeGreaterThan(2);
    for (const v of values) expect(DECLARED.has(v)).toBe(true);
    expect(edits().some((p) => String(p.body.property).startsWith('data-cd-'))).toBe(false);
  });
});
