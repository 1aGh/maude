// GET /api/home — Maude v2 S6.14 (V2-1.1 §5.7, S6-S9 §5.4, V2-1.16 L14).
//
// Home's cloud source: the caller's projects, and `shared[]` holding ONLY the
// caller's own memberships and canvas grants. A grant to anybody else never
// shows, a canvas-only grant shows that canvas and nothing more of its
// project, a link grant goes with its link, a revoked grant is gone on the
// next call, and nobody's e-mail but the caller's is in the answer.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';

import { createSession } from './accounts.mjs';
import { d1FromSqlite } from './db.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const NOW = Date.now();
const DAY = 86_400_000;

let fx;

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  const env = { DB, CELL_ZONE: 'cloud.test' };
  return { sqlite, env };
}

async function seed() {
  const { sqlite, env } = fixture();
  await applySchema(env.DB, SCHEMA_SQL);
  const acct = sqlite.prepare(
    'INSERT INTO accounts (id, email, name, created_at) VALUES (?, ?, ?, 1)'
  );
  acct.run('acct_me', 'me@example.com', 'Me');
  acct.run('acct_tereza', 'tereza@example.com', 'Tereza');
  acct.run('acct_bob', 'bob@example.com', 'Bob');
  acct.run('acct_eve', 'eve@example.com', null);

  const proj = sqlite.prepare(
    'INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES (?, ?, ?, ?, 10, 1)'
  );
  proj.run('alligators', 'acct_me', 'Alligators brand', 'active'); // mine
  proj.run('nabor-2027', 'acct_tereza', 'Nábor 2027', 'active'); // I am a member
  proj.run('gamma', 'acct_tereza', 'Gamma', 'active'); // one canvas granted to me
  proj.run('secret-proj', 'acct_eve', 'Secret project', 'active'); // nothing of mine
  proj.run('delta', 'acct_tereza', 'Delta', 'active'); // a link grant
  proj.run('paused', 'acct_tereza', 'Paused', 'suspended');
  proj.run('gone', 'acct_tereza', 'Gone', 'purged');

  const mem = sqlite.prepare(
    'INSERT INTO project_members (project_id, account_id, role, added_at, source) VALUES (?, ?, ?, ?, ?)'
  );
  mem.run('nabor-2027', 'acct_me', 'viewer', 100, 'invite');
  mem.run('nabor-2027', 'acct_bob', 'member', 101, 'invite');
  mem.run('secret-proj', 'acct_bob', 'member', 102, 'invite');
  mem.run('gamma', 'acct_bob', 'member', 103, 'invite');

  const grant = sqlite.prepare(
    `INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_by, granted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  grant.run('gamma', 'acct_me', 'ui/web/Mapa-arealu.tsx', 'viewer', 'invite', 'acct_tereza', 200);
  grant.run('gamma', 'acct_bob', 'ui/web/Bobs-board.tsx', 'member', 'invite', 'acct_tereza', 201);
  grant.run('nabor-2027', 'acct_me', 'ui/raised.tsx', 'member', 'invite', 'acct_tereza', 300);

  sqlite
    .prepare(
      `INSERT INTO share_links (id, project_id, canvas_path, role, who, secret_hash, created_by, created_at, expires_at)
       VALUES ('lnk_00000000000000aa', 'delta', 'ui/linked.tsx', 'observer', 'anyone', 'h', 'acct_tereza', 1, NULL)`
    )
    .run();
  grant.run(
    'delta',
    'acct_me',
    'ui/linked.tsx',
    'observer',
    'link:lnk_00000000000000aa',
    'acct_tereza',
    400
  );

  const tokenOf = {};
  for (const id of ['acct_me', 'acct_bob']) {
    const token = `mpt_${id.padEnd(48, '0').slice(0, 48)}`;
    sqlite
      .prepare(
        'INSERT INTO personal_tokens (id, account_id, label, created_at) VALUES (?, ?, ?, 1)'
      )
      .run(createHash('sha256').update(token).digest('hex'), id, 'test');
    tokenOf[id] = token;
  }
  return { sqlite, env, tokenOf };
}

const home = (env, headers = {}) =>
  worker.fetch(new Request('https://cloud.test/api/home', { headers }), env);

const asMe = () => home(fx.env, { authorization: `Bearer ${fx.tokenOf.acct_me}` });

async function body(res) {
  assert.equal(res.status, 200);
  return res.json();
}

describe('GET /api/home', () => {
  beforeEach(async () => {
    fx = await seed();
  });

  it('refuses without a credential with the signed-out reason, never cached', async () => {
    for (const headers of [{}, { authorization: 'Bearer mpt_nope' }]) {
      const res = await home(fx.env, headers);
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const json = await res.json();
      assert.equal(json.reason, 'signed-out');
      assert.equal(json.projects, undefined);
    }
  });

  it('a revoked device token is signed out on the next call', async () => {
    assert.equal((await asMe()).status, 200);
    fx.sqlite
      .prepare("UPDATE personal_tokens SET revoked_at = 5 WHERE account_id = 'acct_me'")
      .run();
    const res = await asMe();
    assert.equal(res.status, 401);
    assert.equal((await res.json()).reason, 'signed-out');
  });

  it('answers the V2-1.1 §5.7 shape, no-store', async () => {
    const res = await asMe();
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-type'), /application\/json/);
    const json = await body(res);
    // S9.20b — the plan words ride along (no trial started yet in this seed).
    assert.deepEqual(json.account, {
      email: 'me@example.com',
      plan: { state: 'none', daysLeft: 14, name: 'Free trial' },
    });
    assert.deepEqual(
      json.projects.map((p) => [p.id, p.role, p.ownerName]),
      [
        ['alligators', 'owner', null],
        ['nabor-2027', 'viewer', 'Tereza'],
      ]
    );
    const alligators = json.projects[0];
    assert.equal(alligators.name, 'Alligators brand');
    assert.equal(alligators.state, 'active');
    assert.equal(alligators.url, 'https://alligators.cloud.test');
    assert.equal(typeof alligators.updatedAt, 'number');
    // No v2 role advertisement on the wire until the Q13 flip.
    assert.equal('roles' in json, false);
  });

  it('shared[] lists only my memberships and my grants, effective role = max', async () => {
    const { shared } = await body(await asMe());
    const rows = shared.map((s) => [s.projectId, s.canvas?.path ?? null, s.role]);
    assert.deepEqual(rows.sort(), [
      ['delta', 'ui/linked.tsx', 'observer'],
      ['gamma', 'ui/web/Mapa-arealu.tsx', 'viewer'],
      ['nabor-2027', null, 'viewer'],
      ['nabor-2027', 'ui/raised.tsx', 'member'],
    ]);
    const gamma = shared.find((s) => s.projectId === 'gamma');
    assert.deepEqual(gamma, {
      projectId: 'gamma',
      projectName: 'Gamma',
      ownerName: 'Tereza',
      canvas: { path: 'ui/web/Mapa-arealu.tsx', name: 'Mapa-arealu' },
      role: 'viewer',
      grantedAt: 200,
      grantedBy: 'Tereza',
    });
    const member = shared.find((s) => s.projectId === 'nabor-2027' && s.canvas === null);
    assert.equal(member.grantedAt, 100);
    // Newest first.
    assert.deepEqual(
      shared.map((s) => s.grantedAt),
      [400, 300, 200, 100]
    );
  });

  it('per role: each membership role reaches shared[] as itself; a weaker grant never lowers', async () => {
    for (const role of ['observer', 'viewer', 'member']) {
      fx.sqlite
        .prepare(
          "UPDATE project_members SET role = ? WHERE project_id = 'nabor-2027' AND account_id = 'acct_me'"
        )
        .run(role);
      fx.sqlite
        .prepare("UPDATE canvas_grants SET role = 'observer' WHERE canvas_path = 'ui/raised.tsx'")
        .run();
      const { projects, shared } = await body(await asMe());
      assert.equal(projects.find((p) => p.id === 'nabor-2027').role, role);
      const rows = shared.filter((s) => s.projectId === 'nabor-2027');
      assert.deepEqual(
        rows.map((s) => s.role),
        [role, role],
        `grant under ${role}`
      );
    }
  });

  it('a canvas-only grant leaks nothing else of its project', async () => {
    const res = await asMe();
    const text = await res.clone().text();
    const { projects } = await res.json();
    assert.equal(
      projects.some((p) => p.id === 'gamma'),
      false
    );
    assert.equal(text.includes('Bobs-board'), false);
    assert.equal(text.includes('Bob'), false);
    assert.equal(text.includes('Secret project'), false);
    assert.equal(text.includes('secret-proj'), false);
  });

  it('carries no e-mail address but the caller’s own', async () => {
    const text = await (await asMe()).text();
    const emails = text.match(/[^"\s]+@[^"\s]+/g) ?? [];
    assert.deepEqual([...new Set(emails)], ['me@example.com']);
  });

  it('a grant planted for somebody else changes nothing in my answer (byte-identical)', async () => {
    const before = await (await asMe()).text();
    const plant = fx.sqlite.prepare(
      `INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_by, granted_at)
       VALUES (?, 'acct_bob', ?, 'member', 'invite', 'acct_tereza', 999)`
    );
    plant.run('alligators', 'ui/planted.tsx'); // even in a project I own
    plant.run('secret-proj', 'ui/planted.tsx');
    plant.run('delta', 'ui/planted.tsx');
    fx.sqlite
      .prepare(
        "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('delta', 'acct_bob', 'member', 999)"
      )
      .run();
    assert.equal(await (await asMe()).text(), before);
    // …and Bob sees his own, not mine.
    const bob = await body(await home(fx.env, { authorization: `Bearer ${fx.tokenOf.acct_bob}` }));
    assert.equal(
      bob.shared.some((s) => s.canvas?.path === 'ui/web/Mapa-arealu.tsx'),
      false
    );
    assert.equal(bob.account.email, 'bob@example.com');
  });

  it('a grant to a project that is gone or paused reads the same as no grant', async () => {
    const before = await (await asMe()).text();
    const g = fx.sqlite.prepare(
      `INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at)
       VALUES (?, 'acct_me', 'ui/x.tsx', 'member', 'invite', 999)`
    );
    g.run('gone');
    g.run('paused');
    fx.sqlite
      .prepare(
        "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('paused', 'acct_me', 'member', 999)"
      )
      .run();
    assert.equal(await (await asMe()).text(), before);
  });

  it('a revoked grant or membership is gone on the next call', async () => {
    fx.sqlite
      .prepare("DELETE FROM canvas_grants WHERE project_id = 'gamma' AND account_id = 'acct_me'")
      .run();
    fx.sqlite
      .prepare(
        "DELETE FROM project_members WHERE project_id = 'nabor-2027' AND account_id = 'acct_me'"
      )
      .run();
    const json = await body(await asMe());
    const text = JSON.stringify(json);
    assert.equal(text.includes('gamma'), false);
    assert.equal(
      json.projects.some((p) => p.id === 'nabor-2027'),
      false
    );
    // The canvas grant in nabor-2027 outlives the membership: canvas-only now.
    assert.deepEqual(
      json.shared.filter((s) => s.projectId === 'nabor-2027').map((s) => [s.canvas?.path, s.role]),
      [['ui/raised.tsx', 'member']]
    );
  });

  it('drops a link grant as soon as its link is off or expired, before any sweep', async () => {
    const linked = async () =>
      (await body(await asMe())).shared.some((s) => s.projectId === 'delta');
    assert.equal(await linked(), true);
    const link = fx.sqlite.prepare(
      "UPDATE share_links SET expires_at = ?, revoked_at = ? WHERE id = 'lnk_00000000000000aa'"
    );
    link.run(NOW - DAY, null);
    assert.equal(await linked(), false, 'expired');
    link.run(NOW + DAY, null);
    assert.equal(await linked(), true, 'extended');
    link.run(null, NOW - 1);
    assert.equal(await linked(), false, 'off');
    // A link that turned into a team link grants nothing either.
    fx.sqlite
      .prepare(
        "UPDATE share_links SET revoked_at = NULL, who = 'team' WHERE id = 'lnk_00000000000000aa'"
      )
      .run();
    assert.equal(await linked(), false, 'team');
    // A grant naming a link that does not exist is dropped too.
    fx.sqlite.prepare("DELETE FROM share_links WHERE id = 'lnk_00000000000000aa'").run();
    assert.equal(await linked(), false, 'missing link');
  });

  it('a link-sourced membership goes with its link', async () => {
    fx.sqlite
      .prepare(
        `INSERT INTO share_links (id, project_id, canvas_path, role, who, secret_hash, created_by, created_at)
         VALUES ('lnk_00000000000000bb', 'secret-proj', NULL, 'viewer', 'anyone', 'h', 'acct_eve', 1)`
      )
      .run();
    fx.sqlite
      .prepare(
        "INSERT INTO project_members (project_id, account_id, role, added_at, source) VALUES ('secret-proj', 'acct_me', 'viewer', 500, 'link:lnk_00000000000000bb')"
      )
      .run();
    let json = await body(await asMe());
    assert.equal(
      json.shared.some((s) => s.projectId === 'secret-proj' && s.canvas === null),
      true
    );
    fx.sqlite
      .prepare("UPDATE share_links SET revoked_at = 1 WHERE id = 'lnk_00000000000000bb'")
      .run();
    json = await body(await asMe());
    assert.equal(JSON.stringify(json).includes('secret-proj'), false);
  });

  it('the signed-in browser session answers the same as the device token', async () => {
    // A sign-in starts the trial (S9.15), so the session exists before either answer is read.
    const { token } = await createSession(fx.env.DB, 'acct_me');
    const viaToken = await (await asMe()).text();
    const viaCookie = await (await home(fx.env, { cookie: `maude_session=${token}` })).text();
    assert.equal(viaCookie, viaToken);
    // A device token that is present but dead is signed out — it does not fall
    // through to a browser cookie riding the same request.
    const both = await home(fx.env, {
      authorization: 'Bearer mpt_revoked',
      cookie: `maude_session=${token}`,
    });
    assert.equal(both.status, 401);
  });

  it('the v1 fallback GET /api/projects still answers', async () => {
    const res = await worker.fetch(
      new Request('https://cloud.test/api/projects', {
        headers: { authorization: `Bearer ${fx.tokenOf.acct_me}` },
      }),
      fx.env
    );
    assert.equal(res.status, 200);
    const { projects } = await res.json();
    assert.deepEqual(projects.map((p) => p.id).sort(), ['alligators', 'nabor-2027']);
  });
});

// S9.20b (decision v2-lead-plan-words-via-home-route): the desktop's Settings › Account says
// "Free trial · N days left" from `account.plan` — S9.15's trial view, cut down to the state, the
// days left and the plan name. Nothing about billing travels: no dates, no Stripe ids, no prices.
describe('GET /api/home account.plan', () => {
  beforeEach(async () => {
    fx = await seed();
  });

  const setTrial = (at) =>
    fx.sqlite.prepare("UPDATE accounts SET trial_started_at = ? WHERE id = 'acct_me'").run(at);

  it('a running trial: the state, the days left, the plan name — and nothing else', async () => {
    setTrial(NOW - 2 * DAY);
    const { account } = await body(await asMe());
    assert.deepEqual(account.plan, { state: 'trialing', daysLeft: 12, name: 'Free trial' });
    assert.deepEqual(Object.keys(account.plan).sort(), ['daysLeft', 'name', 'state']);
  });

  it('an ended trial says ended with no days left', async () => {
    setTrial(NOW - 20 * DAY);
    const { account } = await body(await asMe());
    assert.deepEqual(account.plan, { state: 'ended', daysLeft: 0, name: 'Free trial' });
  });

  it('carries no billing detail and is the same through the browser session', async () => {
    setTrial(NOW - DAY);
    fx.sqlite
      .prepare("UPDATE accounts SET stripe_customer_id = 'cus_secret' WHERE id = 'acct_me'")
      .run();
    fx.sqlite
      .prepare("UPDATE projects SET subscription_id = 'sub_secret' WHERE id = 'alligators'")
      .run();
    const { token } = await createSession(fx.env.DB, 'acct_me');
    const text = await (await asMe()).text();
    for (const leak of ['sub_secret', 'cus_secret', 'stripe', 'startedAt', 'endsAt', 'trial_'])
      assert.equal(text.includes(leak), false, leak);
    assert.equal(JSON.parse(text).account.plan.state, 'trialing');
    const viaCookie = await (await home(fx.env, { cookie: `maude_session=${token}` })).json();
    assert.deepEqual(viaCookie.account.plan, JSON.parse(text).account.plan);
  });
});
