// Cloud Phase 8 groundwork — pricing resolution.
//
// The mistakes worth catching here are the ones that are invisible until they
// involve a real card: a live-mode lookup silently falling back to a sandbox
// price, and a local amount drifting from what Stripe actually charges.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertAmountsMatchStripe,
  loadPricing,
  priceIdFor,
  publicPricing,
  stripeMode,
} from './pricing.mjs';

test('the sandbox ids resolve for every advertised plan and interval', () => {
  const pricing = loadPricing();
  assert.match(priceIdFor('project', 'monthly', { mode: 'sandbox' }), /^price_/);
  assert.match(priceIdFor('project', 'annual', { mode: 'sandbox' }), /^price_/);
  assert.match(priceIdFor('dedicated', 'monthly', { mode: 'sandbox' }), /^price_/);
  assert.match(priceIdFor('storage', 'monthly', { mode: 'sandbox' }), /^price_/);
  assert.equal(pricing.currency, 'eur');
});

test('LIVE mode throws for an unconfigured price — never falls back to the sandbox', () => {
  // The failure this prevents: a real customer charged nothing, or a test
  // charge landing on a real card.
  for (const [plan, interval] of [
    ['project', 'monthly'],
    ['project', 'annual'],
    ['dedicated', 'monthly'],
    ['storage', 'monthly'],
  ]) {
    assert.throws(
      () => priceIdFor(plan, interval, { mode: 'live' }),
      (err) => {
        assert.match(err.message, /no live price configured/);
        assert.match(err.message, /no fallback to the sandbox/);
        // The sandbox id must not leak into the live path even in the message.
        assert.ok(!/^price_[A-Za-z0-9]+$/.test(err.message.split(' ').pop()));
        return true;
      },
      `${plan}/${interval} must refuse in live mode`
    );
  }
});

test('an unknown plan names the ones that exist', () => {
  assert.throws(
    () => priceIdFor('enterprise', 'monthly', { mode: 'sandbox' }),
    /unknown plan "enterprise" \(known: project, dedicated, storage\)/
  );
});

test('an interval a plan does not offer is refused, not approximated', () => {
  // Dedicated has no annual price. Falling back to monthly would bill someone
  // 1/12 of what they agreed to.
  assert.throws(() => priceIdFor('dedicated', 'annual', { mode: 'sandbox' }), /no sandbox price/);
});

test('stripeMode reads the key, and defaults to sandbox', () => {
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: 'sk_live_abc' }), 'live');
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: 'rk_live_abc' }), 'live');
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: 'sk_test_abc' }), 'sandbox');
  // Absent key ⇒ sandbox. Defaulting to live would be the dangerous direction.
  assert.equal(stripeMode({}), 'sandbox');
});

test('publicPricing carries no Stripe ids', () => {
  // Ids are routing detail a public page has no use for, and a shape that
  // carries them is one an accidental JSON.stringify can leak into HTML.
  const pub = publicPricing();
  const serialized = JSON.stringify(pub);
  assert.ok(!serialized.includes('price_'), 'no price ids');
  assert.ok(!serialized.includes('prod_'), 'no product ids');
  assert.equal(pub.plans.find((p) => p.id === 'project').monthly.major, 19);
  assert.equal(pub.plans.find((p) => p.id === 'project').annual.major, 190);
  assert.equal(pub.plans.find((p) => p.id === 'dedicated').monthly.major, 99);
  assert.equal(pub.addons[0].monthly.major, 5);
  assert.equal(pub.trialDays, 14);
});

test('self-host is free and stays in the public shape', () => {
  // DDR-193 §6 — the self-host table stays intact and first-class. A pricing
  // page that quietly omits it is the silent version of deleting the promise.
  assert.equal(publicPricing().selfHost.price, 0);
});

test('a local amount that drifts from Stripe is REPORTED, not trusted', () => {
  // Stripe prices are immutable, so editing the JSON does not change what a
  // customer is charged — it only makes the pricing page lie.
  const stripeSays = {
    price_1TyIumBU24eXpQylzkMWEr6G: { unit_amount: 2900, currency: 'eur' },
  };
  return assertAmountsMatchStripe(
    async (id) => stripeSays[id] ?? { unit_amount: null, currency: 'eur' },
    { mode: 'sandbox' }
  ).then((mismatches) => {
    const project = mismatches.find((m) => m.label === 'project/monthly');
    assert.ok(project, 'the drifted price must be reported');
    assert.match(project.problem, /Stripe charges 2900, pricing.json advertises 1900/);
  });
});

test('consistent amounts report no mismatches', async () => {
  const pricing = loadPricing();
  const byId = new Map();
  for (const p of pricing.plans) {
    if (p.stripe.sandbox.monthly)
      byId.set(p.stripe.sandbox.monthly, { unit_amount: p.amounts.monthlyMinor, currency: 'eur' });
    if (p.stripe.sandbox.annual)
      byId.set(p.stripe.sandbox.annual, { unit_amount: p.amounts.annualMinor, currency: 'eur' });
  }
  for (const a of pricing.addons) {
    byId.set(a.stripe.sandbox.monthly, { unit_amount: a.amounts.monthlyMinor, currency: 'eur' });
  }
  const mismatches = await assertAmountsMatchStripe(async (id) => byId.get(id), {
    mode: 'sandbox',
  });
  assert.deepEqual(mismatches, []);
});

test('a wrong currency in Stripe is reported too', async () => {
  const mismatches = await assertAmountsMatchStripe(
    async () => ({ unit_amount: 1900, currency: 'usd' }),
    { mode: 'sandbox' }
  );
  assert.ok(mismatches.some((m) => /currency is usd/.test(m.problem)));
});

test('the file states plainly that the numbers are not signed off', () => {
  // Phase 0 §3: the final numbers are the owner's call. A config that reads as
  // settled is one somebody ships.
  const raw = JSON.stringify(loadPricing().$comment);
  assert.match(raw, /PROPOSAL, NOT SIGNED OFF/);
  assert.match(raw, /per seat/i);
});
