// #172 — who added an asset travels with the project: `assets/<sha8>.added.json` (contract 172-asset-origins.md).

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ADDED_SUFFIX,
  addedByName,
  addedRelOf,
  legacyAddedRelOf,
  readAssetAdded,
  recordAssetAdded,
} from '../asset-added.ts';
import { cleanOriginBy } from '../asset-origins.ts';
import { sidecarsOf } from '../asset-trash.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset-added-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('the record sits beside its asset, named by the asset’s full file name', () => {
  expect(ADDED_SUFFIX).toBe('.added.json');
  expect(addedRelOf('assets/d34bb59d.jpg')).toBe('assets/d34bb59d.jpg.added.json');
  expect(addedRelOf('assets/d34bb59d')).toBe('assets/d34bb59d.added.json');
  // two assets sharing a stem never share a record (burndown F6)
  expect(addedRelOf('assets/logo.png')).toBe('assets/logo.png.added.json');
  expect(addedRelOf('assets/logo.v2.svg')).toBe('assets/logo.v2.svg.added.json');
  // the older stem-keyed name, still read for an asset no other one shares a stem with
  expect(legacyAddedRelOf('assets/logo.v2.svg')).toBe('assets/logo.added.json');
  expect(addedRelOf('assets/../x/d34bb59d.png')).toBeNull();
  expect(addedRelOf('assets/x/d34bb59d.png')).toBeNull();
  expect(addedRelOf('assets/.hidden.png')).toBeNull();
  expect(addedRelOf('ui/d34bb59d.png')).toBeNull();
});

test('a display name is written and read back; never a path, never an e-mail', () => {
  expect(recordAssetAdded(root, 'assets/d34bb59d.jpg', 'Tereza', Date.UTC(2026, 10, 8, 9))).toBe(
    true
  );
  const j = JSON.parse(readFileSync(join(root, 'assets', 'd34bb59d.jpg.added.json'), 'utf8'));
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
  expect(existsSync(join(root, 'assets', 'd34bb59d.jpg.added.json'))).toBe(false);
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

const put = (name: string, text = 'x') => writeFileSync(join(root, 'assets', name), text);
const record = (by: string) => JSON.stringify({ format: 'maude.added', v: 1, by });

test('F6: a record for logo.v2.svg never says who added logo.png', () => {
  put('logo.png');
  put('logo.v2.svg', '<svg/>');
  expect(recordAssetAdded(root, 'assets/logo.v2.svg', 'Mallory')).toBe(true);
  expect(readAssetAdded(root, 'assets/logo.png')).toBeNull();
  expect(recordAssetAdded(root, 'assets/logo.png', 'Tereza')).toBe(true);
  expect(readAssetAdded(root, 'assets/logo.png')?.by).toBe('Tereza');
  expect(readAssetAdded(root, 'assets/logo.v2.svg')?.by).toBe('Mallory');
});

test('F6 migration: an older stem-keyed record is still read — unless two assets share the stem', () => {
  put('d34bb59d.jpg');
  put('d34bb59d.added.json', record('Tereza'));
  expect(readAssetAdded(root, 'assets/d34bb59d.jpg')?.by).toBe('Tereza');
  // write-once holds across the two names: the older record is the first person
  expect(recordAssetAdded(root, 'assets/d34bb59d.jpg', 'Jonas')).toBe(false);
  expect(existsSync(join(root, 'assets', 'd34bb59d.jpg.added.json'))).toBe(false);
  // a stem two assets share: whose record it is cannot be told, so neither says it
  put('logo.png');
  put('logo.v2.svg', '<svg/>');
  put('logo.added.json', record('Mallory'));
  expect(readAssetAdded(root, 'assets/logo.png')).toBeNull();
  expect(readAssetAdded(root, 'assets/logo.v2.svg')).toBeNull();
  // and a new record is written under the full name
  expect(recordAssetAdded(root, 'assets/logo.png', 'Tereza')).toBe(true);
  expect(readAssetAdded(root, 'assets/logo.png')?.by).toBe('Tereza');
});

test('F6: the full-name record rides with its asset (trash and rename), the other asset’s does not', () => {
  put('logo.png');
  put('logo.v2.svg', '<svg/>');
  recordAssetAdded(root, 'assets/logo.png', 'Tereza');
  recordAssetAdded(root, 'assets/logo.v2.svg', 'Jonas');
  expect(sidecarsOf(root, 'assets/logo.png')).toEqual(['assets/logo.png.added.json']);
  expect(sidecarsOf(root, 'assets/logo.v2.svg')).toEqual(['assets/logo.v2.svg.added.json']);
});

test('L4: a name loses bidi, zero-width and tag characters before it is shown', () => {
  expect(cleanOriginBy('Te\u202ereza')).toBe('Tereza');
  expect(cleanOriginBy('\u200bTe\u200dreza\ufeff')).toBe('Tereza');
  expect(cleanOriginBy('Tereza\u{e0041}\u2066')).toBe('Tereza');
  expect(cleanOriginBy('\u202e\u200b')).toBeNull();
  put('d34bb59d.jpg');
  put('d34bb59d.jpg.added.json', record('Eve\u202egnp.exe'));
  expect(readAssetAdded(root, 'assets/d34bb59d.jpg')?.by).toBe('Evegnp.exe');
});
