// Identity routes — Cloud Phase 13. Split from worker.mjs so the router file
// stays a table of contents; every decision still lives in accounts.mjs /
// oauth-google.mjs / grants.mjs.
//
// Cookie posture: HttpOnly + Secure + SameSite=Lax + Path=/. Lax (not Strict)
// because the Google callback is a top-level cross-site navigation and the
// session cookie must survive it. CSRF exposure under Lax is POST-only, and
// every state-changing POST here either carries credentials in its body
// (signup/login) or only destroys the caller's own session (logout).

import {
  accountForGoogle,
  authenticate,
  createAccount,
  createSession,
  getAccountByEmail,
  markEmailVerified,
  revokeAccountSessions,
  revokeSession,
  sessionAccount,
  setPassword,
} from './accounts.mjs';
import { track } from './analytics.mjs';
import { dashboardPage } from './dashboard.mjs';
import { audit, getProject } from './db.mjs';
import { passwordResetEmail, sendEmail, verifyEmail } from './email.mjs';
import { consumeEmailToken, mintEmailToken, peekEmailToken } from './email-tokens.mjs';
import { mintGrant } from './grants.mjs';
import { inviteHintFor, redeemPendingInvite } from './invites.mjs';
import {
  authorizationUrl,
  exchangeCode,
  googleConfigured,
  pkcePair,
  validateCallback,
} from './oauth-google.mjs';
import { isOperator } from './operator.mjs';
import {
  checkInboxPage,
  forgotPage,
  homePage,
  loginPage,
  messagePage,
  resetPage,
  signupPage,
  verifiedPage,
} from './pages.mjs';
import { can } from './project-access.mjs';

// Exported since Cloud Phase 26: the operator surface derives its CSRF token
// from the session this names, so the two must agree on the cookie by
// reference rather than by a second string literal.
export const SESSION_COOKIE = 'maude_session';
const OAUTH_COOKIE = 'maude_oauth';

function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
  });
}

function redirect(location, extraHeaders = {}) {
  return new Response(null, { status: 303, headers: { location, ...extraHeaders } });
}

/**
 * A completed sign-in's 303: the session cookie, plus — when this browser
 * remembered an invitation (S9 Q6) — that invitation redeemed into the account
 * and its reminder cleared (S6↔S9 §5.1 step 5). Every sign-in completion ends
 * here, so none of them can forget the invitation. Each cookie is its own
 * Set-Cookie header (see the Google callback for why one joined header kills
 * the session).
 */
async function signedInRedirect(env, request, account, location, { ctx = null, extra = [] } = {}) {
  const headers = new Headers({ location });
  const session = await createSession(env.DB, account.id);
  headers.append('set-cookie', setCookie(SESSION_COOKIE, session.token));
  for (const c of extra) headers.append('set-cookie', c);
  try {
    const pending = await redeemPendingInvite(env, request, account, { ctx });
    if (pending.clear) headers.append('set-cookie', pending.clear);
  } catch (err) {
    // An invitation that cannot be redeemed right now must not undo a
    // sign-in that already succeeded; the person can still follow the link.
    console.error(`[auth] pending invitation not redeemed: ${err.message}`);
  }
  return new Response(null, { status: 303, headers });
}

/**
 * The post-sign-in destination, or null. Same-origin RELATIVE paths only —
 * `//evil.example` and absolute URLs are open-redirect food, so anything that
 * is not a plain in-app path falls back to the dashboard.
 */
function safeNext(url) {
  const next = url.searchParams.get('next') ?? '';
  return isSameOriginPath(next) ? next : null;
}

/**
 * A plain in-app path, or nothing.
 *
 * The backslash exclusion is load-bearing (validate 2026-07-30, defender F3):
 * `/\evil.example` passes a naive "starts with one slash" test, but WHATWG URL
 * parsing normalizes `\` to `/`, so the browser reads `Location: /\evil.example`
 * as `https://evil.example/`. Anything that is not printable ASCII, or carries
 * a backslash, or begins `//`, is refused.
 */
export function isSameOriginPath(next) {
  return typeof next === 'string' && /^\/(?![/\\])[\x20-\x7e]*$/.test(next) && !next.includes('\\');
}

function cookieValue(request, name) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function setCookie(name, value, { maxAge = 30 * 24 * 3600, httpOnly = true } = {}) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure${httpOnly ? '; HttpOnly' : ''}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`;
}

/**
 * The signed-in account, or null.
 *
 * Exported so every surface reads a session the same way. Two places that both
 * "just read the cookie" is how one of them ends up not checking expiry.
 */
export async function currentAccount(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  return token ? sessionAccount(env.DB, token) : null;
}

/**
 * Every project this person can see, with the role they hold in each.
 *
 * Owned and member-of in one list, because "which of these do I own" is not a
 * question anybody asks — they want to see their work.
 *
 * A failure here yields an EMPTY list, not an error page: a dashboard that
 * cannot list projects should still let somebody sign out, reach their
 * account, and read that something is wrong.
 */
async function projectsFor(env, accountId) {
  try {
    const rows = await env.DB.prepare(
      `SELECT p.id, p.name, p.state,
              CASE WHEN p.account_id = ?1 THEN 'owner' ELSE m.role END AS role
         FROM projects p
         LEFT JOIN project_members m
           ON m.project_id = p.id AND m.account_id = ?1
        WHERE p.account_id = ?1 OR m.account_id IS NOT NULL
        ORDER BY p.name`
    )
      .bind(accountId)
      .all();
    return rows?.results ?? [];
  } catch {
    return [];
  }
}

/**
 * Mail somebody the link that confirms their address. Best-effort by design.
 *
 * `sendEmail` never throws and reports rather than raises, so a provider
 * outage cannot turn a signup into a 500 — the account exists either way and
 * the person can ask for another link. Silence here is the correct failure:
 * telling a visitor "we could not send mail" invites them to retry a thing
 * that is not theirs to fix.
 */
async function sendVerifyLink(env, origin, account) {
  const { token } = await mintEmailToken(env.DB, { accountId: account.id, purpose: 'verify' });
  await sendEmail(env, {
    to: account.email,
    ...verifyEmail({ verifyUrl: `${origin}/auth/verify?t=${token}` }),
  });
}

/**
 * Route the identity surface. Returns a Response, or null when the path is
 * not ours (worker.mjs falls through to its own routes).
 */
export async function handleAuth(request, env, { ctx = null, account: given } = {}) {
  // The caller has already read the session (worker.mjs reads it once, above
  // the router, so the page-view lane can see it). `undefined` means "not
  // provided"; `null` is a real answer and means signed out.
  const session = async () => (given === undefined ? currentAccount(request, env) : given);
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const google = googleConfigured(env);

  // ------------------------------------------------------------------ pages
  if (method === 'GET' && pathname === '/') {
    // Signed in? Then "/" IS the dashboard (Cloud Phase 22 / DDR-204). A
    // signed-in person landing on a marketing page and having to find a link
    // to their own work is the shape this phase exists to remove.
    const account = await session();
    if (!account) return html(homePage({ account: null, googleEnabled: google }));
    // The Fleet nav is gated at the shell as well as at the route, so an
    // allowlisted operator needs ONE page that offers the way in. This is it —
    // for anyone else `isOperator` is false and the shell is what it was.
    return html(
      dashboardPage({
        account,
        projects: await projectsFor(env, account.id),
        can,
        isOperator: isOperator(env, account),
      })
    );
  }
  if (method === 'GET' && pathname === '/signup') {
    const next = safeNext(url);
    return html(signupPage({ googleEnabled: google, next, email: await inviteHintFor(env, next) }));
  }
  if (method === 'GET' && pathname === '/login') {
    const next = safeNext(url);
    return html(
      loginPage({
        googleEnabled: google,
        next,
        email: await inviteHintFor(env, next),
        host: url.host,
      })
    );
  }

  // ----------------------------------------------------------------- signup
  if (method === 'POST' && pathname === '/auth/signup') {
    // Carried like login's: a new person who arrived from the app (or an
    // invitation) must land back there, not on a dashboard (S9.14).
    const next = safeNext(url);
    const form = await request.formData();
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const disclosure = form.get('disclosure') === 'yes';
    if (!disclosure) {
      return html(
        signupPage({
          googleEnabled: google,
          next,
          error: 'Please confirm you’ve read what Maude Cloud stores.',
        }),
        400
      );
    }
    try {
      const account = await createAccount(env.DB, { email, password });
      // Consent is recorded only when the box was actually ticked — and the
      // timestamp is the moment of signup, where the decision happened.
      await env.DB.prepare('UPDATE accounts SET disclosure_accepted_at = ? WHERE id = ?')
        .bind(Date.now(), account.id)
        .run();
      await audit(env.DB, {
        accountId: account.id,
        actor: `customer:${account.email}`,
        action: 'signup',
      });
      // The address is unconfirmed until somebody follows a link we mailed to
      // it, and unconfirmed is what makes `accountForGoogle` refuse this
      // account later. Sending it HERE is what turns that refusal from a dead
      // end into a step (RCA 2026-08-04).
      await sendVerifyLink(env, url.origin, account);
      track(env, ctx, { name: 'signup', accountId: account.id, props: { method: 'password' } });
      return signedInRedirect(env, request, account, next ?? '/', { ctx });
    } catch (err) {
      // One neutral sentence for both "exists" and validation shapes the user
      // can fix; the distinction lives in logs, not in the response.
      const friendly =
        err.code === 'account-exists'
          ? 'That address can’t be used here. If it’s yours, try signing in.'
          : 'That didn’t work — check the address and use at least 12 characters.';
      return html(signupPage({ googleEnabled: google, next, error: friendly }), 400);
    }
  }

  // ------------------------------------------------------------------ login
  if (method === 'POST' && pathname === '/auth/login') {
    const next = safeNext(url);
    const form = await request.formData();
    const verdict = await authenticate(
      env.DB,
      String(form.get('email') ?? ''),
      String(form.get('password') ?? '')
    );
    if (!verdict.ok) {
      // No account id, because there may be no account — and the reason is one
      // of three declared values, never the address that was tried.
      track(env, ctx, { name: 'login_failed', props: { reason: 'bad-password' } });
      return html(
        loginPage({
          googleEnabled: google,
          error: 'That email and password don’t match.',
          next,
          host: url.host,
        }),
        401
      );
    }
    track(env, ctx, {
      name: 'login',
      accountId: verdict.account.id,
      props: { method: 'password' },
    });
    return signedInRedirect(env, request, verdict.account, next ?? '/', { ctx });
  }

  // ------------------------------------------- confirming an address / reset
  //
  // Both flows hang off email-tokens.mjs: a link, mailed to the address,
  // single-use and expiring. Together they are the two doors the RCA of
  // 2026-08-04 found missing — without the first, a password account could
  // never link Google; without the second, a forgotten password was the end of
  // the account.

  if (method === 'GET' && pathname === '/forgot') {
    return html(forgotPage({ next: safeNext(url) }));
  }

  if (method === 'POST' && pathname === '/auth/forgot') {
    const form = await request.formData();
    const account = await getAccountByEmail(env.DB, String(form.get('email') ?? ''));
    if (account) {
      const { token } = await mintEmailToken(env.DB, {
        accountId: account.id,
        purpose: 'reset',
      });
      await sendEmail(env, {
        to: account.email,
        ...passwordResetEmail({ resetUrl: `${url.origin}/auth/reset?t=${token}` }),
      });
      await audit(env.DB, {
        accountId: account.id,
        actor: `customer:${account.email}`,
        action: 'password-reset-requested',
      });
    }
    // ONE answer for both branches, and no branch that is cheaper than the
    // other in any way a stranger can observe. An unauthenticated form that
    // says "no account with that address" is a membership oracle over the
    // entire customer list.
    return html(checkInboxPage());
  }

  if (method === 'GET' && pathname === '/auth/reset') {
    const token = url.searchParams.get('t') ?? '';
    // PEEK, not consume: a mail client's link preview, a safe-browsing
    // prefetch, or a plain refresh would otherwise spend the link before the
    // person has typed anything, and the flow would appear broken to exactly
    // the people whose mail provider is most careful.
    const seen = await peekEmailToken(env.DB, token, 'reset');
    if (!seen.ok) {
      return html(
        messagePage(
          'That link has expired',
          'Password links work once and expire after an hour. <a href="/forgot">Ask for a new one</a>.'
        ),
        410
      );
    }
    return html(resetPage({ token }));
  }

  if (method === 'POST' && pathname === '/auth/reset') {
    const form = await request.formData();
    const token = String(form.get('t') ?? '');
    const password = String(form.get('password') ?? '');
    const spent = await consumeEmailToken(env.DB, token, 'reset');
    if (!spent.ok) {
      return html(
        messagePage(
          'That link has expired',
          'Password links work once and expire after an hour. <a href="/forgot">Ask for a new one</a>.'
        ),
        410
      );
    }
    try {
      // Sets the password AND confirms the address: reaching this line
      // required holding a link we mailed there, which is the same proof the
      // verification flow collects.
      await setPassword(env.DB, spent.accountId, password);
    } catch {
      // The link is already spent, so re-rendering the form would hand back a
      // dead one. Sending them round again is the honest answer for a rule
      // ("12 characters") the form already stated.
      return html(
        messagePage(
          'That password is too short',
          'Passwords need at least 12 characters. <a href="/forgot">Ask for a new link</a> and try again.'
        ),
        400
      );
    }
    // A reset is what somebody does when they suspect they lost control of the
    // account. Leaving existing sessions alive would make it a password change
    // and nothing more.
    await revokeAccountSessions(env.DB, spent.accountId);
    await audit(env.DB, {
      accountId: spent.accountId,
      actor: `customer:${spent.accountId}`,
      action: 'password-reset',
    });
    const session = await createSession(env.DB, spent.accountId);
    return redirect('/', { 'set-cookie': setCookie(SESSION_COOKIE, session.token) });
  }

  if (method === 'GET' && pathname === '/auth/verify') {
    const spent = await consumeEmailToken(env.DB, url.searchParams.get('t') ?? '', 'verify');
    if (!spent.ok) {
      return html(
        messagePage(
          'That link has expired',
          'Confirmation links work once and expire after a day. Sign in and a new one is sent to you.'
        ),
        410
      );
    }
    await markEmailVerified(env.DB, spent.accountId);
    await audit(env.DB, {
      accountId: spent.accountId,
      actor: `customer:${spent.accountId}`,
      action: 'email-verified',
    });
    // Deliberately NOT a sign-in. A confirmation link is long-lived and sits in
    // an inbox; making it also a session would quietly turn every old mail into
    // a credential. Confirming is all it claims to do.
    return html(verifiedPage({ googleEnabled: google }));
  }

  if (method === 'POST' && pathname === '/auth/logout') {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await revokeSession(env.DB, token);
    // Sign-out can be a step rather than an exit: an invitation addressed to
    // somebody else needs you to leave THIS session and come straight back to
    // the same link. Same-origin paths only — `safeNext`'s rules, applied to a
    // form field instead of a query string, because logout is a POST.
    let back = null;
    try {
      const form = await request.formData();
      const asked = String(form.get('next') ?? '');
      if (isSameOriginPath(asked)) back = asked;
    } catch {
      /* no body — the ordinary sign-out button */
    }
    return redirect(back ?? '/', { 'set-cookie': clearCookie(SESSION_COOKIE) });
  }

  if (method === 'GET' && pathname === '/auth/session') {
    const account = await session();
    return account
      ? json({ ok: true, account: { email: account.email, name: account.name } })
      : json({ ok: false }, 401);
  }

  // ----------------------------------------------------------------- google
  if (method === 'GET' && pathname === '/auth/google') {
    if (!google) {
      return html(
        messagePage(
          'Sign-in is not ready',
          'Google sign-in is not configured here yet. Use email and password instead.'
        ),
        503
      );
    }
    const { verifier, challenge, state } = await pkcePair();
    // Verifier+state (+ the optional return path, URI-encoded so it cannot
    // collide with the dot separators) ride a short-lived HttpOnly cookie —
    // the only place the browser can hold them without script access.
    const next = safeNext(url);
    const location = authorizationUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri: `${url.origin}/auth/google/callback`,
      challenge,
      state,
      hint: await inviteHintFor(env, next),
    });
    const jar = `${state}.${verifier}${next ? `.${encodeURIComponent(next)}` : ''}`;
    return redirect(location, {
      'set-cookie': setCookie(OAUTH_COOKIE, jar, { maxAge: 600 }),
    });
  }

  if (method === 'GET' && pathname === '/auth/google/callback') {
    if (!google) return json({ ok: false }, 503);
    const stored = cookieValue(request, OAUTH_COOKIE) ?? '';
    // state/verifier are base64url (never contain '.'); everything after the
    // second dot is the encoded return path — which MAY contain dots, hence
    // the rejoin. Re-validated like any `next` before use.
    const [cookieState, verifier, ...nextParts] = stored.split('.');
    let next = null;
    try {
      const decoded = nextParts.length ? decodeURIComponent(nextParts.join('.')) : '';
      if (isSameOriginPath(decoded)) next = decoded;
    } catch {
      next = null;
    }
    const check = validateCallback({
      queryState: url.searchParams.get('state'),
      cookieState,
      code: url.searchParams.get('code'),
    });
    if (!check.ok) {
      return html(
        messagePage('Sign-in didn’t complete', 'Please try again from the sign-in page.'),
        400,
        { 'set-cookie': clearCookie(OAUTH_COOKIE) }
      );
    }
    const exchange = await exchangeCode({
      code: url.searchParams.get('code'),
      verifier,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${url.origin}/auth/google/callback`,
    });
    if (!exchange.ok) {
      return html(
        messagePage(
          'Sign-in didn’t complete',
          'Google didn’t confirm the sign-in. Please try again.'
        ),
        502,
        { 'set-cookie': clearCookie(OAUTH_COOKIE) }
      );
    }
    const resolved = await accountForGoogle(env.DB, exchange.claims);
    if (resolved.action === 'refused') {
      if (resolved.reason === 'unverified-password-account') {
        // The refusal itself is right — an unconfirmed password account must
        // not capture a Google sign-in. What was wrong (RCA 2026-08-04) was the
        // instruction it gave: it told people to sign in with their password
        // "and then connect Google from settings", and neither half existed.
        // Signing in changed nothing, there was no settings surface, and there
        // was no way at all to confirm the address — so this screen was a wall
        // with directions painted on it.
        //
        // Google has just vouched for this address (`emailVerified` is checked
        // upstream), so the person standing here is its owner. Mailing them the
        // confirmation link makes the next sentence true. It is also why this
        // needs no rate limit of its own: reaching this line costs a completed
        // Google sign-in for the address being mailed.
        const existing = await getAccountByEmail(env.DB, exchange.claims.email);
        if (existing) await sendVerifyLink(env, url.origin, existing);
        return html(
          messagePage(
            'One more step',
            'An account with this address already exists, and the address isn’t confirmed yet. ' +
              'Maude Cloud just emailed you a link — follow it and Google will work here.'
          ),
          409,
          { 'set-cookie': clearCookie(OAUTH_COOKIE) }
        );
      }
      return html(
        messagePage(
          'Sign-in didn’t complete',
          'Google didn’t vouch for this address, so it can’t be used to sign in.'
        ),
        409,
        { 'set-cookie': clearCookie(OAUTH_COOKIE) }
      );
    }
    if (resolved.action === 'created') {
      await audit(env.DB, {
        accountId: resolved.account.id,
        actor: `customer:${resolved.account.email}`,
        action: 'signup-google',
      });
    }
    // A first Google sign-in is a signup AND a login; recorded as whichever it
    // was, so the funnel does not double-count the same moment.
    track(env, ctx, {
      name: resolved.action === 'created' ? 'signup' : 'login',
      accountId: resolved.account.id,
      props: { method: 'google' },
    });
    // Two cookies = two Set-Cookie HEADERS. Joining them with ", " into one
    // header made the browser read the whole string as ONE cookie whose later
    // `Max-Age=0` (from the oauth clear) overrode the session's — the session
    // died on arrival and Google sign-in silently bounced back to the landing
    // page signed out. `signedInRedirect` appends each one separately.
    return signedInRedirect(env, request, resolved.account, next ?? '/', {
      ctx,
      extra: [clearCookie(OAUTH_COOKIE)],
    });
  }

  // ------------------------------------------------- project grant minting
  if (method === 'POST' && /^\/api\/projects\/[a-z0-9-]+\/token$/.test(pathname)) {
    const account = await session();
    if (!account) return json({ ok: false }, 401);
    const projectId = pathname.split('/')[3];
    const project = await getProject(env.DB, projectId);
    // Same 404 for "doesn't exist" and "isn't yours" — a probe learns nothing.
    if (!project || project.account_id !== account.id) return json({ ok: false }, 404);
    if (!env.GRANT_SIGNING_SECRET) return json({ ok: false, error: 'grants not configured' }, 503);
    const grant = await mintGrant(
      { projectId, accountId: account.id, email: account.email },
      env.GRANT_SIGNING_SECRET
    );
    await audit(env.DB, {
      accountId: account.id,
      projectId,
      actor: `customer:${account.email}`,
      action: 'grant-minted',
    });
    return json({ ok: true, grant });
  }

  return null;
}

export { getAccountByEmail }; // re-export for tests' convenience
