// `describeChanges` budget (V2-1.9 §5.16): p95 ≤ 50 ms at landing on the largest v2 canvas (≤ 140 KB);
// a cold row (two parses) stays inside the "≤ 30 ms/row with per-artboard lazy models" line on average.
// Load-independent (#169 T8.1): read on the thread's CPU clock (`cpuMs`), so waiting for a core is not
// counted, and divided by the run's load factor (a fixed reference workload interleaved with the edits,
// `loadFactor`), so the slower CPU time of a loaded machine (another suite on the Mac mini lane) is not read
// as a regression either. Wall time is logged beside it.

import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describeChanges } from '../history/describe';
import { budget, cpuMs, loadFactor, PERF_SLACK, referenceMs } from './_perf-budget.ts';
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
    const wall: number[] = [];
    const ref: number[] = [];
    for (const [f] of largest) {
      const src = readFileSync(f, 'utf8');
      const edits = genEdits(f, src, mulberry32(7), 4).slice(0, 12);
      describeChanges(f, { tsx: src }, { tsx: src }); // warm the parser
      for (const e of edits) {
        ref.push(referenceMs());
        const r = cpuMs(() => describeChanges(f, { tsx: src }, { tsx: e.after }));
        ms.push(r.ms);
        wall.push(r.wallMs);
      }
    }
    expect(ms.length).toBeGreaterThan(20);
    const load = loadFactor(ref);
    console.log(
      `describe cpu ms: p50 ${percentile(ms, 50).toFixed(1)} p95 ${percentile(ms, 95).toFixed(1)} max ${Math.max(...ms).toFixed(1)} · wall p95 ${percentile(wall, 95).toFixed(1)} · load ×${load.toFixed(2)} → p95 ${(percentile(ms, 95) / load).toFixed(1)} (budget ×${PERF_SLACK})`
    );
    expect(percentile(ms, 95) / load).toBeLessThanOrEqual(budget(50));
  }, 60_000);

  test('a whole-canvas rewrite of the largest canvas stays inside a second', () => {
    const [f] = largest[0] as readonly [string, number];
    const a = readFileSync(f, 'utf8');
    const b = readFileSync((largest[1] as readonly [string, number])[0], 'utf8');
    const load = loadFactor([referenceMs(), referenceMs(), referenceMs()]);
    const r = cpuMs(() => describeChanges(f, { tsx: a }, { tsx: b }));
    expect(r.ms / load).toBeLessThan(budget(1000));
  }, 20_000);
});
