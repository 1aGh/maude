// Free time, Promo and operator-made projects against the paths that carry
// money: checkout.mjs / checkout-routes.mjs, the Stripe webhook, and the hourly
// sweep (reconcile.mjs + worker.mjs).
//
// Stripe is FAKED at `fetch`, per test and by name; a call no test declared is
// recorded by the kit and fails the test at teardown. Nothing here reaches the
// real Stripe API.

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';

import {
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
import { giveFreeTime } from './operator-actions.mjs';
import { planState } from './project-access.mjs';
import worker, { reconcileSweep } from './worker.mjs';

async function world(t) {
  const net = installNetwork(t);
  const { env, sqlite } = await freshEnv();
  env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const op = await makeOperator(env, sqlite);
  const jan = await signUp(env, sqlite, 'jan@kolar.studio');
  bind(env, op, jan);
  net.mails.length = 0;
  t.after(() => assertNoStripe(net));
  return { net, env, sqlite, op, jan };
}

/** A fake Stripe for exactly the calls a test names; anything else fails it. */
function fakeStripe(net, { subscriptions = {}, session = null } = {}) {
  const asked = [];
  net.routes.unshift([
    'api.stripe.com',
    async (url, init) => {
      asked.push({ url, method: init.method ?? 'GET' });
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
      // The billing page's own reads — best-effort there, so "nothing" is fine.
      if (url.includes('/v1/invoices') || url.includes('/v1/customers/')) {
        return Response.json({ data: [] });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    },
  ]);
  return asked;
}

function webhook(env, event) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex');
  return worker.fetch(
    new Request(`${ORIGIN}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': `t=${t},v1=${sig}` },
      body,
    }),
    env
  );
}

const completedSession = (projectId) => ({
  id: 'cs_test_1',
  status: 'complete',
  customer: 'cus_1',
  subscription: 'sub_9',
  metadata: { project_id: projectId, project_name: projectId, plan: 'project', convert: '1' },
});

const restarts = (net, id) =>
  net.cell.filter((c) => c.url.includes(`//${id}.`) && c.url.endsWith('/_cell/restart')).length;

// ------------------------------------------------------- the trial-end sweep

describe('the hourly sweep and free time', () => {
  test('an EXTENDED trial is not paused at its old end — and is paused, once, at the new one', async (t) => {
    const { net, env, sqlite, op, jan } = await world(t);
    const now = Date.now();
    const oldEnd = now + 2 * DAY;
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: oldEnd });
    await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-sweep-01',
      days: '30',
      reason: 'more time to decide',
    });
    const newEnd = project(sqlite, 'kolar-web').trial_ends_at;
    assert.equal(newEnd, oldEnd + 30 * DAY);

    // Past the ORIGINAL end: the sweep must leave it running.
    await reconcileSweep(env, { now: oldEnd + DAY });
    assert.equal(auditRows(sqlite, 'do.plan-paused').length, 0);
    assert.equal(restarts(net, 'kolar-web'), 0);
    assert.equal(project(sqlite, 'kolar-web').state, 'active');

    // Past the NEW end: paused once, however many sweeps follow.
    await reconcileSweep(env, { now: newEnd + 1000 });
    await reconcileSweep(env, { now: newEnd + 3_600_000 });
    assert.equal(auditRows(sqlite, 'do.plan-paused').length, 1);
    assert.equal(restarts(net, 'kolar-web'), 1);
    // Still `active`, never suspended: nothing is deleted, no export clock.
    const row = project(sqlite, 'kolar-web');
    assert.equal(row.state, 'active');
    assert.equal(row.export_sent_at, null);
    assert.equal(net.mails.length, 1, 'only the free-time e-mail — no "has paused" mail');
  });

  test('a trial that had ALREADY been paused, then given free time, pauses again at the new end', async (t) => {
    const { net, env, sqlite, op, jan } = await world(t);
    const now = Date.now();
    seedProject(sqlite, { id: 'cenik', owner: jan.id, trialEndsAt: now - 3 * DAY });
    await reconcileSweep(env, { now });
    assert.equal(auditRows(sqlite, 'do.plan-paused').length, 1);
    await post('/operator/projects/cenik/free-time', op, {
      rid: 'rid-sweep-02',
      days: '14',
      reason: 'came back',
    });
    assert.equal(restarts(net, 'cenik'), 2, 'the pause, then the wake');
    await reconcileSweep(env, { now: now + DAY });
    assert.equal(auditRows(sqlite, 'do.plan-paused').length, 1, 'not paused inside the free time');
    await reconcileSweep(env, { now: now + 15 * DAY });
    assert.equal(auditRows(sqlite, 'do.plan-paused').length, 2);
    assert.equal(restarts(net, 'cenik'), 3);
  });
});

describe('the hourly sweep and Promo', () => {
  test('a Promo project is never paused or suspended — not by the trial clock, not by "no subscription"', async (t) => {
    const { net, env, sqlite, op, jan } = await world(t);
    const now = Date.now();
    seedProject(sqlite, { id: 'alligators', owner: jan.id, trialEndsAt: now - 40 * DAY });
    await post('/operator/projects/alligators/promo', op, {
      tier: 'dedicated',
      ends: '',
      reason: 'our own club',
    });
    const before = restarts(net, 'alligators'); // the wake from its ended trial
    for (const at of [now + DAY, now + 60 * DAY, now + 400 * DAY]) {
      const outcomes = await reconcileSweep(env, { now: at });
      const mine = outcomes.find((o) => o.projectId === 'alligators');
      assert.equal(mine.outcome, 'ok');
      assert.deepEqual(mine.actions, [], `no action at +${Math.round((at - now) / DAY)}d`);
    }
    const row = project(sqlite, 'alligators');
    assert.equal(row.state, 'active');
    assert.equal(row.cell_running, 1);
    assert.equal(planState(row, { now: now + 400 * DAY }), 'promo');
    assert.equal(auditRows(sqlite, 'do.plan-paused').length, 0);
    assert.equal(restarts(net, 'alligators'), before);
    // The legacy "no plan" row alerted into the customer-visible log every hour.
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'reconcile'").get().n,
      0
    );
    assert.equal(net.mails.length, 0);
  });

  test('a Promo with an end date: one notice 30 days before, then a pause at the date — nothing deleted', async (t) => {
    const { net, env, sqlite, jan } = await world(t);
    const now = Date.now();
    const ends = now + 45 * DAY;
    seedProject(sqlite, {
      id: 'alligators',
      owner: jan.id,
      name: 'Alligators brand',
      promoSince: now - DAY,
      promoTier: 'project',
      promoEndsAt: ends,
    });
    await reconcileSweep(env, { now });
    assert.equal(net.mails.length, 0, '45 days out: not yet');
    await reconcileSweep(env, { now: now + 16 * DAY });
    await reconcileSweep(env, { now: now + 17 * DAY });
    assert.equal(net.mails.length, 1, 'told once');
    assert.match(net.mails[0].subject, /^Promo for Alligators brand ends on /);
    assert.equal(auditRows(sqlite, 'do.plan-paused').length, 0);

    await reconcileSweep(env, { now: ends + 1000 });
    await reconcileSweep(env, { now: ends + DAY });
    const paused = auditRows(sqlite, 'do.plan-paused');
    assert.equal(paused.length, 1);
    assert.equal(paused[0].detail, 'promo ended');
    const row = project(sqlite, 'alligators');
    assert.equal(row.state, 'active');
    assert.equal(planState(row, { now: ends + DAY }), 'paused');
    assert.equal(net.mails.length, 1, 'no export or deletion mail');
  });

  test('a project an operator paused stays paused past the retention window: no export, no deletion', async (t) => {
    const { net, env, sqlite, op, jan } = await world(t);
    const now = Date.now();
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: now + 400 * DAY });
    await post('/operator/projects/kolar-web/pause', op, { reason: 'abuse report' });
    for (const at of [now + DAY, now + 29 * DAY, now + 31 * DAY, now + 90 * DAY]) {
      await reconcileSweep(env, { now: at });
    }
    const row = project(sqlite, 'kolar-web');
    assert.equal(row.state, 'suspended');
    assert.equal(row.export_sent_at, null);
    for (const action of ['do.send-export', 'do.warn-deletion', 'do.purge-data']) {
      assert.equal(auditRows(sqlite, action).length, 0, action);
    }
    assert.equal(net.mails.length, 0);
  });
});

// ------------------------------------------------------------------ webhooks

describe('customer.subscription.* webhooks', () => {
  test('for a Promo project with no subscription: acked, not acted on, Promo untouched', async (t) => {
    const { env, sqlite, jan } = await world(t);
    seedProject(sqlite, { id: 'alligators', owner: jan.id, promoSince: 1, promoTier: 'dedicated' });
    const res = await webhook(env, {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_stranger', status: 'canceled' } },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, handled: false });
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 0);
    await reconcileSweep(env);
    const row = project(sqlite, 'alligators');
    assert.equal(row.state, 'active');
    assert.equal(planState(row), 'promo');
  });

  test('once a paid plan replaced Promo, its webhook is the ordinary machine’s — and a cancel suspends', async (t) => {
    const { net, env, sqlite, jan } = await world(t);
    const now = Date.now();
    // What Choose a plan leaves behind: a subscription, and Promo cleared.
    seedProject(sqlite, { id: 'alligators', owner: jan.id, subscription: 'sub_9' });
    fakeStripe(net, { subscriptions: { sub_9: { id: 'sub_9', status: 'canceled' } } });
    const res = await webhook(env, {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_9', status: 'canceled' } },
    });
    assert.deepEqual(await res.json(), { ok: true, handled: true });
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM jobs WHERE reason = 'webhook'").get().n,
      1
    );
    // One adverse reading does not tear down (the 6-hour debounce)…
    await reconcileSweep(env, { now });
    assert.equal(project(sqlite, 'alligators').state, 'active');
    // …a persistent one does, as for any paid project. A day of it, written
    // onto the row here rather than swept hour by hour (browser-gates.test.mjs
    // sweeps the whole debounce for real).
    sqlite
      .prepare("UPDATE projects SET adverse_since = ? WHERE id = 'alligators'")
      .run(now - 86_400_000);
    await reconcileSweep(env, { now: now + 3_600_000 });
    const row = project(sqlite, 'alligators');
    assert.equal(row.state, 'suspended');
    assert.equal(auditRows(sqlite, 'do.suspend-cell').length, 1);
  });

  test('a STALE Promo flag beside a live subscription decides nothing: paid wins everywhere', async (t) => {
    const { net, env, sqlite, op, jan } = await world(t);
    // Not reachable through the app (the attach clears Promo); proven anyway,
    // because "never both" must hold for a row somebody edited by hand.
    seedProject(sqlite, {
      id: 'alligators',
      owner: jan.id,
      subscription: 'sub_9',
      promoSince: 1,
      promoTier: 'project',
    });
    fakeStripe(net, { subscriptions: { sub_9: { id: 'sub_9', status: 'active' } } });
    assert.equal(planState(project(sqlite, 'alligators')), 'paid');
    await webhook(env, {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_9', status: 'active' } },
    });
    const [mine] = (await reconcileSweep(env)).filter((o) => o.projectId === 'alligators');
    assert.equal(mine.outcome, 'ok');
    const page = text(await (await get('/operator/projects/alligators', op)).text());
    assert.match(page, /Cloud Project · paid/);
    assert.doesNotMatch(page, /Promo · /);
  });
});

// ------------------------------------------------------------------- checkout

describe('Choose a plan against free time and Promo', () => {
  test('a checkout on a project WITH free time converts it; free time afterwards is refused', async (t) => {
    const { net, env, sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 2 * DAY });
    await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-checkout-1',
      days: '30',
      reason: 'pilot',
    });
    const extended = project(sqlite, 'kolar-web').trial_ends_at;
    const asked = fakeStripe(net, { session: completedSession('kolar-web') });

    const start = await post(
      '/projects/kolar-web/billing/plan',
      jan,
      { plan: 'project', interval: 'monthly' },
      { csrf: 'account' }
    );
    assert.equal(start.status, 303);
    assert.match(start.headers.get('location'), /checkout\.stripe\.com/);
    // No second trial is asked of Stripe: the free time was ours to give, not Stripe's.
    assert.ok(asked.some((a) => a.url.endsWith('/v1/checkout/sessions')));

    const back = await get('/checkout/return?project=kolar-web&session_id=cs_test_1', jan);
    assert.equal(back.status, 303);
    const row = project(sqlite, 'kolar-web');
    assert.equal(row.subscription_id, 'sub_9');
    assert.equal(planState(row), 'paid');
    assert.equal(row.trial_ends_at, extended, 'the date is history now; it decides nothing');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1, 'no second row');

    const again = await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-checkout-2',
      days: '30',
      reason: 'pilot',
    });
    assert.match(again.headers.get('location'), /error=free-paid/);
    assert.equal(project(sqlite, 'kolar-web').trial_ends_at, extended);
    void env;
  });

  test('free time decided BEFORE a subscription landed does not write past it', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const end = Date.now() + DAY;
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: end });
    const stale = project(sqlite, 'kolar-web'); // read before the checkout returned
    sqlite.prepare("UPDATE projects SET subscription_id = 'sub_9' WHERE id = 'kolar-web'").run();
    const out = await giveFreeTime(env, {
      operator: op,
      projects: [stale],
      days: 30,
      reason: 'pilot',
      requestId: 'rid-race-0001',
      scope: 'project:kolar-web',
      origin: ORIGIN,
    });
    assert.equal(out.ok, true);
    assert.equal(
      project(sqlite, 'kolar-web').trial_ends_at,
      end,
      'the guarded UPDATE matched nothing'
    );
    assert.equal(planState(project(sqlite, 'kolar-web')), 'paid');
  });

  test('a paid plan starting ENDS Promo — never both, and the log keeps that it was Promo', async (t) => {
    const { net, sqlite, jan } = await world(t);
    seedProject(sqlite, {
      id: 'alligators',
      owner: jan.id,
      promoSince: Date.now() - 30 * DAY,
      promoTier: 'dedicated',
      promoEndsAt: Date.now() + 10 * DAY,
    });
    fakeStripe(net, { session: completedSession('alligators') });
    const start = await post(
      '/projects/alligators/billing/plan',
      jan,
      { plan: 'project', interval: 'monthly' },
      { csrf: 'account' }
    );
    assert.equal(start.status, 303, 'a Promo project can choose a plan');
    await get('/checkout/return?project=alligators&session_id=cs_test_1', jan);
    const row = project(sqlite, 'alligators');
    assert.equal(row.subscription_id, 'sub_9');
    assert.equal(row.promo_since, null);
    assert.equal(row.promo_tier, null);
    assert.equal(row.promo_ends_at, null);
    assert.equal(planState(row), 'paid');
    const [ended] = auditRows(sqlite, 'promo.ended');
    assert.equal(JSON.parse(ended.detail).tier, 'dedicated');
    // A refreshed return page attaches nothing twice and logs nothing twice.
    await get('/checkout/return?project=alligators&session_id=cs_test_1', jan);
    assert.equal(auditRows(sqlite, 'promo.ended').length, 1);
  });

  test('an operator-made Promo project is not offered a second, self-made trial project', async (t) => {
    const { sqlite, op } = await world(t);
    await post('/operator/new-project', op, {
      owner: 'jana@novakova.design',
      name: 'Identita 2027',
      plan: 'trial',
      invites: '',
      reason: 'demo',
    });
    // The operator-made trial project spent that address's one trial claim.
    const claims = sqlite.prepare('SELECT project_id FROM trial_claims').all();
    assert.deepEqual(
      claims.map((c) => c.project_id),
      ['identita-2027']
    );
    // …and no checkout attempt or subscription exists for it.
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM checkout_attempts').get().n, 0);
    assert.equal(project(sqlite, 'identita-2027').subscription_id, null);
  });
});

// ------------------------------------------------- the whole flow, end to end

describe('route-level smoke: sign up → trial project → 30 days → billing page → Promo → sweep', () => {
  test('the real worker, the real schema, one owner and one operator', async (t) => {
    const { net, env, sqlite, op, jan } = await world(t);
    // 1. The owner starts a trial project the way the app does (device token).
    const { sha256Hex } = await import('./accounts.mjs');
    const token = `mpt_${'ab'.repeat(24)}`;
    sqlite
      .prepare(
        'INSERT INTO personal_tokens (id, account_id, label, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(await sha256Hex(token), jan.id, 'Maude on darwin', Date.now());
    const made = await worker.fetch(
      new Request(`${ORIGIN}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'Kolář web' }),
      }),
      env
    );
    assert.equal(made.status, 201);
    const start = project(sqlite, 'kolar-web');
    assert.equal(start.state, 'active');
    assert.equal(planState(start), 'trial');

    // 2. The operator gives 30 days.
    const gave = await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-smoke-001',
      days: '30',
      reason: 'asked for more time to decide',
    });
    assert.equal(gave.status, 303);
    const until = project(sqlite, 'kolar-web').trial_ends_at;
    assert.equal(until, start.trial_ends_at + 30 * DAY);
    const day = new Date(until).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    // 3. The owner sees the new date on the billing pages, and in the Activity log.
    const billing = text(await (await get('/projects/kolar-web/billing', jan)).text());
    assert.ok(billing.includes(`Free until ${day}`), billing.slice(0, 400));
    const accountBilling = text(await (await get('/account/billing', jan)).text());
    assert.ok(accountBilling.includes(`free until ${day}`));
    const activity = text(await (await get('/projects/kolar-web/audit', jan)).text());
    assert.match(activity, /Maude gave this project free time/);
    assert.match(activity, /asked for more time to decide/);

    // 4. The operator marks it Promo.
    await post('/operator/projects/kolar-web/promo', op, {
      tier: 'dedicated',
      ends: '',
      reason: 'studio we work with',
    });
    const promoBilling = text(await (await get('/projects/kolar-web/billing', jan)).text());
    assert.match(promoBilling, /Promo from Maude · free/);
    assert.match(promoBilling, /250 GB/);
    assert.doesNotMatch(promoBilling, /Choose a plan/);
    const dash = text(await (await get('/', jan)).text());
    assert.match(dash, /Promo/);

    // 5. The trial sweep, long past every trial date: not paused.
    const far = until + 200 * DAY;
    const outcomes = await reconcileSweep(env, { now: far });
    assert.deepEqual(outcomes.find((o) => o.projectId === 'kolar-web').actions, []);
    assert.equal(auditRows(sqlite, 'do.plan-paused').length, 0);
    assert.equal(project(sqlite, 'kolar-web').state, 'active');
    assert.equal(restarts(net, 'kolar-web'), 0);
    // The cell is told `promo`, never `paused`.
    const { deriveCellSecret } = await import('./cell-token.mjs');
    const cfg = await worker.fetch(
      new Request(`${ORIGIN}/internal/cell-config?tenant=kolar-web`, {
        headers: {
          authorization: `Bearer ${await deriveCellSecret(env.CELL_SECRET_MASTER, 'kolar-web')}`,
        },
      }),
      env
    );
    assert.equal((await cfg.json()).planState, 'promo');
  });
});
