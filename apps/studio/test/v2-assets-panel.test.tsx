// S8.12 — the Assets tab on the index: Photos first, then Video and Sound; hover gives the name and where it's used;
// right-click offers Place and Show details; ⌘I opens plain details; an empty tab is a drop zone with one AI chip.
// (Drag and ↵ placement: v2-assets-place.test.tsx. The keys and the agent paths: v2-assets-keys.test.ts.)
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { assetTileSelected, runAssetsAction } from '../client/v2/assets/assets-bus.js';
import { tileMenuItems } from '../client/v2/assets/tile-menu.jsx';
import { rowsFromIndex, usageWords } from '../client/v2/assets/use-assets.js';
import { bindPaletteEnv } from '../client/v2/search/search-env.js';

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; body?: unknown }> = [];
let indexAnswer: unknown = null;
let listing: unknown = { ok: true, assets: [] };

const row = (rel: string, kind: string, extra: Record<string, unknown> = {}) => ({
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
  ...extra,
});
const INDEX = {
  seq: 3,
  history: 'ready',
  assets: [
    row('assets/cc33dd44.mp4', 'video', { mtimeMs: 5, usedIn: ['ui/hype.tsx'], notUsed: false }),
    row('assets/aa11bb22.jpg', 'image', {
      mtimeMs: 2,
      usedIn: ['ui/matchday.tsx', 'ui/score.tsx', 'ui/sponsors.tsx', 'ui/week.tsx'],
      notUsed: false,
    }),
    row('assets/ee55ff66.png', 'image', { mtimeMs: 9 }),
    row('assets/gg77hh88.mp3', 'audio', { mtimeMs: 1 }),
    row('assets/zz.ttf', 'font'),
  ],
};

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.startsWith('/_api/index?part=assets'))
      return indexAnswer
        ? new Response(JSON.stringify(indexAnswer), { status: 200 })
        : new Response('{}', { status: 404 });
    if (url.startsWith('/_api/assets'))
      return new Response(JSON.stringify(listing), { status: 200 });
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
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  calls = [];
  indexAnswer = null;
  listing = { ok: true, assets: [] };
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
const tiles = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>('[data-testid="assets-tile"]'),
];
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null | undefined) =>
  act(async () => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
const rightClick = (el: Element | null | undefined) =>
  act(async () => {
    el?.dispatchEvent(
      new window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      })
    );
  });

describe('groups from the index', () => {
  test('Photos, then Video, then Sound; newest first; fonts are not tiles', async () => {
    indexAnswer = INDEX;
    const host = await mount();
    expect(calls[0]?.url).toBe('/_api/index?part=assets');
    const heads = [...host.querySelectorAll('.lp-group')].map((g) => g.textContent);
    expect(heads).toEqual(['Photos2', 'Video1', 'Sound1']);
    expect(tiles(host).map((t) => t.dataset.asset)).toEqual([
      'assets/ee55ff66.png',
      'assets/aa11bb22.jpg',
      'assets/cc33dd44.mp4',
      'assets/gg77hh88.mp3',
    ]);
    expect(rowsFromIndex(INDEX).some((r) => r.kind === 'font')).toBe(false);
  });

  test('hover and focus show the name and where it is used; the tile is named the same way', async () => {
    indexAnswer = INDEX;
    const host = await mount();
    const used = tiles(host).find((t) => t.dataset.asset === 'assets/aa11bb22.jpg');
    expect(used?.querySelector('.lp-tile-tip')?.textContent).toBe('aa11bb22.jpgUsed in 4 canvases');
    expect(used?.getAttribute('aria-label')).toBe('aa11bb22.jpg. Used in 4 canvases');
    const loose = tiles(host).find((t) => t.dataset.asset === 'assets/ee55ff66.png');
    expect(loose?.getAttribute('aria-label')).toBe('ee55ff66.png. Not used');
  });

  test('without an index the old listing fills the tab and draws no usage line', async () => {
    listing = {
      ok: true,
      assets: [{ path: 'assets/aa11bb22.jpg', name: 'aa11bb22.jpg', size: 4096, kind: 'image' }],
    };
    const host = await mount();
    // (the Generated group reads its own list once the rows are in: asset-generated, S8.21; search in pictures reads its
    // state: describe, S8.20)
    const own = new Set(['/_api/asset-generated', '/_api/describe']);
    expect(calls.map((c) => c.url).filter((u) => !own.has(u))).toEqual([
      '/_api/index?part=assets',
      '/_api/assets',
    ]);
    expect(tiles(host)[0]?.getAttribute('aria-label')).toBe('aa11bb22.jpg');
  });
});

describe('usageWords — never a false "Not used"', () => {
  const base = {
    usedIn: [] as string[],
    usedElsewhere: false,
    olderVersions: false as boolean | string,
    recentTake: false,
    notUsed: true as boolean | string,
  };
  test('the words for every state', () => {
    expect(usageWords({ ...base, usedIn: ['a.tsx'] })).toBe('Used in 1 canvas');
    expect(usageWords({ ...base, usedIn: ['a.tsx', 'b.tsx'] })).toBe('Used in 2 canvases');
    expect(usageWords({ ...base, recentTake: true })).toBe('Not placed yet');
    expect(usageWords({ ...base, olderVersions: true, notUsed: false })).toBe(
      'Only in an older version'
    );
    expect(usageWords({ ...base, usedElsewhere: true, notUsed: false })).toBe(
      'Used outside the canvases'
    );
    expect(usageWords({ ...base, olderVersions: 'checking', notUsed: 'checking' })).toBe(
      'Checking older versions…'
    );
    expect(usageWords(base)).toBe('Not used');
    expect(usageWords({ ...base, usedIn: null as unknown as string[] })).toBe('');
  });
});

describe('the tile menu', () => {
  test('a picture offers Place, Show details and Move to trash; a viewer only details; a clip no Place', () => {
    expect(tileMenuItems({ kind: 'image' }, { placeLabel: 'MVP zápasu' })).toEqual([
      { id: 'place', label: 'Place in MVP zápasu', keys: '↵' },
      { id: 'details', label: 'Show details', keys: '⌘I' },
      { id: 'trash', label: 'Move to trash' },
    ]);
    expect(tileMenuItems({ kind: 'image' }).map((i) => i.label)).toEqual([
      'Place',
      'Show details',
      'Move to trash',
    ]);
    expect(tileMenuItems({ kind: 'image' }, { readOnly: true }).map((i) => i.id)).toEqual([
      'details',
    ]);
    expect(tileMenuItems({ kind: 'video' }).map((i) => i.id)).toEqual(['details', 'trash']);
    expect(tileMenuItems({ kind: 'video' }, { readOnly: true }).map((i) => i.id)).toEqual([
      'details',
    ]);
  });

  test('right-click opens it on the tile; Place runs the same edit-op as ↵', async () => {
    indexAnswer = INDEX;
    const recs: unknown[] = [];
    const host = await mount({
      placeTarget: { canvas: '.design/ui/Post.tsx', artboardId: 'mvp' },
      placeLabel: 'MVP zápasu',
      onRecord: (p: unknown) => recs.push(p),
    });
    const tile = tiles(host).find((t) => t.dataset.asset === 'assets/aa11bb22.jpg');
    await rightClick(tile);
    const menu = q(document.body, 'assets-tile-menu');
    expect(menu?.getAttribute('role')).toBe('menu');
    expect(q(document.body, 'assets-menu-place')?.textContent).toContain('Place in MVP zápasu');
    await click(q(document.body, 'assets-menu-place'));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    const placed = calls.filter((c) => c.url === '/_api/edit-op');
    expect(placed.length).toBe(1);
    expect(placed[0]?.body).toMatchObject({
      op: 'image.place',
      params: { mode: 'loose', asset: 'assets/aa11bb22.jpg', artboard: 'mvp' },
    });
    expect(q(document.body, 'assets-tile-menu')).toBeNull();
    expect(recs.length).toBe(1);
  });

  test('a viewer’s right-click offers no Place, and nothing is written', async () => {
    indexAnswer = INDEX;
    const host = await mount({ readOnly: true, placeTarget: { canvas: 'x', artboardId: 'a' } });
    await rightClick(tiles(host)[1]);
    expect(q(document.body, 'assets-menu-place')).toBeNull();
    expect(q(document.body, 'assets-menu-details')).not.toBeNull();
    expect(calls.some((c) => c.url === '/_api/edit-op')).toBe(false);
  });
});

describe('details (⌘I) and the registry fact', () => {
  test('⌘I opens the details of the picked tile in place of the list: size, the canvases; back returns', async () => {
    indexAnswer = INDEX;
    const host = await mount();
    await click(tiles(host).find((t) => t.dataset.asset === 'assets/aa11bb22.jpg'));
    await act(async () => {
      runAssetsAction('assets.details');
    });
    const card = q(host, 'assets-details');
    expect(card?.textContent).toContain('aa11bb22.jpg');
    expect(card?.textContent).toContain('4 KB');
    expect(card?.textContent).toContain('Used in 4 canvases');
    expect(card?.textContent).toContain('matchday');
    await click(q(host, 'assets-details-close'));
    expect(q(host, 'assets-details')).toBeNull();
  });

  test('assetTileSelected: a tile is picked AND focus is inside the tab', async () => {
    indexAnswer = INDEX;
    const host = await mount();
    expect(assetTileSelected()).toBe(false);
    const tile = tiles(host)[0] as HTMLElement;
    await click(tile);
    tile.focus();
    expect(assetTileSelected()).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    expect(assetTileSelected()).toBe(false);
  });

  test('nothing picked: ↵ and ⌘I do nothing', async () => {
    indexAnswer = INDEX;
    await mount({ placeTarget: { canvas: 'x', artboardId: 'a' } });
    await act(async () => {
      runAssetsAction('assets.place');
      runAssetsAction('assets.details');
    });
    expect(calls.some((c) => c.url === '/_api/edit-op')).toBe(false);
    expect(document.querySelector('[data-testid="assets-details"]')).toBeNull();
  });
});

describe('the empty tab', () => {
  test('says the contract’s words and offers no AI chip when the AI is not here', async () => {
    indexAnswer = { seq: 1, history: 'ready', assets: [] };
    const host = await mount();
    const empty = q(host, 'assets-empty');
    expect(empty?.textContent).toContain('No images or footage yet.');
    expect(empty?.textContent).toContain(
      'Drop photos, logos, video or music here — or anywhere on the canvas.'
    );
    expect(empty?.querySelector('[data-testid="empty-ask"]')).toBeNull();
  });

  test('where the AI is on this Mac it offers the one chip, which fills the chat and sends nothing', async () => {
    indexAnswer = { seq: 1, history: 'ready', assets: [] };
    const asked: string[] = [];
    const unbind = bindPaletteEnv({ canAskAI: () => true, askAI: (t: string) => asked.push(t) });
    try {
      const host = await mount();
      const chip = host.querySelector('[data-testid="empty-ask"]');
      expect(chip?.textContent).toContain('Generate an image');
      await click(chip);
      expect(asked).toEqual(['Generate an image']);
      // a viewer cannot generate: no chip
      const viewer = await mount({ readOnly: true });
      expect(viewer.querySelectorAll('[data-testid="empty-ask"]').length).toBe(0);
    } finally {
      unbind();
    }
  });
});
