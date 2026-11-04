// 2.0.4 task P — a canvas build outlives the request that started it.
//
// design.studyfi.com (self-hosted workspace cell, v2.0.3): the design-system board needed more than
// the sandbox's 20 s on a shared t3.large. The 20 s was BOTH the request's wait and the build's life,
// and a timed-out build is never cached, so every open started the same build again and lost it
// again: `/_health.render` showed cacheHits 0, timeouts 2, and the board never drew.
//
// Now: the request waits `waitMs`, then answers `building` while the build runs on up to the hard
// ceiling; its success is cached, so the next open is a hit. Concurrent opens share one build, and a
// newer source of the same canvas supersedes a running one. The worker here is a stand-in that
// sleeps (the delay is read from the design root — the sandbox hands the worker no environment).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  _resetBuildStats,
  buildCanvasSandboxed,
  buildStats,
  type SandboxBuildFail,
  sandboxBuildRunning,
  sandboxKnob,
} from '../canvas-build-sandbox.ts';

const FAKE_WORKER = `import { appendFileSync, readFileSync } from 'node:fs';
const [designRoot, canvasAbs] = process.argv.slice(2);
appendFileSync(designRoot + '/runs.log', 'x');
const delay = Number(readFileSync(designRoot + '/delay.txt', 'utf8'));
await Bun.sleep(delay);
console.log(JSON.stringify({ ok: true, js: 'export default 1;', locator: null, etag: 'e1', inputs: [canvasAbs] }));
`;

let workers: string;
let designRoot: string;
let canvasAbs: string;
let env: NodeJS.ProcessEnv;

const runs = () => {
  try {
    return readFileSync(join(designRoot, 'runs.log'), 'utf8').length;
  } catch {
    return 0;
  }
};
const delay = (ms: number) => writeFileSync(join(designRoot, 'delay.txt'), String(ms));
const build = (waitMs: number, ceilingMs = 10_000) =>
  buildCanvasSandboxed({ designRoot, canvasAbs, env, waitMs, ceilingMs });

beforeEach(() => {
  _resetBuildStats();
  workers = mkdtempSync(join(tmpdir(), 'bg-build-workers-'));
  writeFileSync(join(workers, 'canvas-build-worker.ts'), FAKE_WORKER);
  designRoot = mkdtempSync(join(tmpdir(), 'bg-build-root-'));
  canvasAbs = join(designRoot, 'board.tsx');
  writeFileSync(canvasAbs, 'export default function B() { return null; }\n');
  env = { PATH: process.env.PATH, HOME: process.env.HOME, MAUDE_CANVAS_WORKERS: workers };
});

afterEach(() => {
  _resetBuildStats();
  rmSync(workers, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

describe('a build that outlives its request', () => {
  test('the request answers `building`, the build finishes and is cached, the next open is a hit', async () => {
    delay(1500);
    const first = await build(200);
    expect(first.ok).toBe(false);
    expect((first as SandboxBuildFail).kind).toBe('building');
    expect(sandboxBuildRunning(canvasAbs)).toBe(true);
    const settled = await (first as SandboxBuildFail).settled;
    expect(settled?.ok).toBe(true);
    expect(sandboxBuildRunning(canvasAbs)).toBe(false);
    const again = await build(200);
    expect(again.ok).toBe(true);
    expect(again.ok && again.cached).toBe(true);
    expect(runs()).toBe(1);
    const s = buildStats();
    expect(s.cacheHits).toBe(1);
    expect(s.stillBuilding).toBe(1);
    expect(s.timeouts).toBe(0);
  }, 15_000);

  test('a request that gave up and comes back while it still runs joins the same build', async () => {
    delay(1500);
    const first = await build(100);
    expect((first as SandboxBuildFail).kind).toBe('building');
    const second = await build(5000);
    expect(second.ok).toBe(true);
    expect(runs()).toBe(1);
  }, 15_000);

  test('concurrent opens of the same source share one build', async () => {
    delay(800);
    const all = await Promise.all([build(5000), build(5000), build(5000)]);
    expect(all.every((r) => r.ok)).toBe(true);
    expect(runs()).toBe(1);
    expect(buildStats().cacheMisses).toBe(1);
  }, 15_000);

  test('past the hard ceiling the build is stopped: timed-out, nothing cached', async () => {
    delay(3000);
    const first = await build(100, 600);
    expect((first as SandboxBuildFail).kind).toBe('building');
    const settled = await (first as SandboxBuildFail).settled;
    expect(settled?.ok).toBe(false);
    expect((settled as SandboxBuildFail).kind).toBe('timeout');
    expect(buildStats().timeouts).toBe(1);
    expect(sandboxBuildRunning(canvasAbs)).toBe(false);
    delay(10);
    const next = await build(5000);
    expect(next.ok && next.cached).toBe(false);
    expect(runs()).toBe(2);
  }, 15_000);

  test('a newer source of the same canvas supersedes the running build', async () => {
    delay(3000);
    const old = await build(100);
    expect((old as SandboxBuildFail).kind).toBe('building');
    writeFileSync(canvasAbs, 'export default function B() { return 2; }\n// edited\n');
    delay(10);
    const fresh = await build(5000);
    expect(fresh.ok).toBe(true);
    const oldOutcome = await (old as SandboxBuildFail).settled;
    expect((oldOutcome as SandboxBuildFail).kind).toBe('building');
    expect(buildStats().failures).toBe(0);
    expect(runs()).toBe(2);
  }, 15_000);
});

describe('sandboxKnob', () => {
  test('a whole number inside the range is used', () => {
    expect(sandboxKnob({ K: '90000' }, 'K', 20_000, 5_000, 600_000)).toBe(90_000);
  });
  test('absent or empty → the default', () => {
    expect(sandboxKnob({}, 'K', 20_000, 5_000, 600_000)).toBe(20_000);
    expect(sandboxKnob({ K: '' }, 'K', 20_000, 5_000, 600_000)).toBe(20_000);
  });
  test('not a number → the default (a NaN deadline fired at once)', () => {
    for (const v of ['90s', 'abc', '1e5', '-5', '12.5'])
      expect(sandboxKnob({ [`K_${v}`]: v }, `K_${v}`, 20_000, 5_000, 600_000)).toBe(20_000);
  });
  test('outside the range → clamped', () => {
    expect(sandboxKnob({ A: '10' }, 'A', 20_000, 5_000, 600_000)).toBe(5_000);
    expect(sandboxKnob({ B: '99999999' }, 'B', 20_000, 5_000, 600_000)).toBe(600_000);
  });
});
