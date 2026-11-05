#!/usr/bin/env node
// Run one shard of the apps/studio test suite and say where it is.
//
//   node scripts/studio-shard-run.mjs --total 6 --index 2 [--out shard-2.json]
//
// Runs `bun test --isolate --timeout 20000 <this shard's files>` in apps/studio
// (the full-suite invocation, narrowed to a file list — see studio-shard.mjs),
// and while it runs:
//
// - prefixes every file's log group with its place, `[41/303] test/foo.test.ts`,
//   so the Actions log reads as progress instead of an undifferentiated wall;
// - counts pass / fail / skip and times each file;
// - refuses a short run: bun's closing "Ran N tests across M files" must name
//   exactly this shard's file count, or the shard fails. A path that matched
//   nothing would otherwise pass quietly (a shard that tests nothing is green);
// - writes a step summary (totals, failures, slowest files) and, with --out,
//   a JSON result the "Studio suite (full)" job merges across shards.
//
// The exit code is bun's, or 1 when the file count is short.

import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { isSyncLane, loadTimings, planShards, studioTestFiles } from './studio-shard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const total = Number(arg('--total'));
const index = Number(arg('--index'));
const outPath = arg('--out');
if (
  !Number.isInteger(total) ||
  total < 1 ||
  !Number.isInteger(index) ||
  index < 1 ||
  index > total
) {
  console.error('usage: studio-shard-run.mjs --total N --index 1..N [--out result.json]');
  process.exit(2);
}

const files = planShards(
  studioTestFiles().filter((f) => !isSyncLane(f)),
  total,
  loadTimings()
)[index - 1].files;

// A file header is `##[group]<file>:` under GitHub Actions and `<file>:` elsewhere.
const HEADER = /^(?:##\[group\])?(\S+(?:\.|_)(?:test|spec)\.[a-z]+):\s*$/;
const RESULT = /^\((pass|fail|skip|todo)\) (.*?)(?: \[[\d.]+m?s\])?$/;
const TALLY = /^\s*(\d+) (pass|fail|skip|todo)$/;
const RAN = /Ran (\d+) tests? across (\d+) files?\./;

const started = Date.now();
const timings = {};
const failures = [];
const counts = { pass: 0, fail: 0, skip: 0, todo: 0 };
let current = null;
let currentStart = started;
let seen = 0;
let ranFiles = null;

function closeFile(now) {
  if (current) timings[current] = Math.round((now - currentStart) / 10) / 100;
}

// bun colours its output under GitHub Actions, so match on the line without ANSI codes.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes
const ANSI = /\x1b\[[0-9;]*m/g;

function onLine(raw, stream) {
  const line = raw.replace(ANSI, '');
  const header = HEADER.exec(line);
  if (header) {
    const now = Date.now();
    closeFile(now);
    current = header[1];
    currentStart = now;
    seen += 1;
    const label = `[${seen}/${files.length}] ${current}`;
    stream.write(line.startsWith('##[group]') ? `##[group]${label}:\n` : `${label}:\n`);
    return;
  }
  // Per-test `(pass)` lines appear only under GitHub Actions (or a TTY); `(fail)`
  // lines always do. The totals come from bun's closing ` 7 pass` lines.
  const result = RESULT.exec(line);
  if (result?.[1] === 'fail') failures.push({ file: current, name: result[2] });
  const tally = TALLY.exec(line);
  if (tally) counts[tally[2]] = Number(tally[1]);
  const ran = RAN.exec(line);
  if (ran) ranFiles = Number(ran[2]);
  stream.write(`${raw}\n`);
}

console.log(`Studio suite shard ${index}/${total}: ${files.length} files`);
const child = spawn(
  'bun',
  ['test', '--isolate', '--timeout', '20000', ...files.map((f) => `./${f}`)],
  {
    cwd: join(ROOT, 'apps', 'studio'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  }
);
const done = Promise.all([
  new Promise((r) =>
    createInterface({ input: child.stdout })
      .on('line', (l) => onLine(l, process.stdout))
      .on('close', r)
  ),
  new Promise((r) =>
    createInterface({ input: child.stderr })
      .on('line', (l) => onLine(l, process.stderr))
      .on('close', r)
  ),
]);
const code = await new Promise((r) => child.on('close', (c, sig) => r(c ?? (sig ? 1 : 0))));
await done;
closeFile(Date.now());

const seconds = Math.round((Date.now() - started) / 1000);
const short = ranFiles !== files.length;
if (short) {
  console.log(
    `::error::Studio suite shard ${index}/${total} ran ${ranFiles ?? 'no'} files, expected ${files.length} — a path matched nothing or the run died early.`
  );
}

const result = {
  index,
  total,
  files: files.length,
  ranFiles,
  ...counts,
  seconds,
  code,
  failures,
  timings,
};
if (outPath) writeFileSync(outPath, `${JSON.stringify(result, null, 1)}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const slow = Object.entries(timings)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const md = [
    `### Studio suite shard ${index}/${total} — ${code === 0 && !short ? 'passed' : 'FAILED'}`,
    '',
    `${files.length} files · ${counts.pass} pass · ${counts.fail} fail · ${counts.skip} skip · ${Math.floor(seconds / 60)} min ${seconds % 60} s`,
    '',
    ...(failures.length
      ? ['**Failures**', '', ...failures.map((f) => `- \`${f.file ?? '?'}\` — ${f.name}`), '']
      : []),
    '<details><summary>Slowest files</summary>',
    '',
    '| s | file |',
    '|--:|---|',
    ...slow.map(([f, s]) => `| ${s.toFixed(1)} | \`${f}\` |`),
    '',
    '</details>',
    '',
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

process.exit(code !== 0 ? code : short ? 1 : 0);
