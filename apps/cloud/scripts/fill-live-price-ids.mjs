#!/usr/bin/env node
// Write the live Stripe ids into apps/cloud/pricing.json — Phase B, Task B2.
//
//   node apps/cloud/scripts/fill-live-price-ids.mjs --in live-ids.json --dry-run
//   node apps/cloud/scripts/fill-live-price-ids.mjs --in live-ids.json
//   … | node apps/cloud/scripts/fill-live-price-ids.mjs --in -
//
// The input is the blob stripe-live-catalog.mjs prints. This script does no
// network and holds no secret; it exists so the ids reach pricing.json by a
// checked path instead of by hand-editing the one file whose mistakes charge
// (or fail to charge) a real card.
//
// What it refuses, and why:
//   - a blob of the wrong schema, a missing plan, an id of the wrong shape, a
//     missing interval that pricing.json advertises, or a stray id for an
//     interval it does not — the guard in pricing-core.mjs would only say
//     "no live price configured" much later, on a customer's click;
//   - any id equal to a sandbox id. Pasting the SANDBOX blob is the one typo
//     that would make live mode charge nothing;
//   - overwriting a live id that is already filled with a different one. A
//     price in use by subscriptions is never swapped silently (--replace says
//     you meant it). Re-applying the same blob is a no-op.
//
// The edit is textual, line for line, so the diff is the four `live` lines and
// not a reformat of the whole file; the result is re-parsed and compared with
// the intended object before anything is written, and written atomically.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BLOB_SCHEMA } from './stripe-live-catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PRICING = join(HERE, '..', 'pricing.json');

const PRICE_RE = /^price_[A-Za-z0-9]{8,}$/;
// Stripe-generated (`prod_…`) or the fixed ids stripe-live-catalog.mjs gives its products.
const PRODUCT_RE = /^(prod_[A-Za-z0-9]{8,}|maude_cloud_[a-z0-9_]{1,40})$/;

function items(pricing) {
  return [
    ...pricing.plans.map((p) => ({ item: p, kind: 'plan' })),
    ...pricing.addons.map((a) => ({ item: a, kind: 'addon' })),
  ];
}

/** The slots pricing.json advertises for an item: monthly always, annual only with an annual amount. */
function slotsFor({ item, kind }) {
  return kind === 'plan' && item.amounts.annualMinor != null ? ['monthly', 'annual'] : ['monthly'];
}

/**
 * Check the blob against pricing.json and return the `live` object for every
 * item, ready to write. Throws one Error listing every problem found.
 */
export function validateBlob(blob, pricing, { replace = false } = {}) {
  const problems = [];
  if (!blob || typeof blob !== 'object') throw new Error('input is not a JSON object');
  if (blob.schema !== BLOB_SCHEMA) {
    problems.push(`schema is ${JSON.stringify(blob.schema)}, expected "${BLOB_SCHEMA}"`);
  }
  const live = blob.live;
  if (!live || typeof live !== 'object') {
    problems.push('missing "live" object');
    throw new Error(problems.join('\n'));
  }

  const wanted = items(pricing);
  const wantedIds = wanted.map((w) => w.item.id);
  for (const id of Object.keys(live)) {
    if (!wantedIds.includes(id))
      problems.push(`unexpected plan "${id}" (pricing.json has: ${wantedIds.join(', ')})`);
  }

  const sandboxIds = new Set();
  for (const w of wanted) {
    for (const v of Object.values(w.item.stripe.sandbox)) if (v) sandboxIds.add(v);
  }
  const seen = new Map();
  const result = {};

  for (const w of wanted) {
    const id = w.item.id;
    const given = live[id];
    if (!given || typeof given !== 'object') {
      problems.push(`${id}: missing from the blob`);
      continue;
    }
    const out = {};
    if (!PRODUCT_RE.test(given.product ?? '')) {
      problems.push(`${id}.product: ${JSON.stringify(given.product)} is not a product id`);
    }
    out.product = given.product;
    const slots = slotsFor(w);
    for (const slot of w.kind === 'plan' ? ['monthly', 'annual'] : ['monthly']) {
      const value = given[slot] ?? null;
      if (slots.includes(slot)) {
        if (!PRICE_RE.test(value ?? '')) {
          problems.push(
            `${id}.${slot}: ${JSON.stringify(value)} is not a price id, and pricing.json advertises this interval`
          );
        }
      } else if (value !== null) {
        problems.push(
          `${id}.${slot}: pricing.json advertises no ${slot} price for ${id}, but the blob has one`
        );
      }
      out[slot] = value;
    }
    for (const [slot, value] of Object.entries(out)) {
      if (!value) continue;
      if (sandboxIds.has(value)) {
        problems.push(`${id}.${slot}: ${value} is a SANDBOX id — this must be the live blob`);
      }
      if (seen.has(value))
        problems.push(`${id}.${slot}: ${value} is also used by ${seen.get(value)}`);
      seen.set(value, `${id}.${slot}`);
    }
    for (const slot of Object.keys(given)) {
      if (!(slot in out)) problems.push(`${id}.${slot}: unknown field`);
    }

    const current = w.item.stripe.live ?? {};
    for (const [slot, value] of Object.entries(out)) {
      const was = current[slot] ?? null;
      if (!replace && was && value && was !== value) {
        problems.push(
          `${id}.${slot}: live id is already ${was}; refusing to replace it with ${value} (pass --replace if subscriptions do not use it)`
        );
      }
    }
    result[id] = out;
  }

  if (problems.length > 0) throw new Error(problems.map((p) => `  - ${p}`).join('\n'));
  return result;
}

const q = (v) => (v === null || v === undefined ? 'null' : JSON.stringify(v));

/** Replace each item's `"live": {…}` line in the raw text; everything else stays byte for byte. */
export function applyLive(text, pricing, live) {
  let next = text;
  for (const w of items(pricing)) {
    const id = w.item.id;
    const anchor = `"id": ${JSON.stringify(id)}`;
    const first = next.indexOf(anchor);
    if (first === -1 || next.indexOf(anchor, first + 1) !== -1) {
      throw new Error(`pricing.json: expected exactly one ${anchor}`);
    }
    const liveStart = next.indexOf('"live": {', first);
    const liveEnd = liveStart === -1 ? -1 : next.indexOf('}', liveStart);
    // The block must belong to THIS item: no other item's anchor in between.
    const between = liveStart === -1 ? '' : next.slice(first + anchor.length, liveStart);
    if (liveStart === -1 || liveEnd === -1 || /"id":\s*"/.test(between)) {
      throw new Error(`pricing.json: could not find the "live" block of ${id}`);
    }
    const o = live[id];
    const fields =
      w.kind === 'plan'
        ? `"product": ${q(o.product)}, "monthly": ${q(o.monthly)}, "annual": ${q(o.annual)}`
        : `"product": ${q(o.product)}, "monthly": ${q(o.monthly)}`;
    next = `${next.slice(0, liveStart)}"live": { ${fields} }${next.slice(liveEnd + 1)}`;
  }
  // Prove the textual edit produced exactly the intended object.
  const expected = JSON.parse(text);
  for (const w of items(expected)) w.item.stripe.live = live[w.item.id];
  assert(
    JSON.stringify(JSON.parse(next)) === JSON.stringify(expected),
    'edited pricing.json is not what was intended'
  );
  return next;
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

function parseArgs(argv) {
  const opts = { in: null, pricing: DEFAULT_PRICING, dryRun: false, replace: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') opts.in = argv[++i];
    else if (a === '--pricing') opts.pricing = resolve(argv[++i] ?? '');
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--replace') opts.replace = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown argument "${a}" (see --help)`);
  }
  return opts;
}

const HELP = `fill-live-price-ids.mjs — put the live Stripe ids into apps/cloud/pricing.json

  --in FILE      the blob stripe-live-catalog.mjs printed ("-" = stdin)   [required]
  --pricing P    pricing.json to edit (default: apps/cloud/pricing.json)
  --dry-run      validate and show the change; write nothing
  --replace      allow overwriting a live id that is already filled with another one
`;

export function run({
  argv = [],
  readStdin = () => readFileSync(0, 'utf8'),
  stdout = (s) => process.stdout.write(s),
  stderr = (s) => process.stderr.write(s),
} = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr(`error: ${err.message}\n`);
    return 2;
  }
  if (opts.help) {
    stdout(HELP);
    return 0;
  }
  if (!opts.in) {
    stderr('error: --in <file|-> is required\n');
    return 2;
  }
  try {
    const raw = opts.in === '-' ? readStdin() : readFileSync(opts.in, 'utf8');
    let blob;
    try {
      blob = JSON.parse(raw);
    } catch {
      throw new Error('input is not valid JSON (pass exactly the blob printed on stdout)');
    }
    const text = readFileSync(opts.pricing, 'utf8');
    const pricing = JSON.parse(text);
    const live = validateBlob(blob, pricing, { replace: opts.replace });
    const next = applyLive(text, pricing, live);
    if (next === text) {
      stdout('No change: pricing.json already holds exactly these live ids.\n');
      return 0;
    }
    for (const [id, o] of Object.entries(live)) {
      stdout(
        `${id}: ${Object.entries(o)
          .map(([k, v]) => `${k}=${v}`)
          .join('  ')}\n`
      );
    }
    if (opts.dryRun) {
      stdout('Dry run: pricing.json not written.\n');
      return 0;
    }
    const tmp = `${opts.pricing}.tmp-${process.pid}`;
    writeFileSync(tmp, next);
    renameSync(tmp, opts.pricing);
    stdout(`Wrote ${opts.pricing}\n`);
    return 0;
  } catch (err) {
    stderr(`refused:\n${err.message}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = run({ argv: process.argv.slice(2) });
}
