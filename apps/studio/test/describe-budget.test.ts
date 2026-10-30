// `describeChanges` budget (V2-1.9 §5.16): p95 ≤ 50 ms at landing on the largest v2 canvas (≤ 140 KB);
// a cold row (two parses) stays inside the "≤ 30 ms/row with per-artboard lazy models" line on average.

import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describeChanges } from '../history/describe';
import { budget, PERF_SLACK } from './_perf-budget.ts';
import { genEdits, listCanvases, mulberry32, percentile } from './fixtures/describe-corpus/measure';

describe('describeChanges budget', () => {
  const root = join(import.meta.dir, '..', '..', '..', '.design');
  const files = listCanvases(root, true);
  const largest = files
    .map((f) => [f, statSync(f).size] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  test('the largest v2 canvases are really large', () => {
    expect((largest[0] as readonly [string, number])[1]).toBeGreaterThan(100_000);
  });

  test('p95 ≤ 50 ms on the four largest v2 canvases, one edit at a time', () => {
    const ms: number[] = [];
    for (const [f] of largest) {
      const src = readFileSync(f, 'utf8');
      const edits = genEdits(f, src, mulberry32(7), 4).slice(0, 12);
      describeChanges(f, { tsx: src }, { tsx: src }); // warm the parser
      for (const e of edits) ms.push(describeChanges(f, { tsx: src }, { tsx: e.after }).ms);
    }
    expect(ms.length).toBeGreaterThan(20);
    console.log(
      `describe ms: p50 ${percentile(ms, 50).toFixed(1)} p95 ${percentile(ms, 95).toFixed(1)} max ${Math.max(...ms).toFixed(1)} (budget ×${PERF_SLACK})`
    );
    expect(percentile(ms, 95)).toBeLessThanOrEqual(budget(50));
  }, 60_000);

  test('a whole-canvas rewrite of the largest canvas stays inside a second', () => {
    const [f] = largest[0] as readonly [string, number];
    const a = readFileSync(f, 'utf8');
    const b = readFileSync((largest[1] as readonly [string, number])[0], 'utf8');
    const r = describeChanges(f, { tsx: a }, { tsx: b });
    expect(r.ms).toBeLessThan(budget(1000));
  }, 20_000);
});
