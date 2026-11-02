// S8.13 — Move to the trash for an asset: the picture AND its sidecars go together into one `_trash/` bundle that
// remembers where each file lives, so Trash (or Undo) brings them all back; a picture a canvas uses, one an older
// version still shows, or one whose history is still being read is refused (a wrong "moved" would break Version history).
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sidecarsOf, trashAssets } from '../asset-trash.ts';
import { listTrash, restoreFromTrash } from '../sync/trash.ts';

const roots: string[] = [];
function project() {
  const designRoot = mkdtempSync(path.join(tmpdir(), 'asset-trash-'));
  roots.push(designRoot);
  mkdirSync(path.join(designRoot, 'assets'), { recursive: true });
  return designRoot;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const put = (root: string, rel: string, body = 'x') => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};
const row = (extra: Record<string, unknown> = {}) => ({
  usedIn: [] as string[],
  usedElsewhere: false,
  olderVersions: false as boolean | 'checking',
  notUsed: true as boolean | 'checking',
  ...extra,
});

describe('sidecarsOf', () => {
  test('takes the picture’s own sidecars, including per-use edits, and not another picture of the same stem', () => {
    const root = project();
    for (const f of [
      'assets/a1b2c3d4.jpg',
      'assets/a1b2c3d4.photo.json',
      'assets/a1b2c3d4.gen.json',
      'assets/a1b2c3d4.9f8e7d6c.photo.json',
      'assets/a1b2c3d4.png', // another picture that happens to share the stem
      'assets/zzzz0000.photo.json', // somebody else's
    ])
      put(root, f);
    expect(sidecarsOf(root, 'assets/a1b2c3d4.jpg').sort()).toEqual([
      'assets/a1b2c3d4.9f8e7d6c.photo.json',
      'assets/a1b2c3d4.gen.json',
      'assets/a1b2c3d4.photo.json',
    ]);
  });
});

describe('trashAssets', () => {
  test('moves the picture and every sidecar into one bundle, and the Trash can put them all back', () => {
    const root = project();
    put(root, 'assets/a1b2c3d4.jpg', 'pixels');
    put(root, 'assets/a1b2c3d4.photo.json', '{"v":1}');
    put(root, 'assets/a1b2c3d4.9f8e7d6c.photo.json', '{"v":1}');
    put(root, 'assets/a1b2c3d4.gen.json', '{"format":"maude.gen"}');
    const { results } = trashAssets({
      designRoot: root,
      rels: ['assets/a1b2c3d4.jpg'],
      rowOf: () => row(),
    });
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.trashed.sort()).toEqual([
      'assets/a1b2c3d4.9f8e7d6c.photo.json',
      'assets/a1b2c3d4.gen.json',
      'assets/a1b2c3d4.jpg',
      'assets/a1b2c3d4.photo.json',
    ]);
    for (const rel of r.trashed) expect(existsSync(path.join(root, rel))).toBe(false);

    // every parked file knows its way home (the manifest), so Trash > Restore and Undo work per file
    const parked = listTrash(root).filter(
      (e) => e.trashRel.startsWith(r.trashDir) && !e.trashRel.endsWith('_trash-manifest.json')
    );
    expect(parked.map((e) => e.sourceRel).sort()).toEqual(r.trashed.slice().sort());
    for (const e of parked) expect(restoreFromTrash(root, e.trashRel).ok).toBe(true);
    expect(readFileSync(path.join(root, 'assets/a1b2c3d4.jpg'), 'utf8')).toBe('pixels');
    expect(existsSync(path.join(root, 'assets/a1b2c3d4.gen.json'))).toBe(true);
  });

  test('refuses what a canvas uses, what an older version still shows, and what is still being checked', () => {
    const root = project();
    const rows: Record<string, ReturnType<typeof row>> = {};
    for (const f of ['11111111', '22222222', '33333333', '44444444']) put(root, `assets/${f}.jpg`);
    rows['assets/11111111.jpg'] = row({ usedIn: ['ui/matchday.tsx'], notUsed: false });
    rows['assets/22222222.jpg'] = row({ olderVersions: true, notUsed: false });
    rows['assets/33333333.jpg'] = row({ olderVersions: 'checking', notUsed: 'checking' });
    rows['assets/44444444.jpg'] = row({ usedElsewhere: true, notUsed: false });
    const { results } = trashAssets({
      designRoot: root,
      rels: [
        'assets/11111111.jpg',
        'assets/22222222.jpg',
        'assets/33333333.jpg',
        'assets/44444444.jpg',
      ],
      rowOf: (rel) => rows[rel] ?? null,
    });
    expect(results.map((r) => (r.ok ? 'moved' : r.reason))).toEqual([
      'used',
      'kept-by-versions',
      'checking',
      'used',
    ]);
    for (const f of ['11111111', '22222222', '33333333', '44444444'])
      expect(existsSync(path.join(root, `assets/${f}.jpg`))).toBe(true);
    expect(existsSync(path.join(root, '_trash'))).toBe(false);
  });

  test('a missing picture, a path outside assets/, a traversal and a sidecar are each refused by name', () => {
    const root = project();
    put(root, 'assets/a1b2c3d4.photo.json');
    put(root, 'ui/hero.tsx');
    const { results } = trashAssets({
      designRoot: root,
      rels: [
        'assets/ffffffff.jpg',
        'ui/hero.tsx',
        'assets/../ui/hero.tsx',
        'assets/a1b2c3d4.photo.json',
        '/etc/passwd',
      ],
      rowOf: () => row(),
    });
    expect(results.map((r) => (r.ok ? 'moved' : r.reason))).toEqual([
      'missing',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
    ]);
    expect(existsSync(path.join(root, 'ui/hero.tsx'))).toBe(true);
  });

  test('a picture the index does not know yet is "checking", never moved on a guess', () => {
    const root = project();
    put(root, 'assets/a1b2c3d4.jpg');
    const { results } = trashAssets({
      designRoot: root,
      rels: ['assets/a1b2c3d4.jpg'],
      rowOf: () => null,
    });
    expect(results[0]?.ok === false && results[0].reason).toBe('checking');
    expect(existsSync(path.join(root, 'assets/a1b2c3d4.jpg'))).toBe(true);
  });
});
