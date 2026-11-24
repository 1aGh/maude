// OIDC discovery + ID-token verification — Track C C1.
//
// WHY A LIBRARY, when this repo hand-rolls SigV4 rather than take the AWS SDK.
// The precedent separates on SIZE, not on failure mode, so it does not carry:
// a SigV4 bug fails LOUDLY with a 403, and a verifier bug fails by accepting a
// forged token. `s3.mjs` avoided 20 MB of `@aws-sdk`; `jose` is one package
// with ZERO transitive dependencies, pinned exactly, which is compatible with
// DDR-056's frozen-install rule (that rule forbids re-RESOLUTION at build
// time, not dependencies) and with DDR-193's untrusted-image posture.
//
// The framing that settled it: a hand-rolled verifier is not a smaller
// shipment, it is the same shipment plus a permanent unassigned obligation. No
// test of ours goes red when a new attack class against JWT is published,
// because a suite only encodes the attacks its author already knew. A pinned
// dependency is a CVE channel; our own 150 lines are not.
//
// AND NOTE WHAT THIS FILE DOES NOT INHERIT. `cloud-identity.mjs` says of our
// OWN tokens: "Deliberately NOT a JWT… we control both ends. One algorithm, no
// negotiation, nothing to downgrade." Every clause there is about controlling
// both ends — the exact property this track removes by design, since the whole
// point is accepting a token minted by a party we do not control. Citing that
// file as precedent for hand-rolling here inverts it.
//
// The FLOW stays ours (PKCE, state, nonce, sub→account, the mode switch), and
// so does the network (see oidc-egress.mjs — `createRemoteJWKSet` fetches
// whatever URL you give it). Only the signature decision is delegated.

import { createLocalJWKSet, jwtVerify } from 'jose';

import { assertSameOrigin, createRefetchBudget, fetchGuarded } from './oidc-egress.mjs';

/** How long a discovery document / key set is reused before refetching. */
const CACHE_TTL_MS = 10 * 60_000;

/**
 * Fetch and cache an issuer's discovery document.
 *
 * The issuer is operator config, so the URL is built from it rather than taken
 * from anywhere a request could influence.
 */
export function createDiscovery({ issuer, ttlMs = CACHE_TTL_MS, fetchImpl = fetchGuarded } = {}) {
  let cached = null;
  let cachedAt = 0;
  const budget = createRefetchBudget();

  async function document(now = Date.now()) {
    if (cached && now - cachedAt < ttlMs) return cached;
    if (!budget.spend()) {
      if (cached) return cached;
      throw new Error('oidc: discovery refetch budget exhausted');
    }
    const base = String(issuer).replace(/\/+$/, '');
    const doc = await fetchImpl(`${base}/.well-known/openid-configuration`);
    if (!doc || typeof doc.jwks_uri !== 'string') {
      throw new Error('oidc: the discovery document has no jwks_uri');
    }
    // Guard 1 from oidc-egress: discovery is a document the issuer serves about
    // ITSELF, not a licence to name a different host.
    assertSameOrigin(issuer, doc.jwks_uri);
    if (typeof doc.issuer === 'string' && doc.issuer.replace(/\/+$/, '') !== base) {
      throw new Error(
        `oidc: the discovery document claims issuer ${doc.issuer}, not ${issuer} — refusing`
      );
    }
    cached = doc;
    cachedAt = now;
    return doc;
  }

  return { document };
}

/**
 * A verifier bound to one issuer + audience.
 *
 * `algorithms` is passed EXPLICITLY at the call site rather than left to a
 * default. This is the one line where "the library handles it" is not good
 * enough to leave implicit: it is what makes `alg: none` and the RS256→HS256
 * confusion unreachable, and a default is a thing that can change under us.
 */
export function createVerifier({
  issuer,
  audience,
  algorithms = ['RS256'],
  discovery = null,
  ttlMs = CACHE_TTL_MS,
  fetchImpl = fetchGuarded,
} = {}) {
  const disco = discovery ?? createDiscovery({ issuer, ttlMs, fetchImpl });
  // `iss` is compared as an EXACT string by `jwtVerify`, and a trailing slash
  // is a real difference to it — Auth0 (and plenty of others) serve
  // `https://tenant/` in both discovery and the id_token, while the config we
  // are handed has been slash-stripped twice on the way here (workspace-plan
  // renders `.env`, oidc-routes re-strips at read). Accepting BOTH forms is
  // the fix; un-stripping is NOT, because `createDiscovery` builds
  // `${base}/.well-known/…` off this same value and would emit `//.well-known`.
  //
  // Both variants name the same origin — `assertSameOrigin` already fenced the
  // JWKS host — so this widens the string match, never the trust boundary.
  const issuerBase = String(issuer ?? '').replace(/\/+$/, '');
  const issuerVariants = [issuerBase, `${issuerBase}/`];
  let keys = null;
  let keysAt = 0;
  const budget = createRefetchBudget();

  async function keySet(now = Date.now(), { force = false } = {}) {
    if (keys && !force && now - keysAt < ttlMs) return keys;
    if (force && !budget.spend()) {
      // An unknown `kid` must not be usable to drive egress. Serve the cached
      // set and let verification fail honestly.
      if (keys) return keys;
    }
    const doc = await disco.document(now);
    const jwks = await fetchImpl(doc.jwks_uri);
    if (!jwks || !Array.isArray(jwks.keys)) throw new Error('oidc: the JWKS has no keys');
    keys = createLocalJWKSet(jwks);
    keysAt = now;
    return keys;
  }

  /**
   * Verify an ID token and return its claims.
   *
   * @returns {Promise<{sub: string, email: string|null, emailVerified: boolean, claims: object}>}
   */
  async function verifyIdToken(jwt, { nonce, now = Date.now() } = {}) {
    // REQUIRED, not optional (B6). The earlier shape only checked the nonce
    // `if (nonce !== undefined)`, so the obvious callback — `verifyIdToken(jwt,
    // { nonce: txn.nonce })` against a txn whose nonce a client had stripped —
    // silently disabled replay binding. Demanding it here means a caller cannot
    // forget, and `readTransaction` already guarantees the txn carries one.
    if (typeof nonce !== 'string' || !nonce) {
      throw new Error('oidc: a nonce is required to verify an ID token');
    }
    let resolved = await keySet(now);
    let payload;
    try {
      ({ payload } = await jwtVerify(jwt, resolved, {
        issuer: issuerVariants,
        audience,
        algorithms,
      }));
    } catch (err) {
      // A rotated signing key looks exactly like a bad token until the set is
      // refreshed — once, on a budget.
      if (!/no applicable key|signature verification failed/i.test(String(err?.message))) throw err;
      resolved = await keySet(now, { force: true });
      ({ payload } = await jwtVerify(jwt, resolved, {
        issuer: issuerVariants,
        audience,
        algorithms,
      }));
    }

    if (payload.nonce !== nonce) {
      throw new Error('oidc: the ID token nonce does not match this sign-in attempt');
    }
    const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!sub) throw new Error('oidc: the ID token carries no subject');

    return {
      sub,
      // DISPLAY DATA ONLY. Identity is the verified `sub`; an IdP can reassign
      // an address, and plenty of issuer configurations let a user assert one.
      email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null,
      emailVerified: payload.email_verified === true,
      claims: payload,
    };
  }

  return { verifyIdToken, keySet, discovery: disco };
}

/**
 * Is this claimed address usable at all as a display/link hint?
 *
 * Unverified means the issuer is not asserting the person controls it, so it
 * must never reach a matching decision — see oidc-routes.mjs, where matching
 * on an address is precisely the thing that is forbidden.
 */
export function usableEmailClaim({ email: claimed, emailVerified }, allowedDomains = []) {
  // ONE spelling, before anything looks at it: accounts are keyed by the
  // trimmed, lowercased address (users.mjs `normalizeEmail`), so a claim
  // compared or stored in any other spelling is a second identity for the
  // same mailbox — `Marek@…` beside `marek@…`.
  const email = typeof claimed === 'string' ? claimed.trim().toLowerCase() : '';
  if (!email || !emailVerified) return null;
  if (allowedDomains.length === 0) return email;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return allowedDomains.includes(domain) ? email : null;
}
