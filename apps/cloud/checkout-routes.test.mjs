// The wizard → Checkout → waiting room round trip — Cloud Phase 14 (DDR-203).
//
// Same posture as the other route suites: real SQLite behind the D1 shape,
// real Requests through the live worker. Stripe, the Cloudflare API, and the
// cell's /health are the network — they are faked at globalThis.fetch, and
// the fake records what was asked of it so the tests can assert the ORDER of
// effects, which is the whole point of this phase.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, test } from 'node:test';

import { allCheckoutHtml, newProjectPage } from './checkout-pages.mjs';
import { d1FromSqlite } from './db.mjs';
import { formActionPermits } from './edge.mjs';
import { applySchema } from './migrate.mjs';
import { loadPricing } from './pricing.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const PASSWORD = 'a-long-enough-password';
const realFetch = globalThis.fetch;

/** A scriptable network. Each key is a substring of the URL. */
let network;
before(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    for (const [needle, handler] of network) {
      if (url.includes(needle)) return handler(url, init);
    }
    return realFetch(input, init);
  };
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  network = [];
});

async function freshEnv(extra = {}) {
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
      ...extra,
    },
    sqlite,
  };
}

function form(fields) {
  return new URLSearchParams(fields).toString();
}

async function signedIn(env) {
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email: 'founder@example.com', password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  return /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
}

function post(path, session, fields) {
  return new Request(`https://cloud.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `maude_session=${session}`,
    },
    body: form(fields),
  });
}

function get(path, session) {
  return new Request(`https://cloud.test${path}`, {
    headers: session ? { cookie: `maude_session=${session}` } : {},
  });
}

/** 28 August 2030, as Stripe would report a period end (seconds). In the
 *  FUTURE on purpose: the cancel page shows max(period end, now), so a fixed
 *  date that became the past silently turned into "today" (2026-09). */
const PERIOD_END_S = Math.floor(Date.UTC(2030, 7, 28, 12, 0, 0) / 1000);

/** The standard Stripe fake for a happy checkout. Returns the recorded calls. */
function stripeHappy({ invoices = [] } = {}) {
  const calls = [];
  // Mutable Stripe-side state, so the billing surfaces can be driven as a
  // sequence (cancel → read it back → resume) rather than one call at a time.
  let subscriptionCancelling = false;
  let customerOnFile = { id: 'cus_1', name: '', address: {} };
  let taxIds = [];
  const invoicesOnFile = invoices;
  network.push([
    'api.stripe.com',
    async (url, init) => {
      const body = Object.fromEntries(new URLSearchParams(init.body ?? ''));
      calls.push({ url, method: init.method ?? 'GET', body });
      if (url.endsWith('/v1/customers')) {
        return Response.json({ id: 'cus_1' });
      }
      if (url.endsWith('/v1/checkout/sessions')) {
        return Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' });
      }
      if (url.includes('/v1/checkout/sessions/cs_test_1')) {
        return Response.json({
          id: 'cs_test_1',
          status: 'complete',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { project_id: 'zkusebni-tym', project_name: 'Zkušební tým', plan: 'project' },
        });
      }
      if (url.includes('/v1/subscriptions/sub_1') && init.method === 'DELETE') {
        return Response.json({ id: 'sub_1', status: 'canceled' });
      }
      if (url.includes('/v1/subscriptions/sub_1')) {
        // POST toggles cancel_at_period_end; GET reads it back.
        if (init.method === 'POST') subscriptionCancelling = body.cancel_at_period_end === 'true';
        return Response.json({
          id: 'sub_1',
          status: 'active',
          cancel_at_period_end: subscriptionCancelling,
          current_period_end: PERIOD_END_S,
        });
      }
      if (url.includes('/v1/billing_portal/sessions')) {
        return Response.json({ url: 'https://billing.stripe.com/p/session_1' });
      }
      // Cloud Phase 24 A10 — the billing page's own reads. tax_ids is matched
      // BEFORE the customer itself; the customer URL is a prefix of it.
      if (url.includes('/v1/customers/cus_1/tax_ids')) {
        if (init.method === 'POST') {
          taxIds = [{ id: 'txi_1', value: body.value }];
          return Response.json(taxIds[0]);
        }
        if (init.method === 'DELETE') {
          taxIds = [];
          return Response.json({ id: 'txi_1', deleted: true });
        }
        return Response.json({ data: taxIds });
      }
      if (url.includes('/v1/customers/cus_1')) {
        if (init.method === 'POST') {
          customerOnFile = {
            ...customerOnFile,
            name: body.name ?? '',
            address: {
              line1: body['address[line1]'] ?? '',
              city: body['address[city]'] ?? '',
              postal_code: body['address[postal_code]'] ?? '',
              country: body['address[country]'] ?? '',
            },
          };
        }
        return Response.json(customerOnFile);
      }
      if (url.includes('/v1/invoices')) {
        return Response.json({ data: invoicesOnFile });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    },
  ]);
  return calls;
}

function cloudflareOk() {
  const calls = [];
  network.push([
    'api.cloudflare.com',
    async (url, init) => {
      // The HOSTNAME is in the body, not the URL — every workers/domains PUT
      // goes to the same endpoint. Recording only the URL made "which addresses
      // did we route" unaskable, which is exactly what a caller wants to know.
      let hostname = null;
      try {
        hostname = JSON.parse(init.body ?? '{}').hostname ?? null;
      } catch {
        /* not a JSON body — leave it null */
      }
      calls.push({ url, method: init.method, hostname });
      return Response.json({ success: true, result: {} });
    },
  ]);
  return calls;
}

function cellAnswers(healthy) {
  network.push([
    '.cloud.maude.sh/health',
    async () => (healthy ? Response.json({ ok: true }) : new Response('no', { status: 503 })),
  ]);
}

async function throughCheckout(env, session) {
  await worker.fetch(
    post('/projects/new', session, { name: 'Zkušební tým', plan: 'project', interval: 'monthly' }),
    env
  );
  return worker.fetch(
    get('/checkout/return?project=zkusebni-tym&session_id=cs_test_1', session),
    env
  );
}

// ------------------------------------------------------------------- wizard

test('the wizard requires sign-in and renders the catalog', async () => {
  const { env } = await freshEnv();
  const anon = await worker.fetch(get('/projects/new'), env);
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get('location'), '/login');

  const session = await signedIn(env);
  const res = await worker.fetch(get('/projects/new', session), env);
  const body = await res.text();
  assert.match(body, /Start a project/);
  assert.match(body, /Cloud Project/);
  assert.match(body, /14 days are free/);
});

test('submitting the wizard creates NO project row — only a Checkout redirect', async () => {
  const { env, sqlite } = await freshEnv();
  const calls = stripeHappy();
  const session = await signedIn(env);
  const res = await worker.fetch(
    post('/projects/new', session, { name: 'Zkušební tým', plan: 'project', interval: 'monthly' }),
    env
  );
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /checkout\.stripe\.com/);
  // A 303 the browser refuses to follow is not a hand-off. This route is
  // reached by SUBMITTING A FORM, so the page's `form-action` decides whether
  // the submission leaves at all — and for two releases it did not.
  assert.ok(
    formActionPermits(res.headers.get('location')),
    'the wizard is a form POST: its Stripe destination must be in the CSP form-action'
  );
  // An abandoned checkout must not squat the address.
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
  // The session asked Stripe for a TRIAL — nothing chargeable today.
  const created = calls.find((c) => c.url.endsWith('/v1/checkout/sessions'));
  assert.equal(created.body['subscription_data[trial_period_days]'], '14');
  assert.equal(created.body.payment_method_collection, 'always');
});

test('a taken address is refused with a sentence, not an exception', async () => {
  const { env, sqlite } = await freshEnv();
  stripeHappy();
  const session = await signedIn(env);
  const owner = sqlite.prepare('SELECT id FROM accounts').get().id;
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
       VALUES ('zkusebni-tym', ?, 'X', 'active', 1, 1)`
    )
    .run(owner);
  const res = await worker.fetch(
    post('/projects/new', session, { name: 'Zkušební tým', plan: 'project', interval: 'monthly' }),
    env
  );
  assert.equal(res.status, 409);
  assert.match(await res.text(), /already someone/);
});

// ------------------------------------------------------------------- return

test('the return writes the project + attempt and routes the address', async () => {
  const { env, sqlite } = await freshEnv();
  stripeHappy();
  const cf = cloudflareOk();
  const session = await signedIn(env);
  const res = await throughCheckout(env, session);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/projects/zkusebni-tym/setup');

  const project = sqlite.prepare('SELECT * FROM projects').get();
  assert.equal(project.id, 'zkusebni-tym');
  assert.equal(project.state, 'pending');
  assert.equal(project.subscription_id, 'sub_1');
  const attempt = sqlite.prepare('SELECT * FROM checkout_attempts').get();
  assert.equal(attempt.payment, 'authorized');
  // TWO hostnames now (Cloud Phase 27): the project's, and its own canvas
  // origin. The canvas origin has to be a real address before anybody opens a
  // design, not something discovered missing at that moment.
  assert.equal(cf.length, 2, 'both the project and its canvas origin were routed');
  assert.deepEqual(cf.map((c) => c.hostname).sort(), [
    'canvas-zkusebni-tym.cloud.maude.sh',
    'zkusebni-tym.cloud.maude.sh',
  ]);
});

test("a session that is not this customer's writes nothing", async () => {
  const { env, sqlite } = await freshEnv();
  network.push([
    'api.stripe.com',
    async (url) =>
      url.includes('/v1/checkout/sessions/cs_test_1')
        ? Response.json({
            id: 'cs_test_1',
            status: 'complete',
            customer: 'cus_SOMEBODY_ELSE',
            subscription: 'sub_1',
            metadata: { project_id: 'zkusebni-tym' },
          })
        : Response.json({ id: 'cus_1' }),
  ]);
  cloudflareOk();
  const session = await signedIn(env);
  const res = await worker.fetch(
    get('/checkout/return?project=zkusebni-tym&session_id=cs_test_1', session),
    env
  );
  assert.equal(res.status, 404);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
});

// ------------------------------------------------------------- waiting room

test('a healthy workspace settles the promise: charged, active, told plainly', async () => {
  const { env, sqlite } = await freshEnv();
  stripeHappy();
  cloudflareOk();
  cellAnswers(true);
  const session = await signedIn(env);
  await throughCheckout(env, session);

  const res = await worker.fetch(get('/projects/zkusebni-tym/setup', session), env);
  const body = await res.text();
  assert.match(body, /is ready/);
  assert.match(body, /Open your project/);
  assert.equal(sqlite.prepare('SELECT payment FROM checkout_attempts').get().payment, 'charged');
  assert.equal(sqlite.prepare('SELECT state FROM projects').get().state, 'active');
});

test('a workspace still booting keeps waiting — with the not-charged answer on screen', async () => {
  const { env, sqlite } = await freshEnv();
  stripeHappy();
  cloudflareOk();
  cellAnswers(false);
  const session = await signedIn(env);
  await throughCheckout(env, session);

  const res = await worker.fetch(get('/projects/zkusebni-tym/setup', session), env);
  const body = await res.text();
  assert.match(body, /has not been charged/);
  assert.match(body, /http-equiv="refresh"/);
  assert.equal(sqlite.prepare('SELECT payment FROM checkout_attempts').get().payment, 'authorized');
});

test('a timeout VOIDS: the subscription is cancelled and the person is told', async () => {
  const { env, sqlite } = await freshEnv();
  const stripeCalls = stripeHappy();
  cloudflareOk();
  cellAnswers(false);
  const session = await signedIn(env);
  await throughCheckout(env, session);
  // Age the authorization past the window.
  sqlite.prepare('UPDATE checkout_attempts SET authorized_at = 1').run();

  const res = await worker.fetch(get('/projects/zkusebni-tym/setup', session), env);
  const body = await res.text();
  assert.match(body, /released|not been charged/);
  assert.equal(sqlite.prepare('SELECT payment FROM checkout_attempts').get().payment, 'voided');
  assert.equal(sqlite.prepare('SELECT state FROM projects').get().state, 'suspended');
  const cancel = stripeCalls.find((c) => c.method === 'DELETE');
  assert.match(cancel.url, /\/v1\/subscriptions\/sub_1/);
});

test('a settled attempt is never settled again — the void is idempotent', async () => {
  const { env, sqlite } = await freshEnv();
  const stripeCalls = stripeHappy();
  cloudflareOk();
  cellAnswers(false);
  const session = await signedIn(env);
  await throughCheckout(env, session);
  sqlite.prepare('UPDATE checkout_attempts SET authorized_at = 1').run();
  await worker.fetch(get('/projects/zkusebni-tym/setup', session), env);
  const cancelsAfterFirst = stripeCalls.filter((c) => c.method === 'DELETE').length;
  await worker.fetch(get('/projects/zkusebni-tym/setup', session), env);
  assert.equal(
    stripeCalls.filter((c) => c.method === 'DELETE').length,
    cancelsAfterFirst,
    'the second visit must not cancel again'
  );
});

// ---------------------------------------------------------------- billing

test('billing shows the situation and hands the owner to the portal', async () => {
  const { env } = await freshEnv();
  const stripeCalls = stripeHappy();
  cloudflareOk();
  cellAnswers(true);
  const session = await signedIn(env);
  await throughCheckout(env, session);

  const pageRes = await worker.fetch(get('/projects/zkusebni-tym/billing', session), env);
  assert.match(await pageRes.text(), /Change plan or card/);

  const portal = await worker.fetch(
    post('/projects/zkusebni-tym/billing/portal', session, {}),
    env
  );
  assert.equal(portal.status, 303);
  assert.match(portal.headers.get('location'), /billing\.stripe\.com/);
  assert.ok(
    formActionPermits(portal.headers.get('location')),
    'the portal button is a form POST too — same gate, same failure if forgotten'
  );
  const created = stripeCalls.find((c) => c.url.includes('billing_portal'));
  assert.equal(created.body.customer, 'cus_1');
});

// Cloud Phase 24 A10 — the three questions that used to be a two-hop journey
// through somebody else's product.
test('billing lists invoices with a PDF each, and never invents a draft', async () => {
  const { env } = await freshEnv();
  stripeHappy({
    invoices: [
      {
        id: 'in_1',
        status: 'paid',
        created: Math.floor(Date.UTC(2026, 6, 28) / 1000),
        total: 2900,
        currency: 'eur',
        invoice_pdf: 'https://files.stripe.com/in_1.pdf',
        lines: { data: [{ description: 'Cloud Project — monthly' }] },
      },
      // A draft is not a receipt: showing one invites somebody to hand their
      // accountant a number that has not happened yet.
      { id: 'in_2', status: 'draft', created: 1, total: 2900, currency: 'eur' },
    ],
  });
  cloudflareOk();
  cellAnswers(true);
  const session = await signedIn(env);
  await throughCheckout(env, session);

  const body = await (
    await worker.fetch(get('/projects/zkusebni-tym/billing', session), env)
  ).text();
  assert.match(body, /28 July 2026/);
  assert.match(body, /€29\.00/);
  assert.match(body, /href="https:\/\/files\.stripe\.com\/in_1\.pdf"/);
  assert.equal((body.match(/>PDF</g) ?? []).length, 1, 'the draft must not be listed');
});

test('billing details reach Stripe, VAT id included — which is what Stripe Tax reads', async () => {
  const { env } = await freshEnv();
  const stripeCalls = stripeHappy();
  cloudflareOk();
  cellAnswers(true);
  const session = await signedIn(env);
  await throughCheckout(env, session);

  const saved = await worker.fetch(
    post('/projects/zkusebni-tym/billing/details', session, {
      company: 'Brno Alligators z.s.',
      line1: 'Sportovní 12',
      city: 'Brno',
      postalCode: '602 00',
      country: 'cz',
      vatId: 'cz 26547891',
    }),
    env
  );
  assert.equal(saved.status, 200);
  const update = stripeCalls.find(
    (c) => c.method === 'POST' && /\/v1\/customers\/cus_1$/.test(c.url)
  );
  assert.equal(update.body.name, 'Brno Alligators z.s.');
  assert.equal(update.body['address[country]'], 'CZ');
  const vat = stripeCalls.find((c) => c.method === 'POST' && c.url.includes('/tax_ids'));
  assert.equal(vat.body.type, 'eu_vat');
  assert.equal(
    vat.body.value,
    'CZ26547891',
    'spaces and case are normalized before Stripe sees it'
  );

  // …and the page renders them back on the next visit.
  const body = await (
    await worker.fetch(get('/projects/zkusebni-tym/billing', session), env)
  ).text();
  assert.match(body, /Brno Alligators z\.s\./);
  assert.match(body, /CZ26547891/);
});

test('a mismatched VAT id is refused with a sentence, and nothing is sent', async () => {
  const { env } = await freshEnv();
  const stripeCalls = stripeHappy();
  cloudflareOk();
  cellAnswers(true);
  const session = await signedIn(env);
  await throughCheckout(env, session);
  const before = stripeCalls.length;

  const res = await worker.fetch(
    post('/projects/zkusebni-tym/billing/details', session, {
      country: 'DE',
      vatId: 'CZ26547891',
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.match(await res.text(), /do not match/);
  assert.equal(
    stripeCalls.filter((c, i) => i >= before && c.method === 'POST' && c.url.includes('/tax_ids'))
      .length,
    0
  );
});

// Cloud Phase 24 A11 — the cancel ladder, canvas board E0.
test('cancelling shows every date BEFORE the click, then ends at period end', async () => {
  const { env } = await freshEnv();
  const stripeCalls = stripeHappy();
  cloudflareOk();
  cellAnswers(true);
  const session = await signedIn(env);
  await throughCheckout(env, session);

  const confirm = await (
    await worker.fetch(get('/projects/zkusebni-tym/billing/cancel', session), env)
  ).text();
  assert.match(confirm, /28 August 2030/, 'works until');
  assert.match(confirm, /27 September 2030/, 'deleted 30 days after it pauses');
  // The download offer is ON this screen, not a link to the page that makes one.
  assert.match(confirm, /action="\/projects\/zkusebni-tym\/download"/);
  assert.match(confirm, /Download everything/);

  // An unticked box changes nothing at Stripe.
  const unticked = await worker.fetch(
    post('/projects/zkusebni-tym/billing/cancel', session, {}),
    env
  );
  assert.equal(unticked.status, 400);
  assert.equal(stripeCalls.filter((c) => c.body?.cancel_at_period_end).length, 0);

  const done = await worker.fetch(
    post('/projects/zkusebni-tym/billing/cancel', session, { sure: 'yes' }),
    env
  );
  assert.equal(done.status, 303);
  const cancel = stripeCalls.find((c) => c.body?.cancel_at_period_end === 'true');
  assert.match(cancel.url, /\/v1\/subscriptions\/sub_1/);

  // Cancelled-but-still-running is a state the old page could not show at all.
  const after = await (
    await worker.fetch(get('/projects/zkusebni-tym/billing', session), env)
  ).text();
  assert.match(after, /Cancelled — ends 28 August 2030/);
  assert.match(after, /Keep Zkušební tým/);
  assert.doesNotMatch(after, /Cancel subscription/, 'no second cancel button once cancelled');

  const kept = await worker.fetch(post('/projects/zkusebni-tym/billing/resume', session, {}), env);
  assert.equal(kept.status, 303);
  assert.ok(stripeCalls.find((c) => c.body?.cancel_at_period_end === 'false'));
});

test('billing survives Stripe being unreachable — the state card always renders', async () => {
  const { env } = await freshEnv();
  stripeHappy();
  cloudflareOk();
  cellAnswers(true);
  const session = await signedIn(env);
  await throughCheckout(env, session);
  // Every later Stripe call fails. This is the page somebody opens BECAUSE
  // their card failed; blanking it turns one problem into two.
  network.unshift(['api.stripe.com', async () => new Response('nope', { status: 503 })]);

  const res = await worker.fetch(get('/projects/zkusebni-tym/billing', session), env);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /invoices could not be loaded/);
  assert.match(body, /Setting up/, 'the state card comes from our own database');
});

test('billing is the owner’s alone — a member sees the same 404 as a stranger', async () => {
  const { env, sqlite } = await freshEnv();
  stripeHappy();
  cloudflareOk();
  cellAnswers(true);
  const session = await signedIn(env);
  await throughCheckout(env, session);

  const other = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email: 'member@example.com', password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  const memberSession = /maude_session=([^;]+)/.exec(other.headers.get('set-cookie'))?.[1];
  const memberId = sqlite
    .prepare("SELECT id FROM accounts WHERE email = 'member@example.com'")
    .get().id;
  sqlite
    .prepare(
      "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('zkusebni-tym', ?, 'member', 1)"
    )
    .run(memberId);

  const res = await worker.fetch(get('/projects/zkusebni-tym/billing', memberSession), env);
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------- strings

test('the checkout pages ship no script and no vocabulary of ours', () => {
  const html = allCheckoutHtml({ pricing: loadPricing() });
  assert.ok(!/<script/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  for (const jargon of ['tenant', 'cell', 'provision', 'webhook', 'container']) {
    assert.ok(!new RegExp(`\\b${jargon}`, 'i').test(html), `"${jargon}" leaked into checkout`);
  }
});

// Cloud Phase 24 A1. The wizard is the last screen before a card form, so it
// is the last honest moment: a customer must not learn about the desktop
// requirement or the Anthropic subscription AFTER authorizing payment.
test('the wizard states the full bill of materials above the payment button', () => {
  const html = newProjectPage({ account: { email: 'a@example.com' }, pricing: loadPricing() });
  assert.match(html, /your own Claude subscription/);
  assert.match(html, /Anthropic/);
  assert.match(html, /not a phone/);
  const bom = html.indexOf('What you’ll need');
  const button = html.indexOf('Continue to payment details');
  assert.ok(bom > 0 && bom < button, 'the bill of materials must precede the payment button');

  // Cloud Phase 24 A8: the legal pack is linked where the decision is made,
  // not somewhere a customer would have to go looking for it.
  const terms = html.indexOf('maude.sh/terms');
  assert.ok(terms > 0 && terms < button, 'Terms must be linked above the payment button');
  assert.match(html, /maude\.sh\/privacy/);
});
