// S2.5 — Interaction (On click · On hover) and the Export slot, rendered in the inspector frame next to the nine sections
// before them: real markup, real registry; only fetch is faked. On hover writes `data-hover` through the existing
// /_api/edit-attr lane; On click reads `data-cd-link` and says plainly that it cannot be changed from here yet.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
type Post = { url: string; body: Record<string, unknown> };
const posts: Post[] = [];
let previous: string | null = 'lift-floating';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith('.css')) return new Response(':root{--shadow-resting:0 0 0 red;}');
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
  recorded.length = 0;
  previous = 'lift-floating';
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
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
const optionLabels = (sel: Element | null) =>
  [...(must(sel, 'select') as HTMLSelectElement).querySelectorAll('option')].map((o) =>
    o.textContent?.trim()
  );
const shown = (sel: Element | null) => {
  const s = must(sel, 'select') as HTMLSelectElement;
  return s.selectedOptions[0]?.textContent?.trim();
};

const FILE = '.design/ui/Homepage.tsx';
const BTN = {
  id: 'book-call',
  index: 0,
  file: FILE,
  tag: 'button',
  classes: 'cta',
  selector: 'button.cta',
  text: 'Book a call',
  bounds: { x: 0, y: 0, w: 148, h: 44 },
  worldW: 148,
  worldH: 44,
  dom_path: ['button.cta'],
  authored: { background: 'var(--ink)' } as Record<string, string>,
  computed: {} as Record<string, string>,
  customStyles: {},
  attrs: { 'data-hover': 'lift-floating', 'data-cd-link': 'https://cal.com/studio' } as Record<
    string,
    string
  >,
  parentDisplay: 'flex',
  parentFlexDirection: 'row',
  artboardId: 'desktop',
};
const ARTBOARD = {
  id: undefined,
  index: 0,
  file: FILE,
  tag: 'article',
  selector: '[data-dc-screen="desktop"]',
  artboardId: 'desktop',
  attrs: {} as Record<string, string>,
  authored: {},
  computed: {},
  customStyles: {},
  bounds: { x: 0, y: 0, w: 1440, h: 900 },
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
  if (slotsFor('position', 'frame').length) return;
  generation += 1;
  for (const f of [
    'sections/position',
    'sections/size',
    'sections/layout',
    'sections/fill',
    'sections/corners',
    'sections/border',
    'sections/effects',
    'sections/type',
    'sections/interaction',
    'kinds/multi',
  ]) {
    const mod = (await import(`../client/v2/inspector/${f}.jsx?s25=${generation}`)) as Record<
      string,
      unknown
    >;
    for (const [k, v] of Object.entries(mod))
      if (/^off[A-Z]/.test(k) && typeof v === 'function') reregistered.push(v as () => void);
    if (typeof mod.forgetCornerChoices === 'function')
      forgets.push(mod.forgetCornerChoices as () => void);
  }
  // S8.8 — the Export section is S8's (it takes S2.5's placeholder out of the registry itself)
  const exp = (await import(
    `../client/v2/export/inspector-export.jsx?s88=${generation}`
  )) as Record<string, unknown>;
  reregistered.push(exp.offInspectorExport as () => void);
}

async function frame(selected: unknown) {
  await ensureSections();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
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
const one = (over: Record<string, unknown> = {}) => frame({ ...BTN, ...over });
const attrEdits = () => posts.filter((p) => p.url === '/_api/edit-attr');

describe('the whole inspector, assembled (ed-inspector)', () => {
  test('a button shows all ten sections in the canvas’s order, Advanced last', async () => {
    const host = await one();
    const secs = [...host.querySelectorAll('section.insp-sec')];
    expect(secs.map((s) => s.getAttribute('data-testid'))).toEqual([
      'insp-sec-position',
      'insp-sec-size',
      'insp-sec-layout',
      'insp-sec-fill',
      'insp-sec-corners',
      'insp-sec-border',
      'insp-sec-effects',
      'insp-sec-type',
      'insp-sec-interaction',
      'insp-sec-export',
    ]);
    expect(secs.map((s) => s.getAttribute('data-n'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    const adv = must(q(host, 'fold-inspector-toggle'), 'Advanced');
    for (const s of secs) expect(s.compareDocumentPosition(adv) & 4 /* FOLLOWING */).toBeTruthy();
  });

  test('the Interaction and Export explainer lines are the canvas’s, word for word', async () => {
    const canvas = readFileSync(
      join(import.meta.dir, '../../../.design/ui/v2/14 Editing.tsx'),
      'utf8'
    );
    const host = await one();
    for (const [id, title] of [
      ['interaction', 'Interaction'],
      ['export', 'Export'],
    ] as const) {
      const hint = must(
        q(host, `insp-sec-${id}`)?.querySelector('[title]') ?? null,
        id
      ).getAttribute('title') as string;
      expect(canvas).toContain(`["${title}", "${hint}"]`);
    }
  });

  test('an artboard has no Interaction (a click goes from an object); it keeps Export; several objects keep neither Interaction', async () => {
    const ab = await frame(ARTBOARD);
    expect(q(ab, 'insp-sec-interaction')).toBeNull();
    expect(q(ab, 'insp-sec-export')).not.toBeNull();
    const multi = await frame([BTN, { ...BTN, id: 'b2' }]);
    expect(q(multi, 'insp-sec-interaction')).toBeNull();
  });
});

describe('On hover', () => {
  test('reads data-hover as the canvas says it: "Lift to Floating"', async () => {
    const host = await one();
    const sel = q(host, 'insp-ctl-hover');
    expect(shown(sel)).toBe('Lift to Floating');
    expect(optionLabels(sel)).toEqual([
      'None',
      'Lift to Resting',
      'Lift to Floating',
      'Lift to Sheet',
      'Darken',
      'Underline',
    ]);
  });

  test('picking another preset writes data-hover through edit-attr and records the undo entry', async () => {
    const host = await one();
    await pick(q(host, 'insp-ctl-hover'), 'darken');
    expect(attrEdits().map((p) => p.body)).toEqual([
      { canvas: FILE, id: 'book-call', attr: 'data-hover', value: 'darken' },
    ]);
    expect(recorded.at(-1)).toMatchObject({
      op: 'attr',
      canvas: FILE,
      id: 'book-call',
      key: 'data-hover',
      before: 'lift-floating',
      after: 'darken',
    });
    expect(shown(q(host, 'insp-ctl-hover'))).toBe('Darken');
  });

  test('None removes the attribute (reset) and records it', async () => {
    const host = await one();
    await pick(q(host, 'insp-ctl-hover'), 'none');
    expect(attrEdits().map((p) => p.body)).toEqual([
      { canvas: FILE, id: 'book-call', attr: 'data-hover', reset: true },
    ]);
    expect(recorded.at(-1)).toMatchObject({
      key: 'data-hover',
      before: 'lift-floating',
      after: null,
    });
  });

  test('picking what is already there writes nothing', async () => {
    const host = await one();
    await pick(q(host, 'insp-ctl-hover'), 'lift-floating');
    expect(attrEdits()).toEqual([]);
  });

  test('a value outside the vocabulary reads Custom and is left alone until another is picked', async () => {
    const host = await one({ attrs: { 'data-hover': 'wiggle' } });
    const sel = q(host, 'insp-ctl-hover');
    expect(shown(sel)).toBe('Custom');
    await pick(sel, 'custom');
    expect(attrEdits()).toEqual([]);
    await pick(sel, 'underline');
    expect(attrEdits().map((p) => p.body.value)).toEqual(['underline']);
  });

  test('an object with no id yet writes nothing and says how to get one', async () => {
    const host = await one({ id: undefined, artboardId: null });
    expect(q(host, 'insp-hover-locked')?.textContent).toContain('no id yet');
    expect((must(q(host, 'insp-ctl-hover'), 'hover') as HTMLSelectElement).disabled).toBe(true);
  });

  test('the "+" in the header adds the first lift when there is no hover, and does nothing when there is', async () => {
    const none = await one({ attrs: {} });
    await click(q(none, 'insp-add-interaction'));
    expect(attrEdits().map((p) => p.body.value)).toEqual(['lift-resting']);
    posts.length = 0;
    const has = await one();
    await click(q(has, 'insp-add-interaction'));
    expect(attrEdits()).toEqual([]);
  });
});

describe('On click (the row says what the link does; "None" clears it through /_api/edit-op)', () => {
  test('an external link reads "Open cal.com/studio"; None clears it with one element.clear-link write', async () => {
    const host = await one();
    const sel = q(host, 'insp-ctl-click') as HTMLSelectElement;
    expect(shown(sel)).toBe('Open cal.com/studio');
    expect(sel.disabled).toBe(false);
    expect(optionLabels(sel)).toEqual(['Open cal.com/studio', 'None']);
    expect(q(host, 'insp-click-pending')).toBeNull();
    await pick(sel, 'none');
    expect(posts.map((p) => [p.url, p.body])).toEqual([
      [
        '/_api/edit-op',
        {
          file: FILE,
          op: 'element.clear-link',
          targets: [{ artboard: 'desktop', element: 'book-call' }],
        },
      ],
    ]);
  });

  test('no link: the row says None and has nothing to change; an object with no id writes nothing', async () => {
    const none = await one({ attrs: {} });
    expect((q(none, 'insp-ctl-click') as HTMLSelectElement).disabled).toBe(true);
    const noId = await one({ id: undefined, artboardId: null });
    expect((q(noId, 'insp-ctl-click') as HTMLSelectElement).disabled).toBe(true);
    await pick(q(noId, 'insp-ctl-click'), 'none');
    expect(posts).toEqual([]);
  });

  test('an artboard and a canvas target read as places to go; no link reads None', async () => {
    const a = await one({ attrs: { 'data-cd-link': '#pricing-desktop' } });
    expect(shown(q(a, 'insp-ctl-click'))).toBe('Go to pricing-desktop');
    const c = await one({ attrs: { 'data-cd-link': 'site/pricing-page.tsx#desktop' } });
    expect(shown(q(c, 'insp-ctl-click'))).toBe('Go to Pricing page');
    const none = await one({ attrs: {} });
    expect(shown(q(none, 'insp-ctl-click'))).toBe('None');
  });

  test('a javascript: link is not a link: it reads Custom, never as a place', async () => {
    const host = await one({ attrs: { 'data-cd-link': 'javascript:alert(1)' } });
    expect(shown(q(host, 'insp-ctl-click'))).toBe('Custom link');
  });

  test('the line under the rows is the canvas’s', async () => {
    const host = await one();
    expect(q(host, 'insp-interaction-note')?.textContent).toBe(
      'Preview plays it; Edit shows the link while this is selected.' // gate-b-polish1 (RC-F): no design-reference words in the UI
    );
  });
});

describe('the Export slot (S8 fills it; C21: the default presets per kind)', () => {
  const presets = (host: HTMLElement) =>
    [...host.querySelectorAll('[data-testid="insp-export-preset"]')].map((e) =>
      e.textContent?.trim()
    );

  test('an object offers PNG 2× and SVG, and points at the sheet', async () => {
    const host = await one();
    expect(presets(host)).toEqual(['PNG · 2×', 'SVG']);
    expect(q(host, 'insp-export-more')?.textContent).toContain('Export… — every option');
    expect(q(host, 'insp-export-more')?.textContent).toContain('⇧⌘E');
  });

  test('an artboard offers its kind’s own preset (08): Fixed size PNG 1× (S8.8: as a size row), Print PDF, Video MP4', async () => {
    const at = async (kind: string | undefined) =>
      frame({ ...ARTBOARD, attrs: kind ? { 'data-dc-kind': kind } : {} });
    for (const kind of [undefined, 'web']) {
      const host = await at(kind);
      expect(shown(q(host, 'insp-export-scale-0'))).toBe('1×');
      expect(shown(q(host, 'insp-export-format-0'))).toBe('PNG');
    }
    expect(presets(await at('print'))).toEqual(['Print PDF']);
    // P8 C4 video (decision v2-p8-c4-video-card-is-flat): a video's Export is one MP4 row on its flat card, not an
    // Export-section preset — the section stands aside
    expect(presets(await at('video'))).toEqual([]);
  });

  test('several objects offer one export for all of them', async () => {
    const host = await frame([BTN, { ...BTN, id: 'b2' }, { ...BTN, id: 'b3' }]);
    expect(presets(host)).toEqual(['3 files…']);
  });
});
