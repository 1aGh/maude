// P8 G1a (lead decision (a)) — a Can view desktop holds no hub socket, so it asks GET /api/access/me with
// its stored browser-lane credential. That bearer is answered there, read-only, with ITS OWN access; every
// other route keeps refusing it. And a narrowing to Can view must not kill the credential the person
// re-exchanged for the narrowed role inside the grace — otherwise her later removal has no session left to
// remember, and the poll hears today's plain 401 instead of `access-withdrawn` (d3.log, p8-t-share-3).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { resetEndedSessions } from '../src/ended-sessions.mjs';
import { addToken, listTokensForOwner } from '../src/tokens.mjs';
import { rm, sleep, startHub, tmpDir, until } from './_acl-docs-fixture.mjs';

const GRACE = 300;
const PETRA = 'petra@x.test';

/** Can view's browser-lane credential, stored the way the cell's browser lane mints it (peerSessionFields). */
const canView = (dataDir, label, owner = PETRA) =>
  addToken(dataDir, {
    label,
    owner,
    scope: '*',
    role: 'observer',
    readOnly: true,
    access: { v: 1, role: 'observer' },
  }).value;

describe('Can view’s browser-lane bearer on GET /api/access/me', () => {
  let dataDir;
  let hub;
  before(async () => {
    resetEndedSessions();
    dataDir = tmpDir('maude-observer-me-');
    hub = await startHub(dataDir, { rateLimit: false, switchGraceMs: GRACE });
  });
  after(async () => {
    await hub?.close();
    rm(dataDir);
  });

  const call = (path, token, { method = 'GET', body } = {}) =>
    fetch(`${hub.http}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'x-maude-access': '2',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const changed = (body) =>
    fetch(`${hub.http}/internal/access-changed`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('me answers it with its own access, read-only — and nothing else widens', async () => {
    const t = canView(dataDir, 'otto-view', 'otto@x.test');
    const me = await call('/api/access/me', t);
    assert.equal(me.status, 200);
    assert.equal(me.body.role, 'observer');
    assert.deepEqual(me.body.grants, []);
    assert.equal(me.body.caps.edit, false);
    assert.equal(me.body.caps.comment, false);
    assert.equal(me.body.caps.export, false);
    assert.equal(me.body.caps.invite, false);
    assert.equal((await call('/api/access/me', t, { method: 'POST', body: {} })).status, 405);
    // Every other privileged route keeps refusing the same bearer.
    for (const [method, path, body] of [
      ['GET', '/api/access/invites'],
      ['POST', '/api/access/invites', { email: 'x@x.test', role: 'viewer' }],
      ['PATCH', '/api/access/people/u-1', { role: 'owner' }],
      ['POST', '/api/trash/clear', {}],
      ['POST', '/api/export', {}],
    ]) {
      const r = await call(path, t, { method, body });
      assert.equal(r.status, 403, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    }
  });

  test('narrowed to Can view: the credential re-exchanged for Can view outlives the grace; the old one dies', async () => {
    const old = addToken(dataDir, {
      label: 'petra-comment',
      owner: PETRA,
      scope: '*',
      role: 'viewer',
      readOnly: true,
    }).value;
    assert.equal(
      (await changed({ email: PETRA, change: 'narrowed', role: 'observer' })).status,
      202
    );
    // Inside the grace: her window re-exchanges for what she is now — and one wider token appears too (the
    // old claim re-presented before the control plane's sweep): that one must die with the old session.
    const fresh = canView(dataDir, 'petra-view');
    const wider = addToken(dataDir, {
      label: 'petra-wider',
      owner: PETRA,
      scope: '*',
      role: 'viewer',
      readOnly: true,
      access: { v: 1, role: 'viewer' },
    }).value;
    await until(
      () => !listTokensForOwner(dataDir, PETRA).some((r) => r.label === 'petra-comment'),
      GRACE + 3000,
      'the old session ends after the grace'
    );
    await sleep(100);
    const left = listTokensForOwner(dataDir, PETRA).map((r) => r.label);
    assert.deepEqual(left, ['petra-view'], 'only the Can view credential is left');
    assert.equal((await call('/api/access/me', old)).status, 401);
    assert.equal((await call('/api/access/me', wider)).status, 401);
    assert.equal((await call('/api/access/me', fresh)).body?.role, 'observer');

    // Removed while she looks: her poll's own bearer hears why.
    assert.equal((await changed({ email: PETRA, change: 'ended', reason: 'removed' })).status, 202);
    await until(
      () => listTokensForOwner(dataDir, PETRA).length === 0,
      GRACE + 3000,
      'removal ends every session'
    );
    const ended = await call('/api/access/me', fresh);
    assert.equal(ended.status, 401);
    assert.equal(ended.body?.reason, 'access-withdrawn');
  });

  test('a narrowing that names no role (or a canvas-shaped one) ends every session, as before', async () => {
    const a = canView(dataDir, 'nora-view', 'nora@x.test');
    const b = canView(dataDir, 'ivo-view', 'ivo@x.test');
    assert.equal((await changed({ email: 'nora@x.test', change: 'narrowed' })).status, 202);
    assert.equal(
      (await changed({ email: 'ivo@x.test', change: 'narrowed', role: 'member' })).status,
      202
    );
    await until(
      () =>
        listTokensForOwner(dataDir, 'nora@x.test').length === 0 &&
        listTokensForOwner(dataDir, 'ivo@x.test').length === 0,
      GRACE + 3000,
      'both sessions end'
    );
    assert.equal((await call('/api/access/me', a)).status, 401);
    assert.equal((await call('/api/access/me', b)).status, 401);
  });
});
