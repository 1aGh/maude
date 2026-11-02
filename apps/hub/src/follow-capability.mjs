// The presentation follower's capability — S3.7c, lead decision
// `v2-lead-cloud-follow-capability` (S3-present-session §4–§5).
//
// A cloud follower (the hub's `/present/<canvas>` → the studio's follower root)
// must hear the presenter's collab AWARENESS, and DDR-247 refuses every collab
// upgrade carrying a read-only (embed) capability. So the follower page asks
// `/_config?follow=1&canvas=<rel>` and is handed a `follow` capability:
//
//   - realm canvas, read-only (`ro`), receive-only, scoped to ONE canvas the
//     session can read — never broader than the session, and narrower than the
//     embed token (its access is canvas-only `observer` on that canvas);
//   - the canvas door admits a collab upgrade carrying it ONLY for that
//     canvas's room (`/_ws/collab/<slug of rel>`), marked `x-maude-collab-follow`;
//   - the studio room drops every sync update from it and strips its awareness
//     to `watching` (collab/room.ts, present/relay-strip.ts).
//
// DDR-247's embed rule is untouched: an embed token still opens no collab socket.
//
// Pure: no I/O. The decision is on the claim only — a canvas the session may
// not read and a canvas that does not exist get the same answer (no token), so
// the mint is no existence oracle (U1).

import { legacyClaim, resolveAccess } from '../../studio/access/scope.ts';
import { canvasSlugFromRel } from '../../studio/canvas-slug.ts';

/** Longest canvas path a follow capability names (the present route's bound). */
export const MAX_FOLLOW_REL = 1024;

/**
 * A designRoot-relative canvas path a follow capability may name, or null.
 * The present route's grammar (routes-v2/present.mjs `presentRelOf`) over an
 * already-decoded value: no empty / `.` / `..` / `_`-led segment, no control
 * character, no `\` `:` `%` `?` `#`, ends `.tsx`, ≤ 1024.
 */
export function followRelOf(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_FOLLOW_REL) return null;
  if (/[\\:%?#]/.test(value)) return null;
  if (value.normalize('NFC') !== value) return null;
  if (!/\.tsx$/.test(value)) return null;
  for (const seg of value.split('/')) {
    if (seg === '' || seg === '.' || seg === '..' || seg.startsWith('_')) return null;
    if ([...seg].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  }
  return value;
}

/**
 * Did this shell request ask for a follow capability? `{ asked: false }`, or
 * `{ asked: true, rel }` with `rel` null when the canvas it names is not one
 * (exactly one `canvas`, decoded once by URLSearchParams, then `followRelOf`).
 */
export function followAskOf(request) {
  let params;
  try {
    params = new URL(request?.url ?? '/', 'http://cell.invalid').searchParams;
  } catch {
    return { asked: false, rel: null };
  }
  if (params.get('follow') !== '1') return { asked: false, rel: null };
  const canvases = params.getAll('canvas');
  return { asked: true, rel: canvases.length === 1 ? followRelOf(canvases[0]) : null };
}

/** The session's access (a role session without a stored claim → its legacy claim). */
export function sessionAccess(session) {
  if (!session) return resolveAccess(null);
  return resolveAccess(session.access ?? legacyClaim(session.role ?? null));
}

/** May this session follow `rel`? `read` on that canvas (Can view and up, or a grant on it). */
export function mayFollow(session, rel) {
  return Boolean(rel) && sessionAccess(session).can('read', rel);
}

/** The ONE room a follow capability opens: `/_ws/collab/<slug>` (use-collab `canvasSlugFromPath`). */
export function followRoomPath(rel) {
  const slug = canvasSlugFromRel(rel, '');
  return /^[a-z0-9_-]+$/.test(slug) ? `/_ws/collab/${slug}` : null;
}

/** What a follow capability may do at the studio: look at that one canvas (canvas-only observer). */
export function followAccessClaim(rel) {
  return { v: 1, role: null, grants: [{ c: rel, r: 'observer' }] };
}
