// The control plane's access authority — V2-1.7 §5.6 (S9.8).
//
// A cloud cell forwards `/api/access/*` to `/internal/projects/:p/access/*`
// with its derived secret and the vouched actor's e-mail. These tests drive
// the real Worker over a real (node:sqlite) D1 and assert, per role — owner ·
// member · viewer · observer · canvas-only — that the actor's role is
// re-decided from D1 (a forged one is ignored), every change is audited,
// invitations are capped, and narrowing reaches live sessions.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { decideClaim, INVITE_CAP_PER_DAY } from './access-forward.mjs';
import { deriveCellSecret } from './cell-token.mjs';
import { d1FromSqlite } from './db.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const MASTER = 'master';
const P = 'alligators';
const A = 'ui/a.tsx';
const B = 'ui/b.tsx';

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  const acct = sqlite.prepare(
    'INSERT INTO accounts (id, email, name, created_at) VALUES (?, ?, ?, 1)'
  );
  const people = {
    owner: 'a1',
    member: 'a2',
    viewer: 'a3',
    observer: 'a4',
    canvas: 'a5',
    stranger: 'a6',
  };
  for (const [who, id] of Object.entries(people)) acct.run(id, `${who}@example.com`, who);
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES (?, 'a1', 'Alligators', 'active', 1, 1)`
    )
    .run(P);
  const mem = sqlite.prepare(
    'INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, 1)'
  );
  mem.run(P, 'a2', 'member');
  mem.run(P, 'a3', 'viewer');
  mem.run(P, 'a4', 'observer');
  sqlite
    .prepare(
      `INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at)
       VALUES (?, 'a5', ?, 'member', 'invite', 1)`
    )
    .run(P, A);
  return { env: { DB, CELL_SECRET_MASTER: MASTER, CELL_ZONE: 'cloud.test' }, sqlite, people };
}

/** The cell's outbound world: /health answers and the access-changed notices it receives. */
function stubCell({ rolesV2 = true } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({
      url: u,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (u.endsWith('/health')) {
      return Response.json({ capabilities: rolesV2 ? ['roles-v2'] : ['studio'] });
    }
    return new Response(null, { status: 204 });
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

async function forward(
  env,
  path,
  { method = 'GET', actor, body, secretFor = P, headers = {} } = {}
) {
  const secret = await deriveCellSecret(MASTER, secretFor);
  return worker.fetch(
    new Request(`https://cloud.test/internal/projects/${P}/access/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        ...(actor ? { 'x-maude-actor': `${actor}@example.com` } : {}),
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env
  );
}

const ROLE_CASES = ['owner', 'member', 'viewer', 'observer', 'canvas'];
let cell;
beforeEach(() => {
  cell = stubCell();
});
afterEach(() => cell.restore());

describe('the forwarder answers only the project’s own cell', () => {
  it('no secret, a wrong one, or another project’s → 401', async () => {
    const { env } = await fixture();
    assert.equal((await forward(env, 'me', { actor: 'owner', secretFor: 'other' })).status, 401);
    const bare = await worker.fetch(
      new Request(`https://cloud.test/internal/projects/${P}/access/me`, {
        headers: { 'x-maude-actor': 'owner@example.com' },
      }),
      env
    );
    assert.equal(bare.status, 401);
    assert.equal((await forward(env, 'me', { actor: 'owner' })).status, 200);
  });
});

describe('GET me — caps re-decided from D1, per role', () => {
  it('owner · member · viewer · observer · canvas-only · stranger', async () => {
    const { env } = await fixture();
    const me = async (who) => (await forward(env, 'me', { actor: who })).json();
    const o = await me('owner');
    assert.equal(o.role, 'owner');
    assert.equal(o.caps.invite, true);
    const m = await me('member');
    assert.deepEqual([m.role, m.caps.edit, m.caps.invite], ['member', true, false]);
    const v = await me('viewer');
    assert.deepEqual(
      [v.role, v.caps.comment, v.caps.export, v.caps.edit],
      ['viewer', true, true, false]
    );
    const ob = await me('observer');
    assert.equal(ob.role, 'observer');
    assert.deepEqual(
      Object.entries(ob.caps)
        .filter(([, y]) => y)
        .map(([c]) => c)
        .sort(),
      ['read', 'request', 'session']
    );
    const c = await me('canvas');
    assert.equal(c.role, null);
    assert.deepEqual(c.grants, [{ c: A, r: 'member' }]);
    assert.equal(c.caps.edit, false, 'no project-level edit');
    assert.equal(c.canvasCaps[A].edit, true);
    assert.equal(c.canvasCaps[A].invite, false, 'PROJECT_ONLY never via a grant');
    const s = await me('stranger');
    assert.equal(s.role, null);
    assert.ok(Object.values(s.caps).every((x) => x === false));
  });

  it('a forged role in the body or a header changes nothing', async () => {
    const { env } = await fixture();
    const res = await forward(env, 'invites', {
      method: 'POST',
      actor: 'member',
      body: { email: 'x@example.com', role: 'member', actorRole: 'owner', role_of_actor: 'owner' },
      headers: { 'x-maude-role': 'owner', 'x-maude-access': 'eyJyb2xlIjoib3duZXIifQ' },
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'not-allowed');
  });
});

describe('POST invites', () => {
  it('owner only — every other role is refused', async () => {
    const { env, sqlite } = await fixture();
    for (const who of ROLE_CASES.filter((r) => r !== 'owner')) {
      const res = await forward(env, 'invites', {
        method: 'POST',
        actor: who,
        body: { email: `n-${who}@example.com`, role: 'viewer' },
      });
      assert.equal(res.status, 403, who);
    }
    const ok = await forward(env, 'invites', {
      method: 'POST',
      actor: 'owner',
      body: { email: 'New@Example.com', role: 'observer', canvas: A },
    });
    assert.equal(ok.status, 201);
    const { id, url } = await ok.json();
    const row = sqlite.prepare('SELECT * FROM project_invites WHERE id = ?').get(id);
    assert.deepEqual([row.email, row.role, row.canvas_path], ['new@example.com', 'observer', A]);
    assert.match(url, new RegExp(`/invite/${id}$`), 'no mail transport → the owner gets the link');
    const audit = sqlite
      .prepare("SELECT actor, detail FROM audit_log WHERE action = 'access.invite'")
      .all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor, 'customer:owner@example.com');
  });

  it('refuses owner, unknown roles and a path that is not a canvas', async () => {
    const { env } = await fixture();
    for (const body of [
      { email: 'a@example.com', role: 'owner' },
      { email: 'a@example.com', role: 'admin' },
      { email: 'a@example.com', role: 'viewer', canvas: '../secrets.tsx' },
      { email: 'a@example.com', role: 'viewer', canvas: '/abs.tsx' },
      { email: 'not-an-address', role: 'viewer' },
    ]) {
      const res = await forward(env, 'invites', { method: 'POST', actor: 'owner', body });
      assert.equal(res.status, 422, JSON.stringify(body));
    }
  });

  it(`caps invitations at ${INVITE_CAP_PER_DAY} per project per day`, async () => {
    const { env } = await fixture();
    for (let i = 0; i < INVITE_CAP_PER_DAY; i++) {
      const res = await forward(env, 'invites', {
        method: 'POST',
        actor: 'owner',
        body: { email: `p${i}@example.com`, role: 'viewer' },
      });
      assert.equal(res.status, 201, `invite ${i}`);
    }
    const over = await forward(env, 'invites', {
      method: 'POST',
      actor: 'owner',
      body: { email: 'one-more@example.com', role: 'viewer' },
    });
    assert.equal(over.status, 429);
    assert.equal((await over.json()).reason, 'invite-cap');
  });

  it('an existing account gets a pending invitation like anyone — never added, never lowered (gate-b-sec3)', async () => {
    const { env, sqlite } = await fixture();
    const res = await forward(env, 'invites', {
      method: 'POST',
      actor: 'owner',
      body: { email: 'member@example.com', role: 'observer' },
    });
    assert.equal(res.status, 201);
    const { id } = await res.json();
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(
      sqlite.prepare("SELECT role FROM project_members WHERE account_id = 'a2'").get().role,
      'member'
    );
    const canvasInvite = await forward(env, 'invites', {
      method: 'POST',
      actor: 'owner',
      body: { email: 'stranger@example.com', role: 'viewer', canvas: B },
    });
    assert.equal(canvasInvite.status, 201);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM canvas_grants WHERE account_id = 'a6'").get().n,
      0,
      'no grant until they accept'
    );
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM project_invites WHERE redeemed_at IS NULL').get().n,
      2
    );
    assert.ok(
      !cell.calls.some((c) => c.url.endsWith('/internal/access-changed')),
      'nothing changed, so the cell hears nothing'
    );
  });
});

describe('PATCH / DELETE people — narrowing reaches live sessions', () => {
  it('a demotion revokes and tells the cell; the owner cannot be changed', async () => {
    const { env, sqlite } = await fixture();
    const res = await forward(env, 'people/a2', {
      method: 'PATCH',
      actor: 'owner',
      body: { role: 'observer' },
    });
    assert.equal(res.status, 200);
    assert.equal(
      sqlite.prepare("SELECT role FROM project_members WHERE account_id = 'a2'").get().role,
      'observer'
    );
    assert.equal(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM member_revocations WHERE email = 'member@example.com'")
        .get().n,
      1
    );
    const notice = cell.calls.find((c) => c.url.endsWith('/internal/access-changed'));
    // P8 G1a: a narrowing says who did it and what it is now; V2-8.9 round B L2: the role is named
    // because Can view on the project, with no grant, IS the whole claim after the change
    assert.deepEqual(notice.body, {
      email: 'member@example.com',
      change: 'narrowed',
      reason: 'removed',
      by: 'owner',
      role: 'observer',
    });
    const owner = await forward(env, 'people/a1', {
      method: 'PATCH',
      actor: 'owner',
      body: { role: 'viewer' },
    });
    assert.equal(owner.status, 422);
    assert.equal((await owner.json()).reason, 'owner-immutable');
  });

  it('a member cannot change anyone (re-decided from D1)', async () => {
    const { env } = await fixture();
    const res = await forward(env, 'people/a3', {
      method: 'PATCH',
      actor: 'member',
      body: { role: 'member' },
    });
    assert.equal(res.status, 403);
  });

  it('removing a canvas grant ends a canvas-only person; removing a member revokes', async () => {
    const { env, sqlite } = await fixture();
    const del = await forward(env, `people/a5?canvas=${encodeURIComponent(A)}`, {
      method: 'DELETE',
      actor: 'owner',
    });
    assert.equal(del.status, 204);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM canvas_grants WHERE account_id = 'a5'").get().n,
      0
    );
    const ended = cell.calls.find((c) => c.body?.email === 'canvas@example.com');
    assert.equal(ended.body.change, 'ended');
    assert.equal(
      (await forward(env, 'people/a3', { method: 'DELETE', actor: 'owner' })).status,
      204
    );
    assert.equal(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM member_revocations WHERE email = 'viewer@example.com'")
        .get().n,
      1
    );
  });

  it('a raise is not a revocation', async () => {
    const { env, sqlite } = await fixture();
    await forward(env, 'people/a3', { method: 'PATCH', actor: 'owner', body: { role: 'member' } });
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM member_revocations').get().n, 0);
  });
});

describe('POST links', () => {
  it('Can view or Can comment only; owner only', async () => {
    const { env } = await fixture();
    for (const role of ['member', 'owner']) {
      const res = await forward(env, 'links', {
        method: 'POST',
        actor: 'owner',
        body: { role, who: 'anyone', canvas: A },
      });
      assert.equal(res.status, 422);
      assert.equal((await res.json()).reason, 'link-role');
    }
    const member = await forward(env, 'links', {
      method: 'POST',
      actor: 'member',
      body: { role: 'observer', who: 'anyone' },
    });
    assert.equal(member.status, 403);
    const ok = await forward(env, 'links', {
      method: 'POST',
      actor: 'owner',
      body: { role: 'observer', who: 'anyone', canvas: A },
    });
    assert.equal(ok.status, 201);
    assert.match(
      (await ok.json()).url,
      /^https:\/\/cloud\.test\/l\/lnk_[0-9a-f]{16}\.[0-9a-f]{64}$/
    );
  });
});

describe('access requests', () => {
  it('viewer and observer may ask; one open per scope; editors are told they can already', async () => {
    const { env, sqlite } = await fixture();
    for (const who of ['viewer', 'observer']) {
      const r = await forward(env, 'requests', { method: 'POST', actor: who, body: {} });
      assert.equal(r.status, 201, who);
      // the cell's owner toast names the person as the owner's list does (their account name), not an e-mail part
      assert.deepEqual((await r.json()).from, { name: who }, who);
      const again = await forward(env, 'requests', { method: 'POST', actor: who, body: {} });
      assert.equal(again.status, 409);
      assert.equal((await again.json()).reason, 'pending');
    }
    const m = await forward(env, 'requests', { method: 'POST', actor: 'member', body: {} });
    assert.equal(m.status, 409);
    assert.equal((await m.json()).reason, 'already-can-edit');
    const c = await forward(env, 'requests', {
      method: 'POST',
      actor: 'canvas',
      body: { canvas: A },
    });
    assert.equal((await c.json()).reason, 'already-can-edit');
    const cb = await forward(env, 'requests', {
      method: 'POST',
      actor: 'canvas',
      body: { canvas: B },
    });
    assert.equal(cb.status, 403, 'a canvas-only person cannot ask about a canvas they cannot see');
    const s = await forward(env, 'requests', { method: 'POST', actor: 'stranger', body: {} });
    assert.equal(s.status, 403);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM access_requests').get().n, 2);
  });

  it('approve writes a member grant at the request’s scope; only the owner lists or decides', async () => {
    const { env, sqlite } = await fixture();
    const { id } = await (
      await forward(env, 'requests', { method: 'POST', actor: 'observer', body: { canvas: A } })
    ).json();
    assert.equal((await forward(env, 'requests', { actor: 'member' })).status, 403);
    const list = await (await forward(env, 'requests', { actor: 'owner' })).json();
    assert.deepEqual(
      list.requests.map((r) => [r.id, r.canvas, r.from.email]),
      [[id, A, 'observer@example.com']]
    );
    assert.equal(
      (await forward(env, `requests/${id}/approve`, { method: 'POST', actor: 'member' })).status,
      403
    );
    assert.equal(
      (await forward(env, `requests/${id}/approve`, { method: 'POST', actor: 'owner' })).status,
      200
    );
    assert.deepEqual(
      { ...sqlite.prepare("SELECT role, source FROM canvas_grants WHERE account_id = 'a4'").get() },
      { role: 'member', source: `request:${id}` }
    );
    const me = await (await forward(env, 'me', { actor: 'observer' })).json();
    assert.equal(me.canvasCaps[A].edit, true);
    assert.equal(me.caps.edit, false, 'the project role is untouched');
    assert.equal(
      (await forward(env, `requests/${id}/approve`, { method: 'POST', actor: 'owner' })).status,
      404
    );
  });
});

describe('access requests cannot be spammed (S9.21)', () => {
  it('three asks per person per project per day, whatever the scope or the answer; then 429', async () => {
    const { env, sqlite } = await fixture();
    const ask = (body) => forward(env, 'requests', { method: 'POST', actor: 'observer', body });
    const decline = async (r) =>
      forward(env, `requests/${(await r.json()).id}/decline`, { method: 'POST', actor: 'owner' });
    // ask → Not now → ask again → Not now → ask about a canvas: three asks
    await decline(await ask({}));
    await decline(await ask({}));
    assert.equal((await ask({ canvas: A })).status, 201);
    const fourth = await ask({ canvas: B });
    assert.equal(fourth.status, 429);
    assert.equal((await fourth.json()).reason, 'rate-limited');
    // the viewer's own allowance is untouched by the observer's
    assert.equal(
      (await forward(env, 'requests', { method: 'POST', actor: 'viewer', body: {} })).status,
      201
    );
    // a day later the observer may ask again
    sqlite
      .prepare("UPDATE access_requests SET created_at = created_at - ? WHERE account_id = 'a4'")
      .run(25 * 60 * 60 * 1000);
    assert.equal((await ask({ canvas: B })).status, 201);
  });
});

describe('GET people — e-mails, invitations and requests are the owner’s (L17)', () => {
  it('a non-owner sees names and roles only', async () => {
    const { env } = await fixture();
    await forward(env, 'invites', {
      method: 'POST',
      actor: 'owner',
      body: { email: 'q@example.com', role: 'viewer' },
    });
    const asMember = await (await forward(env, 'people', { actor: 'member' })).json();
    assert.ok(asMember.people.every((p) => !('email' in p) && !p.state));
    const asOwner = await (await forward(env, 'people', { actor: 'owner' })).json();
    assert.ok(asOwner.people.some((p) => p.state === 'invited' && p.email === 'q@example.com'));
    const onA = await (
      await forward(env, `people?canvas=${encodeURIComponent(A)}`, { actor: 'canvas' })
    ).json();
    assert.ok(onA.people.some((p) => p.id === 'a5' && p.role === 'member'));
    const onB = await forward(env, `people?canvas=${encodeURIComponent(B)}`, { actor: 'canvas' });
    assert.equal(onB.status, 403, 'B is not in a canvas-only person’s scope');
  });
});

describe('decideClaim (pure) — G1: a grant adds, never lowers', () => {
  const project = { id: P, account_id: 'a1', state: 'active' };
  it('grants at or below the project role are not carried (v1 token stays v1)', () => {
    const v = decideClaim({
      accountId: 'a2',
      project,
      members: [{ account_id: 'a2', role: 'member' }],
      grants: [{ account_id: 'a2', canvas_path: A, role: 'viewer' }],
    });
    assert.deepEqual(v, { ok: true, role: 'member', grants: [] });
  });
  it('a paused project admits no canvas-only person', () => {
    const v = decideClaim({
      accountId: 'a5',
      project: { ...project, state: 'suspended' },
      grants: [{ account_id: 'a5', canvas_path: A, role: 'member' }],
    });
    assert.equal(v.ok, false);
  });
});

// V2-8.9 round B L2 — the narrowing notice names a `role` only when it is the person's WHOLE claim after the
// change: the cell spares tokens that grant exactly that role and nothing more (hub keepsOnly), so a
// canvas-scoped role (the max of project role and grant) must never spare a project-wide token.
describe('a narrowing names the role only when it is the whole claim after it (L2)', () => {
  it('a canvas-only Can edit on A narrowed to Can comment on A → no role (no project-wide token is spared)', async () => {
    const { env } = await fixture();
    const up = await forward(env, `people/a5?canvas=${encodeURIComponent(A)}`, {
      method: 'PATCH',
      actor: 'owner',
      body: { role: 'member' },
    });
    assert.equal(up.status, 200);
    cell.calls.length = 0;
    const res = await forward(env, `people/a5?canvas=${encodeURIComponent(A)}`, {
      method: 'PATCH',
      actor: 'owner',
      body: { role: 'viewer' },
    });
    assert.equal(res.status, 200);
    const notice = cell.calls.find((c) => c.url.endsWith('/internal/access-changed'));
    assert.equal(notice.body.change, 'narrowed');
    // before the fix this said 'viewer' (roleFor(A)), and the hub kept a project-wide Can comment token
    assert.equal(notice.body.role, undefined, 'a canvas-scoped role spares no project-wide token');
  });

  it('a project-wide demotion with no grants still names the role it leaves', async () => {
    const { env } = await fixture();
    await forward(env, 'people/a2', { method: 'PATCH', actor: 'owner', body: { role: 'viewer' } });
    const notice = cell.calls.find((c) => c.url.endsWith('/internal/access-changed'));
    assert.equal(notice.body.role, 'viewer');
  });
});
