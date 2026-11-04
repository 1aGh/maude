// fill-live-price-ids.mjs — Phase B2 groundwork. Works on a TEMP COPY of
// pricing.json with obviously fake ids; the committed file is never written and
// no fake id ever lands in it.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assertAmountsMatchStripe, priceIdFor } from '../pricing-core.mjs';
import { applyLive, DEFAULT_PRICING, run, validateBlob } from './fill-live-price-ids.mjs';
import { BLOB_SCHEMA } from './stripe-live-catalog.mjs';

const BLOB = {
  schema: BLOB_SCHEMA,
  live: {
    project: {
      product: 'maude_cloud_project',
      monthly: 'price_LIVEprojectMonthly01',
      annual: 'price_LIVEprojectAnnual02',
    },
    dedicated: {
      product: 'maude_cloud_dedicated',
      monthly: 'price_LIVEdedicatedMonthly03',
      annual: null,
    },
    storage: { product: 'maude_cloud_storage', monthly: 'price_LIVEstorageMonthly04' },
  },
};

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'fill-live-'));
  const pricingPath = join(dir, 'pricing.json');
  copyFileSync(DEFAULT_PRICING, pricingPath);
  const blobPath = join(dir, 'blob.json');
  writeFileSync(blobPath, JSON.stringify(BLOB));
  return { dir, pricingPath, blobPath };
}

function io() {
  const out = [];
  const err = [];
  return { out, err, stdout: (s) => out.push(s), stderr: (s) => err.push(s) };
}

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

function fakeStripeFor(pricing) {
  // What a correct live Stripe says about each live price id.
  const byId = new Map();
  for (const p of pricing.plans) {
    if (p.stripe.live.monthly)
      byId.set(p.stripe.live.monthly, { unit_amount: p.amounts.monthlyMinor, currency: 'eur' });
    if (p.stripe.live.annual)
      byId.set(p.stripe.live.annual, { unit_amount: p.amounts.annualMinor, currency: 'eur' });
  }
  for (const a of pricing.addons)
    byId.set(a.stripe.live.monthly, { unit_amount: a.amounts.monthlyMinor, currency: 'eur' });
  return async (id) => {
    const hit = byId.get(id);
    if (!hit) throw new Error(`no such price ${id}`);
    return hit;
  };
}

test('after the fill, every plan resolves in LIVE mode and the amounts match Stripe', async () => {
  const s = sandbox();
  const o = io();
  assert.equal(
    run({ argv: ['--in', s.blobPath, '--pricing', s.pricingPath], ...o }),
    0,
    o.err.join('')
  );

  const pricing = read(s.pricingPath);
  for (const [plan, interval] of [
    ['project', 'monthly'],
    ['project', 'annual'],
    ['dedicated', 'monthly'],
    ['storage', 'monthly'],
  ]) {
    assert.match(priceIdFor(plan, interval, { pricing, mode: 'live' }), /^price_LIVE/);
  }
  // The guard still holds where there is genuinely nothing to charge.
  assert.throws(
    () => priceIdFor('dedicated', 'annual', { pricing, mode: 'live' }),
    /no live price configured/
  );

  assert.deepEqual(
    await assertAmountsMatchStripe(fakeStripeFor(pricing), { pricing, mode: 'live' }),
    []
  );
  // …and the check is a real check: a drifted Stripe amount is reported.
  const drift = async (id) => ({ ...(await fakeStripeFor(pricing)(id)), unit_amount: 1 });
  assert.ok((await assertAmountsMatchStripe(drift, { pricing, mode: 'live' })).length >= 4);
});

test('the sandbox ids and everything else in the file are untouched, byte for byte', () => {
  const s = sandbox();
  const before = readFileSync(s.pricingPath, 'utf8');
  run({ argv: ['--in', s.blobPath, '--pricing', s.pricingPath], ...io() });
  const after = readFileSync(s.pricingPath, 'utf8');
  const changed = before
    .split('\n')
    .flatMap((line, i) => (line === after.split('\n')[i] ? [] : [i]));
  assert.equal(
    changed.length,
    3,
    'exactly the three live lines differ (project, dedicated, storage)'
  );
  assert.equal(before.split('\n').length, after.split('\n').length);
  const a = read(s.pricingPath);
  const b = JSON.parse(before);
  for (let i = 0; i < a.plans.length; i++)
    assert.deepEqual(a.plans[i].stripe.sandbox, b.plans[i].stripe.sandbox);
  assert.deepEqual(a.$comment, b.$comment);
});

test('--dry-run validates and shows the change but writes nothing', () => {
  const s = sandbox();
  const before = readFileSync(s.pricingPath, 'utf8');
  const o = io();
  assert.equal(
    run({ argv: ['--in', s.blobPath, '--pricing', s.pricingPath, '--dry-run'], ...o }),
    0
  );
  assert.match(o.out.join(''), /project: product=maude_cloud_project/);
  assert.match(o.out.join(''), /Dry run/);
  assert.equal(readFileSync(s.pricingPath, 'utf8'), before);
});

test('applying the same blob twice is a no-op; a different id needs --replace', () => {
  const s = sandbox();
  run({ argv: ['--in', s.blobPath, '--pricing', s.pricingPath], ...io() });
  const o = io();
  assert.equal(run({ argv: ['--in', s.blobPath, '--pricing', s.pricingPath], ...o }), 0);
  assert.match(o.out.join(''), /No change/);

  const other = structuredClone(BLOB);
  other.live.project.monthly = 'price_LIVEsomethingElse99';
  writeFileSync(s.blobPath, JSON.stringify(other));
  const refused = io();
  assert.equal(run({ argv: ['--in', s.blobPath, '--pricing', s.pricingPath], ...refused }), 1);
  assert.match(refused.err.join(''), /already price_LIVEprojectMonthly01; refusing to replace/);
  assert.equal(read(s.pricingPath).plans[0].stripe.live.monthly, 'price_LIVEprojectMonthly01');
  assert.equal(
    run({ argv: ['--in', s.blobPath, '--pricing', s.pricingPath, '--replace'], ...io() }),
    0
  );
  assert.equal(read(s.pricingPath).plans[0].stripe.live.monthly, 'price_LIVEsomethingElse99');
});

test('a sandbox id pasted as live is refused — the typo that would make live charge nothing', () => {
  const pricing = read(DEFAULT_PRICING);
  const bad = structuredClone(BLOB);
  bad.live.project.monthly = pricing.plans[0].stripe.sandbox.monthly;
  assert.throws(() => validateBlob(bad, pricing), /SANDBOX id/);
});

test('shape errors are all listed at once and nothing is written', () => {
  const s = sandbox();
  const before = readFileSync(s.pricingPath, 'utf8');
  const bad = structuredClone(BLOB);
  bad.schema = 'nope';
  bad.live.storage = undefined;
  bad.live.project.annual = null; // advertised, so required
  bad.live.dedicated.annual = 'price_LIVEdedicatedAnnual05'; // not advertised
  bad.live.project.monthly = 'not-a-price';
  bad.live.extra = {};
  writeFileSync(s.blobPath, JSON.stringify(bad));
  const o = io();
  assert.equal(run({ argv: ['--in', s.blobPath, '--pricing', s.pricingPath], ...o }), 1);
  const text = o.err.join('');
  for (const re of [
    /schema is "nope"/,
    /storage: missing from the blob/,
    /project\.annual: null is not a price id/,
    /dedicated\.annual: pricing\.json advertises no annual/,
    /project\.monthly: "not-a-price"/,
    /unexpected plan "extra"/,
  ]) {
    assert.match(text, re);
  }
  assert.equal(readFileSync(s.pricingPath, 'utf8'), before);
});

test('the same id used twice is refused', () => {
  const pricing = read(DEFAULT_PRICING);
  const bad = structuredClone(BLOB);
  bad.live.project.annual = bad.live.project.monthly;
  assert.throws(() => validateBlob(bad, pricing), /also used by project\.monthly/);
});

test('input that is not the blob is refused with a hint', () => {
  const s = sandbox();
  writeFileSync(s.blobPath, 'price_123 done\n');
  const o = io();
  assert.equal(run({ argv: ['--in', s.blobPath, '--pricing', s.pricingPath], ...o }), 1);
  assert.match(o.err.join(''), /not valid JSON/);
});

test('--in - reads stdin; missing --in and unknown flags are usage errors', () => {
  const s = sandbox();
  assert.equal(
    run({
      argv: ['--in', '-', '--pricing', s.pricingPath],
      readStdin: () => JSON.stringify(BLOB),
      ...io(),
    }),
    0
  );
  assert.equal(run({ argv: [], ...io() }), 2);
  assert.equal(run({ argv: ['--wat'], ...io() }), 2);
});

test('applyLive edits the right block even if a later item has the same shape', () => {
  const text = readFileSync(DEFAULT_PRICING, 'utf8');
  const pricing = JSON.parse(text);
  const next = JSON.parse(applyLive(text, pricing, validateBlob(BLOB, pricing)));
  assert.equal(next.plans[1].stripe.live.monthly, 'price_LIVEdedicatedMonthly03');
  assert.equal(next.addons[0].stripe.live.monthly, 'price_LIVEstorageMonthly04');
  assert.equal(next.plans[1].stripe.live.annual, null);
});

test('the pricing.json in the repo is never half-live (checked in pricing.test.mjs for the resolve side)', () => {
  const pricing = read(DEFAULT_PRICING);
  const ids = [...pricing.plans, ...pricing.addons].flatMap((x) =>
    Object.entries(x.stripe.live)
      .filter(([k]) => k !== 'product')
      .map(([, v]) => v)
  );
  assert.ok(
    !ids.some((v) => typeof v === 'string' && v.startsWith('price_LIVE')),
    'no fake test ids in the committed file'
  );
});
