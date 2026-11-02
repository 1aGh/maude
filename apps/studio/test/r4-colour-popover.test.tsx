// r4 #4 (Michal: "color picker bych udelal jak ma Figma, at tam jsou tabs jednotlivych backgrounds"): the Inspector colour
// popover is Figma-shaped — Custom | Libraries, Solid · Gradient · Image, a drawn area + rails + Hex/alpha, a stops bar.
// Real markup in the real inspector frame; only fetch is faked. Every control writes through /_api/edit-css.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseGradient } from '../client/v2/inspector/sections/colour-model.js';

const realFetch = globalThis.fetch;
type Post = { url: string; body: Record<string, unknown> };
const posts: Post[] = [];
const optimistic: Array<Record<string, unknown>> = [];
const recorded: Array<Record<string, unknown>> = [];
const TOKENS = `:root{${[
  '--bg-0: oklch(0.99 0 0);',
  '--bg-1: oklch(0.97 0 0);',
  '--fg-0: oklch(0.2 0 0);',
  '--ink: oklch(0.2 0.02 250);',
  '--paper: oklch(0.98 0.01 90);',
  '--accent: oklch(0.6 0.15 250);',
].join('\n')}}`;
let assetRows: Array<Record<string, unknown>> = [];
let pageSource =
  '<div style={{ background: "#ff8800" }} /><i style={{ color: "#ff8800", border: "1px solid #00aa55" }} />';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: unknown }) => {
    const u = String(url);
    if (u.endsWith('.css')) return new Response(TOKENS, { status: 200 });
    if (u.startsWith('/_api/index?part=assets'))
      return new Response(JSON.stringify({ ok: true, assets: assetRows }), { status: 200 });
    if (u.startsWith('/_api/canvas-source'))
      return new Response(
        JSON.stringify({
          ok: true,
          file: 'x',
          source: pageSource,
          lines: [],
          parsed: true,
          artboards: {},
          error: null,
        }),
        { status: 200 }
      );
    if (u === '/_api/asset')
      return new Response(JSON.stringify({ ok: true, path: 'assets/ab12cd34.png' }), {
        status: 200,
      });
    if (typeof init?.body === 'string') posts.push({ url: u, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, previous: 'before' }), { status: 200 });
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
beforeEach(() => {
  posts.length = 0;
  optimistic.length = 0;
  recorded.length = 0;
  assetRows = [];
  pageSource =
    '<div style={{ background: "#ff8800" }} /><i style={{ color: "#ff8800", border: "1px solid #00aa55" }} />';
  delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
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
const props = (el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  return (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[key];
};
const call = async (el: Element | null, handler: string, extra: Record<string, unknown> = {}) => {
  const e = must(el, handler) as HTMLInputElement;
  await act(async () =>
    props(e)[handler]({ currentTarget: e, target: e, preventDefault() {}, ...extra })
  );
  await settle();
};
const typeIn = async (el: Element | null, value: string, enter = true) => {
  const e = must(el, 'input') as HTMLInputElement;
  e.value = value;
  await call(e, 'onChange');
  if (enter) await call(e, 'onKeyDown', { key: 'Enter' });
};
const choose = async (el: HTMLSelectElement, value: string) => {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
const openChip = (host: HTMLElement, ctl: string) =>
  click(must(q(host, ctl), ctl).querySelector('button.insp-chip'), `${ctl} chip`);

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
const GRADIENT = { 'background-image': 'linear-gradient(90deg, #ff0000 0%, #0000ff 100%)' };
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};
const NO_DS = { designRel: '.design', designSystems: [] };

const reregistered: Array<() => void> = [];
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
    const mod = (await import(`../client/v2/inspector/${f}.jsx?r4cp=${generation}`)) as Record<
      string,
      unknown
    >;
    for (const [k, v] of Object.entries(mod))
      if (/^off[A-Z]/.test(k) && typeof v === 'function') reregistered.push(v as () => void);
  }
}
async function one(over: Record<string, unknown> = {}, cfg: Record<string, unknown> = CFG) {
  await ensureSections();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  return mount(
    <InspectorFrame
      {...({
        selected: { ...BOX, ...over },
        layersTree: { artboardId: 'desktop', nodes: [] },
        cfg,
        canvasFile: FILE,
        onOptimistic: (m: Record<string, unknown>) => optimistic.push(m),
        onRecordEdit: (m: Record<string, unknown>) => recorded.push(m),
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
      } as never)}
    />
  );
}
const edits = () => posts.filter((p) => p.url === '/_api/edit-css');
const written = () =>
  Object.fromEntries(edits().map((p) => [p.body.property, p.body.value ?? null]));
const lastImage = () =>
  String(
    edits()
      .filter((p) => p.body.property === 'background-image')
      .at(-1)?.body.value
  );

describe('the tabs say what the fill is', () => {
  test('Custom | Libraries on top, Solid · Gradient · Image under them — and nothing that cannot be drawn', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    expect(q(host, 'insp-tab-custom-fill')?.textContent).toBe('Custom');
    expect(q(host, 'insp-tab-libraries-fill')?.textContent).toBe('Libraries');
    await click(q(host, 'insp-tab-custom-fill')); // the kinds say what the fill IS: Custom only (r5-3)
    const kinds = [...must(q(host, 'insp-kinds-fill'), 'kinds').querySelectorAll('button')].map(
      (b) => b.textContent
    );
    expect(kinds).toEqual(['Solid', 'Gradient', 'Image']); // no Pattern, Video or Shader: the canvas cannot draw them
    expect(q(host, 'insp-kind-solid-fill')?.getAttribute('aria-selected')).toBe('true');
  });

  test('a token colour opens on Libraries (system first); a raw colour opens on Custom', async () => {
    const tok = await one();
    await openChip(tok, 'insp-ctl-fill');
    expect(q(tok, 'insp-tab-libraries-fill')?.getAttribute('aria-selected')).toBe('true');
    expect(q(tok, 'insp-pop-search-fill')).not.toBeNull();
    const raw = await one({ authored: { background: '#1e6bff' } });
    const ctl = raw.querySelectorAll('[data-testid="insp-ctl-fill"]');
    await click(ctl[ctl.length - 1].querySelector('button.insp-chip'));
    const pops = document.querySelectorAll('[data-testid="insp-menu-fill"]');
    expect(pops[pops.length - 1].getAttribute('data-tab')).toBe('custom');
  });

  test('Gradient switches the fill to a gradient from the colour it had; Solid takes the first stop back', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    await click(q(host, 'insp-kind-gradient-fill'));
    expect(q(host, 'insp-kind-gradient-fill')?.getAttribute('aria-selected')).toBe('true');
    const w = written();
    expect(w.background).toBeNull(); // the solid is gone: it is a gradient now
    expect(parseGradient(String(w['background-image']))?.type).toBe('linear');
    expect(q(host, 'insp-gradient-fill')).not.toBeNull();
    await click(q(host, 'insp-kind-solid-fill'));
    expect(q(host, 'insp-solid-fill')).not.toBeNull();
    // the gradient layer was removed again (a reset, no value) and the colour is back
    expect(
      edits().some((p) => p.body.property === 'background-image' && p.body.reset === true)
    ).toBe(true);
    const back = edits()
      .filter((p) => p.body.property === 'background')
      .at(-1);
    expect(String(back?.body.value)).toMatch(/^#[0-9a-f]{6}$/); // the first stop is the solid again
  });

  test('Image shows its editor but writes nothing until a picture is chosen', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    await click(q(host, 'insp-kind-image-fill'));
    expect(q(host, 'insp-image-fill')).not.toBeNull();
    expect(q(host, 'insp-image-name-fill')?.textContent).toBe('No picture yet.');
    expect(edits()).toEqual([]);
  });

  test('a text or border colour is always a solid: no kind tabs', async () => {
    const { ColorControl } = await import('../client/v2/inspector/sections/color-control.jsx');
    const host = await mount(
      <ColorControl
        name="type-colour"
        label="Text colour"
        value={{ paint: { css: '#112233' }, opacity: 100 }}
        colors={[]}
        onChange={() => {}}
      />
    );
    await openChip(host, 'insp-ctl-type-colour');
    expect(q(host, 'insp-kinds-type-colour')).toBeNull();
    expect(q(host, 'insp-solid-type-colour')).not.toBeNull();
  });
});

describe('Solid', () => {
  test('hex and alpha round-trip: typed, written once each, and read back into the fields', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    await typeIn(q(host, 'insp-colorin-fill'), '1E6BFF');
    expect(written()).toEqual({ background: '#1e6bff' });
    expect((q(host, 'insp-colorin-fill') as HTMLInputElement).value).toBe('1E6BFF');
    posts.length = 0;
    await typeIn(q(host, 'insp-solid-alpha-fill'), '50');
    expect(written()).toEqual({ background: 'color-mix(in srgb, #1e6bff 50%, transparent)' });
    expect((q(host, 'insp-solid-alpha-fill') as HTMLInputElement).value).toBe('50');
    expect((q(host, 'insp-colorin-fill') as HTMLInputElement).value).toBe('1E6BFF'); // alpha did not move the colour
  });

  test('a bad hex is refused with a line, and writes nothing', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    await typeIn(q(host, 'insp-colorin-fill'), 'nonsense');
    expect(edits()).toEqual([]);
    expect(q(host, 'insp-pop-bad-fill')?.textContent).toContain('isn’t one colour');
  });

  test('RGB and HSL fields write the same colour the Hex field does', async () => {
    const host = await one({ authored: { background: '#102030' } });
    await openChip(host, 'insp-ctl-fill');
    const model = must(q(host, 'insp-solid-model-fill'), 'model') as HTMLSelectElement;
    await choose(model, 'rgb');
    expect((q(host, 'insp-solid-r-fill') as HTMLInputElement).value).toBe('16');
    await typeIn(q(host, 'insp-solid-r-fill'), '255');
    expect(written()).toEqual({ background: '#ff2030' });
  });

  test('dragging previews on the canvas and writes nothing; the release writes once (one undo step)', async () => {
    const host = await one({ authored: { background: '#336699' } });
    await openChip(host, 'insp-ctl-fill');
    const area = must(q(host, 'insp-solid-area-fill'), 'area');
    await call(area, 'onKeyDown', { key: 'ArrowRight', shiftKey: true });
    await call(area, 'onKeyDown', { key: 'ArrowUp', shiftKey: true });
    expect(optimistic.length).toBeGreaterThan(0); // the live element followed
    expect(optimistic.at(-1)).toMatchObject({ prop: 'background' });
    expect(edits()).toEqual([]); // nothing written yet
    await call(area, 'onKeyUp');
    expect(edits().length).toBe(1);
    expect(recorded.length).toBe(1);
    expect(String(edits()[0].body.value)).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('the hue rail commits on release, the opacity rail writes the fill’s opacity', async () => {
    const host = await one({ authored: { background: '#ff0000' } });
    await openChip(host, 'insp-ctl-fill');
    const hue = must(q(host, 'insp-solid-hue-fill'), 'hue') as HTMLInputElement;
    hue.value = '120';
    await call(hue, 'onChange');
    expect(edits()).toEqual([]);
    await call(hue, 'onPointerUp');
    expect(written()).toEqual({ background: '#00ff00' });
    posts.length = 0;
    const rail = must(q(host, 'insp-solid-alpharail-fill'), 'alpha') as HTMLInputElement;
    rail.value = '25';
    await call(rail, 'onChange');
    await call(rail, 'onPointerUp');
    expect(written()).toEqual({ background: 'color-mix(in srgb, #00ff00 25%, transparent)' });
  });

  test('the eyedropper is drawn only where the browser has one — never a dead button', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    expect(q(host, 'insp-solid-eyedropper-fill')).toBeNull();
    (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: '#00aa55' });
      }
    };
    const again = await one({ authored: { background: '#102030' } });
    const ctl = again.querySelector('[data-testid="insp-ctl-fill"]');
    await click(ctl?.querySelector('button.insp-chip') ?? null);
    const dropper = document.querySelectorAll('[data-testid="insp-solid-eyedropper-fill"]');
    expect(dropper.length).toBe(1);
    await click(dropper[0]);
    expect(written()).toEqual({ background: '#00aa55' });
  });

  test('"On this page" lists the colours this canvas uses; picking one writes it', async () => {
    const host = await one({ authored: { background: '#102030' } });
    await openChip(host, 'insp-ctl-fill');
    expect(q(host, 'insp-pop-page-fill')?.textContent).toContain('On this page');
    const cells = [...host.querySelectorAll('[data-testid^="insp-page-fill-"]')];
    expect(cells.map((c) => c.getAttribute('aria-label'))).toEqual(['#ff8800', '#00aa55']);
    await click(cells[1]);
    expect(written()).toEqual({ background: '#00aa55' });
  });
});

describe('Gradient', () => {
  const open = async () => {
    const host = await one({ authored: { ...GRADIENT } });
    await openChip(host, 'insp-ctl-fill');
    return host;
  };

  test('a gradient fill opens on Custom → Gradient, its stops as rows, the chip says what it is', async () => {
    const host = await open();
    expect(q(host, 'insp-kind-gradient-fill')?.getAttribute('aria-selected')).toBe('true');
    expect(q(host, 'insp-grow-fill-0')).not.toBeNull();
    expect(q(host, 'insp-grow-fill-1')).not.toBeNull();
    expect((q(host, 'insp-gtype-fill') as HTMLSelectElement).value).toBe('linear');
    expect(q(host, 'insp-chip-fill')?.textContent).toContain('Linear gradient');
  });

  test('add, move, recolour and remove a stop: every write is a valid gradient', async () => {
    const host = await open();
    await click(q(host, 'insp-gadd-fill'));
    expect(parseGradient(lastImage())?.stops.length).toBe(3);
    expect(parseGradient(lastImage())?.stops.map((s) => s.pos)).toEqual([0, 50, 100]);
    await typeIn(q(host, 'insp-gpos-fill-1'), '30');
    expect(parseGradient(lastImage())?.stops.map((s) => s.pos)).toEqual([0, 30, 100]);
    await typeIn(q(host, 'insp-ghex-fill-0'), '00FF00');
    expect(parseGradient(lastImage())?.stops[0].color).toBe('#00ff00');
    await click(q(host, 'insp-gremove-fill-1'));
    const g = parseGradient(lastImage());
    expect(g?.stops.map((s) => s.color)).toEqual(['#00ff00', '#0000ff']);
    expect(edits().every((p) => p.body.property.toString().startsWith('background'))).toBe(true);
    // two stops is the floor: the minus is off, and says why
    const minus = q(host, 'insp-gremove-fill-0') as HTMLButtonElement;
    expect(minus.disabled).toBe(true);
    expect(minus.title).toMatch(/two stops/);
  });

  test('a stop on the bar: arrows move it (live → committed), Delete removes it', async () => {
    const host = await open();
    await click(q(host, 'insp-gadd-fill'));
    const stop = must(q(host, 'insp-gstop-fill-1'), 'stop');
    expect(stop.getAttribute('role')).toBe('slider');
    await call(stop, 'onKeyDown', { key: 'ArrowRight' });
    expect(parseGradient(lastImage())?.stops[1].pos).toBe(51);
    await call(must(q(host, 'insp-gstop-fill-1'), 'stop'), 'onKeyDown', { key: 'Delete' });
    expect(parseGradient(lastImage())?.stops.length).toBe(2);
  });

  test('type and angle: Radial and Angular rewrite the gradient, the angle is a number', async () => {
    const host = await open();
    await typeIn(q(host, 'insp-gangle-fill'), '45');
    expect(lastImage()).toBe('linear-gradient(45deg, #ff0000 0%, #0000ff 100%)');
    const type = must(q(host, 'insp-gtype-fill'), 'type') as HTMLSelectElement;
    await choose(type, 'radial');
    expect(lastImage()).toBe('radial-gradient(circle, #ff0000 0%, #0000ff 100%)');
    expect(q(host, 'insp-gangle-fill')).toBeNull(); // a radial gradient has no angle
    await choose(type, 'conic');
    expect(lastImage()).toBe('conic-gradient(from 0deg, #ff0000 0%, #0000ff 100%)');
  });

  test('Reverse flips the stops', async () => {
    const host = await open();
    await click(q(host, 'insp-greverse-fill'));
    expect(parseGradient(lastImage())?.stops.map((s) => [s.color, s.pos])).toEqual([
      ['#0000ff', 0],
      ['#ff0000', 100],
    ]);
  });

  test('Libraries: the system’s colours are listed; picking one colours the selected stop with var(--token)', async () => {
    const host = await open();
    await click(q(host, 'insp-gsw-fill-1'));
    await click(q(host, 'insp-tab-libraries-fill'));
    const names = [...host.querySelectorAll('[data-testid^="insp-color-fill-"]')].map((e) =>
      e.getAttribute('data-testid')
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'insp-color-fill-ink',
        'insp-color-fill-paper',
        'insp-color-fill-accent',
      ])
    );
    await click(q(host, 'insp-color-fill-paper'));
    expect(parseGradient(lastImage())?.stops.map((s) => s.color)).toEqual([
      '#ff0000',
      'var(--paper)',
    ]);
    expect(q(host, 'insp-menu-fill')).not.toBeNull(); // the popover stays open: a stop is one of several edits
  });

  test('a gradient the picker does not own is said so, and the type menu replaces it', async () => {
    const host = await one({
      authored: { 'background-image': 'repeating-linear-gradient(45deg, #fff 0%, #000 10%)' },
    });
    await openChip(host, 'insp-ctl-fill');
    expect(q(host, 'insp-gunreadable-fill')?.textContent).toContain('doesn’t edit');
  });
});

describe('Image', () => {
  test('Upload from computer adds the file to Assets and fills with it; the chip then names the file', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    await click(q(host, 'insp-kind-image-fill'));
    const input = must(q(host, 'insp-image-input-fill'), 'file input') as HTMLInputElement;
    const file = new window.File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    await act(async () => {
      props(input).onChange({ currentTarget: { files: [file], value: 'x' } });
    });
    await settle();
    await settle();
    const w = written();
    expect(w.background).toBeNull();
    expect(w['background-image']).toBe('url("assets/ab12cd34.png")');
    expect(q(host, 'insp-chip-fill')?.textContent).toContain('ab12cd34.png');
    expect(q(host, 'insp-image-name-fill')?.textContent).toBe('ab12cd34.png');
  });

  test('a path or an https:// address works; anything else is refused with a line and writes nothing', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    await click(q(host, 'insp-kind-image-fill'));
    await typeIn(q(host, 'insp-image-url-fill'), 'javascript:alert(1)');
    expect(edits()).toEqual([]);
    expect(q(host, 'insp-image-say-fill')?.textContent).toContain('https://');
    await typeIn(q(host, 'insp-image-url-fill'), 'assets/hero.jpg');
    expect(written()['background-image']).toBe('url("assets/hero.jpg")');
  });
});

describe('no dead controls', () => {
  test('every button in the open popover is enabled or says why it is not', async () => {
    for (const authored of [
      { background: 'var(--ink)' },
      { ...GRADIENT },
      { background: '#1e6bff' },
    ]) {
      const host = await one({ authored });
      await openChip(host, 'insp-ctl-fill');
      for (const tab of ['custom', 'libraries']) {
        await click(q(host, `insp-tab-${tab}-fill`));
        const pop = must(q(host, 'insp-menu-fill'), 'popover');
        for (const b of pop.querySelectorAll('button')) {
          const dead = (b as HTMLButtonElement).disabled;
          if (dead) expect((b as HTMLButtonElement).title).not.toBe(''); // a disabled button says why
        }
      }
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      document.body.innerHTML = '';
    }
  });

  test('every kind tab does something: it is selected after a click', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    for (const k of ['gradient', 'image', 'solid']) {
      await click(q(host, `insp-kind-${k}-fill`));
      expect(q(host, `insp-kind-${k}-fill`)?.getAttribute('aria-selected')).toBe('true');
    }
  });

  test('without a design system Libraries says so and Custom still works end to end', async () => {
    const host = await one({}, NO_DS);
    await openChip(host, 'insp-ctl-fill');
    expect(q(host, 'insp-tab-custom-fill')?.getAttribute('aria-selected')).toBe('true');
    await typeIn(q(host, 'insp-colorin-fill'), '#1e6bff');
    expect(written()).toEqual({ background: '#1e6bff' });
    expect(q(host, 'ds-off-system')).toBeNull(); // no system, no question
  });
});

// ── r5 (Michal, READY TO TRY 13) ────────────────────────────────────────────────────────────────────────────────────
const ptr = (el: Element, type: string, x: number, id = 1) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clientX', { value: x });
  Object.defineProperty(e, 'clientY', { value: 0 });
  Object.defineProperty(e, 'pointerId', { value: id });
  return act(async () => {
    el.dispatchEvent(e);
  });
};

describe('r5-3 Libraries is a list of named rows', () => {
  test('no Solid · Gradient · Image tabs on Libraries; they stay on Custom', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill'); // a token colour opens on Libraries
    expect(q(host, 'insp-tab-libraries-fill')?.getAttribute('aria-selected')).toBe('true');
    expect(q(host, 'insp-kinds-fill')).toBeNull();
    await click(q(host, 'insp-tab-custom-fill'));
    expect(q(host, 'insp-kinds-fill')).not.toBeNull();
    await click(q(host, 'insp-tab-libraries-fill'));
    expect(q(host, 'insp-kinds-fill')).toBeNull();
  });

  test('every token is a row with its swatch and its name, grouped under a heading; search filters; a click writes it', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    const ink = must(q(host, 'insp-color-fill-ink'), 'ink row');
    expect(ink.classList.contains('insp-pop-row')).toBe(true);
    expect(ink.querySelector('.insp-pop-sw')).not.toBeNull();
    expect(ink.textContent).toContain('Ink');
    expect(
      ink.closest('[data-testid^="insp-pop-group-fill-"]')?.querySelector('.insp-pop-gt')
    ).not.toBeNull();
    expect(host.querySelectorAll('.insp-pop-row').length).toBeGreaterThanOrEqual(5);
    await typeIn(q(host, 'insp-pop-search-fill'), 'paper', false);
    const left = [...host.querySelectorAll('.insp-pop-row')].map((r) => r.textContent);
    expect(left).toEqual(['Paper']);
    await click(q(host, 'insp-color-fill-paper'));
    expect(written()).toEqual({ background: 'var(--paper)' });
  });

  test('↓ walks the rows one by one, ↑ goes back to Search', async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    const pop = must(q(host, 'insp-menu-fill'), 'popover');
    const rows = [...host.querySelectorAll<HTMLElement>('.insp-pop-row')];
    rows[0].focus();
    await call(pop, 'onKeyDown', { key: 'ArrowDown', target: rows[0] });
    expect(document.activeElement).toBe(rows[1]);
    await call(pop, 'onKeyDown', { key: 'ArrowUp', target: rows[1] });
    expect(document.activeElement).toBe(rows[0]);
    // above the first row: the Recent swatches when there are some (an earlier test picked a colour), else Search
    const cells = [...pop.querySelectorAll('[data-cell]')];
    const above = cells[cells.indexOf(rows[0]) - 1] ?? q(host, 'insp-pop-search-fill');
    await call(pop, 'onKeyDown', { key: 'ArrowUp', target: rows[0] });
    expect(document.activeElement).toBe(above);
  });
});

describe('r5-4 switching tabs never closes the card', () => {
  // The Popover API returns focus to whatever had it before the card opened (in the app: the canvas frame) when the
  // popover is hidden. The old effect hid and re-showed the popover on every tab / kind change, so the card's own focus
  // handler saw focus leave and closed it. Emulate that return.
  let hides = 0;
  let outside: HTMLElement | null = null;
  const proto = () => window.HTMLElement.prototype as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  beforeEach(() => {
    hides = 0;
    for (const k of ['showPopover', 'hidePopover']) saved[k] = proto()[k];
    proto().showPopover = () => {};
    proto().hidePopover = function (this: HTMLElement) {
      hides += 1;
      const active = document.activeElement;
      if (outside && active && this.contains(active)) {
        outside.focus();
        const ev = new window.Event('focusout', { bubbles: true });
        Object.defineProperty(ev, 'relatedTarget', { value: outside });
        active.dispatchEvent(ev);
      }
    };
    outside = document.createElement('iframe');
    document.body.append(outside);
  });
  afterEach(() => {
    for (const k of ['showPopover', 'hidePopover']) proto()[k] = saved[k];
    outside?.remove();
  });

  test('Custom ↔ Libraries and Solid · Gradient · Image leave the card open, focused tab or not', async () => {
    const host = await one({ authored: { background: '#336699' } });
    await openChip(host, 'insp-ctl-fill');
    const steps = [
      'insp-tab-libraries-fill',
      'insp-tab-custom-fill',
      'insp-kind-gradient-fill',
      'insp-kind-image-fill',
      'insp-kind-solid-fill',
      'insp-kind-gradient-fill',
    ];
    const before = hides;
    for (const id of steps) {
      const b = must(q(host, id), id);
      b.focus();
      await ptr(b, 'pointerdown', 5);
      await click(b, id);
      expect(q(host, 'insp-menu-fill')).not.toBeNull();
    }
    expect(hides).toBe(before); // the popover is hidden once, when the card goes away — never to switch a tab
  });
});

describe('r5-5 the gradient stops drag', () => {
  const open = async () => {
    const host = await one({ authored: { ...GRADIENT } });
    await openChip(host, 'insp-ctl-fill');
    const bar = must(q(host, 'insp-gbar-fill'), 'bar');
    // a real-sized bar: 200 px wide, 10 px from the left edge
    bar.getBoundingClientRect = () =>
      ({
        left: 10,
        right: 210,
        top: 0,
        bottom: 24,
        width: 200,
        height: 24,
        x: 10,
        y: 0,
      }) as DOMRect;
    return { host, bar };
  };
  // the browser sends a captured pointer's moves to the element that captured it
  let captured: Element | null = null;
  const hp = () => window.HTMLElement.prototype as unknown as Record<string, unknown>;
  let savedCapture: unknown;
  beforeEach(() => {
    captured = null;
    savedCapture = hp().setPointerCapture;
    hp().setPointerCapture = function (this: Element) {
      captured = this;
    };
  });
  afterEach(() => {
    hp().setPointerCapture = savedCapture;
  });
  const grab = async (host: HTMLElement, i: number, x: number) => {
    const stop = must(q(host, `insp-gstop-fill-${i}`), 'stop');
    await ptr(stop, 'pointerdown', x);
    return stop;
  };

  test('grab the last ball, drag it to the middle: the bar follows live, the release writes once', async () => {
    const { host } = await open();
    const stop = await grab(host, 1, 210);
    const target = captured ?? stop;
    await ptr(target, 'pointermove', 110);
    expect(optimistic.length).toBeGreaterThan(0); // the canvas followed
    expect(edits()).toEqual([]); // nothing written mid-drag
    await ptr(target, 'pointermove', 60);
    await ptr(target, 'pointerup', 60);
    expect(parseGradient(lastImage())?.stops.map((s) => s.pos)).toEqual([0, 25]);
    expect(edits().filter((p) => p.body.property === 'background-image').length).toBe(1);
  });

  test('a ball dragged past another one is still the ball in the hand', async () => {
    const { host } = await open();
    await click(q(host, 'insp-gadd-fill')); // stops at 0, 50, 100
    const stop = await grab(host, 0, 10);
    const target = captured ?? stop;
    await ptr(target, 'pointermove', 160); // 75 %: past the middle ball
    await ptr(target, 'pointermove', 190); // 90 %
    await ptr(target, 'pointerup', 190);
    const g = parseGradient(lastImage());
    expect(g?.stops.map((s) => s.pos)).toEqual([50, 90, 100]);
    expect(g?.stops[1].color).toBe('#ff0000'); // the red ball, moved
  });

  test('a press on the bar still adds a stop; moves without a grab change nothing', async () => {
    const { bar } = await open();
    await ptr(bar, 'pointermove', 100);
    expect(edits()).toEqual([]);
    await ptr(bar, 'pointerdown', 110);
    expect(parseGradient(lastImage())?.stops.length).toBe(3);
  });
});

describe('r5-6 the Image tab picks from Assets', () => {
  const rows = () => [
    { rel: 'assets/a1b2c3d4.png', kind: 'image', size: 10, mtimeMs: 3 },
    { rel: 'assets/clip0001.mp4', kind: 'video', size: 10, mtimeMs: 2 },
    { rel: 'assets/hero.jpg', kind: 'image', size: 10, mtimeMs: 1 },
  ];
  const openImage = async () => {
    const host = await one();
    await openChip(host, 'insp-ctl-fill');
    await click(q(host, 'insp-tab-custom-fill'));
    await click(q(host, 'insp-kind-image-fill'));
    await settle();
    return host;
  };

  test('the project’s pictures are listed (no video), each with its name; choosing one fills with it', async () => {
    assetRows = rows();
    const host = await openImage();
    const items = [...host.querySelectorAll('[data-testid^="insp-image-asset-fill-"]')];
    expect(items.map((i) => i.getAttribute('data-asset'))).toEqual([
      'assets/a1b2c3d4.png',
      'assets/hero.jpg',
    ]);
    expect(items[0].querySelector('img')?.getAttribute('src')).toBe('/.design/assets/a1b2c3d4.png');
    expect(items[1].getAttribute('aria-label')).toContain('hero.jpg');
    await click(items[1]);
    const w = written();
    expect(w.background).toBeNull();
    expect(w['background-image']).toBe('url("assets/hero.jpg")');
    expect(q(host, 'insp-image-name-fill')?.textContent).toBe('hero.jpg');
  });

  test('Upload and the path field are still there; an empty Assets says so', async () => {
    const host = await openImage();
    expect(q(host, 'insp-image-upload-fill')).not.toBeNull();
    expect(q(host, 'insp-image-url-fill')).not.toBeNull();
    expect(q(host, 'insp-image-assets-empty-fill')?.textContent).toContain('Assets');
    expect(host.querySelectorAll('[data-testid^="insp-image-asset-fill-"]').length).toBe(0);
  });
});
