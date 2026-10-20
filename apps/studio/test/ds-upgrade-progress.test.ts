// S10.15b — what the "Bring it up to the schema" sheet reads and presses while a proof runs:
// the stage's progress (a file beside the stage record, so it works across processes), the
// status of the system, and Cancel (a marker the prover polls; the shim and both studios stop).
// The renderer is a stand-in here; the headless studios run in ds-upgrade-prove.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_OWNER } from '../access/request.ts';
import { registerDsUndoHook } from '../ds/undo-hook.ts';
import { runDsUpgradeAsync } from '../ds/upgrade-cli.ts';
import { cancelStage, listStages } from '../ds/upgrade-progress.ts';
import { proveStage, type RenderJob, type RenderResult } from '../ds/upgrade-prove.ts';
import { discardStage, stageUpgrade, stateDirOf } from '../ds/upgrade-stage.ts';
import { runDsOp } from '../routes/ds.ts';
import { cleanup, makeProject, PERSON, type Project } from './_ds-engine-fixture.ts';
import { FX, fxConfigEntry, writeFx } from './_ds-upgrade-fixture.ts';

let p: Project;
let off: () => void;

beforeAll(async () => {
  p = await makeProject();
  off = registerDsUndoHook(p.engine);
  await writeFx((rel, text) => p.outside(rel, text));
  const cfg = JSON.parse(p.read('config.json') as string);
  cfg.designSystems.push(fxConfigEntry());
  p.write('config.json', `${JSON.stringify(cfg, null, 2)}\n`);
});
afterAll(() => {
  off();
  cleanup();
});

const staged: string[] = [];
afterEach(() => {
  for (const s of staged.splice(0)) discardStage(p.designRoot, FX.name, s);
});

const stage = () => {
  const r = stageUpgrade({ designRoot: p.designRoot, ds: FX.name, judged: [] });
  staged.push(r.stage.stamp);
  return r.stage.stamp;
};
const passing = (job: RenderJob): RenderResult => ({
  canvases: job.canvases.map((c) => ({
    path: c.path,
    artboards: [{ id: 'a', theme: null, changed: 0, area: 1, fail: false }],
  })),
});
const stopped: string[] = [];
const studio = (name: string) => async () => ({
  origin: 'http://127.0.0.1:1',
  stop: async () => {
    stopped.push(name);
  },
});
const boots = async (root: string) => studio(root.slice(-6))();
const stateDir = (stamp: string) => stateDirOf(p.designRoot, FX.name, stamp);
const until = async (ok: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!ok() && Date.now() - t < ms) await Bun.sleep(10);
  expect(ok()).toBe(true);
};

describe('the proof reports its progress (S10.15b)', () => {
  test('while it renders: phase proving with canvases done of total; afterwards proved with the review and no progress file', async () => {
    const stamp = stage();
    expect(listStages(p.designRoot, FX.name).map((s) => [s.stamp, s.phase])).toEqual([
      [stamp, 'staged'],
    ]);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const done = proveStage(p.designRoot, FX.name, stamp, {
      bootStudio: boots,
      render: async (job, o) => {
        o?.onProgress?.({ current: 2, total: job.canvases.length });
        await gate;
        return passing(job);
      },
    });
    await until(() => listStages(p.designRoot, FX.name)[0]?.progress?.current === 2);
    const mid = listStages(p.designRoot, FX.name)[0];
    expect(mid.phase).toBe('proving');
    expect(mid.progress).toMatchObject({ phase: 'rendering', current: 2 });
    expect(mid.progress?.total).toBeGreaterThan(2);
    expect(mid.review).toBeNull();
    release();
    const review = await done;
    const end = listStages(p.designRoot, FX.name)[0];
    expect(end).toMatchObject({ stamp, phase: 'proved', stale: false });
    expect(end.review?.stamp).toBe(review.stamp);
    expect(end.progress).toBeNull();
    expect(existsSync(join(stateDir(stamp), 'progress.json'))).toBe(false);
  });

  test('a prover that died leaves a progress file nobody beats: the stage is staged, not proving', () => {
    const stamp = stage();
    const file = join(stateDir(stamp), 'progress.json');
    const old = Date.now() - 60_000;
    writeFileSync(
      file,
      JSON.stringify({
        phase: 'rendering',
        current: 1,
        total: 5,
        startedAt: old,
        updatedAt: old,
        pid: 1,
      })
    );
    utimesSync(file, old / 1000, old / 1000);
    expect(listStages(p.designRoot, FX.name)[0].phase).toBe('staged');
  });

  test('an applied stage (its copies gone, the record kept) is not offered', () => {
    const stamp = stage();
    const dir = JSON.parse(readFileSync(join(stateDir(stamp), 'stage.json'), 'utf8')).dir as string;
    expect(listStages(p.designRoot, FX.name).map((s) => s.stamp)).toContain(stamp);
    rmSync(dir, { recursive: true, force: true }); // what apply does to the throwaway copies
    expect(existsSync(join(stateDir(stamp), 'stage.json'))).toBe(true);
    expect(listStages(p.designRoot, FX.name).map((s) => s.stamp)).not.toContain(stamp);
  });

  test('the verb: --status and --cancel are the route’s steps', async () => {
    const stamp = stage();
    const env = { CLAUDE_PROJECT_DIR: p.root };
    const s = await runDsUpgradeAsync([FX.name, '--status', '--root', p.root], env);
    expect(s.code).toBe(0);
    expect(JSON.parse(s.stdout)).toMatchObject({
      ds: FX.name,
      stages: [{ stamp, phase: 'staged' }],
    });
    const c = await runDsUpgradeAsync([FX.name, '--cancel', stamp, '--root', p.root], env);
    expect(JSON.parse(c.stdout)).toEqual({ cancelled: stamp });
  });
});

describe('Cancel stops a proof in flight (S10.15b)', () => {
  test('the shim is told to stop, both studios are stopped, no review is written, the stage stays staged', async () => {
    const stamp = stage();
    stopped.length = 0;
    let aborted = false;
    const proving = proveStage(p.designRoot, FX.name, stamp, {
      pollMs: 20,
      bootStudio: boots,
      render: (_job, o) =>
        new Promise<RenderResult>((_res, rej) => {
          o?.signal?.addEventListener('abort', () => {
            aborted = true;
            rej(new Error('cancelled'));
          });
        }),
    });
    await until(() => listStages(p.designRoot, FX.name)[0]?.phase === 'proving');
    expect(cancelStage(p.designRoot, FX.name, stamp)).toEqual({ cancelled: stamp });
    await expect(proving).rejects.toMatchObject({ code: 'ds-upgrade-cancelled' });
    expect(aborted).toBe(true);
    expect(stopped).toHaveLength(2);
    expect(existsSync(join(stateDir(stamp), 'review.json'))).toBe(false);
    expect(existsSync(join(stateDir(stamp), 'cancel.json'))).toBe(false);
    expect(listStages(p.designRoot, FX.name)[0].phase).toBe('staged');
  });

  test('a cancel with nothing in flight leaves no marker behind (it would cancel the next proof)', async () => {
    const stamp = stage();
    cancelStage(p.designRoot, FX.name, stamp);
    expect(existsSync(join(stateDir(stamp), 'cancel.json'))).toBe(false);
    const review = await proveStage(p.designRoot, FX.name, stamp, {
      bootStudio: boots,
      render: async (job) => passing(job),
    });
    expect(review.stamp).toBe(stamp);
  });

  test('cancelling a stage that does not exist is a 404', () => {
    expect(() => cancelStage(p.designRoot, FX.name, '1')).toThrow(/no stage/);
  });
});

describe('POST /_api/ds/upgrade status + cancel (S10.15b)', () => {
  const op = (input: Record<string, unknown>, access = LOCAL_OWNER) =>
    runDsOp('upgrade', input, { engine: p.engine, outside: null, usage: null, access, by: PERSON });

  test('status says what the system is and lists its live stages; cancel answers the stamp', async () => {
    const empty = await op({ ds: FX.name, step: 'status' });
    expect(empty).toMatchObject({
      status: 200,
      body: { ds: FX.name, converted: false, schema: null, stages: [] },
    });
    const st = await op({ ds: FX.name, step: 'stage', plan: [] });
    const stamp = (st.body as { stamp: string }).stamp;
    staged.push(stamp);
    const s = await op({ ds: FX.name, step: 'status' });
    expect((s.body as { stages: { stamp: string; phase: string }[] }).stages).toMatchObject([
      { stamp, phase: 'staged' },
    ]);
    // the throwaway folder's path stays on this machine
    expect(JSON.stringify(s.body)).not.toContain('maude-ds-upgrade-');
    expect((await op({ ds: FX.name, step: 'cancel', stage: stamp })).body).toEqual({
      cancelled: stamp,
    });
    expect((await op({ ds: FX.name, step: 'cancel', stage: '../x' })).status).toBe(400);
    expect((await op({ ds: 'nope', step: 'status' })).status).toBe(404);
  });

  test('Can view is refused both steps', async () => {
    const viewer = { ...LOCAL_OWNER, can: () => false } as typeof LOCAL_OWNER;
    for (const step of ['status', 'cancel'])
      expect((await op({ ds: FX.name, step, stage: '1' }, viewer)).status).toBe(403);
  });
});
