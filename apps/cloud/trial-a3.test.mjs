// The A3 trial + "Choose a plan" — Maude v2 S9.15 (Gate 0 A3, S9-slices Q11).
//
//   - a new account carries a 14-day trial from its first sign-in, with NO
//     Stripe object;
//   - the first cloud project (Bearer `POST /api/projects {name}`) provisions a
//     workspace without checkout — once per verified e-mail (the default the
//     run recorded; Michal decides the abuse policy before any live rollout);
//   - at expiry with no subscription the project is PAUSED: `decideAccess`
//     still admits everyone (reads and exports), and the refusal for a write is
//     402 `plan` — "Choose a plan" for the owner, nothing about billing for
//     anyone else; nothing is deleted;
//   - "Choose a plan" is today's Checkout converting THAT project (no second
//     trial, no second project row).
//
// Same posture as checkout-routes.test.mjs: real SQLite behind the D1 shape,
// real Requests through the live worker, Stripe + Cloudflare faked at fetch.
// No test here may reach the real Stripe API.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';

import { sha256Hex } from './accounts.mjs';
import { TRIAL_DAYS, TRIALS_PER_VERIFIED_EMAIL, trialView } from './billing.mjs';
import { deriveCellSecret } from './cell-token.mjs';
import { checkoutSessionParams } from './checkout.mjs';
import { d1FromSqlite, tenantFromRow } from './db.mjs';
import { applySchema } from './migrate.mjs';
import { ACCESS_MESSAGES, decideAccess, planRefusal, planState } from './project-access.mjs';
import { decideTrialProvision } from './provisioning.mjs';
import { reconcile } from './reconcile.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker, { reconcileSweep } from './worker.mjs';

const DAY = 86_400_000;
const PASSWORD = 'a-long-enough-password';
const realFetch = globalThis.fetch;

let network;
let stripeCalls;
before(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    // The guard: a test that reaches the real Stripe API is a failed test.
    if (url.includes('api.stripe.com')) stripeCalls.push({ url, init });
    for (const [needle, handler] of network) {
      if (url.includes(needle)) return handler(url, init);
    }
    if (url.includes('api.stripe.com')) {
      return Response.json({ error: { message: 'no fake for this' } }, { status: 500 });
    }
    return realFetch(input, init);
  };
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  network = [];
  stripeCalls = [];
});

async function freshEnv() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  return {
    env: {
      DB,
      STRIPE_SECRET_KEY: 'sk_test_x',
      CF_PROVISION_TOKEN: 'cf-token',
      CF_ACCOUNT_ID: 'acct',
      CF_ZONE_ID: 'zone',
    },
    sqlite,
  };
}

const form = (fields) => new URLSearchParams(fields).toString();

async function signUp(env, email = 'founder@example.com') {
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email, password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  return /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
}

/** A device token for an account, the way `/auth/device/token` stores one. */
async function deviceToken(sqlite, email) {
  const account = sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
  const token = `mpt_${'ab'.repeat(24)}${email.length}`.slice(0, 52);
  sqlite
    .prepare('INSERT INTO personal_tokens (id, account_id, label, created_at) VALUES (?, ?, ?, ?)')
    .run(await sha256Hex(token), account.id, 'Maude on darwin', Date.now());
  return token;
}

const verify = (sqlite, email) =>
  sqlite
    .prepare('UPDATE accounts SET email_verified_at = ? WHERE email = ?')
    .run(Date.now(), email);

function createProject(token, body, key) {
  return new Request('https://cloud.test/api/projects', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cloudflareOk() {
  const calls = [];
  network.push([
    'api.cloudflare.com',
    async (url, init) => {
      calls.push({ url, method: init.method });
      return Response.json({ success: true, result: {} });
    },
  ]);
  return calls;
}

/** Stripe for one "Choose a plan" round trip: customer, session, completed return. */
function fakeChooseAPlanStripe() {
  const asked = [];
  network.unshift([
    'api.stripe.com',
    async (url, init) => {
      const body = Object.fromEntries(new URLSearchParams(init.body ?? ''));
      asked.push({ url, method: init.method ?? 'GET', body });
      if (url.endsWith('/v1/customers')) return Response.json({ id: 'cus_1' });
      if (url.endsWith('/v1/checkout/sessions')) {
        return Response.json({
          id: 'cs_test_9',
          url: 'https://checkout.stripe.com/pay/cs_test_9',
        });
      }
      if (url.includes('/v1/checkout/sessions/cs_test_9')) {
        return Response.json({
          id: 'cs_test_9',
          status: 'complete',
          customer: 'cus_1',
          subscription: 'sub_9',
          metadata: {
            project_id: 'zkusebni-tym',
            project_name: 'Zkušební tým',
            plan: 'project',
            convert: '1',
          },
        });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    },
  ]);
  return asked;
}

// ------------------------------------------------------------- the pure half

describe('the trial, as facts', () => {
  test('14 days, the number pricing.json advertises; one trial per verified e-mail', () => {
    const pricing = JSON.parse(readFileSync(new URL('./pricing.json', import.meta.url), 'utf8'));
    assert.equal(TRIAL_DAYS, 14);
    assert.equal(TRIAL_DAYS, pricing.trialDays);
    assert.equal(TRIALS_PER_VERIFIED_EMAIL, 1);
  });

  test('trialView: none before the first sign-in, days left during, ended after', () => {
    const t0 = Date.UTC(2026, 9, 1);
    assert.equal(trialView({ trial_started_at: null }, { now: t0 }).state, 'none');
    const during = trialView({ trial_started_at: t0 }, { now: t0 + 2 * DAY + 1 });
    assert.equal(during.state, 'trialing');
    assert.equal(during.daysLeft, 12);
    assert.equal(during.endsAt, t0 + 14 * DAY);
    const ended = trialView({ trial_started_at: t0 }, { now: t0 + 14 * DAY });
    assert.equal(ended.state, 'ended');
    assert.equal(ended.daysLeft, 0);
  });

  test('planState: only a TRIAL project without a subscription can pause', () => {
    const now = Date.UTC(2026, 9, 20);
    assert.equal(planState({ trial_ends_at: now + DAY, subscription_id: null }, { now }), 'trial');
    assert.equal(planState({ trial_ends_at: now - 1, subscription_id: null }, { now }), 'paused');
    assert.equal(planState({ trial_ends_at: now - 1, subscription_id: 'sub_1' }, { now }), 'paid');
    // A hand-provisioned or legacy row (no trial marker, no subscription) is
    // never paused by this — the trial clock is not a way to stop the pilot.
    assert.equal(planState({ trial_ends_at: null, subscription_id: null }, { now }), 'none');
  });

  test('decideAccess: a paused project still admits everyone, and says paused', () => {
    const now = Date.UTC(2026, 9, 20);
    const project = {
      account_id: 'acct_o',
      state: 'active',
      trial_ends_at: now - 1,
      subscription_id: null,
    };
    const members = [
      { account_id: 'acct_m', role: 'member' },
      { account_id: 'acct_v', role: 'viewer' },
    ];
    assert.deepEqual(decideAccess({ accountId: 'acct_o', project, members, now }), {
      ok: true,
      role: 'owner',
      paused: true,
    });
    assert.deepEqual(decideAccess({ accountId: 'acct_m', project, members, now }), {
      ok: true,
      role: 'member',
      paused: true,
    });
    // Before expiry the answer is byte-identical to today's.
    assert.deepEqual(decideAccess({ accountId: 'acct_v', project, members, now: now - 2 * DAY }), {
      ok: true,
      role: 'viewer',
    });
    assert.equal(decideAccess({ accountId: 'acct_x', project, members, now }).ok, false);
  });

  test('planRefusal: 402 plan; only the owner is told to choose a plan', () => {
    assert.deepEqual(planRefusal('owner'), {
      status: 402,
      body: { reason: 'plan', error: 'Choose a plan to keep editing.' },
    });
    for (const role of ['member', 'viewer', 'observer']) {
      const r = planRefusal(role);
      assert.equal(r.status, 402);
      assert.equal(r.body.reason, 'plan');
      assert.doesNotMatch(r.body.error, /plan|trial|billing|card|pay/i, role);
      assert.deepEqual(Object.keys(r.body).sort(), ['error', 'reason']);
    }
    assert.equal(ACCESS_MESSAGES.plan, 'Choose a plan to keep editing.');
  });

  test('decideTrialProvision: replay first, then the ended trial, then the rules', () => {
    const now = Date.UTC(2026, 9, 20);
    const fresh = { email_verified_at: now - DAY, trial_started_at: now - DAY };
    assert.equal(decideTrialProvision({ account: fresh, now }).outcome, 'provision');
    assert.equal(decideTrialProvision({ account: fresh, now }).trialEndsAt, now - DAY + 14 * DAY);
    // The same request, again: the SAME project, whatever else is now true.
    const replay = { id: 'zkusebni-tym' };
    assert.deepEqual(
      decideTrialProvision({ account: fresh, now: now + 30 * DAY, replay, claimsUsed: 1 }),
      { outcome: 'replay', project: replay }
    );
    const ended = { ...fresh, trial_started_at: now - 15 * DAY };
    assert.deepEqual(decideTrialProvision({ account: ended, now }), {
      outcome: 'refuse',
      status: 402,
      reason: 'plan',
      error: 'Choose a plan to keep editing.',
    });
    const unverified = { ...fresh, email_verified_at: null };
    const r = decideTrialProvision({ account: unverified, now });
    assert.equal(r.status, 403);
    assert.equal(r.reason, 'email-unverified');
    const used = decideTrialProvision({ account: fresh, now, claimsUsed: 1 });
    assert.equal(used.status, 402);
    assert.equal(used.reason, 'plan');
    assert.equal(decideTrialProvision({ account: fresh, now, nameTaken: true }).status, 409);
  });

  test('Choose a plan checkout: no second trial, converts the named project', () => {
    const params = checkoutSessionParams({
      projectId: 'zkusebni-tym',
      projectName: 'Zkušební tým',
      plan: 'project',
      priceId: 'price_x',
      trialDays: null,
      customerId: 'cus_1',
      origin: 'https://cloud.test',
      convert: true,
    });
    assert.equal('subscription_data[trial_period_days]' in params, false);
    assert.equal(params['metadata[convert]'], '1');
    assert.equal(params.cancel_url, 'https://cloud.test/projects/zkusebni-tym/billing');
    // The ordinary wizard keeps its advertised trial, byte for byte.
    const wizard = checkoutSessionParams({
      projectId: 'p-1',
      projectName: 'P',
      plan: 'project',
      priceId: 'price_x',
      trialDays: 14,
      customerId: 'cus_1',
      origin: 'https://cloud.test',
    });
    assert.equal(wizard['subscription_data[trial_period_days]'], '14');
    assert.equal('metadata[convert]' in wizard, false);
  });
});

// --------------------------------------------------------------- the routes

describe('a new account: the trial starts at the first sign-in, no Stripe object', () => {
  test('signup stamps trial_started_at and creates no customer', async () => {
    const { env, sqlite } = await freshEnv();
    const before = Date.now();
    assert.ok(await signUp(env));
    const row = sqlite
      .prepare('SELECT trial_started_at, stripe_customer_id FROM accounts WHERE email = ?')
      .get('founder@example.com');
    assert.ok(row.trial_started_at >= before, 'the trial started');
    assert.equal(row.stripe_customer_id, null);
    assert.equal(stripeCalls.length, 0);
  });

  test('a second sign-in keeps the FIRST start', async () => {
    const { env, sqlite } = await freshEnv();
    await signUp(env);
    sqlite.prepare('UPDATE accounts SET trial_started_at = 1000').run();
    await worker.fetch(
      new Request('https://cloud.test/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ email: 'founder@example.com', password: PASSWORD }),
      }),
      env
    );
    const row = sqlite.prepare('SELECT trial_started_at FROM accounts').get();
    assert.equal(row.trial_started_at, 1000);
  });
});

describe('POST /api/projects {name} — the trial-provisioned first project', () => {
  async function ready() {
    const { env, sqlite } = await freshEnv();
    await signUp(env);
    verify(sqlite, 'founder@example.com');
    const token = await deviceToken(sqlite, 'founder@example.com');
    return { env, sqlite, token };
  }

  test('needs the device token', async () => {
    const { env } = await ready();
    const res = await worker.fetch(createProject(null, { name: 'Zkušební tým' }), env);
    assert.equal(res.status, 401);
  });

  test('provisions without checkout and answers {project:{id,…}}', async () => {
    const { env, sqlite, token } = await ready();
    const cf = cloudflareOk();
    const res = await worker.fetch(createProject(token, { name: 'Zkušební tým' }, 'req-0001'), env);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.project.id, 'zkusebni-tym');
    assert.equal(body.project.name, 'Zkušební tým');
    assert.equal(body.project.state, 'active');
    assert.equal(body.project.role, 'owner');
    assert.equal(body.project.plan, 'trial');
    assert.equal(typeof body.project.trialEndsAt, 'number');
    assert.equal(body.project.url, 'https://zkusebni-tym.cloud.maude.sh');
    assert.equal(stripeCalls.length, 0, 'no Stripe object for a trial');
    assert.ok(cf.length >= 1, 'the address was routed');
    const row = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get('zkusebni-tym');
    assert.equal(row.subscription_id, null);
    assert.equal(row.trial_ends_at, body.project.trialEndsAt);
    // The project shows up where the desktop polls for it.
    const list = await (
      await worker.fetch(
        new Request('https://cloud.test/api/projects', {
          headers: { authorization: `Bearer ${token}` },
        }),
        env
      )
    ).json();
    assert.deepEqual(
      list.projects.map((p) => [p.id, p.state, p.role]),
      [['zkusebni-tym', 'active', 'owner']]
    );
  });

  test('idempotent: the same request id is the same project, never a second', async () => {
    const { env, sqlite, token } = await ready();
    cloudflareOk();
    const a = await worker.fetch(createProject(token, { name: 'Zkušební tým' }, 'req-0002'), env);
    const b = await worker.fetch(createProject(token, { name: 'Zkušební tým' }, 'req-0002'), env);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal((await b.json()).project.id, 'zkusebni-tym');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM trial_claims').get().n, 1);
    // A keyless retry of the same name is the same request too.
    const c = await worker.fetch(createProject(token, { name: 'Zkušební tým' }), env);
    assert.equal(c.status, 200);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
  });

  test('one trial workspace per verified e-mail: the second asks for a plan', async () => {
    const { env, sqlite, token } = await ready();
    cloudflareOk();
    await worker.fetch(createProject(token, { name: 'First one' }, 'req-0003'), env);
    const res = await worker.fetch(createProject(token, { name: 'Second one' }, 'req-0004'), env);
    assert.equal(res.status, 402);
    assert.deepEqual(await res.json(), {
      ok: false,
      reason: 'plan',
      error: 'Choose a plan to keep editing.',
    });
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
  });

  test('the claim outlives the account row: a new account on that address gets no trial', async () => {
    const { env, sqlite, token } = await ready();
    cloudflareOk();
    await worker.fetch(createProject(token, { name: 'First one' }, 'req-0005'), env);
    // What S9.16's delete leaves behind: the project is gone, the account row
    // is gone — the trial claim is keyed by the address's hash, not by them.
    sqlite.exec('PRAGMA foreign_keys = OFF');
    sqlite.prepare('DELETE FROM projects').run();
    sqlite.prepare('DELETE FROM personal_tokens').run();
    sqlite.prepare('DELETE FROM sessions').run();
    sqlite.prepare('DELETE FROM accounts').run();
    await signUp(env);
    verify(sqlite, 'founder@example.com');
    const again = await deviceToken(sqlite, 'founder@example.com');
    const res = await worker.fetch(createProject(again, { name: 'Again' }, 'req-0006'), env);
    assert.equal(res.status, 402);
  });

  test('an unverified address provisions nothing', async () => {
    const { env, sqlite } = await freshEnv();
    await signUp(env, 'new@example.com');
    const token = await deviceToken(sqlite, 'new@example.com');
    const res = await worker.fetch(createProject(token, { name: 'Zkušební tým' }, 'req-0007'), env);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'email-unverified');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
  });

  test('a taken name is 409 and spends no trial; a bad name is 400', async () => {
    const { env, sqlite, token } = await ready();
    cloudflareOk();
    sqlite
      .prepare(
        "INSERT INTO accounts (id, email, created_at) VALUES ('acct_other', 'o@example.com', 1)"
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES ('zkusebni-tym', 'acct_other', 'x', 'active', 1, 1)"
      )
      .run();
    const taken = await worker.fetch(
      createProject(token, { name: 'Zkušební tým' }, 'req-0008'),
      env
    );
    assert.equal(taken.status, 409);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM trial_claims').get().n, 0);
    const bad = await worker.fetch(createProject(token, { name: 'x' }, 'req-0009'), env);
    assert.equal(bad.status, 400);
    const ok = await worker.fetch(createProject(token, { name: 'Another name' }, 'req-0010'), env);
    assert.equal(ok.status, 201, 'the trial was not spent on the refusal');
  });

  test('an ended trial is 402 plan', async () => {
    const { env, sqlite, token } = await ready();
    sqlite.prepare('UPDATE accounts SET trial_started_at = ?').run(Date.now() - 15 * DAY);
    const res = await worker.fetch(createProject(token, { name: 'Late' }, 'req-0011'), env);
    assert.equal(res.status, 402);
    assert.equal((await res.json()).reason, 'plan');
  });
});

describe('at expiry: paused, not deleted; Choose a plan converts the same project', () => {
  async function expiredTrialProject() {
    const { env, sqlite } = await freshEnv();
    const session = await signUp(env);
    verify(sqlite, 'founder@example.com');
    const token = await deviceToken(sqlite, 'founder@example.com');
    cloudflareOk();
    await worker.fetch(createProject(token, { name: 'Zkušební tým' }, 'req-0100'), env);
    sqlite.prepare('UPDATE projects SET trial_ends_at = ?').run(Date.now() - 1);
    return { env, sqlite, session };
  }

  test('the expired trial project is still there, still active, now paused', async () => {
    const { sqlite } = await expiredTrialProject();
    const row = sqlite.prepare('SELECT * FROM projects').get();
    assert.equal(row.state, 'active');
    assert.equal(planState(row), 'paused');
    assert.equal(decideAccess({ accountId: row.account_id, project: row }).paused, true);
  });

  test('Choose a plan: Checkout with no trial, then the SAME project carries the subscription', async () => {
    const { env, sqlite, session } = await expiredTrialProject();
    const asked = fakeChooseAPlanStripe();
    const chosen = await worker.fetch(
      new Request('https://cloud.test/projects/zkusebni-tym/billing/plan', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `maude_session=${session}`,
        },
        body: form({ plan: 'project', interval: 'monthly' }),
      }),
      env
    );
    assert.equal(chosen.status, 303);
    assert.equal(chosen.headers.get('location'), 'https://checkout.stripe.com/pay/cs_test_9');
    const created = asked.find((c) => c.url.endsWith('/v1/checkout/sessions'));
    assert.equal(created.body['metadata[convert]'], '1');
    assert.equal(created.body['metadata[project_id]'], 'zkusebni-tym');
    assert.equal('subscription_data[trial_period_days]' in created.body, false);

    const back = await worker.fetch(
      new Request('https://cloud.test/checkout/return?project=zkusebni-tym&session_id=cs_test_9', {
        headers: { cookie: `maude_session=${session}` },
      }),
      env
    );
    assert.equal(back.status, 303);
    assert.equal(back.headers.get('location'), '/projects/zkusebni-tym/billing');
    const rows = sqlite.prepare('SELECT * FROM projects').all();
    assert.equal(rows.length, 1, 'converted, not duplicated');
    assert.equal(rows[0].subscription_id, 'sub_9');
    assert.equal(rows[0].state, 'active');
    assert.equal(planState(rows[0]), 'paid');
    const attempt = sqlite.prepare('SELECT * FROM checkout_attempts').get();
    assert.equal(attempt.payment, 'charged', 'never re-enters the provision-first void');
  });

  test('Choose a plan is the owner’s; a member gets the plain no-access page', async () => {
    const { env, sqlite } = await expiredTrialProject();
    const memberSession = await signUp(env, 'member@example.com');
    const member = sqlite
      .prepare("SELECT id FROM accounts WHERE email = 'member@example.com'")
      .get();
    sqlite
      .prepare(
        "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('zkusebni-tym', ?, 'member', 1)"
      )
      .run(member.id);
    const res = await worker.fetch(
      new Request('https://cloud.test/projects/zkusebni-tym/billing/plan', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `maude_session=${memberSession}`,
        },
        body: form({ plan: 'project', interval: 'monthly' }),
      }),
      env
    );
    assert.equal(res.status, 404);
    assert.equal(stripeCalls.length, 0);
  });
});

// ------------------------------------------------- S9.15b: the cell learns it
//
// Env applies only at container START, so the control plane tells the cell its
// plan state in `/internal/cell-config` and restarts a running cell exactly
// when that state flips (trial → paused at expiry, paused → paid on Choose a
// plan). A restart of a sleeping cell is a no-op on the data plane.

describe('S9.15b: the cell is told, and restarted only on a flip', () => {
  const MASTER = 'a-cell-master';
  const ZONE = 'cells.test';

  /** The project's own cell, faked: records restarts, answers health. */
  function fakeCell() {
    const restarts = [];
    network.unshift([
      `.${ZONE}/`,
      async (url, init) => {
        if (url.endsWith('/_cell/restart')) {
          restarts.push({ url, auth: init.headers?.authorization ?? null });
          return Response.json({ restarted: true });
        }
        return Response.json({ ok: true });
      },
    ]);
    return restarts;
  }

  async function trialProject({ expired }) {
    const { env, sqlite } = await freshEnv();
    Object.assign(env, { CELL_SECRET_MASTER: MASTER, CELL_ZONE: ZONE });
    const session = await signUp(env);
    verify(sqlite, 'founder@example.com');
    const token = await deviceToken(sqlite, 'founder@example.com');
    cloudflareOk();
    const restarts = fakeCell();
    await worker.fetch(createProject(token, { name: 'Zkušební tým' }, 'req-0200'), env);
    if (expired) sqlite.prepare('UPDATE projects SET trial_ends_at = ?').run(Date.now() - 1);
    restarts.length = 0; // provisioning's own traffic is not under test
    return { env, sqlite, session, restarts };
  }

  async function cellConfig(env, tenant = 'zkusebni-tym') {
    const res = await worker.fetch(
      new Request(`https://cloud.test/internal/cell-config?tenant=${tenant}`, {
        headers: { authorization: `Bearer ${await deriveCellSecret(MASTER, tenant)}` },
      }),
      env
    );
    return res.json();
  }

  test('/internal/cell-config carries planState: trial, then paused', async () => {
    const live = await trialProject({ expired: false });
    assert.equal((await cellConfig(live.env)).planState, 'trial');
    const over = await trialProject({ expired: true });
    const config = await cellConfig(over.env);
    assert.equal(config.planState, 'paused');
    assert.equal(config.projectName, 'Zkušební tým', 'the rest of the answer is unchanged');
  });

  test('a pre-v19 D1 still hands the cell its seed repo (the plan read is its own query)', async () => {
    const { env, sqlite } = await trialProject({ expired: false });
    sqlite.prepare("UPDATE projects SET seed_repo = 'https://example.test/seed.git'").run();
    sqlite.exec('ALTER TABLE projects DROP COLUMN trial_ends_at');
    const config = await cellConfig(env);
    assert.equal(config.seedRepo, 'https://example.test/seed.git');
    assert.equal(config.projectName, 'Zkušební tým');
    assert.equal(config.planState, 'none');
  });

  test('a trial project is not an illegal transition — no hourly customer-visible alert', async () => {
    const { env, sqlite } = await trialProject({ expired: false });
    const row = sqlite.prepare('SELECT * FROM projects').get();
    assert.equal(typeof tenantFromRow(row).trialEndsAt, 'number');
    const result = reconcile(tenantFromRow(row), null);
    assert.deepEqual(result.actions, []);
    assert.equal(result.desiredState, 'active');
    await reconcileSweep(env);
    await reconcileSweep(env);
    const alerts = sqlite
      .prepare("SELECT * FROM audit_log WHERE detail LIKE '%illegal-transition%'")
      .all();
    assert.deepEqual(alerts, []);
    assert.equal(sqlite.prepare('SELECT state FROM projects').get().state, 'active');
  });

  test('a non-trial row with no subscription keeps today’s reconcile answer', () => {
    const tenant = tenantFromRow({ id: 'p', state: 'active', state_since: 0 });
    assert.equal(tenant.trialEndsAt, null);
    const result = reconcile(tenant, null);
    assert.ok(result.actions.some((a) => a.reason === 'illegal-transition'));
    // A converted trial whose subscription vanished at Stripe still alerts.
    const converted = tenantFromRow({
      id: 'p',
      state: 'active',
      state_since: 0,
      trial_ends_at: 1,
      subscription_id: 'sub_gone',
    });
    assert.ok(
      reconcile(converted, null).actions.some((a) => a.reason === 'illegal-transition'),
      'the trial exemption ends at Choose a plan'
    );
  });

  test('the sweep restarts the cell once when its trial runs out — no storm', async () => {
    const { env, sqlite, restarts } = await trialProject({ expired: true });
    await reconcileSweep(env);
    assert.equal(restarts.length, 1, 'restarted at the flip');
    assert.equal(restarts[0].url, `https://zkusebni-tym.${ZONE}/_cell/restart`);
    assert.equal(restarts[0].auth, `Bearer ${await deriveCellSecret(MASTER, 'zkusebni-tym')}`);
    await reconcileSweep(env);
    await reconcileSweep(env);
    assert.equal(restarts.length, 1, 'the next hours do nothing');
    const audited = sqlite
      .prepare("SELECT action FROM audit_log WHERE action = 'do.plan-paused'")
      .all();
    assert.equal(audited.length, 1);
  });

  test('inside the trial the sweep restarts nothing', async () => {
    const live = await trialProject({ expired: false });
    await reconcileSweep(live.env);
    assert.equal(live.restarts.length, 0);
  });

  test('a restart that fails is tried again next hour, and recorded only once it lands', async () => {
    const { env, sqlite, restarts } = await trialProject({ expired: true });
    network.unshift([`.${ZONE}/_cell/restart`, async () => new Response('busy', { status: 503 })]);
    await reconcileSweep(env);
    assert.equal(restarts.length, 0);
    const count = () =>
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'do.plan-paused'").get().n;
    assert.equal(count(), 0);
    network.shift();
    await reconcileSweep(env);
    assert.equal(restarts.length, 1);
    assert.equal(count(), 1);
  });

  test('Choose a plan on a paused project restarts its cell; inside the trial it does not', async () => {
    for (const expired of [true, false]) {
      const { env, session, restarts } = await trialProject({ expired });
      fakeChooseAPlanStripe();
      await worker.fetch(
        new Request('https://cloud.test/projects/zkusebni-tym/billing/plan', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            cookie: `maude_session=${session}`,
          },
          body: form({ plan: 'project', interval: 'monthly' }),
        }),
        env
      );
      const back = () =>
        worker.fetch(
          new Request(
            'https://cloud.test/checkout/return?project=zkusebni-tym&session_id=cs_test_9',
            { headers: { cookie: `maude_session=${session}` } }
          ),
          env
        );
      assert.equal((await back()).status, 303);
      assert.equal(restarts.length, expired ? 1 : 0, `expired=${expired}`);
      // A refreshed return page converts nothing twice and restarts nothing twice.
      await back();
      assert.equal(restarts.length, expired ? 1 : 0, `refresh, expired=${expired}`);
      assert.equal((await cellConfig(env)).planState, 'paid');
    }
  });
});
