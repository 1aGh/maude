#!/usr/bin/env node
// Errors-only lint ratchet for apps/studio/client (V2-2.2, T3).
//
//   node scripts/check-lint-ratchet.mjs            # check (part of `pnpm lint`)
//   node scripts/check-lint-ratchet.mjs --update   # rewrite the baseline after a count went DOWN
//
// The client had never been linted. Its v1 debt — the rules that already fail there — is set to
// `warn` for apps/studio/client/** in biome.jsonc, so `biome check .` covers the client and every
// OTHER rule is an error from day one. This script keeps the debt from growing: for each rule in
// the baseline it counts Biome's findings per file and fails when any (file, rule) count rises or
// a new (file, rule) pair appears. Fixing debt lowers a count; `--update` then tightens the
// baseline (it refuses to write while anything is above it). Parse errors are never ratcheted.
// Exit 0 = at or below the baseline; 1 = over it (printed); 2 = could not run.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts/lint-ratchet/client.json');
const TARGET = 'apps/studio/client';
const UPDATE = process.argv.includes('--update');

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const rules = new Set(baseline.rules);

const r = spawnSync(
  join(ROOT, 'node_modules/.bin/biome'),
  ['lint', TARGET, '--reporter=json', '--max-diagnostics=none'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
);
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error(
    `lint-ratchet: could not read Biome's report\n${(r.stderr || r.stdout).slice(-2000)}`
  );
  process.exit(2);
}

const fileOf = (d) =>
  typeof d.location?.path === 'string' ? d.location.path : d.location?.path?.file;
const counts = {};
const problems = [];
for (const d of report.diagnostics ?? []) {
  const file = fileOf(d);
  if (d.category === 'parse') {
    problems.push(`${file}: parse error — ${d.description ?? ''}`.trim());
    continue;
  }
  if (!rules.has(d.category)) continue;
  counts[file] ??= {};
  counts[file][d.category] = (counts[file][d.category] ?? 0) + 1;
}

let lower = 0;
for (const [file, byRule] of Object.entries(counts)) {
  for (const [rule, n] of Object.entries(byRule)) {
    const max = baseline.counts[file]?.[rule] ?? 0;
    if (n > max) problems.push(`${file}: ${rule} ${n} > baseline ${max}`);
  }
}
for (const [file, byRule] of Object.entries(baseline.counts)) {
  for (const [rule, max] of Object.entries(byRule)) {
    if ((counts[file]?.[rule] ?? 0) < max) lower++;
  }
}

const total = (c) =>
  Object.values(c).reduce((a, byRule) => a + Object.values(byRule).reduce((x, y) => x + y, 0), 0);

if (problems.length) {
  for (const p of problems) console.log(`FAIL ${p}`);
  console.log(
    `lint-ratchet: ${problems.length} problem(s) — fix the new finding (or mark a deliberate exception with a biome-ignore comment and its reason)`
  );
  process.exit(1);
}
if (UPDATE) {
  const sorted = Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((f) => [
        f,
        Object.fromEntries(
          Object.keys(counts[f])
            .sort()
            .map((k) => [k, counts[f][k]])
        ),
      ])
  );
  writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, counts: sorted }, null, 2)}\n`);
  console.log(
    `lint-ratchet: baseline rewritten — ${total(sorted)} finding(s) (was ${total(baseline.counts)})`
  );
  process.exit(0);
}
console.log(
  `lint-ratchet: ${total(counts)} v1 finding(s) across ${rules.size} rules, at or below the baseline (${total(baseline.counts)})` +
    (lower ? ` — ${lower} count(s) went down; run with --update to tighten it` : '')
);
