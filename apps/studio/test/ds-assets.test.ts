// 2.0.2 — the Assets tab browses a design system's own asset library again (`GET /_api/ds/assets`, ds-assets.ts).
// v1 had the gallery; v2 listed only `<designRoot>/assets/`, so ~3000 pictures under `system/<ds>/assets/` were out of
// reach. Listing, paging, search, containment, a canvas-only session's closure, and the 3000-file budget.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Visibility } from '../access/filters.ts';
import { DS_ASSETS_LIMIT_MAX, dsAssetsRootOf, listDsAssets, normDsDir } from '../ds-assets.ts';
import { createDsAssetsRoutes } from '../routes/ds-assets.ts';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const project = () => {
  const r = mkdtempSync(path.join(tmpdir(), 'ds-assets-'));
  roots.push(r);
  return r;
};
const put = (root: string, rel: string, body = 'x') => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};
const LIB = 'system/alligators/assets';

const full: Visibility = {
  full: true,
  access: {} as Visibility['access'],
  seesCanvas: () => true,
  sees: () => true,
  closure: () => null,
};
const canvasOnly = (read: string[]): Visibility => {
  const set = new Set(read);
  return {
    full: false,
    access: {} as Visibility['access'],
    seesCanvas: () => false,
    sees: (rel) => set.has(rel),
    closure: () => ({ read: set }) as unknown as ReturnType<Visibility['closure']>,
  };
};

function route(root: string, vis: Visibility = full, journal: readonly string[] | null = null) {
  const [spec] = createDsAssetsRoutes({
    designRoot: root,
    systems: () => [
      { name: 'alligators', path: 'system/alligators' },
      { name: 'odd', path: 'brand/odd' },
    ],
    visibility: () => vis,
    journalMedia: async () => journal,
  });
  return async (query: string) => {
    const res = await (spec as NonNullable<typeof spec>).handle(
      new Request(`http://127.0.0.1/_api/ds/assets?${query}`),
      {}
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
}

describe('GET /_api/ds/assets', () => {
  test('is one main-origin read, never canvas-safe', () => {
    const [spec] = createDsAssetsRoutes({
      designRoot: '/x',
      systems: () => [],
      visibility: () => full,
    });
    expect(spec?.method).toBe('GET');
    expect(spec?.path).toBe('/_api/ds/assets');
    expect(spec?.origin).toBe('main');
  });

  test('the library top: its folders with counts, its own media files, nothing else', async () => {
    const root = project();
    put(root, `${LIB}/photos-cut/b.jpg`);
    put(root, `${LIB}/photos-cut/a.png`);
    put(root, `${LIB}/photos-cut/notes.txt`);
    put(root, `${LIB}/logos/mark.svg`);
    put(root, `${LIB}/hero.webp`, 'xxxx');
    put(root, `${LIB}/readme.md`);
    put(root, `${LIB}/clip.mp4`);
    put(root, `${LIB}/song.mp3`);
    put(root, `${LIB}/fonts/display.woff2`); // no picture, clip or sound in it: not a folder to open
    put(root, `${LIB}/archive/2019/old.jpg`); // only a folder inside: still one to open
    const r = await route(root)('ds=alligators');
    expect(r.status).toBe(200);
    expect(r.body.ds).toBe('alligators');
    expect(r.body.root).toBe(LIB);
    expect(r.body.dir).toBe('');
    expect(r.body.dirs).toEqual([
      { path: `${LIB}/archive`, name: 'archive', count: 0 },
      { path: `${LIB}/logos`, name: 'logos', count: 1 },
      { path: `${LIB}/photos-cut`, name: 'photos-cut', count: 2 },
    ]);
    expect(r.body.files.map((f: any) => [f.name, f.kind, f.placeable])).toEqual([
      ['clip.mp4', 'video', true],
      ['hero.webp', 'image', true],
      ['song.mp3', 'audio', false],
    ]);
    const hero = r.body.files.find((f: any) => f.name === 'hero.webp');
    expect(hero).toMatchObject({ path: `${LIB}/hero.webp`, ext: 'webp', size: 4 });
    expect(hero.mtimeMs).toBeGreaterThan(0);
    expect(r.body.total).toBe(3);
    expect(r.body.next).toBeNull();
  });

  test('one folder, by name (numbers in order)', async () => {
    const root = project();
    for (const n of ['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg']) put(root, `${LIB}/photos-cut/${n}`);
    const r = await route(root)('ds=alligators&dir=photos-cut');
    expect(r.body.dir).toBe('photos-cut');
    expect(r.body.dirs).toEqual([]);
    expect(r.body.files.map((f: any) => f.name)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  });

  test('pages by cursor; the limit is capped; a file added meanwhile neither repeats nor shifts a page', async () => {
    const root = project();
    for (let i = 0; i < 25; i++) put(root, `${LIB}/p/${String(i).padStart(3, '0')}.jpg`);
    const get = route(root);
    const one = await get('ds=alligators&dir=p&limit=10');
    expect(one.body.files.map((f: any) => f.name)[0]).toBe('000.jpg');
    expect(one.body.files).toHaveLength(10);
    expect(one.body.total).toBe(25);
    expect(one.body.next).toBe(`${LIB}/p/009.jpg`);
    put(root, `${LIB}/p/0005.jpg`); // sorts before the cursor
    const two = await get(
      `ds=alligators&dir=p&limit=10&cursor=${encodeURIComponent(one.body.next)}`
    );
    expect(two.body.files.map((f: any) => f.name)[0]).toBe('010.jpg');
    expect(two.body.dirs).toEqual([]);
    const three = await get(
      `ds=alligators&dir=p&limit=10&cursor=${encodeURIComponent(two.body.next)}`
    );
    expect(three.body.files.map((f: any) => f.name)).toEqual([
      '020.jpg',
      '021.jpg',
      '022.jpg',
      '023.jpg',
      '024.jpg',
    ]);
    expect(three.body.next).toBeNull();
    const big = await get('ds=alligators&dir=p&limit=99999');
    expect(big.body.files.length).toBeLessThanOrEqual(DS_ASSETS_LIMIT_MAX);
    expect(DS_ASSETS_LIMIT_MAX).toBe(500);
  });

  test('search reads names below the folder, every word', async () => {
    const root = project();
    put(root, `${LIB}/photos-cut/team-blue-2024.jpg`);
    put(root, `${LIB}/photos-cut/team-red.jpg`);
    put(root, `${LIB}/logos/team-blue-mark.svg`);
    put(root, `${LIB}/logos/_drafts/team-blue-old.svg`);
    const get = route(root);
    const all = await get('ds=alligators&q=TEAM%20blue');
    expect(all.body.files.map((f: any) => f.path)).toEqual([
      `${LIB}/logos/team-blue-mark.svg`,
      `${LIB}/photos-cut/team-blue-2024.jpg`,
    ]);
    expect(all.body.dirs).toEqual([]);
    const inLogos = await get('ds=alligators&dir=logos&q=team');
    expect(inLogos.body.files.map((f: any) => f.name)).toEqual(['team-blue-mark.svg']);
  });

  test('contained: `..`, a `_`/`.` folder and a backslash are refused; a symlink is neither walked nor listed', async () => {
    const root = project();
    const outside = project();
    put(outside, 'secret/leak.jpg');
    put(root, `${LIB}/ok.jpg`);
    put(root, `${LIB}/_cache/x.jpg`);
    put(root, `${LIB}/.hidden/x.jpg`);
    symlinkSync(path.join(outside, 'secret'), path.join(root, LIB, 'linked'));
    symlinkSync(path.join(outside, 'secret/leak.jpg'), path.join(root, LIB, 'leak.jpg'));
    const get = route(root);
    for (const dir of ['..', '../..', 'a/../..', '_cache', '.hidden', 'a\\b'])
      expect([dir, (await get(`ds=alligators&dir=${encodeURIComponent(dir)}`)).status]).toEqual([
        dir,
        400,
      ]);
    const top = await get('ds=alligators');
    expect(top.body.dirs).toEqual([]);
    expect(top.body.files.map((f: any) => f.name)).toEqual(['ok.jpg']);
    const found = await get('ds=alligators&q=leak');
    expect(found.body.files).toEqual([]);
    const hidden = await get('ds=alligators&q=x');
    expect(hidden.body.files).toEqual([]);
  });

  test('a symlinked folder is not opened, even by name; nor is the library itself when it is a symlink', async () => {
    const root = project();
    const outside = project();
    put(outside, 'secret/leak.jpg');
    put(root, `${LIB}/ok.jpg`);
    symlinkSync(path.join(outside, 'secret'), path.join(root, LIB, 'linked'));
    expect((await route(root)('ds=alligators&dir=linked')).status).toBe(404);
    const other = project();
    mkdirSync(path.join(other, 'system/alligators'), { recursive: true });
    symlinkSync(path.join(outside, 'secret'), path.join(other, LIB));
    const r = await route(other)('ds=alligators');
    expect(r.body.files ?? []).toEqual([]);
  });

  test('a system the config does not name, or one outside `system/<ds>`, is not found; no library yet is empty', async () => {
    const root = project();
    put(root, 'brand/odd/assets/x.jpg');
    const get = route(root);
    expect((await get('ds=nope')).status).toBe(404);
    expect((await get('ds=odd')).status).toBe(404);
    expect((await get('')).status).toBe(404);
    const empty = await get('ds=alligators');
    expect(empty.status).toBe(200);
    expect(empty.body.files).toEqual([]);
    expect((await get('ds=alligators&dir=photos')).status).toBe(404);
  });

  test('a canvas-only session lists only what its closure reads — never the disk', async () => {
    const root = project();
    put(root, `${LIB}/photos-cut/shown.jpg`);
    put(root, `${LIB}/photos-cut/other.jpg`);
    put(root, `${LIB}/logos/mark.svg`);
    put(root, `${LIB}/top.png`);
    const vis = canvasOnly([`${LIB}/photos-cut/shown.jpg`, 'ui/a.tsx', `${LIB}/gone.jpg`]);
    const get = route(root, vis);
    const top = await get('ds=alligators');
    expect(top.status).toBe(200);
    expect(top.body.dirs).toEqual([{ path: `${LIB}/photos-cut`, name: 'photos-cut', count: 1 }]);
    expect(top.body.files).toEqual([]); // top.png is not in its closure; gone.jpg is not on disk
    const photos = await get('ds=alligators&dir=photos-cut');
    expect(photos.body.files.map((f: any) => f.name)).toEqual(['shown.jpg']);
    expect((await get('ds=alligators&dir=logos')).status).toBe(404);
    expect((await get('ds=alligators&q=other')).body.files).toEqual([]);
    // a library it sees nothing of is not there
    const none = route(root, canvasOnly(['ui/a.tsx']));
    expect((await none('ds=alligators')).status).toBe(404);
  });

  test('3000 pictures in one folder: a page comes back within budget', async () => {
    const root = project();
    const dir = path.join(root, LIB, 'photos-cut');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 3000; i++) writeFileSync(path.join(dir, `P${i}.jpg`), 'x');
    const get = route(root);
    await get('ds=alligators&dir=photos-cut'); // warm the fs cache
    const t0 = performance.now();
    const r = await get('ds=alligators&dir=photos-cut&limit=200');
    const top = await get('ds=alligators');
    const searched = await get('ds=alligators&q=P29');
    const ms = performance.now() - t0;
    const capped = await get('ds=alligators&dir=photos-cut&limit=99999');
    expect(capped.body.files).toHaveLength(500);
    expect(capped.body.next).toBe(`${LIB}/photos-cut/${capped.body.files[499].name}`);
    expect(r.body.files).toHaveLength(200);
    expect(r.body.total).toBe(3000);
    expect(top.body.dirs).toEqual([{ path: `${LIB}/photos-cut`, name: 'photos-cut', count: 3000 }]);
    expect(searched.body.total).toBe(111); // P29, P290–P299, P2900–P2999
    expect(ms).toBeLessThan(400);
  });
});

// 2.0.3 (alligators.cloud.maude.sh, 2.0.2): in a cell the Library listed graphics/, logos/, photos/, … with 0 files in
// every one. On a cell the disk is a cache (DDR-243): a system's media is in the hub's journal and bucket, never at its
// checkout path — the listing must read the hub's media listing too (`listMaterializable`).
describe('GET /_api/ds/assets on a materializing cell', () => {
  const J = [
    `${LIB}/logos/mark-white.svg`,
    `${LIB}/photos-cut/b.jpg`,
    `${LIB}/photos-cut/a.jpg`,
    `${LIB}/photos-cut/2025/helmet.jpg`,
    `${LIB}/sponsors/acme.png`, // a folder the disk does not hold at all
    `${LIB}/hero.webp`,
    `${LIB}/linked/x.png`, // `linked` is a symlink on this disk — never opened
    `${LIB}/_runtime/a.png`,
    `${LIB}/logos/notes.txt`,
    'system/other/assets/logos/theirs.svg',
    'assets/zzzz0001.png',
  ];
  const cell = () => {
    const root = project();
    // the checkout: the folders (and one picture), no media of the journal's
    mkdirSync(path.join(root, LIB, 'logos'), { recursive: true });
    mkdirSync(path.join(root, LIB, 'photos-cut'), { recursive: true });
    put(root, `${LIB}/photos-cut/c.jpg`);
    const away = project();
    mkdirSync(path.join(away, 'x'), { recursive: true });
    symlinkSync(path.join(away, 'x'), path.join(root, LIB, 'linked'));
    return root;
  };

  test("the library top counts and lists the hub's media", async () => {
    const get = route(cell(), full, J);
    const top = await get('ds=alligators');
    expect(top.status).toBe(200);
    expect(top.body.dirs).toEqual([
      { path: `${LIB}/logos`, name: 'logos', count: 1 },
      { path: `${LIB}/photos-cut`, name: 'photos-cut', count: 3 },
      { path: `${LIB}/sponsors`, name: 'sponsors', count: 1 },
    ]);
    expect(top.body.files.map((f: any) => f.name)).toEqual(['hero.webp']);
    expect(top.body.files[0]).toMatchObject({ kind: 'image', placeable: true, size: 0 });
  });

  test('one folder, paging and search span the disk and the journal', async () => {
    const get = route(cell(), full, J);
    const photos = await get('ds=alligators&dir=photos-cut');
    expect(photos.body.files.map((f: any) => f.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(photos.body.dirs).toEqual([{ path: `${LIB}/photos-cut/2025`, name: '2025', count: 1 }]);
    expect(photos.body.total).toBe(3);
    const p1 = await get('ds=alligators&dir=photos-cut&limit=2');
    expect(p1.body.next).toBe(`${LIB}/photos-cut/b.jpg`);
    const p2 = await get(`ds=alligators&dir=photos-cut&limit=2&cursor=${p1.body.next}`);
    expect(p2.body.files.map((f: any) => f.name)).toEqual(['c.jpg']);
    expect((await get('ds=alligators&dir=sponsors')).body.files.map((f: any) => f.name)).toEqual([
      'acme.png',
    ]);
    const found = await get('ds=alligators&q=helmet');
    expect(found.body.files.map((f: any) => f.path)).toEqual([`${LIB}/photos-cut/2025/helmet.jpg`]);
    expect((await get('ds=alligators&q=theirs')).body.files).toEqual([]); // another system's
  });

  test('containment holds: a symlinked folder, a `_` folder, a missing folder', async () => {
    const get = route(cell(), full, J);
    expect((await get('ds=alligators&dir=linked')).status).toBe(404);
    expect((await get('ds=alligators&q=x')).body.files.map((f: any) => f.name)).toEqual([]);
    expect((await get('ds=alligators&dir=_runtime')).status).toBe(400);
    expect((await get('ds=alligators&dir=video')).status).toBe(404);
  });

  test('off a cell (no journal) the disk alone answers, as before', async () => {
    const top = await route(cell(), full, null)('ds=alligators');
    expect(top.body.dirs).toEqual([{ path: `${LIB}/photos-cut`, name: 'photos-cut', count: 1 }]);
  });

  test("a canvas-only session lists its closure's journal media, and nothing else", async () => {
    const vis = canvasOnly([
      `${LIB}/logos/mark-white.svg`,
      `${LIB}/photos-cut/a.jpg`,
      `${LIB}/gone.jpg`,
    ]);
    const get = route(cell(), vis, J);
    const top = await get('ds=alligators');
    expect(top.body.dirs).toEqual([
      { path: `${LIB}/logos`, name: 'logos', count: 1 },
      { path: `${LIB}/photos-cut`, name: 'photos-cut', count: 1 },
    ]);
    expect(top.body.files).toEqual([]); // hero.webp is not in its closure; gone.jpg is nowhere
    const photos = await get('ds=alligators&dir=photos-cut');
    expect(photos.body.files.map((f: any) => f.name)).toEqual(['a.jpg']);
    expect((await get('ds=alligators&dir=sponsors')).status).toBe(404);
  });

  test('3000 pictures held only by the hub: a page comes back within budget', async () => {
    const root = project();
    mkdirSync(path.join(root, LIB, 'photos-cut'), { recursive: true });
    const journal = Array.from({ length: 3000 }, (_, i) => `${LIB}/photos-cut/P${i}.jpg`);
    const get = route(root, full, journal);
    await get('ds=alligators&dir=photos-cut'); // warm
    const t0 = performance.now();
    const r = await get('ds=alligators&dir=photos-cut&limit=200');
    const top = await get('ds=alligators');
    const searched = await get('ds=alligators&q=P29');
    const ms = performance.now() - t0;
    expect(r.body.files).toHaveLength(200);
    expect(r.body.total).toBe(3000);
    expect(top.body.dirs).toEqual([{ path: `${LIB}/photos-cut`, name: 'photos-cut', count: 3000 }]);
    expect(searched.body.total).toBe(111);
    expect(ms).toBeLessThan(400);
  });
});

describe('the pure parts', () => {
  test('dsAssetsRootOf takes only `system/<one segment>`', () => {
    expect(dsAssetsRootOf('system/alligators')).toBe('system/alligators/assets');
    expect(dsAssetsRootOf('/system/alligators/')).toBe('system/alligators/assets');
    for (const p of ['system', 'system/a/b', 'brand/x', 'system/_x', 'system/..', '', null])
      expect([p, dsAssetsRootOf(p)]).toEqual([p, null]);
  });
  test('normDsDir', () => {
    expect(normDsDir(null)).toBe('');
    expect(normDsDir('/photos-cut/')).toBe('photos-cut');
    expect(normDsDir('a/b c')).toBe('a/b c');
    for (const d of ['..', 'a//b', '_x', 'a/.b', 'a\\b'])
      expect([d, normDsDir(d)]).toEqual([d, null]);
  });
  test('a direct call with an unsafe folder answers 400', async () => {
    const r = await listDsAssets({ designRoot: '/x', systemPath: 'system/a', dir: '../b' });
    expect(r).toEqual({ ok: false, status: 400, reason: 'bad-dir' });
  });
});
