// S8.20 — search in pictures in the Assets tab (12 · ia-assets-find, 05 · es-search-more): the offer under the first search,
// the one sheet (Cancel remembered), "Seen in the picture" with marked words, the foot words, the no-AI fallback, the
// describing line with Stop, and the registry rows. The studio is a stub `fetch`: nothing is described here.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS } from '../actions/index.ts';
import { runAssetsAction } from '../client/v2/assets/assets-bus.js';
import { offerOf, progressWords, searchFootWords } from '../client/v2/assets/describe-client.js';
import { markRuns, seenLineOf } from '../client/v2/assets/search-marks.jsx';
import { bindPaletteEnv } from '../client/v2/search/search-env.js';

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; body?: unknown }> = [];
let describeAnswer: Record<string, unknown> | null = null;
let hitsFor: Record<string, unknown[]> = {};

const row = (rel: string, kind = 'image') => ({
  rel,
  kind,
  size: 4096,
  mtimeMs: 1,
  usedIn: [],
  usedBy: 0,
  usedElsewhere: false,
  olderVersions: false,
  recentTake: false,
  notUsed: true,
});
const INDEX = {
  seq: 1,
  history: 'ready',
  assets: [
    row('assets/touchdown-2025.jpg'),
    row('assets/IMG_2231.jpg'),
    row('assets/IMG_2240.jpg'),
  ],
};
const status = (over: Record<string, unknown> = {}) => ({
  consent: { asked: false, on: false, since: 0, dailyCap: 200, stopped: false },
  ai: true,
  total: 3,
  done: 0,
  running: false,
  paused: 'off',
  ...over,
});
const ON = { asked: true, on: true, since: 5, dailyCap: 200, stopped: false };
const NIGHT_HIT = {
  rel: 'assets/IMG_2231.jpg',
  caption: 'Player scores a touchdown at night',
  tags: ['football', 'touchdown'],
  text: '',
  marks: { caption: [[16, 25]], text: [], tags: [1] },
  close: false,
};

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string; method?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.startsWith('/_api/index?part=assets')) return Response.json(INDEX);
    if (url.startsWith('/_api/describe/consent')) {
      const on = (JSON.parse(init?.body ?? '{}') as { on: boolean }).on;
      describeAnswer = status({
        consent: { ...ON, on, since: on ? 5 : 0 },
        paused: on ? null : 'off',
      });
      return Response.json({ ok: true, status: describeAnswer });
    }
    if (url.startsWith('/_api/describe/stop')) {
      describeAnswer = status({ consent: { ...ON, stopped: true }, paused: 'stopped', done: 1 });
      return Response.json({ ok: true, status: describeAnswer });
    }
    if (url.startsWith('/_api/describe')) {
      if (!describeAnswer) return new Response('{}', { status: 404 });
      const qp = new URL(url, 'http://x').searchParams.get('q') ?? '';
      return Response.json({ ok: true, status: describeAnswer, hits: hitsFor[qp] ?? [] });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
let unbindEnv: (() => void) | null = null;
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  calls = [];
  describeAnswer = null;
  hitsFor = {};
  unbindEnv?.();
  unbindEnv = null;
});

async function mount({ ai = true }: { ai?: boolean } = {}) {
  unbindEnv = bindPaletteEnv({ canAskAI: () => ai, projectName: 'Alligators brand' });
  const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<AssetsPanel designRel=".design" />));
  await settle();
  return host;
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 220)));
const q = (host: HTMLElement, id: string) =>
  host.ownerDocument.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = async (el: Element | null | undefined) => {
  await act(async () => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};
async function search(host: HTMLElement, text: string) {
  const input = q(host, 'assets-search') as HTMLInputElement;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, text);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await settle();
}
const posts = (path: string) => calls.filter((c) => c.url.startsWith(path)).map((c) => c.body);

describe('asked once per project, never assumed', () => {
  test('the first search offers it; Turn on… opens the one sheet; Cancel is remembered as an answer', async () => {
    describeAnswer = status();
    const host = await mount();
    await search(host, 'touchdown');
    expect(q(host, 'assets-describe-offer')?.dataset.kind).toBe('turn-on');
    expect(q(host, 'assets-search-foot')?.textContent).toBe('Searched 3 assets — names and tags');
    expect(q(host, 'assets-group-seen')).toBeNull();
    await click(q(host, 'assets-describe-turn-on'));
    const sheet = q(host, 'assets-describe-sheet');
    expect(sheet?.querySelector('h2')?.textContent).toBe(
      'Describe the pictures in Alligators brand?'
    );
    expect(sheet?.textContent).toContain(
      'Uses your Claude account — one short look at each of 3 pictures and clips.'
    );
    expect(document.activeElement).toBe(q(host, 'assets-describe-cancel'));
    expect(posts('/_api/describe/consent')).toEqual([]); // opening the sheet sends nothing
    await click(q(host, 'assets-describe-cancel'));
    expect(posts('/_api/describe/consent')).toEqual([{ on: false }]);
    expect(q(host, 'assets-describe-sheet')).toBeNull();
    expect(q(host, 'assets-describe-offer')).toBeNull(); // asked: no offer again
  });

  test('after a yes, "touchdown" finds the night photo under "Seen in the picture", the word marked', async () => {
    describeAnswer = status();
    hitsFor = { touchdown: [NIGHT_HIT] };
    const host = await mount();
    await search(host, 'touchdown');
    await click(q(host, 'assets-describe-turn-on'));
    await click(q(host, 'assets-describe-confirm'));
    expect(posts('/_api/describe/consent')).toEqual([{ on: true }]);
    await search(host, 'touchdow');
    await search(host, 'touchdown');
    expect(q(host, 'assets-group-seen')?.textContent).toBe('Seen in the picture1');
    const line = q(host, 'assets-seen-line');
    expect(line?.dataset.field).toBe('caption');
    expect(line?.querySelector('mark')?.textContent).toBe('touchdown');
    expect(
      line
        ?.closest('.lp-seen')
        ?.querySelector('[data-testid="assets-tile"]')
        ?.getAttribute('data-asset')
    ).toBe('assets/IMG_2231.jpg');
    // the named one stays in its own group, and the foot counts both
    expect(q(host, 'assets-search-foot')?.textContent).toBe(
      '2 results · 3 pictures still being described'
    );
  });

  test('no AI connected: names only, and the offer is Connect…', async () => {
    describeAnswer = status({ ai: false });
    const host = await mount({ ai: false });
    await search(host, 'touchdown');
    expect(q(host, 'assets-describe-offer')?.dataset.kind).toBe('connect');
    expect(q(host, 'assets-search-foot')?.textContent).toBe('Searched 3 assets — names only');
  });

  test('no hits while never asked: "Let AI describe your pictures" (05 · es-search-more)', async () => {
    describeAnswer = status();
    const host = await mount();
    await search(host, 'logo bílé');
    expect(q(host, 'assets-nohits')?.textContent).toContain('Nothing called “logo bílé”.');
    expect(q(host, 'assets-nohits-describe')?.textContent).toBe(
      "So search finds what's in them. Once for Alligators brand, on your Claude account."
    );
  });

  test('a studio that does not describe: names and tags, no offer, nothing asked', async () => {
    const host = await mount();
    await search(host, 'touchdown');
    expect(q(host, 'assets-describe-offer')).toBeNull();
    expect(q(host, 'assets-search-foot')?.textContent).toBe('Searched 3 assets — names and tags');
  });
});

describe('describing, with Stop', () => {
  test('"Describing 1 of 3 pictures" with Stop; Stop is sent, the line says where it stopped', async () => {
    describeAnswer = status({ consent: ON, paused: null, done: 1, running: true });
    const host = await mount();
    expect(q(host, 'assets-describe-progress')?.textContent).toBe('Describing 1 of 3 picturesStop');
    await click(q(host, 'assets-describe-stop'));
    expect(posts('/_api/describe/stop')).toEqual([{ stopped: true }]);
    expect(q(host, 'assets-describe-progress')?.textContent).toBe(
      'Stopped at 1 of 3 picturesResume'
    );
  });

  test('⌘K "Search in pictures" opens the sheet when off (never a silent yes) and turns it off when on', async () => {
    describeAnswer = status();
    const host = await mount();
    await act(async () => {
      runAssetsAction('assets.describe');
    });
    await settle();
    expect(q(host, 'assets-describe-sheet')).not.toBeNull();
    expect(posts('/_api/describe/consent')).toEqual([]);
    await click(q(host, 'assets-describe-confirm'));
    await act(async () => {
      runAssetsAction('assets.describe');
    });
    await settle();
    expect(posts('/_api/describe/consent')).toEqual([{ on: true }, { on: false }]);
  });
});

describe('words and marks', () => {
  test('marks split plain text only; out-of-range marks are clamped', () => {
    expect(markRuns('a touchdown at night', [[2, 11]])).toEqual([
      { t: 'a ', on: false },
      { t: 'touchdown', on: true },
      { t: ' at night', on: false },
    ]);
    expect(markRuns('<b>x</b>', [[0, 99]])).toEqual([{ t: '<b>x</b>', on: true }]);
    expect(seenLineOf({ ...NIGHT_HIT, marks: { caption: [], text: [], tags: [1] } })).toEqual({
      field: 'tags',
      text: 'touchdown',
      ranges: [[0, 9]],
    });
  });

  test('offer, foot and progress words', () => {
    expect(offerOf(status(), true)).toBe('turn-on');
    expect(offerOf(status(), false)).toBe('connect');
    expect(offerOf(status({ consent: { ...ON, on: false } }), true)).toBeNull();
    expect(offerOf(null, true)).toBeNull();
    expect(
      searchFootWords({
        count: 247,
        results: 5,
        status: status({ consent: ON, done: 158, total: 193 }),
        canAsk: true,
      })
    ).toBe('5 results · 35 pictures still being described');
    expect(
      searchFootWords({
        count: 247,
        results: 6,
        status: status({ consent: ON, done: 193, total: 193 }),
        canAsk: true,
      })
    ).toBe('6 results in 247 assets');
    expect(progressWords(status({ consent: ON, done: 12, total: 193, paused: null }))).toBe(
      'Describing 12 of 193 pictures'
    );
    expect(progressWords(status({ consent: ON, done: 193, total: 193 }))).toBe('');
  });

  test('the registry rows: a toggle ⌘K finds, and Stop; both human `consent`, both refused by the server', () => {
    const toggle = ACTIONS.find((a) => a.id === 'assets.describe');
    expect(toggle).toMatchObject({ kind: 'toggle', label: 'Search in pictures', exec: 'shell' });
    expect(ACTIONS.find((a) => a.id === 'assets.describe-stop')?.search).toEqual({ hidden: true });
    expect(AGENT_PATHS['assets.describe']).toMatchObject({
      effect: 'external',
      server: { route: '/_api/describe/consent', method: 'POST' },
      agent: { path: 'human', because: 'consent' },
    });
    expect(AGENT_PATHS['assets.describe-stop']?.agent).toMatchObject({
      path: 'human',
      because: 'consent',
    });
  });
});
