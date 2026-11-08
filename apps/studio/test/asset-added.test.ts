// #172 — who added an asset travels with the project: `assets/<sha8>.added.json` (contract 172-asset-origins.md).

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ADDED_SUFFIX,
  addedByName,
  addedRelOf,
  readAssetAdded,
  recordAssetAdded,
} from '../asset-added.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset-added-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('the record sits beside its asset, named by the asset stem', () => {
  expect(ADDED_SUFFIX).toBe('.added.json');
  expect(addedRelOf('assets/d34bb59d.jpg')).toBe('assets/d34bb59d.added.json');
  expect(addedRelOf('assets/d34bb59d')).toBe('assets/d34bb59d.added.json');
  // a renamed asset keeps its record: the sidecar moves with the stem (asset-trash sidecarsOf)
  expect(addedRelOf('assets/hero.png')).toBe('assets/hero.added.json');
  expect(addedRelOf('assets/../x/d34bb59d.png')).toBeNull();
  expect(addedRelOf('assets/x/d34bb59d.png')).toBeNull();
  expect(addedRelOf('assets/.hidden.png')).toBeNull();
  expect(addedRelOf('ui/d34bb59d.png')).toBeNull();
});

test('a display name is written and read back; never a path, never an e-mail', () => {
  expect(recordAssetAdded(root, 'assets/d34bb59d.jpg', 'Tereza', Date.UTC(2026, 10, 8, 9))).toBe(
    true
  );
  const j = JSON.parse(readFileSync(join(root, 'assets', 'd34bb59d.added.json'), 'utf8'));
  expect(j).toEqual({ format: 'maude.added', v: 1, by: 'Tereza', at: '2026-11-08T09:00:00.000Z' });
  expect(readAssetAdded(root, 'assets/d34bb59d.jpg')).toEqual({
    by: 'Tereza',
    at: '2026-11-08T09:00:00.000Z',
  });
});

test('write-once: the first person who brought the bytes in stays', () => {
  recordAssetAdded(root, 'assets/d34bb59d.jpg', 'Tereza');
  expect(recordAssetAdded(root, 'assets/d34bb59d.jpg', 'Jonas')).toBe(false);
  expect(readAssetAdded(root, 'assets/d34bb59d.jpg')?.by).toBe('Tereza');
});

test('an e-mail is reduced to the words of its local part; nothing left writes nothing', () => {
  expect(addedByName('tereza.novak@example.com')).toBe('Tereza Novak');
  expect(addedByName('  Jonas  ')).toBe('Jonas');
  expect(addedByName('@example.com')).toBeNull();
  expect(addedByName('local:abc')).toBeNull();
  expect(addedByName('a\u0007b')).toBeNull();
  expect(addedByName('x'.repeat(200))?.length).toBeLessThanOrEqual(80);
  expect(recordAssetAdded(root, 'assets/d34bb59d.jpg', '')).toBe(false);
  expect(existsSync(join(root, 'assets', 'd34bb59d.added.json'))).toBe(false);
});

test('the reader treats synced text as untrusted', () => {
  const f = join(root, 'assets', 'd34bb59d.added.json');
  const read = () => readAssetAdded(root, 'assets/d34bb59d.png');
  writeFileSync(f, JSON.stringify({ format: 'maude.added', v: 1, by: 'eve@evil.test' }));
  expect(read()).toBeNull();
  writeFileSync(f, JSON.stringify({ format: 'maude.added', v: 2, by: 'Tereza' }));
  expect(read()).toBeNull();
  writeFileSync(f, JSON.stringify({ format: 'maude.gen', v: 1, by: 'Tereza' }));
  expect(read()).toBeNull();
  writeFileSync(f, JSON.stringify({ format: 'maude.added', v: 1, by: 'Tereza', extra: 1 }));
  expect(read()).toEqual({ by: 'Tereza' }); // unknown keys kept on disk, ignored here; a bad `at` is dropped
  writeFileSync(f, `{"format":"maude.added","v":1,"by":"T","pad":"${'x'.repeat(5000)}"}`);
  expect(read()).toBeNull(); // past the 4 KiB cap
  writeFileSync(f, 'not json');
  expect(read()).toBeNull();
});
