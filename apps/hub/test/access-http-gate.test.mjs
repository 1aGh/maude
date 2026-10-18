// The hub's one HTTP capability gate — V2-1.7 §7 `access-http-gate` (S9.3).
//
// `readOnlyAllowedPath` (a hand list of the writes a read-only token may make)
// becomes capability-based: every classified row names what each method half
// needs, and the gate asks the one matrix. A write needs `edit` unless the row
// says `session` (sign out) or `export` (download); a byte route needs `export`
// on a GET too (A19). The handler-less `/api/studio/comments` string is gone.
//
// Per role: owner · member · viewer (Can comment) · observer (Can view).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  claimForMatch,
  hubAccessRefusal,
  NOT_IN_SCOPE_REFUSAL,
  OBSERVER_REFUSAL,
  READ_ONLY_REFUSAL,
} from '../src/access-gate.mjs';
import { checkHubRouteTable, classifyHubRequest, runHubRoutes } from '../src/routes-v2/index.mjs';

const SERVER_SRC = readFileSync(
  fileURLToPath(new URL('../src/server.mjs', import.meta.url)),
  'utf8'
);

// The peer tokens each role holds, as `verifyToken` returns them.
const MATCHES = {
  owner: { label: 'o', owner: 'o@x.test', role: 'owner', readOnly: false, scope: '*' },
  member: { label: 'm', owner: 'm@x.test', role: 'member', readOnly: false, scope: '*' },
  viewer: { label: 'v', owner: 'v@x.test', role: 'viewer', readOnly: true, scope: '*' },
  // The browser-lane cookie an observer holds (S9.2 `peerSessionFields`).
  observer: {
    label: 'b',
    owner: 'b@x.test',
    role: 'observer',
    readOnly: true,
    scope: '*',
    access: { v: 1, role: 'observer' },
  },
};

const verifyAs = (role) => (token) => (token === `tok-${role}` ? MATCHES[role] : null);

function call({ role, method, path, rows, canvasHost }) {
  const sent = [];
  const request = { headers: role ? { authorization: `Bearer tok-${role}` } : {} };
  return runHubRoutes({
    request,
    response: {},
    method,
    path,
    canvasHost,
    rows,
    verify: role ? verifyAs(role) : () => null,
    respondJson: (status, body) => sent.push({ status, body }),
  }).then((answered) => ({ answered, sent: sent[0] ?? null }));
}

const ROLES = ['owner', 'member', 'viewer', 'observer'];

describe('a write needs edit — today’s gate, now derived', () => {
  for (const [method, path] of [
    ['PUT', '/api/file/assets/a.png'],
    ['DELETE', '/api/documents/ws%2Fx%2Fmain%2Fa'],
    ['PUT', '/api/project-config'],
    ['POST', '/api/projects/current/v1/proposals'],
    // A path no row names (the studio's lane): the pre-v2 default holds.
    ['POST', '/_api/anything-new'],
  ]) {
    test(`${method} ${path}`, async () => {
      for (const role of ROLES) {
        const { answered, sent } = await call({ role, method, path });
        if (role === 'owner' || role === 'member') {
          assert.equal(answered, false, `${role} goes on to the handler`);
          continue;
        }
        assert.equal(answered, true, `${role} is refused`);
        assert.equal(sent.status, 403);
        // A viewer reads TODAY's sentence, byte for byte (v1.9.1 shows it);
        // Can view reads its own (V2-1.7 §5.9).
        assert.deepEqual(sent.body, role === 'viewer' ? READ_ONLY_REFUSAL : OBSERVER_REFUSAL);
      }
    });
  }
});

describe('the writes a read-only session still holds are named by capability', () => {
  test('signing out is `session`: every role', async () => {
    for (const path of ['/auth/logout', '/auth/browser/signout']) {
      for (const role of ROLES) {
        assert.equal(
          (await call({ role, method: 'POST', path })).answered,
          false,
          `${role} ${path}`
        );
      }
    }
  });

  test('/api/export is `export`: Can comment downloads, Can view does not (A19)', async () => {
    for (const role of ['owner', 'member', 'viewer']) {
      assert.equal((await call({ role, method: 'POST', path: '/api/export' })).answered, false);
    }
    const { sent } = await call({ role: 'observer', method: 'POST', path: '/api/export' });
    assert.equal(sent.status, 403);
    assert.deepEqual(sent.body, OBSERVER_REFUSAL);
  });

  test('a comment row needs `comment`: viewer reaches the handler, Can view never does', async () => {
    // The comment door itself is S9.7's (POST /api/comments); the gate is here.
    const reached = [];
    const rows = checkHubRouteTable([
      {
        path: '/api/comments',
        cap: { safe: 'read', unsafe: 'comment' },
        scope: 'canvas',
        handler: async (ctx) => {
          reached.push(ctx.capability);
          return true;
        },
      },
    ]);
    for (const role of ['owner', 'member', 'viewer']) {
      const { answered, sent } = await call({ role, method: 'POST', path: '/api/comments', rows });
      assert.equal(answered, true);
      assert.equal(sent, null, `${role} was answered by the handler, not refused`);
    }
    assert.deepEqual(reached, ['comment', 'comment', 'comment']);
    const { sent } = await call({ role: 'observer', method: 'POST', path: '/api/comments', rows });
    assert.equal(sent.status, 403);
    assert.equal(reached.length, 3, 'the handler never ran for Can view');
  });

  test('the handler-less /api/studio/comments allowance is gone', async () => {
    assert.equal(SERVER_SRC.includes('function readOnlyAllowedPath'), false);
    const { sent } = await call({ role: 'viewer', method: 'POST', path: '/api/studio/comments' });
    assert.equal(sent.status, 403, 'a viewer write to it is an ordinary refused write');
  });
});

describe('byte routes need export on a GET (A19)', () => {
  for (const path of [
    '/_project-file/assets/a.png',
    '/api/history/file',
    '/assets/a.png',
    '/api/projects/current/v1/lane',
    '/api/projects/current/v1/blobs/abc',
    '/api/projects/current/v1/bootstrap',
  ]) {
    test(path, async () => {
      for (const role of ['owner', 'member', 'viewer']) {
        assert.equal((await call({ role, method: 'GET', path })).answered, false, role);
      }
      const { sent } = await call({ role: 'observer', method: 'GET', path });
      assert.equal(sent.status, 403);
      assert.deepEqual(sent.body, OBSERVER_REFUSAL);
    });
  }

  test('looking stays open to Can view: journal, manifest, history list, presence', async () => {
    for (const path of [
      '/api/journal',
      '/api/files',
      '/api/history',
      '/_asset-file/assets/a.png',
      '/api/documents',
      '/api/projects/current/v1/history',
    ]) {
      assert.equal((await call({ role: 'observer', method: 'GET', path })).answered, false, path);
    }
  });
});

describe('who the gate judges', () => {
  test('no credential, or one that does not verify, is the handler’s 401 — not a 403', async () => {
    assert.equal(
      (await call({ role: null, method: 'GET', path: '/_project-file/a' })).answered,
      false
    );
    const r = await runHubRoutes({
      request: { headers: { authorization: 'Bearer nope' } },
      method: 'PUT',
      path: '/api/file/a',
      verify: () => null,
      respondJson: () => assert.fail('no refusal for an unverified token'),
    });
    assert.equal(r, false);
  });

  test('a role-less token keeps what it always had; the env secret is the owner', () => {
    assert.deepEqual(claimForMatch({ label: 'x', readOnly: true }), { v: 1, role: 'viewer' });
    assert.deepEqual(claimForMatch({ label: 'x', readOnly: false }), { v: 1, role: 'member' });
    assert.deepEqual(claimForMatch({ label: 'env-secret', source: 'env' }), {
      v: 1,
      role: 'owner',
    });
    // An account role is translated at the one boundary.
    assert.deepEqual(claimForMatch({ label: 'a', role: 'admin' }), { v: 1, role: 'owner' });
  });

  test('the read_only bit is never widened by a role column', () => {
    const refusal = hubAccessRefusal({
      request: { headers: { authorization: 'Bearer t' } },
      capability: 'edit',
      scope: 'canvas',
      verify: () => ({ label: 'x', role: 'member', readOnly: true }),
    });
    assert.equal(refusal.status, 403);
  });

  test('a canvas-only session reaches no project route yet (fail closed until S9.4/S9.5)', () => {
    const verify = () => ({
      label: 'c',
      readOnly: false,
      access: { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] },
    });
    const refusal = hubAccessRefusal({
      request: { headers: { authorization: 'Bearer t' } },
      capability: 'read',
      scope: 'filtered',
      verify,
    });
    assert.deepEqual(refusal, { status: 403, body: NOT_IN_SCOPE_REFUSAL });
    // A sign-out is not the project's.
    assert.equal(
      hubAccessRefusal({
        request: { headers: { authorization: 'Bearer t' } },
        capability: 'session',
        scope: 'none',
        verify,
      }),
      null
    );
  });

  test('the canvas origin is one lane: a peer token there still meets the write gate', () => {
    assert.equal(
      classifyHubRequest('PUT', '/_api/annotations', { canvasHost: true }).capability,
      'edit'
    );
    assert.equal(
      classifyHubRequest('GET', '/_project-file/a', { canvasHost: true }).capability,
      null
    );
  });
});

describe('onRequest calls the table once', () => {
  test('one call site, in place of the read-only gate', () => {
    const body = SERVER_SRC.slice(
      SERVER_SRC.indexOf('async onRequest('),
      SERVER_SRC.indexOf('async onConnect(')
    );
    assert.equal(body.match(/runHubRoutes\(/g)?.length ?? 0, 1);
    assert.equal(
      body.includes('bearer?.readOnly'),
      false,
      'the bit check lives in access-gate.mjs'
    );
  });
});
