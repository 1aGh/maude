// The OIDC sign-in flow — Track C C3/C5.
//
// The flow is OURS: PKCE, state, nonce, subject→account, the mode switch.
// Only the signature decision is delegated (see oidc.mjs), and only the
// connection is guarded separately (see oidc-egress.mjs).
//
// ── THE RULE THIS FILE EXISTS TO HOLD ──────────────────────────────────────
//
// A verified subject with no linked account gets `pending` and NO SESSION —
// whether or not its email claim matches an existing account. Especially then.
//
// The first draft of this track said: "first successful sign-in for an email
// that already exists LINKS rather than creates". `users.mjs:63` is
// `email TEXT PRIMARY KEY` — email IS the account key — and `createUser`'s own
// docstring reads: "Throws on a duplicate address (callers map that to 409) so
// a signup can never silently overwrite an existing account's password."
//
// So auto-link did not defeat a missing guard. It routed around an existing
// one that has held since it was written, reaching the same outcome by
// ALIASING an identity onto the row rather than rewriting its hash. With the
// domain allowlist optional and no `email_verified` requirement, an attacker
// who can assert `admin@company.com` at a permissive issuer owned the admin
// account in one request, with no admin action anywhere.
//
// It read as plumbing, which is why it survived review — the draft's own
// Gotcha caught the SECOND-order case ("an IdP can reassign an address; sub is
// the stable subject") one line below the first-order one.
//
// Linking is therefore an explicit admin act in the People view
// (`linkOidcSub`), and this module never calls it.
//
// ── WHAT ELSE MAY LET A SUBJECT IN (`resolveVerified`) ─────────────────────
//
// Two things besides an admin's click, and neither is a match on the address:
//
//   • AN INVITATION the person holds. The raw invite rides the signed,
//     HttpOnly transaction cookie from the join page to the callback; a
//     still-valid invite plus a VERIFIED, allow-listed address creates a NEW
//     account for that address with the invite's role and links the subject
//     to it (`createOidcUser`). The invite is the approval, spent exactly once.
//   • THE "who can join" RULE (`settings.json`), when the admin chose
//     `domain`: the same new-account-and-link, as a member.
//
// Both go through `createOidcUser`, which throws when the address already has
// an account — so an EXISTING account is still never reached by its address.
// That case falls to `pending` exactly as before, and the invite is not spent.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { peekInvite, redeemInvite } from './invites.mjs';
import { createVerifier, usableEmailClaim } from './oidc.mjs';
import { assertSameOrigin, fetchGuarded } from './oidc-egress.mjs';
import { isRevoked } from './revocations.mjs';
import {
  createOidcUser,
  getUser,
  getUserByOidcSub,
  isTurnedOut,
  recordPendingOidc,
  removeUser,
} from './users.mjs';

/** The cookie carrying state/PKCE/nonce between /start and /callback. */
export const OIDC_TXN_COOKIE = 'maude_oidc_txn';
/** A sign-in attempt is short-lived by nature. */
export const TXN_TTL_MS = 10 * 60_000;

// ------------------------------------------------------------- mode switch

/**
 * Is OIDC accepted at all? (C5)
 *
 * EXPLICIT, never inferred from the presence of `HUB_OIDC_ISSUER`.
 * `cloud-identity.mjs` documents exactly this bug: keying a behavioural mode on
 * an env var that merely NAMES a dependency silently flipped a live cell into a
 * mode with no working browser sign-in. "An env var that names a dependency
 * must never double as consent to a behavioral mode."
 *
 * 'hybrid' → OIDC in addition to the password store.
 * 'strict' → OIDC only; password sign-in refused.
 */
export function oidcMode(env = process.env) {
  const raw = env.HUB_OIDC_MODE;
  return raw === 'hybrid' || raw === 'strict' ? raw : null;
}
export const oidcEnabled = (env = process.env) => oidcMode(env) !== null;
export const oidcStrict = (env = process.env) => oidcMode(env) === 'strict';

/**
 * Resolve and validate the OIDC configuration, or explain what is missing.
 *
 * The allowlist is REQUIRED whenever a mode is set. It is a filter and never a
 * grant — a permitted domain with no account still lands in pending — but
 * without it every subject at a public issuer can queue itself, and the queue
 * is the surface an operator reads before clicking "link".
 */
export function oidcConfig(env = process.env) {
  const mode = oidcMode(env);
  if (!mode) return { enabled: false, mode: null, errors: [] };
  const errors = [];
  const issuer = String(env.HUB_OIDC_ISSUER ?? '')
    .trim()
    .replace(/\/+$/, '');
  const clientId = String(env.HUB_OIDC_CLIENT_ID ?? '').trim();
  const clientSecret = String(env.HUB_OIDC_CLIENT_SECRET ?? '').trim();
  const domains = String(env.HUB_OIDC_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  if (!issuer) errors.push('HUB_OIDC_ISSUER is required when HUB_OIDC_MODE is set');
  else if (!/^https:\/\//.test(issuer)) errors.push('HUB_OIDC_ISSUER must be https');
  if (!clientId) errors.push('HUB_OIDC_CLIENT_ID is required when HUB_OIDC_MODE is set');
  if (!clientSecret) errors.push('HUB_OIDC_CLIENT_SECRET is required when HUB_OIDC_MODE is set');
  if (domains.length === 0) {
    errors.push('HUB_OIDC_ALLOWED_DOMAINS is required when HUB_OIDC_MODE is set');
  }

  // TWO tri-state identity switches interacting untested is nine combinations
  // nobody has run. Refusing the overlap kills four of them permanently, in
  // one line, at boot rather than at 3am.
  if (env.MAUDE_CLOUD_IDENTITY === '1' || env.MAUDE_CLOUD_IDENTITY === 'strict') {
    errors.push(
      'MAUDE_CLOUD_IDENTITY and HUB_OIDC_MODE cannot both be set — this hub would have two ' +
        'identity authorities and no rule for which wins'
    );
  }

  return {
    enabled: true,
    mode,
    issuer,
    clientId,
    clientSecret,
    allowedDomains: domains,
    label: String(env.HUB_OIDC_LABEL ?? '').trim() || labelFromIssuer(issuer),
    errors,
  };
}

function labelFromIssuer(issuer) {
  try {
    return new URL(issuer).hostname;
  } catch {
    return 'your identity provider';
  }
}

/**
 * Boot check: entering `strict` with nobody able to sign in locks the operator
 * out of their own box, and the only way back is editing env on the host.
 */
export function assertStrictIsSurvivable(cfg, { linkedAccounts }) {
  if (cfg.mode !== 'strict') return;
  if (linkedAccounts > 0) return;
  throw new Error(
    'HUB_OIDC_MODE=strict refuses to start: no account is linked to an OIDC identity yet, so ' +
      'nobody could sign in. Link at least one account in People under hybrid mode first.'
  );
}

// ------------------------------------------------------------------- PKCE

export function createTransaction({ random = randomBytes } = {}) {
  const verifier = random(32).toString('base64url');
  return {
    state: random(16).toString('base64url'),
    nonce: random(16).toString('base64url'),
    codeVerifier: verifier,
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    createdAt: Date.now(),
  };
}

export function authorizeUrl(cfg, txn, redirectUri, authorizationEndpoint, { prompt = null } = {}) {
  // ORIGIN-CHECKED like the JWKS and token endpoints (B6). This is the one
  // discovery field the browser is REDIRECTED to, so a discovery document that
  // names an attacker origin here is an open redirect carrying client_id,
  // state, nonce and redirect_uri to a phishing page. The other two endpoints
  // were already pinned; this one was the gap.
  assertSameOrigin(cfg.issuer, authorizationEndpoint);
  const u = new URL(authorizationEndpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', txn.state);
  u.searchParams.set('nonce', txn.nonce);
  u.searchParams.set('code_challenge', txn.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  // "Use another account" — a fixed word, never a caller's string.
  if (prompt === 'select_account') u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

// ------------------------------------------------------------- the decision

/**
 * What happens to a VERIFIED subject?
 *
 * Pure, and separated from the HTTP so the rule can be asserted without a
 * server. There are exactly three outcomes and none of them is "link".
 *
 * @returns {{action:'sign-in', user: object} | {action:'pending', reason: string} | {action:'refuse', reason: string}}
 */
export function decideOidcOutcome({ subject, linkedUser, emailAllowed, revoked = false }) {
  if (!subject) return { action: 'refuse', reason: 'the ID token carries no subject' };

  if (linkedUser) {
    if (linkedUser.disabled) {
      return { action: 'refuse', reason: 'this account is disabled' };
    }
    if (revoked) {
      return { action: 'refuse', reason: 'this account’s credentials were revoked' };
    }
    return { action: 'sign-in', user: linkedUser };
  }

  // NO LINK ⇒ PENDING. Note what is deliberately absent: any lookup by email.
  // Matching an IdP-asserted address to an existing account is the takeover.
  if (!emailAllowed) {
    return {
      action: 'pending',
      reason: 'this identity is not from an allowed domain and has no account here',
    };
  }
  return {
    action: 'pending',
    reason: 'this identity has no account here yet — an admin must link or create one',
  };
}

/**
 * Resolve a verified subject against the local store and record the outcome.
 *
 * The only writes it performs are to `oidc_pending`. It never creates a user
 * and never links one.
 */
export function resolveSubject(dataDir, verified, cfg) {
  const linkedUser = getUserByOidcSub(dataDir, verified.sub);
  const email = usableEmailClaim(verified, cfg.allowedDomains ?? []);
  const outcome = decideOidcOutcome({
    subject: verified.sub,
    linkedUser,
    emailAllowed: Boolean(email),
    revoked: linkedUser ? isRevoked(dataDir, linkedUser.email, Date.now()) : false,
  });
  if (outcome.action === 'pending' && email) {
    // Recorded ONLY for an allowlisted, verified address (B6) — otherwise any
    // account holder at a public issuer could queue a row, and the queue is the
    // operator's review surface. The claimed address is display data.
    try {
      recordPendingOidc(dataDir, { sub: verified.sub, email });
    } catch (err) {
      // A full queue must not turn a sign-in attempt into a 500; the person
      // still has no session, which is the outcome that matters.
      if (err.code !== 'PENDING_FULL') throw err;
    }
  }
  return outcome;
}

/** "Only people you invite" — one sentence, the same whoever asks (no account-existence signal). */
function turnedAway() {
  return {
    action: 'refuse',
    code: 'invite-only',
    reason:
      'You need an invitation to join. Ask whoever runs this team server to invite you. Already have an account here? Sign in with its password and choose Link my sign-in.',
  };
}

function queuePending(dataDir, sub, email) {
  try {
    recordPendingOidc(dataDir, { sub, email });
  } catch (err) {
    if (err.code !== 'PENDING_FULL') throw err;
  }
}

/**
 * The whole decision for a verified subject: linked, invited, admitted by the
 * "who can join" rule, queued, or turned away.
 *
 * @param {string} dataDir
 * @param {{ sub: string, email?: string, emailVerified?: boolean }} verified
 * @param {{ allowedDomains?: string[] }} cfg
 * @param {object} [opts]
 * @param {string|null} [opts.invite]  the raw invite the transaction carried
 * @param {'invite-only'|'ask'|'domain'} [opts.policy]
 * @returns {{action:'sign-in', user: object, via: 'linked'|'invite'|'domain', invite?: object}
 *   | {action:'pending', reason: string}
 *   | {action:'refuse', reason: string, code?: string}
 *   | {action:'invite-mismatch', inviteEmail: string, email: string}}
 */
export function resolveVerified(dataDir, verified, cfg, { invite = null, policy = 'ask' } = {}) {
  const linkedUser = verified?.sub ? getUserByOidcSub(dataDir, verified.sub) : null;
  // A linked subject, or no subject at all: the decision that has always held.
  if (linkedUser || !verified?.sub) {
    const outcome = resolveSubject(dataDir, verified, cfg);
    return outcome.action === 'sign-in' ? { ...outcome, via: 'linked' } : outcome;
  }
  // From here: a verified subject with NO account. Only a verified address on
  // the allowlist can be invited in or admitted by rule; anything else gets
  // exactly what it got before (pending, with no row).
  const email = usableEmailClaim(verified, cfg.allowedDomains ?? []);
  if (!email) {
    // Never queued (resolveSubject records only a usable address). Under
    // invite-only say so plainly rather than "waiting for access".
    if (policy === 'invite-only') return turnedAway();
    return resolveSubject(dataDir, verified, cfg);
  }

  // The address already has an account that is NOT this subject's. Matching on
  // it is the takeover — pending, whatever invite or rule is in play, and the
  // invite is left unspent.
  const taken = Boolean(getUser(dataDir, email));

  // REMOVED AND DISMISSED PEOPLE STAY OUT. An admin took this subject or this
  // address out (users.mjs `markTurnedOut`); neither the domain rule nor a
  // link for anyone creates them an account again. They can ASK — queued in
  // every mode, invite-only included, so an admin sees it and decides — and
  // "Let in" or an invitation that NAMES the address clears it.
  const turnedOut = isTurnedOut(dataDir, { sub: verified.sub, email });

  const look = invite && !taken ? peekInvite(dataDir, invite) : null;
  const named =
    look?.ok &&
    String(look.invite.email ?? '')
      .trim()
      .toLowerCase() === email;
  if (look?.ok && (!turnedOut || named)) {
    const bound = String(look.invite.email ?? '')
      .trim()
      .toLowerCase();
    if (bound && bound !== email) {
      return { action: 'invite-mismatch', inviteEmail: bound, email };
    }
    const redeemed = redeemInvite(dataDir, {
      value: invite,
      email,
      // The sessions this door mints go through the mint door with the
      // account's own claim (browser-auth.mjs), so a canvas invite is honoured.
      honoursAccess: true,
      createAccount: ({ email: address, role, access }) =>
        createOidcUser(dataDir, { sub: verified.sub, email: address, role, access }),
    });
    if (redeemed.ok) {
      return { action: 'sign-in', user: redeemed.user, via: 'invite', invite: redeemed.invite };
    }
    // Lost a race for the invite AFTER the account was made: an account with
    // no invitation behind it must not survive.
    if (redeemed.reason === 'already-used' && redeemed.user) removeUser(dataDir, email);
    // Otherwise the account could not be made (the address was taken a moment
    // ago, the subject linked meanwhile): the uninvited path below decides.
  }

  if (turnedOut) {
    queuePending(dataDir, verified.sub, email);
    return {
      action: 'pending',
      reason: 'this person was removed or dismissed — an admin must let them in again',
    };
  }
  if (!taken && policy === 'domain') {
    try {
      const user = createOidcUser(dataDir, { sub: verified.sub, email, role: 'member' });
      return { action: 'sign-in', user, via: 'domain' };
    } catch {
      /* raced into existence — queue below, never link */
    }
  }
  if (policy === 'invite-only') return turnedAway();
  queuePending(dataDir, verified.sub, email);
  return {
    action: 'pending',
    reason: 'this identity has no account here yet — an admin must link or create one',
  };
}

/**
 * Trade the authorization code for tokens.
 *
 * Goes through the SAME guarded transport as the JWKS fetch — the token
 * endpoint comes out of the issuer's discovery document, so it is exactly as
 * operator-influenced and exactly as capable of naming link-local. The client
 * secret travels in the BODY, so it stays out of the issuer's access logs and
 * out of any Referer.
 */
export async function exchangeCode(
  cfg,
  { code, codeVerifier, redirectUri, tokenEndpoint },
  { fetchImpl = fetchGuarded } = {}
) {
  assertSameOrigin(cfg.issuer, tokenEndpoint);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: codeVerifier,
  }).toString();
  const res = await fetchImpl(tokenEndpoint, { method: 'POST', body });
  const idToken = res?.id_token;
  if (typeof idToken !== 'string' || !idToken) {
    throw new Error('oidc: the token response carried no id_token');
  }
  return idToken;
}

/** Is this sign-in attempt still the one we started? */
/**
 * Read a transaction cookie — SIGNED (B6).
 *
 * The cookie is `<payload>.<hmac>`; the HMAC is over the payload with a key
 * derived from `HUB_SECRET`. Without it the cookie is attacker-authored state:
 * a page that can set a cookie on the hub origin could choose `state`, `nonce`
 * and `codeVerifier` — making PKCE's binding decorative and login-CSRF trivial —
 * and extend the TTL indefinitely by choosing `createdAt`. The nonce is
 * REQUIRED here, so a callback can never end up without one to check.
 */
export function readTransaction(raw, { secret, now = Date.now() } = {}) {
  if (!raw || !secret) return null;
  const dot = String(raw).lastIndexOf('.');
  if (dot < 0) return null;
  const payload = String(raw).slice(0, dot);
  const mac = String(raw).slice(dot + 1);
  const expected = txnMac(payload, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let txn;
  try {
    txn = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!txn?.state || !txn?.codeVerifier || !txn?.nonce) return null;
  if (!txn.createdAt || now - txn.createdAt > TXN_TTL_MS) return null;
  return txn;
}

export function encodeTransaction(txn, secret) {
  if (!secret) throw new Error('encodeTransaction: a signing secret is required');
  const payload = Buffer.from(JSON.stringify(txn), 'utf8').toString('base64url');
  return `${payload}.${txnMac(payload, secret)}`;
}

/** HMAC over the cookie payload, under a purpose-derived key (never HUB_SECRET raw). */
function txnMac(payload, secret) {
  return createHmac('sha256', `oidc-txn:${secret}`).update(payload).digest('base64url');
}

export { createVerifier };
