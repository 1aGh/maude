#!/usr/bin/env node
// Merge the studio-suite shard results into one summary and a fresh timing table.
//
//   node scripts/studio-shard-summary.mjs <dir-with-shard-*.json> --total N [--timings-out file]
//
// Writes the "Studio suite (full)" step summary (one row per shard, every
// failure, the slowest files overall) and, with --timings-out, the per-file
// times of this run in the shape of scripts/studio-test-timings.json, so the
// committed table can be refreshed from a green run. Exits 1 when a shard's
// result is missing, failed, or ran fewer files than it was given.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const ti = process.argv.indexOf('--total');
const total = Number(ti === -1 ? NaN : process.argv[ti + 1]);
const oi = process.argv.indexOf('--timings-out');
const timingsOut = oi === -1 ? undefined : process.argv[oi + 1];
if (!dir || !Number.isInteger(total) || total < 1) {
  console.error('usage: studio-shard-summary.mjs <dir> --total N [--timings-out file]');
  process.exit(2);
}

const rows = [];
const failures = [];
const timings = {};
let bad = false;
for (let i = 1; i <= total; i++) {
  const path = join(dir, `shard-${i}.json`);
  if (!existsSync(path)) {
    rows.push(`| ${i} | — | — | — | — | missing (the shard did not finish) |`);
    bad = true;
    continue;
  }
  const r = JSON.parse(readFileSync(path, 'utf8'));
  const ok = r.code === 0 && r.ranFiles === r.files;
  if (!ok) bad = true;
  rows.push(
    `| ${i} | ${r.files} | ${r.pass} | ${r.fail} | ${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')} | ${ok ? 'passed' : 'FAILED'} |`
  );
  failures.push(...r.failures);
  Object.assign(timings, r.timings);
}

const slow = Object.entries(timings)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);
const md = [
  `## Studio suite (full) — ${bad ? 'FAILED' : 'passed'}`,
  '',
  '| shard | files | pass | fail | time | result |',
  '|--:|--:|--:|--:|--:|---|',
  ...rows,
  '',
  ...(failures.length
    ? ['**Failures**', '', ...failures.map((f) => `- \`${f.file ?? '?'}\` — ${f.name}`), '']
    : []),
  '<details><summary>Slowest files overall</summary>',
  '',
  '| s | file |',
  '|--:|---|',
  ...slow.map(([f, s]) => `| ${s.toFixed(1)} | \`${f}\` |`),
  '',
  '</details>',
  '',
].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (timingsOut) {
  const sorted = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(timingsOut, `${JSON.stringify(sorted, null, 1)}\n`);
}
process.exit(bad ? 1 : 0);
