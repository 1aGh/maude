// 2.0.2 — the Assets tab shows a design system's own library again: a Library switch (this project · each design
// system), folders and search, a page at a time, and the same tiles, drag and ↵ as the project's — placing the
// picture's LITERAL reference (`/<designRel>/system/<ds>/assets/…`).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { runAssetsAction } from '../client/v2/assets/assets-bus.js';
import {
  crumbsOf,
  dsLibraryUrl,
  dsOfSource,
  mergeDsPage,
  PROJECT_SOURCE,
  rowsFromDsPage,
  sourcesOf,
} from '../client/v2/assets/ds-library.js';

const LIB = 'system/alligators/assets';
const file = (rel: string, extra: Record<string, unknown> = {}) => ({
  path: rel,
  name: rel.split('/').pop(),
  ext: 'jpg',
  kind: 'image',
  size: 2048,
  mtimeMs: 1,
  placeable: true,
  ...extra,
});
const page = (over: Record<string, unknown> = {}) => ({
  ok: true,
  ds: 'alligators',
  root: LIB,
  dir: '',
  dirs: [],
  files: [],
  total: 0,
  next: null,
  ...over,
});

describe('the pure parts', () => {
  test('sources: this project first, then each design system once', () => {
    const s = sourcesOf([
      { name: 'alligators', path: 'system/alligators' },
      { name: 'alligators', path: 'system/alligators' },
      { name: 'club', path: 'system/club' },
      null,
    ]);
    expect(s.map((x) => x.id)).toEqual([PROJECT_SOURCE, 'ds:alligators', 'ds:club']);
    expect(sourcesOf(undefined).map((x) => x.id)).toEqual([PROJECT_SOURCE]);
    expect(dsOfSource('ds:club')).toBe('club');
    expect(dsOfSource(PROJECT_SOURCE)).toBeNull();
  });
  test('one page per request: folder, search, cursor, limit', () => {
    expect(dsLibraryUrl({ ds: 'alligators' })).toBe('/_api/ds/assets?ds=alligators&limit=200');
    expect(
      dsLibraryUrl({ ds: 'a b', dir: 'photos-cut', q: ' team ', cursor: `${LIB}/x.jpg` })
    ).toBe(
      `/_api/ds/assets?ds=a+b&dir=photos-cut&q=team&cursor=${encodeURIComponent(`${LIB}/x.jpg`)}&limit=200`
    );
  });
  test('a row’s path is the literal reference; a name that cannot be one still shows, not placeable', () => {
    const rows = rowsFromDsPage(
      page({ files: [file(`${LIB}/photos-cut/a.jpg`), file(`${LIB}/b"c.jpg`)] }),
      '.design'
    );
    expect(rows[0]).toMatchObject({
      path: `/.design/${LIB}/photos-cut/a.jpg`,
      rel: `${LIB}/photos-cut/a.jpg`,
      placeable: true,
      usedIn: null,
    });
    expect(rows[1]).toMatchObject({ path: `/.design/${LIB}/b"c.jpg`, placeable: false });
  });
  test('a next page appends (no repeats); a first page replaces', () => {
    const one = mergeDsPage(
      { dirs: [], rows: [], total: 0, next: null },
      page({ files: [file(`${LIB}/a.jpg`), file(`${LIB}/b.jpg`)], total: 3, next: `${LIB}/b.jpg` }),
      '.design'
    );
    const two = mergeDsPage(
      one,
      page({ files: [file(`${LIB}/b.jpg`), file(`${LIB}/c.jpg`)], total: 3 }),
      '.design',
      {
        append: true,
      }
    );
    expect(two.rows.map((r: { name: string }) => r.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(two.next).toBeNull();
    const again = mergeDsPage(two, page({ files: [file(`${LIB}/z.jpg`)], total: 1 }), '.design');
    expect(again.rows.map((r: { name: string }) => r.name)).toEqual(['z.jpg']);
  });
  test('the breadcrumb', () => {
    expect(crumbsOf('alligators', 'photos-cut/2024')).toEqual([
      { label: 'alligators', dir: '' },
      { label: 'photos-cut', dir: 'photos-cut' },
      { label: '2024', dir: 'photos-cut/2024' },
    ]);
  });
});

// ── the tab ──────────────────────────────────────────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; body?: any }> = [];
let answer: (url: URL) => unknown = () => page();

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.startsWith('/_api/ds/assets'))
      return new Response(JSON.stringify(answer(new URL(url, 'http://x'))), { status: 200 });
    if (url.startsWith('/_api/index')) return new Response('{}', { status: 404 });
    if (url.startsWith('/_api/assets'))
      return new Response(JSON.stringify({ ok: true, assets: [] }), { status: 200 });
    if (url === '/_api/edit-op')
      return new Response(
        JSON.stringify({ ok: true, writeId: 'w_0123456789abcdef', actionId: 'a1', created: [] }),
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
  answer = () => page();
});
const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function mount(props: Record<string, unknown> = {}) {
  const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<AssetsPanel designRel=".design" {...props} />));
  await wait();
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (host: HTMLElement, id: string) => [
  ...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const click = (el: Element | null | undefined) =>
  act(async () => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
async function choose(host: HTMLElement, value: string) {
  const sel = q(host, 'assets-source') as HTMLSelectElement;
  await act(async () => {
    sel.value = value;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await wait();
}
const dsCalls = () =>
  calls.filter((c) => c.url.startsWith('/_api/ds/assets')).map((c) => new URL(c.url, 'http://x'));
const SYSTEMS = [{ name: 'alligators', path: 'system/alligators' }];

describe('the Library switch', () => {
  test('no design system: no switch, the tab is as it was', async () => {
    const host = await mount();
    expect(q(host, 'assets-source')).toBeNull();
    expect(q(host, 'assets-search')).not.toBeNull();
    expect(dsCalls()).toEqual([]);
  });

  test('switching to a design system lists its folders and pictures; back to this project', async () => {
    answer = () =>
      page({
        dirs: [{ path: `${LIB}/photos-cut`, name: 'photos-cut', count: 3007 }],
        files: [file(`${LIB}/hero.jpg`)],
        total: 1,
      });
    const host = await mount({ designSystems: SYSTEMS });
    const options = [...(q(host, 'assets-source') as HTMLSelectElement).options].map(
      (o) => o.textContent
    );
    expect(options).toEqual(['This project', 'alligators · design system']);
    await choose(host, 'ds:alligators');
    expect(q(host, 'assets-ds')?.dataset.ds).toBe('alligators');
    expect(dsCalls()[0]?.searchParams.get('ds')).toBe('alligators');
    expect(all(host, 'assets-ds-folder').map((f) => f.textContent)).toEqual(['photos-cut3007']);
    const tile = all(host, 'assets-tile')[0];
    expect(tile?.dataset.asset).toBe(`/.design/${LIB}/hero.jpg`);
    expect(tile?.querySelector('img')?.getAttribute('src')).toBe(`/.design/${LIB}/hero.jpg`);
    expect(tile?.getAttribute('draggable')).toBe('true');
    await choose(host, PROJECT_SOURCE);
    expect(q(host, 'assets-ds')).toBeNull();
    expect(q(host, 'assets-search')).not.toBeNull();
  });

  test('a folder opens; the breadcrumb goes back up', async () => {
    answer = (u) =>
      u.searchParams.get('dir') === 'photos-cut'
        ? page({ dir: 'photos-cut', files: [file(`${LIB}/photos-cut/P1.jpg`)], total: 1 })
        : page({ dirs: [{ path: `${LIB}/photos-cut`, name: 'photos-cut', count: 1 }] });
    const host = await mount({ designSystems: SYSTEMS });
    await choose(host, 'ds:alligators');
    await click(q(host, 'assets-ds-folder'));
    await wait();
    expect(dsCalls().at(-1)?.searchParams.get('dir')).toBe('photos-cut');
    expect(all(host, 'assets-tile').map((t) => t.dataset.asset)).toEqual([
      `/.design/${LIB}/photos-cut/P1.jpg`,
    ]);
    expect(all(host, 'assets-ds-crumb').map((c) => c.textContent)).toEqual([
      'alligators',
      'photos-cut',
    ]);
    await click(all(host, 'assets-ds-crumb')[0]);
    await wait();
    expect(dsCalls().at(-1)?.searchParams.get('dir')).toBeNull();
    expect(all(host, 'assets-ds-folder')).toHaveLength(1);
  });

  test('pages: Show more asks for the next page by cursor and appends it', async () => {
    const first = Array.from({ length: 3 }, (_, i) => file(`${LIB}/p/${i}.jpg`));
    answer = (u) =>
      u.searchParams.get('cursor')
        ? page({ files: [file(`${LIB}/p/3.jpg`)], total: 4, next: null })
        : page({ files: first, total: 4, next: `${LIB}/p/2.jpg` });
    const host = await mount({ designSystems: SYSTEMS });
    await choose(host, 'ds:alligators');
    expect(all(host, 'assets-tile')).toHaveLength(3);
    expect(q(host, 'assets-ds-more')?.textContent).toBe('Show more · 1 file left');
    await click(q(host, 'assets-ds-more'));
    await wait();
    expect(dsCalls().at(-1)?.searchParams.get('cursor')).toBe(`${LIB}/p/2.jpg`);
    expect(all(host, 'assets-tile')).toHaveLength(4);
    expect(q(host, 'assets-ds-more')).toBeNull();
  });

  test('search asks the studio below the folder; no hits says so', async () => {
    answer = (u) =>
      u.searchParams.get('q')
        ? page({ files: [], total: 0 })
        : page({ files: [file(`${LIB}/a.jpg`)], total: 1 });
    const host = await mount({ designSystems: SYSTEMS });
    await choose(host, 'ds:alligators');
    const input = q(host, 'assets-ds-search') as HTMLInputElement;
    // React's own onChange, as other tab tests type (happy-dom's input event does not reach it)
    const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
    const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[
      propsKey
    ];
    await act(async () => {
      input.value = 'zzz';
      props?.onChange({ target: input, currentTarget: input });
    });
    await wait(260);
    expect(dsCalls().at(-1)?.searchParams.get('q')).toBe('zzz');
    expect(q(host, 'assets-ds-nohits')?.textContent).toContain('Nothing called “zzz”.');
  });

  test('↵ places the picked picture by its literal reference — one image.place', async () => {
    answer = () => page({ files: [file(`${LIB}/photos-cut/IMG_2231.jpg`)], total: 1 });
    const toasts: string[] = [];
    const host = await mount({
      designSystems: SYSTEMS,
      placeTarget: { canvas: 'ui/post.tsx', artboardId: 'post' },
      placeLabel: 'Post 1:1',
      toast: (m: string) => toasts.push(m),
    });
    await choose(host, 'ds:alligators');
    await click(all(host, 'assets-tile')[0]);
    await act(async () => {
      runAssetsAction('assets.place');
    });
    await wait();
    const edit = calls.filter((c) => c.url === '/_api/edit-op');
    expect(edit).toHaveLength(1);
    expect(edit[0]?.body).toMatchObject({
      file: 'ui/post.tsx',
      op: 'image.place',
      params: { asset: `/.design/${LIB}/photos-cut/IMG_2231.jpg`, mode: 'loose', artboard: 'post' },
    });
    expect(toasts).toEqual(['Placed the photo in Post 1:1.']);
  });

  test('a file whose name cannot be a reference is listed but neither drags nor places', async () => {
    answer = () => page({ files: [file(`${LIB}/a"b.jpg`, { placeable: false })], total: 1 });
    const host = await mount({
      designSystems: SYSTEMS,
      placeTarget: { canvas: 'ui/post.tsx', artboardId: 'post' },
    });
    await choose(host, 'ds:alligators');
    const tile = all(host, 'assets-tile')[0];
    expect(tile?.getAttribute('draggable')).toBeNull();
    await click(tile);
    await act(async () => {
      runAssetsAction('assets.place');
    });
    await wait();
    expect(calls.filter((c) => c.url === '/_api/edit-op')).toEqual([]);
    expect(q(host, 'assets-ds-note')?.textContent).toContain('can’t be used on a canvas');
  });
});
