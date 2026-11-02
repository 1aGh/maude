// S8.14 — the Assets tab after a drop (12 · ia-placed): what arrived in this window is the first group, "Just added", and is
// not repeated under its kind; a tile still going up to the cloud wears a thin bar; the shell lane keeps asking while
// something uploads; "From this Mac…" with an artboard selected imports AND places (the Image (I) route, no drag).
// The drop itself: finder-drop-client.test.tsx. The write: finder-drop-plan.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { uploadingOf } from '../asset-upload-bars.tsx';
import {
  ASSET_UPLOAD_POLL_MS,
  assetUploadOf,
  clearAssetAnswers,
  createAssetStateLane,
} from '../client/v2/assets/asset-state-lane.js';
import {
  isJustAdded,
  JUST_ADDED_MS,
  splitJustAdded,
  WINDOW_OPENED_AT,
} from '../client/v2/assets/just-added.js';
import { AssetTile, uploadWords } from '../client/v2/assets/tile.jsx';

const NOW = WINDOW_OPENED_AT + 10 * 60_000;
const row = (name: string, mtimeMs: number, kind = 'image') => ({
  path: `assets/${name}`,
  name,
  kind,
  size: 10,
  mtimeMs,
});

describe('Just added is a time rule', () => {
  test('after this window opened and within the half hour; older, earlier or from the future is not', () => {
    expect(isJustAdded(row('a.jpg', NOW - 60_000), NOW)).toBe(true);
    expect(isJustAdded(row('a.jpg', NOW - JUST_ADDED_MS - 1), NOW)).toBe(false);
    expect(isJustAdded(row('a.jpg', WINDOW_OPENED_AT - 1), NOW)).toBe(false); // was already in the project
    expect(isJustAdded(row('a.jpg', NOW + 3_600_000), NOW)).toBe(false); // a clock that is wrong
    expect(isJustAdded(row('a.jpg', 0), NOW)).toBe(false);
    expect(isJustAdded(null, NOW)).toBe(false);
  });

  test('newest first; the rest keep their order', () => {
    const a = row('a.jpg', NOW - 5_000);
    const b = row('b.jpg', NOW - 1_000);
    const old = row('old.jpg', 5);
    const { added, rest } = splitJustAdded([old, a, b], NOW);
    expect(added.map((r) => r.name)).toEqual(['b.jpg', 'a.jpg']);
    expect(rest).toEqual([old]);
  });
});

describe('groups', () => {
  const loadGroups = async () =>
    (await import('../client/v2/left-panel/assets-panel.jsx')) as unknown as {
      groupAssets: (
        rows: ReturnType<typeof row>[],
        o?: { justAdded?: boolean }
      ) => Array<{ kind: string; title: string; items: ReturnType<typeof row>[] }>;
    };
  test('Just added comes first and is not repeated under Photos; video and sound keep theirs', async () => {
    const { groupAssets } = await loadGroups();
    const fresh = Date.now() + 5;
    const rows = [
      row('old.jpg', 5),
      row('new1.jpg', fresh),
      row('new2.jpg', fresh - 3),
      row('clip.mov', 5, 'video'),
    ];
    const g = groupAssets(rows, { justAdded: true });
    expect(g.map((x) => x.kind)).toEqual(['added', 'image', 'video']);
    expect(g[0]?.title).toBe('Just added');
    expect(g[0]?.items.map((r) => r.name)).toEqual(['new1.jpg', 'new2.jpg']);
    expect(g[1]?.items.map((r) => r.name)).toEqual(['old.jpg']);
  });

  test('off by default (the Not used view lists what to tidy, not what is new); nothing new, no group', async () => {
    const { groupAssets } = await loadGroups();
    const fresh = Date.now() + 5;
    expect(groupAssets([row('n.jpg', fresh)]).map((x) => x.kind)).toEqual(['image']);
    expect(groupAssets([row('o.jpg', 5)], { justAdded: true }).map((x) => x.kind)).toEqual([
      'image',
    ]);
  });
});

describe('the bar on a tile', () => {
  const html = (uploading: unknown, caption = false) =>
    renderToStaticMarkup(
      <AssetTile
        asset={{ ...row('IMG_2231.jpg', 1), usedIn: [] }}
        url="/.design/assets/IMG_2231.jpg"
        picked={false}
        canDrag
        onPick={() => {}}
        onMenu={() => {}}
        caption={caption}
        uploading={uploading as never}
      />
    );

  test('a known share draws its width and tells a screen reader; an unknown one is a moving bar', () => {
    const known = html({ progress: 0.64 });
    expect(known).toContain('data-testid="assets-tile-up"');
    expect(known).toContain('width:64%');
    expect(known).toContain('Uploading IMG_2231.jpg, 64%');
    const unknown = html({});
    expect(unknown).toContain('data-known="false"');
    expect(unknown).toContain('Uploading IMG_2231.jpg"');
  });

  test('a file that is not going up has no bar; the wide Browse view draws none', () => {
    expect(html(null)).not.toContain('assets-tile-up');
    expect(html({ progress: 0.5 }, true)).not.toContain('assets-tile-up');
    expect(uploadWords('x.jpg', null)).toBe('');
  });

  test('the canvas bar reads the same items: a share is clamped, an unknown one is null, other states draw none', () => {
    const items = new Map([
      ['assets/a.jpg', { rel: 'assets/a.jpg', state: 'uploading', progress: 1.7 }],
      ['assets/b.jpg', { rel: 'assets/b.jpg', state: 'uploading' }],
      ['assets/c.jpg', { rel: 'assets/c.jpg', state: 'waiting' }],
      ['assets/d.jpg', { rel: 'assets/d.jpg', state: 'here' }],
    ]);
    expect([...uploadingOf(items as never)]).toEqual([
      ['assets/a.jpg', 1],
      ['assets/b.jpg', null],
    ]);
  });
});

describe('the shell lane keeps asking while something uploads', () => {
  function lane(answers: Array<{ items: unknown[] }>) {
    const listeners = new Map<string, (e: unknown) => void>();
    const win = {
      addEventListener: (t: string, fn: (e: unknown) => void) => listeners.set(t, fn),
      removeEventListener: () => {},
    };
    const canvasWin = { postMessage: () => {} };
    const frame = { contentWindow: canvasWin, getAttribute: () => 'ui/Post.tsx' };
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let asked = 0;
    const l = createAssetStateLane({
      win: win as unknown as Window,
      frames: () => [frame as unknown as Element],
      activeWindow: () => canvasWin as unknown as Window,
      canvasOrigin: () => 'http://127.0.0.1:5555',
      setTimer: (fn: () => void, ms: number) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => {},
      fetchImpl: (async () => {
        asked += 1;
        const a = answers.shift() ?? { items: [] };
        return new Response(JSON.stringify({ items: a.items }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const settle = () => new Promise((r) => setTimeout(r, 5));
    return { l, listeners, timers, asked: () => asked, settle, canvasWin };
  }

  afterEach(() => clearAssetAnswers());

  test('uploading → the Assets tab can read it, the next ask is soon; done → no bar and no more asking', async () => {
    const h = lane([
      { items: [{ rel: 'assets/a.jpg', state: 'uploading', progress: 0.38 }] },
      { items: [{ rel: 'assets/a.jpg', state: 'here' }] },
    ]);
    await h.l.refresh();
    await h.settle();
    expect(assetUploadOf('assets/a.jpg')).toEqual({ progress: 0.38 });
    expect(assetUploadOf('assets/other.jpg')).toBeNull();
    expect(h.timers.at(-1)?.ms).toBe(ASSET_UPLOAD_POLL_MS);
    h.timers.at(-1)?.fn();
    await h.settle();
    expect(assetUploadOf('assets/a.jpg')).toBeNull();
    expect(h.l.polling()).toBe(false);
    h.l.stop();
  });

  test('the index moving (a placement is one) asks again once, shortly — and only for that event', async () => {
    const h = lane([{ items: [] }, { items: [{ rel: 'assets/n.jpg', state: 'uploading' }] }]);
    await h.l.refresh();
    await h.settle();
    const before = h.timers.length;
    const onIndex = h.listeners.get('maude:index-changed') as (e: unknown) => void;
    expect(onIndex).toBeDefined();
    onIndex({ type: 'message' }); // not it
    expect(h.timers.length).toBe(before);
    onIndex({ type: 'maude:index-changed' });
    onIndex({ type: 'maude:index-changed' }); // a burst is one read
    expect(h.timers.length).toBe(before + 1);
    h.timers.at(-1)?.fn();
    await h.settle();
    expect(assetUploadOf('assets/n.jpg')).toEqual({ progress: undefined });
    h.l.stop();
  });
});

describe('the panel', () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  const roots: Root[] = [];
  const fresh = () => Date.now() + 5;
  const ir = (rel: string, mtimeMs: number) => ({
    rel,
    kind: 'image',
    size: 10,
    mtimeMs,
    usedIn: [],
    usedBy: 0,
    usedElsewhere: false,
    olderVersions: false,
    recentTake: false,
    notUsed: true,
  });

  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    globalThis.fetch = (async (url: string, init?: { method?: string; body?: unknown }) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init?.method, body });
      if (url.startsWith('/_api/index?part=assets'))
        return new Response(
          JSON.stringify({
            seq: 1,
            history: 'ready',
            assets: [ir('assets/old00001.jpg', 5), ir('assets/new00001.jpg', fresh())],
          }),
          { status: 200 }
        );
      if (url === '/_api/asset')
        return new Response(JSON.stringify({ path: `assets/up${calls.length}.jpg` }), {
          status: 200,
        });
      if (url === '/_api/edit-op')
        return new Response(
          JSON.stringify({ ok: true, writeId: 'w_0123456789abcdef', actionId: null, created: [] }),
          { status: 200 }
        );
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    calls = [];
  });

  async function mount(props: Record<string, unknown> = {}) {
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<AssetsPanel designRel=".design" {...props} />));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    return host;
  }

  test('a fresh file is first, under Just added, and only there', async () => {
    const host = await mount();
    const heads = [...host.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'));
    expect(heads).toEqual(['Just added', 'Photos']);
    expect(host.querySelector('[data-testid="assets-group-added"]')).not.toBeNull();
    const firstTiles = [...(host.querySelector('section')?.querySelectorAll('[data-asset]') ?? [])];
    expect(firstTiles.map((t) => t.getAttribute('data-asset'))).toEqual(['assets/new00001.jpg']);
    expect(host.querySelectorAll('[data-asset="assets/new00001.jpg"]').length).toBe(1);
  });

  test('From this Mac… with an artboard selected imports the photos and places them in one write', async () => {
    const proto = (
      globalThis as unknown as { HTMLInputElement: { prototype: { click: () => void } } }
    ).HTMLInputElement.prototype;
    const click = proto.click;
    proto.click = function (this: HTMLInputElement) {
      const files = [
        new File(['x'], 'IMG_1.jpg', { type: 'image/jpeg' }),
        new File(['y'], 'IMG_2.jpg', { type: 'image/jpeg' }),
      ];
      Object.defineProperty(this, 'files', { value: files });
      setTimeout(() => this.dispatchEvent(new Event('change')), 0);
    };
    try {
      const host = await mount({ placeTarget: { canvas: 'ui/Match.tsx', artboardId: 'match' } });
      const mac = host.querySelector('[data-testid="assets-from-mac"]') as HTMLButtonElement;
      await act(async () => {
        mac.click();
        await new Promise((r) => setTimeout(r, 80));
      });
      const uploads = calls.filter((c) => c.url === '/_api/asset');
      expect(uploads.length).toBe(2);
      const place = calls.filter((c) => c.url === '/_api/edit-op');
      expect(place.length).toBe(1);
      expect(place[0]?.body).toMatchObject({
        file: 'ui/Match.tsx',
        op: 'image.place',
        targets: [],
        params: { mode: 'auto', artboard: 'match' },
      });
      const sent = place[0]?.body as { params: { assets: string[] } };
      expect(sent.params.assets.length).toBe(2);
    } finally {
      proto.click = click;
    }
  });

  test('with no artboard selected it is the plain import it always was: nothing is placed', async () => {
    const proto = (
      globalThis as unknown as { HTMLInputElement: { prototype: { click: () => void } } }
    ).HTMLInputElement.prototype;
    const click = proto.click;
    proto.click = function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', {
        value: [new File(['x'], 'IMG_1.jpg', { type: 'image/jpeg' })],
      });
      setTimeout(() => this.dispatchEvent(new Event('change')), 0);
    };
    try {
      const host = await mount();
      await act(async () => {
        (host.querySelector('[data-testid="assets-from-mac"]') as HTMLButtonElement).click();
        await new Promise((r) => setTimeout(r, 80));
      });
      expect(calls.filter((c) => c.url === '/_api/asset').length).toBe(1);
      expect(calls.filter((c) => c.url === '/_api/edit-op').length).toBe(0);
    } finally {
      proto.click = click;
    }
  });
});
