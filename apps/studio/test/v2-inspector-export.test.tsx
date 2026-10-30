// S8.8 — the inspector's Export section (09 Export › ex-inspector), real markup and real registry; only the network
// is faked. An artboard's sizes are stored in the canvas meta and come back after a reload; one click exports with
// no sheet; Copy as PNG (⇧⌘C) renders through the same export and puts the PNG on the clipboard; Can view sees none
// of it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
type Call = { method: string; url: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
/** What the "server" holds: artboardMeta[id].exports of this canvas. */
let stored: Record<string, unknown[]> = {};
let refuse = false;
const opened: Array<Record<string, unknown>> = [];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, url: String(url), body });
    if (String(url).endsWith('.css')) return new Response(':root{}');
    if (String(url).startsWith('/_api/canvas-meta'))
      return Response.json({
        artboardMeta: Object.fromEntries(
          Object.entries(stored).map(([k, v]) => [k, { exports: v }])
        ),
      });
    if (String(url) === '/_api/present-meta') {
      if (refuse) return new Response('{"reason":"read-only"}', { status: 403 });
      const ex = (body?.exports ?? {}) as Record<string, unknown[] | null>;
      for (const [id, v] of Object.entries(ex)) {
        if (v?.length) stored[id] = v;
        else delete stored[id];
      }
      return Response.json({ ok: true, exports: stored });
    }
    if (String(url) === '/_api/export-jobs' && method === 'POST')
      return Response.json({ jobId: `j${calls.length}` }, { status: 202 });
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
beforeEach(async () => {
  calls.length = 0;
  opened.length = 0;
  stored = {};
  refuse = false;
  const { forgetSizes } = await import('../client/v2/export/export-sizes.js');
  forgetSizes();
  const { registerExportOpener } = await import('../client/v2/export/use-export-spec.js');
  offOpener?.();
  offOpener = registerExportOpener((r: Record<string, unknown>) => opened.push(r));
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
});
let offOpener: (() => void) | null = null;
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  offOpener?.();
  offOpener = null;
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
const shown = (sel: Element | null) =>
  (must(sel, 'select') as HTMLSelectElement).selectedOptions[0]?.textContent?.trim();

const FILE = '.design/ui/Post.tsx';
const ARTBOARD = {
  id: undefined,
  index: 0,
  file: FILE,
  tag: 'article',
  selector: '[data-dc-screen="post"]',
  artboardId: 'post',
  attrs: {} as Record<string, string>,
  authored: {},
  computed: {},
  customStyles: {},
  bounds: { x: 0, y: 0, w: 1080, h: 1350 },
};
const BTN = {
  id: 'cta',
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
  authored: {},
  computed: {},
  customStyles: {},
  attrs: {} as Record<string, string>,
  artboardId: 'post',
};
const cfgOf = (role?: string, extra: Record<string, unknown> = {}) => ({
  designRel: '.design',
  designSystems: [],
  ...(role ? { cloud: { role } } : {}),
  ...extra,
});

const reregistered: Array<() => void> = [];
let generation = 0;
async function ensureSections() {
  await import('../client/v2/inspector/sections/index.js');
  const { slotsFor } = await import('../client/v2/inspector/slots.js');
  if (slotsFor('export', 'frame').length) return;
  generation += 1;
  const exp = (await import(
    `../client/v2/export/inspector-export.jsx?s88t=${generation}`
  )) as Record<string, unknown>;
  reregistered.push(exp.offInspectorExport as () => void);
}
async function frame(selected: unknown, cfg = cfgOf()) {
  await ensureSections();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  return mount(
    <InspectorFrame
      {...({
        selected,
        layersTree: { artboardId: 'post', nodes: [] },
        cfg,
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
      } as never)}
    />
  );
}
const exportPosts = () => calls.filter((c) => c.method === 'POST' && c.url === '/_api/export-jobs');
const sizePatches = () => calls.filter((c) => c.url === '/_api/present-meta');

describe('an artboard keeps its own sizes (artboardMeta.exports)', () => {
  test('nothing stored shows the kind’s default; + stores the whole list; the rows come back after a reload', async () => {
    const host = await frame(ARTBOARD);
    expect(host.querySelectorAll('[data-testid="insp-export-size"]').length).toBe(1);
    expect(shown(q(host, 'insp-export-scale-0'))).toBe('1×');
    expect(shown(q(host, 'insp-export-format-0'))).toBe('PNG');
    expect(q(host, 'insp-export-go')?.textContent).toBe('Export 1 file');
    expect(sizePatches().length).toBe(0);

    await click(q(host, 'insp-add-export'), 'the + in the header');
    expect(sizePatches().length).toBe(1);
    expect(sizePatches()[0].body).toEqual({
      file: FILE,
      exports: {
        post: [
          { format: 'png', scale: 1 },
          { format: 'png', scale: 2 },
        ],
      },
    });
    expect(host.querySelectorAll('[data-testid="insp-export-size"]').length).toBe(2);
    expect(q(host, 'insp-export-go')?.textContent).toBe('Export 2 files');

    await pick(q(host, 'insp-export-format-1'), 'jpg');
    expect(stored.post).toEqual([
      { format: 'png', scale: 1 },
      { format: 'jpg', scale: 2 },
    ]);

    // a reload: a fresh page, the same canvas — what the meta holds is what the rows say
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    const { forgetSizes } = await import('../client/v2/export/export-sizes.js');
    forgetSizes();
    const again = await frame(ARTBOARD);
    expect(shown(q(again, 'insp-export-scale-1'))).toBe('2×');
    expect(shown(q(again, 'insp-export-format-1'))).toBe('JPG');
    expect(q(again, 'insp-export-go')?.textContent).toBe('Export 2 files');
  });

  test('− takes a size out; the last one stays; svg has no scale', async () => {
    stored = {
      post: [{ format: 'png', scale: 1 }, { format: 'svg' }],
    };
    const host = await frame(ARTBOARD);
    expect(shown(q(host, 'insp-export-format-1'))).toBe('SVG');
    expect(
      (q(host, 'insp-export-scale-1') as HTMLSelectElement).selectedOptions[0].textContent
    ).toBe('—');
    await click(q(host, 'insp-export-remove-1'), 'remove svg');
    expect(stored.post).toEqual([{ format: 'png', scale: 1 }]);
    expect((q(host, 'insp-export-remove-0') as HTMLButtonElement).disabled).toBe(true);
    // choosing SVG on a raster row drops its scale
    await pick(q(host, 'insp-export-format-0'), 'svg');
    expect(stored.post).toEqual([{ format: 'svg' }]);
  });

  test('a refused save puts the old sizes back and says so', async () => {
    stored = { post: [{ format: 'png', scale: 1 }] };
    const host = await frame(ARTBOARD);
    refuse = true;
    await pick(q(host, 'insp-export-scale-0'), '3');
    expect(shown(q(host, 'insp-export-scale-0'))).toBe('1×');
    expect(q(host, 'insp-export-error')?.textContent).toBe('Your role can’t change the sizes.');
  });
});

describe('one click exports, no sheet', () => {
  test('each size is one ExportSpecV2 for this artboard, queued as its own job', async () => {
    stored = {
      post: [
        { format: 'png', scale: 1 },
        { format: 'jpg', scale: 2 },
      ],
    };
    const host = await frame(ARTBOARD);
    await click(q(host, 'insp-export-go'), 'Export 2 files');
    const posts = exportPosts();
    expect(posts.length).toBe(2);
    expect(posts.map((p) => p.body)).toEqual([
      {
        v: 2,
        spec: {
          v: 2,
          scope: 'selection',
          format: 'png',
          canvas: 'ui/Post.tsx',
          selection: { artboards: ['post'] },
          options: { size: { scale: 1 } },
        },
      },
      {
        v: 2,
        spec: {
          v: 2,
          scope: 'selection',
          format: 'jpg',
          canvas: 'ui/Post.tsx',
          selection: { artboards: ['post'] },
          options: { size: { scale: 2 } },
        },
      },
    ]);
    expect(opened.length).toBe(0); // no sheet
  });

  test('an object shows PNG 2× and SVG, stores nothing, and exports both with its id', async () => {
    const host = await frame(BTN);
    expect(
      [...host.querySelectorAll('[data-testid="insp-export-preset"]')].map((e) =>
        e.textContent?.trim()
      )
    ).toEqual(['PNG · 2×', 'SVG']);
    expect(q(host, 'insp-add-export')).toBeNull();
    await click(q(host, 'insp-export-go'));
    expect(exportPosts().map((p) => (p.body as { spec: unknown }).spec)).toEqual([
      {
        v: 2,
        scope: 'selection',
        format: 'png',
        canvas: 'ui/Post.tsx',
        selection: { elements: ['cta'] },
        options: { size: { scale: 2 } },
      },
      {
        v: 2,
        scope: 'selection',
        format: 'svg',
        canvas: 'ui/Post.tsx',
        selection: { elements: ['cta'] },
      },
    ]);
    expect(sizePatches().length).toBe(0);
  });

  test('print and video point at the sheet with their own format', async () => {
    const print = await frame({ ...ARTBOARD, attrs: { 'data-dc-kind': 'print' } });
    expect(q(print, 'insp-add-export')).toBeNull();
    expect(q(print, 'insp-export-go')).toBeNull();
    await click(q(print, 'insp-export-more'));
    expect(opened.at(-1)).toMatchObject({ mode: 'export', scope: 'selection', format: 'pdf' });
  });

  test('a video artboard has no Export section — its card carries the one MP4 row (07 VideoInspector, V2-8.5 c4-video)', async () => {
    const video = await frame({ ...ARTBOARD, attrs: { 'data-dc-kind': 'video' } });
    expect(q(video, 'insp-sec-export')).toBeNull();
    expect(q(video, 'insp-export-more')).toBeNull();
  });
});

describe('Can view sees none of it', () => {
  test('observer: no Export section at all; commenter: the section, but sizes are read-only', async () => {
    const view = await frame(ARTBOARD, cfgOf('observer'));
    expect(q(view, 'insp-sec-export')).toBeNull();
    expect(q(view, 'insp-export-copy-png')).toBeNull();

    const comment = await frame(ARTBOARD, cfgOf('viewer', { readOnly: true }));
    expect(q(comment, 'insp-sec-export')).not.toBeNull();
    expect(q(comment, 'insp-add-export')).toBeNull();
    expect(q(comment, 'insp-export-remove-0')).toBeNull();
    expect(q(comment, 'insp-export-go')).not.toBeNull();
    expect(q(comment, 'insp-export-copy-png')).not.toBeNull();
  });
});

describe('the pointer at the sheet', () => {
  test('Export… — every option opens the sheet for the selection; several objects get only it', async () => {
    const host = await frame(BTN);
    expect(q(host, 'insp-export-more')?.textContent).toContain('Export… — every option');
    expect(q(host, 'insp-export-more')?.textContent).toContain('⇧⌘E');
    await click(q(host, 'insp-export-more'));
    expect(opened.at(-1)).toMatchObject({ mode: 'export', scope: 'selection' });
    const many = await frame([BTN, { ...BTN, id: 'b2' }]);
    expect(q(many, 'insp-export-copy-png')).toBeNull();
    expect(q(many, 'insp-export-go')).toBeNull();
  });
});
