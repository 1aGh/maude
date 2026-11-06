// 2.0.7 (#3) — canvas builds are bounded ACROSS canvases, not only per canvas.
//
// design.studyfi.com, 2.0.6: opening the studyfi-v3 Design system canvas took the studio's process
// tree to 2.0 GB of a 2.85 GiB container at 90–139 % CPU. Measured on a copy: the board plus its 58
// specimens asked for at once started 48 sandbox workers together (1.2 GB resident), and the board's
// own build went from 0.7 s to 6.3 s. The fake worker here logs `s` when it starts and `e` when it
// ends, so the log's running count is how many ran at once.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  _resetBuildStats,
  BUILD_CONCURRENCY,
  buildCanvasSandboxed,
  buildSlotStats,
  createBuildSlots,
} from '../canvas-build-sandbox.ts';

const FAKE_WORKER = `import { appendFileSync } from 'node:fs';
const [designRoot, canvasAbs] = process.argv.slice(2);
appendFileSync(designRoot + '/runs.log', 's');
await Bun.sleep(250);
appendFileSync(designRoot + '/runs.log', 'e');
console.log(JSON.stringify({ ok: true, js: 'export default 1;', locator: null, etag: canvasAbs, inputs: [canvasAbs] }));
`;

const maxAtOnce = (log: string) => {
  let n = 0;
  let max = 0;
  for (const c of log) {
    n += c === 's' ? 1 : -1;
    max = Math.max(max, n);
  }
  return max;
};

describe('build slots', () => {
  test('a slot runs at most `limit` tasks, the rest in the order they were asked for', async () => {
    const slots = createBuildSlots(2);
    const order: string[] = [];
    let live = 0;
    let peak = 0;
    const task = (id: string) => async () => {
      live++;
      peak = Math.max(peak, live);
      order.push(id);
      await Bun.sleep(20);
      live--;
      return id;
    };
    const out = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => slots.run(task(id))));
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(peak).toBe(2);
    expect(order).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(slots.stats()).toEqual({ active: 0, queued: 0, limit: 2 });
  });

  test('a task that throws frees its slot', async () => {
    const slots = createBuildSlots(1);
    await expect(slots.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await slots.run(async () => 7)).toBe(7);
  });
});

describe('the sandbox, many canvases at once', () => {
  let workers: string;
  let designRoot: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    _resetBuildStats();
    workers = mkdtempSync(join(tmpdir(), 'slots-workers-'));
    writeFileSync(join(workers, 'canvas-build-worker.ts'), FAKE_WORKER);
    designRoot = mkdtempSync(join(tmpdir(), 'slots-root-'));
    env = { PATH: process.env.PATH, HOME: process.env.HOME, MAUDE_CANVAS_WORKERS: workers };
  });
  afterEach(() => {
    rmSync(workers, { recursive: true, force: true });
    rmSync(designRoot, { recursive: true, force: true });
  });

  test('eight canvases opened together never run more than BUILD_CONCURRENCY workers', async () => {
    const canvases = Array.from({ length: 8 }, (_, i) => {
      const abs = join(designRoot, `c${i}.tsx`);
      writeFileSync(abs, `export default function C${i}() { return null; }\n`);
      return abs;
    });
    const results = await Promise.all(
      canvases.map((canvasAbs) =>
        buildCanvasSandboxed({ designRoot, canvasAbs, env, waitMs: 30_000, ceilingMs: 30_000 })
      )
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const log = readFileSync(join(designRoot, 'runs.log'), 'utf8');
    expect(log.length).toBe(16);
    expect(BUILD_CONCURRENCY).toBe(2);
    expect(maxAtOnce(log)).toBe(BUILD_CONCURRENCY);
    expect(buildSlotStats()).toEqual({ active: 0, queued: 0, limit: BUILD_CONCURRENCY });
  }, 30_000);
});
