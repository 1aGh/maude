// S8.4 — Retry re-runs ONLY the items that did not make it, and only for the member who asked.
//
// "Exported 114 of 115" is a group job whose one item failed: `retry(id)` runs that item again and
// leaves the 114 alone, folds the new file into the job's result (one zip), and a member who is
// not the job's owner gets exactly what a missing id gets (V2-1.16 U1) — the runner never sees the
// call. The queue takes its engine call as a dependency so a unit can fail on cue.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

import { createBus } from '../context.ts';
import type { ExportResult } from '../exporters/index.ts';
import { createExportJobQueue, type EnqueueArgs, type ExportJob } from '../exporters/jobs.ts';
import type { SpecUnit } from '../exporters/scope.ts';
import type { GroupPlan } from '../exporters/spec-run.ts';

const ALICE = 'aaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbb';

function designRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'maude-retry-'));
  const design = join(root, '.design');
  mkdirSync(design, { recursive: true });
  return design;
}

function unit(n: number): SpecUnit {
  return {
    id: `u${n}`,
    format: 'png',
    scope: 'artboard',
    options: { artboardId: `board-${n}` },
    canvas: 'ui/Home.tsx',
    artboards: [{ id: `board-${n}`, label: `Board ${n}`, kind: 'fixed', w: 100, h: 100 }],
    kind: 'fixed',
    v2: {},
    degraded: [],
  };
}

function plan(count: number): GroupPlan {
  return {
    spec: { v: 2, scope: 'canvas', format: 'png' },
    units: Array.from({ length: count }, (_, i) => unit(i + 1)),
    project: 'Club',
    date: new Date('2026-10-18T10:00:00'),
  };
}

function args(group: GroupPlan, session: string): EnqueueArgs {
  const dr = designRoot();
  return {
    format: 'png',
    scope: 'artboard',
    options: {},
    resolve: {
      activeJson: { active: null, selected: null },
      designRoot: dr,
      repoRoot: join(dr, '..'),
    },
    ctx: { designRoot: dr, repoRoot: join(dr, '..'), serverOrigin: 'http://127.0.0.1:1' },
    session,
    group,
  };
}

/** A fake engine: every call is recorded; `failing` units throw until `heal()`. */
function fakeEngine() {
  const calls: string[] = [];
  const failing = new Set<string>();
  const run = async (a: { options: Record<string, unknown> }): Promise<ExportResult> => {
    const board = String(a.options.artboardId);
    calls.push(board);
    if (failing.has(board)) throw new Error(`${board} could not render`);
    return {
      filename: `${board}.png`,
      contentType: 'image/png',
      body: new TextEncoder().encode(`png:${board}`),
    };
  };
  return { calls, failing, run };
}

const wait = async (get: () => ExportJob | undefined, until: (j: ExportJob) => boolean) => {
  const deadline = Date.now() + 5000;
  for (;;) {
    const j = get();
    if (j && until(j)) return j;
    if (Date.now() > deadline) throw new Error(`timed out; job is ${JSON.stringify(j)}`);
    await Bun.sleep(5);
  }
};

const names = async (
  queue: ReturnType<typeof createExportJobQueue>,
  id: string,
  session: string
): Promise<string[]> => {
  const dl = await queue.getBytes(id, session);
  if (!dl.ok) throw new Error(`no bytes: ${dl.reason}`);
  const zip = await JSZip.loadAsync(dl.bytes);
  return Object.keys(zip.files).sort();
};

afterEach(() => {
  /* each test builds its own queue and sandbox */
});

describe('Retry runs only the items that failed', () => {
  test('one of three fails: the job is done, 2 of 3, retryable', async () => {
    const eng = fakeEngine();
    eng.failing.add('board-2');
    const queue = createExportJobQueue(createBus(), designRoot(), { runExport: eng.run });
    const { id, result } = queue.enqueue(args(plan(3), ALICE));
    await result;
    const job = queue.get(id, ALICE) as ExportJob;
    expect(job.status).toBe('done');
    expect(job.items?.map((i) => i.status)).toEqual(['ok', 'failed', 'ok']);
    expect(job.retryable).toBe(true);
    expect(await names(queue, id, ALICE)).toEqual(['Club — Board 1.png', 'Club — Board 3.png']);
  });

  test('retry runs the failed item and nothing else, then the zip holds all three', async () => {
    const eng = fakeEngine();
    eng.failing.add('board-2');
    const queue = createExportJobQueue(createBus(), designRoot(), { runExport: eng.run });
    const { id, result } = queue.enqueue(args(plan(3), ALICE));
    await result;
    expect(eng.calls).toEqual(['board-1', 'board-2', 'board-3']);

    eng.failing.clear();
    const r = await queue.retry(id, undefined, ALICE);
    expect(r).toEqual({ ok: true, items: ['u2'] });
    const job = await wait(
      () => queue.get(id, ALICE),
      (j) => j.status === 'done' && j.items?.every((i) => i.status === 'ok') === true
    );
    // the engine saw ONE more call: the failed board, not the 2 that made it
    expect(eng.calls).toEqual(['board-1', 'board-2', 'board-3', 'board-2']);
    expect(job.retryable).toBe(false);
    expect(await names(queue, id, ALICE)).toEqual([
      'Club — Board 1.png',
      'Club — Board 2.png',
      'Club — Board 3.png',
    ]);
  });

  test('a retried item that fails again stays failed and the others stay as they were', async () => {
    const eng = fakeEngine();
    eng.failing.add('board-2');
    const queue = createExportJobQueue(createBus(), designRoot(), { runExport: eng.run });
    const { id, result } = queue.enqueue(args(plan(3), ALICE));
    await result;
    expect(await queue.retry(id, undefined, ALICE)).toEqual({ ok: true, items: ['u2'] });
    const job = await wait(
      () => queue.get(id, ALICE),
      (j) => j.status === 'done' && j.items?.[1]?.status === 'failed' && j.retryable === true
    );
    expect(job.items?.map((i) => i.status)).toEqual(['ok', 'failed', 'ok']);
    expect(await names(queue, id, ALICE)).toEqual(['Club — Board 1.png', 'Club — Board 3.png']);
  });

  test('named items outside the failed ones are not re-run', async () => {
    const eng = fakeEngine();
    eng.failing.add('board-2');
    const queue = createExportJobQueue(createBus(), designRoot(), { runExport: eng.run });
    const { id, result } = queue.enqueue(args(plan(3), ALICE));
    await result;
    // u1 made it: naming it asks for nothing to be re-run
    expect(await queue.retry(id, ['u1'], ALICE)).toEqual({ ok: false, reason: 'nothing-to-retry' });
    expect(eng.calls).toHaveLength(3);
  });

  test('a job with nothing failed, and a job that is not a group, are refused with a reason', async () => {
    const eng = fakeEngine();
    const queue = createExportJobQueue(createBus(), designRoot(), { runExport: eng.run });
    const { id, result } = queue.enqueue(args(plan(2), ALICE));
    await result;
    expect(await queue.retry(id, undefined, ALICE)).toEqual({
      ok: false,
      reason: 'nothing-to-retry',
    });
    const plain = queue.enqueue({ ...args(plan(1), ALICE), group: undefined });
    await plain.result;
    expect(await queue.retry(plain.id, undefined, ALICE)).toEqual({
      ok: false,
      reason: 'not-retryable',
    });
  });
});

describe('Retry belongs to the member who exported (V2-1.16 U1)', () => {
  test("Bob cannot retry Alice's job; it answers exactly like an id that never existed", async () => {
    const eng = fakeEngine();
    eng.failing.add('board-2');
    const queue = createExportJobQueue(createBus(), designRoot(), { runExport: eng.run });
    const { id, result } = queue.enqueue(args(plan(3), ALICE));
    await result;
    eng.failing.clear();

    const bob = await queue.retry(id, undefined, BOB);
    const ghost = await queue.retry('00000000-0000-0000-0000-000000000000', undefined, BOB);
    expect(bob).toEqual({ ok: false, reason: 'missing' });
    expect(bob).toEqual(ghost);
    await Bun.sleep(30);
    expect(eng.calls).toHaveLength(3); // the engine never ran for Bob
    expect(queue.get(id, ALICE)?.items?.[1]?.status).toBe('failed'); // and Alice's job is untouched
  });
});
