// client/v2/settings/prefs-migrate.js — S11.13 (Gate 0 D20): the v2 side of "every 1.x preference key
// has a v2 home or a named retirement".
//
// The pure core (ui-prefs-migrate.ts: KEY_CLASS, migratePrefs) and the once-per-origin adapter
// (../../prefs-migrate.js: migrateLocalPrefs) shipped in V2-2.7 and were deliberately not called. This file
// is what makes them callable from the shell and checkable by a person:
//
//   legacyHomes()        one row per 1.x key: where its value lives now, or why it was retired
//   migrateAtBoot()      runs the adapter once; a second boot is a no-op (the per-origin marker)
//   createSeenStore()    prefs.json `seen`: the v2 "seen" flags, keyed by the v2 ids below
//
// "Seen" flags are re-keyed ONCE and not carried: the three 1.x tour / hint flags have v2 ids, and v2
// `seen` starts empty, so every upgrader meets each v2 tour a single time (migratePrefs rule, D20).
// Nothing here deletes a 1.x key: a 1.x build on the same Mac keeps working.
//
// Call site: `migrateAtBoot()` before the first read of a v2 home. app.jsx is the lead's — patch request.

import { KEY_CLASS, LEGACY_VERSION_KEY } from '../../../ui-prefs-migrate.ts';
import { migrateLocalPrefs } from '../../prefs-migrate.js';

/** The 1.x "seen" flags and the v2 `seen` id each one is re-keyed to. */
export const SEEN_REKEY = Object.freeze({
  'mdcc-usage-tour-seen': 'usage-tour',
  'mdcc-collab-tour-seen': 'collab-tour',
  'maude-mode-hint-seen': 'mode-hint',
});

/** Where a 1.x preference that stays in this browser is found now. */
const KEPT_WHERE = Object.freeze({
  'mdcc-whatsnew-seen': 'What’s New (version watermark, unchanged)',
  'mdcc-whatsnew-toast-dismissed': 'What’s New (version watermark, unchanged)',
  'maude-cloud-role-seen:*': 'Cloud role line (unchanged)',
  'maude-sync-consent': 'Connections › sync consent (unchanged)',
  'maude-sync-notice-ack': 'Connections › sync notices (unchanged)',
  'maude-acp-picks': 'AI chat model / effort / mode picks (unchanged)',
  'maude-acp-transcript-view': 'AI chat transcript view (unchanged)',
  'maude-install-id': 'Bug reports (anonymous install id, never re-keyed)',
});

/**
 * One row per key the code can touch.
 * @returns {Array<{ key: string, class: string, home: string | null, retired: string | null }>}
 *   Exactly one of `home` / `retired` is a string: a key is either carried somewhere or named as retired.
 */
export function legacyHomes() {
  return Object.entries(KEY_CLASS).map(([key, rule]) => {
    let home = null;
    let retired = null;
    switch (rule.class) {
      case 'migrate':
        home = `prefs.json ${rule.to}`;
        break;
      case 'rekeyed':
        home = `prefs.json seen.${SEEN_REKEY[key] ?? key}`;
        break;
      case 'kept':
        home = KEPT_WHERE[key] ?? 'unchanged in this browser';
        break;
      case 'canvas-origin':
        home = 'the canvas origin (not a shell preference)';
        break;
      case 'home-origin':
        home = 'the Home window (not a shell preference)';
        break;
      case 'v2-new':
        home = 'this browser (a v2 setting; nothing to carry over)';
        break;
      case 'marker':
        home = 'this browser (the migration’s own marker)';
        break;
      default: // dropped · dead
        retired = rule.note || `${rule.class}: nothing reads or writes it any more`;
    }
    return { key, class: rule.class, home, retired };
  });
}

/**
 * Run the migration for this origin. `{ status: 'migrated' | 'already' | 'error' }` — a second call
 * with the marker in place returns `already` without a single request.
 */
export function migrateAtBoot(opts = {}) {
  return migrateLocalPrefs(opts);
}

/** prefs.json `seen` (a map `{ id: true }`; the server merges by key). Pure: persistence is injected. */
export function createSeenStore({ persist = () => {} } = {}) {
  const seen = new Set();
  const touched = new Set();
  const subs = new Set();
  const notify = () => {
    for (const fn of subs) fn();
  };
  return {
    has: (id) => seen.has(id),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** Remember that `id` was shown. Returns true when this is the first time. */
    mark(id) {
      touched.add(id);
      if (seen.has(id)) return false;
      seen.add(id);
      try {
        persist({ seen: { [id]: true } });
      } catch {
        /* no prefs file: it lives for the page */
      }
      notify();
      return true;
    },
    /** Adopt the disk `seen` map without writing it back. */
    hydrate(prefs) {
      const m = prefs?.seen;
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      let changed = false;
      for (const id of Object.keys(m)) {
        if (m[id] === true && !seen.has(id)) {
          seen.add(id);
          changed = true;
        }
      }
      if (changed) notify();
    },
  };
}

export { LEGACY_VERSION_KEY };
