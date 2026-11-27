// What a REAL browser does that a test's bare `fetch` does not — the four
// findings of the local end-to-end run (scripts/dev/admin-e2e/cloud-scenarios.mjs,
// 2026-11-24). Each of these was green in the route tests and broken in Chromium.
//
//   1. Our pages are `referrer-policy: no-referrer`, so a same-origin form POST
//      carries `Origin: null`. The CSRF gate refused it.
//   2. `form-action` applies to the redirect chain. A page that set its own
//      CSP with `form-action 'self'` blocked its own 303 to Stripe.
//   3. `settle()` dropped the debounce clock, so a cancelled subscription never
//      suspended.
//   4. The People pages offered Can view, which no cell holds yet; and the
//      control plane minted a project token for a project an operator paused.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sha256Hex } from './accounts.mjs';
import {
  addMember,
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
import { formActionPermits, pageCsp, sameOriginPost } from './edge.mjs';
import { planState } from './project-access.mjs';
import { SUSPEND_DEBOUNCE_MS, settle } from './reconcile.mjs';
import worker, { reconcileSweep } from './worker.mjs';

async function world(t) {
  const net = installNetwork(t);
  const { env, sqlite } = await freshEnv();
  const op = await makeOperator(env, sqlite);
  const jan = await signUp(env, sqlite, 'jan@kolar.studio');
  bind(env, op, jan);
  net.mails.length = 0;
  return { net, env, sqlite, op, jan };
}

function fakeStripe(net, { subscriptions = {} } = {}) {
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
        return Response.json({
          id: 'cs_test_1',
          url: 'https://checkout.stripe.com/c/pay/cs_test_1',
        });
      }
      if (url.endsWith('/v1/billing_portal/sessions')) {
        return Response.json({ url: 'https://billing.stripe.com/p/session/bps_1' });
      }
      return Response.json({ data: [] });
    },
  ]);
}

// ------------------------------------------------------- 1. Origin: null

/** The header sets each engine sends on a same-origin form POST from a no-referrer page. */
const BROWSERS = {
  // Chromium 120+: Origin is `null` under no-referrer; Fetch Metadata is always sent.
  chromium: {
    origin: 'null',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'sec-fetch-user': '?1',
  },
  // Firefox 90+: the same two facts.
  firefox: {
    origin: 'null',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'sec-fetch-user': '?1',
  },
  // Safari 16.4+: Origin `null`, Fetch Metadata present.
  safari: {
    origin: 'null',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
  },
};
/** A sandboxed or cross-site frame also says `Origin: null` — and says where it is. */
const HOSTILE = {
  'sandboxed cross-site iframe': { origin: 'null', 'sec-fetch-site': 'cross-site' },
  'sibling subdomain (a project’s own pages)': { origin: 'null', 'sec-fetch-site': 'same-site' },
  'another origin, stated': { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  'Origin null with no Fetch Metadata at all': { origin: 'null' },
};

describe('1 · a same-origin form POST from a no-referrer page (Origin: null)', () => {
  test('sameOriginPost: null counts as "not stated" only beside Sec-Fetch-Site: same-origin', () => {
    const url = new URL(`${ORIGIN}/account/people`);
    const ask = (headers) => sameOriginPost(new Request(url, { method: 'POST', headers }), url);
    for (const [name, headers] of Object.entries(BROWSERS)) assert.equal(ask(headers), true, name);
    for (const [name, headers] of Object.entries(HOSTILE)) assert.equal(ask(headers), false, name);
    assert.equal(ask({}), true, 'no Origin at all: the desktop app, curl');
    assert.equal(ask({ origin: ORIGIN }), true, 'the page’s own origin, stated');
  });

  for (const [name, headers] of Object.entries(BROWSERS)) {
    test(`${name}: /account/people, Choose a plan and Send again are accepted`, async (t) => {
      const { net, env, sqlite, jan } = await world(t);
      const anna = await signUp(env, sqlite, 'anna@example.com');
      fakeStripe(net);
      seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
      addMember(sqlite, 'kolar-web', anna.id, 'viewer');
      sqlite
        .prepare(
          `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at)
           VALUES ('inv-a', 'kolar-web', 'radek@alligators.cz', 'member', ?, ?)`
        )
        .run(Date.now(), Date.now() + 5 * DAY);
      const opts = { csrf: 'account', headers };
      const role = await post(
        '/account/people',
        jan,
        { do: 'role', project: 'kolar-web', account: anna.id, role: 'member' },
        opts
      );
      assert.equal(role.status, 303);
      const again = await post(
        '/projects/kolar-web/people',
        jan,
        { do: 'invite-resend', invite: 'inv-a' },
        opts
      );
      assert.equal(again.status, 200);
      const plan = await post(
        '/projects/kolar-web/billing/plan',
        jan,
        { plan: 'project', interval: 'monthly' },
        opts
      );
      assert.equal(plan.status, 303);
      assert.match(plan.headers.get('location'), /^https:\/\/checkout\.stripe\.com\//);
    });
  }

  test('the token is still required, and a hostile Origin: null is still refused', async (t) => {
    const { env, sqlite, jan } = await world(t);
    const anna = await signUp(env, sqlite, 'anna@example.com');
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    addMember(sqlite, 'kolar-web', anna.id, 'viewer');
    const fields = { do: 'remove', project: 'kolar-web', account: anna.id };
    const noToken = await post('/account/people', jan, fields, {
      csrf: null,
      headers: BROWSERS.chromium,
    });
    assert.equal(noToken.status, 403);
    for (const [name, headers] of Object.entries(HOSTILE)) {
      const res = await post('/account/people', jan, fields, { csrf: 'account', headers });
      assert.equal(res.status, 403, name);
    }
    assert.ok(sqlite.prepare("SELECT 1 FROM project_members WHERE project_id = 'kolar-web'").get());
  });

  test('the operator’s forms are accepted from a browser too', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    const res = await post(
      '/operator/projects/kolar-web/promo',
      op,
      { tier: 'project', ends: '', reason: 'a friend' },
      { headers: BROWSERS.chromium }
    );
    assert.equal(res.status, 303);
    assert.equal(planState(project(sqlite, 'kolar-web')), 'promo');
  });
});

// ------------------------------------------------ 2. form-action and Stripe

const formActionOf = (res) =>
  /form-action ([^;]+)/.exec(res.headers.get('content-security-policy') ?? '')?.[1] ?? '';

describe('2 · every page whose form ends at Stripe allows Stripe in form-action', () => {
  test('pageCsp: Stripe only when asked; never a wildcard', () => {
    assert.match(pageCsp(), /form-action 'self';/);
    assert.match(
      pageCsp({ stripe: true }),
      /form-action 'self' https:\/\/checkout\.stripe\.com https:\/\/billing\.stripe\.com;/
    );
    for (const csp of [pageCsp(), pageCsp({ stripe: true })]) {
      assert.match(csp, /default-src 'none'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /base-uri 'none'/);
      assert.doesNotMatch(csp, /\*/);
    }
  });

  test('walk: each route that 303s to a Stripe host, and the page that hosts its form', async (t) => {
    const { net, sqlite, jan } = await world(t);
    fakeStripe(net);
    sqlite.prepare("UPDATE accounts SET stripe_customer_id = 'cus_1' WHERE id = ?").run(jan.id);
    seedProject(sqlite, { id: 'trial-p', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    seedProject(sqlite, { id: 'paid-p', owner: jan.id, subscription: 'sub_1' });
    seedProject(sqlite, {
      id: 'lapsed-p',
      owner: jan.id,
      subscription: 'sub_2',
      state: 'suspended',
      cellRunning: 0,
    });

    // [the POST, its fields, the token it needs, the page that renders its form]
    const HANDOFFS = [
      [
        '/projects/new',
        { name: 'A new one', plan: 'project', interval: 'monthly' },
        null,
        '/projects/new',
      ],
      [
        '/projects/trial-p/billing/plan',
        { plan: 'project', interval: 'monthly' },
        'account',
        '/account/billing',
      ],
      ['/projects/paid-p/billing/portal', {}, null, '/projects/paid-p/billing'],
      ['/projects/lapsed-p/billing/portal', {}, null, '/projects/lapsed-p/billing'],
    ];
    let walked = 0;
    for (const [action, fields, csrf, pagePath] of HANDOFFS) {
      const res = await post(action, jan, fields, { csrf });
      assert.equal(res.status, 303, action);
      const location = res.headers.get('location');
      assert.match(location, /^https:\/\/(checkout|billing)\.stripe\.com\//, action);
      assert.ok(formActionPermits(location), `${location} is a host the plane names`);

      const page = await get(pagePath, jan);
      assert.equal(page.status, 200, pagePath);
      const html = await page.text();
      assert.ok(html.includes(`action="${action}"`), `${pagePath} hosts the form for ${action}`);
      const allowed = formActionOf(page).split(/\s+/);
      assert.ok(
        allowed.includes(new URL(location).origin),
        `${pagePath} must allow ${new URL(location).origin} in form-action; it says: ${formActionOf(page)}`
      );
      walked += 1;
    }
    assert.equal(walked, HANDOFFS.length);
  });

  test("a page that never leaves the origin keeps form-action 'self'", async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'trial-p', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    for (const [path, who] of [
      ['/account/people', jan],
      ['/account/macs', jan],
      ['/projects/trial-p/people', jan],
      ['/projects/trial-p/audit', jan],
      ['/operator/accounts', op],
    ]) {
      assert.equal(formActionOf(await get(path, who)).trim(), "'self'", path);
    }
  });
});

// ------------------------------------------------- 3. the debounce clock

describe('3 · a subscription that ends while the project runs does suspend it', () => {
  const T0 = Date.UTC(2026, 10, 1);
  const H = 3_600_000;
  const base = {
    id: 'p',
    state: 'active',
    stateSince: T0 - 30 * DAY,
    cellRunning: true,
    exportSent: false,
    adverseSince: null,
    trialEndsAt: null,
    subscriptionId: 'sub_1',
    promo: false,
    holdSince: null,
  };

  test('settle() keeps the clock: started at the first adverse sweep, cleared by a good one', () => {
    const first = settle(base, { status: 'canceled' }, { now: T0 });
    assert.equal(first.tenant.state, 'active');
    assert.equal(first.tenant.adverseSince, T0, 'started now — never back-dated');
    assert.deepEqual(first.actions, [], 'and nothing is DONE on the first reading');
    const wobble = settle(first.tenant, { status: 'active' }, { now: T0 + H });
    assert.equal(wobble.tenant.adverseSince, null, 'one good reading forgets it');
    let t = base;
    for (let h = 0; h * H < SUSPEND_DEBOUNCE_MS; h++) {
      t = settle(t, { status: 'canceled' }, { now: T0 + h * H }).tenant;
      assert.equal(t.state, 'active', `hour ${h}: still inside the debounce`);
    }
    t = settle(t, { status: 'canceled' }, { now: T0 + SUSPEND_DEBOUNCE_MS }).tenant;
    assert.equal(t.state, 'suspended');
  });

  test('a mixed fleet after a day of hourly sweeps ends in exactly the expected states', async (t) => {
    const { net, env, sqlite, jan } = await world(t);
    const now = Date.now();
    fakeStripe(net, {
      subscriptions: {
        sub_ok: { status: 'active' },
        sub_gone: { status: 'canceled' },
        sub_unpaid: { status: 'unpaid' },
        sub_held: { status: 'canceled' },
        sub_stale: { status: 'canceled' },
      },
    });
    seedProject(sqlite, { id: 'paid-ok', owner: jan.id, subscription: 'sub_ok' });
    seedProject(sqlite, { id: 'paid-gone', owner: jan.id, subscription: 'sub_gone' });
    seedProject(sqlite, { id: 'paid-unpaid', owner: jan.id, subscription: 'sub_unpaid' });
    seedProject(sqlite, { id: 'promo', owner: jan.id, promoSince: now, promoTier: 'project' });
    seedProject(sqlite, {
      id: 'held',
      owner: jan.id,
      subscription: 'sub_held',
      state: 'suspended',
      holdSince: now,
      cellRunning: 0,
    });
    seedProject(sqlite, { id: 'free-time', owner: jan.id, trialEndsAt: now + 60 * DAY });
    seedProject(sqlite, { id: 'trial', owner: jan.id, trialEndsAt: now + 3 * DAY });
    const before = (id) => JSON.stringify(project(sqlite, id));
    const untouched = Object.fromEntries(
      ['promo', 'held', 'free-time', 'trial', 'paid-ok'].map((id) => [id, before(id)])
    );

    // The first sweep after the fix is deployed.
    await reconcileSweep(env, { now });
    assert.equal(
      project(sqlite, 'paid-gone').state,
      'active',
      'nothing is torn down on the first sweep'
    );
    assert.equal(project(sqlite, 'paid-gone').adverse_since, now, 'the clock starts at THIS sweep');
    assert.equal(net.mails.length, 0);
    const noted = auditRows(sqlite, 'reconcile.adverse-noted');
    assert.deepEqual(noted.map((r) => r.project_id).sort(), ['paid-gone']);

    for (let h = 1; h <= 24; h++) await reconcileSweep(env, { now: now + h * H });

    const states = Object.fromEntries(
      sqlite
        .prepare('SELECT id, state FROM projects')
        .all()
        .map((r) => [r.id, r.state])
    );
    assert.deepEqual(states, {
      'paid-ok': 'active',
      'paid-gone': 'suspended', // canceled, past the six-hour debounce
      'paid-unpaid': 'past_due', // a failing card has its own 14-day grace
      promo: 'active',
      held: 'suspended', // the operator's, not the ladder's
      'free-time': 'active',
      trial: 'active',
    });
    for (const [id, was] of Object.entries(untouched))
      assert.equal(before(id), was, `${id} was not touched`);
    // The ordinary ladder ran in full for the one that ended: suspended once,
    // the copy and the notice once, and nothing near a deletion.
    const gone = project(sqlite, 'paid-gone');
    assert.ok(gone.state_since >= now + SUSPEND_DEBOUNCE_MS);
    assert.equal(
      auditRows(sqlite, 'do.suspend-cell').filter((r) => r.project_id === 'paid-gone').length,
      1
    );
    assert.equal(
      auditRows(sqlite, 'do.send-export').filter((r) => r.project_id === 'paid-gone').length,
      1
    );
    assert.equal(auditRows(sqlite, 'do.warn-deletion').length, 0);
    assert.equal(auditRows(sqlite, 'do.purge-data').length, 0);
    assert.equal(
      auditRows(sqlite, 'do.send-export').filter((r) => r.project_id === 'held').length,
      0
    );
    assert.ok(
      sqlite
        .prepare("SELECT 1 FROM audit_log WHERE project_id = 'paid-gone' AND action = 'reconcile'")
        .get(),
      'the transition itself is in the log'
    );
  });

  test('a clock left behind by the old code is never used: migration v22 clears it before the first sweep', async (t) => {
    const { net, env, sqlite, jan } = await world(t);
    const { MIGRATIONS, applySchema } = await import('./migrate.mjs');
    const { SCHEMA_SQL } = await import('./schema.mjs');
    const v22 = MIGRATIONS.find((m) => m.version === 22);
    assert.ok(v22, 'v22 exists');
    const now = Date.now();
    fakeStripe(net, { subscriptions: { sub_gone: { status: 'canceled' } } });
    seedProject(sqlite, { id: 'paid-gone', owner: jan.id, subscription: 'sub_gone' });
    // As production would be: a months-old clock on a row, and v22 not applied yet.
    sqlite
      .prepare("UPDATE projects SET adverse_since = ? WHERE id = 'paid-gone'")
      .run(now - 90 * DAY);
    // The statement the cron runs once, before its first sweep on the new code.
    assert.equal(v22.atomic, true);
    sqlite.exec(v22.statements[0]);
    await applySchema(env.DB, SCHEMA_SQL); // and the list still applies cleanly
    assert.equal(project(sqlite, 'paid-gone').adverse_since, null);
    await reconcileSweep(env, { now });
    assert.equal(project(sqlite, 'paid-gone').state, 'active', 'not suspended on stale history');
    assert.equal(project(sqlite, 'paid-gone').adverse_since, now);
  });
});

// ------------------------------------------- 4. roles the cell holds · held

describe('4 · only what the project’s workspace can hold is offered', () => {
  /** What the workspace last reported, as the sweep stores it (D1 v22). */
  const withCapabilities = (sqlite, capabilities) =>
    sqlite
      .prepare('UPDATE projects SET capabilities = ?')
      .run(capabilities ? JSON.stringify(capabilities) : null);

  test('no roles-v2: Can view is not offered on the People pages, with one line saying why', async (t) => {
    const { env, sqlite, jan } = await world(t);
    const anna = await signUp(env, sqlite, 'anna@example.com');
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    withCapabilities(sqlite, null);
    addMember(sqlite, 'kolar-web', anna.id, 'viewer');
    for (const path of ['/projects/kolar-web/people', '/account/people']) {
      const html = await (await get(path, jan)).text();
      assert.doesNotMatch(html, /<option value="observer"/, path);
      assert.match(html, /<option value="viewer"/, path);
      assert.match(text(html), /Can view is not available/, path);
    }
  });

  test('no roles-v2: the server refuses Can view too — an invitation and a role change', async (t) => {
    const { net, env, sqlite, jan } = await world(t);
    const anna = await signUp(env, sqlite, 'anna@example.com');
    net.mails.length = 0;
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    withCapabilities(sqlite, null);
    addMember(sqlite, 'kolar-web', anna.id, 'viewer');
    const invite = await post(
      '/projects/kolar-web/people',
      jan,
      { do: 'invite', email: 'new@example.com', role: 'observer' },
      { csrf: null }
    );
    assert.equal(invite.status, 400);
    assert.match(text(await invite.text()), /Can view is not available/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM project_invites').get().n, 0);
    assert.equal(net.mails.length, 0);
    const onProject = await post(
      '/projects/kolar-web/people',
      jan,
      { do: 'role', account: anna.id, role: 'observer' },
      { csrf: null }
    );
    assert.equal(onProject.status, 400);
    const onAccount = await post(
      '/account/people',
      jan,
      { do: 'role', project: 'kolar-web', account: anna.id, role: 'observer' },
      { csrf: 'account' }
    );
    assert.equal(onAccount.status, 400);
    assert.equal(
      sqlite.prepare('SELECT role FROM project_members WHERE account_id = ?').get(anna.id).role,
      'viewer'
    );
  });

  test('with roles-v2: Can view is offered and accepted', async (t) => {
    const { sqlite, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    withCapabilities(sqlite, ['roles-v2']);
    const html = await (await get('/projects/kolar-web/people', jan)).text();
    assert.match(html, /<option value="observer"/);
    assert.doesNotMatch(text(html), /Can view is not available/);
    const invite = await post(
      '/projects/kolar-web/people',
      jan,
      { do: 'invite', email: 'new@example.com', role: 'observer' },
      { csrf: null }
    );
    assert.equal(invite.status, 200);
    assert.equal(sqlite.prepare('SELECT role FROM project_invites').get().role, 'observer');
  });

  test('someone who already is Can view keeps reading Can view', async (t) => {
    const { env, sqlite, jan } = await world(t);
    const anna = await signUp(env, sqlite, 'anna@example.com');
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    withCapabilities(sqlite, null);
    addMember(sqlite, 'kolar-web', anna.id, 'observer');
    const html = await (await get('/projects/kolar-web/people', jan)).text();
    assert.match(html, /class="ma-mrole">Can view/);
  });

  test('the hourly sweep records what the workspace says it holds — and a silent one changes nothing', async (t) => {
    const { net, env, sqlite, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    net.routes.unshift([
      '/health',
      async () => Response.json({ ok: true, capabilities: ['roles-v2', 'x'] }),
    ]);
    await reconcileSweep(env);
    assert.equal(project(sqlite, 'kolar-web').capabilities, '["roles-v2","x"]');
    net.routes.shift();
    net.routes.unshift(['/health', async () => Response.json({ state: 'asleep' })]);
    await reconcileSweep(env);
    assert.equal(project(sqlite, 'kolar-web').capabilities, '["roles-v2","x"]');
    assert.match(
      await (await get('/projects/kolar-web/people', jan)).text(),
      /<option value="observer"/
    );
  });

  test('a project an operator paused: no project token, for the owner or anyone, with the paused message', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const anna = await signUp(env, sqlite, 'anna@example.com');
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    addMember(sqlite, 'kolar-web', anna.id, 'member');
    const open = (who) =>
      worker.fetch(
        new Request(`${ORIGIN}/projects/open`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `maude_session=${who.session}` },
          body: JSON.stringify({ project: 'kolar-web' }),
        }),
        env
      );
    assert.equal((await open(jan)).status, 200, 'before the pause it opens');
    await post('/operator/projects/kolar-web/pause', op, { reason: 'checking a report' });
    for (const who of [jan, anna]) {
      const res = await open(who);
      const body = await res.json();
      assert.notEqual(res.status, 200);
      assert.equal(body.token, undefined);
      assert.match(body.error, /paused/i);
    }
    // The browser door (the handoff) refuses the same way.
    const token = `mpt_${'cd'.repeat(24)}`;
    sqlite
      .prepare(
        'INSERT INTO personal_tokens (id, account_id, label, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(await sha256Hex(token), jan.id, 'Mac', Date.now());
    const { mintHandoffCode } = await import('./handoff.mjs');
    const minted = await mintHandoffCode(env, { account: jan, projectId: 'kolar-web' });
    assert.equal(minted.ok, false);
    await post('/operator/projects/kolar-web/wake', op, { reason: 'all clear' });
    assert.equal((await open(jan)).status, 200, 'after the wake it opens again');
  });
});

// --------------------------------------- the hand-made pilot row (production)

describe('a legacy pilot — active, no subscription, no trial, no Promo, no hold — is never adverse', () => {
  test('exactly production’s row, stale clock and all: 48 hourly sweeps change nothing and say nothing', async (t) => {
    const { net, env, sqlite, jan } = await world(t);
    const now = Date.now();
    seedProject(sqlite, { id: 'pilot', owner: jan.id, name: 'Pilot', stateSince: now - 200 * DAY });
    // As the pre-deploy check found it: a clock the old code left behind.
    sqlite.prepare("UPDATE projects SET adverse_since = ? WHERE id = 'pilot'").run(now - 120 * DAY);
    assert.equal(planState(project(sqlite, 'pilot')), 'none');
    // What the deploy does first: v22, before any sweep.
    const { MIGRATIONS } = await import('./migrate.mjs');
    sqlite.exec(MIGRATIONS.find((m) => m.version === 22).statements[0]);
    const before = JSON.stringify(project(sqlite, 'pilot'));
    const auditBefore = sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;

    for (let h = 0; h < 48; h++) {
      const outcomes = await reconcileSweep(env, { now: now + h * 3_600_000 });
      const mine = outcomes.find((o) => o.projectId === 'pilot');
      assert.equal(mine.outcome, 'ok');
      assert.deepEqual(mine.actions, [], `hour ${h}: nothing to do`);
    }
    assert.equal(
      JSON.stringify(project(sqlite, 'pilot')),
      before,
      'the row is byte-for-byte what it was'
    );
    assert.equal(project(sqlite, 'pilot').state, 'active');
    assert.equal(
      project(sqlite, 'pilot').adverse_since,
      null,
      'and it is never counted toward a pause'
    );
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n,
      auditBefore,
      'no log row, any hour'
    );
    assert.equal(net.mails.length, 0);
    assert.equal(net.stripe.length, 0, 'nothing to ask Stripe about');
  });

  test('the hole stays shut: a subscription on the row that Stripe no longer has still alerts, and a cancelled one still suspends', () => {
    const T0 = Date.UTC(2026, 10, 1);
    const row = {
      id: 'p',
      state: 'active',
      stateSince: T0 - 30 * DAY,
      cellRunning: true,
      exportSent: false,
      adverseSince: null,
      trialEndsAt: null,
      subscriptionId: 'sub_1',
      promo: false,
      holdSince: null,
    };
    const vanished = settle(row, null, { now: T0 });
    assert.ok(
      vanished.actions.some((a) => a.kind === 'alert'),
      'a vanished subscription is not a pilot'
    );
    let t = row;
    for (let h = 0; h <= 7; h++)
      t = settle(t, { status: 'canceled' }, { now: T0 + h * 3_600_000 }).tenant;
    assert.equal(t.state, 'suspended');
    // And a pilot that is NOT running is not swept back to life by this rule.
    const pending = settle(
      { ...row, subscriptionId: null, state: 'pending', cellRunning: false },
      null,
      { now: T0 }
    );
    assert.equal(pending.tenant.state, 'pending');
  });
});
