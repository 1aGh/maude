// home/whats-new.ts — the What's New feed on Home, with the ONE seen mark per Mac (S6.6 / Q11).
//
//   GET  /_home/whats-new  → { version, entries, seen }   (seen: ui-prefs `whatsNewSeen`, or null)
//   POST /_home/whats-new  { seen }                        → stores it (forward only)
//
// The mark is the same field a project tab writes through /_api/ui-prefs, so Home and every tab
// agree. Home never invents a mark: with none stored it answers `seen: null` and the page decides
// (a project tab seeds it from its old per-origin key, or a first run's current version).

import { readUiPrefs, validateUiPrefsPatch, writeUiPrefs } from '../ui-prefs.ts';
import { loadWhatsNew, type WhatsNewFeed } from '../whats-new.ts';
import type { HomeAnswer } from './signin.ts';

export interface HomeWhatsNew {
  get(): HomeAnswer;
  post(body: unknown): HomeAnswer;
}

export function createHomeWhatsNew(opts: { feed?: () => WhatsNewFeed } = {}): HomeWhatsNew {
  const feed = opts.feed ?? (() => loadWhatsNew());
  return {
    get() {
      const f = feed();
      const seen = readUiPrefs().whatsNewSeen;
      return {
        status: 200,
        body: {
          version: f.version,
          entries: f.entries,
          seen: typeof seen === 'string' ? seen : null,
        },
      };
    },
    post(body) {
      const seen = body && typeof body === 'object' ? (body as { seen?: unknown }).seen : undefined;
      const checked = validateUiPrefsPatch({ whatsNewSeen: seen });
      if (!checked.ok) return { status: 400, body: { ok: false, error: checked.error } };
      const next = writeUiPrefs(checked.patch);
      return { status: 200, body: { ok: true, seen: next.whatsNewSeen ?? null } };
    },
  };
}
