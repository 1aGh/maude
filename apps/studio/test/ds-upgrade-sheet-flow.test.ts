// S10.15b — the sheet’s whole story against the REAL server steps (the host’s own fetch helpers → runDsOp):
// a pre-schema fixture system opens the dialog (22); a scripted agent that uses only the verbs
// (`ds-upgrade --stage`, then the proof with a stand-in renderer — the headless studios run in
// ds-upgrade-prove.test.ts) produces a proven stage the dialog then shows; the primary button’s
// request applies it as ONE action and one ⌘Z takes it all back. Cancel and a converted system
// are pinned too. Never this repo’s `.design`.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_OWNER } from '../access/request.ts';
import { registerDsUndoHook } from '../ds/undo-hook.ts';
import { runDsUpgradeAsync } from '../ds/upgrade-cli.ts';
import { proveStage, type RenderJob, type RenderResult } from '../ds/upgrade-prove.ts';
import { discardStage } from '../ds/upgrade-stage.ts';
import { runDsOp } from '../routes/ds.ts';
import { cleanup, makeProject, PERSON, type Project } from './_ds-engine-fixture.ts';
import { CANVASES, FX, fxConfigEntry, writeFx } from './_ds-upgrade-fixture.ts';

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

/** `POST /_api/ds/upgrade` served by the real op, as the host’s fetch would reach it. */
const fetchImpl = (async (_url: string, req: RequestInit) => {
  const r = await runDsOp('upgrade', JSON.parse(String(req.body)), {
    engine: p.engine,
    outside: null,
    usage: null,
    access: LOCAL_OWNER,
    by: PERSON,
  });
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}) as unknown as typeof fetch;

const passing =
  (fail: string[] = []) =>
  async (job: RenderJob): Promise<RenderResult> => ({
    canvases: job.canvases.map((c) => ({
      path: c.path,
      artboards: [{ id: 'a', theme: null, changed: 0, area: 1, fail: fail.includes(c.path) }],
    })),
  });
const studio = async () => ({ origin: 'http://127.0.0.1:1', stop: async () => {} });

/** The scripted agent: the verbs only. `--stage` is the real verb; the proof is the engine with a stand-in render. */
async function agent(fail: string[] = []): Promise<string> {
  const plan = join(p.root, 'judged.json');
  writeFileSync(plan, '[]\n');
  const staged1 = await runDsUpgradeAsync(
    [FX.name, '--stage', plan, '--root', p.root],
    { CLAUDE_PROJECT_DIR: p.root },
    {}
  );
  expect(staged1.code).toBe(0);
  const stamp = JSON.parse(staged1.stdout).stamp as string;
  staged.push(stamp);
  await proveStage(p.designRoot, FX.name, stamp, { bootStudio: studio, render: passing(fail) });
  return stamp;
}

describe('the dialog against the real server steps (S10.15b)', () => {
  test('canvas 22: a pre-schema system opens with the four lines; the agent’s proven stage turns them into the review; the primary applies it as one undo step', async () => {
    const m = await import('../client/v2/ds/upgrade-model.js');
    const h = await import('../client/v2/ds/upgrade-host.jsx');

    // 1 · nothing run yet: status says no stage, the mechanical plan fills the lines
    const status0 = await h.loadUpgradeStatus(FX.name, 'Fixture', fetchImpl);
    expect(status0).toMatchObject({ ok: true, status: { converted: false, stages: [] } });
    const plan = await h.loadUpgradePlan(FX.name, fetchImpl);
    const ask = m.viewOf({
      status: (status0 as { status: unknown }).status,
      plan,
      label: 'Fixture',
      canvases: 5,
      canAskAI: true,
    });
    expect(ask).toMatchObject({ kind: 'ask', canAsk: true });
    expect((ask as { lines: { title: string }[] }).lines.map((l) => l.title)).toContain(
      'Updates 5 canvases'
    );

    // 2 · the scripted agent stages and proves (Bad.tsx fails the visual gate: it is refused, not applied)
    const stamp = await agent(['ui/Bad.tsx']);
    const status1 = (await h.loadUpgradeStatus(FX.name, 'Fixture', fetchImpl)) as {
      status: { stages: { stamp: string; phase: string }[] };
    };
    expect(status1.status.stages.map((s) => [s.stamp, s.phase])).toEqual([[stamp, 'proved']]);
    // the throwaway folder’s path stays on this machine
    expect(JSON.stringify(status1)).not.toContain('maude-ds-upgrade-');
    const review = m.viewOf({ status: status1.status, label: 'Fixture', canvases: 5 }) as {
      kind: string;
      stamp: string;
      blocker: string | null;
      updated: number;
      refused: { text: string; paths: string[] } | null;
      lines: { kind: string; title: string }[];
    };
    expect(review).toMatchObject({ kind: 'review', stamp, blocker: null, updated: 1 });
    expect(review.refused).toMatchObject({
      text: '1 canvas can’t be updated yet',
      paths: ['ui/Bad.tsx'],
    });
    expect(review.lines.at(-1)?.title).toBe('Updates 1 canvas');

    // 3 · the primary button: ONE apply request; the live tree changes; the stage’s copies are gone
    const cssBefore = p.read(FX.tokensCssRel);
    const cfgBefore = p.read('config.json');
    const applied = await h.applyUpgrade(FX.name, stamp, 'Fixture', fetchImpl);
    staged.splice(staged.indexOf(stamp), 1);
    expect(applied).toMatchObject({
      ok: true,
      result: { action: 'upgrade', updated: 1, refused: 1, system: FX.name },
    });
    expect(m.appliedWords((applied as { result: unknown }).result, 'Fixture')).toBe(
      'Brought Fixture up to the schema. 1 canvas updated; 1 can’t be updated yet.'
    );
    await p.home.flush();
    expect(p.read('ui/Good.tsx')).toContain('var(--accent-soft)');
    expect(p.read('ui/Bad.tsx')).toBe(CANVASES['ui/Bad.tsx']);
    expect(p.read(FX.tokensCssRel)).toContain('--accent-muted: var(--accent-soft);');
    const status2 = (await h.loadUpgradeStatus(FX.name, 'Fixture', fetchImpl)) as {
      status: { stages: unknown[] };
    };
    expect(status2.status.stages).toEqual([]);

    // 4 · one ⌘Z takes the canvases AND the system files back
    const actionId = (applied as { result: { actionId: string } }).result.actionId;
    const u = await p.undo({ actionId });
    expect(u.status).toBe(200);
    await p.home.flush();
    expect(p.read('ui/Good.tsx')).toBe(CANVASES['ui/Good.tsx']);
    expect(p.read(FX.tokensCssRel)).toBe(cssBefore);
    expect(p.read('config.json')).toBe(cfgBefore);
  });

  test('a stage applied twice is refused the second time, in words', async () => {
    const h = await import('../client/v2/ds/upgrade-host.jsx');
    const stamp = await agent();
    const one = await h.applyUpgrade(FX.name, stamp, 'Fixture', fetchImpl);
    staged.splice(staged.indexOf(stamp), 1);
    expect(one.ok).toBe(true);
    const two = await h.applyUpgrade(FX.name, stamp, 'Fixture', fetchImpl);
    expect(two.ok).toBe(false);
    // undo so the later tests start from the original tree
    await p.home.flush();
    await p.undo({ actionId: (one as { result: { actionId: string } }).result.actionId });
    await p.home.flush();
  });

  test('Cancel: the host’s cancel + discard leave nothing — status is empty, the folder is gone', async () => {
    const h = await import('../client/v2/ds/upgrade-host.jsx');
    const stamp = await agent();
    const dir = join(p.designRoot, '_state', 'ds-upgrade', FX.name, stamp);
    expect(existsSync(dir)).toBe(true);
    await h.cancelUpgrade(FX.name, stamp, fetchImpl);
    staged.splice(staged.indexOf(stamp), 1);
    expect(existsSync(dir)).toBe(false);
    const s = (await h.loadUpgradeStatus(FX.name, 'Fixture', fetchImpl)) as {
      status: { stages: unknown[] };
    };
    expect(s.status.stages).toEqual([]);
  });

  test('a converted system: status says so, and the engine’s refusal is in the person’s words', async () => {
    const m = await import('../client/v2/ds/upgrade-model.js');
    const h = await import('../client/v2/ds/upgrade-host.jsx');
    // a revisions/head.json is what makes a system converted (V2-1.6)
    const head = join(p.designRoot, FX.path, 'revisions', 'head.json');
    const mk = (await import('node:fs')).mkdirSync;
    mk(join(p.designRoot, FX.path, 'revisions'), { recursive: true });
    writeFileSync(
      head,
      readFileSync(join(p.designRoot, 'system/acme/revisions/head.json'), 'utf8')
    );
    try {
      const s = (await h.loadUpgradeStatus(FX.name, 'Fixture', fetchImpl)) as {
        status: { converted: boolean };
      };
      expect(s.status.converted).toBe(true);
      expect(m.viewOf({ status: s.status, label: 'Fixture' })).toEqual({ kind: 'converted' });
      const st = await fetchImpl('/_api/ds/upgrade', {
        method: 'POST',
        body: JSON.stringify({ ds: FX.name, step: 'stage', plan: [] }),
      });
      const body = (await st.json()) as { code: string };
      expect(body.code).toBe('ds-upgrade-converted');
      expect(m.refusalWords(body.code, 'Fixture')).toMatch(/Design system canvas/);
    } finally {
      (await import('node:fs')).rmSync(head, { force: true });
    }
  });
});
