// User login + user administration routes — Cloud Phase 2 Task 1 (DDR-192 §3).
//
// Two surfaces, deliberately separated:
//
//   /auth/*            UNAUTHENTICATED (login) or peer-token-authenticated
//                      (logout). This is the HUMAN sign-in path. A successful
//                      login mints a scoped, EXPIRING peer token on the
//                      existing HMAC spine — the thing a person used to copy
//                      out of a terminal by hand and keep forever.
//   /admin/api/users/* ADMIN BEARER only (gated by the caller, before we are
//                      reached). Operator surface: create, disable, delete.
//
// The DDR-053 admin Bearer is NOT a user credential and never becomes one:
// there is no route here that turns a user password into admin access.
//
// Offboarding is the property the phase's exit gate names — "offboarding one
// user touches nobody else's credentials" — so every mutation here revokes by
// `owner` (an exact match in tokens.mjs), never by prefix or label pattern.

import { randomBytes } from 'node:crypto';

import {
  formOriginAllowed,
  readForm,
  respondHtml,
  STUDIO_SESSION_TTL_MS,
  setSessionCookie,
} from './browser-auth.mjs';
import { authenticateForMode, cloudIdentityStrict } from './cloud-identity.mjs';
import {
  createInvite,
  inviteUrl,
  listInvites,
  peekInvite,
  redeemInvite,
  revokeInvite,
  revokeInvitesForEmail,
} from './invites.mjs';
import { joinPage } from './join-page.mjs';
import { isRevoked } from './revocations.mjs';
import { isReadOnlyRole, projectRoleForAccount } from './role-matrix.mjs';
import { servicePage } from './studio-door.mjs';

import {
  addToken,
  listTokensForOwner,
  removeToken,
  revokeTokensForOwner,
  verifyToken,
} from './tokens.mjs';
import {
  approveOidcSub,
  authenticate,
  createUser,
  getUser,
  linkOidcSub,
  listPendingOidc,
  listUsers,
  removePendingOidc,
  removeUser,
  setUserDisabled,
  setUserPassword,
  userCount,
} from './users.mjs';

/** Default peer-token lifetime: 30 days. Override with HUB_USER_TOKEN_TTL_HOURS. */
const DEFAULT_TTL_HOURS = 24 * 30;

export function userTokenTtlMs(env = process.env) {
  const raw = Number(env.HUB_USER_TOKEN_TTL_HOURS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_HOURS * 3600_000;
  // Clamp to a year. An unbounded TTL would quietly recreate the forever-token
  // this whole mechanism exists to retire.
  return Math.min(raw, 24 * 365) * 3600_000;
}

/** `u-<12hex>` — inside tokens.mjs's LABEL_REGEX, and not derived from the
 *  address (an email does not fit the label charset, and encoding one there
 *  would leak the user list to anyone who can read token labels). */
function mintLabel() {
  return `u-${randomBytes(6).toString('hex')}`;
}

/** Bearer value from an Authorization header, or null. */
export function bearerFrom(request) {
  const raw = request?.headers?.authorization;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

/**
 * True when this hub must refuse the permissive dev path (empty token store +
 * no HUB_SECRET ⇒ any token authenticates).
 *
 * That path is a genuine convenience for a scratch hub on a laptop, and a
 * catastrophe the moment a hub has real users: it would let an unauthenticated
 * stranger read and write every document. So the moment ONE user exists — or
 * the operator declares workspace mode — it is off, permanently and without a
 * flag to turn back on.
 */
export function permissiveDevAuthDisabled(dataDir, env = process.env) {
  if (env.HUB_WORKSPACE_MODE === '1') return true;
  return userCount(dataDir) > 0;
}

/**
 * Handle `/auth/*`. Returns true when the request was handled.
 *
 * @param {object} ctx
 * @param {import('node:http').IncomingMessage} ctx.request
 * @param {import('node:http').ServerResponse} ctx.response
 * @param {string} ctx.path            pathname (already sliced of any prefix)
 * @param {string} ctx.method
 * @param {string} ctx.dataDir
 * @param {string} ctx.secret          HUB_SECRET (for verifyToken)
 * @param {(request: any) => boolean} [ctx.checkRateLimit]
 * @param {() => void} ctx.respondRateLimited
 * @param {(status: number, payload: unknown) => void} ctx.respondJson
 * @param {(request: any) => Promise<any>} ctx.readJsonBody
 * @param {(label: string) => number} ctx.kickLabel
 * @param {(event: { type: string, user: string, doc: string }) => void} ctx.pushActivity
 */
export async function handleAuthRoutes(ctx) {
  const { path, method, dataDir, secret, respondJson, readJsonBody } = ctx;

  if (method === 'POST' && path === '/auth/login') {
    // Login is the brute-force surface. Rate-limit BEFORE touching scrypt, so
    // a flood costs the attacker a request and costs us nothing.
    if (ctx.checkRateLimit && !ctx.checkRateLimit(ctx.request)) {
      ctx.respondRateLimited();
      return true;
    }
    let body;
    try {
      body = await readJsonBody(ctx.request);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    // Cloud Phase 22 (DDR-204). In cloud mode this hub has no passwords of its
    // own — identity comes from the Maude account, and the person arrives with
    // a project-scoped token instead. One function, two configurations: a
    // separate cloud path would leave the self-hosted one to rot.
    const result = authenticateForMode(
      { email: body?.email, password: body?.password, token: body?.token },
      {
        // What the revocation sweep LEARNED, this door READS (validate
        // 2026-07-30, attacker A2/A3). Without it the sweep only killed
        // sessions: a removed member re-presented the project token they
        // already held — verified offline, valid up to 12 h — and collected a
        // fresh session every time the clock killed one.
        revoked: (email, issuedAt) => isRevoked(dataDir, email, issuedAt),
        local: (email, password) => authenticate(dataDir, email, password),
        // No explicit secret: token verification resolves its OWN key
        // (MAUDE_PROJECT_TOKEN_KEY, falling back to HUB_SECRET pre-B4).
      }
    );
    if (result.reason === 'cloud-identity') {
      // The ONE failure that is not an opaque "invalid email or password":
      // nothing is wrong with what they typed, the thing they typed into does
      // not exist here. Telling them where to go instead is the whole point.
      respondJson(400, { error: result.message });
      return true;
    }
    if (!result.ok) {
      // ONE opaque message for every failure mode. The distinction between
      // "no such account", "wrong password" and "disabled" is a user-existence
      // oracle; it stays in the server log, never on the wire.
      console.warn(
        `[hub] login rejected (${result.reason}) for ${String(body?.email ?? '').slice(0, 120)}`
      );
      respondJson(401, { error: 'invalid email or password' });
      return true;
    }

    const user = result.user;
    // A token-exchanged session dies WITH the project token that minted it
    // (Phase 23 B2) — never the default 30 days beyond the removal window.
    const expiresAt = Math.min(Date.now() + userTokenTtlMs(), result.expiresAt ?? Infinity);
    // Cloud Phase 27: TRANSLATED first. `user.role` is an ACCOUNT role
    // ('admin' | 'member'); the token stores a PROJECT role. Passing one to
    // the other made every admin's session read-only — right for 'member' by
    // coincidence, wrong for 'admin' because an unknown role gets nothing.
    const projectRole = projectRoleForAccount(user.role);
    const minted = addToken(dataDir, {
      label: mintLabel(),
      scope: user.scope ?? '*',
      owner: user.email,
      expiresAt,
      // Cloud Phase 25 C1. The capability is decided HERE, once, from the role
      // the control plane vouched for — not re-derived at each write surface,
      // where one forgotten branch is a viewer with an editor's session.
      //
      // STORED, not only projected (the v0.55.0 lesson): `browserSession`
      // treats a token without a stored role as no session at all, so a mint
      // that sets only the one-bit `read_only` projection produces a session
      // every HTTP write surface answers with 401. browser-auth.mjs stores the
      // role; this door forgot to — desktop/API sessions hit the same wall the
      // pre-roll stale cookies did.
      role: projectRole,
      readOnly: isReadOnlyRole(projectRole),
    });
    ctx.pushActivity?.({ type: 'login', user: user.email, doc: minted.label });
    respondJson(200, {
      token: minted.value,
      label: minted.label,
      scope: minted.scope ?? '*',
      expiresAt,
      user: { email: user.email, role: user.role },
    });
    return true;
  }

  if (method === 'POST' && path === '/auth/logout') {
    // Authenticated by the peer token being surrendered — no password, and
    // deliberately no way to log out anyone else.
    const presented = bearerFrom(ctx.request);
    const match = presented ? verifyToken(dataDir, presented, secret) : null;
    if (!match?.owner) {
      respondJson(401, { error: 'not a user session token' });
      return true;
    }
    try {
      removeToken(dataDir, match.label);
    } catch {
      /* already gone — logging out twice is not an error */
    }
    const kicked = ctx.kickLabel?.(match.label) ?? 0;
    ctx.pushActivity?.({ type: 'logout', user: match.owner, doc: match.label });
    respondJson(200, { ok: true, kicked });
    return true;
  }

  if (method === 'GET' && path === '/auth/session') {
    const presented = bearerFrom(ctx.request);
    const match = presented ? verifyToken(dataDir, presented, secret) : null;
    if (!match?.owner) {
      respondJson(401, { error: 'not a user session token' });
      return true;
    }
    const user = getUser(dataDir, match.owner);
    respondJson(200, {
      label: match.label,
      scope: match.scope ?? '*',
      expiresAt: match.expiresAt ?? null,
      user: user ? { email: user.email, role: user.role, disabled: user.disabled } : null,
    });
    return true;
  }

  // ---- Cloud Phase 6 — magic-link invites -------------------------------

  // TWO CLIENTS, ONE DOOR. A browser navigation (`Accept: text/html`) gets a
  // page it can read and a form it can submit; an API caller (the desktop, a
  // script, the tests) gets the JSON it always got. The split is the same one
  // the studio door makes on its sign-in verdict — a fetch() handed a page
  // shows nothing, a person handed JSON reads `{"ok":true,…}` and stops. Which
  // is exactly what the invited teammate saw for the first year of this route.
  //
  // TWO KEYS, and they are different headers: page-or-JSON is decided by
  // `Accept`; cookie-or-bearer (below) by the request `Content-Type`. They can
  // disagree (`Accept: text/html` + a JSON body → a bearer, in JSON, to a
  // browser) and that is fine — only the form body ever sets a cookie.
  const wantsHtml = (ctx.request?.headers?.accept ?? '').includes('text/html');
  const respondPage = (status, html) => respondHtml(ctx.response, status, html);
  const env = ctx.env ?? process.env;

  // Retired under strict cloud identity (Phase 23 B6): every door into a
  // cloud cell is the control plane's — a hub-local invite would mint exactly
  // the local credential strict exists to end. One message, both verbs.
  if (cloudIdentityStrict() && (path === '/join' || path.startsWith('/join/'))) {
    const error =
      'Invitations for this workspace are sent from its Maude Cloud dashboard now. Ask whoever runs the project to add you there.';
    if (wantsHtml) respondPage(410, servicePage('Not here', error));
    else respondJson(410, { ok: false, error });
    return true;
  }

  // GET /join/<token> — LOOK, never consume. A crawler, a link preview, or a
  // corporate mail scanner following the link must not be able to burn the
  // invite; that is otherwise a very ordinary way for one to arrive already
  // used. Redemption is the POST below.
  if (method === 'GET' && path.startsWith('/join/')) {
    // A mangled link — `…/join/inv_ab%` off a wrapped line in a mail client —
    // is now the ordinary case, not an edge. `decodeURIComponent` THROWS on a
    // bad percent-escape, and a throw out of this handler does not make a
    // 500: it takes the hub process down (Hocuspocus rethrows anything that is
    // not the bail sentinel). Security defender finding F1, 2026-08-21: one
    // anonymous GET, every collab socket gone. A bad escape is simply an
    // invite that does not exist.
    let value = null;
    try {
      value = decodeURIComponent(path.slice('/join/'.length));
    } catch {
      value = null;
    }
    const check = value ? peekInvite(dataDir, value) : { ok: false, reason: 'unknown' };
    if (!check.ok) {
      const error = inviteProblem(check.reason);
      if (wantsHtml) respondPage(410, servicePage('This invitation no longer works', error));
      else respondJson(410, { ok: false, reason: check.reason, error });
      return true;
    }
    if (wantsHtml) {
      // The welcome page. It carries the token ONLY as the form's hidden
      // field, so the redeem travels in a POST body — never a URL the browser
      // then navigates away from.
      respondPage(
        200,
        joinPage({ token: value, workspace: ctx.publicUrl ?? null, email: check.invite.email, env })
      );
      return true;
    }
    respondJson(200, {
      ok: true,
      // Plain words for the landing page. No token echo — the client already
      // has it, and echoing it puts it somewhere new.
      workspace: ctx.publicUrl ?? null,
      needsEmail: !check.invite.email,
      email: check.invite.email,
      expiresAt: check.invite.expiresAt,
    });
    return true;
  }

  // POST /join — redeem. A POST because a token in a URL the browser then
  // navigates away from lands in Referer headers and in every proxy log on the
  // way.
  //
  // Two bodies, one redeem: `application/json` from an API caller (answered
  // with a bearer token), `application/x-www-form-urlencoded` from the landing
  // page's form (answered with the SAME session the self-hosted sign-in door
  // sets — a `maude_studio` cookie — and a redirect into the studio at `/`).
  if (method === 'POST' && path === '/join') {
    if (ctx.checkRateLimit && !ctx.checkRateLimit(ctx.request)) {
      ctx.respondRateLimited();
      return true;
    }
    const contentType = String(ctx.request?.headers?.['content-type'] ?? '').toLowerCase();
    const isForm = contentType.startsWith('application/x-www-form-urlencoded');

    // `HUB_OIDC_MODE=strict` means the identity provider is the ONLY way in
    // (cloud-identity.mjs) — the page already shows the provider link alone
    // under strict; the POST has to refuse too, or an invite is a third
    // password door that strict never closed (defender F2): a password account
    // strict says cannot exist, and a 12 h session minted with no IdP step.
    if (env.HUB_OIDC_MODE === 'strict') {
      const error =
        'This workspace signs people in through its identity provider. Open the invitation link and sign in there.';
      if (isForm || wantsHtml) respondPage(403, servicePage('Sign in with your provider', error));
      else respondJson(403, { ok: false, reason: 'password-refused-oidc-strict', error });
      return true;
    }

    // A form POST creates an account and sets a cookie — a page elsewhere must
    // not be able to do that to a visitor (login CSRF: the attacker's invite
    // redeemed into the victim's browser, whose later work lands in an account
    // the attacker holds the password for). FAIL CLOSED on a positive signal,
    // not open on a missing one (defender F3 / attacker F1): `same-site` is
    // refused because on the cloud fleet every tenant — and the untrusted
    // canvas origin — is same-site to every other; an absent
    // `Sec-Fetch-Site` (pre-Fetch-Metadata engines) falls back to the `Origin`
    // header, which every browser of the last decade sends on a form POST.
    if (isForm && !formOriginAllowed(ctx.request, ctx.publicUrl)) {
      respondPage(403, servicePage('Not from here', 'Open the invitation link directly.'));
      return true;
    }

    let body;
    try {
      if (isForm) {
        const form = await readForm(ctx.request);
        body = {
          token: form.get('token'),
          email: form.get('email'),
          password: form.get('password'),
        };
      } else {
        body = await readJsonBody(ctx.request);
      }
    } catch (err) {
      if (isForm)
        respondPage(
          400,
          servicePage('Something went wrong', 'Open the invitation link and try again.')
        );
      else respondJson(400, { ok: false, error: err.message });
      return true;
    }
    const result = redeemInvite(dataDir, {
      value: body?.token,
      email: body?.email,
      password: body?.password,
      createAccount: ({ email, password, role }) => createUser(dataDir, { email, password, role }),
    });
    if (!result.ok) {
      const status = result.reason === 'account-failed' ? 400 : 410;
      // A duplicate address is an account-existence oracle for whoever holds
      // an OPEN invite (retry is free, the invite survives), so the store's
      // `user "x" already exists` stays in the server log and the wire gets
      // one neutral sentence (defender F4 / attacker F5).
      const taken =
        result.reason === 'account-failed' && /already exists/.test(result.detail ?? '');
      if (taken) console.warn(`[hub] invite redeem refused: ${result.detail}`);
      const error = taken
        ? "That address can't be used with this invitation. Sign in if you already have an account."
        : (result.detail ?? inviteProblem(result.reason));
      if (isForm) {
        // A typo is a retry (the invite is untouched on `account-failed`,
        // `email-required` and `email-mismatch`), so the form comes back with
        // the sentence above the button. A dead invite gets the plain page:
        // no form, nothing to retry with.
        const retryable =
          result.reason === 'account-failed' ||
          result.reason === 'email-required' ||
          result.reason === 'email-mismatch';
        const look = retryable ? peekInvite(dataDir, body?.token) : null;
        if (look?.ok) {
          respondPage(
            status,
            joinPage({
              token: body.token,
              workspace: ctx.publicUrl ?? null,
              email: look.invite.email,
              error,
              env,
            })
          );
        } else {
          respondPage(status, servicePage('This invitation no longer works', error));
        }
        return true;
      }
      respondJson(status, { ok: false, reason: result.reason, error });
      return true;
    }

    // Sign them straight in. The entire point is that they clicked a link and
    // are now working — a redeem that ends at a login form has reintroduced
    // the form it was built to remove.
    //
    // TRANSLATED, and STORED (the v0.55.0 lesson, applied here late): `user.role`
    // is an ACCOUNT role; the session carries a PROJECT role, and
    // `browserSession` treats a token without one as no session at all. Until
    // 2026-08-21 this door minted without it — a freshly invited member held a
    // token every HTTP write surface answered with 401.
    const projectRole = projectRoleForAccount(result.user.role);
    const ttlMs = isForm ? STUDIO_SESSION_TTL_MS : userTokenTtlMs();
    const expiresAt = Date.now() + ttlMs;
    const minted = addToken(dataDir, {
      label: isForm ? `studio-${randomBytes(4).toString('hex')}` : mintLabel(),
      scope: '*',
      owner: result.user.email,
      expiresAt,
      role: projectRole,
      readOnly: isReadOnlyRole(projectRole),
    });
    ctx.pushActivity?.({ type: 'invite-redeem', user: result.user.email, doc: result.invite.id });
    if (isForm) {
      // THE STUDIO IS `/` (DDR-209). Same cookie, same TTL, same landing as
      // `/studio/signin` — one session type for both doors.
      setSessionCookie(ctx.response, minted.value, ttlMs / 1000);
      ctx.response.writeHead(303, { location: '/', 'cache-control': 'no-store' });
      ctx.response.end();
      return true;
    }
    respondJson(201, {
      ok: true,
      token: minted.value,
      label: minted.label,
      expiresAt,
      user: { email: result.user.email, role: result.user.role },
    });
    return true;
  }

  return false;
}

/** One plain sentence per failure. Never mentions tokens (DDR-193 §5). */
function inviteProblem(reason) {
  switch (reason) {
    case 'email-mismatch':
      return 'This invitation was sent to a different address. Use the address it was sent to.';
    case 'expired':
      return 'This invitation has expired. Ask whoever invited you for a new link.';
    case 'already-used':
      return 'This invitation has already been used. Ask for a new link, or sign in if you already have an account.';
    case 'revoked':
      return 'This invitation was cancelled. Ask whoever invited you for a new link.';
    case 'email-required':
      return 'Enter your email address.';
    default:
      return "That invitation link isn't valid. Check you copied all of it.";
  }
}

/**
 * Handle `/users*` under the admin API. The caller has ALREADY verified the
 * admin Bearer — this function must never be reachable without it.
 *
 * Returns true when handled.
 */
export async function handleUserAdminRoutes(ctx) {
  const { path, method, dataDir, respondJson, readJsonBody } = ctx;

  // ---- OIDC pending queue + explicit linking (Track C) --------------------
  //
  // The one place a verified-but-unlinked identity becomes an account. Behind
  // the admin Bearer gate, like every other mutation here. Linking is the
  // deliberate act that sign-in refuses to perform on its own — see
  // oidc-routes.mjs for why matching on the claimed email is a takeover.
  if (method === 'GET' && path === '/oidc/pending') {
    respondJson(200, { pending: listPendingOidc(dataDir) });
    return true;
  }
  if (method === 'POST' && path === '/oidc/link') {
    let body;
    try {
      body = await readJsonBody(ctx.request);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    try {
      const user = linkOidcSub(dataDir, body?.email, body?.sub);
      ctx.pushActivity?.({ type: 'oidc-link', user: user.email, doc: String(body?.sub ?? '') });
      respondJson(200, { user });
    } catch (err) {
      respondJson(400, { error: err.message });
    }
    return true;
  }
  // POST /oidc/approve — the THIRD verb (2026-08-21). "Link" attaches a
  // subject to an account that exists; "dismiss" drops it; this one CREATES the
  // account for the address the admin confirms and links in the same step. It
  // is what an admin reaches for when the person they invited by link signed
  // in through the provider instead and sits in the queue with no account to
  // link to. Any open invite bound to that address is revoked — it could only
  // fail with "already exists" from here on.
  if (method === 'POST' && path === '/oidc/approve') {
    let body;
    try {
      body = await readJsonBody(ctx.request);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    try {
      const user = approveOidcSub(dataDir, {
        sub: body?.sub,
        email: body?.email,
        role: body?.role ?? 'member',
      });
      const revokedInvites = revokeInvitesForEmail(dataDir, user.email);
      ctx.pushActivity?.({ type: 'oidc-approve', user: user.email, doc: String(body?.sub ?? '') });
      respondJson(201, { user, revokedInvites });
    } catch (err) {
      respondJson(/already exists/.test(err.message) ? 409 : 400, { error: err.message });
    }
    return true;
  }
  if (method === 'POST' && path === '/oidc/pending/dismiss') {
    let body;
    try {
      body = await readJsonBody(ctx.request);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    const removed = removePendingOidc(dataDir, body?.sub);
    ctx.pushActivity?.({ type: 'oidc-dismiss', doc: String(body?.sub ?? '') });
    respondJson(200, { ok: true, removed });
    return true;
  }

  if (method === 'GET' && path === '/users') {
    const users = listUsers(dataDir).map((u) => ({
      ...u,
      // Surface how many live credentials each account holds — the number an
      // operator actually needs when deciding whether an offboard took effect.
      tokenCount: listTokensForOwner(dataDir, u.email).length,
    }));
    respondJson(200, { users });
    return true;
  }

  if (method === 'POST' && path === '/users') {
    let body;
    try {
      body = await readJsonBody(ctx.request);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    try {
      const user = createUser(dataDir, {
        email: body?.email,
        password: body?.password,
        role: body?.role,
        scope: body?.scope,
      });
      ctx.pushActivity?.({ type: 'user-create', user: user.email, doc: user.role });
      respondJson(201, { user });
    } catch (err) {
      respondJson(/already exists/.test(err.message) ? 409 : 400, { error: err.message });
    }
    return true;
  }

  if (method === 'POST' && (path === '/users/disable' || path === '/users/enable')) {
    const disable = path === '/users/disable';
    let body;
    try {
      body = await readJsonBody(ctx.request);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    const user = setUserDisabled(dataDir, body?.email, disable);
    if (!user) {
      respondJson(404, { error: 'no such user' });
      return true;
    }
    // Disabling revokes credentials and kicks live sessions. Flipping a flag
    // while an already-authenticated socket stays open would make "disabled"
    // mean "cannot log in again", which is not what an operator disabling an
    // account at 2am means by it.
    let revoked = [];
    let kicked = 0;
    if (disable) {
      revoked = revokeTokensForOwner(dataDir, user.email);
      for (const label of revoked) kicked += ctx.kickLabel?.(label) ?? 0;
    }
    ctx.pushActivity?.({
      type: disable ? 'user-disable' : 'user-enable',
      user: user.email,
      doc: `revoked ${revoked.length}, kicked ${kicked}`,
    });
    respondJson(200, { user, revoked: revoked.length, kicked });
    return true;
  }

  if (method === 'POST' && path === '/users/password') {
    let body;
    try {
      body = await readJsonBody(ctx.request);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    let changed;
    try {
      changed = setUserPassword(dataDir, body?.email, body?.password);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    if (!changed) {
      respondJson(404, { error: 'no such user' });
      return true;
    }
    // A password change invalidates existing sessions — the common reason to
    // change one is that the old credential may be compromised.
    const revoked = revokeTokensForOwner(dataDir, String(body.email).trim().toLowerCase());
    let kicked = 0;
    for (const label of revoked) kicked += ctx.kickLabel?.(label) ?? 0;
    ctx.pushActivity?.({
      type: 'user-password',
      user: String(body.email),
      doc: `revoked ${revoked.length}`,
    });
    respondJson(200, { ok: true, revoked: revoked.length, kicked });
    return true;
  }

  if (path === '/invites' || path.startsWith('/invites/')) {
    if (method === 'GET' && path === '/invites') {
      respondJson(200, { invites: listInvites(dataDir) });
      return true;
    }
    if (method === 'POST' && path === '/invites') {
      if (cloudIdentityStrict()) {
        // B6: the dashboard's People page is the one place members are added.
        respondJson(409, {
          error:
            'This workspace takes its members from Maude Cloud. Add people on the project’s People page instead.',
        });
        return true;
      }
      let body;
      try {
        body = await readJsonBody(ctx.request);
      } catch (err) {
        respondJson(400, { error: err.message });
        return true;
      }
      let invite;
      try {
        invite = createInvite(dataDir, {
          email: body?.email,
          role: body?.role ?? undefined,
          ttlHours: body?.ttlHours,
          createdBy: body?.createdBy,
        });
      } catch (err) {
        respondJson(400, { error: err.message });
        return true;
      }
      ctx.pushActivity?.({ type: 'invite-create', user: invite.email ?? '(open)', doc: invite.id });
      // The raw value exists ONLY in this response. It is never stored, never
      // logged, and never listed again.
      respondJson(201, {
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt,
        },
        url: ctx.publicUrl ? inviteUrl(ctx.publicUrl, invite.value) : null,
        value: invite.value,
      });
      return true;
    }
    if (method === 'POST' && path === '/invites/revoke') {
      let body;
      try {
        body = await readJsonBody(ctx.request);
      } catch (err) {
        respondJson(400, { error: err.message });
        return true;
      }
      const revoked = revokeInvite(dataDir, body?.id);
      if (!revoked) {
        respondJson(404, { error: 'no such open invitation' });
        return true;
      }
      ctx.pushActivity?.({ type: 'invite-revoke', user: '(admin)', doc: String(body?.id) });
      respondJson(200, { ok: true });
      return true;
    }
    respondJson(404, { error: 'not found' });
    return true;
  }

  if (method === 'POST' && path === '/users/delete') {
    let body;
    try {
      body = await readJsonBody(ctx.request);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    const email = String(body?.email ?? '')
      .trim()
      .toLowerCase();
    const revoked = revokeTokensForOwner(dataDir, email);
    let kicked = 0;
    for (const label of revoked) kicked += ctx.kickLabel?.(label) ?? 0;
    const removed = removeUser(dataDir, email);
    if (!removed && revoked.length === 0) {
      respondJson(404, { error: 'no such user' });
      return true;
    }
    ctx.pushActivity?.({
      type: 'user-delete',
      user: email,
      doc: `revoked ${revoked.length}, kicked ${kicked}`,
    });
    respondJson(200, { ok: true, revoked: revoked.length, kicked });
    return true;
  }

  return false;
}
