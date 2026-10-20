// S10.15a — Bring-up stage / gate attribution / apply as ONE action / one ⌘Z (V2-1.13 §5.10).
// A real local home (the kernel + the undo route); the proof's renderer is a stand-in here — the
// headless studios run in ds-upgrade-prove.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerDsUndoHook } from '../ds/undo-hook.ts';
import { applyStage } from '../ds/upgrade-apply.ts';
import { checkV6 } from '../ds/upgrade-codemod.ts';
import { proveStage, type RenderJob, type RenderResult } from '../ds/upgrade-prove.ts';
import { discardStage, stageUpgrade, treeHash } from '../ds/upgrade-stage.ts';
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

/** A stand-in renderer: every artboard passes unless its canvas is named in `fail`. */
const fakeRender =
  (fail: string[] = []) =>
  async (job: RenderJob): Promise<RenderResult> => ({
    canvases: job.canvases.map((c) => ({
      path: c.path,
      artboards: [{ id: 'a', theme: null, changed: 0, area: 1, fail: fail.includes(c.path) }],
    })),
  });
const fakeStudio = async () => ({ origin: 'http://127.0.0.1:1', stop: async () => {} });

function stage() {
  const r = stageUpgrade({ designRoot: p.designRoot, ds: FX.name, judged: [] });
  staged.push(r.stage.stamp);
  return r;
}
const prove = (stamp: string, fail: string[] = []) =>
  proveStage(p.designRoot, FX.name, stamp, { bootStudio: fakeStudio, render: fakeRender(fail) });
const apply = (stamp: string) =>
  applyStage({
    designRoot: p.designRoot,
    ds: FX.name,
    stamp,
    kernel: () => p.engine.kernel(),
    by: PERSON,
  });

describe('ds-upgrade stage (S10.15a)', () => {
  test('the stage is a throwaway copy; after/ carries the system half + the codemods; the live tree is untouched', () => {
    const live = treeHash(p.designRoot);
    const { stage: s, plan } = stage();
    expect(s.dir.startsWith(tmpdir()) || s.dir.includes('maude-ds-upgrade-')).toBe(true);
    expect(s.dir.startsWith(p.root)).toBe(false);
    const after = (rel: string) => readFileSync(join(s.dir, 'after', '.design', rel), 'utf8');
    const before = (rel: string) => readFileSync(join(s.dir, 'before', '.design', rel), 'utf8');
    expect(after('ui/Good.tsx')).toContain('var(--accent-soft)');
    expect(after('ui/Good.tsx')).toContain('className="ds"');
    expect(before('ui/Good.tsx')).toBe(CANVASES['ui/Good.tsx']);
    expect(after(FX.tokensCssRel)).toContain('--accent-muted: var(--accent-soft);');
    // Q2: the spec canvases are never codemodded; V7: a left-out canvas keeps its native names
    expect(after('ui/v2/Spec.tsx')).toBe(CANVASES['ui/v2/Spec.tsx']);
    expect(after('ui/Left.tsx')).toBe(CANVASES['ui/Left.tsx']);
    expect(s.skipped).toEqual(
      expect.arrayContaining([
        { path: 'ui/v2/Spec.tsx', reason: 'ui-v2' },
        { path: 'ui/Left.tsx', reason: 'left-out' },
      ])
    );
    expect(s.canvases.map((c) => c.path).sort()).toEqual(['ui/Bad.tsx', 'ui/Good.tsx']);
    expect(plan.items.filter((i) => i.kind === 'canvas-codemod').map((i) => i.id)).toContain(
      'canvas:ui/Good.tsx'
    );
    // runtime state and the team link never reach the copy
    expect(existsSync(join(s.dir, 'after', '.design', '_state'))).toBe(false);
    expect(treeHash(p.designRoot)).toBe(live);
  });

  test('V6: a codemod that reaches beyond names, class tokens and imports is refused', () => {
    const a = CANVASES['ui/Good.tsx'];
    expect(checkV6(a, a.replace('--accent-muted', '--accent-soft'))).toBeNull();
    expect(checkV6(a, a.replace('className="fx"', 'className="ds"'))).toBeNull();
    expect(checkV6(a, a.replace('data-cd-id="chip"', 'data-cd-id="x"'))).toMatch(/id/);
    expect(checkV6(a, a.replace('margin: 20', 'margin: 21'))).toMatch(/beyond/);
  });

  test('discard removes the throwaway copy and the record', () => {
    const { stage: s } = stage();
    discardStage(p.designRoot, FX.name, s.stamp);
    expect(existsSync(s.dir)).toBe(false);
    expect(existsSync(join(p.designRoot, '_state', 'ds-upgrade', FX.name, s.stamp))).toBe(false);
  });
});

describe('ds-upgrade apply + one ⌘Z (S10.15a)', () => {
  test('a stage that was not proved is refused', async () => {
    const { stage: s } = stage();
    await expect(apply(s.stamp)).rejects.toMatchObject({ code: 'ds-upgrade-not-proved' });
  });

  test('a failure on a canvas without a codemod is the system files’: the whole apply is refused', async () => {
    const { stage: s } = stage();
    const review = await prove(s.stamp, ['ui/Plain.tsx']);
    expect(review.systemFailed).toBe(true);
    await expect(apply(s.stamp)).rejects.toMatchObject({ code: 'ds-upgrade-proof-failed' });
    expect(p.read('ui/Good.tsx')).toBe(CANVASES['ui/Good.tsx']);
  });

  test('a project that moved after staging is refused (beforeTreeHash)', async () => {
    const { stage: s } = stage();
    await prove(s.stamp);
    const text = p.read('ui/Plain.tsx') as string;
    p.write('ui/Plain.tsx', `${text}// edited\n`);
    try {
      await expect(apply(s.stamp)).rejects.toMatchObject({ code: 'ds-upgrade-stale' });
    } finally {
      p.write('ui/Plain.tsx', text);
    }
  });

  test('apply is one action: a failing codemod stays as it is; ⌘Z takes back canvases AND system files; redo re-applies', async () => {
    const cssBefore = p.read(FX.tokensCssRel);
    const cfgBefore = p.read('config.json');
    const { stage: s } = stage();
    const review = await prove(s.stamp, ['ui/Bad.tsx']);
    expect(review.systemFailed).toBe(false);
    expect(review.refused).toEqual([{ path: 'ui/Bad.tsx', reason: 'visual' }]);
    expect(review.updatesCanvases.find((c) => c.path === 'ui/Good.tsx')?.diff).toBe('pass');

    const r = await apply(s.stamp);
    staged.splice(staged.indexOf(s.stamp), 1);
    expect(r).toMatchObject({ action: 'upgrade', updated: 1, refused: 1, system: FX.name });
    expect(typeof r.actionId).toBe('string');
    await p.home.flush();
    expect(p.read('ui/Good.tsx')).toContain('var(--accent-soft)');
    expect(p.read('ui/Bad.tsx')).toBe(CANVASES['ui/Bad.tsx']);
    expect(p.read('ui/v2/Spec.tsx')).toBe(CANVASES['ui/v2/Spec.tsx']);
    expect(p.read(FX.tokensCssRel)).toContain('--accent-muted: var(--accent-soft);');
    expect(existsSync(s.dir)).toBe(false);

    const u = await p.undo({ actionId: r.actionId });
    expect(u.status).toBe(200);
    await p.home.flush();
    expect(p.read('ui/Good.tsx')).toBe(CANVASES['ui/Good.tsx']);
    expect(p.read(FX.tokensCssRel)).toBe(cssBefore);
    expect(p.read('config.json')).toBe(cfgBefore);

    const redo = await p.undo({ actionId: u.body.actionId, redo: true });
    expect(redo.status).toBe(200);
    await p.home.flush();
    expect(p.read('ui/Good.tsx')).toContain('var(--accent-soft)');
    expect(p.read(FX.tokensCssRel)).toContain('--accent-muted: var(--accent-soft);');
  });

  test('the ⌘Z never writes over a later edit of a system file', async () => {
    const recDir = join(p.designRoot, '_state', 'ds-upgrade', FX.name, 'applied');
    expect(existsSync(recDir)).toBe(true);
    const css = p.read(FX.tokensCssRel) as string;
    writeFileSync(join(p.designRoot, FX.tokensCssRel), `${css}/* later */\n`);
    // the last applied action: undo it again (the chain ends with the redo)
    const rec = JSON.parse(
      readFileSync(join(recDir, (await import('node:fs')).readdirSync(recDir)[0]), 'utf8')
    );
    const u = await p.undo({ actionId: rec.chain.at(-1) });
    expect(u.status).toBe(200);
    expect(p.read(FX.tokensCssRel)).toBe(`${css}/* later */\n`);
    expect(JSON.stringify(u.body.skipped ?? [])).toContain('ds-upgrade-changed');
  });
});
