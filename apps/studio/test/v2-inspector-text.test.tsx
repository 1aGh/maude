// S2.12 (ed-text-style) — a text object's Type section in the inspector frame: the style from the system's
// `components.json` typeRoles, the dot when this object sets over it, Reset, Detach → "No style" → Use a style,
// Resizing, Case and Language. Real markup and registry; only fetch is faked. Every change is ONE run-action
// asked of the canvas (the canvas writes the edit-op); Resizing is the words → CSS lane (/_api/edit-css).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
type Post = { url: string; body: Record<string, unknown> };
const posts: Post[] = [];
const COMPONENTS = {
  typeRoles: { title: 't-title', heading: 't-heading', body: 't-body', eyebrow: 't-eyebrow' },
};

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith('components.json'))
      return new Response(JSON.stringify(COMPONENTS), { status: 200 });
    if (String(url).endsWith('.css'))
      return new Response(
        ':root{--space-4:16px;--font-sans:"Avenir Next", sans-serif;--font-size-base:16px;}',
        {
          status: 200,
        }
      );
    if (init?.body) posts.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, previous: null }), { status: 200 });
  }) as unknown as typeof fetch;
});
const reregistered: Array<() => void> = [];
let generation = 0;
/** The registry is process-wide and another file's afterAll empties it: put the Type bodies back. */
async function ensureTypeSlots() {
  await import('../client/v2/inspector/sections/index.js');
  const { slotsFor } = await import('../client/v2/inspector/slots.js');
  if (slotsFor('type', 'text').length >= 3) return;
  generation += 1;
  for (const f of ['sections/type', 'kinds/text']) {
    const mod = (await import(`../client/v2/inspector/${f}.jsx?s212=${generation}`)) as Record<
      string,
      unknown
    >;
    for (const [k, v] of Object.entries(mod))
      if (/^off[A-Z]/.test(k) && typeof v === 'function') reregistered.push(v as () => void);
  }
}

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
  const { clearTypeRoles } = await import('../client/v2/inspector/kinds/text.jsx');
  clearTypeRoles();
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
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
const radio = (host: HTMLElement, group: string, label: string) =>
  must(
    Array.from(q(host, group)?.querySelectorAll('[role="radio"]') ?? []).find(
      (b) => b.textContent === label
    ) ?? null,
    `${label} in ${group}`
  );

const FILE = '.design/ui/Poster.tsx';
const REF = { artboard: 'post', element: 'headline' };
const TITLE = {
  id: 'headline',
  index: 0,
  file: FILE,
  tag: 'h1',
  classes: 't-heading',
  selector: '[data-dc-screen="post"] [data-cd-id="headline"]',
  text: 'Jdu v lese',
  bounds: { x: 100, y: 100, w: 600, h: 140 },
  worldW: 600,
  worldH: 140,
  dom_path: ['article', 'h1.t-heading'],
  authored: {} as Record<string, string>,
  computed: { 'font-size': '28px', 'text-transform': 'none' } as Record<string, string>,
  customStyles: {},
  attrs: {},
  artboardId: 'post',
  refs: [REF],
  textInfo: {
    role: 't-heading',
    values: { 'font-size': '28px', 'font-weight': '700' },
    differs: [] as string[],
    lang: '',
    upper: false,
  },
};
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};
const runs: Array<Record<string, unknown>> = [];
const shellRuns: Array<[string, Record<string, unknown>]> = [];

async function frame(el: Record<string, unknown> = {}) {
  await ensureTypeSlots();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  runs.length = 0;
  shellRuns.length = 0;
  return mount(
    <InspectorFrame
      {...({
        selected: { ...TITLE, ...el },
        layersTree: { artboardId: 'post', nodes: [] },
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
const info = (over: Record<string, unknown>) => ({ ...TITLE.textInfo, ...over });

describe('Style', () => {
  test('a text on its style says which, from the system’s own roles, and what it follows', async () => {
    const host = await frame();
    expect(q(host, 'insp-style')?.textContent).toContain('Heading');
    expect(q(host, 'insp-mod-style')).toBeNull();
    expect(q(host, 'insp-style-follows')?.textContent).toBe(
      'Change Heading in the Design system and this follows.'
    );
    expect(q(host, 'insp-type-from')?.textContent).toBe('from Heading');
    await click(q(host, 'insp-style'));
    const items = Array.from(
      q(host, 'insp-menu-style')?.querySelectorAll('[role="menuitemradio"]') ?? []
    );
    expect(items.map((i) => i.textContent)).toEqual(['Title', 'Heading', 'Body', 'Eyebrow']);
    expect(q(host, 'insp-style-heading')?.getAttribute('aria-checked')).toBe('true');
  });

  test('picking a style asks the canvas for text.use-style with that class — nothing is written here', async () => {
    const host = await frame();
    await click(q(host, 'insp-style'));
    await click(q(host, 'insp-style-title'));
    expect(runs).toHaveLength(1);
    expect(lastRun()).toMatchObject({
      dgn: 'run-action',
      id: 'text.use-style',
      params: { targets: [REF], role: 't-title' },
    });
    expect(posts).toEqual([]);
  });

  test('a size set over the style wears the dot, says what differs, and Reset asks text.reset-style', async () => {
    const host = await frame({ textInfo: info({ differs: ['font-size'] }) });
    expect(q(host, 'insp-mod-style')?.getAttribute('aria-label')).toBe('Changed here');
    expect(q(host, 'insp-mod-type-size')).not.toBeNull();
    expect(q(host, 'insp-style')?.textContent).toContain('Heading · changed');
    expect(q(host, 'insp-style-differs')?.textContent).toContain('Size differs from Heading.');
    expect(q(host, 'insp-type-from')).toBeNull();
    await click(q(host, 'insp-style-reset'));
    expect(lastRun()).toMatchObject({ id: 'text.reset-style', params: { targets: [REF] } });
  });

  test('two differences are said together', async () => {
    const host = await frame({ textInfo: info({ differs: ['font-size', 'text-transform'] }) });
    expect(q(host, 'insp-style-differs')?.textContent).toContain(
      'Size and case differ from Heading.'
    );
  });

  test('Detach asks text.detach-style (the canvas measures the style’s values), and writes nothing here', async () => {
    const host = await frame();
    await click(q(host, 'insp-style'));
    await click(q(host, 'insp-style-detach'));
    expect(lastRun()).toMatchObject({ id: 'text.detach-style', params: { targets: [REF] } });
    expect(posts).toEqual([]);
  });

  test('a text with no style: No style, and Use a style opens the choices', async () => {
    const host = await frame({ classes: '', textInfo: info({ role: null, values: {} }) });
    expect(q(host, 'insp-style')?.textContent).toContain('No style');
    expect(q(host, 'insp-style-detach')).toBeNull();
    expect(q(host, 'insp-style-none')?.textContent).toContain('This text follows no style.');
    await click(q(host, 'insp-style-use'));
    expect(q(host, 'insp-menu-style')).not.toBeNull();
    await click(q(host, 'insp-style-body'));
    expect(lastRun()).toMatchObject({ id: 'text.use-style', params: { role: 't-body' } });
  });

  test('"Update … for every canvas…" is drawn when the style differs, and asks the shell for ds.review-update', async () => {
    const { ACTIONS_BY_ID } = await import('../actions/index.ts');
    expect(ACTIONS_BY_ID.has('ds.review-update')).toBe(true);
    const host = await frame({ textInfo: info({ differs: ['font-size'] }) });
    const link = q(host, 'insp-style-update');
    expect(link).not.toBeNull();
    await click(link);
    expect(shellRuns).toEqual([
      [
        'ds.review-update',
        { canvas: FILE, elementId: 'headline', target: { kind: 'typeRole', role: 'heading' } },
      ],
    ]);
  });

  test('a viewer cannot ask: the control is disabled when the canvas cannot be asked', async () => {
    await ensureTypeSlots();
    const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
    const host = await mount(
      <InspectorFrame
        {...({
          selected: TITLE,
          layersTree: { artboardId: 'post', nodes: [] },
          cfg: CFG,
          canvasFile: FILE,
          onOptimistic: () => {},
          onRecordEdit: () => {},
          onReplaceMedia: () => {},
          onUndoRedo: () => {},
        } as never)}
      />
    );
    expect((q(host, 'insp-style') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Case and Language', () => {
  test('AA asks text.set-case upper; As typed asks it back', async () => {
    const host = await frame();
    await click(radio(host, 'insp-ctl-case', 'AA'));
    expect(lastRun()).toMatchObject({
      id: 'text.set-case',
      params: { targets: [REF], case: 'upper' },
    });
    const host2 = await frame({ textInfo: info({ upper: true }) });
    expect(radio(host2, 'insp-ctl-case', 'AA').getAttribute('aria-checked')).toBe('true');
    await click(radio(host2, 'insp-ctl-case', 'As typed'));
    expect(lastRun()).toMatchObject({ id: 'text.set-case', params: { case: 'typed' } });
  });

  // p8-sweep-errors (1) — the crawl's 409: Case / Language on a locked text asked an op the server refuses
  test('a locked text: Case, Language and Style are off with the lock line, and ask nothing', async () => {
    const { REASONS } = await import('../client/v2/access/disabled-reason.js');
    const host = await frame({ attrs: { 'data-cd-locked': '' } });
    const aa = radio(host, 'insp-ctl-case', 'AA') as HTMLButtonElement;
    expect(aa.disabled).toBe(true);
    expect(aa.getAttribute('title')).toBe(REASONS.locked);
    await click(aa);
    const lang = q(host, 'insp-language') as HTMLSelectElement;
    expect(lang.disabled).toBe(true);
    expect(lang.getAttribute('aria-description')).toBe(REASONS.locked);
    await pick(lang, 'cs');
    expect((q(host, 'insp-style') as HTMLButtonElement).disabled).toBe(true);
    expect(q(host, 'insp-style')?.getAttribute('title')).toBe(REASONS.locked);
    expect(runs).toHaveLength(0);
  });

  test('Čeština asks text.set-language cs, and says what it does for the copy', async () => {
    const host = await frame();
    expect(q(host, 'insp-language-note')).toBeNull();
    await pick(q(host, 'insp-language'), 'cs');
    expect(lastRun()).toMatchObject({
      id: 'text.set-language',
      params: { targets: [REF], lang: 'cs' },
    });
    const host2 = await frame({ textInfo: info({ lang: 'cs' }) });
    expect((q(host2, 'insp-language') as HTMLSelectElement).value).toBe('cs');
    expect(q(host2, 'insp-language-note')?.textContent).toBe(
      'Čeština: one-letter words stay with the next word (the ties under “v” and “s”), „quotes“ turn Czech.'
    );
  });

  test('cs-CZ is Čeština; a language the list does not know is "Not set" rather than a wrong name', async () => {
    const host = await frame({ textInfo: info({ lang: 'cs-CZ' }) });
    expect((q(host, 'insp-language') as HTMLSelectElement).value).toBe('cs');
    const host2 = await frame({ textInfo: info({ lang: '' }) });
    expect((q(host2, 'insp-language') as HTMLSelectElement).value).toBe('');
  });
});

describe('G6 — the Type section of a text: Font · Line · letter · Align', () => {
  const reactProps = (el: Element) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
    return (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[key];
  };
  const enterNum = async (host: HTMLElement, id: string, value: string) => {
    const input = must(q(host, id)?.querySelector('input') ?? null, id) as HTMLInputElement;
    input.value = value;
    await act(async () => reactProps(input).onBlur({ currentTarget: input }));
    await settle();
  };
  const edited = () =>
    Object.fromEntries(
      posts.filter((p) => p.url === '/_api/edit-css').map((p) => [p.body.property, p.body.value])
    );

  test('the rows are there in the canvas’s order, and a text’s section does not say "text inside"', async () => {
    const host = await frame();
    const rows = [
      ...(q(host, 'insp-sec-type')?.querySelectorAll('[data-testid^="insp-row-"]') ?? []),
    ].map((e) => e.getAttribute('data-testid')?.replace('insp-row-', ''));
    expect(rows.slice(0, 5)).toEqual(['style', 'font', 'type-size', 'line-letter', 'align']);
    expect(q(host, 'insp-sec-type')?.querySelector('.insp-sec-a')).toBeNull();
  });

  test('a frame whose text it sets still says "text inside"', async () => {
    const host = await frame({ tag: 'div', text: '', textInfo: null, authored: {} });
    expect(q(host, 'insp-sec-type')?.querySelector('.insp-sec-a')?.textContent).toBe('text inside');
  });

  test('Font offers the system’s families and writes the one picked; Inherited takes it off', async () => {
    const host = await frame();
    const select = must(q(host, 'insp-font'), 'font select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Inherited', 'Avenir Next']);
    await pick(select, 'var(--font-sans)');
    expect(edited()).toEqual({ 'font-family': 'var(--font-sans)' });
  });

  test('Line height is a percentage of the size; letter spacing is px; Align writes text-align', async () => {
    const host = await frame({ authored: { 'line-height': '1.2' } });
    expect(q(host, 'insp-num-line')?.querySelector('input')?.value).toBe('120 %');
    await enterNum(host, 'insp-num-line', '92');
    await enterNum(host, 'insp-num-letter', '2');
    expect(edited()).toEqual({ 'line-height': '0.92', 'letter-spacing': '2px' });
  });

  test('Align: the current one is checked, a click on another writes it', async () => {
    const host = await frame({ authored: { 'text-align': 'center' } });
    const radios = [...(q(host, 'insp-ctl-align')?.querySelectorAll('[role="radio"]') ?? [])];
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    await click(radios[2]);
    expect(edited()).toEqual({ 'text-align': 'right' });
  });

  test('the readers: 24px over a 20px size is 120 %, 0.02em of 20px is 0.4px', async () => {
    const { lineHeightPercent, letterSpacingPx, familyName } = await import(
      '../client/v2/inspector/kinds/text.jsx'
    );
    expect(lineHeightPercent('24px', 20)).toBe(120);
    expect(lineHeightPercent('1.2', 20)).toBe(120);
    expect(lineHeightPercent('normal', 20)).toBeNull();
    expect(letterSpacingPx('0.02em', 20)).toBe(0.4);
    expect(familyName('"Avenir Next", sans-serif')).toBe('Avenir Next');
  });
});

describe('Resizing', () => {
  test('Fixed writes the measured width and height; Width lets the box follow the line', async () => {
    const host = await frame();
    expect(radio(host, 'insp-ctl-resizing', 'Height').getAttribute('aria-checked')).toBe('true');
    await click(radio(host, 'insp-ctl-resizing', 'Fixed'));
    const written = Object.fromEntries(
      posts.filter((p) => p.url === '/_api/edit-css').map((p) => [p.body.property, p.body.value])
    );
    expect(written).toEqual({ width: '600px', height: '140px' });
  });

  test('Width: max-content width, height released', async () => {
    const host = await frame({ authored: { width: '600px', height: '140px' } });
    expect(radio(host, 'insp-ctl-resizing', 'Fixed').getAttribute('aria-checked')).toBe('true');
    await click(radio(host, 'insp-ctl-resizing', 'Width'));
    const edits = posts.filter((p) => p.url === '/_api/edit-css').map((p) => p.body);
    expect(edits).toContainEqual(
      expect.objectContaining({ property: 'width', value: 'max-content' })
    );
    expect(edits).toContainEqual(expect.objectContaining({ property: 'height', reset: true }));
  });
});

describe('several texts', () => {
  test('Case and Language go to all of them; Style and Resizing are for one', async () => {
    await ensureTypeSlots();
    const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
    const second = { ...TITLE, id: 'sub', refs: [{ artboard: 'post', element: 'sub' }] };
    runs.length = 0;
    const host = await mount(
      <InspectorFrame
        {...({
          selected: [TITLE, second],
          layersTree: { artboardId: 'post', nodes: [] },
          cfg: CFG,
          canvasFile: FILE,
          onOptimistic: () => {},
          onRecordEdit: () => {},
          onReplaceMedia: () => {},
          onUndoRedo: () => {},
          onRunAction: (m: Record<string, unknown>) => runs.push(m),
        } as never)}
      />
    );
    expect(q(host, 'insp-style')).toBeNull();
    expect(q(host, 'insp-ctl-resizing')).toBeNull();
    await click(radio(host, 'insp-ctl-case', 'AA'));
    expect(lastRun().params.targets).toEqual([REF, { artboard: 'post', element: 'sub' }]);
  });
});
