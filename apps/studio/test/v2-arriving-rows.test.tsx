// S11.4 — arriving and not on this Mac, in the Canvases panel (05 · es-arriving, es-offline-uncached).
//
// The provider (client/v2/empty/arriving.jsx) turns `GET /_api/sync/availability` into S1 row-slots ghost
// rows + the "Getting …" foot. Pinned here:
//   - a cold start (no answer, or `waiting`) draws nothing — no flash of "not on this Mac";
//   - arriving rows are named, dimmed and pulsing (the kit's ArrivingRow); the foot is the 05 line;
//   - a canvas the server already calls present but the panel's index does not list yet stays arriving
//     (never a frame of missing, never two rows), and leaves once the index lists it;
//   - offline + never downloaded is dim with a cloud; "Show canvases on this Mac" hides those rows;
//   - the card says the CONTRACT/05 words and has one action;
//   - polling is bounded (one request in flight, no storm when the index churns).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const D = '.design';
const ROOT = `${D}/ui`;
const PID = 'l0123456789abcdef';

type Model = Record<string, unknown> | null;

const arriving = (
  extra: Partial<{ phase: string; done: number; total: number; pending: unknown[] }> = {}
) => ({
  v: 1,
  phase: 'arriving',
  done: 41,
  total: 93,
  project: 'Alligators brand',
  pending: [
    { path: 'ui/2026/Combine-cisla.tsx', name: 'Combine-cisla', state: 'arriving' },
    { path: 'ui/2026/Combine-video-AI.tsx', name: 'Combine-video-AI', state: 'arriving' },
  ],
  ...extra,
});

describe('arrivingSlots (pure)', () => {
  const kit = () => import('../client/v2/empty/arriving.jsx');
  test('cold start: no answer or `waiting` → no ghosts, no foot', async () => {
    const { arrivingSlots } = await kit();
    for (const m of [null, { phase: 'waiting', done: 2, total: 2, pending: [] }, {}]) {
      const out = arrivingSlots(m, { indexed: new Set() });
      expect(out.ghosts).toEqual([]);
      expect(out.foot).toBeNull();
    }
  });

  test('arriving: one dim pulsing ghost per pending canvas, and the 05 foot', async () => {
    const { arrivingSlots } = await kit();
    const out = arrivingSlots(arriving(), { indexed: new Set(['ui/2026/Combine-kampan.tsx']) });
    expect(out.ghosts.map((g: { path: string }) => g.path)).toEqual([
      'ui/2026/Combine-cisla.tsx',
      'ui/2026/Combine-video-AI.tsx',
    ]);
    expect(out.ghosts[0].slot).toEqual({ dim: true, arriving: true });
    expect(out.foot).toEqual({ text: 'Getting Alligators brand · 41 of 93 canvases' });
  });

  test('present on the server, not yet in the panel index: still arriving — then gone, never missing', async () => {
    const { arrivingSlots } = await kit();
    const first = arrivingSlots(arriving(), { indexed: new Set() });
    // The server now says Combine-cisla is present (it left `pending`); the panel's index lags.
    const lagging = arrivingSlots(
      arriving({
        done: 42,
        pending: [
          { path: 'ui/2026/Combine-video-AI.tsx', name: 'Combine-video-AI', state: 'arriving' },
        ],
      }),
      { indexed: new Set(), carried: first.carried }
    );
    const cisla = lagging.ghosts.find(
      (g: { path: string }) => g.path === 'ui/2026/Combine-cisla.tsx'
    );
    expect(cisla?.slot).toEqual({ dim: true, arriving: true });
    // The index lists it: the ghost goes (the real row draws), and it is never a not-local row on the way.
    const landed = arrivingSlots(arriving({ done: 42, pending: [], phase: 'arriving' }), {
      indexed: new Set(['ui/2026/Combine-cisla.tsx']),
      carried: lagging.carried,
    });
    expect(
      landed.ghosts.some((g: { path: string }) => g.path === 'ui/2026/Combine-cisla.tsx')
    ).toBe(false);
  });

  test('a ghost whose path the index already lists is never drawn (no duplicate row)', async () => {
    const { arrivingSlots } = await kit();
    const out = arrivingSlots(arriving(), {
      indexed: new Set(['ui/2026/Combine-cisla.tsx']),
    });
    expect(out.ghosts.map((g: { path: string }) => g.path)).toEqual([
      'ui/2026/Combine-video-AI.tsx',
    ]);
  });

  test('offline: not-local rows are dim (cloud); "Show canvases on this Mac" hides them; no foot', async () => {
    const { arrivingSlots } = await kit();
    const offline = {
      phase: 'offline',
      done: 2,
      total: 4,
      project: 'Alligators brand',
      pending: [
        { path: 'ui/2026/Combine-video-AI.tsx', name: 'Combine-video-AI', state: 'not-local' },
      ],
    };
    const out = arrivingSlots(offline, { indexed: new Set() });
    expect(out.ghosts[0].slot).toEqual({ dim: true, notLocal: true });
    expect(out.foot).toBeNull();
    expect(arrivingSlots(offline, { indexed: new Set(), localOnly: true }).ghosts).toEqual([]);
  });
});

// ── the panel ───────────────────────────────────────────────────────────────────────────────────────

function project() {
  const paths = [`${ROOT}/2026/Combine-kampan.tsx`, `${ROOT}/2026/Combine-letak-registrace.tsx`];
  return {
    groups: [
      { label: 'UI canvases', kind: 'canvas', fullPath: ROOT, paths, dirs: [`${ROOT}/2026`] },
    ],
    snapshot: {
      pid: PID,
      project: { designRel: D },
      writer: { seq: 7 },
      canvases: paths.map((p, i) => ({
        rel: p.slice(D.length + 1),
        kind: 'canvas',
        mtimeMs: 1000 + i,
        madeByAi: false,
        cover: null,
        artboards: [{ id: 'a', kind: 'web' }],
      })),
    },
  };
}

const realFetch = globalThis.fetch;
let model: Model = null;
let asked = 0;

function installFetch(snapshot: unknown) {
  globalThis.fetch = (async (url: string) => {
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.startsWith('/_api/sync/availability')) {
      asked++;
      return model ? ok(model) : new Response('{}', { status: 503 });
    }
    if (url.startsWith('/_api/index')) return ok(snapshot);
    if (url === '/_api/pins') return ok({ v: 1, pins: [], opened: {} });
    return ok({});
  }) as unknown as typeof fetch;
}

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  model = null;
  asked = 0;
  (await import('../client/v2/empty/arriving.jsx')).setShowLocalOnly(false);
});

const settle = (ms = 420) => act(async () => new Promise((r) => setTimeout(r, ms)));
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function mount() {
  const p = project();
  installFetch(p.snapshot);
  (await import('../client/v2/canvases/row-slots.js')).resetRowSlots();
  const { CanvasesPanel } = await import('../client/v2/canvases/canvases-panel.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (groups = p.groups) =>
    root.render(
      <CanvasesPanel
        groups={groups}
        search=""
        projectLabel="Alligators brand"
        activePath={null}
        onOpen={() => {}}
        expansion={{ isOpen: () => true, setOpen: () => {} }}
      />
    );
  await act(async () => render());
  await settle();
  return { host, p, rerender: (g: typeof p.groups) => act(async () => render(g)) };
}

describe('the Canvases panel', () => {
  test('cold start: the availability route has not answered — no ghost, the default foot', async () => {
    model = null;
    const { host } = await mount();
    expect(host.querySelector('[data-testid^="canvas-row-arriving-"]')).toBeNull();
    expect(host.querySelector('[data-testid^="canvas-row-not-local-"]')).toBeNull();
    expect(q(host, 'canvases-foot')?.getAttribute('data-slot')).toBe('default');
  });

  test('arriving rows are named, dimmed and pulsing; the foot says how far it has got', async () => {
    model = arriving();
    const { host } = await mount();
    const row = q(host, 'canvas-row-arriving-ui-2026-combine-video-ai');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('Combine-video-AI');
    expect(row?.querySelector('[data-testid="arriving-row"] .es-pulse')).not.toBeNull();
    expect(row?.closest('.cv-row')?.classList.contains('is-dim')).toBe(true);
    // the arrived ones are normal rows
    expect(q(host, 'canvas-row-ui-2026-combine-kampan')).not.toBeNull();
    expect(q(host, 'canvases-foot')?.textContent).toBe(
      'Getting Alligators brand · 41 of 93 canvases'
    );
    expect(q(host, 'canvases-foot')?.getAttribute('data-slot')).toBe('arriving');
  });

  test('a canvas lands mid-open: arriving → the normal row, no frame of missing, never two rows', async () => {
    model = arriving();
    const { host, p, rerender } = await mount();
    expect(q(host, 'canvas-row-arriving-ui-2026-combine-cisla')).not.toBeNull();
    // the server already counts it present; the panel's index has not refreshed
    model = arriving({
      done: 42,
      pending: [
        { path: 'ui/2026/Combine-video-AI.tsx', name: 'Combine-video-AI', state: 'arriving' },
      ],
    });
    await settle(3400);
    expect(q(host, 'canvas-row-arriving-ui-2026-combine-cisla')).not.toBeNull();
    expect(q(host, 'canvas-row-ui-2026-combine-cisla')).toBeNull();
    // the index lists it: one normal row, no ghost
    const groups = [
      { ...p.groups[0], paths: [...p.groups[0].paths, `${ROOT}/2026/Combine-cisla.tsx`] },
    ];
    await rerender(groups as typeof p.groups);
    await settle(50);
    expect(q(host, 'canvas-row-arriving-ui-2026-combine-cisla')).toBeNull();
    expect(q(host, 'canvas-row-ui-2026-combine-cisla')).not.toBeNull();
    expect(q(host, 'canvas-row-not-local-ui-2026-combine-cisla')).toBeNull();
  });

  test('offline + never downloaded: dim with a cloud; Show canvases on this Mac hides it', async () => {
    model = {
      v: 1,
      phase: 'offline',
      done: 2,
      total: 3,
      project: 'Alligators brand',
      pending: [
        { path: 'ui/2026/Combine-video-AI.tsx', name: 'Combine-video-AI', state: 'not-local' },
      ],
    };
    const { host } = await mount();
    const row = q(host, 'canvas-row-not-local-ui-2026-combine-video-ai');
    expect(row).not.toBeNull();
    expect(row?.closest('[role="treeitem"]')?.getAttribute('aria-label')).toBe(
      "Combine-video-AI isn't on this Mac yet."
    );
    expect(q(host, 'canvases-foot')?.getAttribute('data-slot')).toBe('default');
    const { setShowLocalOnly } = await import('../client/v2/empty/arriving.jsx');
    await act(async () => setShowLocalOnly(true));
    expect(q(host, 'canvas-row-not-local-ui-2026-combine-video-ai')).toBeNull();
  });

  test('the index churning does not become a request storm', async () => {
    model = arriving();
    const { p, rerender } = await mount();
    const start = asked;
    for (let i = 0; i < 30; i++) await rerender([{ ...p.groups[0] }] as typeof p.groups);
    await settle(200);
    expect(asked - start).toBeLessThanOrEqual(1);
  });
});

describe('NotLocalCanvas', () => {
  test('the 05 words, one action that narrows the panel', async () => {
    const { NotLocalCanvas } = await import('../client/v2/empty/not-local.jsx');
    const { showLocalOnly } = await import('../client/v2/empty/arriving.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    let shown = 0;
    await act(async () =>
      root.render(<NotLocalCanvas name="Combine-video-AI" onShowLocal={() => shown++} />)
    );
    const card = q(host, 'canvas-not-local');
    expect(card?.textContent).toContain("Combine-video-AI isn't on this Mac yet.");
    expect(card?.textContent).toContain(
      'It opens by itself when this Mac is back online. Nothing in it is lost — the cloud copy is safe.'
    );
    expect(card?.querySelectorAll('button')).toHaveLength(1);
    const btn = q(host, 'canvas-not-local-show-local');
    expect(btn?.textContent).toBe('Show canvases on this Mac');
    await act(async () => btn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(shown).toBe(1);
    expect(showLocalOnly()).toBe(true);
  });
});

// A6c (S11.4 patch): the viewport asks before it frames a canvas. A canvas that is not on this Mac
// (offline, never came down) is the card INSTEAD of the frame — no iframe, so no toolbar and no zoom
// (both live in the canvas runtime) and no loading card waiting for a frame that will never load.
describe('the viewport and a canvas that is not on this Mac', () => {
  const PATH = `${D}/ui/2026/Combine-video-AI.tsx`;
  async function mountViewport(state: string) {
    const { Viewport } = await import('../client/shell/viewport.jsx');
    const asked: string[] = [];
    const saved = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ canvas: { path: 'ui/2026/Combine-video-AI.tsx', state } }),
      } as Response;
    }) as unknown as typeof fetch;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    try {
      await act(async () =>
        root.render(
          <Viewport
            tabs={[{ path: PATH }]}
            activePath={PATH}
            registerIframe={() => {}}
            cfg={{ designRel: D }}
            loadingPath={PATH}
            canvasReloadNonce={0}
          />
        )
      );
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    } finally {
      globalThis.fetch = saved;
    }
    return { host, asked };
  }

  test('not-local: the card, no frame, no loading card', async () => {
    const { host, asked } = await mountViewport('not-local');
    expect(asked.some((u) => u.startsWith('/_api/sync/availability?canvas='))).toBe(true);
    expect(q(host, 'canvas-not-local')?.textContent).toContain(
      "Combine-video-AI isn't on this Mac yet."
    );
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('[data-testid="canvas-loading"]')).toBeNull();
  });

  test('present: the frame, as before', async () => {
    const { host } = await mountViewport('present');
    expect(q(host, 'canvas-not-local')).toBeNull();
    expect(host.querySelector('iframe')).not.toBeNull();
  });

  // Q13 fallback (decision v2-lead-arriving-canvas-copy): still coming down, no sizes → one card.
  test('arriving: "<name> is on its way.", no frame, no loading card, no error card', async () => {
    const { host } = await mountViewport('arriving');
    expect(q(host, 'canvas-arriving')?.textContent).toContain('Combine-video-AI is on its way.');
    expect(q(host, 'canvas-not-local')).toBeNull();
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('[data-testid="canvas-loading"]')).toBeNull();
  });
});

describe('useCanvasAvailability keeps asking while a canvas is arriving', () => {
  test('arriving → present without a flicker; stops asking once it is here', async () => {
    const { useCanvasAvailability } = await import('../client/v2/empty/not-local.jsx');
    const answers = ['arriving', 'arriving', 'present'];
    let asked = 0;
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ canvas: { state: answers[Math.min(asked++, answers.length - 1)] } }),
    })) as unknown as typeof fetch;
    const seen: Array<string | null> = [];
    function Probe() {
      const state = useCanvasAvailability('ui/a.tsx', { fetchImpl, recheckMs: 10 });
      seen.push(state);
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Probe />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    const settled = seen.filter((s) => s !== null);
    expect(settled[0]).toBe('arriving');
    expect(settled.at(-1)).toBe('present');
    // never dropped back to "asking" (null) between asks — that would mount the frame for a beat
    expect(seen.slice(seen.indexOf('arriving')).includes(null)).toBe(false);
    const after = asked;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(asked).toBe(after);
  });
});
