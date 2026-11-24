// Admin by role — the second way into the admin API (admin-people.mjs).
//
// The admin key (DDR-053) is unchanged. A signed-in ACCOUNT whose role is
// `admin` may use the day-to-day routes — same-origin only, because a cookie
// rides on every request a browser makes — and never the key-only ones.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { closeAudit, listAudit } from '../src/audit-log.mjs';
import { closeInvites } from '../src/invites.mjs';
import { closeUsers, createUser, getUser } from '../src/users.mjs';
import { rm, startHub, tmpDir } from './_acl-docs-fixture.mjs';
import { browser } from './_fake-issuer.mjs';

const PW = 'correct horse battery staple';
let hub;
let dataDir;
let admin;
let member;

async function signedIn(email) {
  const b = browser(hub.http);
  const res = await b.form('/studio/signin', { email, password: PW });
  assert.equal(res.status, 302, await res.text());
  return b;
}
const key = (path, body) =>
  fetch(`${hub.http}/admin/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: 'Bearer test-secret',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

before(async () => {
  dataDir = tmpDir('maude-admin-role-');
  createUser(dataDir, { email: 'michal@x.test', password: PW, role: 'admin' });
  createUser(dataDir, { email: 'marek@x.test', password: PW, role: 'member' });
  hub = await startHub(dataDir, { rateLimit: false, env: {} });
  admin = await signedIn('michal@x.test');
  member = await signedIn('marek@x.test');
});
after(async () => {
  await hub.close();
  closeUsers(dataDir);
  closeInvites(dataDir);
  closeAudit(dataDir);
  rm(dataDir);
});

describe('a signed-in admin account', () => {
  test('/me says admin, by session — and nobody signed in is told so plainly', async () => {
    const me = await (await admin.json('/admin/api/me')).json();
    assert.equal(me.signedIn, true);
    assert.equal(me.admin, true);
    assert.equal(me.via, 'session');
    assert.equal(me.email, 'michal@x.test');
    assert.equal(me.roleLabel, 'Admin');

    const anon = await fetch(`${hub.http}/admin/api/me`);
    assert.equal(anon.status, 200);
    const body = await anon.json();
    assert.equal(body.signedIn, false);
    assert.equal(body.admin, false);
    assert.equal(body.email, undefined);

    const wrong = await fetch(`${hub.http}/admin/api/me`, {
      headers: { authorization: 'Bearer nope' },
    });
    assert.equal(wrong.status, 401, 'a wrong key is a 401 even here');
  });

  test('may use people, invites, activity, overview, status, canvases and settings', async () => {
    for (const path of [
      '/overview',
      '/people',
      '/activity',
      '/status',
      '/canvases',
      '/settings',
      '/users',
      '/invites',
      '/oidc/pending',
    ]) {
      const res = await admin.json(`/admin/api${path}`);
      assert.equal(res.status, 200, path);
    }
    const saved = await admin.json('/admin/api/settings', {
      name: 'StudyFi Design',
      whoCanJoin: 'invite-only',
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).whoCanJoin, 'invite-only');
    const row = listAudit(dataDir, { kind: 'settings' })[0];
    assert.equal(row.actor, 'michal@x.test', 'the log says WHO changed it');
    assert.match(row.detail, /who can join: ask → invite-only/);
  });

  test('may NOT rotate the admin key, mint or change peer tokens, or see and kick connected sessions', async () => {
    for (const [path, body] of [
      ['/admin-secret/rotate', {}],
      ['/token', { label: 'ci' }],
      ['/token/rotate', { label: 'ci' }],
      ['/token/delete', { label: 'ci' }],
      ['/peers/kick', { socketId: 'x' }],
      ['/tokens', undefined],
      ['/peers', undefined],
    ]) {
      const res = await admin.json(`/admin/api${path}`, body);
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).reason, 'admin-key-required');
    }
    // …all of which the key still does.
    assert.equal((await key('/tokens')).status, 200);
    assert.equal((await key('/token', { label: 'ci' })).status, 201);
  });

  test('a cookie alone is not enough: cross-site, same-site and header-less requests are refused', async () => {
    const cookie = `maude_studio=${admin.jar.get('maude_studio')}`;
    const post = (headers) =>
      fetch(`${hub.http}/admin/api/people/invite`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ emails: ['evil@x.test'], role: 'admin' }),
      });
    for (const headers of [
      { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      { 'sec-fetch-site': 'same-site', origin: 'https://canvas.x.test' },
      { 'sec-fetch-site': 'same-origin', origin: 'https://evil.example' },
      {},
    ]) {
      const res = await post(headers);
      assert.equal(res.status, 403, JSON.stringify(headers));
    }
    const get = await fetch(`${hub.http}/admin/api/people`, {
      headers: { cookie, 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(get.status, 403, 'a read is refused too');
    // A form post (no JSON content type) is refused even same-origin.
    const form = await fetch(`${hub.http}/admin/api/people/invite`, {
      method: 'POST',
      headers: {
        cookie,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'emails=evil@x.test',
    });
    assert.equal(form.status, 400);
  });

  test('a demotion applies to the very next request', async () => {
    createUser(dataDir, { email: 'tereza@x.test', password: PW, role: 'admin' });
    const tereza = await signedIn('tereza@x.test');
    assert.equal((await tereza.json('/admin/api/people')).status, 200);
    const res = await admin.json('/admin/api/people/role', {
      email: 'tereza@x.test',
      role: 'member',
    });
    assert.equal(res.status, 200);
    assert.equal(getUser(dataDir, 'tereza@x.test').role, 'member');
    assert.equal((await tereza.json('/admin/api/people')).status, 401, 'her session is ended');
    const back = await signedIn('tereza@x.test');
    assert.equal((await back.json('/admin/api/people')).status, 403);
    assert.equal((await (await back.json('/admin/api/me')).json()).admin, false);
  });
});

describe('a signed-in member', () => {
  test('gets their own page from /me and none of the admin data', async () => {
    const res = await member.json('/admin/api/me');
    assert.equal(res.status, 200);
    const me = await res.json();
    assert.equal(me.admin, false);
    assert.equal(me.email, 'marek@x.test');
    assert.equal(me.roleLabel, 'Can edit');
    assert.deepEqual(me.access, { everything: true });
    assert.deepEqual(me.runBy, ['Michal'], 'who runs the server — a name, never an address');
    assert.ok(!JSON.stringify(me).includes('michal@x.test'));
    assert.equal(me.sessions.length, 1);
    assert.equal(me.sessions[0].current, true);
    assert.equal(me.sessions[0].label, undefined, 'no token label on a member page');

    for (const path of [
      '/overview',
      '/people',
      '/activity',
      '/activity.csv',
      '/status',
      '/settings',
      '/users',
      '/invites',
      '/canvases',
      '/tokens',
    ]) {
      const r = await member.json(`/admin/api${path}`);
      assert.equal(r.status, 403, path);
      assert.equal((await r.json()).reason, 'not-admin');
    }
    const write = await member.json('/admin/api/people/role', {
      email: 'marek@x.test',
      role: 'admin',
    });
    assert.equal(write.status, 403);
    assert.equal(getUser(dataDir, 'marek@x.test').role, 'member');
  });
});

describe('a cloud cell is unchanged', () => {
  test('under MAUDE_CLOUD_IDENTITY the session way in does not exist', async () => {
    const d = tmpDir('maude-admin-cell-');
    createUser(d, { email: 'owner@x.test', password: PW, role: 'admin' });
    const cell = await startHub(d, { rateLimit: false, env: { MAUDE_CLOUD_IDENTITY: '1' } });
    try {
      const b = browser(cell.http);
      await b.form('/studio/signin', { email: 'owner@x.test', password: PW });
      assert.ok(b.jar.get('maude_studio'));
      assert.equal((await b.json('/admin/api/people')).status, 401);
      assert.equal((await b.json('/admin/api/me')).status, 401, 'no new answer on a cell');
      const viaKey = await fetch(`${cell.http}/admin/api/people/invite`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
        body: JSON.stringify({ emails: ['a@x.test'] }),
      });
      assert.equal(viaKey.status, 409, 'people are managed by the control plane');
      assert.equal(
        (
          await fetch(`${cell.http}/admin/api/status`, {
            headers: { authorization: 'Bearer test-secret' },
          })
        ).status,
        200,
        'the key works as before'
      );
    } finally {
      await cell.close();
      closeUsers(d);
      closeAudit(d);
      rm(d);
    }
  });
});

describe('the admin page returns you to itself after sign-in', () => {
  test('/studio/signin?return=admin → /admin, and nothing else is a return address', async () => {
    const b = browser(hub.http);
    await b.get('/studio/signin?return=admin');
    const res = await b.form('/studio/signin', { email: 'michal@x.test', password: PW });
    assert.equal(res.headers.get('location'), '/admin');
    const c = browser(hub.http);
    await c.get('/studio/signin?return=https://evil.example/');
    const other = await c.form('/studio/signin', { email: 'michal@x.test', password: PW });
    assert.equal(other.headers.get('location'), '/');
  });
});
