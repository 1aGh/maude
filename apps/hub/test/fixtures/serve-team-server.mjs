#!/usr/bin/env node
// A team server for the local smoke: the hub's REAL boot (`runAsMain`) — the
// seeded first admin, workspace mode, the workspace agent, backups — with an
// in-memory identity provider in place of a real one.
//
//   <env> node test/fixtures/serve-team-server.mjs
//
// Everything is configured by the same environment a deployment uses
// (PORT, DATA_DIR, HUB_SECRET, HUB_WORKSPACE_MODE, MAUDE_REPO_DIR,
// HUB_OIDC_*, MAUDE_ADMIN_EMAIL, …). The one difference is the provider
// transport: HUB_OIDC_ISSUER must be https and the hub refuses loopback
// egress, so the issuer (`test/_fake-issuer.mjs`, ISSUER) is answered in this
// process. A "sign-in at the provider" is `codeFor(authorizeUrl, person)`.
//
// The signing key is kept in DATA_DIR so the same issuer survives a restart.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose';

import { runAsMain } from '../../src/server.mjs';
import { CLIENT_ID, ISSUER } from '../_fake-issuer.mjs';

const dataDir = process.env.DATA_DIR;
if (!dataDir) {
  process.stderr.write('serve-team-server: DATA_DIR is required\n');
  process.exit(2);
}
if (process.env.HUB_OIDC_ISSUER !== ISSUER) {
  process.stderr.write(`serve-team-server: HUB_OIDC_ISSUER must be ${ISSUER}\n`);
  process.exit(2);
}

const keyFile = join(dataDir, 'fake-issuer-key.json');
let privateJwk;
if (existsSync(keyFile)) {
  privateJwk = JSON.parse(readFileSync(keyFile, 'utf8'));
} else {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateJwk = await exportJWK(pair.privateKey);
  writeFileSync(keyFile, JSON.stringify(privateJwk), { mode: 0o600 });
}
const privateKey = await importJWK(privateJwk, 'RS256');
const { d, p, q, dp, dq, qi, ...publicJwk } = privateJwk;
const jwk = { ...publicJwk, kid: 'fake', alg: 'RS256', use: 'sig' };

const oidcFetch = async (url, opts = {}) => {
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
      .setAudience(process.env.HUB_OIDC_CLIENT_ID ?? CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    return { id_token };
  }
  throw new Error(`fake issuer: unexpected ${href}`);
};

await runAsMain({ oidcFetch });
