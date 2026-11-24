// The security review of the operator actions (2026-11-24) — one test per
// finding, each written to fail on the code as reviewed.
//
// Same posture as the other operator tests: the live worker, a real session,
// real SQLite, the network faked at `fetch`.

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  addMember,
  assertNoStripe,
  auditRows,
  bind,
  DAY,
  env_,
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
import { decideFreeTime } from './operator-actions.mjs';
import { planState } from './project-access.mjs';
import worker, { reconcileSweep } from './worker.mjs';

async function world(t, { strict = true } = {}) {
  const net = installNetwork(t);
  const { env, sqlite } = await freshEnv();
  env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const op = await makeOperator(env, sqlite);
  const jan = await signUp(env, sqlite, 'jan@kolar.studio');
  bind(env, op, jan);
  net.mails.length = 0;
  if (strict) t.after(() => assertNoStripe(net));
  return { net, env, sqlite, op, jan };
}

function fakeStripe(net, { subscriptions = {}, session = null } = {}) {
  net.routes.unshift([
    'api.stripe.com',
    async (url) => {
      const sub = /\/v1\/subscriptions\/(sub_\w+)$/.exec(url);
      if (sub) {
        const found = subscriptions[sub[1]];
        return found ? Response.json(found) : new Response('{}', { status: 404 });
      }
      if (url.endsWith('/v1/customers')) return Response.json({ id: 'cus_1' });
      if (url.endsWith('/v1/checkout/sessions')) {
        return Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' });
      }
      if (session && url.includes('/v1/checkout/sessions/cs_test_1')) return Response.json(session);
      if (url.includes('/v1/invoices') || url.includes('/v1/customers/')) {
        return Response.json({ data: [] });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    },
  ]);
}

const completedSession = (projectId) => ({
  id: 'cs_test_1',
  status: 'complete',
  customer: 'cus_1',
  subscription: 'sub_9',
  metadata: { project_id: projectId, project_name: projectId, plan: 'project', convert: '1' },
});

const NEW_PROJECT = {
  owner: 'cto@victim.com',
  name: 'Victim brand',
  plan: 'promo',
  tier: 'project',
  ends: '',
  invites: 'designer@victim.com',
  reason: 'a customer we onboard by hand',
};

// ------------------------------------------------- 1. wake and the retention

describe('1 · waking a held project never skips the retention window', () => {
  test('a 40-day hold over a subscription that lapsed: after the wake the ladder runs from day 0', async (t) => {
    const { net, env, sqlite, op, jan } = await world(t, { strict: false });
    const subs = { sub_1: { id: 'sub_1', status: 'active' } };
    fakeStripe(net, { subscriptions: subs });
    env.EXPORTS = { list: async () => ({ objects: [{ key: 'x' }] }), delete: async () => {} };
    seedProject(sqlite, { id: 'plakaty', owner: jan.id, name: 'Plakáty', subscription: 'sub_1' });
    await post('/operator/projects/plakaty/pause', op, { reason: 'checking a report' });
    assert.equal(project(sqlite, 'plakaty').state, 'suspended');

    // Forty days pass under the hold, and the subscription ends meanwhile.
    const back = 40 * DAY;
    sqlite
      .prepare(
        "UPDATE projects SET hold_since = hold_since - ?, state_since = state_since - ? WHERE id = 'plakaty'"
      )
      .run(back, back);
    subs.sub_1 = { id: 'sub_1', status: 'canceled' };
    net.mails.length = 0;

    const wokeAt = Date.now();
    await post('/operator/projects/plakaty/wake', op, { reason: 'report closed' });
    const row = project(sqlite, 'plakaty');
    assert.equal(row.hold_since, null);
    assert.equal(row.state, 'suspended', 'the subscription is gone: paused, not deleted');
    assert.ok(row.state_since >= wokeAt, 'the retention clock starts at the wake');
    assert.equal(auditRows(sqlite, 'do.purge-data').length, 0);
    assert.equal(auditRows(sqlite, 'do.warn-deletion').length, 0);
    // Day 0 of the ordinary ladder: the copy is prepared and the owner is told.
    assert.equal(auditRows(sqlite, 'do.send-export').length, 1);
    assert.equal(net.mails.filter((m) => /has paused/.test(m.subject)).length, 1);

    // Day 27: nothing more. Day 29: the two-days warning. Only then, day 30+, the export state.
    await reconcileSweep(env, { now: row.state_since + 27 * DAY });
    assert.equal(auditRows(sqlite, 'do.warn-deletion').length, 0);
    assert.equal(project(sqlite, 'plakaty').state, 'suspended');
    await reconcileSweep(env, { now: row.state_since + 29 * DAY });
    assert.equal(auditRows(sqlite, 'do.warn-deletion').length, 1);
    assert.equal(project(sqlite, 'plakaty').state, 'suspended');
    assert.equal(auditRows(sqlite, 'do.purge-data').length, 0);
  });
});

// -------------------------------------------- 2. new project is never a replay

describe('2 · "New project for an account" never touches a project it did not make', () => {
  test('an existing project of that very owner is a 409: no invitation, no activation, nothing written', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    // Jan's own unpaid checkout: a `pending` row with a subscription on it.
    seedProject(sqlite, {
      id: 'kolar-web',
      owner: jan.id,
      name: 'Kolář web',
      state: 'pending',
      subscription: 'sub_unpaid',
    });
    const before = JSON.stringify(project(sqlite, 'kolar-web'));
    const res = await post('/operator/new-project', op, {
      ...NEW_PROJECT,
      owner: jan.email,
      name: 'Kolář web',
      invites: op.email,
    });
    assert.equal(res.status, 409);
    assert.equal(
      JSON.stringify(project(sqlite, 'kolar-web')),
      before,
      'not activated, not changed'
    );
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM project_invites').get().n, 0);
    assert.equal(net.mails.length, 0);
    assert.equal(net.cloudflare.length, 0, 'no address was routed');
  });

  test('a real replay (the operator made it) issues NO further invitation', async (t) => {
    const { net, sqlite, op } = await world(t);
    await post('/operator/new-project', op, { ...NEW_PROJECT, owner: 'jana@novakova.design' });
    const mails = net.mails.length;
    const again = await post('/operator/new-project', op, {
      ...NEW_PROJECT,
      owner: 'jana@novakova.design',
      invites: op.email,
    });
    assert.equal(again.status, 303);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM project_invites').get().n, 1);
    assert.equal(net.mails.length, mails);
  });

  test('every invitation an operator action issues is in the log', async (t) => {
    const { sqlite, op } = await world(t);
    await post('/operator/new-project', op, {
      ...NEW_PROJECT,
      owner: 'jana@novakova.design',
      invites: 'a@studio.cz b@studio.cz',
    });
    const rows = auditRows(sqlite, 'operator.invite.sent');
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.project_id, 'victim-brand');
      assert.equal(r.actor, `operator:${op.email}`);
      assert.equal(r.reason, NEW_PROJECT.reason);
    }
  });
});

// ----------------------------------------------- 3. the pre-registered account

describe('3 · an unverified, pre-registered account never captures a project', () => {
  test('attacker signs up as cto@victim.com → operator makes a project + invites → the attacker owns nothing', async (t) => {
    const { net, env, sqlite, op } = await world(t);
    const attacker = await signUp(env, sqlite, 'cto@victim.com', { verify: false });
    bind(env, attacker);
    net.mails.length = 0;

    const res = await post('/operator/new-project', op, NEW_PROJECT);
    assert.equal(res.status, 409);
    assert.match(text(await res.text()), /has not confirmed/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM project_invites').get().n, 0);
    // The attacker's session is over…
    const after = await worker.fetch(
      new Request(`${ORIGIN}/account`, {
        headers: { cookie: `maude_session=${attacker.session}` },
      }),
      env
    );
    assert.equal(after.status, 303);
    // …and ONE mail went to the mailbox, carrying the password link (not a
    // confirmation link: confirming would leave the attacker's password in place).
    assert.equal(net.mails.length, 1);
    assert.deepEqual(net.mails[0].to, ['cto@victim.com']);
    const link = /\/auth\/reset\?t=(mer_[0-9a-f]+)/.exec(net.mails[0].text);
    assert.ok(link, 'a password link');
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM email_tokens WHERE account_id = ? AND purpose = 'verify' AND used_at IS NULL"
        )
        .get(attacker.id).n,
      0,
      'the confirmation link from the attacker’s sign-up is dead'
    );

    // The mailbox holder chooses a password; the address is now proven.
    const reset = await worker.fetch(
      new Request(`${ORIGIN}/auth/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ t: link[1], password: 'the-real-owner-password' }).toString(),
      }),
      env
    );
    assert.equal(reset.status, 303);
    const made = await post('/operator/new-project', op, NEW_PROJECT);
    assert.equal(made.status, 303);
    assert.equal(
      project(sqlite, 'victim-brand').account_id,
      attacker.id,
      'the same row, now the mailbox holder’s'
    );
    // The attacker's password no longer opens it.
    const login = await worker.fetch(
      new Request(`${ORIGIN}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'cto@victim.com',
          password: 'a-long-enough-password',
        }).toString(),
      }),
      env
    );
    assert.equal(login.status, 401);
  });

  test('an account an operator made (no password at all) is not an attacker: a second project is fine', async (t) => {
    const { sqlite, op } = await world(t);
    await post('/operator/new-project', op, { ...NEW_PROJECT, owner: 'jana@novakova.design' });
    const second = await post('/operator/new-project', op, {
      ...NEW_PROJECT,
      owner: 'jana@novakova.design',
      name: 'Second one',
      invites: '',
    });
    assert.equal(second.status, 303);
    assert.ok(project(sqlite, 'second-one'));
  });

  test('a project is not moved to an unverified account either', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const attacker = await signUp(env, sqlite, 'cto@victim.com', { verify: false });
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    const res = await post('/operator/projects/kolar-web/move', op, {
      to: 'cto@victim.com',
      reason: 'handing it over',
    });
    assert.match(res.headers.get('location'), /error=move-unverified/);
    assert.equal(project(sqlite, 'kolar-web').account_id, jan.id);
    const page = text(await (await get(res.headers.get('location'), op)).text());
    assert.match(page, /has not confirmed/);
    void attacker;
  });
});

// ---------------------------------------------------- 4. free time on no plan

describe('4 · free time is refused on a row that never expires', () => {
  test('a row with no trial clock and no subscription is refused, not given an expiry', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'pilot', owner: jan.id, name: 'Pilot' });
    assert.equal(planState(project(sqlite, 'pilot')), 'none');
    assert.deepEqual(decideFreeTime(project(sqlite, 'pilot'), { days: 30 }), {
      outcome: 'refuse',
      why: 'no-plan',
    });
    const res = await post('/operator/projects/pilot/free-time', op, {
      rid: 'rid-noplan-01',
      days: '30',
      reason: 'x y z',
    });
    assert.match(res.headers.get('location'), /error=free-no-plan/);
    assert.equal(project(sqlite, 'pilot').trial_ends_at, null);
    assert.equal(planState(project(sqlite, 'pilot'), { now: Date.now() + 400 * DAY }), 'none');
    assert.equal(net.mails.length, 0);
    const page = text(await (await get(res.headers.get('location'), op)).text());
    assert.match(page, /never expires/);
    // And the page no longer offers it there.
    assert.doesNotMatch(
      await (await get('/operator/projects/pilot', op)).text(),
      /\/operator\/projects\/pilot\/free-time/
    );
  });

  test('account-wide: the trial project moves, the no-plan one is skipped and reported', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'pilot', owner: jan.id });
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    const res = await post(`/operator/accounts/${jan.id}/free-time`, op, {
      rid: 'rid-noplan-02',
      days: '14',
      reason: 'x y z',
    });
    assert.match(res.headers.get('location'), /done=free-time&given=1&skipped=1/);
    assert.equal(project(sqlite, 'pilot').trial_ends_at, null);
    const [refused] = auditRows(sqlite, 'operator.free-time.refused');
    assert.equal(refused.project_id, 'pilot');
    assert.equal(JSON.parse(refused.detail).why, 'no-plan');
  });
});

// ------------------------------------------------------ 5. an open checkout

describe('5 · nothing is moved or paused while a checkout is open', () => {
  test('owner starts Choose a plan → move and pause are refused → the payment still attaches', async (t) => {
    const { net, sqlite, op, jan, env } = await world(t, { strict: false });
    const eva = await signUp(env, sqlite, 'eva@pokorna.cz');
    fakeStripe(net, { session: completedSession('kolar-web') });
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 2 * DAY });
    const start = await post(
      '/projects/kolar-web/billing/plan',
      jan,
      { plan: 'project', interval: 'monthly' },
      { csrf: 'account' }
    );
    assert.equal(start.status, 303);

    const move = await post('/operator/projects/kolar-web/move', op, {
      to: eva.email,
      reason: 'x y z',
    });
    assert.match(move.headers.get('location'), /error=move-checkout-open/);
    const pause = await post('/operator/projects/kolar-web/pause', op, { reason: 'x y z' });
    assert.match(pause.headers.get('location'), /error=pause-checkout-open/);
    assert.match(
      text(await (await get(move.headers.get('location'), op)).text()),
      /A checkout is open for this project/
    );
    const row = project(sqlite, 'kolar-web');
    assert.equal(row.account_id, jan.id);
    assert.equal(row.hold_since, null);

    await get('/checkout/return?project=kolar-web&session_id=cs_test_1', jan);
    const paid = project(sqlite, 'kolar-web');
    assert.equal(paid.subscription_id, 'sub_9');
    assert.equal(paid.account_id, jan.id);
    assert.equal(planState(paid), 'paid');
    // The checkout is settled: it no longer blocks a pause.
    fakeStripe(net, { subscriptions: { sub_9: { id: 'sub_9', status: 'active' } } });
    const later = await post('/operator/projects/kolar-web/pause', op, { reason: 'x y z' });
    assert.match(later.headers.get('location'), /done=paused/);
  });

  test('a checkout started more than a day ago is not open any more', async (t) => {
    const { net, sqlite, op, jan } = await world(t, { strict: false });
    fakeStripe(net);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 9 * DAY });
    await post(
      '/projects/kolar-web/billing/plan',
      jan,
      { plan: 'project', interval: 'monthly' },
      { csrf: 'account' }
    );
    sqlite
      .prepare("UPDATE audit_log SET at = at - ? WHERE action = 'checkout.started'")
      .run(2 * DAY);
    const pause = await post('/operator/projects/kolar-web/pause', op, { reason: 'x y z' });
    assert.match(pause.headers.get('location'), /done=paused/);
  });
});

// ---------------------------------------------------------- 6. sign out

describe('6 · sign out everywhere always ends the live connections and always says so', () => {
  test('no browser session and no Mac — still the revocations, still the log row, never "nothing changed"', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    sqlite.prepare('UPDATE sessions SET revoked_at = 1 WHERE account_id = ?').run(jan.id);
    const res = await post(`/operator/accounts/${jan.id}/sign-out`, op, {
      reason: 'laptop stolen',
    });
    assert.match(res.headers.get('location'), /done=signed-out$/);
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM member_revocations WHERE project_id = 'kolar-web' AND email = ?"
        )
        .get(jan.email).n,
      1
    );
    assert.equal(auditRows(sqlite, 'operator.account.signed-out').length, 1);
    const page = text(await (await get(res.headers.get('location'), op)).text());
    assert.match(page, /Signed out everywhere/);
    assert.doesNotMatch(page, /Nothing changed/);
  });
});

// ------------------------------------------------------------- 7. the notes

describe('7a · invitation resend / cancel on a project page need the session token', () => {
  test('without the token: 403 and nothing happens; with it: done', async (t) => {
    const { net, sqlite, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    sqlite
      .prepare(
        `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at)
         VALUES ('inv-a', 'kolar-web', 'radek@alligators.cz', 'member', ?, ?)`
      )
      .run(Date.now(), Date.now() + 5 * DAY);
    const html = await (await get('/projects/kolar-web/people', jan)).text();
    const form = /<form[^>]*>(?:(?!<\/form>)[\s\S])*invite-cancel[\s\S]*?<\/form>/.exec(html)[0];
    assert.match(form, /name="csrf" value="[0-9a-f]{32}"/);
    for (const verb of ['invite-resend', 'invite-cancel']) {
      const res = await post(
        '/projects/kolar-web/people',
        jan,
        { do: verb, invite: 'inv-a' },
        { csrf: null }
      );
      assert.equal(res.status, 403, verb);
    }
    assert.equal(net.mails.length, 0);
    assert.equal(
      sqlite.prepare("SELECT revoked_at FROM project_invites WHERE id = 'inv-a'").get().revoked_at,
      null
    );
    const ok = await post(
      '/projects/kolar-web/people',
      jan,
      { do: 'invite-cancel', invite: 'inv-a' },
      { csrf: 'account' }
    );
    assert.equal(ok.status, 200);
    assert.ok(
      sqlite.prepare("SELECT revoked_at FROM project_invites WHERE id = 'inv-a'").get().revoked_at
    );
  });
});

describe('7b · after a move the new owner does not read what was written about the previous one', () => {
  test('Activity is cut at the move for operator and plan rows; ordinary project history stays', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const eva = await signUp(env, sqlite, 'eva@pokorna.cz');
    bind(env, eva);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-move-0001',
      days: '14',
      reason: 'Jan is behind on invoices',
    });
    await post('/operator/projects/kolar-web/pause', op, { reason: 'abuse report against Jan' });
    await post('/operator/projects/kolar-web/wake', op, { reason: 'cleared' });
    sqlite
      .prepare(
        "INSERT INTO audit_log (id, project_id, at, actor, action) VALUES ('aud_old', 'kolar-web', ?, 'customer:jan@kolar.studio', 'member.role')"
      )
      .run(Date.now() - 1000);
    // The move happens later than everything above.
    sqlite.prepare("UPDATE audit_log SET at = at - 60000 WHERE project_id = 'kolar-web'").run();
    await post('/operator/projects/kolar-web/move', op, {
      to: eva.email,
      reason: 'studio changed hands',
    });
    await post('/operator/projects/kolar-web/promo', op, {
      tier: 'project',
      ends: '',
      reason: 'welcome, Eva',
    });

    const page = text(await (await get('/projects/kolar-web/audit', eva)).text());
    assert.doesNotMatch(page, /behind on invoices|abuse report against Jan|cleared/);
    assert.match(page, /Maude moved this project to another owner/);
    assert.match(page, /welcome, Eva/);
    assert.match(page, /Changed what someone can do/, 'ordinary history is still hers');
  });
});

describe('7c · two identical posts at once', () => {
  test('one log row, one e-mail, the days added once', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    const end = Date.now() + 2 * DAY;
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: end });
    const send = () =>
      post('/operator/projects/kolar-web/free-time', op, {
        rid: 'rid-race-00001',
        days: '30',
        reason: 'pilot',
      });
    await Promise.all([send(), send(), send()]);
    assert.equal(project(sqlite, 'kolar-web').trial_ends_at, end + 30 * DAY);
    assert.equal(auditRows(sqlite, 'operator.free-time.given').length, 1);
    assert.equal(net.mails.length, 1);
  });

  test('when the write matched nothing (a plan arrived first): no "free until" mail, and the log says refused', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    const { giveFreeTime } = await import('./operator-actions.mjs');
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    const stale = project(sqlite, 'kolar-web');
    sqlite.prepare("UPDATE projects SET subscription_id = 'sub_9' WHERE id = 'kolar-web'").run();
    const out = await giveFreeTime(env_(op), {
      operator: op,
      projects: [stale],
      days: 30,
      reason: 'pilot',
      requestId: 'rid-race-00002',
      scope: 'project:kolar-web',
      origin: ORIGIN,
    });
    assert.equal(out.given.length, 0);
    assert.equal(out.refused[0].why, 'paid');
    assert.equal(net.mails.length, 0);
    assert.equal(auditRows(sqlite, 'operator.free-time.given').length, 0);
    assert.equal(auditRows(sqlite, 'operator.free-time.refused').length, 1);
  });
});

describe('7d · a subscription never attaches beside a Promo that was not cleared', () => {
  test('when the attaching statement fails for any reason but a missing column, nothing attaches', async (t) => {
    const { net, env, sqlite, jan } = await world(t, { strict: false });
    fakeStripe(net, { session: completedSession('alligators') });
    seedProject(sqlite, { id: 'alligators', owner: jan.id, promoSince: 1, promoTier: 'project' });
    await post(
      '/projects/alligators/billing/plan',
      jan,
      { plan: 'project', interval: 'monthly' },
      { csrf: 'account' }
    );
    // The database refuses exactly the Promo-clearing attach, once.
    const real = env.DB;
    env.DB = {
      prepare(sql) {
        if (/promo_since = NULL/.test(sql)) throw new Error('D1_ERROR: database is busy');
        return real.prepare(sql);
      },
    };
    const res = await get('/checkout/return?project=alligators&session_id=cs_test_1', jan);
    env.DB = real;
    assert.equal(res.status, 503);
    const row = project(sqlite, 'alligators');
    assert.equal(row.subscription_id, null, 'never paid AND Promo at once');
    assert.equal(row.promo_since, 1);
    // The same page, reloaded once the database answers: attached, Promo cleared.
    await get('/checkout/return?project=alligators&session_id=cs_test_1', jan);
    const after = project(sqlite, 'alligators');
    assert.equal(after.subscription_id, 'sub_9');
    assert.equal(after.promo_since, null);
  });
});

describe('7e · a signed-out caller learns nothing about /operator', () => {
  test('GET and POST without a session answer exactly like an unknown URL', async (t) => {
    const { env } = await world(t);
    const unknown = await worker.fetch(new Request(`${ORIGIN}/no-such-page`), env);
    for (const path of [
      '/operator',
      '/operator/accounts',
      '/operator/accounts/acct_x',
      '/operator/new-project',
    ]) {
      const res = await worker.fetch(
        new Request(`${ORIGIN}${path}`, { headers: { accept: 'text/html' } }),
        env
      );
      assert.equal(res.status, 404, path);
      assert.equal(res.headers.get('location'), null, path);
      assert.equal(await res.text(), await unknown.clone().text(), path);
    }
  });
});

// ------------------------------------------------------------ 8. the webhook

describe('8 · the Stripe webhook against Promo, held and free-time projects', () => {
  const send = (env, event, { secret = env.STRIPE_WEBHOOK_SECRET, at = Date.now() } = {}) => {
    const body = JSON.stringify(event);
    const ts = Math.floor(at / 1000);
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    return worker.fetch(
      new Request(`${ORIGIN}/webhooks/stripe`, {
        method: 'POST',
        headers: { 'stripe-signature': `t=${ts},v1=${sig}` },
        body,
      }),
      env
    );
  };
  const about = (projectId) => ({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', metadata: { project_id: projectId } } },
  });
  const seed = (sqlite, jan) => {
    const now = Date.now();
    seedProject(sqlite, { id: 'promo-p', owner: jan.id, promoSince: now, promoTier: 'project' });
    seedProject(sqlite, { id: 'free-p', owner: jan.id, trialEndsAt: now + 60 * DAY });
    seedProject(sqlite, {
      id: 'held-p',
      owner: jan.id,
      subscription: 'sub_h',
      state: 'suspended',
      holdSince: now,
      cellRunning: 0,
    });
  };
  const snapshot = (sqlite) =>
    JSON.stringify(sqlite.prepare('SELECT * FROM projects ORDER BY id').all());

  test('a forged signature and a stale timestamp are refused: no job, no change', async (t) => {
    const { env, sqlite, jan } = await world(t);
    seed(sqlite, jan);
    const before = snapshot(sqlite);
    for (const id of ['promo-p', 'free-p', 'held-p']) {
      const forged = await send(env, about(id), { secret: 'whsec_wrong' });
      assert.equal(forged.status, 400);
      const stale = await send(env, about(id), { at: Date.now() - 3_600_000 });
      assert.equal(stale.status, 400);
    }
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 0);
    assert.equal(snapshot(sqlite), before);
  });

  test('a genuine event, delivered three times, changes none of the three states', async (t) => {
    const { net, env, sqlite, jan } = await world(t, { strict: false });
    seed(sqlite, jan);
    fakeStripe(net, { subscriptions: { sub_h: { id: 'sub_h', status: 'active' } } });
    const before = snapshot(sqlite);
    for (let i = 0; i < 3; i++) {
      for (const id of ['promo-p', 'free-p', 'held-p']) {
        assert.equal((await send(env, about(id))).status, 200);
      }
      await send(env, {
        id: 'evt_2',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_h', status: 'active' } },
      });
    }
    await reconcileSweep(env);
    await reconcileSweep(env);
    assert.equal(
      snapshot(sqlite),
      before,
      'Promo stays Promo, free time stays, the held one stays held'
    );
    assert.equal(planState(project(sqlite, 'promo-p')), 'promo');
    assert.equal(project(sqlite, 'held-p').state, 'suspended');
    assert.equal(
      auditRows(sqlite, 'do.resume-cell').length,
      0,
      'a webhook does not wake a held project'
    );
    assert.equal(net.mails.length, 0);
    void addMember;
  });
});
