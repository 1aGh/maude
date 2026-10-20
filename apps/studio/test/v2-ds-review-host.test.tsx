// S10.8 — the host around "Update N canvases": how a registry action reaches it, what it fetches, what Update and
// Cancel send, what the person is told; `ds.go-to`; the dots on a left-out canvas; the three registry entries and the
// Inspector links that were hidden until they existed.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AGENT_PATHS as ACTION_AGENTS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { DS_DOTS_MAX, s2cSpec } from '../bridge/dgn-protocol.ts';
import { dsGoToPlan, dsGoToPosts } from '../client/v2/ds/go-to.js';
import {
  onDsReviewRequest,
  requestDsReview,
  resetDsReviewBus,
} from '../client/v2/ds/review-bus.js';
import { dotIdsOf, loadDotIds } from '../client/v2/ds/update-dots.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';
import { opLabel } from '../edit-ops/op-label.ts';

const H = 'a'.repeat(64);
const ACCENT = {
  css: '--accent',
  label: 'Accent',
  before: { light: 'oklch(0.55 0.17 255)', dark: 'oklch(0.65 0.15 255)' },
  after: { light: 'oklch(0.5 0.19 255)', dark: 'oklch(0.6 0.175 255)' },
};
const CANVASES = [
  { path: 'ui/Homepage.tsx', folder: 'ui', state: 'follows', ticked: true },
  { path: 'ui/Pricing.tsx', folder: 'ui', state: 'follows', ticked: true },
  { path: 'ui/Landing page.tsx', folder: 'ui', state: 'left-out', ticked: false },
];
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'studio', path: 'system/studio' }],
  dsConverted: { studio: true },
};

type Call = { method: string; url: string; body: Record<string, unknown> | null };
function fakeFetch(opts: {
  pending?: Record<string, unknown>;
  publish?: { status: number; body: unknown };
  review?: unknown;
}) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body });
    const json = (status: number, b: unknown) =>
      ({ ok: status < 400, status, json: async () => b }) as Response;
    if (url.startsWith('/_api/ds/state'))
      return json(200, { systems: [{ name: 'studio', pending: opts.pending ?? {} }] });
    if (url.startsWith('/_api/ds/usage')) {
      return json(200, {
        canvases: [
          { rel: 'ui/Homepage.tsx', places: 14, elements: [{ id: 'cta' }, { id: 'bad id' }] },
          { rel: 'other/Else.tsx', places: 3, elements: [{ id: 'x' }] },
        ],
      });
    }
    if (url === '/_api/ds/publish' && body?.dryRun)
      return json(
        200,
        opts.review ?? { system: 'studio', expectHead: H, changes: [ACCENT], canvases: CANVASES }
      );
    if (url === '/_api/ds/publish')
      return json(
        opts.publish?.status ?? 200,
        opts.publish?.body ?? { result: { updated: 2, leftOut: 1 } }
      );
    if (url === '/_api/ds/pending') return json(200, { action: 'pending' });
    return json(404, {});
  };
  return { calls, impl: impl as unknown as typeof fetch };
}

describe('the bus', () => {
  beforeEach(resetDsReviewBus);
  test('a request made before the host mounted waits and is handed over once', () => {
    expect(requestDsReview({ kind: 'review', ds: 'studio' })).toBe(false);
    const got: unknown[] = [];
    const off = onDsReviewRequest((r) => got.push(r));
    expect(got).toEqual([{ kind: 'review', ds: 'studio' }]);
    off();
    const again: unknown[] = [];
    const off2 = onDsReviewRequest((r) => again.push(r));
    expect(again).toEqual([]);
    expect(requestDsReview({ kind: 'cancel' })).toBe(true);
    expect(again).toEqual([{ kind: 'cancel' }]);
    off2();
  });
});

describe('the registry actions and their runners', () => {
  beforeEach(resetDsReviewBus);
  test('ds.review-update, ds.go-to and ds.instance-update are registered, with an agent path', () => {
    for (const id of ['ds.review-update', 'ds.go-to', 'ds.instance-update']) {
      expect(ACTIONS_BY_ID.has(id), id).toBe(true);
      expect(ACTION_AGENTS[id], id).toBeDefined();
    }
    expect(ACTIONS_BY_ID.get('ds.review-update')?.visible?.minRole).toBe('edit');
    expect(ACTIONS_BY_ID.get('ds.go-to')?.visible?.minRole).toBe('view');
    expect(ACTION_AGENTS['ds.review-update']?.server?.route).toBe('/_api/ds/pending');
    expect(ACTION_AGENTS['ds.instance-update']?.server?.route).toBe('/_api/edit-op');
  });

  test('the runner map answers them: publish / review-update / cancel ask the host, go-to the shell', () => {
    const got: Array<Record<string, unknown>> = [];
    onDsReviewRequest((r) => got.push(r));
    const goTo: unknown[] = [];
    const h = createMenuHandlers({ onDsGoTo: (p: unknown) => goTo.push(p) } as never);
    h['ds.publish']?.({ canvas: 'ui/Home.tsx' });
    h['ds.review-update']?.({
      canvas: 'ui/Home.tsx',
      elementId: 'cta',
      target: { kind: 'component', name: 'Button' },
    });
    h['ds.cancel-pending']?.({});
    h['ds.go-to']?.({ component: 'Button' });
    expect(got.map((r) => r.kind)).toEqual(['review', 'push', 'cancel']);
    expect(got[1]).toMatchObject({
      elementId: 'cta',
      target: { kind: 'component', name: 'Button' },
    });
    expect(goTo).toEqual([{ component: 'Button' }]);
  });

  test('the instance update has a history line of its own', () => {
    const said = opLabel('ds.instance-update', {}, [{ artboard: 'a', element: 'cta' }]);
    expect(said.length).toBeGreaterThan(2);
    expect(said).not.toBe('Edit canvas');
  });
});

describe('ds.go-to — the plan', () => {
  test('a component opens the Design system canvas on its components section and selects the master', () => {
    const plan = dsGoToPlan({ component: 'Button' }, CFG, 'ui/Home.tsx');
    expect(plan).toEqual({
      file: 'system/studio/design-system.tsx',
      artboard: 'ds-components',
      selector: '[data-ds-master="Button"]',
    });
    expect(dsGoToPosts(plan)).toEqual([
      { dgn: 'run-action', v: 1, id: 'view.zoom-to-artboard', params: { id: 'ds-components' } },
      { dgn: 'select-by-selector', v: 1, selector: '[data-ds-master="Button"]' },
    ]);
  });
  test('a token with a section; a hostile name selects nothing; no system = no plan', () => {
    expect(dsGoToPlan({ section: 'colour', token: '--accent' }, CFG)).toMatchObject({
      artboard: 'ds-colour',
      selector: '[data-ds-token="--accent"]',
    });
    const evil = dsGoToPlan({ token: '--a"],body{x', component: 'B"]x', section: '../x' }, CFG);
    expect(evil).toMatchObject({ artboard: null, selector: null });
    expect(dsGoToPlan({ component: 'Button' }, { designSystems: [] })).toBeNull();
  });
});

describe('the dots on a left-out canvas', () => {
  test('only this canvas, only plain ids, capped', () => {
    const answers = [
      {
        canvases: [
          { rel: 'ui/Homepage.tsx', elements: [{ id: 'cta' }, { id: 'bad id' }, { id: 'h1' }] },
        ],
      },
      {
        canvases: [
          { rel: 'ui/Homepage.tsx', elements: [{ id: 'cta' }] },
          { rel: 'x', elements: [{ id: 'z' }] },
        ],
      },
      null,
    ];
    expect(dotIdsOf('ui/Homepage.tsx', answers)).toEqual(['cta', 'h1']);
    const many = [
      {
        canvases: [
          { rel: 'a', elements: Array.from({ length: 500 }, (_, i) => ({ id: `e${i}` })) },
        ],
      },
    ];
    expect(dotIdsOf('a', many)).toHaveLength(DS_DOTS_MAX);
  });
  test('loadDotIds asks once per changed token and master', async () => {
    const f = fakeFetch({});
    const ids = await loadDotIds(
      {
        ds: 'studio',
        rel: 'ui/Homepage.tsx',
        diff: {
          tokens: [{ css: '--accent' }, { css: '--accent' }],
          components: [{ component: 'Button' }],
        },
      },
      f.impl
    );
    expect(ids).toEqual(['cta']);
    expect(f.calls.map((c) => c.url)).toEqual([
      '/_api/ds/usage?ds=studio&css=--accent',
      '/_api/ds/usage?ds=studio&component=Button',
    ]);
  });
  test('the shell → canvas message is typed: well-formed ids pass, a bad one is refused', () => {
    const parse = (m: Record<string, unknown>) => s2cSpec('ds-update-dots')?.parse(m) ?? null;
    expect(s2cSpec('ds-update-dots')?.gate).toBe('parent');
    expect(parse({ dgn: 'ds-update-dots', ids: ['cta', 'h1'] })).toMatchObject({
      ids: ['cta', 'h1'],
    });
    expect(parse({ dgn: 'ds-update-dots', ids: ['a"]b'] })).toBeNull();
    expect(
      parse({ dgn: 'ds-update-dots', ids: Array.from({ length: 201 }, (_, i) => `e${i}`) })
    ).toBeNull();
  });
});

describe('the host', () => {
  const roots: Root[] = [];
  let Host: (p: Record<string, unknown>) => JSX.Element | null;
  let lib: typeof import('../client/v2/ds/review-host.jsx');
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    lib = await import('../client/v2/ds/review-host.jsx');
    Host = lib.DsReviewHost as never;
  });
  afterAll(() => GlobalRegistrator.unregister());
  beforeEach(resetDsReviewBus);
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });

  async function mount(f: ReturnType<typeof fakeFetch>, toasts: string[], cfg: unknown = CFG) {
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    roots.push(root);
    await act(async () =>
      root.render(
        <Host
          cfg={cfg}
          activePath="ui/Homepage.tsx"
          toast={(m: string) => toasts.push(m)}
          scope="Studio site"
          fetchImpl={f.impl}
        />
      )
    );
  }
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

  test('loadDsReview: the review, the waiting masters and the places per canvas', async () => {
    const f = fakeFetch({ pending: { components: { Button: {} } } });
    const r = await lib.loadDsReview('studio', f.impl);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.components).toEqual(['Button']);
      expect(r.places['ui/Homepage.tsx']).toBe(28); // 14 for the token + 14 for the master
      expect(r.review.expectHead).toBe(H);
    }
  });

  test('nothing waiting says so in words, and opens nothing', async () => {
    const f = fakeFetch({
      review: { system: 'studio', expectHead: H, changes: [], canvases: CANVASES },
    });
    const r = await lib.loadDsReview('studio', f.impl);
    expect(r).toEqual({
      ok: false,
      message: 'Nothing is waiting to update. Change something on the Design system canvas first.',
    });
  });

  test('ds.publish opens the sheet; Update sends the ticks and says how many stayed out', async () => {
    const f = fakeFetch({});
    const toasts: string[] = [];
    await mount(f, toasts);
    await act(async () => void requestDsReview({ kind: 'review' }));
    await settle();
    expect(q('ds-review-title')?.textContent).toBe('Update canvases with the new Accent?');
    expect(q('ds-review-update')?.textContent).toBe('Update 2 canvases');
    await act(async () => q('ds-review-update')?.click());
    await settle();
    const publish = f.calls.find((c) => c.url === '/_api/ds/publish' && !c.body?.dryRun);
    expect(publish?.body).toEqual({
      ds: 'studio',
      expectHead: H,
      canvases: [
        { path: 'ui/Homepage.tsx', ticked: true },
        { path: 'ui/Pricing.tsx', ticked: true },
        { path: 'ui/Landing page.tsx', ticked: false },
      ],
    });
    expect(toasts).toEqual(['Updated 2 canvases. 1 left out keeps the old look.']);
    expect(q('ds-review')).toBeNull(); // closed
  });

  test('a moved head is a refusal in words, and the sheet stays', async () => {
    const f = fakeFetch({ publish: { status: 409, body: { code: 'ds-head-moved' } } });
    await mount(f, []);
    await act(async () => void requestDsReview({ kind: 'review' }));
    await settle();
    await act(async () => q('ds-review-update')?.click());
    await settle();
    expect(q('ds-review-error')?.textContent).toContain('changed while this was open');
    expect(q('ds-review')).not.toBeNull();
  });

  test('Cancel puts the swatch back: pending dropped, no publish', async () => {
    const f = fakeFetch({});
    const toasts: string[] = [];
    await mount(f, toasts);
    await act(async () => void requestDsReview({ kind: 'review' }));
    await settle();
    await act(async () => q('ds-review-cancel')?.click());
    await settle();
    expect(f.calls.find((c) => c.url === '/_api/ds/pending')?.body).toEqual({
      ds: 'studio',
      cancel: true,
    });
    expect(f.calls.some((c) => c.url === '/_api/ds/publish' && !c.body?.dryRun)).toBe(false);
    expect(toasts).toEqual(['Put back. No canvas changed.']);
    expect(q('ds-review')).toBeNull();
  });

  test('ds.cancel-pending from a menu runs without a sheet', async () => {
    const f = fakeFetch({});
    const toasts: string[] = [];
    await mount(f, toasts);
    await act(async () => void requestDsReview({ kind: 'cancel' }));
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual(['/_api/ds/pending']);
    expect(toasts).toEqual(['Put back. No canvas changed.']);
  });

  test('a canvas that follows no converted system is told so; nothing is fetched', async () => {
    const f = fakeFetch({});
    const toasts: string[] = [];
    await mount(f, toasts, { ...CFG, dsConverted: {} });
    await act(async () => void requestDsReview({ kind: 'review' }));
    await settle();
    expect(f.calls).toEqual([]);
    expect(toasts).toEqual(['This canvas follows no design system that can be updated yet.']);
  });
});
