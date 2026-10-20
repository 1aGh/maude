// S10.9 (13 · ds-edit-reach) — the reach view: "Used in 5 canvases · Show" draws every place ringed, then opens the
// same review list. The frames are asked where the elements are (`ds-rects`), answer in their own pixels
// (`ds-rects-result`), and only the ids we asked about get a ring. The host reaches it through the bus (kind
// 'reach'); the registry action `ds.show-reach` is a read with an agent path (`maude design ds usage`).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AGENT_PATHS as ACTION_AGENTS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { c2sSpec, DS_RECTS_MAX, s2cSpec } from '../bridge/dgn-protocol.ts';
import { canvasDsRender, canvasUrl } from '../client/canvas-url.js';
import { loadReach, reachQuery } from '../client/v2/ds/reach-data.js';
import { reachModel } from '../client/v2/ds/reach-model.js';
import { DsReachView, FRAME_SCALE } from '../client/v2/ds/reach-view.jsx';
import { onDsReviewRequest, resetDsReviewBus } from '../client/v2/ds/review-bus.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';

beforeAll(() => {
  // the frames are never loaded here (no network): each iframe gets a window of its own and the test answers for it
  GlobalRegistrator.register({ settings: { disableIframePageLoading: true } });
  // happy-dom reports each disabled load on the console; that is this test's own setting, not news
  const report = console.error.bind(console);
  console.error = (...a: unknown[]) => {
    if (!String(a[0] ?? '').includes('Iframe page loading is disabled')) report(...a);
  };
  const wins = new WeakMap<object, object>();
  Object.defineProperty(window.HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get(this: object) {
      if (!wins.has(this)) wins.set(this, { postMessage() {} });
      return wins.get(this);
    },
  });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  resetDsReviewBus();
});

const ORIGIN = 'http://canvas.test';
const CFG = {
  designRel: '.design',
  canvasOrigin: ORIGIN,
  designSystems: [{ name: 'studio', path: 'system/studio' }],
  dsConverted: { studio: true },
  systemHeads: { studio: 'a'.repeat(64) },
  canvasDesignSystems: { 'ui/Homepage.tsx': 'studio', 'ui/Pricing.tsx': 'studio' },
};
const USAGE = {
  canvases: [
    {
      rel: 'ui/Homepage.tsx',
      places: 14,
      artboards: { 'ab-desktop': 14 },
      elements: [
        { artboard: 'ab-desktop', id: 'cta' },
        { artboard: 'ab-desktop', id: 'nav' },
      ],
    },
    {
      rel: 'ui/Pricing.tsx',
      places: 11,
      artboards: { 'ab-desktop': 11 },
      elements: [{ artboard: 'ab-desktop', id: 'buy' }],
    },
    {
      rel: 'ui/Onboarding.tsx',
      places: 4,
      artboards: { 'ab-one': 2, 'ab-two': 1, 'ab-three': 1 },
      elements: [{ artboard: 'ab-one', id: 'x1' }],
    },
  ],
};
const REVIEW = {
  system: 'studio',
  expectHead: 'f'.repeat(64),
  changes: [
    { css: '--accent', label: 'Accent', before: { light: '#0a6' }, after: { light: '#06a' } },
  ],
  canvases: [
    { path: 'ui/Homepage.tsx', folder: 'ui', state: 'follows', ticked: true },
    { path: 'ui/Pricing.tsx', folder: 'ui', state: 'follows', ticked: true },
    { path: 'ui/Landing page.tsx', folder: 'ui', state: 'left-out', ticked: false },
  ],
};

const sleep = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

type Sent = Array<{ data: any; origin: string | undefined }>;
function spy(win: Window): Sent {
  const sent: Sent = [];
  (win as unknown as { postMessage: unknown }).postMessage = (data: unknown, origin?: string) =>
    void sent.push({ data, origin });
  return sent;
}
const say = (source: Window, data: Record<string, unknown>) => {
  const ev = new MessageEvent('message', { data, origin: ORIGIN });
  Object.defineProperty(ev, 'source', { value: source });
  window.dispatchEvent(ev);
};

async function mount(over: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const calls = { updated: [] as any[][], cancelled: 0, closed: 0 };
  const props = {
    ds: 'studio',
    cfg: CFG,
    name: 'Accent',
    swatch: { before: '#0a6', after: '#06a', beforeName: 'Azure', afterName: 'Deeper azure' },
    reach: reachModel(USAGE),
    review: REVIEW,
    places: { 'ui/Homepage.tsx': 14, 'ui/Pricing.tsx': 11 },
    onUpdate: async (rows: any[]) => {
      calls.updated.push(rows);
      return { ok: true };
    },
    onCancel: async () => {
      calls.cancelled += 1;
      return { ok: true };
    },
    onClose: () => {
      calls.closed += 1;
    },
    ...over,
  };
  await act(async () => root.render(createElement(DsReachView as never, props)));
  const frames = [...host.querySelectorAll<HTMLIFrameElement>('[data-testid="ds-reach-iframe"]')];
  return { host, calls, frames, props };
}
const ids = (host: Element, id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)];

describe('the reach view', () => {
  test('a frame per artboard, the tags in the words of the canvas, the lines from the swatch', async () => {
    const { host, frames } = await mount();
    // 5 artboards use it (Homepage, Pricing, Onboarding × 3); four frames are drawn, the fifth is named
    expect(frames).toHaveLength(4);
    expect(ids(host, 'ds-reach-frame')).toHaveLength(4);
    expect(host.querySelector('[data-testid="ds-reach-tag"]')?.textContent).toBe(
      '5 patterns · 29 places'
    );
    expect(ids(host, 'ds-reach-places')[0]?.textContent).toBe('14 places');
    expect(host.querySelector('[data-testid="ds-reach-title"]')?.textContent).toBe(
      'One colour, everywhere it lands'
    );
    expect(host.querySelector('[data-testid="ds-reach-sub"]')?.textContent).toContain(
      'Accent goes from Azure to Deeper azure.'
    );
    expect(host.querySelector('[data-testid="ds-reach-used"]')?.textContent).toContain(
      'Used in 3 canvases · showing'
    );
    expect(host.querySelector('[data-testid="ds-reach-more"]')?.textContent).toBe(
      'Onboarding is in the review too'
    );
    expect(ids(host, 'ds-reach-line')).toHaveLength(4);
  });

  test('the frames load the canvas as a read-only preview of the system', async () => {
    const { frames } = await mount();
    const src = frames[0]?.getAttribute('src') ?? '';
    expect(src.startsWith(ORIGIN)).toBe(true);
    const q = new URL(src).searchParams;
    expect(q.get('embed')).toBe('1');
    expect(q.get('ro')).toBe('1');
    expect(q.get('comments')).toBe('0');
    expect(frames[0]?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    // `?dsPreview=<ds>@pending` is the system's current look (a revision), flagged pending
    const r = canvasDsRender('ui/Homepage.tsx', CFG, { dsPreview: 'studio@pending' });
    expect(r?.pending).toBe(true);
    expect(r?.rev).toBe('a'.repeat(64));
    expect(canvasDsRender('ui/Homepage.tsx', CFG, { dsPreview: 'studio@nope' })?.pending).toBe(
      undefined
    );
    expect(canvasUrl('ui/Homepage.tsx', CFG, { dsPreview: 'studio@pending' })).toContain(
      `${'a'.repeat(64)}.tokens.css`
    );
  });

  test('a loaded frame is shown its artboard, then asked where the elements are; the answer becomes rings', async () => {
    const { host, frames } = await mount();
    const win = frames[0]?.contentWindow as Window;
    expect(win).toBeTruthy();
    const sent = spy(win);
    await act(async () => say(win, { dgn: 'loaded', file: 'x' }));
    await sleep(40);
    const types = sent.map((s) => s.data.dgn);
    expect(types).toContain('reveal-artboard');
    expect(sent.find((s) => s.data.dgn === 'reveal-artboard')?.data).toMatchObject({
      artboardId: 'ab-desktop',
      glide: false,
      flash: false,
    });
    const ask = sent.find((s) => s.data.dgn === 'ds-rects');
    expect(ask?.origin).toBe(ORIGIN);
    expect(ask?.data.artboard).toBe('ab-desktop');
    expect(ask?.data.ids.sort()).toEqual(['cta', 'nav']);
    const seq = sent.filter((s) => s.data.dgn === 'ds-rects').at(-1)?.data.seq;
    // the parser (the dgn table) is what the view trusts: the frame answers one id we asked, one we did not
    await act(async () =>
      say(win, {
        dgn: 'ds-rects-result',
        seq,
        view: { w: 960, h: 600 },
        label: 'Desktop',
        rects: [
          { id: 'cta', x: 100, y: 200, w: 120, h: 40 },
          { id: 'sneaky', x: 1, y: 1, w: 50, h: 50 },
        ],
      })
    );
    const first = host.querySelectorAll('[data-testid="ds-reach-frame"]')[0] as Element;
    const rings = [...first.querySelectorAll('[data-testid="ds-reach-ring"]')] as HTMLElement[];
    expect(rings).toHaveLength(1);
    expect(rings[0]?.style.left).toBe(`${100 * FRAME_SCALE}px`);
    expect(rings[0]?.style.width).toBe(`${120 * FRAME_SCALE}px`);
    expect(first.querySelector('[data-testid="ds-reach-rings"]')?.getAttribute('data-count')).toBe(
      '1'
    );
  });

  test('a stale answer, an answer from a stranger and a malformed answer draw nothing', async () => {
    const { host, frames } = await mount();
    const win = frames[0]?.contentWindow as Window;
    const sent = spy(win);
    await act(async () => say(win, { dgn: 'loaded', file: 'x' }));
    await sleep(40);
    const seq = sent.filter((s) => s.data.dgn === 'ds-rects').at(-1)?.data.seq as number;
    const rect = { id: 'cta', x: 1, y: 1, w: 10, h: 10 };
    const good = { dgn: 'ds-rects-result', view: { w: 960, h: 600 }, rects: [rect] };
    await act(async () => say(win, { ...good, seq: seq - 1 })); // stale
    await act(async () => say({} as Window, { ...good, seq })); // not one of our frames
    await act(async () => say(win, { ...good, seq, rects: [{ ...rect, w: 'wide' }] })); // junk
    expect(ids(host, 'ds-reach-ring')).toHaveLength(0);
  });

  test('once the rings are drawn the review list opens; Update sends the ticks, Cancel puts the swatch back', async () => {
    const { host, frames, calls } = await mount();
    expect(host.querySelector('[data-testid="ds-reach-review"]')).toBeNull();
    // every frame answers → the list opens (it never waits on a slow frame longer than REVIEW_AFTER_MS)
    for (const [i, fr] of frames.entries()) {
      const win = fr.contentWindow as Window;
      const sent = spy(win);
      await act(async () => say(win, { dgn: 'loaded', file: 'x' }));
      await sleep(10);
      const seq = sent.filter((s) => s.data.dgn === 'ds-rects').at(-1)?.data.seq;
      await act(async () =>
        say(win, { dgn: 'ds-rects-result', seq, view: { w: 960, h: 600 }, rects: [] })
      );
      if (i < frames.length - 1)
        expect(host.querySelector('[data-testid="ds-reach-review"]')).toBeNull();
    }
    expect(host.querySelector('[data-testid="ds-reach-review"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="ds-reach-review-title"]')?.textContent).toBe(
      'Update canvases with the new Accent?'
    );
    const rows = ids(host, 'ds-reach-row');
    expect(rows.map((r) => r.getAttribute('data-path'))).toEqual([
      'ui/Homepage.tsx',
      'ui/Pricing.tsx',
      'ui/Landing page.tsx',
    ]);
    // untick Pricing → "Update 1 canvas"
    await act(async () => (ids(host, 'ds-reach-tick')[1] as HTMLElement).click());
    expect(host.querySelector('[data-testid="ds-reach-update"]')?.textContent).toBe(
      'Update 1 canvas'
    );
    await act(async () =>
      (host.querySelector('[data-testid="ds-reach-update"]') as HTMLElement).click()
    );
    expect(calls.updated).toHaveLength(1);
    expect(calls.updated[0]?.map((r: any) => [r.path, r.ticked])).toEqual([
      ['ui/Homepage.tsx', true],
      ['ui/Pricing.tsx', false],
      ['ui/Landing page.tsx', false],
    ]);
    await act(async () =>
      (host.querySelector('[data-testid="ds-reach-cancel"]') as HTMLElement).click()
    );
    expect(calls.cancelled).toBe(1);
  });

  test('a token nothing waits on still has a reach — and no review list under it', async () => {
    const { host, frames } = await mount({ review: null });
    expect(frames.length).toBeGreaterThan(0);
    await sleep(2700);
    expect(host.querySelector('[data-testid="ds-reach-review"]')).toBeNull();
  });

  test('a refused update says so under the list and stays open', async () => {
    const { host, frames } = await mount({
      onUpdate: async () => ({
        ok: false,
        message: 'Not updated. You can look here; ask to edit.',
      }),
    });
    await sleep(2700); // the list opens by itself when a frame is slow
    expect(frames.length).toBeGreaterThan(0);
    await act(async () =>
      (host.querySelector('[data-testid="ds-reach-update"]') as HTMLElement).click()
    );
    expect(host.querySelector('[data-testid="ds-reach-error"]')?.textContent).toBe(
      'Not updated. You can look here; ask to edit.'
    );
    expect(host.querySelector('[data-testid="ds-reach"]')).not.toBeNull();
  });

  test('Hide and Close go back and change nothing', async () => {
    const { host, calls } = await mount();
    await act(async () =>
      (host.querySelector('[data-testid="ds-reach-hide"]') as HTMLElement).click()
    );
    await act(async () =>
      (host.querySelector('[data-testid="ds-reach-close"]') as HTMLElement).click()
    );
    expect(calls.closed).toBe(2);
    expect(calls.updated).toHaveLength(0);
    expect(calls.cancelled).toBe(0);
  });
});

describe('the data and the doors', () => {
  test('reach-data asks the usage index for one token and turns the answer into the model', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return { ok: true, status: 200, json: async () => USAGE } as Response;
    }) as unknown as typeof fetch;
    const r = await loadReach({ ds: 'studio', css: '--accent', name: 'Accent' }, fetchImpl);
    expect(urls).toEqual(['/_api/ds/usage?ds=studio&css=--accent']);
    expect(r.ok && r.model.tag).toBe('5 patterns · 29 places');
    expect(reachQuery({ css: '--a b' })).toBeNull();
    expect(reachQuery({ component: 'Button' })).toBe('component=Button');
  });

  test('nothing using it, a refusal and a dead server each say so in words', async () => {
    const mk = (status: number, body: unknown) =>
      (async () => ({ ok: status < 400, status, json: async () => body }) as Response) as never;
    const none = await loadReach(
      { ds: 's', css: '--x', name: 'Accent' },
      mk(200, { canvases: [] })
    );
    expect(none).toEqual({ ok: false, message: 'Nothing uses Accent yet.' });
    const no = await loadReach({ ds: 's', css: '--x', name: 'Accent' }, mk(403, {}));
    expect(no.ok).toBe(false);
    const dead = await loadReach({ ds: 's', css: '--x', name: 'Accent' }, (async () => {
      throw new Error('down');
    }) as never);
    expect(dead).toEqual({ ok: false, message: 'Could not look up the places. Try again.' });
  });

  test('ds.show-reach is registered as a read with an agent path, and its runner asks the host', () => {
    const def = ACTIONS_BY_ID.get('ds.show-reach');
    expect(def).toBeDefined();
    expect(def?.visible?.minRole).toBe('view');
    expect(ACTION_AGENTS['ds.show-reach']?.agent.path).toBe('cli');
    // a read: the usage route (GET /_api/ds/usage, anyone who can open the project) is what the verb calls
    expect(ACTION_AGENTS['ds.show-reach']?.server).toBeUndefined();
    const got: Array<Record<string, unknown>> = [];
    onDsReviewRequest((r) => got.push(r));
    createMenuHandlers({} as never)['ds.show-reach']?.({
      ds: 'studio',
      css: '--accent',
      name: 'Accent',
      swatch: { before: '#0a6' },
    });
    expect(got).toEqual([
      {
        kind: 'reach',
        ds: 'studio',
        canvas: undefined,
        css: '--accent',
        component: undefined,
        name: 'Accent',
        swatch: { before: '#0a6' },
      },
    ]);
  });

  test('the dgn rows: ds-rects (shell → canvas) and ds-rects-result (canvas → shell) clean what they carry', () => {
    const ask = s2cSpec('ds-rects');
    expect(ask?.gate).toBe('parent');
    expect(ask?.parse({ seq: 3, artboard: 'ab-desktop', ids: ['a', 'b'] })).toEqual({
      seq: 3,
      artboard: 'ab-desktop',
      ids: ['a', 'b'],
    });
    expect(ask?.parse({ seq: 3, artboard: null, ids: [] })).toEqual({
      seq: 3,
      artboard: null,
      ids: [],
    });
    expect(ask?.parse({ seq: -1, artboard: null, ids: [] })).toBeNull();
    expect(ask?.parse({ seq: 1, artboard: null, ids: ['has space'] })).toBeNull();
    expect(
      ask?.parse({ seq: 1, artboard: null, ids: Array(DS_RECTS_MAX + 1).fill('a') })
    ).toBeNull();
    const ans = c2sSpec('ds-rects-result');
    expect(ans?.gate).toBe('frame');
    const ok = {
      seq: 1,
      view: { w: 960, h: 600 },
      rects: [{ id: 'cta', x: 1, y: 2, w: 3, h: 4 }],
    };
    expect(ans?.parse({ ...ok, extra: 'dropped' })).toEqual(ok);
    expect(ans?.parse({ ...ok, rects: [{ id: 'cta', x: 'a', y: 2, w: 3, h: 4 }] })).toBeNull();
    expect(
      ans?.parse({
        ...ok,
        rects: Array(DS_RECTS_MAX + 1).fill({ id: 'a', x: 1, y: 1, w: 1, h: 1 }),
      })
    ).toBeNull();
  });
});
