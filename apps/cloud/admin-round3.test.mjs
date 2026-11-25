// The designed pieces that were left out of the first administration round
// (canvas 16: cl-op-account row menu, cl-people tabs / bulk bar / make owner,
// cl-operator tabs). The live worker, real sessions, real SQLite, a faked network.
//
//   1. operator › People in this project
//   2. operator › Delete (the export-then-retention ladder, with an undo)
//   3. operator › See it as the owner does (read only, no session, no token)
//   4. owner › /account/people tabs, find, bulk verbs, make owner (two steps)
//   5. operator › overview tabs

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  addMember,
  assertNoStripe,
  auditRows,
  bind,
  DAY,
  freshEnv,
  get,
  installNetwork,
  makeOperator,
  ORIGIN,
  post,
  project,
  seedProject,
  signUp,
  text,
} from './admin-test-kit.mjs';
import { planState } from './project-access.mjs';
import { SUSPEND_RETENTION_DAYS, settle } from './reconcile.mjs';
import worker, { reconcileSweep } from './worker.mjs';

async function world(t) {
  const net = installNetwork(t);
  const { env, sqlite } = await freshEnv();
  const op = await makeOperator(env, sqlite);
  const jan = await signUp(env, sqlite, 'jan@kolar.studio');
  const anna = await signUp(env, sqlite, 'anna@example.com');
  const eva = await signUp(env, sqlite, 'eva@other.cz');
  bind(env, op, jan, anna, eva);
  sqlite.prepare("UPDATE accounts SET name = 'Anna Králová' WHERE id = ?").run(anna.id);
  seedProject(sqlite, {
    id: 'kolar-web',
    owner: jan.id,
    name: 'Kolář web',
    trialEndsAt: Date.now() + 9 * DAY,
  });
  seedProject(sqlite, {
    id: 'plakaty',
    owner: jan.id,
    name: 'Plakáty',
    trialEndsAt: Date.now() + 9 * DAY,
  });
  seedProject(sqlite, {
    id: 'evas',
    owner: eva.id,
    name: 'Eva’s project',
    trialEndsAt: Date.now() + 9 * DAY,
  });
  addMember(sqlite, 'kolar-web', anna.id, 'viewer');
  net.mails.length = 0;
  t.after(() => assertNoStripe(net));
  return { net, env, sqlite, op, jan, anna, eva };
}

const roleOf = (sqlite, projectId, accountId) =>
  sqlite
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND account_id = ?')
    .get(projectId, accountId)?.role ?? null;
const invite = (sqlite, id, projectId, email) =>
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at)
       VALUES (?, ?, ?, 'member', ?, ?)`
    )
    .run(id, projectId, email, Date.now(), Date.now() + 5 * DAY);
const bulk = (fields, people) => {
  const body = new URLSearchParams(fields);
  for (const p of people) body.append('people', p);
  return body;
};

// --------------------------------------------- 1. operator › people in a project

describe('1 · operator: People in this project', () => {
  test('the page lists members, roles, open invitations and requests', async (t) => {
    const { sqlite, op, anna } = await world(t);
    invite(sqlite, 'inv-a', 'kolar-web', 'radek@alligators.cz');
    sqlite
      .prepare(
        'INSERT INTO access_requests (id, project_id, account_id, created_at) VALUES (?, ?, ?, ?)'
      )
      .run('req_1', 'kolar-web', anna.id, Date.now());
    const res = await get('/operator/projects/kolar-web/people', op);
    assert.equal(res.status, 200);
    const page = text(await res.text());
    assert.match(page, /jan@kolar\.studio[\s\S]*Owner/);
    assert.match(page, /Anna Králová[\s\S]*Can comment/);
    assert.match(page, /radek@alligators\.cz/);
    assert.match(page, /Asks to edit/);
    assert.equal(auditRows(sqlite, 'operator.project.people.viewed').length, 1);
    // …and the project page links to it.
    assert.ok(
      (await (await get('/operator/projects/kolar-web', op)).text()).includes(
        'href="/operator/projects/kolar-web/people"'
      )
    );
  });

  test('invite, change role, remove, resend, cancel — each done, each logged as the operator with the reason', async (t) => {
    const { net, sqlite, op, anna } = await world(t);
    const act = (fields) =>
      post('/operator/projects/kolar-web/people', op, { reason: 'ticket 4411', ...fields });
    assert.equal((await act({ do: 'invite', email: 'new@studio.cz', role: 'member' })).status, 303);
    const inv = sqlite
      .prepare("SELECT id, role FROM project_invites WHERE email = 'new@studio.cz'")
      .get();
    assert.equal(inv.role, 'member');
    assert.equal(net.mails.length, 1);
    assert.equal((await act({ do: 'invite-resend', invite: inv.id })).status, 303);
    assert.equal(net.mails.length, 2);
    assert.equal((await act({ do: 'invite-cancel', invite: inv.id })).status, 303);
    assert.ok(
      sqlite.prepare('SELECT revoked_at FROM project_invites WHERE id = ?').get(inv.id).revoked_at
    );
    assert.equal((await act({ do: 'role', account: anna.id, role: 'member' })).status, 303);
    assert.equal(roleOf(sqlite, 'kolar-web', anna.id), 'member');
    assert.equal((await act({ do: 'remove', account: anna.id })).status, 303);
    assert.equal(roleOf(sqlite, 'kolar-web', anna.id), null);

    for (const action of [
      'access.invite',
      'access.invite-resend',
      'access.invite-cancel',
      'access.role',
      'access.remove',
    ]) {
      const [row] = auditRows(sqlite, action);
      assert.ok(row, action);
      assert.equal(row.actor, `operator:${op.email}`, action);
      assert.equal(row.reason, 'ticket 4411', action);
      assert.equal(row.project_id, 'kolar-web');
    }
  });

  test('the owner reads it on Activity as done by Maude support, with the reason', async (t) => {
    const { op, jan, anna } = await world(t);
    await post('/operator/projects/kolar-web/people', op, {
      do: 'remove',
      account: anna.id,
      reason: 'asked by the owner on the phone',
    });
    const page = text(await (await get('/projects/kolar-web/audit', jan)).text());
    assert.match(page, /Maude support[\s\S]*asked by the owner on the phone/);
    assert.doesNotMatch(page, new RegExp(op.email));
  });

  test('the same guards as the owner: no token, no reason, the owner is immutable, Can view only where it is held', async (t) => {
    const { sqlite, op, jan, anna } = await world(t);
    const path = '/operator/projects/kolar-web/people';
    assert.equal(
      (await post(path, op, { do: 'remove', account: anna.id, reason: 'x' }, { csrf: null }))
        .status,
      403
    );
    assert.match(
      (await post(path, op, { do: 'remove', account: anna.id, reason: '' })).headers.get(
        'location'
      ),
      /error=no-reason/
    );
    assert.match(
      (await post(path, op, { do: 'remove', account: jan.id, reason: 'x y' })).headers.get(
        'location'
      ),
      /error=people-refused/
    );
    assert.match(
      (
        await post(path, op, { do: 'role', account: anna.id, role: 'observer', reason: 'x y' })
      ).headers.get('location'),
      /error=people-can-view/
    );
    assert.match(
      (
        await post(path, op, { do: 'role', account: anna.id, role: 'owner', reason: 'x y' })
      ).headers.get('location'),
      /error=people-refused/
    );
    assert.equal(roleOf(sqlite, 'kolar-web', anna.id), 'viewer');
    assert.equal(
      (await post(path, jan, { do: 'remove', account: anna.id, reason: 'x' })).status,
      404
    );
    assert.equal((await get(path, jan)).status, 404);
  });
});

// ---------------------------------------------------------- 2. operator › delete

describe('2 · operator: Delete is the export-then-retention ladder, never a purge', () => {
  const del = (op, id, fields = {}) =>
    post(`/operator/projects/${id}/delete`, op, {
      confirm: id,
      reason: 'owner asked us to remove it',
      ...fields,
    });

  test('typed name + reason → paused, the copy is prepared, the owner is mailed the date; NOTHING is deleted', async (t) => {
    const { net, env, sqlite, op, jan } = await world(t);
    env.EXPORTS = {
      list: async () => ({ objects: [{ key: 'tenants/kolar-web/exports/x' }] }),
      delete: async () => assert.fail('nothing may be deleted now'),
    };
    const res = await del(op, 'kolar-web');
    assert.match(res.headers.get('location'), /done=delete-scheduled/);
    const row = project(sqlite, 'kolar-web');
    assert.equal(row.state, 'suspended');
    assert.ok(row.delete_since > 0);
    assert.equal(auditRows(sqlite, 'do.purge-data').length, 0);
    assert.equal(auditRows(sqlite, 'do.send-export').length, 1);
    const [log] = auditRows(sqlite, 'operator.project.delete-scheduled');
    assert.equal(log.reason, 'owner asked us to remove it');
    assert.equal(log.actor, `operator:${op.email}`);
    const mails = net.mails.filter((m) => m.to[0] === jan.email);
    assert.ok(mails.length >= 1);
    assert.match(mails[0].subject, /will be deleted on/);
    assert.match(mails[0].text, /\/projects\/kolar-web\/download/);
    assert.ok(
      !mails.some((m) => /subscription ended/i.test(m.text)),
      'not the "your subscription ended" mail'
    );
    // The owner's own pages say so, with the date and no "Restart" that would charge.
    const billing = text(await (await get('/projects/kolar-web/billing', jan)).text());
    assert.match(billing, /will be deleted on/);
    assert.doesNotMatch(billing, /Restart/);
  });

  test('the ladder: warning two days before, queued at day 30, bytes only after that — and an operator hold does not stall it', async (t) => {
    const { net, env, sqlite, op } = await world(t);
    let deleted = 0;
    env.EXPORTS = {
      list: async () => ({ objects: [{ key: 'tenants/kolar-web/exports/x' }] }),
      delete: async () => {
        deleted += 1;
      },
    };
    await del(op, 'kolar-web');
    const t0 = project(sqlite, 'kolar-web').state_since;
    await reconcileSweep(env, { now: t0 + 27 * DAY });
    assert.equal(auditRows(sqlite, 'do.warn-deletion').length, 0);
    await reconcileSweep(env, { now: t0 + (SUSPEND_RETENTION_DAYS - 1) * DAY });
    assert.equal(auditRows(sqlite, 'do.warn-deletion').length, 1);
    assert.equal(project(sqlite, 'kolar-web').state, 'suspended');
    assert.equal(deleted, 0);
    await reconcileSweep(env, { now: t0 + (SUSPEND_RETENTION_DAYS + 1) * DAY });
    await reconcileSweep(env, { now: t0 + (SUSPEND_RETENTION_DAYS + 1) * DAY + 3_600_000 });
    assert.equal(project(sqlite, 'kolar-web').state, 'purged');
    assert.ok(deleted >= 1);
    void net;
  });

  test('pure: every plan shape walks the same ladder once deletion is scheduled', () => {
    const NOW = Date.UTC(2026, 10, 25);
    const base = {
      id: 'p',
      state: 'active',
      stateSince: NOW - 99 * DAY,
      cellRunning: true,
      exportSent: false,
      adverseSince: null,
      subscriptionId: null,
      holdSince: null,
      deleteSince: NOW,
    };
    for (const shape of [
      { trialEndsAt: NOW + DAY, promo: false },
      { trialEndsAt: null, promo: true },
      { trialEndsAt: null, promo: false },
    ]) {
      const out = settle({ ...base, ...shape }, null, { now: NOW });
      assert.equal(out.tenant.state, 'suspended', JSON.stringify(shape));
      const kinds = out.actions.map((a) => a.kind);
      assert.deepEqual(kinds.slice(0, 3), ['set-state', 'suspend-cell', 'send-export']);
      assert.ok(!kinds.includes('purge-data') && !kinds.includes('warn-deletion'));
    }
  });

  test('Undo, while nothing has been deleted: the project runs again and the clock is gone', async (t) => {
    const { sqlite, op } = await world(t);
    await del(op, 'kolar-web');
    const page = await (await get('/operator/projects/kolar-web', op)).text();
    assert.ok(page.includes('action="/operator/projects/kolar-web/delete/undo"'));
    const res = await post('/operator/projects/kolar-web/delete/undo', op, {
      reason: 'wrong project',
    });
    assert.match(res.headers.get('location'), /done=delete-undone/);
    const row = project(sqlite, 'kolar-web');
    assert.equal(row.delete_since, null);
    assert.equal(row.state, 'active');
    assert.equal(planState(row), 'trial');
    assert.equal(auditRows(sqlite, 'operator.project.delete-undone')[0].reason, 'wrong project');
  });

  test('a row with no plan at all can be deleted and undone too (and a paused pilot wakes)', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'pilot', owner: jan.id });
    await del(op, 'pilot');
    assert.equal(project(sqlite, 'pilot').state, 'suspended');
    await post('/operator/projects/pilot/delete/undo', op, { reason: 'wrong project' });
    assert.equal(project(sqlite, 'pilot').state, 'active');
    await post('/operator/projects/pilot/pause', op, { reason: 'checking' });
    await post('/operator/projects/pilot/wake', op, { reason: 'fine' });
    assert.equal(project(sqlite, 'pilot').state, 'active');
  });

  test('refused: wrong typed name, no reason, a paid plan ("cancel the plan first"), an open checkout, twice', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'paid', owner: jan.id, subscription: 'sub_live' });
    assert.match(
      (await del(op, 'kolar-web', { confirm: 'kolar' })).headers.get('location'),
      /error=delete-confirm/
    );
    assert.match(
      (await del(op, 'kolar-web', { reason: '' })).headers.get('location'),
      /error=no-reason/
    );
    const paid = await del(op, 'paid');
    assert.match(paid.headers.get('location'), /error=delete-paid/);
    assert.match(
      text(await (await get(paid.headers.get('location'), op)).text()),
      /Cancel the plan first/i
    );
    sqlite
      .prepare(
        "INSERT INTO audit_log (id, project_id, at, actor, action) VALUES ('a1', 'plakaty', ?, 'customer:x', 'checkout.started')"
      )
      .run(Date.now());
    assert.match((await del(op, 'plakaty')).headers.get('location'), /error=delete-checkout-open/);
    for (const id of ['kolar-web', 'paid', 'plakaty'])
      assert.equal(project(sqlite, id).delete_since, null, id);
    await del(op, 'kolar-web');
    const since = project(sqlite, 'kolar-web').delete_since;
    await del(op, 'kolar-web');
    assert.equal(project(sqlite, 'kolar-web').delete_since, since);
    assert.equal(auditRows(sqlite, 'operator.project.delete-scheduled').length, 1);
    assert.equal((await del(jan, 'kolar-web')).status, 404);
  });
});

// ------------------------------------------------- 3. operator › see it as owner

describe('3 · operator: See it as the owner does — read only', () => {
  const view = (op, jan, path = '') => get(`/operator/accounts/${jan.id}/view${path}`, op);

  test('the owner’s dashboard, people, billing and project pages render under the prefix, with the banner and no way to act', async (t) => {
    const { sqlite, op, jan } = await world(t);
    invite(sqlite, 'inv-a', 'kolar-web', 'radek@alligators.cz');
    for (const path of [
      '',
      '/account/people',
      '/account/billing',
      '/projects/kolar-web/people',
      '/projects/kolar-web/billing',
      '/projects/kolar-web/audit',
    ]) {
      const res = await view(op, jan, path);
      assert.equal(res.status, 200, path);
      const html = await res.text();
      assert.match(
        text(html),
        /You are looking at this as jan@kolar\.studio sees it — read only/,
        path
      );
      assert.doesNotMatch(html, /<form\b/i, `${path}: no form`);
      assert.doesNotMatch(html, /name="csrf"/, `${path}: no token of anyone`);
      for (const m of html.matchAll(/<(button|select|textarea|input)\b[^>]*>/gi)) {
        assert.match(m[0], /\bdisabled\b/, `${path}: ${m[0]}`);
      }
      // Links stay inside the read-only view (or leave the plane); none leads to the live page.
      for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
        assert.ok(
          m[1].startsWith(`/operator/accounts/${jan.id}/view`) || m[1].startsWith('/operator'),
          `${path}: ${m[1]}`
        );
      }
      assert.equal(res.headers.get('set-cookie'), null);
    }
    const dash = text(await (await view(op, jan)).text());
    assert.match(dash, /Kolář web/);
    assert.match(dash, /Plakáty/);
    assert.doesNotMatch(dash, /Eva’s project/);
  });

  test('no session, no token, no code is made for the customer; nothing reaches the workspace', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const before = [
      'sessions',
      'personal_tokens',
      'handoff_codes',
      'device_codes',
      'email_tokens',
    ].map(count);
    net.cell.length = 0;
    for (const path of [
      '',
      '/account/people',
      '/projects/kolar-web/people',
      '/projects/kolar-web/billing',
    ])
      await view(op, jan, path);
    assert.deepEqual(
      ['sessions', 'personal_tokens', 'handoff_codes', 'device_codes', 'email_tokens'].map(count),
      before
    );
    assert.deepEqual(net.cell, [], 'the workspace is never called');
    // The pages that open the workspace or hand out a credential are not part of the view.
    for (const path of [
      '/projects/kolar-web/connect',
      '/projects/kolar-web/download',
      '/account/macs',
      '/account/delete',
      '/projects/open',
    ]) {
      assert.equal((await view(op, jan, path)).status, 404, path);
    }
  });

  test('every POST under the prefix is 405, with or without a token', async (t) => {
    const { sqlite, op, jan, anna } = await world(t);
    for (const path of [
      '/account/people',
      '/projects/kolar-web/people',
      '/projects/kolar-web/billing/plan',
      '',
    ]) {
      for (const csrf of ['operator', 'account', null]) {
        const res = await post(
          `/operator/accounts/${jan.id}/view${path}`,
          op,
          { do: 'remove', project: 'kolar-web', account: anna.id, reason: 'x y' },
          { csrf }
        );
        assert.equal(res.status, 405, `${path} ${csrf}`);
      }
    }
    assert.equal(roleOf(sqlite, 'kolar-web', anna.id), 'viewer');
  });

  test('one log row per page per ten minutes, and the owner reads it', async (t) => {
    const { sqlite, op, jan } = await world(t);
    for (let i = 0; i < 5; i++) await view(op, jan);
    await view(op, jan, '/account/people');
    await view(op, jan, '/account/people');
    const rows = auditRows(sqlite, 'operator.account.viewed-as');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].account_id, jan.id);
    assert.equal(rows[0].actor, `operator:${op.email}`);
    sqlite
      .prepare(
        "UPDATE audit_log SET at = at - 11 * 60000 WHERE action = 'operator.account.viewed-as'"
      )
      .run();
    await view(op, jan);
    assert.equal(auditRows(sqlite, 'operator.account.viewed-as').length, 3);
    const activity = text(await (await get('/projects/kolar-web/audit', jan)).text());
    assert.match(activity, /Maude support looked at your account/);
  });

  test('another project, a non-operator, a signed-out caller: 404', async (t) => {
    const { env, op, jan } = await world(t);
    assert.equal(
      (await view(op, jan, '/projects/evas/people')).status,
      404,
      'not this account’s project'
    );
    assert.equal((await get(`/operator/accounts/${jan.id}/view`, jan)).status, 404);
    const anon = await worker.fetch(new Request(`${ORIGIN}/operator/accounts/${jan.id}/view`), env);
    assert.equal(anon.status, 404);
  });
});

// ------------------------------------------------------ 4. owner › /account/people

describe('4 · owner: tabs, find, bulk verbs, make owner', () => {
  test('?q= finds by name or address; ?tab=owners shows who owns; the tab counts are on the page', async (t) => {
    const { op, jan } = await world(t);
    void op;
    const all = text(await (await get('/account/people', jan)).text());
    assert.match(all, /Everyone\s+2/);
    assert.match(all, /Owners\s+1/);
    const found = text(await (await get('/account/people?q=kr%C3%A1l', jan)).text());
    assert.match(found, /Anna Králová/);
    assert.doesNotMatch(found.split('Shared with you')[0].split('Projects you own')[1], /You\b/);
    const owners = text(await (await get('/account/people?tab=owners', jan)).text()).split(
      'Projects you own'
    )[1];
    assert.doesNotMatch(owners.split('Shared with you')[0], /Anna Králová/);
    const html = await (await get('/account/people?q=%22%3E%3Cb%3E', jan)).text();
    assert.doesNotMatch(html, /"><b>/, 'the term is escaped');
  });

  test('"Not here in 30 days" exists only when opens are recorded, and lists who has none', async (t) => {
    const { net, env, jan, anna } = await world(t);
    assert.doesNotMatch(
      text(await (await get('/account/people', jan)).text()),
      /Not here in 30 days/
    );
    env.CF_ANALYTICS_TOKEN = 'analytics-read';
    net.analyticsRows = (sql) =>
      sql.includes('MAX(timestamp)') ? [{ account: jan.id, last: '2026-11-24 10:00:00' }] : [];
    const page = text(await (await get('/account/people?tab=quiet', jan)).text());
    assert.match(page, /Not here in 30 days\s+1/);
    assert.match(page.split('Projects you own')[1], /Anna Králová/);
    void anna;
  });

  test('bulk: change role in a project, add to another project (no new mail), remove from the account', async (t) => {
    const { net, env, sqlite, jan, anna } = await world(t);
    const bob = await signUp(env, sqlite, 'bob@example.com');
    addMember(sqlite, 'kolar-web', bob.id, 'viewer');
    net.mails.length = 0;
    const send = (fields, people) =>
      post('/account/people', jan, {}, { csrf: 'account', body: bulk(fields, people) });
    assert.equal(
      (await send({ do: 'role-bulk', project: 'kolar-web', role: 'member' }, [anna.id, bob.id]))
        .status,
      303
    );
    assert.deepEqual(
      [roleOf(sqlite, 'kolar-web', anna.id), roleOf(sqlite, 'kolar-web', bob.id)],
      ['member', 'member']
    );
    assert.equal(
      (await send({ do: 'add-bulk', project: 'plakaty', role: 'viewer' }, [anna.id, bob.id]))
        .status,
      303
    );
    assert.deepEqual(
      [roleOf(sqlite, 'plakaty', anna.id), roleOf(sqlite, 'plakaty', bob.id)],
      ['viewer', 'viewer']
    );
    assert.equal(
      net.mails.length,
      0,
      'people already on the account are added without a new invitation'
    );
    assert.equal(
      auditRows(sqlite, 'access.role').filter((r) => r.project_id === 'plakaty').length,
      2
    );
    assert.equal((await send({ do: 'remove-all', sure: 'yes' }, [bob.id])).status, 303);
    assert.equal(roleOf(sqlite, 'kolar-web', bob.id), null);
    assert.equal(roleOf(sqlite, 'plakaty', bob.id), null);
    assert.equal(roleOf(sqlite, 'plakaty', anna.id), 'viewer');
  });

  test('ALL OR NOTHING: one id that is another owner’s — person or project — refuses the whole bulk action', async (t) => {
    const { env, sqlite, jan, anna, eva } = await world(t);
    const carl = await signUp(env, sqlite, 'carl@other.cz');
    addMember(sqlite, 'evas', carl.id, 'viewer'); // Eva's person, not Jan's
    addMember(sqlite, 'evas', jan.id, 'member'); // Jan can EDIT Eva's project; he owns none of it
    const snapshot = () =>
      JSON.stringify(
        sqlite.prepare('SELECT * FROM project_members ORDER BY project_id, account_id').all()
      );
    const before = snapshot();
    const send = (fields, people) =>
      post('/account/people', jan, {}, { csrf: 'account', body: bulk(fields, people) });
    const attempts = [
      [{ do: 'role-bulk', project: 'kolar-web', role: 'member' }, [anna.id, carl.id]],
      [{ do: 'role-bulk', project: 'evas', role: 'member' }, [carl.id]],
      [{ do: 'add-bulk', project: 'plakaty', role: 'member' }, [anna.id, carl.id]],
      [{ do: 'add-bulk', project: 'evas', role: 'member' }, [anna.id]],
      [{ do: 'add-bulk', project: 'plakaty', role: 'member' }, [anna.id, eva.id]],
      [{ do: 'remove-all', sure: 'yes' }, [anna.id, carl.id]],
      [{ do: 'role-bulk', project: 'kolar-web', role: 'owner' }, [anna.id]],
      [{ do: 'add-bulk', project: 'plakaty', role: 'observer' }, [anna.id]],
    ];
    for (const [fields, people] of attempts) {
      const res = await send(fields, people);
      assert.ok(
        res.status === 400 || res.status === 404,
        `${JSON.stringify(fields)} → ${res.status}`
      );
      assert.equal(snapshot(), before, `${JSON.stringify(fields)}: nothing applied`);
    }
    // No token: refused before anything is read.
    assert.equal(
      (
        await post(
          '/account/people',
          jan,
          {},
          { csrf: null, body: bulk({ do: 'remove-all', sure: 'yes' }, [anna.id]) }
        )
      ).status,
      403
    );
    assert.equal(snapshot(), before);
  });

  test('Make owner is two steps: offered, mailed, and nothing moves until the recipient accepts', async (t) => {
    const { net, sqlite, jan, anna } = await world(t);
    const offer = await post(
      '/account/people',
      jan,
      { do: 'transfer-offer', project: 'kolar-web', account: anna.id },
      { csrf: 'account' }
    );
    assert.equal(offer.status, 303);
    assert.equal(project(sqlite, 'kolar-web').account_id, jan.id, 'not yet');
    assert.equal(net.mails.length, 1);
    assert.deepEqual(net.mails[0].to, [anna.email]);
    assert.match(net.mails[0].subject, /owner of Kolář web/);
    const hers = await (await get('/account/people', anna)).text();
    assert.match(text(hers), /wants to make you the owner of Kolář web/);
    const id = /name="transfer" value="([^"]+)"/.exec(hers)[1];
    // Nobody but the recipient can accept it.
    const thief = await post(
      '/account/people',
      jan,
      { do: 'transfer-accept', transfer: id },
      { csrf: 'account' }
    );
    assert.equal(thief.status, 404);
    assert.equal(project(sqlite, 'kolar-web').account_id, jan.id);
    const ok = await post(
      '/account/people',
      anna,
      { do: 'transfer-accept', transfer: id },
      { csrf: 'account' }
    );
    assert.equal(ok.status, 303);
    assert.equal(project(sqlite, 'kolar-web').account_id, anna.id);
    assert.equal(
      roleOf(sqlite, 'kolar-web', jan.id),
      'member',
      'the previous owner stays on it as Can edit'
    );
    assert.equal(roleOf(sqlite, 'kolar-web', anna.id), null, 'the owner is a column, not a row');
    assert.equal(auditRows(sqlite, 'project.transfer.accepted').length, 1);
    // Used once.
    assert.equal(
      (
        await post(
          '/account/people',
          anna,
          { do: 'transfer-accept', transfer: id },
          { csrf: 'account' }
        )
      ).status,
      404
    );
  });

  test('Make owner: declined or cancelled offers move nothing; refused for strangers, unverified addresses, paid projects, other owners’ projects', async (t) => {
    const { env, sqlite, jan, anna, eva } = await world(t);
    const offer = (who, project_, account) =>
      post(
        '/account/people',
        who,
        { do: 'transfer-offer', project: project_, account },
        { csrf: 'account' }
      );
    const idOf = () =>
      sqlite.prepare('SELECT id FROM project_transfers ORDER BY created_at DESC LIMIT 1').get().id;
    await offer(jan, 'kolar-web', anna.id);
    await post(
      '/account/people',
      anna,
      { do: 'transfer-decline', transfer: idOf() },
      { csrf: 'account' }
    );
    assert.equal(project(sqlite, 'kolar-web').account_id, jan.id);
    await offer(jan, 'kolar-web', anna.id);
    const live = idOf();
    await post(
      '/account/people',
      jan,
      { do: 'transfer-cancel', transfer: live },
      { csrf: 'account' }
    );
    assert.equal(
      (
        await post(
          '/account/people',
          anna,
          { do: 'transfer-accept', transfer: live },
          { csrf: 'account' }
        )
      ).status,
      404
    );
    assert.equal(project(sqlite, 'kolar-web').account_id, jan.id);

    const count = () => sqlite.prepare('SELECT COUNT(*) AS n FROM project_transfers').get().n;
    const n = count();
    assert.equal((await offer(jan, 'kolar-web', eva.id)).status, 400, 'not on the project');
    assert.equal((await offer(jan, 'evas', anna.id)).status, 404, 'not his project');
    const fresh = await signUp(env, sqlite, 'fresh@example.com', { verify: false });
    addMember(sqlite, 'kolar-web', fresh.id, 'member');
    assert.equal((await offer(jan, 'kolar-web', fresh.id)).status, 400, 'unverified address');
    seedProject(sqlite, { id: 'paid', owner: jan.id, subscription: 'sub_1' });
    addMember(sqlite, 'paid', anna.id, 'member');
    assert.equal(
      (await offer(jan, 'paid', anna.id)).status,
      400,
      'a paid plan stays with who pays'
    );
    assert.equal(count(), n);
    assert.equal((await offer(jan, 'kolar-web', anna.id, {})).status, 303);
    assert.equal(
      (
        await post(
          '/account/people',
          jan,
          { do: 'transfer-offer', project: 'kolar-web', account: anna.id },
          { csrf: null }
        )
      ).status,
      403
    );
  });
});

// ------------------------------------------------------- 5. operator › overview

describe('5 · operator overview: the four lists, with counts, and Needs a look', () => {
  test('Newest accounts · Trial ends soon (≤ 7 days) · Promo — counted and listed', async (t) => {
    const { sqlite, op, jan, eva } = await world(t);
    seedProject(sqlite, { id: 'soon', owner: eva.id, trialEndsAt: Date.now() + 3 * DAY });
    seedProject(sqlite, { id: 'brand', owner: jan.id, promoSince: 1, promoTier: 'dedicated' });
    const page = text(await (await get('/operator', op)).text());
    assert.match(page, /Newest accounts\s+4/);
    assert.match(page, /Trial ends soon\s+1/);
    assert.match(page, /Promo\s+1/);
    assert.match(page, /Needs a look/);
    const soon = text(await (await get('/operator?tab=trial', op)).text()).split('Needs a look')[0];
    assert.match(soon, /eva@other\.cz/);
    assert.doesNotMatch(soon.split('Trial ends soon')[2] ?? soon, /anna@example\.com/);
    const promo = await (await get('/operator?tab=promo', op)).text();
    assert.ok(promo.includes(`href="/operator/accounts/${jan.id}"`));
    assert.ok(!promo.split('Needs a look')[0].includes(`href="/operator/accounts/${eva.id}"`));
  });

  test('Most active needs recorded events: listed from them, and says so when there are none', async (t) => {
    const { net, env, op, jan, anna } = await world(t);
    assert.match(
      text(await (await get('/operator?tab=active', op)).text()),
      /Analytics is not connected/
    );
    env.CF_ANALYTICS_TOKEN = 'analytics-read';
    net.analyticsRows = (sql) =>
      sql.includes('GROUP BY account') && sql.includes('events')
        ? [
            { account: anna.id, events: 40 },
            { account: jan.id, events: 12 },
          ]
        : [];
    const html = await (await get('/operator?tab=active', op)).text();
    assert.ok(
      html.indexOf(anna.email) > 0 && html.indexOf(anna.email) < html.lastIndexOf(jan.email)
    );
    assert.match(text(html), /40/);
  });
});
