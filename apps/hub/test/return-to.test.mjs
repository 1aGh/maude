import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { handleBrowserAuth } from '../src/browser-auth.mjs';
import {
  rememberReturnTo,
  setReturnTo,
  takeReturnTo,
  validateReturnTo,
} from '../src/return-to.mjs';
import { closeUsers, createUser } from '../src/users.mjs';

function response() {
  const headers = {};
  return {
    headers,
    getHeader: (key) => headers[key],
    setHeader: (key, value) => {
      headers[key] = value;
    },
    writeHead(status, values) {
      this.status = status;
      Object.assign(headers, values);
    },
    end() {},
  };
}
const cookie = (value) => {
  const res = response();
  setReturnTo(res, value);
  return res.headers['set-cookie']?.[0].split(';')[0] ?? 'maude_return=invalid';
};

test('only canonical file addresses survive, including escaped filename characters', () => {
  for (const bad of [
    'https://evil',
    '//evil',
    '/\\evil',
    '/?open=../x',
    '/?open=%2fetc',
    '/admin',
    '/?open=a&x=1',
    '/?open=a#hash',
    '/?open=a//b',
    '/?open=a%00b',
    '/?open=%ZZ',
    `/?open=${'a'.repeat(700)}`,
  ]) {
    assert.equal(validateReturnTo(bad), null, bad);
    assert.equal(takeReturnTo({ headers: { cookie: cookie(bad) } }, response()), '/');
  }
  for (const rel of ['ui/Žába.tsx', 'ui/100%.tsx', 'ui/%2e%2e.tsx', 'ui/A+B & C.tsx']) {
    const target = `/?open=${rel.split('/').map(encodeURIComponent).join('/')}`;
    assert.equal(validateReturnTo(target), target);
    assert.equal(takeReturnTo({ headers: { cookie: cookie(target) } }, response()), target);
  }
});

test('long Unicode identities survive sign-in inside a bounded cookie', () => {
  const rel = `ui/${'界'.repeat(505)}.tsx`;
  const target = `/?open=${rel.split('/').map(encodeURIComponent).join('/')}`;
  assert.equal(rel.length, 512);
  assert.equal(validateReturnTo(target), target);
  const saved = cookie(target);
  assert.ok(saved.length < 2100);
  assert.equal(takeReturnTo({ headers: { cookie: saved } }, response()), target);
  assert.equal(validateReturnTo(`${target}a`), null);
  for (const raw of ['../secret', '/etc/passwd', 'a//b', 'a\u0000b', 'a'.repeat(513)]) {
    const forged = `maude_return=${Buffer.from(raw).toString('base64url')}`;
    assert.equal(takeReturnTo({ headers: { cookie: forged } }, response()), '/');
  }
  for (const raw of ['_w', 'YQ=', 'a'.repeat(2049)]) {
    assert.equal(takeReturnTo({ headers: { cookie: `maude_return=${raw}` } }, response()), '/');
  }
  assert.equal(takeReturnTo({ headers: { cookie: `${saved}; ${saved}` } }, response()), '/');
});

test('set and take append cookies, use a ten-minute expiry, and always clear once consumed', () => {
  const res = response();
  res.setHeader('set-cookie', ['session=existing']);
  setReturnTo(res, '/?open=ui/A.tsx');
  assert.equal(res.headers['set-cookie'][0], 'session=existing');
  assert.match(res.headers['set-cookie'][1], /HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  const result = response();
  result.setHeader('set-cookie', ['maude_studio=new-session']);
  assert.equal(
    takeReturnTo({ headers: { cookie: res.headers['set-cookie'][1].split(';')[0] } }, result),
    '/?open=ui/A.tsx'
  );
  assert.deepEqual(result.headers['set-cookie'], [
    'maude_studio=new-session',
    'maude_return=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  ]);
  assert.equal(takeReturnTo({ headers: {} }, response()), '/');
  assert.equal(takeReturnTo({ headers: { cookie: 'maude_return=%ZZ' } }, response()), '/');
});

test('only HTML GET at the shell root remembers a valid target', () => {
  for (const [method, path, accept, url, sets] of [
    ['GET', '/', 'text/html', '/?open=ui/A.tsx', true],
    ['GET', '/', 'application/json', '/?open=ui/A.tsx', false],
    ['POST', '/', 'text/html', '/?open=ui/A.tsx', false],
    ['GET', '/_api/files', 'text/html', '/_api/files?open=ui/A.tsx', false],
    ['GET', '/', 'text/html', '/?open=../x', false],
  ]) {
    const res = response();
    rememberReturnTo({ method, url, headers: { accept } }, res, path);
    assert.equal(!!res.headers['set-cookie'], sets);
  }
});

test('local-password sign-in returns to the file and keeps the new session cookie', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-return-'));
  try {
    createUser(dataDir, {
      email: 'test@example.com',
      password: 'test-password-very-long',
      role: 'admin',
    });
    const request = Readable.from([
      Buffer.from('email=test%40example.com&password=test-password-very-long'),
    ]);
    request.url = '/studio/signin';
    request.headers = { origin: 'https://project.example.com', cookie: cookie('/?open=ui/A.tsx') };
    const res = response();
    await handleBrowserAuth({
      request,
      response: res,
      path: '/studio/signin',
      method: 'POST',
      dataDir,
      secret: 'test-secret',
      publicUrl: 'https://project.example.com',
      env: {},
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/?open=ui/A.tsx');
    assert.ok(res.headers['set-cookie'].some((c) => c.startsWith('maude_studio=')));
    assert.ok(res.headers['set-cookie'].some((c) => c.startsWith('maude_return=;')));
  } finally {
    closeUsers(dataDir);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('OIDC callback consumes the return target alongside transaction and session cookies', async () => {
  const { exportJWK, generateKeyPair, SignJWT } = await import('jose');
  const { handleOidc } = await import('../src/browser-auth.mjs');
  const { createTransaction, encodeTransaction, OIDC_TXN_COOKIE } = await import(
    '../src/oidc-routes.mjs'
  );
  const { linkOidcSub } = await import('../src/users.mjs');
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-return-oidc-'));
  const issuer = 'https://identity.example.com';
  const secret = 'test-secret';
  try {
    createUser(dataDir, {
      email: 'test@example.com',
      password: 'test-password-very-long',
      role: 'admin',
    });
    linkOidcSub(dataDir, 'test@example.com', 'subject-1');
    const txn = createTransaction();
    const pair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
    const token = await new SignJWT({
      email: 'test@example.com',
      email_verified: true,
      nonce: txn.nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject('subject-1')
      .setIssuer(issuer)
      .setAudience('hub')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pair.privateKey);
    const request = {
      url: `/auth/oidc/callback?code=test&state=${txn.state}`,
      headers: {
        cookie: `${OIDC_TXN_COOKIE}=${encodeURIComponent(encodeTransaction(txn, secret))}; ${cookie('/?open=ui/A.tsx')}`,
      },
    };
    const res = response();
    await handleOidc({
      request,
      response: res,
      path: '/auth/oidc/callback',
      method: 'GET',
      dataDir,
      secret,
      publicUrl: 'https://project.example.com',
      env: {
        HUB_OIDC_MODE: 'hybrid',
        HUB_OIDC_ISSUER: issuer,
        HUB_OIDC_CLIENT_ID: 'hub',
        HUB_OIDC_CLIENT_SECRET: 'test',
        HUB_OIDC_ALLOWED_DOMAINS: 'example.com',
      },
      fetchImpl: async (url) => {
        if (String(url).endsWith('/.well-known/openid-configuration'))
          return { issuer, jwks_uri: `${issuer}/jwks`, token_endpoint: `${issuer}/token` };
        if (String(url).endsWith('/token')) return { id_token: token };
        return { keys: [jwk] };
      },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/?open=ui/A.tsx');
    assert.ok(res.headers['set-cookie'].some((c) => c.startsWith('maude_studio=')));
    assert.ok(res.headers['set-cookie'].some((c) => c.startsWith('maude_return=;')));
    assert.ok(res.headers['set-cookie'].some((c) => c.startsWith(`${OIDC_TXN_COOKIE}=;`)));
  } finally {
    closeUsers(dataDir);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
