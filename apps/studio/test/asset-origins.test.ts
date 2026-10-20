// S8.21 — where a picture came from on THIS Mac: a per-Mac runtime record, never a synced file, never an export.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  homeShort,
  isOriginPath,
  MAX_ORIGINS,
  ORIGINS_REL,
  originKey,
  readAssetOrigin,
  recordAssetOrigin,
} from '../asset-origins.ts';
import { isMaudeRuntimeState } from '../git/service.ts';
import { classifyProjectFile, isRuntimeStateRel } from '../sync/file-membership.ts';

const roots: string[] = [];
const project = () => {
  const r = mkdtempSync(path.join(tmpdir(), 'asset-origins-'));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('asset origins', () => {
  test('a recorded import path reads back for the same picture, whatever its extension', () => {
    const root = project();
    expect(
      recordAssetOrigin(root, 'assets/d34bb59d.jpg', '/Users/jonas/Pictures/IMG_2247.jpg', 5)
    ).toBe(true);
    expect(readAssetOrigin(root, 'assets/d34bb59d.jpg')).toEqual({
      path: '/Users/jonas/Pictures/IMG_2247.jpg',
      importedAt: 5,
    });
    expect(readAssetOrigin(root, 'assets/d34bb59d.png')?.path).toBe(
      '/Users/jonas/Pictures/IMG_2247.jpg'
    );
    expect(readAssetOrigin(root, 'assets/00000000.jpg')).toBeNull();
  });

  test('the record lives in the per-Mac runtime class on every list that decides what syncs', () => {
    expect(ORIGINS_REL).toBe('_canvas-state/asset-origins.json');
    expect(isRuntimeStateRel(ORIGINS_REL)).toBe(true);
    expect(classifyProjectFile(ORIGINS_REL)).toBe('never');
    expect(isMaudeRuntimeState(`.design/${ORIGINS_REL}`)).toBe(true);
  });

  test('a path that is not absolute, has a control character or is huge is not kept', () => {
    const root = project();
    for (const bad of [
      'Pictures/x.jpg',
      '/Users/a/x\n.jpg',
      '/Users/a/x\u0000.jpg',
      `/${'a'.repeat(1100)}`,
      '',
    ]) {
      expect(isOriginPath(bad)).toBe(false);
      expect(recordAssetOrigin(root, 'assets/d34bb59d.jpg', bad)).toBe(false);
    }
    expect(existsSync(path.join(root, ORIGINS_REL))).toBe(false);
  });

  test('a name that is not content-addressed has no record', () => {
    const root = project();
    expect(originKey('assets/IMG_2247.jpg')).toBeNull();
    expect(originKey('assets/sub/d34bb59d.jpg')).toBeNull();
    expect(originKey('assets/d34bb59d.photo.json')).toBe('d34bb59d');
    expect(recordAssetOrigin(root, 'assets/IMG_2247.jpg', '/Users/a/x.jpg')).toBe(false);
  });

  test('the same bytes imported again keep one record, newest copy wins, same copy changes nothing', () => {
    const root = project();
    recordAssetOrigin(root, 'assets/d34bb59d.jpg', '/Users/a/old.jpg', 1);
    recordAssetOrigin(root, 'assets/d34bb59d.jpg', '/Users/a/old.jpg', 99);
    expect(readAssetOrigin(root, 'assets/d34bb59d.jpg')?.importedAt).toBe(1);
    recordAssetOrigin(root, 'assets/d34bb59d.jpg', '/Users/a/new.jpg', 100);
    expect(readAssetOrigin(root, 'assets/d34bb59d.jpg')).toEqual({
      path: '/Users/a/new.jpg',
      importedAt: 100,
    });
  });

  test('past 10 000 entries the oldest are dropped', () => {
    const root = project();
    const origins: Record<string, { path: string; importedAt: number }> = {};
    for (let i = 0; i < MAX_ORIGINS; i++)
      origins[i.toString(16).padStart(8, '0')] = { path: '/Users/a/x.jpg', importedAt: i + 10 };
    mkdirSync(path.join(root, '_canvas-state'), { recursive: true });
    writeFileSync(path.join(root, ORIGINS_REL), JSON.stringify({ v: 1, origins }));
    recordAssetOrigin(root, 'assets/ffffffff.jpg', '/Users/a/new.jpg', 5_000_000);
    const doc = JSON.parse(readFileSync(path.join(root, ORIGINS_REL), 'utf8'));
    expect(Object.keys(doc.origins).length).toBe(MAX_ORIGINS);
    expect(doc.origins['00000000']).toBeUndefined();
    expect(doc.origins.ffffffff.path).toBe('/Users/a/new.jpg');
  });

  test('a damaged record reads as nothing known, and the next import repairs it', () => {
    const root = project();
    mkdirSync(path.join(root, '_canvas-state'), { recursive: true });
    writeFileSync(path.join(root, ORIGINS_REL), '{not json');
    expect(readAssetOrigin(root, 'assets/d34bb59d.jpg')).toBeNull();
    expect(recordAssetOrigin(root, 'assets/d34bb59d.jpg', '/Users/a/x.jpg')).toBe(true);
    expect(readAssetOrigin(root, 'assets/d34bb59d.jpg')?.path).toBe('/Users/a/x.jpg');
  });

  test('`maude design import-asset <file>` writes the record, and only into the per-Mac file', () => {
    const root = project();
    const src = path.join(root, 'from-finder.png');
    const png = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.from('hello origin'),
    ]);
    writeFileSync(src, png);
    const out = Bun.spawnSync(
      [
        'bun',
        'run',
        path.join(import.meta.dir, '../bin/_import-asset.mjs'),
        src,
        '--root',
        root,
        '--design-root',
        '.',
        '--kind',
        'raster',
        '--json',
      ],
      { env: { ...process.env, NO_OPEN: '1' } }
    );
    expect(out.exitCode).toBe(0);
    const [stored] = JSON.parse(out.stdout.toString()) as Array<{ path: string }>;
    expect(stored?.path).toMatch(/^assets\/[0-9a-f]{8}\.png$/);
    expect(readAssetOrigin(root, stored?.path as string)?.path).toBe(src);
    // the picture is in assets/; the path is in _canvas-state/ and nowhere else
    expect(readFileSync(path.join(root, ORIGINS_REL), 'utf8')).toContain(src);
    expect(readFileSync(path.join(root, stored?.path as string)).equals(png)).toBe(true);
  });

  test('home folders are shown as ~', () => {
    expect(homeShort('/Users/jonas/Pictures/x.heic', '/Users/jonas')).toBe('~/Pictures/x.heic');
    expect(homeShort('/Users/jonas', '/Users/jonas/')).toBe('~');
    expect(homeShort('/Volumes/Disk/x.heic', '/Users/jonas')).toBe('/Volumes/Disk/x.heic');
    expect(homeShort('/Users/jonasx/x.heic', '/Users/jonas')).toBe('/Users/jonasx/x.heic');
    expect(homeShort('/x.heic', undefined)).toBe('/x.heic');
  });
});
