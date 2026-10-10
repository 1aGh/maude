// prefs-migrate.js — the client half of the prefs migration (Gate 0 D20, plan V2-2.7).
//
// Takes a snapshot of this origin's 1.x localStorage keys, hands it and the durable prefs.json
// (GET /_api/ui-prefs) to the pure core in ../ui-prefs-migrate.ts, and POSTs only the top-level
// fields that changed. It writes ONE new localStorage key (the per-origin marker) and deletes
// nothing: a 1.x build on the same machine still reads every old key.
//
// EXPORTED, NOT CALLED in Phase 2. The v1 UI still owns the old keys and nothing reads the v2
// homes until V2-4.x, so wiring this in now would only seed stale state. The call site is
// `migrateLocalPrefs()` at boot, before the first read of a v2 home — Phase 4's ownership flip.

import {
  diffPrefs,
  isLegacyKey,
  LEGACY_VERSION_KEY,
  migratePrefs,
  PREFS_VERSION,
} from '../ui-prefs-migrate.ts';

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Every classified 1.x key this origin holds (the role family included), as stored strings. */
export function snapshotLegacyKeys(storage) {
  const out = {};
  if (!storage) return out;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && isLegacyKey(k)) out[k] = storage.getItem(k);
    }
  } catch {
    /* blocked storage: migrate from disk alone */
  }
  return out;
}

/**
 * Run the migration once per origin.
 * @returns {Promise<{status: 'already'} | {status: 'error', error: string} | {status: 'migrated', report: object, delta: object}>}
 */
export async function migrateLocalPrefs({ storage = defaultStorage(), fetchImpl = fetch } = {}) {
  const want = String(PREFS_VERSION);
  try {
    if (storage?.getItem(LEGACY_VERSION_KEY) === want) return { status: 'already' };
  } catch {
    /* unreadable marker: fall through, the migration is idempotent */
  }
  try {
    const r = await fetchImpl('/_api/ui-prefs');
    if (!r.ok) return { status: 'error', error: `GET ${r.status}` };
    const disk = await r.json();
    const { disk2, report } = migratePrefs({ disk, local: snapshotLegacyKeys(storage) });
    const delta = diffPrefs(disk, disk2);
    if (Object.keys(delta).length > 0) {
      // text/plain, like persistUiPrefs: a simple request, guarded by sameOriginWrite server-side.
      const w = await fetchImpl('/_api/ui-prefs', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(delta),
      });
      if (!w.ok) return { status: 'error', error: `POST ${w.status}` };
    }
    // Only after the durable write succeeded: a failure above retries on the next boot.
    try {
      storage?.setItem(LEGACY_VERSION_KEY, want);
    } catch {
      /* the migration is idempotent, so a missing marker only costs a repeat GET */
    }
    return { status: 'migrated', report, delta };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
