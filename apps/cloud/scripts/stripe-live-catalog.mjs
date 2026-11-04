#!/usr/bin/env node
// Create the LIVE Stripe catalog for Maude Cloud — Phase B, Task B1.
//
// Michal runs this once, by hand, with a live key in his own shell. The agent
// that wrote it never had a key and never called Stripe.
//
//   node apps/cloud/scripts/stripe-live-catalog.mjs --dry-run
//   STRIPE_SECRET_KEY=rk_live_… node apps/cloud/scripts/stripe-live-catalog.mjs --confirm-live
//
// What it does: reads the amounts from apps/cloud/pricing.json (through
// pricing.mjs, the one reader), creates one live Product per plan and one live
// Price per advertised interval — `tax_behavior: exclusive`, because the listed
// price is net and Stripe adds VAT as merchant of record — and prints the ids
// as a JSON blob on STDOUT. Everything human-readable goes to STDERR, so
// `> live-ids.json` captures only the blob. That blob is the input of
// fill-live-price-ids.mjs.
//
// Rules that exist because the mistake is invisible until it involves a card:
//
//   1. THE KEY COMES FROM THE ENVIRONMENT ONLY. Never an argument (shell
//      history, `ps`), never a file. It is not written anywhere and every line
//      this script prints is scrubbed of it.
//   2. ONLY A LIVE KEY (`sk_live_` / `rk_live_`) RUNS, AND ONLY WITH
//      `--confirm-live`. A test key would create sandbox objects and print
//      their ids as if they were live — the exact mix-up pricing-core.mjs
//      refuses to make.
//   3. RE-RUNNING IS SAFE. Prices are looked up by `lookup_key` first, products
//      have a fixed id, and every create carries an idempotency key. An
//      existing price whose amount, currency, interval or tax behaviour
//      differs is a hard stop: Stripe prices are immutable, so "fixing" one
//      means a new price and a new lookup key, decided by a person.
//   4. `--dry-run` calls nothing. It does not even need a key.

import { pathToFileURL } from 'node:url';
import { loadPricing } from '../pricing.mjs';
import { assertAmountsMatchStripe } from '../pricing-core.mjs';

export const BLOB_SCHEMA = 'maude-live-catalog/v1';
const STRIPE_API = 'https://api.stripe.com';
const REQUEST_TIMEOUT_MS = 20_000;

/** 'live' | 'test' | 'absent' | 'unknown'. Never returns or logs the key. */
export function keyKind(key) {
  if (!key) return 'absent';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}

/**
 * The whole catalog as data: what would be created, nothing about how.
 * One entry per product, each with the prices pricing.json advertises. A null
 * amount (Dedicated has no annual price) is simply not planned.
 */
export function buildPlan(pricing, { taxCode = null } = {}) {
  const currency = pricing.currency;
  const taxBehavior = pricing.taxBehavior;
  if (taxBehavior !== 'exclusive') {
    throw new Error(
      `pricing.json taxBehavior is "${taxBehavior}"; the live catalog is created tax-exclusive ` +
        '(listed prices are net, Stripe adds VAT as merchant of record). Refusing to guess.'
    );
  }
  const intervals = [
    ['monthly', 'monthlyMinor', 'month'],
    ['annual', 'annualMinor', 'year'],
  ];
  const entries = [...pricing.plans, ...pricing.addons].map((item) => {
    const prices = intervals
      .filter(([, field]) => Number.isInteger(item.amounts[field]) && item.amounts[field] > 0)
      .map(([interval, field, stripeInterval]) => ({
        interval,
        stripeInterval,
        unitAmount: item.amounts[field],
        currency,
        taxBehavior,
        lookupKey: `maude_cloud_${item.id}_${interval}_${currency}_v1`,
      }));
    if (prices.length === 0) throw new Error(`${item.id} has no positive amount in pricing.json`);
    return {
      id: item.id,
      kind: pricing.plans.includes(item) ? 'plan' : 'addon',
      product: {
        id: `maude_cloud_${item.id}`,
        name: item.name,
        description: item.summary,
        taxCode,
      },
      prices,
    };
  });
  return entries;
}

/** Plain-text rendering of the plan, for the operator to read before a real run. */
export function describePlan(plan, currency) {
  const money = (minor) => `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  const lines = [];
  for (const entry of plan) {
    lines.push(`product ${entry.product.id}  "${entry.product.name}"`);
    for (const p of entry.prices) {
      lines.push(
        `  price ${p.lookupKey}  ${money(p.unitAmount)} / ${p.stripeInterval}  tax_behavior=${p.taxBehavior}`
      );
    }
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const opts = { dryRun: false, confirmLive: false, taxCode: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--confirm-live') opts.confirmLive = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--tax-code') opts.taxCode = argv[++i] ?? '';
    else if (a.startsWith('--tax-code=')) opts.taxCode = a.slice('--tax-code='.length);
    else throw new Error(`unknown argument "${a}" (see --help)`);
  }
  if (opts.taxCode !== null && !/^txcd_\d{8}$/.test(opts.taxCode)) {
    throw new Error('--tax-code must look like txcd_10103001 (a Stripe product tax code)');
  }
  return opts;
}

const HELP = `stripe-live-catalog.mjs — create the live Stripe catalog for Maude Cloud

  --dry-run         print the plan; call nothing; needs no key
  --confirm-live    required for a real run (and STRIPE_SECRET_KEY must be sk_live_/rk_live_)
  --tax-code CODE   optional Stripe product tax code for every product (e.g. txcd_10103001);
                    omitted = the account's default product tax code

The key is read from STRIPE_SECRET_KEY only. The id blob goes to stdout, everything else to stderr.
`;

class StripeError extends Error {}

/** One form-encoded Stripe call. Throws StripeError with a scrubbed message. */
async function stripeCall(ctx, method, path, params = null, idempotencyKey = null) {
  const headers = { authorization: `Bearer ${ctx.key}` };
  let body;
  if (params) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(params).toString();
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let res;
  try {
    res = await ctx.fetch(`${STRIPE_API}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new StripeError(ctx.scrub(`${method} ${path}: network error: ${err.message}`));
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error ?? {};
    const error = new StripeError(
      ctx.scrub(
        `${method} ${path}: ${res.status} ${e.type ?? 'error'}${e.code ? `/${e.code}` : ''}: ${e.message ?? 'no message'}`
      )
    );
    error.status = res.status;
    error.code = e.code;
    throw error;
  }
  return json;
}

function requireLive(object, what) {
  // Belt and braces next to the key prefix: Stripe says whether the object it
  // just returned lives in live mode. A mismatch means do not print this id.
  if (object?.livemode !== true) {
    throw new StripeError(
      `${what} came back with livemode=${object?.livemode}; refusing to use it`
    );
  }
}

async function ensureProduct(ctx, entry) {
  const id = entry.product.id;
  try {
    const existing = await stripeCall(ctx, 'GET', `/v1/products/${encodeURIComponent(id)}`);
    requireLive(existing, `product ${id}`);
    ctx.log(`  product ${id}: exists (${existing.id}), reusing`);
    return existing;
  } catch (err) {
    if (!(err instanceof StripeError) || err.status !== 404) throw err;
  }
  const params = {
    id,
    name: entry.product.name,
    description: entry.product.description,
    'metadata[maude_plan]': entry.id,
  };
  if (entry.product.taxCode) params.tax_code = entry.product.taxCode;
  const created = await stripeCall(
    ctx,
    'POST',
    '/v1/products',
    params,
    `maude-live-catalog-v1-product-${id}`
  );
  requireLive(created, `product ${id}`);
  ctx.log(`  product ${id}: created (${created.id})`);
  return created;
}

function sameShape(price, want) {
  return (
    price.unit_amount === want.unitAmount &&
    price.currency === want.currency &&
    price.tax_behavior === want.taxBehavior &&
    price.recurring?.interval === want.stripeInterval &&
    (price.recurring?.interval_count ?? 1) === 1 &&
    price.type === 'recurring'
  );
}

async function ensurePrice(ctx, entry, productId, want) {
  const found = await stripeCall(
    ctx,
    'GET',
    `/v1/prices?lookup_keys[]=${encodeURIComponent(want.lookupKey)}&limit=1`
  );
  const existing = found?.data?.[0];
  if (existing) {
    requireLive(existing, `price ${want.lookupKey}`);
    if (!sameShape(existing, want) || existing.product !== productId) {
      throw new StripeError(
        `price ${want.lookupKey} (${existing.id}) already exists with a different shape ` +
          `(amount ${existing.unit_amount}, ${existing.currency}, ${existing.recurring?.interval}, ` +
          `tax ${existing.tax_behavior}, product ${existing.product}). Stripe prices are ` +
          'immutable: create a NEW price under a new lookup key by hand, never edit this one.'
      );
    }
    ctx.log(`  price ${want.lookupKey}: exists (${existing.id}), reusing`);
    return existing;
  }
  const created = await stripeCall(
    ctx,
    'POST',
    '/v1/prices',
    {
      product: productId,
      currency: want.currency,
      unit_amount: String(want.unitAmount),
      tax_behavior: want.taxBehavior,
      'recurring[interval]': want.stripeInterval,
      lookup_key: want.lookupKey,
      nickname: `${entry.product.name} (${want.interval})`,
      'metadata[maude_plan]': entry.id,
      'metadata[maude_interval]': want.interval,
    },
    `maude-live-catalog-v1-price-${want.lookupKey}-${want.unitAmount}`
  );
  requireLive(created, `price ${want.lookupKey}`);
  if (!sameShape(created, want)) {
    throw new StripeError(
      `price ${want.lookupKey} was created with an unexpected shape; stop and inspect it in the dashboard`
    );
  }
  ctx.log(`  price ${want.lookupKey}: created (${created.id})`);
  return created;
}

/** Turn created objects into the blob (pricing.json `live` objects, by plan id). */
function toBlob(results) {
  const live = {};
  for (const r of results) {
    live[r.id] = { product: r.productId };
    live[r.id].monthly = r.prices.monthly ?? null;
    if (r.kind === 'plan') live[r.id].annual = r.prices.annual ?? null;
  }
  return { schema: BLOB_SCHEMA, live };
}

/**
 * Entry point with every side effect injected, so tests drive it with a stub.
 * Returns the process exit code.
 */
export async function run({
  argv = [],
  env = {},
  fetch: fetchImpl = globalThis.fetch,
  stdout = (s) => process.stdout.write(s),
  stderr = (s) => process.stderr.write(s),
  pricing = null,
} = {}) {
  const key = env.STRIPE_SECRET_KEY ?? '';
  const scrub = (text) => (key ? String(text).split(key).join('[redacted key]') : String(text));
  const log = (line) => stderr(`${scrub(line)}\n`);

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    log(`error: ${err.message}`);
    return 2;
  }
  if (opts.help) {
    stdout(HELP);
    return 0;
  }

  const source = pricing ?? loadPricing();
  let plan;
  try {
    plan = buildPlan(source, { taxCode: opts.taxCode });
  } catch (err) {
    log(`error: ${err.message}`);
    return 1;
  }

  const kind = keyKind(key);
  if (opts.dryRun) {
    log('DRY RUN — nothing is sent to Stripe.');
    log(describePlan(plan, source.currency));
    log(
      kind === 'live'
        ? 'key check: STRIPE_SECRET_KEY looks like a live key (a real run would proceed with --confirm-live)'
        : `key check: ${kind === 'absent' ? 'STRIPE_SECRET_KEY is not set' : `STRIPE_SECRET_KEY is a ${kind} key`} — a real run would refuse`
    );
    return 0;
  }

  if (kind !== 'live') {
    log(
      kind === 'absent'
        ? 'refused: STRIPE_SECRET_KEY is not set. Export a LIVE key (sk_live_/rk_live_) in this shell.'
        : `refused: STRIPE_SECRET_KEY is a ${kind} key. This script creates the LIVE catalog and runs only with sk_live_/rk_live_.`
    );
    return 1;
  }
  if (!opts.confirmLive) {
    log(
      'refused: a real run creates live products and prices. Review with --dry-run, then pass --confirm-live.'
    );
    return 1;
  }
  if (typeof fetchImpl !== 'function') {
    log('error: no fetch available (Node 18+ required)');
    return 1;
  }

  const ctx = { key, fetch: fetchImpl, scrub, log };
  log('Creating LIVE catalog…');
  const results = [];
  try {
    for (const entry of plan) {
      const product = await ensureProduct(ctx, entry);
      const prices = {};
      for (const want of entry.prices) {
        prices[want.interval] = (await ensurePrice(ctx, entry, product.id, want)).id;
      }
      results.push({ id: entry.id, kind: entry.kind, productId: product.id, prices });
    }

    // Stripe is the authority for amounts, not the JSON that fed this run:
    // read every new price back and compare, the same check the Worker's
    // tooling uses.
    const blob = toBlob(results);
    const filled = structuredClone(source);
    for (const item of [...filled.plans, ...filled.addons]) item.stripe.live = blob.live[item.id];
    const mismatches = await assertAmountsMatchStripe(
      (id) => stripeCall(ctx, 'GET', `/v1/prices/${encodeURIComponent(id)}`),
      { pricing: filled, mode: 'live' }
    );
    if (mismatches.length > 0) {
      for (const m of mismatches) log(`MISMATCH ${m.label} ${m.id}: ${m.problem}`);
      log('error: Stripe disagrees with pricing.json. Blob NOT printed — inspect the dashboard.');
      return 1;
    }
    log('Read-back OK: every live price matches pricing.json.');
    stdout(`${JSON.stringify(blob, null, 2)}\n`);
    log('Done. Next: save the blob above to a file and run fill-live-price-ids.mjs --in <file>.');
    return 0;
  } catch (err) {
    log(`error: ${err.message}`);
    if (results.length > 0) {
      log(
        `stopped after ${results.length} of ${plan.length} products. Re-running is safe: finished objects are reused.`
      );
    }
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run({ argv: process.argv.slice(2), env: process.env }).then((code) => {
    process.exitCode = code;
  });
}
