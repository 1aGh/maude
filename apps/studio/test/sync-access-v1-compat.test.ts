// S9.9 — hubs.json is shared by every Maude build on this Mac, and a 1.x build reads it too.
//
// 1.9.x knows ONE read-only answer: `record.role === 'viewer'` (its `isHubReadOnly`, frozen
// below verbatim). A v2 writer must therefore never leave a role there that 1.x reads as
// writable while v2 reads it as read-only — `observer` (Can view) stored as-is would be exactly
// that. So `role` holds the v1 projection and the real claim rides in the additive `access`
// key, which 1.x ignores (V2-1.7 Q3: no second 1.x release).
//
// And D3 (Phase 4 security): a record WITHOUT a role is read-only for v2 until a sign-in heals
// it — it used to count as writable.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { saveHubCredential } from '../sync/hub-link.ts';
import { accessFor, isHubReadOnly, normalizeUrl } from '../sync/hubs-config.ts';

/** apps/studio/sync/hubs-config.ts @ v1.9.1, verbatim apart from the explicit path. */
function frozenV1IsHubReadOnly(url: string, path: string): boolean {
  try {
    const record = JSON.parse(readFileSync(path, 'utf8')).hubs[normalizeUrl(url)];
    return record?.role === 'viewer';
  } catch {
    return false;
  }
}

const URL_ = 'https://p.cloud.maude.sh';
let dir = '';
const prevPath = process.env.HUBS_CONFIG_PATH;
const fresh = () => {
  dir = mkdtempSync(join(tmpdir(), 'maude-hubs-'));
  const path = join(dir, 'hubs.json');
  process.env.HUBS_CONFIG_PATH = path;
  return path;
};
afterEach(() => {
  if (prevPath === undefined) delete process.env.HUBS_CONFIG_PATH;
  else process.env.HUBS_CONFIG_PATH = prevPath;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('what v2 writes, 1.x reads the same way round', () => {
  for (const role of ['owner', 'member', 'admin', 'viewer', 'observer', 'guest']) {
    test(role, () => {
      const path = fresh();
      saveHubCredential(URL_, 'tok', role, undefined, path);
      const v2ReadOnly = isHubReadOnly(URL_);
      // v2 is never MORE permissive than the stored vouch, and 1.x never more than v2.
      expect([role, frozenV1IsHubReadOnly(URL_, path)]).toEqual([role, v2ReadOnly]);
    });
  }

  test('an observer survives the round trip as an observer for v2', () => {
    const path = fresh();
    saveHubCredential(URL_, 'tok', 'observer', undefined, path);
    const record = JSON.parse(readFileSync(path, 'utf8')).hubs[URL_];
    expect(record.role).toBe('viewer');
    expect(record.access).toEqual({ v: 1, role: 'observer' });
    const access = resolveAccess(accessFor(URL_));
    expect([access.role, access.can('comment', null), access.can('session', null)]).toEqual([
      'observer',
      false,
      true,
    ]);
  });

  test('a v1-expressible role adds no access key (byte-for-byte what 1.x wrote)', () => {
    const path = fresh();
    saveHubCredential(URL_, 'tok', 'member', undefined, path);
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).hubs[URL_]).sort()).toEqual([
      'linkedAt',
      'role',
      'token',
    ]);
  });
});

describe('D3 — a record without a role', () => {
  test('is read-only (the floor), not writable', () => {
    fresh();
    saveHubCredential(URL_, 'tok');
    expect(accessFor(URL_)).toEqual({ v: 1, role: 'observer' });
    expect(isHubReadOnly(URL_)).toBe(true);
  });

  test('a sign-in that vouches a role heals it', () => {
    fresh();
    saveHubCredential(URL_, 'tok');
    saveHubCredential(URL_, 'tok2', 'member');
    expect(isHubReadOnly(URL_)).toBe(false);
  });

  test('no record at all (a linked project with no credential here) edits, never owns', () => {
    fresh();
    const access = resolveAccess(accessFor(URL_));
    expect([access.can('edit', null), access.can('delete', null)]).toEqual([true, false]);
  });
});
