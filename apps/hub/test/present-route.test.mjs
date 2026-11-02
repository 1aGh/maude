// S3.7b / S9.13 — `GET /present/<canvas>` (S3-present-session §5).
//
// A signed-in person with `read` on THAT canvas (V2-1.16: Can view and up, or a
// canvas grant on it) gets a 302 to the studio's follower root; a missing and a
// forbidden canvas answer byte-identically (no existence oracle); signed out is
// the ordinary sign-in redirect with the follow form remembered; only GET/HEAD.

import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { takeReturnTo } from '../src/return-to.mjs';
import { HUB_ROUTE_ROWS, rowFor, runHubRoutes } from '../src/routes-v2/index.mjs';
import { handlePresent, presentRelOf } from '../src/routes-v2/present.mjs';
import { browserSession } from '../src/server.mjs';
import { addToken, verifyToken } from '../src/tokens.mjs';
import { rm, seedTokens, startHub, tmpDir } from './_acl-docs-fixture.mjs';

const SECRET = 'test-secret';
let dataDir;
let designRoot;
let outside;
let t;

before(() => {
  dataDir = tmpDir('maude-present-route-');
  designRoot = tmpDir('maude-present-design-');
  outside = tmpDir('maude-present-outside-');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui/Alpha.tsx'), 'export default () => null;\n');
  writeFileSync(join(designRoot, 'ui/canary-b-zx.tsx'), 'export default () => null;\n');
  writeFileSync(join(designRoot, 'combine-kampan.tsx'), 'export default () => null;\n');
  writeFileSync(join(outside, 'secret.tsx'), 'x');
  symlinkSync(join(outside, 'secret.tsx'), join(designRoot, 'ui/escape.tsx'));
  t = seedTokens(dataDir);
  // A role-null token WITHOUT a claim — a stale cookie, never a session.
  t.stale = addToken(dataDir, { label: 'stale-mac', scope: '*', owner: 's@x.test' }).value;
  // Can view on canvas A only, as a browser cookie (S9.2 browser lane).
  t.aViewCookie = addToken(dataDir, {
    label: 'studio-ann',
    scope: '*',
    owner: 'ann@x.test',
    readOnly: true,
    access: { v: 1, role: null, grants: [{ c: 'ui/Alpha.tsx', r: 'observer' }] },
  }).value;
});

after(() => {
  rm(dataDir);
  rm(designRoot);
  rm(outside);
});

function fakeResponse() {
  const headers = {};
  return {
    status: null,
    body: '',
    headers,
    getHeader: (k) => headers[k.toLowerCase()],
    setHeader: (k, v) => {
      headers[k.toLowerCase()] = v;
    },
    writeHead(status, values = {}) {
      this.status = status;
      for (const [k, v] of Object.entries(values)) headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      if (chunk) this.body += String(chunk);
    },
  };
}

async function ask(path, { method = 'GET', bearer, cookie, accept = 'text/html' } = {}) {
  const request = {
    method,
    url: path,
    headers: {
      accept,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(cookie ? { cookie: `maude_studio=${cookie}` } : {}),
    },
  };
  const response = fakeResponse();
  const handled = await handlePresent({
    request,
    response,
    method,
    path: path.split('?')[0],
    verify: (token) => verifyToken(dataDir, token, SECRET),
    respondJson: (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    },
    deps: {
      browserSession: (req) => browserSession(dataDir, SECRET, req),
      designRoot: () => designRoot,
      signInUrl: () => '/studio/signin',
    },
  });
  assert.equal(handled, true, `${method} ${path} handled`);
  return response;
}

const FOLLOW_A = '/?open=ui/Alpha.tsx&present=follow';
const sameAnswer = (a, b, where) => {
  assert.equal(a.status, b.status, `${where}: status`);
  assert.deepEqual(a.headers, b.headers, `${where}: headers`);
  assert.equal(a.body, b.body, `${where}: body`);
};

describe('GET /present/<canvas> per role', () => {
  test('owner, member, viewer (Can comment) and observer (Can view) are sent to the follower root', async () => {
    for (const role of ['owner', 'member', 'viewer', 'observer']) {
      const res = await ask('/present/ui/Alpha', { bearer: t[role] });
      assert.equal(res.status, 302, role);
      assert.equal(res.headers.location, FOLLOW_A, role);
      assert.equal(res.headers['cache-control'], 'no-store', role);
    }
  });

  test('browser cookies: a project session and a canvas-only Can view on A open A', async () => {
    const owner = await ask('/present/ui/Alpha', { cookie: t.owner });
    assert.equal(owner.status, 302);
    assert.equal(owner.headers.location, FOLLOW_A);
    const ann = await ask('/present/ui/Alpha', { cookie: t.aViewCookie });
    assert.equal(ann.status, 302, 'canvas-only Can view on A');
    assert.equal(ann.headers.location, FOLLOW_A);
  });

  test('canvas grants: Can view / comment / edit on A open A, and B answers exactly as a missing canvas', async () => {
    for (const role of ['aView', 'aComment', 'aEdit']) {
      const a = await ask('/present/ui/Alpha', { bearer: t[role] });
      assert.equal(a.status, 302, `${role} on A`);
      const b = await ask('/present/ui/canary-b-zx', { bearer: t[role] });
      const nope = await ask('/present/ui/nothing-here', { bearer: t[role] });
      assert.equal(b.status, 404, `${role} on B`);
      sameAnswer(b, nope, `${role}: B vs missing`);
      assert.equal(/canary/i.test(JSON.stringify(b.headers) + b.body), false, 'no B byte');
    }
    const b = await ask('/present/ui/canary-b-zx', { cookie: t.aViewCookie });
    const nope = await ask('/present/ui/nothing-here', { cookie: t.aViewCookie });
    sameAnswer(b, nope, 'canvas-only cookie: B vs missing');
  });

  test('a missing canvas answers like a forbidden one for a project role too, and the drawn path resolves', async () => {
    const owner = await ask('/present/ui/nothing-here', { bearer: t.owner });
    const forbidden = await ask('/present/ui/canary-b-zx', { bearer: t.aView });
    sameAnswer(owner, forbidden, 'missing (owner) vs forbidden (A-only)');
    const drawn = await ask('/present/combine-kampan', { bearer: t.member });
    assert.equal(drawn.status, 302);
    assert.equal(drawn.headers.location, '/?open=combine-kampan.tsx&present=follow');
  });

  test('a symlink out of the design root is a missing canvas', async () => {
    const esc = await ask('/present/ui/escape', { bearer: t.owner });
    const nope = await ask('/present/ui/nothing-here', { bearer: t.owner });
    sameAnswer(esc, nope, 'symlink escape');
  });
});

describe('signed out', () => {
  test('an HTML navigation goes to sign-in and remembers the follow form', async () => {
    const res = await ask('/present/ui/Alpha');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/studio/signin');
    const saved = [res.headers['set-cookie']].flat().find((c) => c.startsWith('maude_return='));
    assert.ok(saved, 'return cookie');
    const back = takeReturnTo({ headers: { cookie: saved.split(';')[0] } }, fakeResponse());
    assert.equal(back, FOLLOW_A);
  });

  test('a role-null cookie without a claim is signed out; an API call gets a 401', async () => {
    const stale = await ask('/present/ui/Alpha', { cookie: t.stale });
    assert.equal(stale.status, 302);
    assert.equal(stale.headers.location, '/studio/signin');
    assert.equal(
      browserSession(dataDir, SECRET, { headers: { cookie: `maude_studio=${t.stale}` } }),
      null
    );
    const api = await ask('/present/ui/Alpha', { accept: 'application/json' });
    assert.equal(api.status, 401);
    // The sign-in answer does not depend on whether the canvas exists.
    const missing = await ask('/present/ui/nothing-here', { accept: 'application/json' });
    sameAnswer(api, missing, 'signed out: existing vs missing');
  });
});

describe('the path grammar and methods', () => {
  test('presentRelOf', () => {
    assert.equal(presentRelOf('/present/combine-kampan'), 'combine-kampan.tsx');
    assert.equal(presentRelOf('/present/ui/%C5%BD%C3%A1ba'), 'ui/Žába.tsx');
    // NFC: a decomposed Ž is the composed one.
    assert.equal(presentRelOf('/present/Z%CC%8C'), 'Ž.tsx');
    for (const bad of [
      '/present/',
      '/present//a',
      '/present/a/',
      '/present/./a',
      '/present/a/../b',
      '/present/%2e%2e/a',
      '/present/_canvas-state/a',
      '/present/a%2Fb',
      '/present/a%5Cb',
      '/present/a\\b',
      '/present/a:b',
      '/present/a%00b',
      '/present/a%0Ab',
      '/present/%ZZ',
      `/present/${'a'.repeat(1025)}`,
      '/presentx/a',
    ]) {
      assert.equal(presentRelOf(bad), null, bad);
    }
  });

  test('a refused path answers exactly as a missing canvas, signed in', async () => {
    const nope = await ask('/present/ui/nothing-here', { bearer: t.owner });
    for (const bad of ['/present/_canvas-state/x', '/present/a/../ui/Alpha', '/present/a%2Fb']) {
      sameAnswer(await ask(bad, { bearer: t.owner }), nope, bad);
    }
  });

  test('HEAD is a GET; every other method is 405, whoever asks', async () => {
    const head = await ask('/present/ui/Alpha', { method: 'HEAD', bearer: t.owner });
    assert.equal(head.status, 302);
    assert.equal(head.body, '');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const who of [{ bearer: t.owner }, { bearer: t.aView }, {}]) {
        const res = await ask('/present/ui/Alpha', { method, ...who });
        assert.equal(res.status, 405, `${method} ${JSON.stringify(Object.keys(who))}`);
        assert.equal(res.headers.allow, 'GET, HEAD');
      }
    }
  });
});

describe('the route table and the hub', () => {
  test('one row, canvas scope, a canvas door with a handler', () => {
    const row = rowFor('/present/ui/Alpha');
    assert.ok(row && HUB_ROUTE_ROWS.includes(row));
    assert.equal(row.scope, 'canvas');
    assert.equal(row.canvasDoor, true);
    assert.equal(typeof row.handler, 'function');
    assert.deepEqual(row.cap, { safe: 'read', unsafe: null });
  });

  test('runHubRoutes answers a canvas-only bearer through the canvas door (not the fail-closed 403)', async () => {
    const response = fakeResponse();
    const handled = await runHubRoutes({
      request: {
        method: 'GET',
        url: '/present/ui/Alpha',
        headers: { authorization: `Bearer ${t.aView}` },
      },
      response,
      method: 'GET',
      path: '/present/ui/Alpha',
      verify: (token) => verifyToken(dataDir, token, SECRET),
      respondJson: (status, body) => {
        response.writeHead(status);
        response.end(JSON.stringify(body));
      },
      deps: { browserSession: () => null, designRoot: () => designRoot, signInUrl: () => '/s' },
    });
    assert.equal(handled, true);
    assert.equal(response.status, 302);
  });

  test('a running hub routes /present to the handler (no studio here → the 404; signed out → sign-in)', async () => {
    const hubDir = tmpDir('maude-present-hub-');
    const tokens = seedTokens(hubDir);
    const hub = await startHub(hubDir, { rateLimit: false });
    try {
      const signedIn = await fetch(`${hub.http}/present/ui/Alpha`, {
        headers: { authorization: `Bearer ${tokens.owner}`, accept: 'text/html' },
        redirect: 'manual',
      });
      assert.equal(signedIn.status, 404);
      const post = await fetch(`${hub.http}/present/ui/Alpha`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokens.viewer}` },
        redirect: 'manual',
      });
      assert.equal(post.status, 405);
      const out = await fetch(`${hub.http}/present/ui/Alpha`, {
        headers: { accept: 'text/html' },
        redirect: 'manual',
      });
      assert.equal(out.status, 302);
    } finally {
      await hub.close();
      rm(hubDir);
    }
  });
});
