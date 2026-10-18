// S11.13 (Gate 0 D20) — the v2 prefs migration, seen from the person: ~40 old keys in, one run migrates,
// a second boot is a no-op, nothing is deleted, every 1.x key has a home or a named retirement, and the
// "seen" flags are re-keyed once (v2 `seen` starts empty and fills as tours are shown).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSeenStore,
  legacyHomes,
  migrateAtBoot,
  SEEN_REKEY,
} from '../client/v2/settings/prefs-migrate.js';
import { KEY_CLASS, LEGACY_VERSION_KEY } from '../ui-prefs-migrate.ts';

const STUDIO = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name: string) =>
  JSON.parse(readFileSync(join(STUDIO, 'test', 'fixtures', 'prefs-v1', name), 'utf8'));

/** The 30-key 1.x fixture plus the rest of the role family and a few canvas-origin / marker keys: ~40. */
function oldKeys(): Record<string, string> {
  const k: Record<string, string> = { ...fx('local.json') };
  for (const role of ['editor', 'commenter', 'guest', 'admin', 'billing', 'support', 'reviewer'])
    k[`maude-cloud-role-seen:${role}`] = '1';
  k['maude-annot-hints-v1'] = '7';
  k['maude-undo:ui/Home'] = '[]';
  k['maude-home-page-secret'] = 'x';
  return k;
}

class FakeStorage {
  map: Map<string, string>;
  constructor(init: Record<string, string>) {
    this.map = new Map(Object.entries(init));
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** An in-memory /_api/ui-prefs: GET returns the file, POST merges top-level fields like the server. */
function fakeDisk(initial: Record<string, unknown> = {}) {
  let disk: Record<string, unknown> = { ...initial };
  const reqs: Array<{ method: string; body?: unknown }> = [];
  const fetchImpl = (async (_url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    reqs.push({ method, body: init?.body ? JSON.parse(init.body) : undefined });
    if (method === 'POST') {
      disk = { ...disk, ...JSON.parse(init?.body ?? '{}') };
      return new Response('{"ok":true}', { status: 200 });
    }
    return new Response(JSON.stringify(disk), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, reqs, get: () => disk };
}

describe('every 1.x key has a v2 home or a named retirement', () => {
  const rows = legacyHomes();

  test('one row per classified key, each with exactly one of home / retired', () => {
    expect(rows.map((r) => r.key).sort()).toEqual(Object.keys(KEY_CLASS).sort());
    for (const r of rows) {
      expect(Boolean(r.home) !== Boolean(r.retired), r.key).toBe(true);
      expect((r.home || r.retired || '').length, r.key).toBeGreaterThan(3);
    }
  });

  test('the carried preferences name their prefs.json field; the retired ones say why', () => {
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['mdcc-theme'].home).toBe('prefs.json theme');
    expect(by['mdcc-sidebar-open'].home).toBe('prefs.json panelsHidden');
    expect(by['maude-cp-mode'].retired).toContain('Designer');
    expect(by['mdcc-settings-tab'].retired).toContain('7-tab');
    expect(by['maude-browse-hint-seen'].class).toBe('dead');
  });

  test('the three seen flags are re-keyed to named v2 ids', () => {
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    for (const [oldKey, id] of Object.entries(SEEN_REKEY))
      expect(by[oldKey].home, oldKey).toBe(`prefs.json seen.${id}`);
  });
});

describe('migrateAtBoot — about 40 old keys', () => {
  test('the fixture is about forty keys', () => {
    expect(Object.keys(oldKeys()).length).toBeGreaterThanOrEqual(38);
  });

  test('first boot migrates once; the second boot makes no request at all', async () => {
    const storage = new FakeStorage(oldKeys());
    const disk = fakeDisk();
    const first = await migrateAtBoot({ storage, fetchImpl: disk.fetchImpl });
    expect(first.status).toBe('migrated');
    // disk now holds the migrated v2 file: theme, sides, the sidebar inversion
    const after = disk.get() as Record<string, unknown>;
    expect(after.theme).toBe('light');
    expect(after.panelsHidden).toBe(true);
    expect(after.layersMode).toBe('in-inspector');
    expect(after.version).toBe(2);
    // seen flags are not carried: v2 `seen` starts empty
    expect(after.seen).toEqual({});

    const n = disk.reqs.length;
    const second = await migrateAtBoot({ storage, fetchImpl: disk.fetchImpl });
    expect(second.status).toBe('already');
    expect(disk.reqs.length).toBe(n);
  });

  test('a second RUN over the same keys (marker cleared) writes nothing', async () => {
    const storage = new FakeStorage(oldKeys());
    const disk = fakeDisk();
    await migrateAtBoot({ storage, fetchImpl: disk.fetchImpl });
    const snapshot = JSON.stringify(disk.get());
    storage.removeItem(LEGACY_VERSION_KEY);
    const posts = disk.reqs.filter((r) => r.method === 'POST').length;
    const again = await migrateAtBoot({ storage, fetchImpl: disk.fetchImpl });
    expect(again.status).toBe('migrated');
    expect(JSON.stringify(disk.get())).toBe(snapshot);
    expect(disk.reqs.filter((r) => r.method === 'POST').length).toBe(posts);
  });

  test('nothing is deleted: every old key is still in storage afterwards', async () => {
    const keys = oldKeys();
    const storage = new FakeStorage(keys);
    await migrateAtBoot({ storage, fetchImpl: fakeDisk().fetchImpl });
    for (const k of Object.keys(keys)) expect(storage.getItem(k), k).toBe(keys[k]);
  });

  test('a failed disk read leaves the marker unset, so the next boot retries', async () => {
    const storage = new FakeStorage(oldKeys());
    const bad = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    const r = await migrateAtBoot({ storage, fetchImpl: bad });
    expect(r.status).toBe('error');
    expect(storage.getItem(LEGACY_VERSION_KEY)).toBeNull();
  });
});

describe('the v2 seen store', () => {
  test('marks an id once, persists only the key that changed, and a reload remembers it', () => {
    const writes: unknown[] = [];
    const s = createSeenStore({ persist: (p) => writes.push(p) });
    expect(s.has('usage-tour')).toBe(false);
    expect(s.mark('usage-tour')).toBe(true);
    expect(s.mark('usage-tour')).toBe(false);
    expect(writes).toEqual([{ seen: { 'usage-tour': true } }]);
    const fresh = createSeenStore();
    fresh.hydrate({ seen: { 'usage-tour': true, 'mode-hint': 'yes' } });
    expect(fresh.has('usage-tour')).toBe(true);
    expect(fresh.has('mode-hint')).toBe(false); // only `true` counts
  });
});
