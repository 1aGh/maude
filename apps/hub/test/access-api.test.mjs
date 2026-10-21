// The access API on a self-hosted hub — V2-1.7 §5.6, S9.6.
//
// The hub is the authority here: people are accounts, invitations are
// `invites.mjs` rows, Ask to edit is the `access_requests` table. Every route
// is driven per role — owner · member · viewer · observer · canvas-only ·
// stranger — and the refusals are pinned by status AND reason, because the
// Share sheet words its answer from `reason`.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { peekInvite } from '../src/invites.mjs';
import { ACCESS_ROWS, accessPosture } from '../src/routes-v2/access.mjs';
import { HUB_ROUTE_ROWS } from '../src/routes-v2/index.mjs';
import { createUser, getUser } from '../src/users.mjs';
import { A, B, http, NOPE, rm, seedTokens, startHub, tmpDir } from './_acl-docs-fixture.mjs';

const PW = 'correct horse battery staple';

/** One hub per posture: before the Q13 flip, and after it. */
async function bootHub(opts) {
  const dataDir = tmpDir('maude-access-api-');
  const t = seedTokens(dataDir);
  createUser(dataDir, { email: 'olga@x.test', password: PW, role: 'admin' });
  createUser(dataDir, { email: 'max@x.test', password: PW, role: 'member' });
  t.stranger = 'not-a-token-at-all';
  const hub = await startHub(dataDir, { rateLimit: false, ...opts });
  return { dataDir, t, hub, as: (who) => http(hub.http, who ? t[who] : null) };
}

describe('the posture (/health.access)', () => {
  test('self-hosted, before the flip: owner + member, whole projects, no links', () => {
    assert.deepEqual(accessPosture({ env: {}, rolesV2: false }), {
      authority: 'hub',
      roles: ['member', 'owner'],
      scopes: ['project'],
      links: false,
      requests: true,
    });
  });
  test('self-hosted, after the flip: This canvas joins, still no view-only roles', () => {
    const p = accessPosture({ env: {}, rolesV2: true });
    assert.deepEqual(p.scopes, ['project', 'canvas']);
    assert.deepEqual(p.roles, ['member', 'owner']);
    assert.equal(p.links, false);
  });
  test('a cloud cell: v1 roles before the flip, all four + links after', () => {
    const env = { MAUDE_CLOUD_IDENTITY: '1' };
    assert.deepEqual(accessPosture({ env, rolesV2: false }), {
      authority: 'control-plane',
      roles: ['viewer', 'member', 'owner'],
      scopes: ['project'],
      links: false,
      requests: true,
    });
    const v2 = accessPosture({ env, rolesV2: true });
    assert.deepEqual(v2.roles, ['observer', 'viewer', 'member', 'owner']);
    assert.deepEqual(v2.scopes, ['project', 'canvas']);
    assert.equal(v2.links, true);
  });
  test('every access row is in the one table', () => {
    for (const row of ACCESS_ROWS) assert.ok(HUB_ROUTE_ROWS.includes(row), row.path);
  });
});

describe('the access API, self-hosted (before the flip)', () => {
  let ctx;
  before(async () => {
    ctx = await bootHub({});
  });
  after(async () => {
    await ctx.hub.close();
    rm(ctx.dataDir);
  });

  test('/health carries the posture and no roles-v2 yet', async () => {
    const res = await fetch(`${ctx.hub.http}/health`);
    const body = await res.json();
    assert.equal(body.access.authority, 'hub');
    assert.deepEqual(body.access.scopes, ['project']);
    assert.equal(body.capabilities.includes('roles-v2'), false);
  });

  test('GET me: the caps per role, from the verified session', async () => {
    const me = async (who) => (await ctx.as(who).get('/api/access/me')).body;
    assert.equal((await me('owner')).caps.invite, true);
    const member = await me('member');
    assert.equal(member.role, 'member');
    assert.equal(member.caps.edit, true);
    assert.equal(member.caps.invite, false);
    const viewer = await me('viewer');
    assert.equal(viewer.caps.comment, true);
    assert.equal(viewer.caps.edit, false);
    assert.equal(viewer.caps.request, true);
    const observer = await me('observer');
    assert.equal(observer.caps.comment, false);
    assert.equal(observer.caps.export, false);
    assert.equal(observer.caps.request, true);
    const scoped = await me('aEdit');
    assert.equal(scoped.role, null);
    assert.deepEqual(scoped.grants, [{ c: A, r: 'member' }]);
    assert.equal(scoped.caps.read, false);
    assert.equal(scoped.canvasCaps[A].edit, true);
    assert.equal((await ctx.as('stranger').get('/api/access/me')).status, 401);
    assert.equal((await ctx.as(null).get('/api/access/me')).status, 401);
  });

  test('POST invites: the owner invites Can edit; view-only roles are not on this hub', async () => {
    const owner = ctx.as('owner');
    const made = await owner.post('/api/access/invites', { email: 'new@x.test', role: 'member' });
    assert.equal(made.status, 201, made.text);
    assert.match(made.body.id, /^[0-9a-f]{16}$/);
    assert.equal(made.body.sent, false);
    assert.match(made.body.url, /\/join\/inv_/);
    assert.ok(made.body.expiresAt > Date.now());
    for (const role of ['viewer', 'observer']) {
      const r = await owner.post('/api/access/invites', { email: 'v@x.test', role });
      assert.equal(r.status, 422);
      assert.equal(r.body.reason, 'role-unsupported');
    }
    const bad = await owner.post('/api/access/invites', { email: 'nope', role: 'member' });
    assert.equal(bad.body.reason, 'email');
    const own = await owner.post('/api/access/invites', { email: 'o@x.test', role: 'owner' });
    assert.equal(own.status, 422);
    // This canvas is not offered before the flip — refused, never stored.
    const scoped = await owner.post('/api/access/invites', {
      email: 'c@x.test',
      role: 'member',
      canvas: A,
    });
    assert.equal(scoped.status, 422);
    assert.equal(scoped.body.reason, 'scope-unsupported');
  });

  test('invites, links and people writes: refused for every role but the owner', async () => {
    const writes = [
      ['POST', '/api/access/invites', { email: 'z@x.test', role: 'member' }],
      ['POST', '/api/access/links', { role: 'viewer', who: 'team' }],
      ['PATCH', '/api/access/people/u_0000000000000000', { role: 'member' }],
      ['DELETE', '/api/access/people/u_0000000000000000'],
      ['GET', '/api/access/requests'],
      ['POST', '/api/access/requests/req_0000000000000000/approve', {}],
    ];
    const expect = {
      member: [403, 'read-only'],
      viewer: [403, 'read-only'],
      observer: [403, 'read-only'],
      aEdit: [403, 'not-in-scope'],
      aView: [403, 'not-in-scope'],
      stranger: [401, 'unauthorized'],
    };
    for (const [who, [status, reason]] of Object.entries(expect)) {
      for (const [method, path, body] of writes) {
        const r = await ctx.as(who).send(method, path, body);
        assert.equal(r.status, status, `${who} ${method} ${path}: ${r.text}`);
        // The request list's row answers canvas-only sessions itself (POST is
        // Ask to edit), so its GET refuses them as any other non-owner.
        const want = path === '/api/access/requests' && who.startsWith('a') ? 'read-only' : reason;
        assert.equal(r.body.reason, want, `${who} ${method} ${path}`);
      }
    }
  });

  test('POST links: 422 link-role above Can comment, role-unsupported below', async () => {
    const owner = ctx.as('owner');
    for (const role of ['member', 'owner']) {
      const r = await owner.post('/api/access/links', { role, who: 'team' });
      assert.equal(r.status, 422);
      assert.equal(r.body.reason, 'link-role');
    }
    const view = await owner.post('/api/access/links', { role: 'viewer', who: 'anyone' });
    assert.equal(view.status, 422);
    assert.equal(view.body.reason, 'role-unsupported');
  });

  test('resend issues a new link (the old one dies); delete revokes', async () => {
    const owner = ctx.as('owner');
    const made = await owner.post('/api/access/invites', { email: 'r@x.test', role: 'member' });
    const oldValue = made.body.url.split('/join/')[1];
    const again = await owner.post(`/api/access/invites/${made.body.id}/resend`, {});
    assert.equal(again.status, 200, again.text);
    const newValue = again.body.url.split('/join/')[1];
    assert.notEqual(newValue, oldValue);
    assert.equal(peekInvite(ctx.dataDir, oldValue).ok, false);
    assert.equal(peekInvite(ctx.dataDir, newValue).ok, true);
    assert.equal((await owner.send('DELETE', `/api/access/invites/${made.body.id}`)).status, 204);
    const gone = await owner.send('DELETE', `/api/access/invites/${made.body.id}`);
    assert.equal(gone.status, 404);
    assert.equal(gone.body.reason, 'gone');
  });

  test('Ask to edit: 201 once, 409 pending, 409 already-can-edit, U1 for an unseen canvas', async () => {
    const viewer = ctx.as('viewer');
    const first = await viewer.post('/api/access/requests', {});
    assert.equal(first.status, 201, first.text);
    assert.match(first.body.id, /^req_/);
    const second = await viewer.post('/api/access/requests', {});
    assert.equal(second.status, 409);
    assert.equal(second.body.reason, 'pending');
    // A different scope is a different request.
    assert.equal((await viewer.post('/api/access/requests', { canvas: A })).status, 201);
    assert.equal((await ctx.as('observer').post('/api/access/requests', {})).status, 201);
    for (const who of ['owner', 'member']) {
      const r = await ctx.as(who).post('/api/access/requests', {});
      assert.equal(r.status, 409, who);
      assert.equal(r.body.reason, 'already-can-edit');
    }
    const onA = await ctx.as('aEdit').post('/api/access/requests', { canvas: A });
    assert.equal(onA.body.reason, 'already-can-edit');
    // B answers byte-for-byte as a canvas that does not exist.
    const onB = await ctx.as('aView').post('/api/access/requests', { canvas: B });
    const onNope = await ctx.as('aView').post('/api/access/requests', { canvas: NOPE });
    assert.equal(onB.status, 403);
    assert.equal(onB.text, onNope.text);
    assert.doesNotMatch(onB.text, /canary/i);
    assert.equal((await ctx.as('stranger').post('/api/access/requests', {})).status, 401);

    const listed = await ctx.as('owner').get('/api/access/requests');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.requests.length, 3);
    // Vera has no account on this hub: approving her is an invite, not a grant.
    const approve = await ctx.as('owner').post(`/api/access/requests/${first.body.id}/approve`, {});
    assert.equal(approve.status, 422);
    assert.equal(approve.body.reason, 'no-account');
    const decline = await ctx.as('owner').post(`/api/access/requests/${first.body.id}/decline`, {});
    assert.equal(decline.status, 200);
    const twice = await ctx.as('owner').post(`/api/access/requests/${first.body.id}/decline`, {});
    assert.equal(twice.status, 404);
  });

  test('PATCH people: the owner stays the owner; view-only roles are not on this hub', async () => {
    const owner = ctx.as('owner');
    const people = (await owner.get('/api/access/people')).body.people;
    const olga = people.find((p) => p.email === 'olga@x.test');
    const max = people.find((p) => p.email === 'max@x.test');
    assert.equal(olga.role, 'owner');
    assert.equal(max.role, 'member');
    assert.match(max.id, /^u_[0-9a-f]{16}$/);
    const o = await owner.send('PATCH', `/api/access/people/${olga.id}`, { role: 'member' });
    assert.equal(o.status, 422);
    assert.equal(o.body.reason, 'owner-immutable');
    const up = await owner.send('PATCH', `/api/access/people/${max.id}`, { role: 'owner' });
    assert.equal(up.body.reason, 'owner-immutable');
    const down = await owner.send('PATCH', `/api/access/people/${max.id}`, { role: 'viewer' });
    assert.equal(down.body.reason, 'role-unsupported');
    const same = await owner.send('PATCH', `/api/access/people/${max.id}`, { role: 'member' });
    assert.equal(same.status, 200);
    const unknown = await owner.send('PATCH', '/api/access/people/u_0000000000000000', {
      role: 'member',
    });
    assert.equal(unknown.status, 404);
  });
});

describe('the access API, self-hosted (after the flip): This canvas', () => {
  let ctx;
  before(async () => {
    ctx = await bootHub({ rolesV2: true });
  });
  after(async () => {
    await ctx.hub.close();
    rm(ctx.dataDir);
  });

  test('/health lists roles-v2 and the canvas scope', async () => {
    const body = await (await fetch(`${ctx.hub.http}/health`)).json();
    assert.ok(body.capabilities.includes('roles-v2'));
    assert.deepEqual(body.access.scopes, ['project', 'canvas']);
  });

  test('a canvas invite stores its claim; a v1 redeem path cannot spend it', async () => {
    const made = await ctx
      .as('owner')
      .post('/api/access/invites', { email: 'petra@x.test', role: 'member', canvas: A });
    assert.equal(made.status, 201, made.text);
    const value = made.body.url.split('/join/')[1];
    const look = peekInvite(ctx.dataDir, value);
    assert.deepEqual(look.invite.access, { v: 1, role: null, grants: [{ c: A, r: 'member' }] });
    // The join door that mints from the account role refuses it (fail closed).
    const r = await fetch(`${ctx.hub.http}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: value, email: 'petra@x.test', password: PW }),
    });
    assert.notEqual(r.status, 201);
    assert.equal(peekInvite(ctx.dataDir, value).ok, true, 'the invite is still unspent');
  });

  test('an invitation answers the same for a known and an unknown address (gate-b-sec3)', async () => {
    const owner = ctx.as('owner');
    const known = await owner.post('/api/access/invites', { email: 'max@x.test', role: 'member' });
    const unknown = await owner.post('/api/access/invites', {
      email: 'nobody-yet@x.test',
      role: 'member',
    });
    assert.equal(known.status, 201);
    assert.equal(unknown.status, 201);
    const norm = (r) =>
      r.text
        .replaceAll(r.body.id, '<id>')
        .replace(r.body.url.split('/join/')[1], '<value>')
        .replace(String(r.body.expiresAt), '<expires>');
    assert.equal(norm(known), norm(unknown));
  });

  test('an existing canvas-only person gains a canvas only once they accept; a project member is unchanged (G1)', async () => {
    const dataDir = ctx.dataDir;
    createUser(dataDir, {
      email: 'bob@x.test',
      password: PW,
      role: 'member',
      access: { v: 1, role: null, grants: [{ c: B, r: 'member' }] },
    });
    const owner = ctx.as('owner');
    const onA = async () =>
      (await owner.get(`/api/access/people?canvas=${encodeURIComponent(A)}`)).body.people;
    const add = await owner.post('/api/access/invites', {
      email: 'bob@x.test',
      role: 'member',
      canvas: A,
    });
    assert.equal(add.status, 201);
    assert.deepEqual(
      getUser(dataDir, 'bob@x.test').access.grants.map((g) => g.c),
      [B],
      'not on A before accepting'
    );
    assert.ok(
      (await onA()).some((p) => p.email === 'bob@x.test' && p.state === 'invited'),
      'the owner sees the invitation waiting'
    );
    const value = add.body.url.split('/join/')[1];
    const join = (password) =>
      fetch(`${ctx.hub.http}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-maude-access': '2' },
        body: JSON.stringify({ token: value, email: 'bob@x.test', password }),
      });
    // a wrong password says the one neutral sentence and spends nothing
    const wrong = await join('not the password at all');
    assert.equal(wrong.status, 400);
    assert.match((await wrong.json()).error, /can't be used with this invitation/);
    assert.equal(peekInvite(dataDir, value).ok, true);
    // accepting = signing in as that address: A is added, B is kept
    const ok = await join(PW);
    assert.equal(ok.status, 201, await ok.clone().text());
    assert.deepEqual(
      getUser(dataDir, 'bob@x.test')
        .access.grants.map((g) => g.c)
        .sort(),
      [A, B].sort()
    );
    assert.equal(peekInvite(dataDir, value).ok, false, 'spent');
    // a project member invited to one canvas stays a project member
    const max = await owner.post('/api/access/invites', {
      email: 'max@x.test',
      role: 'member',
      canvas: A,
    });
    assert.equal(max.status, 201);
    const maxRow = (await onA()).find((p) => p.email === 'max@x.test');
    assert.equal(maxRow.role, 'member');
  });
});
