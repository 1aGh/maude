// The owner's side of canvas 16 — cl-account, cl-people, un-member-cl:
//
//   1. the dashboard shows how the owner's projects are used, from figures that
//      are already recorded. A figure that is not recorded is NOT shown;
//   2. /account/people is every person × every project the account owns, with
//      the requests and unopened invitations on top and every change made
//      through the access authority (access-forward.mjs `accessCall`), whose
//      own checks decide — so nobody acts on a project they do not own;
//   3. /projects/:id/people can send an invitation again and cancel it.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  addMember,
  auditRows,
  bind,
  DAY,
  freshEnv,
  get,
  installNetwork,
  post,
  seedProject,
  signUp,
  text,
} from './admin-test-kit.mjs';

async function world(t) {
  const net = installNetwork(t);
  const { env, sqlite } = await freshEnv();
  const tereza = await signUp(env, sqlite, 'tereza@studyfi.com');
  const jonas = await signUp(env, sqlite, 'jonas@studyfi.com');
  const anna = await signUp(env, sqlite, 'anna@studyfi.com');
  const eva = await signUp(env, sqlite, 'eva@other.cz');
  bind(env, tereza, jonas, anna, eva);
  sqlite.prepare("UPDATE accounts SET name = 'Jonas Berger' WHERE id = ?").run(jonas.id);
  seedProject(sqlite, {
    id: 'studyfi-app',
    owner: tereza.id,
    name: 'StudyFi app',
    subscription: 'sub_1',
  });
  seedProject(sqlite, {
    id: 'marketing',
    owner: tereza.id,
    name: 'Marketing site',
    trialEndsAt: Date.now() + 5 * DAY,
  });
  seedProject(sqlite, {
    id: 'evas',
    owner: eva.id,
    name: 'Eva’s project',
    trialEndsAt: Date.now() + 5 * DAY,
  });
  addMember(sqlite, 'studyfi-app', jonas.id, 'member');
  addMember(sqlite, 'marketing', jonas.id, 'viewer');
  addMember(sqlite, 'marketing', anna.id, 'observer');
  // Tereza can EDIT Eva's project — and owns nothing there.
  addMember(sqlite, 'evas', tereza.id, 'member');
  addMember(sqlite, 'evas', anna.id, 'member');
  net.mails.length = 0;
  return { net, env, sqlite, tereza, jonas, anna, eva };
}

const invite = (
  sqlite,
  id,
  projectId,
  email,
  { role = 'member', ageDays = 0, redeemed = false } = {}
) =>
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, redeemed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      projectId,
      email,
      role,
      Date.now() - ageDays * DAY,
      Date.now() + (14 - ageDays) * DAY,
      redeemed ? Date.now() : null
    );

const request = (sqlite, id, projectId, accountId) =>
  sqlite
    .prepare(
      'INSERT INTO access_requests (id, project_id, account_id, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(id, projectId, accountId, Date.now() - DAY);

const roleOf = (sqlite, projectId, accountId) =>
  sqlite
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND account_id = ?')
    .get(projectId, accountId)?.role ?? null;

// ------------------------------------------------------------- the dashboard

describe('the dashboard overview — numbers already recorded, finally shown', () => {
  /** What Analytics Engine answers, keyed by what the SQL asks for. */
  const analytics = (sql) => {
    if (sql.includes('COUNT(DISTINCT blob1)')) return [{ active: 3 }];
    if (sql.includes('blob3 AS surface')) {
      return [
        { surface: 'desktop', opens: 82 },
        { surface: 'browser', opens: 16 },
      ];
    }
    if (sql.includes("'export_downloaded'")) return [{ exports: 48 }];
    if (sql.includes("'tenant_stats'")) {
      return [
        {
          project: 'studyfi-app',
          canvases: 61,
          artboards: 200,
          designSystems: 1,
          assetsBytes: 2 * 1024 ** 3,
        },
        {
          project: 'marketing',
          canvases: 24,
          artboards: 80,
          designSystems: 1,
          assetsBytes: 1024 ** 3,
        },
      ];
    }
    if (sql.includes('MAX(timestamp)')) return [];
    return [];
  };

  test('with analytics connected: people, canvases, exports, storage, opens by surface, invites', async (t) => {
    const { net, env, sqlite, tereza } = await world(t);
    env.CF_ANALYTICS_TOKEN = 'analytics-read';
    net.analyticsRows = analytics;
    invite(sqlite, 'inv-1', 'studyfi-app', 'new1@studyfi.com');
    invite(sqlite, 'inv-2', 'studyfi-app', 'new2@studyfi.com', { redeemed: true });
    invite(sqlite, 'inv-3', 'marketing', 'new3@studyfi.com', { redeemed: true });

    const page = text(await (await get('/', tereza)).text());
    assert.match(page, /Active this week\s+3\s+of 3/);
    assert.match(page, /Canvases\s+85/);
    assert.match(page, /Exports\s+48/);
    assert.match(page, /Storage\s+3\.0 GB/);
    assert.match(page, /Mac app\s+82 opens · 84 %/);
    assert.match(page, /Browser\s+16 opens · 16 %/);
    assert.match(page, /Invites\s+3 sent · 2 joined · 1 waiting/);
    // Every query names ONLY this owner's projects — never Eva's.
    assert.ok(net.analytics.length >= 3);
    for (const sql of net.analytics) {
      assert.match(sql, /'studyfi-app'/);
      assert.doesNotMatch(sql, /'evas'/);
    }
  });

  test('a figure nobody records is not on the page — and nothing is faked without analytics', async (t) => {
    const { sqlite, tereza } = await world(t);
    invite(sqlite, 'inv-1', 'studyfi-app', 'new1@studyfi.com');
    const page = text(await (await get('/', tereza)).text());
    // From D1, always: people and invitations.
    assert.match(page, /People\s+3/);
    assert.match(page, /Invites\s+1 sent · 0 joined · 1 waiting/);
    // Never recorded anywhere: edits. Not connected: everything from analytics.
    for (const absent of [
      'Edits',
      'Active this week',
      'Canvases',
      'Exports',
      'Storage',
      'Mac app',
    ]) {
      assert.ok(!page.includes(absent), `"${absent}" must not be shown`);
    }
    // The projects are still there, as before.
    assert.match(page, /StudyFi app/);
    assert.match(page, /Marketing site/);
  });

  test('a member who owns nothing gets no overview and nothing about anybody’s plan', async (t) => {
    const { anna } = await world(t);
    const page = text(await (await get('/', anna)).text());
    assert.match(page, /Marketing site/);
    assert.ok(!page.includes('Invites'));
    assert.ok(!page.includes('Active this week'));
    for (const money of ['Free trial', 'Promo', 'Choose a plan', 'plan chosen']) {
      assert.ok(!page.includes(money), `a member must not see "${money}"`);
    }
  });

  test('the owner’s card says the plan: trial with its date, Promo, paid — and Promo is never "Choose a plan"', async (t) => {
    const { sqlite, tereza } = await world(t);
    seedProject(sqlite, {
      id: 'brand',
      owner: tereza.id,
      name: 'Brand',
      promoSince: 1,
      promoTier: 'dedicated',
    });
    const html = await (await get('/', tereza)).text();
    const page = text(html);
    assert.match(page, /Brand[\s\S]*Promo from Maude · free/);
    assert.match(page, /Free trial · 5 days left/);
    const brandCard =
      /<article class="ad-proj">(?:(?!<\/article>)[\s\S])*Brand[\s\S]*?<\/article>/.exec(html)[0];
    assert.doesNotMatch(brandCard, /Choose a plan|Free trial/);
  });
});

// ------------------------------------------------------------ /account/people

describe('/account/people — everyone, every project you own, one table', () => {
  test('a row is a person, a column is a project you own, a cell is what they can do there', async (t) => {
    const { sqlite, tereza, jonas } = await world(t);
    request(sqlite, 'req_1', 'marketing', jonas.id);
    invite(sqlite, 'inv-open', 'studyfi-app', 'eva.pokorna@studyfi.com', { ageDays: 3 });
    const res = await get('/account/people', tereza);
    assert.equal(res.status, 200);
    const html = await res.text();
    const page = text(html);
    assert.match(page, /3 people in 2 projects · 1 asks to edit · 1 invite not opened/);
    // Columns: only projects Tereza OWNS. Eva's project is "Shared with you", never a column.
    const head = /<thead>[\s\S]*?<\/thead>/.exec(html)[0];
    assert.match(head, /StudyFi app/);
    assert.match(head, /Marketing site/);
    assert.doesNotMatch(head, /Eva/);
    assert.match(page, /Jonas Berger jonas@studyfi\.com/);
    // Asks to edit, and invites not opened, on top.
    assert.match(page, /Asks to edit[\s\S]*Jonas Berger · Marketing site/);
    assert.match(
      page,
      /Invites not opened[\s\S]*eva\.pokorna@studyfi\.com · StudyFi app[\s\S]*sent 3 days ago, works 11 more/
    );
    // No script, and wire role ids never reach the page.
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(page, /\bobserver\b|\bviewer\b/);
    // Members of Eva's project — people Tereza works beside but does not manage — are not listed.
    assert.match(page, /Shared with you[\s\S]*Eva’s project/);
  });

  test('change a role in one cell', async (t) => {
    const { net, sqlite, tereza, jonas } = await world(t);
    const res = await post(
      '/account/people',
      tereza,
      { do: 'role', project: 'marketing', account: jonas.id, role: 'member' },
      { csrf: 'account' }
    );
    assert.equal(res.status, 303);
    assert.equal(roleOf(sqlite, 'marketing', jonas.id), 'member');
    assert.equal(
      roleOf(sqlite, 'studyfi-app', jonas.id),
      'member',
      'the other project is untouched'
    );
    assert.equal(auditRows(sqlite, 'access.role').at(-1).actor, 'customer:tereza@studyfi.com');
    assert.ok(
      net.cell.some(
        (c) => c.url.includes('//marketing.') && c.url.endsWith('/internal/access-changed')
      )
    );
  });

  test('a demotion ends the live connection; remove from ONE project leaves the other', async (t) => {
    const { sqlite, tereza, jonas } = await world(t);
    await post(
      '/account/people',
      tereza,
      { do: 'role', project: 'studyfi-app', account: jonas.id, role: 'viewer' },
      { csrf: 'account' }
    );
    assert.equal(roleOf(sqlite, 'studyfi-app', jonas.id), 'viewer');
    assert.equal(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM member_revocations WHERE project_id = 'studyfi-app'")
        .get().n,
      1
    );
    await post(
      '/account/people',
      tereza,
      { do: 'remove', project: 'studyfi-app', account: jonas.id },
      { csrf: 'account' }
    );
    assert.equal(roleOf(sqlite, 'studyfi-app', jonas.id), null);
    assert.equal(roleOf(sqlite, 'marketing', jonas.id), 'viewer');
  });

  test('remove several people from the account: every project you own, their open invitations, and nothing of anyone else’s', async (t) => {
    const { sqlite, tereza, jonas, anna } = await world(t);
    invite(sqlite, 'inv-anna', 'studyfi-app', 'anna@studyfi.com');
    const fields = new URLSearchParams({ do: 'remove-all', sure: 'yes' });
    fields.append('people', jonas.id);
    fields.append('people', anna.id);
    const res = await post('/account/people', tereza, Object.fromEntries([]), {
      csrf: 'account',
      body: fields,
    });
    assert.equal(res.status, 303);
    for (const p of ['studyfi-app', 'marketing']) {
      assert.equal(roleOf(sqlite, p, jonas.id), null);
      assert.equal(roleOf(sqlite, p, anna.id), null);
    }
    assert.ok(
      sqlite.prepare("SELECT revoked_at FROM project_invites WHERE id = 'inv-anna'").get()
        .revoked_at
    );
    // Anna is still on EVA's project: Tereza removed her from Tereza's projects only.
    assert.equal(roleOf(sqlite, 'evas', anna.id), 'member');
    assert.equal(roleOf(sqlite, 'evas', tereza.id), 'member');
    // Without the confirmation tick, nothing happens.
  });

  test('bulk remove needs the confirmation tick', async (t) => {
    const { sqlite, tereza, jonas } = await world(t);
    const fields = new URLSearchParams({ do: 'remove-all' });
    fields.append('people', jonas.id);
    const res = await post('/account/people', tereza, {}, { csrf: 'account', body: fields });
    assert.equal(res.status, 400);
    assert.equal(roleOf(sqlite, 'marketing', jonas.id), 'viewer');
  });

  test('Asks to edit: Allow makes them Can edit; Not now closes the request and changes nothing', async (t) => {
    const { sqlite, tereza, jonas, anna } = await world(t);
    request(sqlite, 'req_1', 'marketing', jonas.id);
    request(sqlite, 'req_2', 'marketing', anna.id);
    await post(
      '/account/people',
      tereza,
      { do: 'request-allow', project: 'marketing', request: 'req_1' },
      { csrf: 'account' }
    );
    assert.equal(roleOf(sqlite, 'marketing', jonas.id), 'member');
    await post(
      '/account/people',
      tereza,
      { do: 'request-decline', project: 'marketing', request: 'req_2' },
      { csrf: 'account' }
    );
    assert.equal(roleOf(sqlite, 'marketing', anna.id), 'observer');
    const decisions = sqlite.prepare('SELECT id, decision FROM access_requests ORDER BY id').all();
    assert.deepEqual(
      decisions.map((d) => [d.id, d.decision]),
      [
        ['req_1', 'approved'],
        ['req_2', 'declined'],
      ]
    );
    const page = text(await (await get('/account/people', tereza)).text());
    assert.doesNotMatch(page, /asks to edit/);
  });

  test('Invites not opened: Send again mails it and renews it; Cancel invite ends it', async (t) => {
    const { net, sqlite, tereza } = await world(t);
    invite(sqlite, 'inv-a', 'studyfi-app', 'radek@alligators.cz', { ageDays: 10 });
    invite(sqlite, 'inv-b', 'marketing', 'eva.pokorna@studyfi.com', { ageDays: 1 });
    const before = sqlite
      .prepare("SELECT expires_at FROM project_invites WHERE id = 'inv-a'")
      .get().expires_at;
    await post(
      '/account/people',
      tereza,
      { do: 'invite-resend', project: 'studyfi-app', invite: 'inv-a' },
      { csrf: 'account' }
    );
    assert.equal(net.mails.length, 1);
    assert.deepEqual(net.mails[0].to, ['radek@alligators.cz']);
    assert.match(net.mails[0].text, /\/invite\/inv-a/);
    assert.ok(
      sqlite.prepare("SELECT expires_at FROM project_invites WHERE id = 'inv-a'").get().expires_at >
        before
    );
    await post(
      '/account/people',
      tereza,
      { do: 'invite-cancel', project: 'marketing', invite: 'inv-b' },
      { csrf: 'account' }
    );
    assert.ok(
      sqlite.prepare("SELECT revoked_at FROM project_invites WHERE id = 'inv-b'").get().revoked_at
    );
    assert.equal(auditRows(sqlite, 'access.invite-cancel').length, 1);
    assert.equal(auditRows(sqlite, 'access.invite-resend').length, 1);
  });

  test('ANOTHER ACCOUNT’S PROJECT: every action is refused and nothing changes — even for someone who can edit it', async (t) => {
    const { net, sqlite, tereza, anna, eva } = await world(t);
    invite(sqlite, 'inv-eva', 'evas', 'someone@else.cz');
    request(sqlite, 'req_eva', 'evas', anna.id);
    const snapshot = () =>
      JSON.stringify({
        members: sqlite
          .prepare('SELECT * FROM project_members ORDER BY project_id, account_id')
          .all(),
        invites: sqlite.prepare('SELECT * FROM project_invites ORDER BY id').all(),
        requests: sqlite.prepare('SELECT * FROM access_requests ORDER BY id').all(),
        audit: sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE project_id = 'evas'").get()
          .n,
      });
    const before = snapshot();
    // Tereza is a member (Can edit) of Eva's project. She owns none of it.
    const attempts = [
      { do: 'role', project: 'evas', account: anna.id, role: 'observer' },
      { do: 'remove', project: 'evas', account: anna.id },
      { do: 'request-allow', project: 'evas', request: 'req_eva' },
      { do: 'request-decline', project: 'evas', request: 'req_eva' },
      { do: 'invite-resend', project: 'evas', invite: 'inv-eva' },
      { do: 'invite-cancel', project: 'evas', invite: 'inv-eva' },
      // A project that does not exist reads the same as one that is not yours.
      { do: 'remove', project: 'no-such-project', account: anna.id },
    ];
    for (const fields of attempts) {
      const res = await post('/account/people', tereza, fields, { csrf: 'account' });
      assert.equal(res.status, 404, JSON.stringify(fields));
    }
    assert.equal(snapshot(), before);
    assert.equal(net.mails.length, 0);
    // And the bulk action only ever walks projects the caller owns.
    const bulk = new URLSearchParams({ do: 'remove-all', sure: 'yes' });
    bulk.append('people', anna.id);
    await post('/account/people', tereza, {}, { csrf: 'account', body: bulk });
    assert.equal(roleOf(sqlite, 'evas', anna.id), 'member');
    // The owner herself can, of course.
    const own = await post(
      '/account/people',
      eva,
      { do: 'remove', project: 'evas', account: anna.id },
      { csrf: 'account' }
    );
    assert.equal(own.status, 303);
    assert.equal(roleOf(sqlite, 'evas', anna.id), null);
  });

  test('no token, a token from the operator lane, a cross-site post — refused', async (t) => {
    const { sqlite, tereza, jonas } = await world(t);
    const fields = { do: 'remove', project: 'marketing', account: jonas.id };
    assert.equal((await post('/account/people', tereza, fields, { csrf: null })).status, 403);
    assert.equal((await post('/account/people', tereza, fields, { csrf: 'operator' })).status, 403);
    assert.equal(
      (
        await post('/account/people', tereza, fields, {
          csrf: 'account',
          headers: { origin: 'https://evil.example' },
        })
      ).status,
      403
    );
    assert.equal(roleOf(sqlite, 'marketing', jonas.id), 'viewer');
  });

  test('the owner cannot be changed or removed from here, and "owner" is not a role to give', async (t) => {
    const { sqlite, tereza, jonas } = await world(t);
    const self = await post(
      '/account/people',
      tereza,
      { do: 'remove', project: 'marketing', account: tereza.id },
      { csrf: 'account' }
    );
    assert.equal(self.status, 400);
    const promote = await post(
      '/account/people',
      tereza,
      { do: 'role', project: 'marketing', account: jonas.id, role: 'owner' },
      { csrf: 'account' }
    );
    assert.equal(promote.status, 400);
    assert.equal(
      sqlite.prepare("SELECT account_id FROM projects WHERE id = 'marketing'").get().account_id,
      tereza.id
    );
    assert.equal(roleOf(sqlite, 'marketing', jonas.id), 'viewer');
  });
});

// ----------------------------------------------------- /projects/:id/people

describe('/projects/:id/people — send an invitation again, or cancel it', () => {
  test('the owner sees both buttons on an unopened invitation; a member sees neither', async (t) => {
    const { sqlite, tereza, jonas } = await world(t);
    invite(sqlite, 'inv-a', 'studyfi-app', 'radek@alligators.cz');
    const owner = await (await get('/projects/studyfi-app/people', tereza)).text();
    assert.match(owner, /value="invite-resend"/);
    assert.match(owner, /value="invite-cancel"/);
    assert.match(owner, /name="invite" value="inv-a"/);
    const member = await (await get('/projects/studyfi-app/people', jonas)).text();
    assert.doesNotMatch(member, /invite-resend|invite-cancel|radek@alligators\.cz/);
  });

  test('Send again mails the same link and renews it; Cancel ends it; a member can do neither', async (t) => {
    const { net, sqlite, tereza, jonas } = await world(t);
    invite(sqlite, 'inv-a', 'studyfi-app', 'radek@alligators.cz', { ageDays: 12 });
    const act = (who, verb) =>
      post('/projects/studyfi-app/people', who, { do: verb, invite: 'inv-a' }, { csrf: 'account' });

    const denied = await act(jonas, 'invite-cancel');
    assert.equal(denied.status, 403);
    assert.equal(
      sqlite.prepare("SELECT revoked_at FROM project_invites WHERE id = 'inv-a'").get().revoked_at,
      null
    );

    const again = await act(tereza, 'invite-resend');
    assert.equal(again.status, 200);
    assert.match(text(await again.text()), /Sent again to radek@alligators\.cz/);
    assert.equal(net.mails.length, 1);
    assert.match(net.mails[0].text, /\/invite\/inv-a/);
    assert.ok(
      sqlite.prepare("SELECT expires_at FROM project_invites WHERE id = 'inv-a'").get().expires_at >
        Date.now() + 13 * DAY
    );

    const cancelled = await act(tereza, 'invite-cancel');
    assert.equal(cancelled.status, 200);
    const page = text(await cancelled.text());
    assert.match(page, /cancelled/);
    assert.doesNotMatch(page, /not joined yet/);
    assert.ok(
      sqlite.prepare("SELECT revoked_at FROM project_invites WHERE id = 'inv-a'").get().revoked_at
    );
    // The link is dead for whoever holds it.
    const dead = await act(tereza, 'invite-resend');
    assert.equal(dead.status, 404);
    assert.equal(net.mails.length, 1);
  });

  test('an invitation of ANOTHER project cannot be reached through this project’s page', async (t) => {
    const { net, sqlite, tereza } = await world(t);
    invite(sqlite, 'inv-eva', 'evas', 'someone@else.cz');
    for (const verb of ['invite-resend', 'invite-cancel']) {
      const res = await post(
        '/projects/studyfi-app/people',
        tereza,
        { do: verb, invite: 'inv-eva' },
        { csrf: 'account' }
      );
      assert.equal(res.status, 404);
    }
    assert.equal(
      sqlite.prepare("SELECT revoked_at FROM project_invites WHERE id = 'inv-eva'").get()
        .revoked_at,
      null
    );
    assert.equal(net.mails.length, 0);
  });
});
