// S8.9 — `wait:'ai'` (contract S8-export-spec.md §5.6): the export job holds until the AI run on its
// artboard ends, fires ONCE, and dies with a run that did not finish. Real run registry, real queue.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { createBus } from '../context.ts';
import type { ExportContext } from '../exporters/index.ts';
import { createExportJobQueue, type EnqueueArgs, type ExportJob } from '../exporters/jobs.ts';
import type { SpecUnit } from '../exporters/scope.ts';
import type { GroupPlan } from '../exporters/spec-run.ts';
import { DIED_MESSAGE, holdsTarget, targetsOf, WAIT_REASON } from '../exporters/wait-ai.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'maude-waitai-'));
  dirs.push(root);
  const design = join(root, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  writeFileSync(join(design, 'ui', 'C.tsx'), 'export default function C(){return null}\n');
  return design;
}

/** The registry the studio runs, with its change feed on the same bus the queue listens to. */
function world() {
  const bus = createBus();
  const reg = createRunRegistry({
    designRoot: null,
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    emit: (e, p) => bus.emit(e, p),
    turns: { send: () => {} },
    stage: { publish: () => ({ status: 'accepted' }), hold: () => {} },
  });
  const design = sandbox();
  const queue = createExportJobQueue(bus, design, { runs: () => reg });
  const seen: ExportJob[] = [];
  bus.on('export:job', (j: ExportJob) => seen.push(structuredClone(j)));
  return { bus, reg, design, queue, seen };
}

/** A zip unit stands in for the render (it runs in-cell, no browser); `canvas`/`artboards` are the target. */
function unit(artboard: string): SpecUnit {
  return {
    id: 'u1',
    format: 'zip',
    scope: 'project-raw',
    options: {},
    canvas: 'ui/C.tsx',
    artboards: [{ id: artboard, label: artboard, kind: null, w: null, h: null }],
    kind: null,
    v2: {},
    degraded: [],
  };
}

function args(design: string, artboard: string, wait?: 'ai'): EnqueueArgs {
  const repoRoot = join(design, '..');
  const ctx: ExportContext = { designRoot: design, repoRoot, serverOrigin: 'http://127.0.0.1:1' };
  const group: GroupPlan = {
    spec: { v: 2, scope: 'canvas', format: 'zip', ...(wait ? { wait } : {}) },
    units: [unit(artboard)],
    project: 'p',
    date: new Date('2026-10-06T12:00:00'),
  };
  return {
    format: 'zip',
    scope: 'project-raw',
    options: {},
    resolve: {
      activeJson: { active: '.design/ui/C.tsx', selected: null },
      designRoot: design,
      repoRoot,
    },
    ctx,
    group,
  };
}

async function aiOn(reg: ReturnType<typeof world>['reg'], artboard = 'P') {
  const run = await reg.ask({
    chatId: `c-${artboard}`,
    origin: 'maude-chat',
    label: 'Make the date bigger',
    prompt: 'p',
    scope: { canvas: 'ui/C.tsx', artboards: [artboard] },
  });
  await reg.started(run.runId);
  return run;
}

/** how many times the job STARTED rendering (a rising edge into `running`; progress re-emits are not starts) */
const runningEvents = (seen: ExportJob[], id: string) => {
  let starts = 0;
  let prev = '';
  for (const j of seen.filter((x) => x.id === id)) {
    if (j.status === 'running' && prev !== 'running') starts += 1;
    prev = j.status;
  }
  return starts;
};

describe('wait:ai — the job holds until the run on its artboard ends', () => {
  test('held while AI works (queued, item waiting), then runs ONCE when the run is done', async () => {
    const { bus, reg, design, queue, seen } = world();
    const run = await aiOn(reg);
    const { id, result } = queue.enqueue(args(design, 'P', 'ai'));
    await tick();
    const held = queue.get(id);
    expect(held?.status).toBe('queued');
    expect(held?.items?.[0]?.status).toBe('waiting');
    expect(held?.items?.[0]?.reason).toBe(WAIT_REASON);
    expect(runningEvents(seen, id)).toBe(0);

    await reg.turnEnded(run.runId, 'done');
    const res = await result;
    expect(res.body.byteLength).toBeGreaterThan(0);
    expect(queue.get(id)?.status).toBe('done');
    expect(queue.get(id)?.items?.[0]?.status).toBe('ok');

    // more registry noise after the end must not fire it again
    bus.emit('ai:runs', { seq: 99 });
    bus.emit('ai:runs', { seq: 100 });
    await tick();
    expect(runningEvents(seen, id)).toBe(1);
  });

  test('a run that is stopped (cancelled) before it finishes kills the job: nothing is exported', async () => {
    const { reg, design, queue, seen } = world();
    const run = await aiOn(reg);
    const { id, result } = queue.enqueue(args(design, 'P', 'ai'));
    const settled = result.then(
      () => 'ran',
      (e: Error) => e.message
    );
    await tick();
    await reg.stop(run.runId, 'you');
    expect(await settled).toBe(DIED_MESSAGE);
    const job = queue.get(id);
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe(DIED_MESSAGE);
    expect(job?.items?.[0]?.status).toBe('failed');
    expect(runningEvents(seen, id)).toBe(0);
  });

  test('a run that fails before finishing kills the job too', async () => {
    const { reg, design, queue } = world();
    const run = await aiOn(reg);
    const { result } = queue.enqueue(args(design, 'P', 'ai'));
    const settled = result.then(
      () => 'ran',
      (e: Error) => e.message
    );
    await tick();
    await reg.turnEnded(run.runId, 'failed');
    expect(await settled).toBe(DIED_MESSAGE);
  });

  test('nothing is holding the artboard: it exports at once (no wait to serve)', async () => {
    const { design, queue, seen } = world();
    const { id, result } = queue.enqueue(args(design, 'P', 'ai'));
    await result;
    expect(runningEvents(seen, id)).toBe(1);
    expect(seen.some((j) => j.items?.some((i) => i.status === 'waiting'))).toBe(false);
  });

  test('AI on ANOTHER artboard of the canvas does not hold this one', async () => {
    const { reg, design, queue } = world();
    await aiOn(reg, 'Q');
    const { result } = queue.enqueue(args(design, 'P', 'ai'));
    await result;
    expect(true).toBe(true);
  });

  test('without wait, an artboard under AI exports its last finished version straight away', async () => {
    const { reg, design, queue } = world();
    await aiOn(reg);
    const { result } = queue.enqueue(args(design, 'P'));
    const res = await result;
    expect(res.body.byteLength).toBeGreaterThan(0);
  });
});

describe('wait-ai — who holds', () => {
  test('a run in line behind the holder is not a holder; a unit with no canvas has no target', async () => {
    const { reg } = world();
    const first = await aiOn(reg, 'P');
    const second = await reg.ask({
      chatId: 'c-other',
      origin: 'maude-chat',
      label: 'Blue button',
      prompt: 'p2',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    const targets = targetsOf([unit('P')]);
    expect(holdsTarget(reg.get(first.runId)!, targets)).toBe(true);
    expect(reg.get(second.runId)?.state).toBe('waiting');
    expect(holdsTarget(reg.get(second.runId)!, targets)).toBe(false);
    expect(targetsOf([{ canvas: null, artboards: [] }])).toEqual([]);
    expect(targetsOf([{ canvas: 'ui/C.tsx', artboards: [] }])).toEqual([
      { canvas: 'ui/C.tsx', artboards: [] },
    ]);
  });
});
