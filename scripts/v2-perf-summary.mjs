#!/usr/bin/env node
// scripts/v2-perf-summary.mjs — turn the JSON of one or more `v2-perf-bench.sh` batches into the
// V2-8.8 table and the V2-1.8 M7 verdict.
//
//   node scripts/v2-perf-summary.mjs <batch-dir> [<batch-dir>…]
//
// Per lane (studio / bare), per batch: the arm's median p95, its spread across kept passes, the
// median long frames (≥ 50 ms) and their range. M7 (V2-1.8 §5.2): v2 median p95 ≤ pre-v2 median p95
// + the pre-v2 spread, AND v2 median long frames ≤ pre-v2 median + its range. With several batches
// the pooled row takes the median of the batch medians and the widest spread/range seen (in a
// batch or between batches) — the honest reading of "within the pre-v2 spread".
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('usage: v2-perf-summary.mjs <batch-dir>…');
  process.exit(2);
}
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
const rng = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
const r1 = (x) => (x == null ? '—' : Math.round(x * 10) / 10);

function load(dir, arm, lane) {
  const f = join(dir, `${arm}-${lane}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')).current;
  } catch {
    return null;
  }
}

const out = [];
const verdicts = [];
for (const lane of ['studio', 'bare']) {
  const pooled = { base: [], v2: [] };
  out.push(
    `\n## ${lane} lane — Chromium${lane === 'studio' ? ', studio shell, dpr 2' : ', bare canvas page'}, fit-all`
  );
  out.push(
    '| batch | arm | p50 | p95 | p95 spread | zoom p95 | long frames (range) | jank ≥25 | artboard renders | boards | kept |'
  );
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const dir of dirs) {
    for (const arm of ['base', 'v2']) {
      const r = load(dir, arm, lane);
      if (!r) {
        out.push(`| ${dir.split('/').pop()} | ${arm} | missing | | | | | | | | |`);
        continue;
      }
      pooled[arm].push(r);
      out.push(
        `| ${dir.split('/').pop()} | ${arm} | ${r1(r.p50FrameMs)} | ${r1(r.p95FrameMs)} | ${r1(r.p95SpreadMs)} | ${r1(r.zoomP95Ms)} | ${r1(r.longFrames)} (${r1(r.longFramesRange)}) | ${r1(r.jankFrames)} | ${r1(r.artboardRenders)} | ${r.boardsOnScreen} | ${r.kept} |`
      );
    }
  }
  const b = pooled.base;
  const v = pooled.v2;
  if (!b.length || !v.length) continue;
  const bP95 = med(b.map((r) => r.p95FrameMs));
  const vP95 = med(v.map((r) => r.p95FrameMs));
  const spread = Math.max(...b.map((r) => r.p95SpreadMs ?? 0), rng(b.map((r) => r.p95FrameMs)));
  const bLong = med(b.map((r) => r.longFrames));
  const vLong = med(v.map((r) => r.longFrames));
  const lrange = Math.max(...b.map((r) => r.longFramesRange ?? 0), rng(b.map((r) => r.longFrames)));
  const okP95 = vP95 <= bP95 + spread;
  const okLong = vLong <= bLong + lrange;
  out.push(
    `\npooled (${b.length} batch${b.length > 1 ? 'es' : ''}): p95 v2 ${r1(vP95)} vs pre-v2 ${r1(bP95)} + spread ${r1(spread)} → ${okP95 ? 'PASS' : 'FAIL'}; ` +
      `long frames v2 ${r1(vLong)} vs ${r1(bLong)} + range ${r1(lrange)} → ${okLong ? 'PASS' : 'FAIL'}`
  );
  verdicts.push({ lane, okP95, okLong });
}
console.log(out.join('\n'));
process.exit(verdicts.every((v) => v.okP95 && v.okLong) ? 0 : 1);
