// The desktop's sign-in to a team server — issue #204 (Maude 2.0.4).
//
// Michal's rule (decision `maude/v2-michal-team-server-signin-via-hub-page`):
// the desktop owns NO login method for a team server. Its "Sign in" button
// opens THIS hub's own page (`/studio/signin`) in the browser, so the person
// signs in with whatever the hub offers — a password, "Sign in with
// <issuer>" (OIDC), anything added later — and the hub hands the app a
// one-time code it trades for the same peer token `/auth/login` mints.
//
//   app (studio sidecar)                 browser                       hub
//   ────────────────────                 ───────                       ───
//   verifier, state (kept in memory)
//   open /studio/signin?client=desktop
//        &state&code_challenge
//        &redirect_uri=http://127.0.0.1:<port>/_api/hub-signin/return
//                                         GET  ──────────────────────▶ validate; SIGNED cookie
//                                         password form / OIDC ──────▶ verified person
//                                         ◀── 200 hand-off page: meta refresh to
//                                             redirect_uri?code=<one-time>&state=<state>
//   GET return?code&state  ◀────────────  (loopback, this tab's own server)
//   state must be a live attempt of THIS server
//   POST /auth/desktop/exchange {code, code_verifier} ───────────────▶ one use, 60 s,
//                                                                       S256(verifier) = challenge
//   ◀──────────── { token, expiresAt, user } (the /auth/login answer)
//
// Rules this file holds:
//   • the redirect target is LOOPBACK ONLY (RFC 8252 §7.3), one exact path, no
//     query, no userinfo — the hub is never an open redirect;
//   • the token never travels in a URL: only the code does, and the code is
//     worthless without the verifier the app never let out of its process;
//   • a code is single use (burned on the first redemption attempt, right or
//     wrong) and lives DESKTOP_CODE_TTL_MS;
//   • the desktop request rides a cookie HMAC-signed under a purpose-derived
//     key, so a page that can set a cookie on this origin cannot choose the
//     challenge or the redirect target;
//   • the hand-off is a 200 page, not a 302: the sign-in page's CSP says
//     `form-action 'self'`, which Chrome applies to a form POST's redirect
//     chain — a 302 to loopback after the password POST would be blocked.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { escapeHtml } from './studio-door.mjs';

/** Advertised on `/health` `capabilities` — a 2.0.4+ desktop signs in this way only where it is. */
export const DESKTOP_SIGNIN_CAPABILITY = 'desktop-signin-v1';
/** The cookie carrying the desktop's request from `/studio/signin` to the success. */
export const DESKTOP_TXN_COOKIE = 'maude_desktop_signin';
/** As long as an OIDC attempt (TXN_TTL_MS): the person may type slowly. */
export const DESKTOP_TXN_TTL_MS = 10 * 60_000;
/** The code only has to survive one loopback hop and one exchange. */
export const DESKTOP_CODE_TTL_MS = 60_000;
/** The one path a redirect target may name — the studio's return route. */
export const DESKTOP_RETURN_PATH = '/_api/hub-signin/return';
/** Bound the in-memory code book (an unredeemed code otherwise sits until its TTL). */
const MAX_CODES = 1000;

const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Is this a redirect target the hub may send a code to? Loopback, http, an
 * explicit port, exactly DESKTOP_RETURN_PATH, nothing else — and the string
 * must already be in the canonical form, so no parser disagreement can make
 * two readings of one value.
 */
export function validReturnUri(raw) {
  if (typeof raw !== 'string' || raw.length > 256) return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:') return false;
  if (!LOOPBACK_HOSTS.has(u.hostname)) return false;
  if (!u.port) return false;
  if (u.username || u.password || u.search || u.hash) return false;
  if (u.pathname !== DESKTOP_RETURN_PATH) return false;
  return u.href === raw;
}

/**
 * The desktop's request from `/studio/signin`'s query, or why it is refused.
 * `client` absent ⇒ `{ desktop: false }` (the ordinary browser sign-in).
 */
export function parseDesktopRequest(searchParams) {
  const client = searchParams.get('client');
  if (client === null) return { desktop: false };
  const bad = (error) => ({ desktop: true, ok: false, error });
  if (client !== 'desktop') return bad('unknown client');
  const state = searchParams.get('state') ?? '';
  const challenge = searchParams.get('code_challenge') ?? '';
  const method = searchParams.get('code_challenge_method');
  const redirectUri = searchParams.get('redirect_uri') ?? '';
  if (!STATE_RE.test(state)) return bad('bad state');
  if (!CHALLENGE_RE.test(challenge)) return bad('bad code_challenge');
  if (method !== null && method !== 'S256') return bad('only S256 is accepted');
  if (!validReturnUri(redirectUri)) return bad('bad redirect_uri');
  return { desktop: true, ok: true, request: { state, challenge, redirectUri } };
}

// ------------------------------------------------------------ the signed cookie

function mac(payload, secret) {
  return createHmac('sha256', `desktop-signin:${secret}`).update(payload).digest('base64url');
}

export function encodeDesktopTxn(request, secret, now = Date.now()) {
  if (!secret) throw new Error('encodeDesktopTxn: a signing secret is required');
  const payload = Buffer.from(JSON.stringify({ ...request, createdAt: now }), 'utf8').toString(
    'base64url'
  );
  return `${payload}.${mac(payload, secret)}`;
}

/** The desktop request a cookie carries — signed, unexpired and still well-formed — or null. */
export function readDesktopTxn(raw, { secret, now = Date.now() } = {}) {
  if (!raw || !secret) return null;
  const s = String(raw);
  const dot = s.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = s.slice(0, dot);
  const a = Buffer.from(s.slice(dot + 1));
  const b = Buffer.from(mac(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let txn;
  try {
    txn = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!txn || typeof txn !== 'object') return null;
  if (!STATE_RE.test(String(txn.state ?? ''))) return null;
  if (!CHALLENGE_RE.test(String(txn.challenge ?? ''))) return null;
  if (!validReturnUri(txn.redirectUri)) return null;
  if (!Number.isFinite(txn.createdAt) || now - txn.createdAt > DESKTOP_TXN_TTL_MS) return null;
  if (txn.createdAt > now + 60_000) return null;
  return { state: txn.state, challenge: txn.challenge, redirectUri: txn.redirectUri };
}

/** `Set-Cookie` values. Path=/ — both `/studio/signin` and `/auth/oidc/callback` must read it. */
export function desktopTxnCookie(value) {
  return `${DESKTOP_TXN_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(DESKTOP_TXN_TTL_MS / 1000)}`;
}
export function clearDesktopTxnCookie() {
  return `${DESKTOP_TXN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ------------------------------------------------------------- one-time codes

const sha = (s) => createHash('sha256').update(s).digest('base64url');

/**
 * The code book. In memory on purpose: a code lives a minute and is useless
 * after a restart anyway (the person signs in again). Keyed by the code's
 * hash, so even a heap dump does not hand out a redeemable value.
 */
export function createDesktopCodes({ ttlMs = DESKTOP_CODE_TTL_MS, max = MAX_CODES } = {}) {
  const book = new Map();
  const sweep = (now) => {
    for (const [k, v] of book) if (now - v.issuedAt > ttlMs) book.delete(k);
  };
  return {
    /** A code for `email`, bound to the request's `challenge`. */
    issue({ email, challenge }, now = Date.now()) {
      sweep(now);
      while (book.size >= max) book.delete(book.keys().next().value);
      const code = randomBytes(32).toString('base64url');
      book.set(sha(code), { email, challenge, issuedAt: now });
      return code;
    },
    /**
     * Redeem once. The entry is deleted BEFORE anything is checked, so a wrong
     * verifier burns the code too: an interceptor gets exactly one guess, and
     * the person's own exchange then fails loudly instead of racing it.
     * @returns {{ok:true, email:string, issuedAt:number} | {ok:false, reason:string}}
     */
    redeem(code, verifier, now = Date.now()) {
      if (typeof code !== 'string' || !code || code.length > 128) {
        return { ok: false, reason: 'unknown-code' };
      }
      const key = sha(code);
      const entry = book.get(key);
      book.delete(key);
      if (!entry) return { ok: false, reason: 'unknown-code' };
      if (now - entry.issuedAt > ttlMs) return { ok: false, reason: 'expired' };
      if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) {
        return { ok: false, reason: 'bad-verifier' };
      }
      const a = Buffer.from(sha(verifier));
      const b = Buffer.from(entry.challenge);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { ok: false, reason: 'bad-verifier' };
      }
      return { ok: true, email: entry.email, issuedAt: entry.issuedAt };
    },
    size: () => book.size,
  };
}

/** The hub's one code book. */
export const desktopCodes = createDesktopCodes();

// ------------------------------------------------------------ the hand-off page

/** The redirect target with the hand-off's own parameters — the only URL that carries the code. */
export function returnUrl(request, params) {
  const u = new URL(request.redirectUri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('state', request.state);
  return u.toString();
}

/**
 * The page that sends the browser back to the app. A 200 with a meta refresh
 * plus a plain link (see the header for why not a 302). `no-store` and
 * `no-referrer` come from `respondHtml`; the code inside is single use.
 */
export function desktopHandoffPage({ href, title, message }) {
  const esc = escapeHtml;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${esc(href)}">
<title>${esc(title)}</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0e1014; color:#e9ecf3;
         font:15px/1.6 -apple-system, system-ui, sans-serif; padding:24px; }
  main { width:min(24rem, 100%); }
  h1 { font-size:1.3rem; margin:0 0 .5rem; }
  p { color:#c3c9d6; }
  a { display:block; margin-top:16px; padding:10px; border-radius:9px; text-align:center;
      background:#7a86f8; color:#0f1020; text-decoration:none; font-weight:650; }
</style></head>
<body><main>
  <h1>${esc(title)}</h1>
  <p>${esc(message)}</p>
  <a href="${esc(href)}">Go back to Maude</a>
</main></body></html>`;
}
