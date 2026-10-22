// whats-new-seen.js — pure, browser-safe "what have I already seen?" logic.
//
// No React, no DOM, no node imports — so it's bundled into the client AND
// imported directly by bun:test (test/whats-new.test.ts). Keep it that way.

/** Parse a semver-ish string into a [major, minor, patch] triple, or null. */
export function parseVer(v) {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Is version `a` strictly newer than `b`?
 * - Unparseable `a` (e.g. "dev") → not newer (false).
 * - Unparseable `b` but parseable `a` → newer (true): a real release outranks
 *   a non-version "seen" marker, so the entry surfaces.
 */
export function verGt(a, b) {
  const pa = parseVer(a);
  const pb = parseVer(b);
  if (!pa) return false;
  if (!pb) return true;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

/**
 * Entries the user hasn't seen yet, given the version they last acknowledged.
 * A pending entry (version == null) is always unseen until acknowledged.
 */
export function computeUnseen(entries, seenVersion) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((e) => e && (e.version == null || verGt(e.version, seenVersion)));
}

/**
 * The version to persist as "seen" after the user reads the panel — the highest
 * of the current feed version and every entry's version. Stamping this clears
 * the unseen set (pending entries excepted — they have no version to outrank).
 */
export function bestSeenVersion(entries, currentVersion) {
  let best = currentVersion;
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e && e.version && verGt(e.version, best)) best = e.version;
    }
  }
  return best;
}

/**
 * Is "Take tour" offered for this entry? It needs spotlight steps AND an entry that has not been marked
 * `replayable: false` — those spotlight chrome that no longer exists (V2-7.3), so replaying one would
 * point at nothing. An absent field means replayable.
 */
export function canReplayTour(entry) {
  return (
    !!entry && Array.isArray(entry.tour) && entry.tour.length > 0 && entry.replayable !== false
  );
}

// ── one seen version per Mac (S6.6 / Q11) ────────────────────────────────────────────────────
// The mark lives in ui-prefs (`~/.config/maude/prefs.json`, field `whatsNewSeen`), so Home and every
// project tab agree; localStorage (`mdcc-whatsnew-seen`) was per port origin. The server only moves
// the stored mark forward (ui-prefs.ts writeUiPrefs).

/** The ui-prefs field that holds the mark. */
export const SEEN_PREF = 'whatsNewSeen';
/** The 1.x per-origin key — still written (a 1.x build on the same origin reads it), never cleared. */
export const LEGACY_SEEN_KEY = 'mdcc-whatsnew-seen';

/** Same grammar as ui-prefs.ts SEEN_VERSION_RE (the server refuses anything else). */
export function isSeenMark(v) {
  return (
    typeof v === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.+-]{1,40})?$/.test(v)
  );
}

/**
 * Which mark a surface uses, and what (if anything) it must store:
 *   a stored mark in ui-prefs → use it, write nothing (disk wins, fill-if-absent);
 *   else the old per-origin key → migrate it once;
 *   else a first-ever run → acknowledge the current version silently.
 */
export function resolveSeen({ stored, legacy, current }) {
  if (isSeenMark(stored)) return { seen: stored, write: null };
  if (isSeenMark(legacy)) return { seen: legacy, write: legacy };
  return { seen: current, write: isSeenMark(current) ? current : null };
}
