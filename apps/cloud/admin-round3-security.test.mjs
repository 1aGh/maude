// The security review of the round-3 administration pieces (2026-11-25) — one
// test per finding, written to fail on the code as reviewed.

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
  makeOperator,
  post,
  project,
  seedProject,
  signUp,
  text,
} from './admin-test-kit.mjs';
import { readOnlyView } from './operator-view.mjs';
import { planState } from './project-access.mjs';
import { settle } from './reconcile.mjs';
import { reconcileSweep } from './worker.mjs';

async function world(t) {
  const net = installNetwork(t);
  const { env, sqlite } = await freshEnv();
  const op = await makeOperator(env, sqlite);
  const jan = await signUp(env, sqlite, 'jan@kolar.studio');
  const anna = await signUp(env, sqlite, 'anna@example.com');
  const bob = await signUp(env, sqlite, 'bob@example.com');
  bind(env, op, jan, anna, bob);
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
  addMember(sqlite, 'kolar-web', anna.id, 'member');
  addMember(sqlite, 'kolar-web', bob.id, 'viewer');
  net.mails.length = 0;
  return { net, env, sqlite, op, jan, anna, bob };
}

function fakeStripe(net, { subscriptions = {}, projectId = 'kolar-web' } = {}) {
  net.routes.unshift([
    'api.stripe.com',
    async (url) => {
      const sub = /\/v1\/subscriptions\/(sub_\w+)$/.exec(url);
      if (sub)
        return subscriptions[sub[1]]
          ? Response.json(subscriptions[sub[1]])
          : new Response('{}', { status: 404 });
      if (url.endsWith('/v1/customers')) return Response.json({ id: 'cus_1' });
      if (url.endsWith('/v1/checkout/sessions'))
        return Response.json({
          id: 'cs_test_1',
          url: 'https://checkout.stripe.com/c/pay/cs_test_1',
        });
      if (url.includes('/v1/checkout/sessions/cs_test_1')) {
        return Response.json({
          id: 'cs_test_1',
          status: 'complete',
          customer: 'cus_1',
          subscription: 'sub_9',
          metadata: {
            project_id: projectId,
            project_name: projectId,
            plan: 'project',
            convert: '1',
          },
        });
      }
      return Response.json({ data: [] });
    },
  ]);
}

const roleOf = (sqlite, projectId, accountId) =>
  sqlite
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND account_id = ?')
    .get(projectId, accountId)?.role ?? null;
const del = (op, id) =>
  post(`/operator/projects/${id}/delete`, op, { confirm: id, reason: 'owner asked' });
const plan = (who, id) =>
  post(
    `/projects/${id}/billing/plan`,
    who,
    { plan: 'project', interval: 'monthly' },
    { csrf: 'account' }
  );
const offer = (who, id, account) =>
  post('/account/people', who, { do: 'transfer-offer', project: id, account }, { csrf: 'account' });
const accept = (sqlite, who) =>
  post(
    '/account/people',
    who,
    {
      do: 'transfer-accept',
      transfer: sqlite
        .prepare('SELECT id FROM project_transfers ORDER BY created_at DESC LIMIT 1')
        .get().id,
    },
    { csrf: 'account' }
  );
const bulk = (fields, people) => {
  const body = new URLSearchParams(fields);
  for (const p of people) body.append('people', p);
  return body;
};

// ------------------------------------------------ 1. paid while deletion scheduled

describe('1 · a project is never deleted, or charged for, across a scheduled deletion', () => {
  test('Choose a plan is refused while deletion is scheduled', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    fakeStripe(net);
    await del(op, 'kolar-web');
    net.stripe.length = 0;
    const res = await plan(jan, 'kolar-web');
    assert.equal(res.status, 409);
    assert.match(text(await res.text()), /scheduled for deletion[\s\S]*Maude support/);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'checkout.started'").get()
        .n,
      0
    );
  });

  test('a payment that lands anyway cancels the deletion in the statement that attaches it', async (t) => {
    const { net, env, sqlite, jan } = await world(t);
    fakeStripe(net, { subscriptions: { sub_9: { status: 'active' } } });
    // The checkout was opened first; the deletion is written past it by hand
    // (the guarded schedule below refuses this order — proven next).
    await plan(jan, 'kolar-web');
    sqlite
      .prepare(
        "UPDATE projects SET delete_since = ?, state = 'suspended', state_since = ?, cell_running = 0 WHERE id = 'kolar-web'"
      )
      .run(Date.now(), Date.now() - 40 * DAY);
    await get('/checkout/return?project=kolar-web&session_id=cs_test_1', jan);
    const row = project(sqlite, 'kolar-web');
    assert.equal(row.subscription_id, 'sub_9');
    assert.equal(row.delete_since, null, 'paid: the deletion is off');
    env.EXPORTS = {
      list: async () => ({ objects: [{ key: 'x' }] }),
      delete: async () => assert.fail('a paid project must not be purged'),
    };
    await reconcileSweep(env, { now: Date.now() + 60 * DAY });
    assert.equal(project(sqlite, 'kolar-web').state, 'active');
    assert.equal(auditRows(sqlite, 'do.purge-data').length, 0);
  });

  test('the reconciler YIELDS: deletion scheduled + a live subscription on the row → no ladder, the flag is cleared and logged', async (t) => {
    const { net, env, sqlite, jan } = await world(t);
    fakeStripe(net, { subscriptions: { sub_live: { status: 'active' } } });
    const now = Date.now();
    seedProject(sqlite, {
      id: 'paid',
      owner: jan.id,
      subscription: 'sub_live',
      state: 'suspended',
      stateSince: now - 40 * DAY,
      cellRunning: 0,
    });
    sqlite.prepare("UPDATE projects SET delete_since = ? WHERE id = 'paid'").run(now - 40 * DAY);
    env.EXPORTS = {
      list: async () => ({ objects: [{ key: 'x' }] }),
      delete: async () => assert.fail('never purged'),
    };
    await reconcileSweep(env, { now });
    await reconcileSweep(env, { now: now + 3_600_000 });
    const row = project(sqlite, 'paid');
    assert.equal(row.delete_since, null);
    assert.equal(row.state, 'active');
    assert.equal(auditRows(sqlite, 'reconcile.delete-cancelled').length, 1);
    assert.equal(net.mails.length, 0);
    // Pure: every live status yields; an ended one does not.
    const base = {
      id: 'p',
      state: 'suspended',
      stateSince: 0,
      cellRunning: false,
      exportSent: true,
      adverseSince: null,
      trialEndsAt: null,
      subscriptionId: 'sub_1',
      promo: false,
      holdSince: null,
      deleteSince: 1,
    };
    for (const status of ['active', 'trialing', 'past_due']) {
      const out = settle(base, { status }, { now: 99 * DAY });
      assert.equal(out.tenant.deleteSince, null, status);
      assert.ok(
        !out.actions.some((a) => a.kind === 'purge-data' || a.kind === 'send-export'),
        status
      );
    }
    const ended = settle(base, { status: 'canceled' }, { now: 99 * DAY });
    assert.equal(ended.tenant.deleteSince, 1);
  });

  test('scheduling is one guarded statement: a checkout opened in between wins, and nothing is scheduled', async (t) => {
    const { env, sqlite, op } = await world(t);
    // The row the action read is stale: a checkout started after it was read.
    const { scheduleDelete } = await import('./operator-actions.mjs');
    const stale = project(sqlite, 'kolar-web');
    sqlite
      .prepare(
        "INSERT INTO audit_log (id, project_id, at, actor, action) VALUES ('a1', 'kolar-web', ?, 'customer:x', 'checkout.started')"
      )
      .run(Date.now());
    const out = await scheduleDelete(env, {
      operator: op,
      project: stale,
      confirm: 'kolar-web',
      reason: 'x y',
      origin: 'https://cloud.test',
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'delete-checkout-open');
    assert.equal(project(sqlite, 'kolar-web').delete_since, null);
  });
});

// ---------------------------------------------------------- 2–4. make owner

describe('2–4 · a Make-owner offer is only as good as the facts at the moment of accepting', () => {
  test('removed from the project → the offer is closed and cannot be accepted', async (t) => {
    const { sqlite, jan, anna } = await world(t);
    await offer(jan, 'kolar-web', anna.id);
    await post(
      '/account/people',
      jan,
      { do: 'remove', project: 'kolar-web', account: anna.id },
      { csrf: 'account' }
    );
    assert.ok(
      sqlite.prepare('SELECT closed_at FROM project_transfers').get().closed_at,
      'closed with the removal'
    );
    sqlite.prepare('UPDATE project_transfers SET closed_at = NULL, outcome = NULL').run(); // even if it were still open…
    const res = await accept(sqlite, anna);
    assert.equal(res.status, 400);
    assert.equal(project(sqlite, 'kolar-web').account_id, jan.id);
  });

  test('demoted below the role they were offered at → closed, and refused', async (t) => {
    const { sqlite, jan, anna } = await world(t);
    await offer(jan, 'kolar-web', anna.id);
    assert.equal(sqlite.prepare('SELECT to_role FROM project_transfers').get().to_role, 'member');
    await post(
      '/projects/kolar-web/people',
      jan,
      { do: 'role', account: anna.id, role: 'viewer' },
      { csrf: null }
    );
    assert.ok(sqlite.prepare('SELECT closed_at FROM project_transfers').get().closed_at);
    sqlite.prepare('UPDATE project_transfers SET closed_at = NULL, outcome = NULL').run();
    assert.equal((await accept(sqlite, anna)).status, 400);
    assert.equal(project(sqlite, 'kolar-web').account_id, jan.id);
  });

  test('a checkout under way, or a deletion scheduled → accepting is refused; and no plan can be chosen while an offer is open', async (t) => {
    const { net, sqlite, op, jan, anna } = await world(t);
    fakeStripe(net);
    await offer(jan, 'kolar-web', anna.id);
    const blocked = await plan(jan, 'kolar-web');
    assert.equal(blocked.status, 409);
    assert.match(text(await blocked.text()), /offered to a new owner/);
    sqlite
      .prepare(
        "INSERT INTO audit_log (id, project_id, at, actor, action) VALUES ('a1', 'kolar-web', ?, 'customer:x', 'checkout.started')"
      )
      .run(Date.now());
    assert.equal((await accept(sqlite, anna)).status, 400);
    assert.equal(project(sqlite, 'kolar-web').account_id, jan.id);

    await offer(jan, 'plakaty', anna.id); // not a member there
    addMember(sqlite, 'plakaty', anna.id, 'member');
    assert.equal((await offer(jan, 'plakaty', anna.id)).status, 303);
    await del(op, 'plakaty');
    assert.equal((await accept(sqlite, anna)).status, 400);
    assert.equal(project(sqlite, 'plakaty').account_id, jan.id);
    assert.ok(project(sqlite, 'plakaty').delete_since > 0);
    assert.equal(
      (await offer(jan, 'plakaty', anna.id)).status,
      400,
      'nor offered while deletion is scheduled'
    );
  });

  test('the operator cannot move a project whose deletion is scheduled; a move closes an open offer', async (t) => {
    const { sqlite, op, jan, anna, bob } = await world(t);
    await offer(jan, 'kolar-web', anna.id);
    await post('/operator/projects/kolar-web/move', op, { to: bob.email, reason: 'handover' });
    assert.equal(project(sqlite, 'kolar-web').account_id, bob.id);
    assert.ok(
      sqlite.prepare('SELECT closed_at FROM project_transfers').get().closed_at,
      'the offerer is no longer the owner'
    );
    await del(op, 'plakaty');
    const res = await post('/operator/projects/plakaty/move', op, {
      to: bob.email,
      reason: 'handover',
    });
    assert.match(res.headers.get('location'), /error=move-deleting/);
    assert.equal(project(sqlite, 'plakaty').account_id, jan.id);
  });
});

// ------------------------------------------------------------ 5. view-as audit

describe('5 · the read-only view is logged first, or not shown', () => {
  test('when the log row cannot be written the page is a 503 with nothing of the customer’s on it', async (t) => {
    const { env, op, jan } = await world(t);
    const real = env.DB;
    env.DB = {
      ...real,
      prepare: (sql) => {
        if (/INSERT INTO audit_log/.test(sql)) throw new Error('D1 is read-only');
        return real.prepare(sql);
      },
    };
    const res = await get(`/operator/accounts/${jan.id}/view/account/people`, op);
    env.DB = real;
    assert.equal(res.status, 503);
    const body = await res.text();
    assert.doesNotMatch(body, /Kolář web|anna@example\.com|jan@kolar\.studio/);
  });
});

// ------------------------------------------------------------------- 6. bulk

describe('6 · a bulk role change that fails part-way is undone', () => {
  test('the second write fails → the first is put back, and the page says nothing was changed', async (t) => {
    const { env, sqlite, jan, anna, bob } = await world(t);
    addMember(sqlite, 'kolar-web', (await signUp(env, sqlite, 'carl@example.com')).id, 'viewer');
    const carl = sqlite.prepare("SELECT id FROM accounts WHERE email = 'carl@example.com'").get();
    const real = env.DB;
    let writes = 0;
    env.DB = {
      ...real,
      prepare: (sql) => {
        if (/INSERT INTO project_members/.test(sql)) {
          writes += 1;
          if (writes === 2) throw new Error('D1 hiccup');
        }
        return real.prepare(sql);
      },
    };
    const res = await post(
      '/account/people',
      jan,
      {},
      {
        csrf: 'account',
        body: bulk({ do: 'role-bulk', project: 'kolar-web', role: 'member' }, [bob.id, carl.id]),
      }
    );
    env.DB = real;
    assert.equal(res.status, 400);
    assert.match(text(await res.text()), /Nothing was changed/);
    assert.equal(roleOf(sqlite, 'kolar-web', bob.id), 'viewer', 'put back');
    assert.equal(roleOf(sqlite, 'kolar-web', carl.id), 'viewer');
    assert.equal(roleOf(sqlite, 'kolar-web', anna.id), 'member');
  });

  test('the page does not promise more than that', async (t) => {
    const { jan } = await world(t);
    const page = text(await (await get('/account/people', jan)).text());
    assert.doesNotMatch(page, /for everyone selected, or for nobody/);
    assert.match(page, /checked for everyone selected before anything changes/i);
  });
});

// --------------------------------------------------------------- 7. readOnlyView

describe('7 · the read-only transform trusts nothing in the markup', () => {
  test('every control is disabled even when the word appears in an attribute; formaction, form= and on*= are gone', () => {
    const html = `<style></style><div class="main-inner">
      <form method="post" action="/x"><button title="not disabled yet" formaction="/steal" onclick="go()">A</button></form>
      <input type="text" name="q" placeholder="disabled" form="bulk" onfocus='x()'>
      <select name="r" data-note="disabled"><option>1</option></select>
      <textarea name="t" FORMACTION=/y onkeyup=z()></textarea>
      <a href="/account" onclick="steal()">x</a></div>`;
    const out = readOnlyView(html, { email: 'a@b.c', base: '/operator/accounts/acct_1/view' });
    assert.doesNotMatch(out, /<form\b/i);
    for (const m of out.matchAll(/<(button|input|select|textarea)\b[^>]*>/gi)) {
      assert.match(m[0], /^<\w+ disabled\b/, m[0]);
    }
    assert.doesNotMatch(out, /formaction/i);
    assert.doesNotMatch(out, /\sform=/i);
    assert.doesNotMatch(out, /\son[a-z]+\s*=/i);
    assert.match(out, /href="\/operator\/accounts\/acct_1\/view\/account"/);
  });
});

// ----------------------------------------------------- 8. add to project · role

describe('8 · nobody is added to a project above what they already hold without accepting', () => {
  test('a role no higher than their highest on this owner’s projects: added at once, no mail', async (t) => {
    const { net, sqlite, jan, anna } = await world(t);
    const res = await post(
      '/account/people',
      jan,
      {},
      {
        csrf: 'account',
        body: bulk({ do: 'add-bulk', project: 'plakaty', role: 'member' }, [anna.id]),
      }
    );
    assert.equal(res.status, 303);
    assert.equal(roleOf(sqlite, 'plakaty', anna.id), 'member');
    assert.equal(net.mails.length, 0);
  });

  test('a HIGHER role than they hold anywhere: the normal invitation, and not a member until they accept', async (t) => {
    const { net, sqlite, jan, bob } = await world(t);
    const res = await post(
      '/account/people',
      jan,
      {},
      {
        csrf: 'account',
        body: bulk({ do: 'add-bulk', project: 'plakaty', role: 'member' }, [bob.id]),
      }
    );
    assert.equal(res.status, 303);
    assert.equal(roleOf(sqlite, 'plakaty', bob.id), null, 'not added behind their back');
    const inv = sqlite
      .prepare("SELECT email, role FROM project_invites WHERE project_id = 'plakaty'")
      .get();
    assert.deepEqual([inv.email, inv.role], [bob.email, 'member']);
    assert.equal(net.mails.length, 1);
    assert.deepEqual(net.mails[0].to, [bob.email]);
  });

  test('the single role verb refuses an account that is not on that project — everywhere it is offered', async (t) => {
    const { sqlite, op, jan, anna } = await world(t);
    const viaAccount = await post(
      '/account/people',
      jan,
      { do: 'role', project: 'plakaty', account: anna.id, role: 'member' },
      { csrf: 'account' }
    );
    assert.equal(viaAccount.status, 400);
    const viaProject = await post(
      '/projects/plakaty/people',
      jan,
      { do: 'role', account: anna.id, role: 'member' },
      { csrf: null }
    );
    assert.equal(viaProject.status, 400);
    const viaOperator = await post('/operator/projects/plakaty/people', op, {
      do: 'role',
      account: anna.id,
      role: 'member',
      reason: 'x y',
    });
    assert.match(viaOperator.headers.get('location'), /error=people-refused/);
    assert.equal(roleOf(sqlite, 'plakaty', anna.id), null);
    assert.equal(planState(project(sqlite, 'plakaty')), 'trial');
  });
});
