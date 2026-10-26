// V2-8.4 (found by the cross-shell run on a LOCAL cell, viewer role): a Can-comment session opened the
// Inspector on a text object and its Type fields were live — typing a new text size changed the heading on
// the viewer's own canvas (an optimistic preview the server then refused with 403 on /_api/edit-css), so the
// viewer saw a design that is not the design. "Read-only means cannot CHANGE, not cannot SEE" (Cloud Phase 27 C1,
// the shell-parity table's `inspector.readOnly`): the frame must draw every value and open no field. `ctx.editable`
// was `!!el.id` only — the role never reached it; the Advanced fold had its own `advancedAccess(cfg)`.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
const posts: string[] = [];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith('components.json')) return new Response('{}', { status: 200 });
    if (String(url).endsWith('.css'))
      return new Response(':root{--font-size-base:16px;}', { status: 200 });
    if (init?.body) posts.push(String(url));
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
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  posts.length = 0;
});

const FILE = '.design/ui/board.tsx';
const H1 = {
  id: 'h1id',
  index: 0,
  file: FILE,
  tag: 'h1',
  classes: '',
  selector: '[data-dc-screen="card"] [data-cd-id="h1id"]',
  text: 'Cross-shell card',
  bounds: { x: 0, y: 0, w: 364, h: 35 },
  worldW: 364,
  worldH: 35,
  dom_path: ['div', 'h1'],
  authored: { 'font-size': '30px' } as Record<string, string>,
  computed: { 'font-size': '30px', 'text-transform': 'none' } as Record<string, string>,
  customStyles: {},
  attrs: {},
  artboardId: 'card',
  refs: [{ artboard: 'card', element: 'h1id' }],
  textInfo: {
    role: '',
    values: { 'font-size': '30px' },
    differs: [] as string[],
    lang: '',
    upper: false,
  },
};
const CFG = { designRel: '.design', designSystems: [], defaultDesignSystem: null };

async function frame(cfg: Record<string, unknown>) {
  await import('../client/v2/inspector/sections/index.js');
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <InspectorFrame
        {...({
          selected: H1,
          layersTree: { artboardId: 'card', nodes: [] },
          cfg,
          canvasFile: FILE,
          onOptimistic: () => {},
          onRecordEdit: () => {},
          onReplaceMedia: () => {},
          onUndoRedo: () => {},
        } as never)}
      />
    )
  );
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  return host;
}

// happy-dom does not walk a disabled <fieldset> for :disabled (a browser does), so read the fieldset too
const off = (f: HTMLElement) => f.matches(':disabled') || !!f.closest('fieldset[disabled]');
const fields = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('.insp input, .insp select, .insp textarea'));

describe('the Inspector frame follows the role (V2-8.4)', () => {
  test('an editor opens its fields', async () => {
    const host = await frame({ ...CFG });
    expect(fields(host).length).toBeGreaterThan(0);
    expect(fields(host).every(off)).toBe(false);
  });

  for (const role of ['viewer', 'observer'] as const) {
    test(`a ${role} reads every value and opens no field`, async () => {
      const host = await frame({ ...CFG, cloud: { role } });
      expect(fields(host).length).toBeGreaterThan(0);
      const open = fields(host).filter((f) => !off(f));
      expect(open.map((f) => f.getAttribute('data-testid') ?? f.tagName)).toEqual([]);
    });
  }

  test('a read-only session (cfg.readOnly, e.g. a view-only link) opens no field either', async () => {
    const host = await frame({ ...CFG, readOnly: true });
    expect(fields(host).filter((f) => !off(f)).length).toBe(0);
  });
});
