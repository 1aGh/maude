#!/usr/bin/env node
// Split the apps/studio test suite into N shards of roughly equal run time.
//
// The full suite ran as ONE `bun test` on one runner: 1962 files, ~36 min, and
// a log nobody could find their way around. quality.yml now runs it as a matrix
// of shards; this script decides which files each shard gets.
//
//   node scripts/studio-shard.mjs --total 6 --index 2      files of shard 2 (1-based), one per line
//   node scripts/studio-shard.mjs --total 6 --plan         every shard's file count and estimated time
//
// - The file set is `git ls-files` under apps/studio matching bun's own test
//   name rule, so a shard can never run an untracked file a laptop happens to
//   have (on 2026-11-05 this set was identical to the 1962 files bun found).
// - The sync lane (`test/sync-*.test.ts`) is left out: the required Quality
//   job already runs exactly that glob, so running it here as well cost ~6 min
//   of every PR for no new signal. `test/sync-*.test.tsx` is NOT in that glob
//   and stays in the shards.
// - Balancing is longest-first onto the least-loaded shard, using the per-file
//   wall times in scripts/studio-test-timings.json (taken from a green CI run;
//   the Studio suite (full) job writes a fresh copy as an artifact on every
//   run). A file with no timing yet counts as the median.
// - Paths are printed `./`-prefixed: a bare `bun test test/foo.test.ts` is a
//   substring FILTER, and a filter can match staged copies elsewhere in the
//   tree (memory maude-bun-test-path-filter-copies).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(ROOT, 'apps', 'studio');
const TIMINGS = join(ROOT, 'scripts', 'studio-test-timings.json');

// bun test's discovery rule: *.test.*, *_test.*, *.spec.*, *_spec.* with a JS/TS extension.
const TEST_FILE = /(?:\.|_)(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
// Exactly the required sync lane's glob in quality.yml: `bun test --isolate test/sync-*.test.ts`.
const SYNC_LANE = /^test\/sync-[^/]*\.test\.ts$/;

export function studioTestFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: STUDIO,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  return out
    .split('\0')
    .filter((f) => f && TEST_FILE.test(f) && !f.startsWith('node_modules/'))
    .sort();
}

export function isSyncLane(file) {
  return SYNC_LANE.test(file);
}

export function loadTimings(path = TIMINGS) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Longest-processing-time-first: deterministic for a given file list and timing table. */
export function planShards(files, total, timings = {}) {
  if (!Number.isInteger(total) || total < 1)
    throw new Error(`--total must be a positive integer (got ${total})`);
  const known = files.map((f) => timings[f]).filter((s) => typeof s === 'number' && s >= 0);
  const sorted = [...known].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
  const cost = (f) => (typeof timings[f] === 'number' && timings[f] >= 0 ? timings[f] : median);
  const shards = Array.from({ length: total }, () => ({ files: [], seconds: 0 }));
  const order = [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b));
  for (const f of order) {
    let best = shards[0];
    for (const s of shards) if (s.seconds < best.seconds) best = s;
    best.files.push(f);
    best.seconds += cost(f);
  }
  for (const s of shards) s.files.sort();
  return shards;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const total = Number(arg('--total'));
  const files = studioTestFiles().filter((f) => !isSyncLane(f));
  const shards = planShards(files, total, loadTimings());
  if (process.argv.includes('--plan')) {
    for (const [i, s] of shards.entries()) {
      console.log(
        `shard ${i + 1}/${total}: ${s.files.length} files, ~${(s.seconds / 60).toFixed(1)} min`
      );
    }
    console.log(`total: ${files.length} files (sync lane excluded)`);
  } else {
    const index = Number(arg('--index'));
    if (!Number.isInteger(index) || index < 1 || index > total) {
      console.error(`--index must be 1..${total} (got ${arg('--index')})`);
      process.exit(2);
    }
    for (const f of shards[index - 1].files) console.log(`./${f}`);
  }
}
