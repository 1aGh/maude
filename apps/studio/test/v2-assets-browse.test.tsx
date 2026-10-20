// S8.13 — the wide Browse view (big pictures, sort, size, ⇧/⌘ multi-select, ↵ fills the frames in reading order), Not used, and
// Move to the trash (sidecars with it, Undo, a picture that is used or kept by an older version stays).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { runAssetsAction } from '../client/v2/assets/assets-bus.js';
import { browseRows, dayWords, drawOrder, runsOf } from '../client/v2/assets/browse-model.js';
import { inOrder, NOTHING_PICKED, pick, pickAll } from '../client/v2/assets/multi-select.js';
import { notCountedWords, tidyModel } from '../client/v2/assets/tidy.jsx';
import { tileMenuItems } from '../client/v2/assets/tile-menu.jsx';
import { bindPaletteEnv } from '../client/v2/search/search-env.js';

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method?: string; body?: any }> = [];
let indexAnswer: any = null;
let trashAnswer: any = { ok: true, results: [] };
let trashStatus = 200;

const row = (rel: string, kind: string, extra: Record<string, unknown> = {}) => ({
  rel,
  kind,
  size: 1024 * 1024,
  mtimeMs: 1,
  usedIn: [],
  usedBy: 0,
  usedElsewhere: false,
  olderVersions: false,
  recentTake: false,
  notUsed: true,
  ...extra,
});
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 27, 12);
const PHOTOS = [
  row('assets/aa000001.jpg', 'image', { mtimeMs: T0 + 3000, usedIn: ['ui/m.tsx'], notUsed: false }),
  row('assets/aa000002.jpg', 'image', { mtimeMs: T0 + 2000 }),
  row('assets/aa000003.jpg', 'image', { mtimeMs: T0 + 1000 }),
  row('assets/aa000004.jpg', 'image', { mtimeMs: T0 - 3 * DAY, size: 4 * 1024 * 1024 }),
  row('assets/aa000005.jpg', 'image', {
    mtimeMs: T0 - 3 * DAY - 1,
    olderVersions: true,
    notUsed: false,
  }),
  row('assets/aa000006.jpg', 'image', { mtimeMs: T0 - 4 * DAY, recentTake: true, notUsed: false }),
];
const INDEX = {
  seq: 1,
  history: 'ready',
  assets: [...PHOTOS, row('assets/vv000001.mp4', 'video', { mtimeMs: 5 })],
};

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.startsWith('/_api/index?part=assets'))
      return new Response(JSON.stringify(indexAnswer ?? INDEX), { status: 200 });
    if (url === '/_api/assets/trash')
      return new Response(JSON.stringify(trashAnswer), { status: trashStatus });
    if (url === '/_api/edit-op')
      return new Response(
        JSON.stringify({ ok: true, writeId: 'w_0123456789abcdef', actionId: null, created: [] }),
        { status: 200 }
      );
    if (url === '/_api/sync/trash' && !init?.method)
      return new Response(
        JSON.stringify({
          entries: [
            { trashRel: '_trash/T__asset-a/aa000002.jpg', sourceRel: 'assets/aa000002.jpg' },
            {
              trashRel: '_trash/T__asset-a/aa000002.photo.json',
              sourceRel: 'assets/aa000002.photo.json',
            },
          ],
        }),
        { status: 200 }
      );
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  calls = [];
  indexAnswer = null;
  trashAnswer = { ok: true, results: [] };
  trashStatus = 200;
});

async function mount(props: Record<string, unknown> = {}) {
  bindPaletteEnv({ canAskAI: () => false } as never);
  const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<AssetsPanel designRel=".design" {...props} />));
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (host: HTMLElement, id: string) => [
  ...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const click = (el: Element | null | undefined, init: Record<string, unknown> = {}) =>
  act(async () => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...init }));
  });
// while the wide view is open the narrow list behind it is hidden; tiles are read where a person would see them
const scope = (host: HTMLElement) => q(host, 'assets-browse') ?? host;
const tilesOf = (host: HTMLElement) => all(scope(host), 'assets-tile');
const tileFor = (host: HTMLElement, rel: string) =>
  tilesOf(host).find((t) => t.dataset.asset === rel);

describe('multi-select', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  test('click picks one; ⌘ toggles; ⇧ takes the range from the anchor in draw order', () => {
    let s = pick(ids, NOTHING_PICKED, 'b');
    expect([...s.selected]).toEqual(['b']);
    s = pick(ids, s, 'd', { meta: true });
    expect(inOrder(ids, s.selected)).toEqual(['b', 'd']);
    s = pick(ids, s, 'b', { meta: true });
    expect(inOrder(ids, s.selected)).toEqual(['d']);
    s = pick(ids, s, 'a');
    s = pick(ids, s, 'c', { shift: true });
    expect(inOrder(ids, s.selected)).toEqual(['a', 'b', 'c']);
    s = pick(ids, s, 'e', { shift: true, meta: true });
    expect(inOrder(ids, s.selected)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(inOrder(ids, pickAll(ids).selected)).toEqual(ids);
  });
  test('the picked ones read back in draw order, whatever order the clicks came in', () => {
    let s = pick(ids, NOTHING_PICKED, 'd');
    s = pick(ids, s, 'a', { meta: true });
    s = pick(ids, s, 'c', { meta: true });
    expect(inOrder(ids, s.selected)).toEqual(['a', 'c', 'd']);
  });
});

describe('browse model', () => {
  const rows = [
    { path: 'assets/b.jpg', name: 'b.jpg', kind: 'image', size: 5, mtimeMs: T0 },
    { path: 'assets/a.jpg', name: 'a.jpg', kind: 'image', size: 9, mtimeMs: T0 - 2 * DAY },
    { path: 'assets/c.jpg', name: 'c.jpg', kind: 'image', size: 1, mtimeMs: T0 + 5 },
    { path: 'assets/v.mp4', name: 'v.mp4', kind: 'video', size: 1, mtimeMs: 1 },
  ];
  test('one kind, sorted as asked', () => {
    expect(browseRows(rows, 'image', '', 'name').map((r) => r.name)).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
    ]);
    expect(browseRows(rows, 'image', '', 'size').map((r) => r.name)).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
    ]);
    expect(browseRows(rows, 'image', '', 'newest').map((r) => r.name)).toEqual([
      'c.jpg',
      'b.jpg',
      'a.jpg',
    ]);
    expect(browseRows(rows, 'image', '', 'oldest').map((r) => r.name)).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
    ]);
    expect(browseRows(rows, 'image', 'b', 'name').map((r) => r.name)).toEqual(['b.jpg']);
  });
  test('newest first is grouped by the day it arrived; by name is one run with no heading', () => {
    const newest = runsOf(browseRows(rows, 'image', '', 'newest'), 'newest', T0 + DAY);
    expect(newest.map((r) => [r.title, r.rows.length])).toEqual([
      [dayWords(T0, T0 + DAY), 2],
      [dayWords(T0 - 2 * DAY, T0 + DAY), 1],
    ]);
    const byName = runsOf(browseRows(rows, 'image', '', 'name'), 'name');
    expect(byName.map((r) => r.title)).toEqual([null]);
    expect(drawOrder(newest)).toEqual(['assets/c.jpg', 'assets/b.jpg', 'assets/a.jpg']);
  });
});

describe('Not used (the model)', () => {
  const rows = PHOTOS.map((r) => ({
    path: r.rel,
    name: r.rel.slice(7),
    kind: r.kind,
    size: r.size,
    mtimeMs: r.mtimeMs,
    usedIn: r.usedIn,
    usedElsewhere: r.usedElsewhere,
    olderVersions: r.olderVersions,
    recentTake: r.recentTake,
    notUsed: r.notUsed,
  }));
  test('lists only what nothing needs, and says what it left out', () => {
    const m = tidyModel(rows, 'ready');
    expect(m.list.map((r) => r.name)).toEqual(['aa000002.jpg', 'aa000003.jpg', 'aa000004.jpg']);
    expect(m.keptByVersions).toBe(1);
    expect(m.recentTakes).toBe(1);
    expect(notCountedWords(m)).toBe(
      'Not counted: 1 kept only by older versions, 1 AI take from today.'
    );
  });
  test('while older versions are being read it says so and counts nothing as free', () => {
    const m = tidyModel(
      rows.map((r) => ({ ...r, notUsed: 'checking' })),
      'checking'
    );
    expect(m.count).toBe(0);
    expect(m.checking).toBe(true);
    expect(notCountedWords(m)).toBe('Checking older versions…');
  });
});

describe('tile menu', () => {
  test('an editor can move to the trash (with several picked it says how many); a viewer cannot', () => {
    const ids = (o: object) => tileMenuItems({ kind: 'image' }, o).map((i: { id: string }) => i.id);
    expect(ids({})).toEqual(['place', 'details', 'trash']);
    expect(ids({ readOnly: true })).toEqual(['details']);
    expect(tileMenuItems({ kind: 'image' }, { count: 6 }).at(-1)?.label).toBe(
      'Move 6 to the trash'
    );
  });
});

describe('Browse view', () => {
  test('a group heading widens into big pictures; ⇧ picks a range; ↵ fills the frames in reading order', async () => {
    const host = await mount({
      placeTarget: { canvas: 'ui/m.tsx', artboardId: 'ab-fotky' },
      placeLabel: 'Fotky ze zápasu',
    });
    expect(q(host, 'assets-browse')).toBeNull();
    await click(q(host, 'assets-group-image'));
    const view = q(host, 'assets-browse');
    expect(view?.dataset.kind).toBe('image');
    // newest first, 6 photos, each named under it
    const rels = tilesOf(host).map((t) => t.dataset.asset);
    expect(rels).toEqual(
      PHOTOS.slice()
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .map((r) => r.rel)
    );
    // pick the 3rd, then ⇧-click the 1st: three pictures, picked in draw order whatever the click order
    await click(tileFor(host, 'assets/aa000003.jpg'));
    await click(tileFor(host, 'assets/aa000001.jpg'), { shiftKey: true });
    expect(q(host, 'assets-browse-count')?.textContent).toContain('3 selected');
    expect(q(host, 'assets-browse-place')?.textContent).toContain('Place 3 in Fotky ze zápasu');
    calls = [];
    await click(q(host, 'assets-browse-place'));
    const op = calls.find((c) => c.url === '/_api/edit-op');
    expect(op?.body.op).toBe('image.place');
    expect(op?.body.params.mode).toBe('fill-in-order');
    expect(op?.body.params.assets).toEqual([
      'assets/aa000001.jpg',
      'assets/aa000002.jpg',
      'assets/aa000003.jpg',
    ]);
    expect(op?.body.params.artboard).toBe('ab-fotky');
  });

  test('↵ from the key (assets.place) does the same as the button', async () => {
    const host = await mount({ placeTarget: { canvas: 'ui/m.tsx', artboardId: 'ab' } });
    await click(q(host, 'assets-group-image'));
    // picked 3 first, then 2: the click order is the reverse of the order the frames fill in
    await click(tileFor(host, 'assets/aa000003.jpg'));
    await click(tileFor(host, 'assets/aa000002.jpg'), { metaKey: true });
    calls = [];
    await act(async () => {
      tileFor(host, 'assets/aa000003.jpg')?.focus();
      runAssetsAction('assets.place');
    });
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    const op = calls.find((c) => c.url === '/_api/edit-op');
    expect(op?.body.params.assets).toEqual(['assets/aa000002.jpg', 'assets/aa000003.jpg']);
  });

  test('without a selected artboard the button waits and says why; a viewer gets no Place at all', async () => {
    const host = await mount();
    await click(q(host, 'assets-group-image'));
    await click(tileFor(host, 'assets/aa000002.jpg'));
    expect(q(host, 'assets-browse-place')?.hasAttribute('disabled')).toBe(true);
    expect(q(host, 'assets-browse-place')?.getAttribute('title')).toBe('Select an artboard first.');
    const viewer = await mount({ readOnly: true });
    await click(q(viewer, 'assets-group-image'));
    await click(tilesOf(viewer).at(-1));
    expect(all(viewer, 'assets-browse-place')).toHaveLength(0);
  });

  test('sort and size are choices; esc clears the pick, then goes back', async () => {
    const host = await mount();
    await click(q(host, 'assets-group-image'));
    const sort = q(host, 'assets-browse-sort') as HTMLSelectElement;
    await act(async () => {
      sort.value = 'name';
      sort.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(tilesOf(host).map((t) => t.dataset.asset)).toEqual(PHOTOS.map((r) => r.rel));
    await click(q(host, 'assets-browse-size-small'));
    expect(q(host, 'assets-browse')?.className).toContain('lp-browse--small');
    await click(tileFor(host, 'assets/aa000002.jpg'));
    const view = q(host, 'assets-browse') as HTMLElement;
    await act(async () => {
      view.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(q(host, 'assets-browse-bar')).toBeNull(); // the pick is gone, the view stays
    expect(q(host, 'assets-browse')).not.toBeNull();
    await act(async () => {
      view.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(q(host, 'assets-browse')).toBeNull();
  });
});

describe('Not used and Move to the trash', () => {
  test('the chip lists only what nothing needs, with the note, and the foot moves it all after a yes', async () => {
    const host = await mount();
    await click(q(host, 'assets-chip-notused'));
    const rels = all(host, 'assets-tile').map((t) => t.dataset.asset);
    expect(rels.sort()).toEqual(
      [
        'assets/aa000002.jpg',
        'assets/aa000003.jpg',
        'assets/aa000004.jpg',
        'assets/vv000001.mp4',
      ].sort()
    );
    expect(q(host, 'assets-notcounted')?.textContent).toContain(
      '1 kept only by older versions, 1 AI take from today'
    );
    expect(q(host, 'assets-tidy-foot')?.textContent).toContain('4 assets');
    expect(q(host, 'assets-tidy-trash')?.textContent).toBe('Move 4 to the trash…');
    calls = [];
    await click(q(host, 'assets-tidy-trash'));
    expect(calls.some((c) => c.url === '/_api/assets/trash')).toBe(false); // it asks first
    const dialog =
      q(host, 'assets-trash-dialog') ??
      document.querySelector('[data-testid="assets-trash-dialog"]');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Move 4 assets to the trash?');
    trashAnswer = {
      ok: true,
      results: rels.map((rel) => ({
        ok: true,
        rel,
        trashed: [rel],
        trashDir: `_trash/T__asset-${rel.slice(7)}`,
      })),
    };
    await click(document.querySelector('[data-testid="assets-trash-confirm"]'));
    const req = calls.find((c) => c.url === '/_api/assets/trash');
    expect(req?.method).toBe('POST');
    expect(req?.body.assets.sort()).toEqual(rels.sort());
    expect(q(host, 'assets-trashed')?.textContent).toContain('4 assets moved to the trash.');
  });

  test('a viewer sees the numbers and no button', async () => {
    const host = await mount({ readOnly: true });
    await click(q(host, 'assets-chip-notused'));
    expect(q(host, 'assets-tidy-foot')).not.toBeNull();
    expect(q(host, 'assets-tidy-trash')).toBeNull();
  });

  test('while older versions are being read the button waits', async () => {
    indexAnswer = {
      ...INDEX,
      history: 'checking',
      assets: INDEX.assets.map((a) => ({ ...a, notUsed: 'checking' })),
    };
    const host = await mount();
    await click(q(host, 'assets-chip-notused'));
    expect(q(host, 'assets-notcounted')?.textContent).toBe('Checking older versions…');
    expect(q(host, 'assets-tidy-trash')).toBeNull(); // nothing is listed, so nothing to move
  });

  test('a tile menu Move to trash says what happened, with Undo that restores the bundle', async () => {
    const host = await mount();
    trashAnswer = {
      ok: true,
      results: [
        {
          ok: true,
          rel: 'assets/aa000002.jpg',
          trashed: ['assets/aa000002.jpg', 'assets/aa000002.photo.json'],
          trashDir: '_trash/T__asset-a',
        },
      ],
    };
    const tile = tileFor(host, 'assets/aa000002.jpg') as HTMLElement;
    await act(async () => {
      tile.dispatchEvent(
        new window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        })
      );
    });
    calls = [];
    await click(document.querySelector('[data-testid="assets-menu-trash"]'));
    expect(calls.find((c) => c.url === '/_api/assets/trash')?.body).toEqual({
      assets: ['assets/aa000002.jpg'],
    });
    expect(q(host, 'assets-trashed')?.textContent).toContain('“aa000002.jpg” moved to the trash.');
    calls = [];
    await click(q(host, 'assets-trashed-undo'));
    const restores = calls.filter((c) => c.url === '/_api/sync/trash' && c.method === 'POST');
    expect(restores.map((c) => c.body.trashRel).sort()).toEqual([
      '_trash/T__asset-a/aa000002.jpg',
      '_trash/T__asset-a/aa000002.photo.json',
    ]);
  });

  test('a picture the studio will not move is said, not hidden: used, or kept by an older version', async () => {
    const host = await mount();
    trashAnswer = {
      ok: true,
      results: [{ ok: false, rel: 'assets/aa000001.jpg', reason: 'used' }],
    };
    const tile = tileFor(host, 'assets/aa000001.jpg') as HTMLElement;
    await act(async () => {
      tile.dispatchEvent(
        new window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        })
      );
    });
    await click(document.querySelector('[data-testid="assets-menu-trash"]'));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      '“aa000001.jpg” is used on a canvas. Take it off the artboards first.'
    );
    trashAnswer = {
      ok: true,
      results: [{ ok: false, rel: 'assets/aa000005.jpg', reason: 'kept-by-versions' }],
    };
    await act(async () => {
      (tileFor(host, 'assets/aa000005.jpg') as HTMLElement).dispatchEvent(
        new window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        })
      );
    });
    await click(document.querySelector('[data-testid="assets-menu-trash"]'));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      '“aa000005.jpg” is still in an older version, so it stays.'
    );
  });

  test('the studio says forbidden to a role that cannot: the words ask to edit', async () => {
    const host = await mount();
    trashStatus = 403;
    trashAnswer = { ok: false, reason: 'forbidden' };
    await act(async () => {
      (tileFor(host, 'assets/aa000002.jpg') as HTMLElement).dispatchEvent(
        new window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        })
      );
    });
    await click(document.querySelector('[data-testid="assets-menu-trash"]'));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'Not moved. You can look here; ask to edit.'
    );
  });
});
