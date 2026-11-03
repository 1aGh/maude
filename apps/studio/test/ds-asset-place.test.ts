// 2.0.2 — placing a design system's own picture (the Assets tab's "Design system" source). It lands as a LITERAL,
// root-absolute designRoot reference `/<designRel>/system/<ds>/assets/…` (editing/ds-asset-ref.ts) — a static string the
// canvas closure can read — and only for a file that is there, under the server's own designRel.

import { describe, expect, test } from 'bun:test';
import { closureFor, type ProjectReader } from '../access/closure.ts';
import { frameReadsProjectMedia, narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { placeRequestFor } from '../client/v2/assets/asset-drop-session.js';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { isPlaceableSrc } from '../edit-ops/image-fit.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { assetDragData, isAssetPath, parseAssetDrag } from '../editing/asset-drag.ts';
import { dsAssetRel, dsAssetRelOfSrc, dsAssetSrc, isDsAssetSrc } from '../editing/ds-asset-ref.ts';

const FILE = 'ui/Post.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Post() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post 1:1" width={1080} height={1080}>
        <div data-cd-id="mvp" style={{ width: 300, height: 400 }}>
          <img data-cd-id="old-photo" src="assets/aaaaaaaa.jpg" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const PHOTO = 'system/alligators/assets/photos-cut/IMG_2231.jpg';
const SPACED = 'system/alligators/assets/photos-cut/Team photo (2).jpg';
const LIT = `/.design/${PHOTO}`;

function harness(onDisk: string[] = [PHOTO], designRel = '.design') {
  const files = new Map<string, string>([[FILE, SRC]]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      files.set(rel, after);
    },
    heldByAi: () => null,
    log: createWriteLog(),
    exists: (rel) => onDisk.includes(rel),
    ctx: () => ({ dsRev: null, designRel }),
  };
  const run = (op: string, params: Record<string, unknown>, targets: string[] = []) =>
    dispatchEditOp(
      {
        file: FILE,
        op,
        targets: targets.map((element) => ({ artboard: 'post', element })),
        params,
      },
      deps
    );
  return { run, src: () => files.get(FILE) as string };
}
const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};

describe('the literal DS reference', () => {
  test('dsAssetSrc builds `/<designRel>/system/<ds>/assets/…`; the round trip gives the path back', () => {
    expect(dsAssetSrc(PHOTO, '.design')).toBe(LIT);
    expect(dsAssetSrc(PHOTO, '/apps/web/.design/')).toBe(`/apps/web/.design/${PHOTO}`);
    expect(dsAssetRelOfSrc(LIT, '.design')).toBe(PHOTO);
    expect(dsAssetRelOfSrc(LIT, 'design')).toBeNull(); // another designRel
    expect(isDsAssetSrc(LIT)).toBe(true);
  });
  test('refuses what would change what the reference means, and what a canvas cannot show', () => {
    for (const rel of [
      'system/alligators/assets/../../config.json',
      'system/alligators/assets/_cache/x.jpg',
      'system/alligators/assets/.x/x.jpg',
      'system/_x/assets/x.jpg',
      'system/alligators/x.jpg',
      'system/alligators/assets/a"b.jpg',
      'system/alligators/assets/a&amp;b.jpg',
      'system/alligators/assets/a%20b.jpg',
      'system/alligators/assets/a?b.jpg',
      'system/alligators/assets/a{b}.jpg',
      'system/alligators/assets/song.mp3',
      'system/alligators/assets/notes.txt',
      'assets/aaaaaaaa.jpg',
    ])
      expect([rel, dsAssetRel(rel)]).toEqual([rel, null]);
    expect(dsAssetRelOfSrc('/../system/a/assets/x.jpg')).toBeNull();
    expect(dsAssetRelOfSrc('system/a/assets/x.jpg')).toBeNull(); // not root-absolute
  });
  test('a tile may drag it; the drop asks image.place with the same literal', () => {
    expect(isAssetPath(LIT)).toBe(true);
    expect(isAssetPath('assets/aaaaaaaa.jpg')).toBe(true);
    expect(isAssetPath('/.design/system/a/assets/../../x.jpg')).toBe(false);
    expect(parseAssetDrag(assetDragData({ asset: LIT, w: 10, h: 20 }))).toEqual({
      asset: LIT,
      w: 10,
      h: 20,
    });
    expect(
      placeRequestFor(
        { asset: LIT },
        { kind: 'frame', artboard: 'post', element: 'mvp' },
        'ui/Post.tsx'
      )
    ).toEqual({
      asset: LIT,
      target: { canvas: 'ui/Post.tsx', artboardId: 'post', frameId: 'mvp' },
      mode: 'fill',
    });
  });
});

describe('image.place / image.replace with a DS picture', () => {
  test('fill writes the literal reference into the frame', async () => {
    const h = harness();
    good(await h.run('image.place', { asset: LIT, mode: 'fill' }, ['mvp']));
    expect(h.src()).toContain(`src="${LIT}"`);
    expect(h.src()).not.toContain('assets/aaaaaaaa.jpg');
  });
  test('loose on the artboard, and several in a grid', async () => {
    const h = harness([PHOTO, 'system/alligators/assets/logos/mark.svg']);
    good(await h.run('image.place', { asset: LIT, mode: 'loose', artboard: 'post' }));
    expect(h.src()).toContain(`<img data-cd-id=`);
    expect(h.src()).toContain(`src="${LIT}"`);
    const g = harness([PHOTO, 'system/alligators/assets/logos/mark.svg']);
    const two = [LIT, '/.design/system/alligators/assets/logos/mark.svg'];
    good(await g.run('image.place', { assets: two, mode: 'grid', artboard: 'post' }));
    for (const s of two) expect(g.src()).toContain(`src="${s}"`);
  });
  test('a name with spaces and brackets is written as it is (the browser encodes it)', async () => {
    const h = harness([SPACED]);
    good(await h.run('image.place', { asset: `/.design/${SPACED}`, mode: 'fill' }, ['mvp']));
    expect(h.src()).toContain(`src="/.design/${SPACED}"`);
  });
  test('replace swaps the source to the literal reference', async () => {
    const h = harness();
    good(await h.run('image.replace', { asset: LIT }, ['old-photo']));
    expect(h.src()).toContain(`src="${LIT}"`);
  });
  test('refused: a file that is not there, another designRel, no designRel known', async () => {
    const missing = harness([]);
    const r1 = await missing.run('image.place', { asset: LIT, mode: 'fill' }, ['mvp']);
    expect(r1.ok).toBe(false);
    const other = harness([PHOTO], 'design');
    expect((await other.run('image.place', { asset: LIT, mode: 'fill' }, ['mvp'])).ok).toBe(false);
    expect(isPlaceableSrc(LIT, { exists: () => true })).toBe(false);
    expect(isPlaceableSrc(LIT, { ctx: { dsRev: null, designRel: '.design' } })).toBe(false);
    expect(isPlaceableSrc('assets/aaaaaaaa.jpg', {})).toBe(true); // a project upload, unchanged
  });
});

describe('the canvas closure sees the placed reference', () => {
  // The placed literal must be a STATIC reference the canvas closure (access/closure.ts) reads, so a frame may load the
  // picture. A canvas whose meta names the system already reads that system's assets. A canvas that does NOT name it
  // (another system, or none) and places one of its pictures is the "Picture not found" / 403 `not-in-scope` case a
  // parallel builder owned: `staticAssetRefs` reads only project `assets/…`. Michal's 2026-11-03 rule answers it for project-role frames (last test).
  const reader = (files: Record<string, string>): ProjectReader => ({
    list: () => Object.keys(files),
    text: (rel) => files[rel] ?? null,
    head: () => 'h1',
  });
  const files = (meta: string | null) => ({
    'config.json': JSON.stringify({
      designSystems: [
        { name: 'alligators', path: 'system/alligators' },
        { name: 'club', path: 'system/club' },
      ],
    }),
    'ui/Post.tsx': `export default () => <DesignCanvas><img src="${LIT}" alt="" /></DesignCanvas>;`,
    ...(meta ? { 'ui/Post.meta.json': JSON.stringify({ designSystem: meta }) } : {}),
    'system/alligators/colors_and_type.css': ':root{}',
    'system/club/colors_and_type.css': ':root{}',
    [PHOTO]: 'x',
  });
  const grant = resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/Post.tsx', r: 'viewer' }] });

  test('the placed source is one static string, never an expression', async () => {
    const h = harness();
    good(await h.run('image.place', { asset: LIT, mode: 'fill' }, ['mvp']));
    expect(h.src()).toMatch(
      /src="\/\.design\/system\/alligators\/assets\/photos-cut\/IMG_2231\.jpg"/
    );
    expect(h.src()).not.toMatch(/src=\{/);
  });

  test('a canvas whose meta names the system: closureFor(grant).read holds the placed picture', () => {
    expect(closureFor(grant, reader(files('alligators'))).read.has(PHOTO)).toBe(true);
  });

  // maude/v2-202-project-role-frames-read-project-media (Michal, 2026-11-03): the closure stays
  // strict (a share of the canvas still does not read another system's picture), and a frame opened
  // with a project read role reads every project media file — so the placed picture loads for the
  // owner, members and viewers whatever system the canvas names.
  test('a canvas on another system places one of this system’s pictures: a project-role frame reads it', () => {
    expect(closureFor(grant, reader(files('club'))).read.has(PHOTO)).toBe(false);
    const member = narrowToFrame(resolveAccess({ v: 1, role: 'member' }), ['ui/Post.tsx']);
    expect(frameReadsProjectMedia(member, PHOTO, 'GET')).toBe(true);
    const share = narrowToFrame(grant, ['ui/Post.tsx']);
    expect(frameReadsProjectMedia(share, PHOTO, 'GET')).toBe(false);
  });
});
