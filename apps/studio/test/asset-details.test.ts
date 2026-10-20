// S8.21 — asset details per kind, the Advanced facts, and the Generated group. The Original path is this Mac's own
// record and is told to nobody else; the sidecars are only ever read.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { assetDetails, boardsShowing, shellPath } from '../asset-details.ts';
import { listGeneratedGroups } from '../asset-generated.ts';
import { recordAssetOrigin } from '../asset-origins.ts';
import { createAssetDetailsRoutes } from '../routes/asset-details.ts';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const project = () => {
  const r = mkdtempSync(path.join(tmpdir(), 'asset-details-'));
  roots.push(r);
  mkdirSync(path.join(r, 'assets'), { recursive: true });
  return r;
};
const put = (root: string, rel: string, body: string | Buffer = 'x') => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};
const gen = (self: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'maude.gen',
    v: 1,
    prompt: 'night touchdown, stadium lights, 4:5',
    provider: 'fal',
    model: 'flux-pro-1.1',
    at: '2026-10-18T09:12:00Z',
    licence: 'You own the output; provider terms apply.',
    group: 'g_3f9a1c2e7b40',
    takes: [self, 'e5f60718'],
    by: 'Tereza',
    ...extra,
  });
const canvas = (board: string, src: string, label = `Post ${board}`) => `
export default function C() { return (<DesignCanvas><DCSection id="s">
  <DCArtboard id="${board}" label="${label}" width={400} height={400}>
    <img src="${src}" alt="" />
  </DCArtboard></DCSection></DesignCanvas>); }`;
const base = (root: string, extra: Record<string, unknown> = {}) => ({
  designRoot: root,
  usedIn: [] as string[],
  readCanvas: () => null,
  includeOriginal: true,
  home: '/Users/jonas',
  ...extra,
});

describe('assetDetails', () => {
  test('a photo: kind, size, extension, no Made by AI, and the artboards that show it', () => {
    const root = project();
    put(root, 'assets/d34bb59d.jpg', 'x'.repeat(1234));
    const src = canvas('ab-post', 'assets/d34bb59d.jpg', 'Post 4:5 · Fotky ze zápasu');
    const d = assetDetails(
      'assets/d34bb59d.jpg',
      base(root, { usedIn: ['ui/matchday.tsx'], readCanvas: () => src })
    );
    expect(d).toMatchObject({
      rel: 'assets/d34bb59d.jpg',
      kind: 'image',
      ext: 'jpg',
      size: 1234,
      madeByAi: null,
      footage: null,
    });
    expect(d?.uses).toEqual([
      {
        canvas: 'ui/matchday.tsx',
        boards: [{ id: 'ab-post', label: 'Post 4:5 · Fotky ze zápasu' }],
      },
    ]);
  });

  test('every way a canvas spells the path finds its artboard', () => {
    for (const spelling of [
      'assets/d34bb59d.jpg',
      './assets/d34bb59d.jpg',
      '../assets/d34bb59d.jpg',
      '/assets/d34bb59d.jpg',
      '.design/assets/d34bb59d.jpg',
      'assets/d34bb59d.jpg?v=2',
    ])
      expect(
        boardsShowing(canvas('ab-x', spelling), 'ui/a.tsx', 'assets/d34bb59d.jpg'),
        spelling
      ).toEqual([{ id: 'ab-x', label: 'Post ab-x' }]);
    expect(
      boardsShowing(canvas('ab-x', 'assets/other000.jpg'), 'ui/a.tsx', 'assets/d34bb59d.jpg')
    ).toEqual([]);
  });

  test('a use that is not an element still names its canvas, with no artboard to open', () => {
    const root = project();
    put(root, 'assets/d34bb59d.jpg');
    const d = assetDetails(
      'assets/d34bb59d.jpg',
      base(root, { usedIn: ['ui/a.tsx'], readCanvas: () => 'export default () => null;' })
    );
    expect(d?.uses).toEqual([{ canvas: 'ui/a.tsx', boards: [] }]);
    expect(boardsShowing('not tsx at all <<<', 'ui/a.tsx', 'assets/d34bb59d.jpg')).toEqual([]);
  });

  test('Made by AI: the prompt, the provider and the one licence line; a record this Maude cannot read is no record', () => {
    const root = project();
    put(root, 'assets/a1b2c3d4.png');
    put(root, 'assets/a1b2c3d4.gen.json', gen('a1b2c3d4'));
    const d = assetDetails('assets/a1b2c3d4.png', base(root));
    expect(d?.madeByAi).toEqual({
      prompt: 'night touchdown, stadium lights, 4:5',
      provider: 'fal',
      model: 'flux-pro-1.1',
      at: '2026-10-18T09:12:00Z',
      licence: 'You own the output; provider terms apply.',
      by: 'Tereza',
    });
    put(root, 'assets/a1b2c3d4.gen.json', gen('a1b2c3d4', { v: 2 }));
    expect(assetDetails('assets/a1b2c3d4.png', base(root))?.madeByAi).toBeNull();
    put(root, 'assets/a1b2c3d4.gen.json', '{not json');
    expect(assetDetails('assets/a1b2c3d4.png', base(root))?.madeByAi).toBeNull();
  });

  test('a sound made by AI reads its prompt from the older intent record', () => {
    const root = project();
    put(root, 'assets/2a886bcf.mp3');
    put(
      root,
      'assets/2a886bcf.audio.json',
      JSON.stringify({
        asset: 'assets/2a886bcf.mp3',
        kind: 'music',
        prompt: 'Hype beat, 120 BPM',
        provider: 'elevenlabs',
        model: 'music_v1',
        at: '2026-09-28T10:00:00.000Z',
      })
    );
    const d = assetDetails('assets/2a886bcf.mp3', base(root));
    expect(d).toMatchObject({
      kind: 'audio',
      madeByAi: { prompt: 'Hype beat, 120 BPM', provider: 'elevenlabs' },
    });
    expect(d?.advanced.inCanvases).toBe('<audio src="assets/2a886bcf.mp3">');
  });

  test('footage: what AI saw, the good moments in order, read without writing a byte', () => {
    const root = project();
    put(root, 'assets/11abf029.mp4', 'v');
    const sidecar = path.join(root, 'assets/11abf029.footage.json');
    put(
      root,
      'assets/11abf029.footage.json',
      JSON.stringify({
        version: 1,
        asset: 'assets/11abf029.mp4',
        durationSec: 7,
        width: 1280,
        height: 720,
        summary: 'A runner breaks a tackle and scores.',
        tags: ['sport', 'day'],
        shots: [
          { start: 5, end: 6, subject: 'celebration', quality: 0.9, usable: true },
          { start: 1, end: 4, note: 'run', quality: 0.8 },
          { start: 4, end: 5, subject: 'shaky', quality: 1, usable: false },
        ],
      })
    );
    const before = statSync(sidecar).mtimeMs;
    const d = assetDetails('assets/11abf029.mp4', base(root));
    expect(d?.footage).toMatchObject({
      summary: 'A runner breaks a tackle and scores.',
      tags: ['sport', 'day'],
      durationSec: 7,
      moments: [
        { start: 1, end: 4, note: 'run' },
        { start: 5, end: 6, note: 'celebration' },
      ],
    });
    expect(statSync(sidecar).mtimeMs).toBe(before);
    expect(d?.advanced.inCanvases).toBe('<video src="assets/11abf029.mp4">');
    // the empty stub a generated clip starts with has nothing to say
    put(
      root,
      'assets/11abf029.footage.json',
      JSON.stringify({ version: 1, asset: 'assets/11abf029.mp4', shots: [] })
    );
    expect(assetDetails('assets/11abf029.mp4', base(root))?.footage).toBeNull();
  });

  test('Advanced: stored as, edits, cut-out, in canvases; the Original and the command only with this Mac’s record', () => {
    const root = project();
    put(root, 'assets/d34bb59d.jpg');
    put(
      root,
      'assets/d34bb59d.photo.json',
      JSON.stringify({ v: 1, adjustments: { exposure: 0.2 } })
    );
    put(
      root,
      'assets/d34bb59d.0a293589.photo.json',
      JSON.stringify({ backgroundRemoved: { enabled: true, maskAsset: 'assets/0a293589.png' } })
    );
    put(root, 'assets/0a293589.png');
    put(root, 'assets/d34bb59d.gen.json', 'unrelated');
    const none = assetDetails('assets/d34bb59d.jpg', base(root));
    expect(none?.advanced).toEqual({
      storedAs: 'assets/d34bb59d.jpg',
      edits: ['assets/d34bb59d.0a293589.photo.json', 'assets/d34bb59d.photo.json'].sort(),
      cutOuts: ['assets/0a293589.png'],
      inCanvases: '<img src="assets/d34bb59d.jpg">',
    });
    recordAssetOrigin(
      root,
      'assets/d34bb59d.jpg',
      '/Users/jonas/Pictures/Alligators/2026-09-27 Panthers/IMG_2247.jpg'
    );
    const mine = assetDetails('assets/d34bb59d.jpg', base(root));
    expect(mine?.advanced.original).toBe('~/Pictures/Alligators/2026-09-27 Panthers/IMG_2247.jpg');
    expect(mine?.advanced.command).toBe(
      'maude design import-asset "$HOME/Pictures/Alligators/2026-09-27 Panthers/IMG_2247.jpg" --kind raster'
    );
    // a session that may not hear it gets neither the path nor a command that contains it
    const other = assetDetails('assets/d34bb59d.jpg', base(root, { includeOriginal: false }));
    expect(JSON.stringify(other)).not.toContain('Pictures');
    expect(other?.advanced.command).toBeUndefined();
  });

  test('a name that is not an asset, or is not there, has no details', () => {
    const root = project();
    put(root, 'assets/d34bb59d.photo.json');
    for (const rel of [
      'assets/../x.png',
      'assets/sub/x.png',
      'assets/d34bb59d.photo.json',
      'assets/00000000.png',
      'ui/a.tsx',
    ])
      expect(assetDetails(rel, base(root))).toBeNull();
  });

  test('shellPath keeps ~ expandable and quotes the unusual', () => {
    expect(shellPath('~/Pictures/x.jpg')).toBe('~/Pictures/x.jpg');
    expect(shellPath('~/My Pics/a"b$c.jpg')).toBe('"$HOME/My Pics/a\\"b\\$c.jpg"');
    expect(shellPath('/Volumes/Big Disk/x.jpg')).toBe('"/Volumes/Big Disk/x.jpg"');
  });
});

describe('the Generated group', () => {
  test('one block per run, takes in the order they were made, newest run first', () => {
    const root = project();
    for (const [i, s] of ['a1b2c3d4', 'e5f60718', '9a0b1c2d'].entries()) {
      put(root, `assets/${s}.png`);
      put(
        root,
        `assets/${s}.gen.json`,
        gen(s, { takes: ['a1b2c3d4', 'e5f60718', '9a0b1c2d'], at: '2026-10-18T09:12:00Z' })
      );
      expect(i).toBeGreaterThanOrEqual(0);
    }
    put(root, 'assets/11111111.png');
    put(
      root,
      'assets/11111111.gen.json',
      gen('11111111', {
        group: 'g_newer',
        takes: ['11111111'],
        at: '2026-10-19T09:00:00Z',
        prompt: 'later one',
      })
    );
    put(root, 'assets/22222222.png'); // a plain photo: no record, not generated
    const groups = listGeneratedGroups(root);
    expect(groups.map((g) => g.group)).toEqual(['g_newer', 'g_3f9a1c2e7b40']);
    expect(groups[1]?.takes).toEqual([
      'assets/a1b2c3d4.png',
      'assets/e5f60718.png',
      'assets/9a0b1c2d.png',
    ]);
    expect(groups[0]).toMatchObject({ prompt: 'later one', provider: 'fal', by: 'Tereza' });
  });

  test('a take that is gone, a record without its picture and a record of a newer version are left out', () => {
    const root = project();
    put(root, 'assets/a1b2c3d4.png');
    put(root, 'assets/a1b2c3d4.gen.json', gen('a1b2c3d4', { takes: ['a1b2c3d4', 'e5f60718'] }));
    put(
      root,
      'assets/33333333.gen.json',
      gen('33333333', { takes: ['33333333'], group: 'g_orphan' })
    ); // no picture
    put(root, 'assets/44444444.png');
    put(
      root,
      'assets/44444444.gen.json',
      gen('44444444', { takes: ['44444444'], group: 'g_future', v: 2 })
    );
    const groups = listGeneratedGroups(root);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.takes).toEqual(['assets/a1b2c3d4.png']);
    expect(listGeneratedGroups(path.join(root, 'nowhere'))).toEqual([]);
  });
});

describe('routes', () => {
  const owner = resolveAccess({ v: 1, role: 'owner' });
  const viewer = resolveAccess({ v: 1, role: 'viewer' });
  const guest = resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] });
  function wire(access: ReturnType<typeof resolveAccess>, extra: Record<string, unknown> = {}) {
    const root = project();
    put(root, 'assets/d34bb59d.jpg', 'x');
    recordAssetOrigin(root, 'assets/d34bb59d.jpg', '/Users/jonas/Pictures/IMG.jpg');
    put(root, 'assets/a1b2c3d4.png');
    put(root, 'assets/a1b2c3d4.gen.json', gen('a1b2c3d4', { takes: ['a1b2c3d4'] }));
    const [details, generated] = createAssetDetailsRoutes({
      designRoot: root,
      access: () => access,
      usedIn: (rel) => (rel === 'assets/d34bb59d.jpg' ? ['ui/a.tsx', 'ui/secret.tsx'] : []),
      read: (c) => canvas(c === 'ui/a.tsx' ? 'one' : 'two', 'assets/d34bb59d.jpg'),
      home: '/Users/jonas',
      ...extra,
    });
    const get = async (spec: typeof details, q: string) => {
      const res = (await spec?.handle(
        new Request(`http://localhost${spec.path}${q}`),
        {}
      )) as Response;
      return { status: res.status, body: (await res.json()) as any };
    };
    return { details, generated, get };
  }

  test('both are main-origin reads that every role may make', () => {
    const { details, generated } = wire(owner);
    for (const s of [details, generated]) {
      expect(s?.method).toBe('GET');
      expect(s?.origin).toBe('main');
      expect(s?.readOnly).toBe('allowed');
    }
  });

  test('a project session (a viewer too) is told the Original; the details name every canvas', async () => {
    for (const a of [owner, viewer]) {
      const { details, get } = wire(a);
      const r = await get(details!, '?path=assets/d34bb59d.jpg');
      expect(r.status).toBe(200);
      expect(r.body.details.advanced.original).toBe('~/Pictures/IMG.jpg');
      expect(r.body.details.uses.map((u: any) => u.canvas)).toEqual(['ui/a.tsx', 'ui/secret.tsx']);
    }
  });

  test('a cell has no Mac: no Original', async () => {
    const { details, get } = wire(owner, { inCell: true });
    const r = await get(details!, '?path=assets/d34bb59d.jpg');
    expect(r.body.details.advanced.original).toBeUndefined();
  });

  test('a canvas-only guest is told neither the Original nor a canvas it cannot see, and no other asset’s group', async () => {
    const { details, generated, get } = wire(guest);
    const r = await get(details!, '?path=assets/d34bb59d.jpg');
    expect(r.body.details.advanced.original).toBeUndefined();
    expect(r.body.details.uses.map((u: any) => u.canvas)).toEqual(['ui/a.tsx']);
    expect(JSON.stringify(r.body)).not.toContain('Pictures');
    expect(JSON.stringify(r.body)).not.toContain('secret');
    expect((await get(generated!, '')).body.groups).toEqual([]);
  });

  test('a bad or unknown path is refused the same way for everyone', async () => {
    const { details, get } = wire(owner);
    expect((await get(details!, '?path=../x')).status).toBe(400);
    expect((await get(details!, '')).status).toBe(400);
    expect((await get(details!, '?path=assets/00000000.png')).status).toBe(404);
  });

  test('the Generated group is served to a project session', async () => {
    const { generated, get } = wire(owner);
    const r = await get(generated!, '');
    expect(r.body.groups.map((g: any) => g.takes)).toEqual([['assets/a1b2c3d4.png']]);
  });
});
