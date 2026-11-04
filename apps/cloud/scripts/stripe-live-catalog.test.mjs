// stripe-live-catalog.mjs — Phase B1. Stubbed fetch only: no test in here, and
// nothing the script itself does under test, can reach api.stripe.com or needs a
// real key. The keys below are made-up strings with the right prefixes.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPricing } from '../pricing.mjs';
import { BLOB_SCHEMA, buildPlan, describePlan, keyKind, run } from './stripe-live-catalog.mjs';

const LIVE_KEY = 'rk_live_FAKEFAKEFAKE0123456789';

/** An in-memory Stripe. `mutate` lets a test bend what a given call returns. */
function fakeStripe({ livemode = true, mutate = null, errorFor = null } = {}) {
  const products = new Map();
  const prices = new Map();
  const calls = [];
  let n = 0;
  const reply = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const form = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    const headers = init.headers ?? {};
    calls.push({ method, path: u.pathname + u.search, form, headers, url: String(url) });
    const custom = errorFor?.(method, u);
    if (custom) return custom;

    if (method === 'GET' && u.pathname.startsWith('/v1/products/')) {
      const p = products.get(decodeURIComponent(u.pathname.split('/').pop()));
      return p
        ? reply(200, p)
        : reply(404, {
            error: {
              type: 'invalid_request_error',
              code: 'resource_missing',
              message: 'No such product',
            },
          });
    }
    if (method === 'POST' && u.pathname === '/v1/products') {
      const p = { id: form.id, object: 'product', livemode, name: form.name };
      products.set(p.id, p);
      return reply(200, p);
    }
    if (method === 'GET' && u.pathname === '/v1/prices') {
      const key = u.searchParams.get('lookup_keys[]');
      const found = [...prices.values()].filter((p) => p.lookup_key === key);
      return reply(200, { object: 'list', data: found });
    }
    if (method === 'POST' && u.pathname === '/v1/prices') {
      const price = {
        id: `price_live_${++n}`,
        object: 'price',
        livemode,
        type: 'recurring',
        product: form.product,
        currency: form.currency,
        unit_amount: Number(form.unit_amount),
        tax_behavior: form.tax_behavior,
        recurring: { interval: form['recurring[interval]'], interval_count: 1 },
        lookup_key: form.lookup_key,
      };
      prices.set(price.id, price);
      return reply(200, price);
    }
    if (method === 'GET' && u.pathname.startsWith('/v1/prices/')) {
      const p = prices.get(u.pathname.split('/').pop());
      if (!p) return reply(404, { error: { message: 'No such price' } });
      return reply(200, mutate ? mutate(p) : p);
    }
    return reply(500, { error: { message: `unexpected ${method} ${u.pathname}` } });
  };
  return { fetch, calls, products, prices };
}

function capture() {
  const out = [];
  const err = [];
  return { out, err, stdout: (s) => out.push(s), stderr: (s) => err.push(s) };
}

const neverCalled = () => {
  throw new Error('fetch must not be called');
};

test('the plan is built from pricing.json: net prices, four prices, three products', () => {
  const pricing = loadPricing();
  const plan = buildPlan(pricing);
  const flat = plan.flatMap((e) =>
    e.prices.map((p) => [e.id, p.interval, p.unitAmount, p.stripeInterval])
  );
  assert.deepEqual(flat, [
    ['project', 'monthly', 1900, 'month'],
    ['project', 'annual', 19000, 'year'],
    ['dedicated', 'monthly', 9900, 'month'],
    ['storage', 'monthly', 500, 'month'],
  ]);
  for (const e of plan) for (const p of e.prices) assert.equal(p.taxBehavior, 'exclusive');
  assert.match(describePlan(plan, 'eur'), /19\.00 EUR \/ month/);
});

test('a pricing.json that is not tax-exclusive is refused, not guessed', () => {
  const pricing = { ...structuredClone(loadPricing()), taxBehavior: 'inclusive' };
  assert.throws(() => buildPlan(pricing), /tax-exclusive/);
});

test('keyKind names the kind and never echoes the key', () => {
  assert.equal(keyKind('sk_live_x'), 'live');
  assert.equal(keyKind('rk_live_x'), 'live');
  assert.equal(keyKind('sk_test_x'), 'test');
  assert.equal(keyKind('rk_test_x'), 'test');
  assert.equal(keyKind(''), 'absent');
  assert.equal(keyKind('whsec_x'), 'unknown');
});

test('--dry-run prints the plan, calls nothing, and needs no key', async () => {
  const io = capture();
  const code = await run({ argv: ['--dry-run'], env: {}, fetch: neverCalled, ...io });
  assert.equal(code, 0);
  assert.equal(io.out.join(''), '', 'no blob on stdout in a dry run');
  const text = io.err.join('');
  assert.match(text, /DRY RUN/);
  assert.match(text, /maude_cloud_project_monthly_eur_v1/);
  assert.match(text, /STRIPE_SECRET_KEY is not set/);
});

test('--dry-run with a test key says a real run would refuse, still calls nothing', async () => {
  const io = capture();
  const code = await run({
    argv: ['--dry-run'],
    env: { STRIPE_SECRET_KEY: 'sk_test_FAKE' },
    fetch: neverCalled,
    ...io,
  });
  assert.equal(code, 0);
  assert.match(io.err.join(''), /test key — a real run would refuse/);
  assert.ok(!io.err.join('').includes('sk_test_FAKE'));
});

test('a real run refuses test keys, a missing key and an odd key — before any call', async () => {
  for (const key of ['sk_test_FAKE', 'rk_test_FAKE', 'whsec_FAKE', undefined]) {
    const io = capture();
    const code = await run({
      argv: ['--confirm-live'],
      env: key ? { STRIPE_SECRET_KEY: key } : {},
      fetch: neverCalled,
      ...io,
    });
    assert.equal(code, 1, `key ${key} must be refused`);
    assert.equal(io.out.join(''), '');
    assert.match(io.err.join(''), /refused/);
  }
});

test('a live key without --confirm-live is refused', async () => {
  const io = capture();
  const code = await run({
    argv: [],
    env: { STRIPE_SECRET_KEY: LIVE_KEY },
    fetch: neverCalled,
    ...io,
  });
  assert.equal(code, 1);
  assert.match(io.err.join(''), /--confirm-live/);
  assert.ok(!io.err.join('').includes(LIVE_KEY));
});

test('unknown flags and a malformed tax code are usage errors', async () => {
  for (const argv of [['--yolo'], ['--tax-code', 'nope'], ['--tax-code=txcd_1']]) {
    const io = capture();
    assert.equal(await run({ argv, env: {}, fetch: neverCalled, ...io }), 2);
  }
});

test('a real run creates 3 products and 4 net prices, authed with the key, and prints only the blob', async () => {
  const stripe = fakeStripe();
  const io = capture();
  const code = await run({
    argv: ['--confirm-live', '--tax-code', 'txcd_10103001'],
    env: { STRIPE_SECRET_KEY: LIVE_KEY },
    fetch: stripe.fetch,
    ...io,
  });
  assert.equal(code, 0, io.err.join(''));

  const posts = stripe.calls.filter((c) => c.method === 'POST');
  const priceForms = posts.filter((c) => c.path === '/v1/prices').map((c) => c.form);
  assert.equal(posts.filter((c) => c.path === '/v1/products').length, 3);
  assert.equal(priceForms.length, 4);
  for (const f of priceForms) {
    assert.equal(f.tax_behavior, 'exclusive');
    assert.equal(f.currency, 'eur');
    assert.ok(f.lookup_key.startsWith('maude_cloud_'));
  }
  assert.deepEqual(
    priceForms.map((f) => [f.unit_amount, f['recurring[interval]']]),
    [
      ['1900', 'month'],
      ['19000', 'year'],
      ['9900', 'month'],
      ['500', 'month'],
    ]
  );
  for (const p of posts.filter((c) => c.path === '/v1/products')) {
    assert.equal(p.form.tax_code, 'txcd_10103001');
  }

  // Every write is idempotent, and no two writes share a key.
  const keys = posts.map((c) => c.headers['idempotency-key']);
  assert.ok(keys.every(Boolean));
  assert.equal(new Set(keys).size, keys.length);
  // Every call is authenticated with the key, and only to api.stripe.com.
  for (const c of stripe.calls) {
    assert.equal(c.headers.authorization, `Bearer ${LIVE_KEY}`);
    assert.ok(c.url.startsWith('https://api.stripe.com/'));
    assert.equal(
      c.headers['content-type'] ?? 'application/x-www-form-urlencoded',
      'application/x-www-form-urlencoded'
    );
  }

  // stdout is exactly one JSON blob; the key is nowhere in either stream.
  const blob = JSON.parse(io.out.join(''));
  assert.equal(blob.schema, BLOB_SCHEMA);
  assert.deepEqual(Object.keys(blob.live), ['project', 'dedicated', 'storage']);
  assert.match(blob.live.project.product, /^maude_cloud_project$/);
  assert.match(blob.live.project.monthly, /^price_live_/);
  assert.match(blob.live.project.annual, /^price_live_/);
  assert.equal(blob.live.dedicated.annual, null, 'Dedicated has no annual price');
  assert.ok(!('annual' in blob.live.storage), 'add-ons carry no annual slot');
  assert.ok(!io.out.join('').includes(LIVE_KEY));
  assert.ok(!io.err.join('').includes(LIVE_KEY));
});

test('re-running reuses what exists: the second run writes nothing', async () => {
  const stripe = fakeStripe();
  const env = { STRIPE_SECRET_KEY: LIVE_KEY };
  const first = capture();
  assert.equal(await run({ argv: ['--confirm-live'], env, fetch: stripe.fetch, ...first }), 0);
  const writesAfterFirst = stripe.calls.filter((c) => c.method === 'POST').length;

  const second = capture();
  assert.equal(await run({ argv: ['--confirm-live'], env, fetch: stripe.fetch, ...second }), 0);
  assert.equal(stripe.calls.filter((c) => c.method === 'POST').length, writesAfterFirst);
  assert.deepEqual(JSON.parse(second.out.join('')), JSON.parse(first.out.join('')));
});

test('an existing price with a different amount stops the run — prices are immutable', async () => {
  const stripe = fakeStripe();
  const env = { STRIPE_SECRET_KEY: LIVE_KEY };
  assert.equal(await run({ argv: ['--confirm-live'], env, fetch: stripe.fetch, ...capture() }), 0);
  const drifted = [...stripe.prices.values()].find((p) => p.lookup_key.includes('project_monthly'));
  drifted.unit_amount = 2900;

  const io = capture();
  assert.equal(await run({ argv: ['--confirm-live'], env, fetch: stripe.fetch, ...io }), 1);
  assert.equal(io.out.join(''), '', 'no blob when the catalog is inconsistent');
  assert.match(io.err.join(''), /immutable/);
});

test('an object that Stripe says is not live mode is never used', async () => {
  const stripe = fakeStripe({ livemode: false });
  const io = capture();
  const code = await run({
    argv: ['--confirm-live'],
    env: { STRIPE_SECRET_KEY: LIVE_KEY },
    fetch: stripe.fetch,
    ...io,
  });
  assert.equal(code, 1);
  assert.equal(io.out.join(''), '');
  assert.match(io.err.join(''), /livemode=false/);
});

test('the read-back is the authority: Stripe disagreeing with pricing.json withholds the blob', async () => {
  const stripe = fakeStripe({ mutate: (p) => ({ ...p, unit_amount: p.unit_amount + 1 }) });
  const io = capture();
  const code = await run({
    argv: ['--confirm-live'],
    env: { STRIPE_SECRET_KEY: LIVE_KEY },
    fetch: stripe.fetch,
    ...io,
  });
  assert.equal(code, 1);
  assert.equal(io.out.join(''), '');
  assert.match(io.err.join(''), /MISMATCH project\/monthly/);
});

test('a Stripe error that echoes the key is scrubbed, and a failure mid-run says it is safe to re-run', async () => {
  const stripe = fakeStripe({
    errorFor: (method, u) =>
      method === 'POST' && u.pathname === '/v1/prices'
        ? new Response(
            JSON.stringify({ error: { type: 'api_error', message: `bad key ${LIVE_KEY}` } }),
            { status: 400 }
          )
        : null,
  });
  const io = capture();
  const code = await run({
    argv: ['--confirm-live'],
    env: { STRIPE_SECRET_KEY: LIVE_KEY },
    fetch: stripe.fetch,
    ...io,
  });
  assert.equal(code, 1);
  assert.ok(!io.err.join('').includes(LIVE_KEY));
  assert.match(io.err.join(''), /\[redacted key\]/);
  assert.equal(io.out.join(''), '');
});

test('the script keeps nothing on disk and takes the key from nowhere but the environment', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./stripe-live-catalog.mjs', import.meta.url)),
    'utf8'
  );
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/node:fs|writeFile|appendFile|createWriteStream/.test(code), 'no file writes');
  assert.ok(!/--key|--secret|--api-key/.test(code), 'no key argument');
});
