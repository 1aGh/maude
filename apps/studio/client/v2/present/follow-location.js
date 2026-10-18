// client/v2/present/follow-location.js — S3.7a: the follower page's URL grammar (S3-present-session §4).
//
//   /?open=<designRel>.tsx&present=follow[&sid=<sid>][&audience=1]
//
// `present=follow` selects the follower root (follow-view.jsx). app.jsx checks it BEFORE `isEmbedLocation`.
// `sid` outside /^[a-z0-9]{8,32}$/ is ignored (the first presenter seen is followed instead). `audience=1`
// only removes chrome — no bar, no keys, no cursor — so it grants nothing when typed by hand.
//
// S3.6a security review (the audience window on a second display):
//   · a URL that carries `audience` at all is the follower root's or nobody's: `isFollowLocation` says yes,
//     and without `present=follow` the page refuses (blank) — it never falls through to the editor client;
//   · `open` is decoded exactly once (URLSearchParams) and the decoded value re-checked against the canvas
//     design-rel grammar: no empty / `.` / `..` segment, no segment starting `_` (runtime dirs), no `%`,
//     `?`, `#`, `\`, `:` or control character, at most 1024 characters, ending `.tsx`;
//   · `supportsAudienceLock` is the marker S3.6a's audience-window seam checks before it opens a window.
// Pure (URLSearchParams only).
import { normalizeOpenPath } from '../../share-link.js';

export const FOLLOW_SID_RE = /^[a-z0-9]{8,32}$/;

/** S3.6a — this build's follower root honours `audience=1` (locked: no bar, no keys, no pointer). */
export const supportsAudienceLock = true;

const OPEN_MAX = 1024;

function paramsOf(location) {
  try {
    return new URLSearchParams(location?.search ?? '');
  } catch {
    return new URLSearchParams();
  }
}

/**
 * Is this page load the follower root's? `present=follow`, or any URL carrying `audience` — an audience
 * URL never renders the editor, even when it is not a valid follower URL (the page then refuses).
 */
export function isFollowLocation(location) {
  const p = paramsOf(location);
  return p.get('present') === 'follow' || p.has('audience');
}

/** The canvas design-rel grammar, on an already decoded value (never decoded again). */
export function followOpenRel(decoded, designRel = '.design') {
  if (typeof decoded !== 'string' || decoded.length > OPEN_MAX) return null;
  if (/[%?#\\:]/.test(decoded)) return null;
  const rel = normalizeOpenPath(decoded, designRel);
  if (!rel || !/\.tsx$/.test(rel)) return null;
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.' || seg === '..' || seg.startsWith('_')) return null;
    if ([...seg].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  }
  return rel;
}

/**
 * What the follower was asked to follow: `open` (validated, or null), `sid` (or null), `audience`, and
 * `ok` — false for an audience URL that is not a follower URL (the page refuses without a fetch).
 */
export function readFollowParams(location, designRel = '.design') {
  const params = paramsOf(location);
  const sids = params.getAll('sid');
  const sid = sids.length === 1 && FOLLOW_SID_RE.test(sids[0]) ? sids[0] : null;
  const opens = params.getAll('open');
  const audience = params.get('audience') === '1';
  const isFollow = params.get('present') === 'follow';
  const auds = params.getAll('audience');
  return {
    // URLSearchParams decoded it once; it is checked as is.
    open: opens.length === 1 ? followOpenRel(opens[0], designRel) : null,
    sid,
    audience,
    ok: isFollow && (auds.length === 0 || (auds.length === 1 && audience)),
  };
}
