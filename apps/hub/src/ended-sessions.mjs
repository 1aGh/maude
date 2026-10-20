// The cell's memory of sessions an access notice ended — S9.21d (decision
// v2-lead-browser-link-off-via-refusal).
//
// Access notices reach desktop shells only (S9.21b). A plain-browser viewer on
// a cell learns that its access ended from its NEXT request instead: the
// cookie names a session the notice just ended, and the studio door's 401
// says why — `link-off` (the link they came in on was turned off) or
// `access-withdrawn` (removed; `expired` stays itself). The browser shell maps
// it through `accessOutcome()` to the link card or the access card.
//
// What keeps it from being an oracle:
//   • It is keyed by the at-rest digest of the ended session's own token, so
//     only the cookie that held that session hears the reason. An unknown or
//     forged cookie, another person's cookie and every LIVE session (a
//     canvas-only one included) get exactly today's answer.
//   • Only an `ended` notice writes it. A narrowing leaves the person with
//     access; their session still ends, and they simply sign in again.
//   • Each entry dies when the session it names would have expired anyway.
//
// In memory on purpose: a cell restart forgets, and the answer falls back to
// today's plain 401 (sign in again → the control plane says no). Nothing here
// is persisted, synced or versioned.

import { STUDIO_SESSION_TTL_MS } from './browser-auth.mjs';
import { digestToken, listTokenDigestsForOwner } from './tokens.mjs';

/** The refusal reasons this memo can answer — the ones `accessOutcome()` reads. */
export const ENDED_REFUSAL_REASONS = Object.freeze(['link-off', 'access-withdrawn', 'expired']);

/** A bound on remembered sessions; the oldest go first. */
const CAP = 5000;

/** dataDir → Map(digest → { reason, until }) */
const memo = new Map();

const bucket = (dataDir) => {
  let m = memo.get(dataDir);
  if (!m) {
    m = new Map();
    memo.set(dataDir, m);
  }
  return m;
};

/** An `ended` notice's reason → the refusal reason its session's cookie hears. */
export function endedRefusalReason(noticeReason) {
  if (noticeReason === 'link-off') return 'link-off';
  if (noticeReason === 'expired') return 'expired';
  return 'access-withdrawn';
}

/**
 * Somebody's access ENDED (call it before their tokens are revoked): remember
 * every session they hold, by digest. Returns how many were remembered.
 */
export function rememberEndedSessions(dataDir, email, noticeReason, now = Date.now()) {
  const who = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!dataDir || !who) return 0;
  const reason = endedRefusalReason(noticeReason);
  const m = bucket(dataDir);
  let n = 0;
  for (const { digest, expiresAt } of listTokenDigestsForOwner(dataDir, who)) {
    if (typeof digest !== 'string' || !digest) continue;
    const cap = now + STUDIO_SESSION_TTL_MS;
    const until = Number.isFinite(expiresAt) ? Math.min(expiresAt, cap) : cap;
    m.delete(digest);
    m.set(digest, { reason, until });
    n += 1;
  }
  while (m.size > CAP) m.delete(m.keys().next().value);
  return n;
}

/**
 * The reason a presented cookie's session ended, or null — null for anything
 * this memo did not see ended (unknown, forged, live, expired since).
 */
export function endedSessionReason(dataDir, cookieValue, now = Date.now()) {
  if (!dataDir || typeof cookieValue !== 'string' || !cookieValue) return null;
  const m = memo.get(dataDir);
  if (!m || m.size === 0) return null;
  const digest = digestToken(dataDir, cookieValue);
  if (!digest) return null;
  const hit = m.get(digest);
  if (!hit) return null;
  if (hit.until <= now) {
    m.delete(digest);
    return null;
  }
  return hit.reason;
}

/** Test seam — forget everything. */
export function resetEndedSessions() {
  memo.clear();
}
