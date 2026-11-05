#!/usr/bin/env node
// Mirror the dev-server "What's New" feed into the site so the /whats-new page
// can render it. a build may see only site/, so site/lib/whats-new.json is
// COMMITTED (same rationale as roadmap.json) — the feed itself lives with the
// dev-server (apps/studio/whats-new.json, the single source of
// truth, DDR-A) and may be absent at deploy time.
//
// Reads:
//   apps/studio/whats-new.json        (entries)
//   plugins/design/.claude-plugin/plugin.json       (current version)
//
// Output: site/lib/whats-new.json  { generated, version, entries }
// Run as a prebuild step — see site/package.json `prebuild`.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const feedPath = resolve(repoRoot, 'apps/studio/whats-new.json');
const manifestPath = resolve(repoRoot, 'plugins/design/.claude-plugin/plugin.json');
const out = resolve(__dirname, '../lib/whats-new.json');

const KINDS = new Set(['feature', 'improvement', 'usage', 'fix']);

// Lightweight, dependency-free validation (the dev-server's whats-new.schema.json
// is the full contract; this is the build-time gate the plan's Task 7 calls for).
// A malformed feed fails the build rather than shipping bad data — notably it
// rejects a non-http(s) learnMore that would otherwise reach an <a href>.
function validateEntries(list) {
  list.forEach((e, idx) => {
    const at = `entries[${idx}]${e?.id ? ` (${e.id})` : ''}`;
    if (!e || typeof e !== 'object') throw new Error(`[whats-new] ${at}: not an object`);
    if (typeof e.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(e.id))
      throw new Error(`[whats-new] ${at}: invalid id`);
    if (!KINDS.has(e.kind)) throw new Error(`[whats-new] ${at}: invalid kind "${e.kind}"`);
    if (typeof e.title !== 'string' || !e.title)
      throw new Error(`[whats-new] ${at}: missing title`);
    if (typeof e.summary !== 'string' || !e.summary)
      throw new Error(`[whats-new] ${at}: missing summary`);
    if (e.learnMore != null && !/^https?:\/\//.test(e.learnMore))
      throw new Error(`[whats-new] ${at}: learnMore must be an http(s) URL`);
  });
}

let entries = [];
if (existsSync(feedPath)) {
  const parsed = JSON.parse(readFileSync(feedPath, 'utf8'));
  if (Array.isArray(parsed.entries)) entries = parsed.entries;
  validateEntries(entries);
} else {
  // No feed ⇒ not in the repo (a build may see only site/). Keep the committed
  // mirror instead of overwriting it with an empty one — same guard as
  // build-roadmap.mjs.
  console.warn('[whats-new] feed not found — keeping the committed whats-new.json untouched');
  process.exit(0);
}

let version = 'dev';
if (existsSync(manifestPath)) {
  try {
    const v = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
    if (typeof v === 'string') version = v;
  } catch {
    /* fall through to dev */
  }
}

// `generated` must be DETERMINISTIC (a function of the inputs, never the
// clock) so the site-content drift gate can regenerate and `git diff` this
// file — a build timestamp made every regen dirty, which is exactly why this
// mirror sat outside the gate and went stale for a whole release (v1.0.0
// shipped while the site still advertised 0.60.7). The changelog page only
// renders the date part, and the newest stamped entry date IS the last
// release — more truthful than "when did CI last run".
const newestStamped = entries
  .map((e) => e.date)
  .filter((d) => typeof d === 'string')
  .sort()
  .at(-1);
const payload = {
  generated: newestStamped ? `${newestStamped}T00:00:00.000Z` : null,
  version,
  entries,
};
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`[whats-new] wrote ${out} — ${entries.length} entries (v${version})`);
