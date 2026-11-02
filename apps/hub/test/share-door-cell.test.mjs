// The cloud tab's Share door — P8 cloud-share (decision maude/v2-8.4-lead-cloud-share-via-cell-fixed-map).
//
// In a cell the browser's Share sheet and Ask to edit call `/_api/share/*` — the same client path the
// desktop serves (routes/share.ts). The studio child refuses that family (it is linked to nothing,
// S9.19), so the HUB answers it before forwarding: by the SAME fixed map the desktop uses
// (apps/studio/access/share-map.ts), as the browser session the request carries, judged by the hub's
// own access rows exactly as a bearer of that session's role is judged. Cookie-authenticated, so only
// a same-origin page may ask.
//
// Driven through the one route table (`runHubRoutes`), per role: owner lists, invites, resends,
// revokes; a viewer may only ask; a cross-site request is refused; a forged id / path never becomes
// an access call; a hub without a studio does not answer.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAccessService } from '../src/routes-v2/access.mjs';
import { classifyHubRequest, HUB_ROUTE_ROWS, runHubRoutes } from '../src/routes-v2/index.mjs';
import { browserSession } from '../src/server.mjs';
import { decide } from '../src/studio-manifest.mjs';
import { verifyToken } from '../src/tokens.mjs';
import { createUser } from '../src/users.mjs';
import { A, rm, seedTokens, tmpDir } from './_acl-docs-fixture.mjs';

const SECRET = 'test-secret';
const ORIGIN = 'http://studio.cell.test';
const PW = 'correct horse battery staple';

let dataDir;
let t;
let access;

before(() => {
  dataDir = tmpDir('maude-share-door-');
  t = seedTokens(dataDir);
  createUser(dataDir, { email: 'olga@x.test', password: PW, role: 'admin' });
  createUser(dataDir, { email: 'vera@x.test', password: PW, role: 'member' });
  access = createAccessService({
    dataDir,
    secret: SECRET,
    publicUrl: ORIGIN,
    env: {},
    connections: () => [],
    kickLabel: () => 0,
  });
});
after(() => rm(dataDir));

function fakeResponse() {
  const headers = {};
  return {
    status: 0,
    body: '',
    headers,
    setHeader: (k, v) => {
      headers[k.toLowerCase()] = v;
    },
    getHeader: (k) => headers[k.toLowerCase()],
    writeHead(status, values = {}) {
      this.status = status;
      for (const [k, v] of Object.entries(values)) headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      if (chunk) this.body += String(chunk);
    },
  };
}

/**
 * One request through the hub's one route table, as a browser tab on the cell would send it.
 * `site` is the Sec-Fetch-Site header (null = absent); `share: false` = a hub with no studio.
 */
async function ask(
  method,
  path,
  {
    who = null,
    body,
    site = 'same-origin',
    origin = method === 'GET' ? null : ORIGIN,
    bearer = null,
    share = true,
    canvasHost = false,
  } = {}
) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const request = Readable.from(text ? [Buffer.from(text)] : []);
  request.method = method;
  request.url = path;
  request.headers = {
    host: 'studio.cell.test',
    accept: 'application/json',
    ...(text ? { 'content-type': 'application/json' } : {}),
    ...(who ? { cookie: `maude_studio=${encodeURIComponent(t[who] ?? who)}` } : {}),
    ...(site ? { 'sec-fetch-site': site } : {}),
    ...(origin ? { origin } : {}),
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
  };
  const response = fakeResponse();
  const handled = await runHubRoutes({
    request,
    response,
    method,
    path: path.split('?')[0],
    canvasHost,
    verify: (token) => verifyToken(dataDir, token, SECRET),
    respondJson: (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    },
    deps: {
      access,
      browserSession: (req) => browserSession(dataDir, SECRET, req),
      share: share ? { publicUrl: ORIGIN } : null,
    },
  });
  let parsed = null;
  try {
    parsed = response.body ? JSON.parse(response.body) : null;
  } catch {
    parsed = null;
  }
  return { handled, status: response.status, body: parsed, text: response.body };
}

describe('the owner, in a cloud tab', () => {
  test('posture: linked and reachable, Invite drawn, the hub posture', async () => {
    const r = await ask('GET', '/_api/share/posture', { who: 'owner' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.linked, true);
    assert.equal(r.body.reachable, true);
    assert.deepEqual(r.body.you, { invite: true });
    assert.equal(r.body.access.authority, 'hub');
    assert.equal(r.body.access.requests, true);
  });

  test('me: the caps the hub gives this session', async () => {
    const r = await ask('GET', '/_api/share/me', { who: 'owner' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.caps.invite, true);
  });

  test('lists, invites, resends and revokes', async () => {
    const people = await ask('GET', '/_api/share/people', { who: 'owner' });
    assert.equal(people.status, 200, people.text);
    assert.ok(Array.isArray(people.body.people));
    // Every key but { email, role, canvas? } is dropped by the map.
    const made = await ask('POST', '/_api/share/invites', {
      who: 'owner',
      body: { email: 'new@x.test', role: 'member', note: 'hi', createdBy: 'mallory@x.test' },
    });
    assert.equal(made.status, 201, made.text);
    assert.match(made.body.id, /^[0-9a-f]{16}$/);
    const again = await ask('POST', `/_api/share/invites/${made.body.id}/resend`, { who: 'owner' });
    assert.equal(again.status, 200, again.text);
    const gone = await ask('POST', `/_api/share/invites/${made.body.id}/revoke`, { who: 'owner' });
    assert.equal(gone.status, 204, gone.text);
    const twice = await ask('POST', `/_api/share/invites/${made.body.id}/revoke`, { who: 'owner' });
    assert.equal(twice.status, 404);
    assert.equal(twice.body.reason, 'gone');
  });
});

describe('a viewer may only ask', () => {
  test('posture and me say no Invite', async () => {
    const p = await ask('GET', '/_api/share/posture', { who: 'viewer' });
    assert.deepEqual(p.body.you, { invite: false });
    const me = await ask('GET', '/_api/share/me', { who: 'viewer' });
    assert.equal(me.status, 200, me.text);
    assert.equal(me.body.caps.invite, false);
    assert.equal(me.body.caps.request, true);
  });

  test('Ask to edit sends — once — and the owner reads it, rebuilt row by row', async () => {
    const asked = await ask('POST', '/_api/share/requests', {
      who: 'viewer',
      body: { note: '<img src=x onerror=alert(1)>' },
    });
    assert.equal(asked.status, 201, asked.text);
    const twice = await ask('POST', '/_api/share/requests', { who: 'viewer', body: {} });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.reason, 'pending');
    const list = await ask('GET', '/_api/share/requests', { who: 'owner' });
    assert.equal(list.status, 200, list.text);
    const row = list.body.requests.find((r) => r.id === asked.body.id);
    assert.ok(row, 'the owner sees the request');
    assert.deepEqual(Object.keys(row).sort(), ['at', 'from', 'id']);
    assert.equal(row.from.email, 'vera@x.test');
    const no = await ask('POST', `/_api/share/requests/${asked.body.id}/decline`, { who: 'owner' });
    assert.equal(no.status, 200, no.text);
  });

  test('every owner action is refused before the access API hears it', async () => {
    const owner403 = [
      ['GET', '/_api/share/requests'],
      ['POST', '/_api/share/invites', { email: 'z@x.test', role: 'member' }],
      ['POST', '/_api/share/invites/abc/resend'],
      ['POST', '/_api/share/invites/abc/revoke'],
      ['PATCH', '/_api/share/people/u_1', { role: 'member' }],
      ['POST', '/_api/share/people/u_1/remove'],
      ['POST', '/_api/share/links', { role: 'viewer', who: 'team' }],
      ['PATCH', '/_api/share/links/l_1', { off: true }],
      ['POST', '/_api/share/requests/r_1/approve'],
      ['POST', '/_api/share/requests/r_1/decline'],
    ];
    for (const who of ['viewer', 'observer', 'member']) {
      for (const [method, path, body] of owner403) {
        const r = await ask(method, path, { who, body });
        assert.equal(r.status, 403, `${who} ${method} ${path}: ${r.text}`);
        assert.equal(r.body.reason, 'not-allowed', `${who} ${method} ${path}`);
      }
    }
  });

  test('a canvas-only session sees no link route (links are project business)', async () => {
    const r = await ask('POST', '/_api/share/links', {
      who: 'aComment',
      body: { role: 'viewer', who: 'team' },
    });
    assert.equal(r.status, 404);
    assert.equal(r.text, 'Not found');
  });
});

describe('cookie-authenticated: only the cell’s own page may ask', () => {
  test('cross-site, same-site and a missing Sec-Fetch-Site are refused — reads and writes', async () => {
    for (const site of ['cross-site', 'same-site', 'none', null]) {
      for (const [method, path, body] of [
        ['POST', '/_api/share/requests', {}],
        ['POST', '/_api/share/invites', { email: 'x@x.test', role: 'member' }],
        ['GET', '/_api/share/people'],
      ]) {
        const r = await ask(method, path, { who: 'owner', site, body });
        assert.equal(r.status, 403, `${site} ${method} ${path}: ${r.text}`);
        assert.equal(r.body.reason, 'cross-site', `${site} ${method} ${path}`);
      }
    }
  });

  test('a write whose Origin is another site is refused even with same-origin', async () => {
    const r = await ask('POST', '/_api/share/invites', {
      who: 'owner',
      origin: 'https://evil.test',
      body: { email: 'x@x.test', role: 'member' },
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, 'cross-site');
  });

  test('no session, a stale cookie or a bearer alone: sign in (no second auth mode)', async () => {
    for (const opts of [{}, { who: 'not-a-token' }, { bearer: t.owner }]) {
      const r = await ask('GET', '/_api/share/people', opts);
      assert.equal(r.status, 401, JSON.stringify(opts));
    }
  });

  test('the canvas origin never reaches the door', () => {
    const { row } = classifyHubRequest('POST', '/_api/share/requests', { canvasHost: true });
    assert.equal(typeof row.handler, 'undefined');
  });
});

describe('the fixed map: a forged id or path is never sent', () => {
  test('ids that are not ids answer the route’s own 404', async () => {
    for (const id of ['..', 'a.b', '%2E%2E', 'abc%2F..%2Fpeople', 'x'.repeat(129)]) {
      const r = await ask('POST', `/_api/share/invites/${id}/revoke`, { who: 'owner' });
      assert.equal(r.status, 404, `${id}: ${r.text}`);
      assert.equal(r.body.reason, 'gone', id);
    }
  });

  test('a path or method the map does not name is not found', async () => {
    for (const [method, path] of [
      ['GET', '/_api/share/whatever'],
      ['DELETE', '/_api/share/invites/abc'],
      ['GET', '/_api/share/invites'],
      ['POST', '/_api/share/invites/abc/../../people/u_1/remove'],
      ['POST', '/_api/share/requests/abc/approve/extra'],
    ]) {
      const r = await ask(method, path, { who: 'owner' });
      assert.equal(r.status, 404, `${method} ${path}: ${r.text}`);
    }
  });

  test('a canvas path that is not one is refused', async () => {
    const people = await ask('GET', '/_api/share/people?canvas=../secret.tsx', { who: 'owner' });
    assert.equal(people.status, 403);
    assert.equal(people.body.reason, 'not-in-scope');
    const remove = await ask('POST', '/_api/share/people/u_1/remove', {
      who: 'owner',
      body: { canvas: '/etc/passwd' },
    });
    assert.equal(remove.status, 400);
    assert.equal(remove.body.reason, 'canvas');
    const asked = await ask('POST', '/_api/share/requests', {
      who: 'viewer',
      body: { canvas: `${A}/../../x` },
    });
    assert.equal(asked.status, 403);
  });

  test('a body that is not a JSON object is refused', async () => {
    const r = await ask('POST', '/_api/share/invites', { who: 'owner', body: '[1,2]' });
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, 'body');
  });
});

describe('where the door is', () => {
  test('a hub with no studio does not answer /_api/share/*', async () => {
    const r = await ask('GET', '/_api/share/people', { who: 'owner', share: false });
    assert.equal(r.handled, false);
  });

  test('the studio child still refuses the family (the hub answers before forwarding)', () => {
    for (const path of ['/_api/share/people', '/_api/share/requests', '/_api/share/posture']) {
      assert.equal(decide('GET', path, 'owner').allow, false, path);
    }
  });

  test('one row in the one table, and the hub imports the desktop’s map', () => {
    assert.ok(HUB_ROUTE_ROWS.some((r) => r.path === '/_api/share/*'));
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'src', 'routes-v2', 'share.mjs'), 'utf8');
    assert.match(src, /from '\.\.\/\.\.\/\.\.\/studio\/access\/share-map\.ts'/);
  });
});
