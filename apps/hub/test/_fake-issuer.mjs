// A tiny in-process OIDC issuer for tests and the local smoke. Not a test file.
//
// The hub's OIDC egress is guarded (https only, no loopback — oidc-egress.mjs),
// so a test issuer cannot be a local HTTP server. Like the existing OIDC tests,
// it is a `fetchImpl` the hub is handed instead (`createHub({ oidcFetch })`):
// discovery, JWKS and the token endpoint answered in memory, ID tokens signed
// with a real RS256 key so the hub's verification (jose) runs for real.
//
// The "sign-in at the provider" is `codeFor(authorizeUrl, person)`: it reads
// the nonce off the authorize URL the hub produced and returns the callback
// query a browser would come back with.

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export const ISSUER = 'https://auth.example.test';
export const CLIENT_ID = 'hub';

export function oidcEnv(over = {}) {
  return {
    HUB_OIDC_MODE: 'hybrid',
    HUB_OIDC_ISSUER: ISSUER,
    HUB_OIDC_CLIENT_ID: CLIENT_ID,
    HUB_OIDC_CLIENT_SECRET: 'test-client-secret',
    HUB_OIDC_ALLOWED_DOMAINS: 'example.test',
    HUB_OIDC_LABEL: 'Example ID',
    ...over,
  };
}

/** The callback query for `person` signing in at the authorize URL the hub sent the browser to. */
export function codeFor(authorizeUrl, person) {
  const u = new URL(authorizeUrl);
  if (u.origin !== ISSUER) throw new Error(`not the issuer: ${u.origin}`);
  const code = Buffer.from(
    JSON.stringify({ ...person, nonce: u.searchParams.get('nonce') }),
    'utf8'
  ).toString('base64url');
  return `code=${code}&state=${encodeURIComponent(u.searchParams.get('state'))}`;
}

export async function createFakeIssuer() {
  const pair = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'fake', alg: 'RS256', use: 'sig' };
  const fetchImpl = async (url, opts = {}) => {
    const href = String(url);
    if (href === `${ISSUER}/.well-known/openid-configuration`) {
      return {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      };
    }
    if (href === `${ISSUER}/jwks`) return { keys: [jwk] };
    if (href === `${ISSUER}/token`) {
      const body = new URLSearchParams(String(opts.body ?? ''));
      const claims = JSON.parse(Buffer.from(body.get('code') ?? '', 'base64url').toString('utf8'));
      const { sub, nonce, ...rest } = claims;
      const id_token = await new SignJWT({ email_verified: true, ...rest, nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'fake' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey);
      return { id_token };
    }
    throw new Error(`fake issuer: unexpected ${href}`);
  };
  return { fetchImpl, issuer: ISSUER };
}

/** Cookie jar over fetch — enough of a browser for the hub's doors. */
export function browser(base) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const m = /^([^=]+)=([^;]*)/.exec(c);
      if (!m) continue;
      if (m[2] === '' || /max-age=0/i.test(c)) jar.delete(m[1]);
      else jar.set(m[1], m[2]);
    }
    return res;
  };
  const call = async (path, init = {}) => {
    const headers = {
      'sec-fetch-site': 'same-origin',
      origin: base,
      ...(jar.size ? { cookie: cookieHeader() } : {}),
      ...(init.headers ?? {}),
    };
    return absorb(await fetch(`${base}${path}`, { redirect: 'manual', ...init, headers }));
  };
  return {
    jar,
    get: (path, headers = {}) => call(path, { headers: { accept: 'text/html', ...headers } }),
    form: (path, fields, headers = {}) =>
      call(path, {
        method: 'POST',
        headers: {
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded',
          ...headers,
        },
        body: new URLSearchParams(fields).toString(),
      }),
    json: (path, body, headers = {}) =>
      call(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

/** The provider URL a hand-off page (200, meta refresh) sends the browser to. */
export function refreshTarget(html) {
  const m = /http-equiv="refresh" content="0;url=([^"]+)"/.exec(html);
  if (!m) return null;
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

/**
 * Walk the OIDC sign-in as `person` from a POST or GET that starts it.
 * Returns the callback response.
 */
export async function signInAs(b, started, person) {
  let dest = started.headers.get('location');
  if (!dest) dest = refreshTarget(await started.text());
  if (!dest) throw new Error(`sign-in did not start (HTTP ${started.status})`);
  return b.get(`/auth/oidc/callback?${codeFor(dest, person)}`);
}
