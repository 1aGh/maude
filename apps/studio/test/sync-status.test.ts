// Sync status store tests — Phase 9 Task 8.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SyncStatusSnapshot } from '../sync/connection-state.ts';
import { createSyncStatusStore, type SyncStatusPayload } from '../sync/status.ts';

function snap(partial: Partial<SyncStatusSnapshot> = {}): SyncStatusSnapshot {
  return {
    state: 'online',
    queuedOps: 0,
    lastSyncAt: null,
    offlineSince: null,
    flash: null,
    updatedAt: 1,
    ...partial,
  };
}

function makeStore() {
  const writes: SyncStatusPayload[] = [];
  const broadcasts: SyncStatusPayload[] = [];
  const store = createSyncStatusStore({
    url: 'https://hub.example.com',
    canvases: 3,
    write: (p) => writes.push(p),
    broadcast: (p) => broadcasts.push(p),
    now: () => 42,
  });
  return { store, writes, broadcasts };
}

describe('sync status store', () => {
  test('update() writes + broadcasts the merged payload', () => {
    const { store, writes, broadcasts } = makeStore();
    store.update(snap({ state: 'offline', queuedOps: 2 }));
    expect(writes).toHaveLength(1);
    expect(broadcasts).toHaveLength(1);
    expect(writes[0].state).toBe('offline');
    expect(writes[0].queuedOps).toBe(2);
    expect(writes[0].url).toBe('https://hub.example.com');
    expect(writes[0].canvases).toBe(3);
    expect(writes[0].conflicts).toEqual([]);
  });

  test('addConflict() appends a stamped conflict + reflects in get()', () => {
    const { store } = makeStore();
    store.addConflict({ slug: 'screen', kind: 'cold-start-hub-wins' });
    const p = store.get();
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0]).toEqual({ slug: 'screen', kind: 'cold-start-hub-wins', at: 42 });
  });

  test('conflict list is capped at maxConflicts (drops oldest)', () => {
    const writes: SyncStatusPayload[] = [];
    const store = createSyncStatusStore({
      url: 'https://h',
      canvases: 1,
      write: (p) => writes.push(p),
      maxConflicts: 2,
      now: () => 1,
    });
    store.addConflict({ slug: 'a', kind: 'git-pull' });
    store.addConflict({ slug: 'b', kind: 'git-pull' });
    store.addConflict({ slug: 'c', kind: 'git-pull' });
    const p = store.get();
    expect(p.conflicts.map((c) => c.slug)).toEqual(['b', 'c']);
  });

  test('a throwing writer never propagates into the caller', () => {
    const store = createSyncStatusStore({
      url: 'https://h',
      canvases: 1,
      write: () => {
        throw new Error('disk full');
      },
    });
    expect(() => store.update(snap({ state: 'offline' }))).not.toThrow();
  });
});

// DDR-102 — the payload carries the per-doc rollup + rich conflicts additively.
describe('sync status store — DDR-102 additive fields', () => {
  test('docs + rejectedSlugs flow through update() into the payload', () => {
    const writes: SyncStatusPayload[] = [];
    const store = createSyncStatusStore({
      url: 'https://h.example.com',
      canvases: 3,
      write: (p) => writes.push(p),
    });
    store.update({
      state: 'online',
      queuedOps: 0,
      lastSyncAt: 123,
      offlineSince: null,
      flash: null,
      updatedAt: 456,
      docs: { synced: 1, pending: 0, rejected: 2 },
      rejectedSlugs: ['ui-x', 'ui-y'],
    });
    const p = store.get();
    expect(p.docs).toEqual({ synced: 1, pending: 0, rejected: 2 });
    expect(p.rejectedSlugs).toEqual(['ui-x', 'ui-y']);
    expect(p.lastSyncAt).toBe(123);
  });

  test('addConflict carries winner + snapshots (cold-start-diverged)', () => {
    const store = createSyncStatusStore({
      url: 'https://h.example.com',
      canvases: 1,
      write: () => {},
      now: () => 999,
    });
    store.addConflict({
      slug: 'ui-maskot',
      kind: 'cold-start-diverged',
      winner: 'local',
      snapshots: { local: '2026-06-11T10:00:00.000Z', hub: '2026-06-11T10:00:00.001Z' },
    });
    const c = store.get().conflicts[0];
    expect(c.kind).toBe('cold-start-diverged');
    expect(c.winner).toBe('local');
    expect(c.snapshots?.local).toBe('2026-06-11T10:00:00.000Z');
    expect(c.at).toBe(999);
  });

  test('old-shape payload readers: a snapshot WITHOUT docs/rejectedSlugs still works', () => {
    const store = createSyncStatusStore({
      url: 'https://h.example.com',
      canvases: 1,
      write: () => {},
    });
    store.update({
      state: 'online',
      queuedOps: 0,
      lastSyncAt: null,
      offlineSince: null,
      flash: null,
      updatedAt: 1,
    });
    const p = store.get();
    expect(p.docs).toBeUndefined();
    expect(p.rejectedSlugs).toBeUndefined();
    expect(p.state).toBe('online');
  });
});

describe('sync status store — asset lane (feature-sync-progress-modal)', () => {
  test('updateAssets() merges progress into the payload + flushes', () => {
    const { store, writes, broadcasts } = makeStore();
    const progress = {
      total: 10,
      done: 4,
      pushed: 3,
      skipped: 1,
      failedCount: 0,
      failures: [],
      active: 'assets/hero.png',
      finished: false,
    };
    store.updateAssets(progress);
    expect(writes[writes.length - 1].assets).toEqual(progress);
    expect(broadcasts[broadcasts.length - 1].assets).toEqual(progress);
    // …and a later monitor update keeps the asset lane (separate slices).
    store.update(snap({ state: 'online' }));
    expect(store.get().assets).toEqual(progress);
  });

  test('payloads before the first asset emit carry no assets field', () => {
    const { store } = makeStore();
    store.update(snap());
    expect('assets' in store.get()).toBe(false);
  });

  test('updateFiles() merges the file plane into the payload + flushes', () => {
    // feature-sync-file-plane — same slice discipline as assets: a lane, not
    // a connection, surviving later monitor updates untouched.
    const { store, writes, broadcasts } = makeStore();
    const files = { synced: 103, pulled: 103, conflicts: 1 };
    store.updateFiles(files);
    expect(writes[writes.length - 1].files).toEqual(files);
    expect(broadcasts[broadcasts.length - 1].files).toEqual(files);
    store.update(snap({ state: 'online' }));
    expect(store.get().files).toEqual(files);
  });

  test('payloads before the first file-plane emit carry no files field', () => {
    const { store } = makeStore();
    store.update(snap());
    expect('files' in store.get()).toBe(false);
  });
});

describe('held breakers reach the status payload', () => {
  // Between the plane and the panel sits `noteFilePlane`, which is where the
  // holds were being dropped: it read synced/pulled/conflicts/pushed/delivery
  // and nothing else, so the fields existed and never travelled.
  test('the FilePlaneStatus shape carries them', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'sync', 'status.ts'), 'utf8');
    expect(src).toContain('held?:');
    expect(src).toMatch(/'delete-out' \| 'delete-in' \| 'first-anchor' \| 'reanchor'/);
  });

  test('and the sync runtime actually fills it in', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'sync', 'index.ts'), 'utf8');
    expect(src).toContain('result.deleteHeld');
    expect(src).toContain('result.firstAnchorHeld');
    expect(src).toContain('result.reanchorHeld');
    // And the first-anchor hold has an ANSWER wired, not just a report.
    expect(src).toContain('resolveFirstAnchor');
  });
});

describe('sync status store — consent notices (feature-before-first-external-users T1)', () => {
  test('notice() lands in the payload, stamped, and persists + broadcasts', () => {
    const { store, writes } = makeStore();
    store.notice({ id: 'shared-doc', severity: 'warn', text: 'shared-doc is ON' });
    const p = store.get();
    expect(p.notices).toEqual([
      { id: 'shared-doc', severity: 'warn', text: 'shared-doc is ON', at: 42 },
    ]);
    expect(writes.at(-1)?.notices).toHaveLength(1);
  });

  test('notice() is idempotent by id — a repeat neither duplicates nor re-flushes', () => {
    const { store, writes } = makeStore();
    store.notice({ id: 'tsx-bodies', severity: 'warn', text: 'first' });
    const flushesAfterFirst = writes.length;
    store.notice({ id: 'tsx-bodies', severity: 'warn', text: 'second (ignored)' });
    expect(store.get().notices).toHaveLength(1);
    expect(store.get().notices?.[0]?.text).toBe('first');
    expect(writes.length).toBe(flushesAfterFirst);
  });

  test('old-shape readers: a payload with no notices simply omits the field', () => {
    const { store } = makeStore();
    expect('notices' in store.get()).toBe(false);
  });

  test('the A7 sites route through the store, not only console.warn (source pin)', () => {
    // The regression this task exists for: both consent notices lived ONLY in
    // console.warn. Pin that the notice sites reach store.notice with the two
    // stable ids the SyncPanel dismiss ack keys on.
    const src = readFileSync(join(import.meta.dir, '../sync/index.ts'), 'utf8');
    expect(src).toMatch(/store\.notice\(\{\s*id: 'tsx-bodies'/);
    expect(src).toMatch(/store\.notice\(\{\s*id: 'shared-doc'/);
  });
});

describe('F-12 (post-1.0 burn-down) — the reconnect trigger is cooled', () => {
  test('a reconnect-driven poll goes through the cooldown, not around it', () => {
    // A hub that churns the WebSocket drives reconnects at its own pace; the
    // poke cooldown never saw that trigger. The cooled path keeps a genuine
    // one-off reconnect immediate (nothing poked recently ⇒ runs at once) and
    // folds a churn into the scheduled tick.
    const src = readFileSync(join(import.meta.dir, '../sync/index.ts'), 'utf8');
    // The reconnect branch gained a second statement (issue #118 — the document
    // re-promotion), so this pins the two facts rather than one line's exact
    // text: the trigger is still the disconnected→connected edge, and the poll
    // it fires is still the COOLED one.
    expect(src).toMatch(/if \(s === 'connected' && wasDisconnected\) \{/);
    expect(src).toMatch(/pollRemoteSoon\(\{ cooled: true \}\);/);
  });

  test('the same edge also re-establishes per-DOCUMENT truth (issue #118)', () => {
    // The cooled poll asks the hub what canvases EXIST. It says nothing about
    // whether this document is synced again — and for a long time nothing did,
    // which is how `state:"online", docs:{synced:0,pending:85}` survived.
    const src = readFileSync(join(import.meta.dir, '../sync/index.ts'), 'utf8');
    expect(src).toMatch(/void repromoteOnReconnect\(canvas\.slug, provider\);/);
  });
});

test('#121 clearing a recovered source warning preserves consent notices', () => {
  const { store, writes } = makeStore();
  store.notice({ id: 'shared-doc', severity: 'warn', text: 'shared doc' });
  store.notice({ id: 'source-conflict-screen', severity: 'warn', text: 'blocked' });
  store.clearSourceConflict('screen');
  expect(store.get().notices?.map((n) => n.id)).toEqual(['shared-doc']);
  expect(writes.at(-1)?.notices?.map((n) => n.id)).toEqual(['shared-doc']);
});
