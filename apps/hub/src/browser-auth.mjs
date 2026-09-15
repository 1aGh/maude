// The browser door's sign-in — Cloud Phase 25 B1/B2.
//
// The chain the desktop already walks, with the last leg changed from "hand
// the app a token" to "set a cookie on this hostname":
//
//   the person opens <project>.cloud.maude.sh
//     → no session ⇒ redirect to the control plane's browser handoff
//     → the control plane authenticates the MAUDE ACCOUNT and decides access
//       (owner / member / viewer all pass; a stranger meets B2's refusal)
//     → it redirects back here with a one-time code
//     → THIS module trades the code for a project token, server to server,
//       and stores it as an httpOnly cookie
//
// The code travels in a URL and the token never does — the same rule /join
// follows, for the same reason (Referer headers, proxy logs, shoulders).
//
// The cookie is the SAME peer token the desktop holds as a bearer, so the
// read-only capability (C1) and the expiry are decided once, in one place,
// for both surfaces. A separate browser session type would be a second place
// for the role model to drift, which is exactly what Track C exists to stop.

import { authenticateForMode } from './cloud-identity.mjs';
import {
  authorizeUrl,
  createTransaction,
  createVerifier,
  encodeTransaction,
  exchangeCode,
  OIDC_TXN_COOKIE,
  oidcConfig,
  readTransaction,
  resolveSubject,
  TXN_TTL_MS,
} from './oidc-routes.mjs';
import { takeReturnTo } from './return-to.mjs';
import { isRevoked } from './revocations.mjs';
import { isReadOnlyRole, projectRoleForAccount } from './role-matrix.mjs';
import { escapeHtml, oidcButton, servicePage } from './studio-door.mjs';
import { addToken, removeToken, verifyToken } from './tokens.mjs';
import { authenticate as localAuthenticate } from './users.mjs';

export const BROWSER_SESSION_COOKIE = 'maude_studio';

/** How long a studio session (the `maude_studio` cookie) lives, whichever door
 *  minted it — the self-hosted sign-in, the OIDC callback, the cloud exchange,
 *  or the invite landing page (auth-routes.mjs). */
export const STUDIO_SESSION_TTL_MS = 12 * 3600_000;

/** Read one cookie from a Node request. */
export function cookieValue(request, name) {
  const raw = request.headers?.cookie;
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      // A malformed percent-escape in a cookie is just "no cookie". Unguarded,
      // `decodeURIComponent` threw out of `onRequest` and the hub process
      // exited — one anonymous `Cookie: maude_studio=%E0` on any door that
      // reads the session (attacker round-2 R2-1, 2026-08-21).
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function setSessionCookie(response, token, maxAgeSeconds) {
  response.setHeader('set-cookie', [
    `${BROWSER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ]);
}

function clearSessionCookie(response) {
  response.setHeader('set-cookie', [
    `${BROWSER_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  ]);
}

function redirect(response, location) {
  response.writeHead(302, { location, 'cache-control': 'no-store' });
  response.end();
}

/**
 * Send a server-rendered page — the sign-in page, the invite landing page,
 * and every `servicePage`. One writer so the headers cannot drift between
 * doors (security review 2026-08-21, F5 / attacker F3+F4):
 *   • `no-store` — these pages carry session state and, on the invite landing
 *     page, the raw invite token;
 *   • `Referrer-Policy: no-referrer` — the landing page's own URL IS the
 *     token; nothing the person clicks from it may carry that URL along;
 *   • `X-Frame-Options: DENY` + `frame-ancestors 'none'` — two of these
 *     pages collect a password; neither may be framed;
 *   • a CSP that matches what the pages are: no script, inline or linked
 *     CSS, forms that post only to this origin.
 */
export function respondHtml(response, status, html) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy':
      "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
  response.end(html);
}

/**
 * May this form POST set a session on this hub? TRUE only on a positive
 * signal that the submit came from the hub's own page:
 *   • `Sec-Fetch-Site: same-origin` (or `none` — a typed/bookmarked
 *     navigation), the header every current engine sends; `same-site` and
 *     `cross-site` are refused — on the cloud fleet every tenant is same-site
 *     to every other, and so is the untrusted canvas origin;
 *   • else an `Origin` header whose origin is the hub's own — `publicUrl`'s
 *     origin, or (a hub with none configured) any scheme on the request's
 *     `Host` — which every browser of the last decade sends on a form POST.
 * Neither ⇒ refused. Used by the invite landing form (auth-routes.mjs) and
 * the self-hosted sign-in form below — one gate for both cookie-setting doors.
 */
export function formOriginAllowed(request, publicUrl) {
  const site = String(request?.headers?.['sec-fetch-site'] ?? '')
    .trim()
    .toLowerCase();
  if (site) return site === 'same-origin' || site === 'none';
  const origin = String(request?.headers?.origin ?? '').trim();
  if (!origin || origin === 'null') return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (publicUrl) {
    try {
      if (parsed.origin === new URL(String(publicUrl)).origin) return true;
    } catch {
      /* fall through to the Host comparison */
    }
  }
  const host = String(request?.headers?.host ?? '')
    .trim()
    .toLowerCase();
  return Boolean(host) && parsed.host.toLowerCase() === host;
}

/** The short-lived transaction cookie for an OIDC sign-in in flight. */
function setTxnCookie(response, value, maxAgeSeconds) {
  response.setHeader('set-cookie', [
    `${OIDC_TXN_COOKIE}=${encodeURIComponent(value)}; Path=/auth/oidc; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ]);
}
function clearTxnCookie(response, extra = []) {
  response.setHeader('set-cookie', [
    `${OIDC_TXN_COOKIE}=; Path=/auth/oidc; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    ...extra,
  ]);
}

/**
 * The OIDC door (Track C, B1) — sibling of `/studio/signin`, same ending.
 *
 * `/auth/oidc/start`    → discovery, a signed transaction cookie, redirect out.
 * `/auth/oidc/callback` → state + PKCE + nonce, exchange, verify, and then the
 *                         SAME `resolveSubject` decision the flow is built
 *                         around: a linked subject signs in, everyone else
 *                         waits in `oidc_pending`. The session it mints is the
 *                         SAME peer token the password door mints, so
 *                         revocation, expiry and the read-only capability are
 *                         decided in one place for both.
 *
 * @returns {Promise<boolean>} true when handled.
 */
export async function handleOidc({
  request,
  response,
  path,
  method,
  dataDir,
  secret,
  publicUrl,
  env = process.env,
  fetchImpl,
  checkRateLimit,
  respondRateLimited,
}) {
  const cfg = oidcConfig(env);
  if (!cfg.enabled) {
    // The button and the docs are gated on the same env, so reaching here means
    // a stale link or a probe. Do not 500; say plainly it is off.
    page(response, 404, 'Not enabled', 'This hub does not accept identity-provider sign-in.');
    return true;
  }
  if (cfg.errors.length) {
    page(response, 500, 'Misconfigured', `OIDC is not usable yet: ${cfg.errors[0]}`);
    return true;
  }
  if (method !== 'GET') {
    page(response, 405, 'Not here', 'Start sign-in from the project page.');
    return true;
  }

  const redirectUri = `${String(publicUrl).replace(/\/+$/, '')}/auth/oidc/callback`;
  const verifier = createVerifier({ issuer: cfg.issuer, audience: cfg.clientId, fetchImpl });
  const url = new URL(request.url, 'http://cell.invalid');

  if (path === '/auth/oidc/start') {
    let doc;
    try {
      doc = await verifier.discovery.document();
    } catch (err) {
      page(
        response,
        502,
        'Provider unreachable',
        `Could not reach the identity provider: ${err.message}`
      );
      return true;
    }
    const txn = createTransaction();
    let dest;
    try {
      dest = authorizeUrl(cfg, txn, redirectUri, doc.authorization_endpoint);
    } catch (err) {
      page(response, 502, 'Provider misconfigured', err.message);
      return true;
    }
    setTxnCookie(response, encodeTransaction(txn, secret), TXN_TTL_MS / 1000);
    redirect(response, dest);
    return true;
  }

  if (path === '/auth/oidc/callback') {
    // OIDC AppSec pass (post-1.0) — the callback drives an outbound token
    // exchange + a verify, on the same bucket the password door uses. Without
    // it, `/auth/oidc/callback?code=…` is an unthrottled way to make the hub
    // hammer the issuer's token endpoint (the txn cookie gate is real but a
    // page that can set a cookie on the hub origin can also mint valid ones).
    if (checkRateLimit && respondRateLimited && !checkRateLimit(request)) {
      respondRateLimited();
      return true;
    }
    const txn = readTransaction(cookieValue(request, OIDC_TXN_COOKIE), { secret });
    if (!txn) {
      page(
        response,
        400,
        'Sign-in expired',
        'That sign-in took too long or was interrupted. Start again.'
      );
      return true;
    }
    // The state parameter must match the cookie — the anti-CSRF binding.
    if (url.searchParams.get('state') !== txn.state) {
      clearTxnCookie(response);
      page(response, 400, 'Sign-in could not be verified', 'Please start again.');
      return true;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      clearTxnCookie(response);
      page(response, 400, 'Something is missing', 'Start sign-in from the project page.');
      return true;
    }

    let verified;
    try {
      const doc = await verifier.discovery.document();
      const idToken = await exchangeCode(
        cfg,
        { code, codeVerifier: txn.codeVerifier, redirectUri, tokenEndpoint: doc.token_endpoint },
        fetchImpl ? { fetchImpl } : {}
      );
      verified = await verifier.verifyIdToken(idToken, { nonce: txn.nonce });
    } catch (err) {
      clearTxnCookie(response);
      page(
        response,
        502,
        'Sign-in failed',
        `The identity provider's response could not be verified: ${err.message}`
      );
      return true;
    }

    const outcome = resolveSubject(dataDir, verified, cfg);
    if (outcome.action === 'sign-in') {
      const ttlMs = STUDIO_SESSION_TTL_MS;
      const projectRole = projectRoleForAccount(outcome.user.role);
      const minted = addToken(dataDir, {
        label: `studio-${Math.random().toString(36).slice(2, 10)}`,
        scope: outcome.user.scope ?? '*',
        owner: outcome.user.email,
        expiresAt: Date.now() + ttlMs,
        role: projectRole,
        readOnly: isReadOnlyRole(projectRole),
      });
      clearTxnCookie(response, [
        `${BROWSER_SESSION_COOKIE}=${encodeURIComponent(minted.value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}`,
      ]);
      redirect(response, takeReturnTo(request, response));
      return true;
    }
    clearTxnCookie(response);
    if (outcome.action === 'pending') {
      page(
        response,
        403,
        'Waiting for access',
        'You signed in, but nobody here has given your account access yet. Ask whoever runs this hub to approve you.',
        env.HUB_DASHBOARD_URL
          ? { href: env.HUB_DASHBOARD_URL, label: 'Go to your dashboard' }
          : null
      );
      return true;
    }
    page(response, 403, 'You do not have access', outcome.reason ?? 'This account cannot sign in.');
    return true;
  }

  return false;
}

function page(response, status, title, message, action) {
  respondHtml(response, status, servicePage(title, message, action ? { action } : {}));
}

/**
 * @returns {Promise<boolean>} true when handled.
 */
export async function handleBrowserAuth({
  request,
  response,
  path,
  method,
  dataDir,
  secret,
  publicUrl = null,
  env = process.env,
  fetchImpl = fetch,
  checkRateLimit,
  respondRateLimited,
}) {
  if (path === '/auth/browser/signout') {
    // POST ONLY. This is not a cookie clear — it calls `removeToken`, which
    // revokes the credential server-side and permanently. As a GET it was a
    // state-mutating navigation any page could force on a signed-in member
    // with one `<img>` or link, and `SameSite=Lax` does not stop that (it is
    // sent on cross-site top-level navigations, and every `*.<zone>` origin is
    // same-site anyway). Cheap to force, annoying to receive, trivial to close.
    if (method !== 'POST') {
      page(response, 405, 'Not here', 'Use the Sign out button in the project.');
      return true;
    }
    const existing = cookieValue(request, BROWSER_SESSION_COOKIE);
    const match = existing ? verifyToken(dataDir, existing, secret) : null;
    if (match?.label) {
      try {
        removeToken(dataDir, match.label);
      } catch {
        /* already gone — signing out twice is not an error */
      }
    }
    clearSessionCookie(response);
    redirect(response, takeReturnTo(request, response));
    return true;
  }

  // ---- the SELF-HOSTED door (Cloud Phase 25 E2) --------------------------
  //
  // A self-hosted hub has no control plane to bounce off; it has its own
  // users. Same cookie, same token store, same read-only capability — only the
  // question ("who are you?") is answered here instead of there. Writing it as
  // a second door rather than a second SYSTEM is what keeps E2 honest: the
  // studio, the sandbox and the role model are all the same code.
  if (path === '/studio/signin') {
    if (method === 'GET') {
      respondHtml(response, 200, signInPage());
      return true;
    }
    if (method === 'POST') {
      // OIDC AppSec pass (post-1.0) — the self-hosted password door does a real
      // credential check against the local user store, and unlike its sibling
      // `/auth/login` it was NOT rate-limited: an unthrottled password-guessing
      // oracle behind one opaque "did not match" message. Same bucket as the
      // control-plane door.
      if (checkRateLimit && respondRateLimited && !checkRateLimit(request)) {
        respondRateLimited();
        return true;
      }
      // Login CSRF (security review 2026-08-21, round-2 R2): a page elsewhere
      // must not be able to sign this browser into an account the attacker
      // holds the password for. Same gate as the invite landing form.
      if (!formOriginAllowed(request, publicUrl)) {
        page(response, 403, 'Not from here', 'Open the sign-in page directly.');
        return true;
      }
      let form;
      try {
        form = await readForm(request);
      } catch {
        page(response, 400, 'Something went wrong', 'Open the sign-in page and try again.');
        return true;
      }
      const result = authenticateForMode(
        { email: form.get('email'), password: form.get('password') },
        { local: (email, password) => localAuthenticate(dataDir, email, password) }
      );
      if (!result.ok) {
        // ONE opaque message — the distinction between "no such user" and
        // "wrong password" is an account-existence oracle.
        respondHtml(response, 401, signInPage('That email and password did not match.'));
        return true;
      }
      const user = result.user;
      const ttlMs = STUDIO_SESSION_TTL_MS;
      // TRANSLATED, not passed through — `user.role` is an ACCOUNT role and
      // the role matrix speaks PROJECT roles. Untranslated, an 'admin' is an
      // unknown role, gets nothing, and reads as read-only: the owner opens
      // his own project and cannot edit it. Same fix as `/auth/login`; this
      // door was missed the first time.
      const projectRole = projectRoleForAccount(user.role);
      const minted = addToken(dataDir, {
        label: `studio-${Math.random().toString(36).slice(2, 10)}`,
        scope: user.scope ?? '*',
        owner: user.email,
        expiresAt: Date.now() + ttlMs,
        // The ROLE is what the session carries; `readOnly` is stored alongside
        // it only because every other token type has the column. The cell
        // re-derives the capability from the role on every request, so a role
        // that changes reaches a live session instead of waiting out its TTL.
        role: projectRole,
        readOnly: isReadOnlyRole(projectRole),
      });
      setSessionCookie(response, minted.value, ttlMs / 1000);
      // THE STUDIO IS `/`. It used to be `/studio`, a page this hub rendered
      // itself; DDR-209 deleted that and the cell now proxies the real studio at
      // the root. Signing in still sent people to `/studio`, which the proxy
      // correctly refuses as an unclassified route — so a member completed
      // sign-in and landed on `{"error":"not found"}`.
      redirect(response, takeReturnTo(request, response));
      return true;
    }
    page(response, 405, 'Not here', 'Open the project from the start page.');
    return true;
  }

  if (path !== '/auth/browser') return false;
  if (method !== 'GET') {
    page(response, 405, 'Not here', 'Open the project from your dashboard.');
    return true;
  }

  const url = new URL(request.url, 'http://cell.invalid');
  const code = url.searchParams.get('code');
  const denied = url.searchParams.get('denied');
  if (denied) {
    // B2 — the refusal travels back from the control plane as a reason, never
    // as a 404: the person must learn what to do, and must NOT learn whether
    // the project exists.
    page(
      response,
      403,
      'You do not have access',
      'This project is not shared with your Maude account. If you think it should be, ask whoever runs it to invite you.',
      env.HUB_DASHBOARD_URL ? { href: env.HUB_DASHBOARD_URL, label: 'Go to your dashboard' } : null
    );
    return true;
  }
  if (!code) {
    page(response, 400, 'Something is missing', 'Open the project from your dashboard.');
    return true;
  }

  const controlPlane = env.MAUDE_CONTROL_PLANE_URL ?? 'https://cloud.maude.sh';
  let exchanged = null;
  try {
    const res = await fetchImpl(`${controlPlane}/auth/handoff/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(15_000),
    });
    exchanged = await res.json();
    if (!res.ok || !exchanged?.token) throw new Error(exchanged?.error ?? `HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[hub] browser sign-in exchange failed: ${err.message}`);
    page(
      response,
      400,
      'That link has expired',
      'Sign-in links are good for a couple of minutes. Open the project from your dashboard again.',
      env.HUB_DASHBOARD_URL ? { href: env.HUB_DASHBOARD_URL, label: 'Go to your dashboard' } : null
    );
    return true;
  }

  // Same verification the desktop's /auth/login does — including the
  // revocation registry, so a removed member cannot ride a token they still
  // hold (Phase 23 B2's lesson, re-applied to the new door rather than
  // re-implemented).
  const result = authenticateForMode(
    { token: exchanged.token },
    { revoked: (email, issuedAt) => isRevoked(dataDir, email, issuedAt) }
  );
  if (!result.ok) {
    page(response, 403, 'You do not have access', 'Ask whoever runs this project to invite you.');
    return true;
  }

  const user = result.user;
  const ttlMs = Math.max(
    60_000,
    Math.min(
      result.expiresAt ?? Date.now() + STUDIO_SESSION_TTL_MS,
      Date.now() + STUDIO_SESSION_TTL_MS
    ) - Date.now()
  );
  // The role the control plane vouched for, in the PROJECT vocabulary — the
  // same translation /auth/login makes (C1).
  const projectRole = projectRoleForAccount(user.role);
  const minted = addToken(dataDir, {
    label: `studio-${Math.random().toString(36).slice(2, 10)}`,
    scope: user.scope ?? '*',
    owner: user.email,
    expiresAt: Date.now() + ttlMs,
    role: projectRole,
    readOnly: isReadOnlyRole(projectRole),
  });
  setSessionCookie(response, minted.value, ttlMs / 1000);
  redirect(response, takeReturnTo(request, response));
  return true;
}

/**
 * Read a form body. Same bounds as `readJsonBody` (server.mjs): a size cap
 * that REJECTS rather than truncates, and a read timeout that destroys the
 * socket — without it a client could hold the two form doors open by
 * trickling bytes (security review 2026-08-21, F6). Rejects; callers answer
 * 400 and never let the throw reach the request loop.
 */
export async function readForm(request, max = 8 * 1024, timeoutMs = 15_000) {
  const chunks = [];
  let size = 0;
  const onTimeout = () => {
    try {
      request.destroy(new Error('request body timeout'));
    } catch {
      /* ignore */
    }
  };
  try {
    request.setTimeout?.(timeoutMs, onTimeout);
  } catch {
    /* best-effort */
  }
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) {
      try {
        request.destroy();
      } catch {
        /* ignore */
      }
      throw new Error('body too large');
    }
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The self-hosted door's sign-in page.
 *
 * It renders the OIDC button whenever a mode is set, because `oidcButton`'s
 * own contract says so — and because for a while nothing here called it, so
 * `/auth/oidc/start` worked while being unreachable from the UI (M6's sibling
 * in the AWS spike: OIDC verified fine and no one could find the door).
 *
 * Under `strict` the password form is not merely redundant, it is a LIE:
 * `cloud-identity` refuses passwords outright (`password-refused-oidc-strict`),
 * so a form shown there can only produce a failed attempt. Strict renders the
 * provider link alone.
 */
export function signInPage(error = null, env = process.env) {
  const esc = escapeHtml;
  const oidc = oidcButton(env);
  const passwordsRefused = env.HUB_OIDC_MODE === 'strict';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0e1014; color:#e9ecf3;
         font:15px/1.6 -apple-system, system-ui, sans-serif; padding:24px; }
  form { width:min(22rem, 100%); }
  h1 { font-size:1.3rem; margin:0 0 1rem; }
  label { display:block; font-size:12px; color:#828b9e; margin:12px 0 4px; }
  input { width:100%; padding:9px 11px; border-radius:9px; border:1px solid #262c38;
          background:#14171d; color:inherit; font:inherit; }
  button { margin-top:16px; width:100%; padding:10px; border:0; border-radius:9px;
           background:#7a86f8; color:#0f1020; font:inherit; font-weight:650; cursor:pointer; }
  .err { color:#f0a3a3; font-size:13px; margin-top:10px; }
  .button { display:block; margin-top:16px; padding:10px; border-radius:9px; text-align:center;
            border:1px solid #262c38; background:#14171d; color:inherit; text-decoration:none; font-weight:600; }
  .or { margin:18px 0 0; text-align:center; font-size:12px; color:#828b9e; }
</style></head>
<body><form method="post" action="/studio/signin">
  <h1>Sign in to this workspace</h1>
  ${
    passwordsRefused
      ? ''
      : `<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus>
  <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>`
  }
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  ${oidc && !passwordsRefused ? '<p class="or">or</p>' : ''}
  ${oidc}
</form></body></html>`;
}
