// V2-8.8 — the M7 verdict of scripts/v2-perf-summary.mjs (V2-1.8 §5.2): v2 passes only when its
// median p95 is within the pre-v2 median p95 + the pre-v2 spread AND its median long frames are
// within the pre-v2 median + its range. The summary is the instrument the V2-8.8 evidence is read
// with, so the rule itself is pinned.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SUMMARY = fileURLToPath(new URL('../v2-perf-summary.mjs', import.meta.url));

function row(p95, spread, long, range) {
  return {
    current: {
      p50FrameMs: 16.7,
      p95FrameMs: p95,
      p95SpreadMs: spread,
      zoomP95Ms: p95,
      longFrames: long,
      longFramesRange: range,
      jankFrames: 0,
      artboardRenders: 1800,
      boardsOnScreen: 21,
      kept: 5,
    },
  };
}

function batch(base, v2) {
  const dir = mkdtempSync(join(tmpdir(), 'maude-perf-summary-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'base-studio.json'), JSON.stringify(row(...base)));
  writeFileSync(join(dir, 'v2-studio.json'), JSON.stringify(row(...v2)));
  return dir;
}

const run = (dir) => spawnSync('node', [SUMMARY, dir], { encoding: 'utf8' });

test('v2 inside the pre-v2 spread passes M7', () => {
  const r = run(batch([20, 5, 2, 1], [24, 1, 3, 0]));
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /p95 v2 24 vs pre-v2 20 \+ spread 5 → PASS/);
  assert.match(r.stdout, /long frames v2 3 vs 2 \+ range 1 → PASS/);
});

test('v2 past the pre-v2 p95 + spread fails M7', () => {
  const r = run(batch([20, 5, 2, 1], [26, 1, 2, 0]));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /→ FAIL/);
});

test('v2 with more long frames than the pre-v2 range allows fails M7', () => {
  const r = run(batch([20, 5, 2, 1], [20, 1, 9, 0]));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /long frames v2 9 vs 2 \+ range 1 → FAIL/);
});
