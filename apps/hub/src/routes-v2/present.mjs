// The presentation link — `GET /present/<canvas>` (S3.7b / S9.13, S3-present-session §5).
//
// A hub redirect, never a studio route: a signed-in person with `read` on THAT
// canvas (V2-1.16 — Can view and up, or a canvas grant on it) is sent to the
// studio's follower root, `/?open=<rel>&present=follow`. The follower page
// (`client/v2/present/follow-view.jsx`, S3.7a) then follows the presenter over
// the canvas's collab awareness.
//
//  - Missing and forbidden answer the SAME 404 — status, headers and body (U1,
//    no existence oracle). A path the grammar refuses is a missing canvas.
//  - Signed out: the ordinary sign-in redirect, with the follow form remembered
//    for after sign-in (`presentReturnTo`, the one builder; return-to.mjs).
//  - GET and HEAD only; anything else is 405. No token in the URL. It is not a
//    Share link (those stay S9's `POST /api/access/links` and open the canvas).
//
// The route-table row is a canvas door (`canvasDoor`): the access gate lets a
// canvas-only session through and this handler judges the ONE target itself.

import { statSync } from 'node:fs';
import { join } from 'node:path';

import { resolveAccess } from '../../../studio/access/scope.ts';
import { claimForMatch, presentedBearer } from '../access-gate.mjs';
import { isContainedReal } from '../path-contain.mjs';
import { FOLLOW_SUFFIX, setReturnTo } from '../return-to.mjs';
import { servicePage } from '../studio-door.mjs';
import { matchesScope } from '../tokens.mjs';

const PREFIX = '/present/';
/** Longest accepted canvas path (contract §5). */
export const MAX_PRESENT_PATH = 1024;

/**
 * `/present/<seg>(/<seg>)*` → `segs.join('/') + '.tsx'`, or null. Each segment
 * is percent-decoded once and NFC-normalized. Refused: an empty, `.` or `..`
 * segment, one starting `_` (runtime dirs), a control character, `\`, `:`, a
 * decoded `/`, or a path longer than 1024.
 */
export function presentRelOf(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(PREFIX)) return null;
  const raw = pathname.slice(PREFIX.length);
  if (!raw || raw.length > MAX_PRESENT_PATH * 9) return null;
  const segs = [];
  for (const seg of raw.split('/')) {
    let d;
    try {
      d = decodeURIComponent(seg).normalize('NFC');
    } catch {
      return null;
    }
    if (!d || d === '.' || d === '..' || d.startsWith('_')) return null;
    if (/[\\:/]/.test(d)) return null;
    if ([...d].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
    segs.push(d);
  }
  const rel = `${segs.join('/')}.tsx`;
  return rel.length > MAX_PRESENT_PATH ? null : rel;
}

/** THE follower address for a canvas — the 302 target and the sign-in return. */
export function presentReturnTo(rel) {
  return `/?open=${rel.split('/').map(encodeURIComponent).join('/')}${FOLLOW_SUFFIX}`;
}

/**
 * Who is asking, as `{ access, scope }`, or null (signed out).
 *
 * A presented bearer is judged alone (a wrong one is signed out, never a
 * fallback to the cookie). Otherwise the browser cookie — `browserSession`,
 * which admits a claim-bearing canvas-only cookie and refuses a stale one.
 */
export function presentSessionOf(request, { verify, browserSession }) {
  const bearer = presentedBearer(request);
  if (bearer) {
    let match = null;
    try {
      match = verify(bearer);
    } catch {
      match = null;
    }
    return match
      ? { access: resolveAccess(claimForMatch(match)), scope: match.scope ?? '*' }
      : null;
  }
  const session = browserSession?.(request) ?? null;
  return session ? { access: resolveAccess(session.access), scope: '*' } : null;
}

/** May this session follow `rel`: `read` on that canvas, and the canvas exists in the design root. */
export function presentAllows(session, rel, designRoot) {
  const { access, scope } = session;
  // A project session keeps DDR-053's machine scope (the file door's `sees`).
  if (access.role !== null && !matchesScope(scope, rel)) return false;
  if (!access.can('read', rel)) return false;
  if (!designRoot) return false;
  const abs = join(designRoot, rel);
  if (!isContainedReal(designRoot, abs)) return false;
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

/** The ONE refusal — identical for missing, forbidden and unparseable. */
const NOT_FOUND_HTML = () =>
  servicePage('Nothing to follow', "This presentation isn't here, or you can't open it.");
const NOT_FOUND_HEADERS = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'none'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
});

function notFound(response, method) {
  const body = NOT_FOUND_HTML();
  response.writeHead(404, { ...NOT_FOUND_HEADERS, 'content-length': Buffer.byteLength(body) });
  response.end(method === 'HEAD' ? undefined : body);
  return true;
}

/**
 * The row's handler. `ctx.deps` (server.mjs): `browserSession(request)`,
 * `designRoot()` (null when this hub serves no studio), `signInUrl(request)`.
 */
export async function handlePresent(ctx) {
  const { request, response, method, path, deps = {} } = ctx;
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
    response.end();
    return true;
  }
  const rel = presentRelOf(path);
  if (!rel) return notFound(response, method);
  const session = presentSessionOf(request, {
    verify: ctx.verify,
    browserSession: deps.browserSession,
  });
  if (!session) {
    // Signed out — the same answer whether or not the canvas exists.
    if ((request.headers?.accept ?? '').includes('text/html')) {
      setReturnTo(response, presentReturnTo(rel));
      response.writeHead(302, {
        location: deps.signInUrl?.(request) ?? '/studio/signin',
        'cache-control': 'no-store',
      });
      response.end();
    } else {
      ctx.respondJson(401, { error: 'sign in to open this project' });
    }
    return true;
  }
  if (!presentAllows(session, rel, deps.designRoot?.() ?? null)) return notFound(response, method);
  response.writeHead(302, { location: presentReturnTo(rel), 'cache-control': 'no-store' });
  response.end();
  return true;
}

/** S9.13 — the presentation area's rows (registered in `routes-v2/index.mjs`). */
export const PRESENT_ROWS = Object.freeze([
  Object.freeze({
    path: '/present/*',
    // `read` on a GET (Can view and up); every other method is the handler's 405.
    cap: Object.freeze({ safe: 'read', unsafe: null }),
    scope: 'canvas',
    canvasDoor: true,
    handler: handlePresent,
  }),
]);
