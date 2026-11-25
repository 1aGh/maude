// The provider said no: the person sees what it said, not "Something is missing".
//
// Live finding 2026-11-25 on design.studyfi.com: a personal Google account at
// auth.studyfi.com came back with `error=access_denied` and a clear Czech line
// ("sign in with your @studyfi.com account"); the hub dropped it and showed a
// 400 "Something is missing — Start sign-in from the project page."

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleOidc } from '../src/browser-auth.mjs';
import { createTransaction, encodeTransaction, OIDC_TXN_COOKIE } from '../src/oidc-routes.mjs';
import { rm, tmpDir } from './_acl-docs-fixture.mjs';

const issuer = 'https://auth.example.com';
const secret = 'test-secret';

function response() {
  const headers = {};
  let body = '';
  return {
    headers,
    get body() {
      return body;
    },
    getHeader: (k) => headers[k],
    setHeader: (k, v) => {
      headers[k] = v;
    },
    writeHead(status, values) {
      this.status = status;
      Object.assign(headers, values ?? {});
    },
    end(chunk) {
      if (chunk) body += String(chunk);
    },
  };
}

async function callback(query) {
  const dataDir = tmpDir('maude-oidc-refused-');
  const txn = createTransaction();
  const res = response();
  try {
    await handleOidc({
      request: {
        url: `/auth/oidc/callback?${query}&state=${txn.state}`,
        headers: {
          cookie: `${OIDC_TXN_COOKIE}=${encodeURIComponent(encodeTransaction(txn, secret))}`,
        },
      },
      response: res,
      path: '/auth/oidc/callback',
      method: 'GET',
      dataDir,
      secret,
      publicUrl: 'https://hub.example.com',
      env: {
        HUB_OIDC_MODE: 'hybrid',
        HUB_OIDC_ISSUER: issuer,
        HUB_OIDC_CLIENT_ID: 'hub',
        HUB_OIDC_CLIENT_SECRET: 'test',
        HUB_OIDC_ALLOWED_DOMAINS: 'example.com',
      },
      fetchImpl: async () => {
        throw new Error('a refused sign-in contacts nobody');
      },
    });
  } finally {
    rm(dataDir);
  }
  return res;
}

test('the provider refused: its own words are shown, escaped', async () => {
  const said = 'Tento účet nemá přístup. Přihlas se firemním účtem @example.com <b>now</b>';
  const res = await callback(`error=access_denied&error_description=${encodeURIComponent(said)}`);
  assert.equal(res.status, 403);
  assert.match(res.body, /Sign-in was refused/);
  assert.match(res.body, /auth\.example\.com says: Tento účet nemá přístup/);
  assert.match(res.body, /&lt;b&gt;now&lt;\/b&gt;/);
  assert.doesNotMatch(res.body, /<b>now<\/b>/);
  assert.doesNotMatch(res.body, /Something is missing/);
});

test('refused without a description still says what happened', async () => {
  const res = await callback('error=access_denied');
  assert.equal(res.status, 403);
  assert.match(res.body, /did not let this account in/);
});
