// "Bring it up to the schema" — step 6, prove (V2-1.13 §5.10, S10.15a).
//
// Two headless studios (`NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, a throwaway machine file, port 0) boot on
// the stage's `before/` and `after/` copies; the `_ds-prove-playwright.mjs` shim renders every
// artboard of every canvas and specimen of the system, in every theme it carries, through each
// studio's read-only capture origin, and diffs them in the page. Both studios are killed in a
// `finally`, whatever happens.
//
// The visual gate:
//   changed pixel       OKLab ΔE × 100 > 2
//   failing artboard    changed pixels > 0.5 % of its area, in any theme
//   a canvas WITH a codemod that fails   → that codemod is refused (the canvas stays as it is;
//                                          "N canvases can't be updated yet")
//   a canvas WITHOUT one (or a specimen)  → the failure is the system files' → the whole apply is
//                                          refused: system edits must be invisible
// Output: `diff.json` (every measurement) and `review.json` (the four SCHEMA_FIX lines) beside the
// stage record.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Subprocess } from 'bun';
import { exportShimPath, spawnShim } from '../exporters/_runtime.ts';
import { DEV_SERVER_ROOT } from '../paths.ts';
import { checkCanvas } from './canvas-check.ts';
import { canvasContext, listCanvases } from './canvas-cli.ts';
import { systemConfigsFrom } from './system.ts';
import type { PlanItem, UpgradePlan } from './upgrade.ts';
import { addedRoles } from './upgrade.ts';
import {
  cancelRequested,
  clearCancel,
  clearProgress,
  type ProveProgress,
  writeProgress,
} from './upgrade-progress.ts';
import {
  DsUpgradeError,
  readStage,
  type StageManifest,
  stateDirOf,
  systemOf,
} from './upgrade-stage.ts';

export const DIFF_FORMAT = 'maude.ds-upgrade-diff';
export const REVIEW_FORMAT = 'maude.ds-upgrade-review';
export const DELTA_E = 2;
export const FAIL_RATIO = 0.005;

export interface RenderCanvas {
  path: string;
  tokens: string | null;
  components: string | null;
}
export interface RenderJob {
  before: string;
  after: string;
  canvases: RenderCanvas[];
  deltaE: number;
  ratio: number;
  timeout: number;
}
export interface ArtboardDiff {
  id: string;
  theme: string | null;
  width?: number;
  height?: number;
  changed?: number;
  area?: number;
  fail: boolean;
  reason?: string;
}
export interface RenderResult {
  canvases: { path: string; error?: string; detail?: string; artboards: ArtboardDiff[] }[];
}

export interface Studio {
  origin: string;
  stop(): Promise<void>;
}

export interface RenderOptions {
  /** aborts the render: the shim is killed */
  signal?: AbortSignal;
  /** one update per canvas done */
  onProgress?: (u: { current: number; total: number }) => void;
}

export interface ProveDeps {
  bootStudio?: (projectRoot: string) => Promise<Studio>;
  render?: (job: RenderJob, opts?: RenderOptions) => Promise<RenderResult>;
  now?: () => number;
  /** how often the cancel marker is looked for (ms); tests make it short */
  pollMs?: number;
}

export interface Review {
  format: typeof REVIEW_FORMAT;
  v: 1;
  system: string;
  stamp: string;
  provedAt: number;
  /** the whole apply is refused (a system-file change was visible) */
  systemFailed: boolean;
  addsRoles: {
    name: string;
    label: string | null;
    light?: string;
    dark?: string;
    sources: string[];
    contrast: Record<string, number> | null;
  }[];
  renamesComponents: { from: string; to: string; variantsKept: string[] }[];
  keepsOwn: { native: string; as: string }[];
  updatesCanvases: { path: string; edits: number; diff: 'pass' | 'fail' }[];
  refused: { path: string; reason: string }[];
  needsPick: string[];
}

/* ------------------------------------------------------------- studios */

function serverCommand(): string[] {
  const serverTs = join(DEV_SERVER_ROOT, 'server.ts');
  if (!existsSync(serverTs)) return [process.execPath]; // the compiled studio binary IS the server
  const bun = basename(process.execPath).startsWith('bun')
    ? process.execPath
    : (Bun.which('bun') ?? process.execPath);
  return [bun, 'run', serverTs];
}

function studioEnv(projectRoot: string, machineFile: string): Record<string, string> {
  // the staged studio picks its own port, and runs as the studio (never as a bare bun)
  const drop = new Set(['BUN_BE_BUN', 'PORT', 'MDCC_DEV_PORT']);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !drop.has(k)) env[k] = v;
  return {
    ...env,
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_MACHINE_FILE: machineFile,
    CLAUDE_PROJECT_DIR: projectRoot,
  };
}

/** Boot one headless studio on a staged project. Never opens a window, never autobuilds. */
export async function bootHeadlessStudio(projectRoot: string): Promise<Studio> {
  const designRoot = join(projectRoot, '.design');
  const scratch = mkdtempSync(join(tmpdir(), 'maude-ds-prove-machine-'));
  const proc: Subprocess = Bun.spawn([...serverCommand(), '--root', projectRoot, '--port', '0'], {
    cwd: DEV_SERVER_ROOT,
    env: studioEnv(projectRoot, join(scratch, 'machine.json')),
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const stop = async () => {
    const exited = proc.exited.then(
      () => true,
      () => true
    );
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
    const inTime = await Promise.race([exited, Bun.sleep(5000).then(() => false)]);
    if (!inTime) {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* gone */
      }
      await exited;
    }
    rmSync(scratch, { recursive: true, force: true });
  };
  try {
    const started = Date.now();
    while (Date.now() - started < 60000) {
      if (proc.exitCode !== null) throw new Error(`the staged studio exited ${proc.exitCode}`);
      try {
        const s = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')) as {
          pid?: number;
          port?: number;
        };
        if (s.pid === proc.pid && s.port) {
          const origin = `http://localhost:${s.port}`;
          const r = await fetch(`${origin}/_health`, { signal: AbortSignal.timeout(500) });
          if (r.ok) return { origin, stop };
        }
      } catch {
        /* not up yet */
      }
      await Bun.sleep(100);
    }
    throw new Error('the staged studio did not start within 60 s');
  } catch (e) {
    await stop();
    throw e;
  }
}

/** The default renderer: the playwright shim as a subprocess. */
export async function renderWithShim(
  job: RenderJob,
  opts: RenderOptions = {}
): Promise<RenderResult> {
  const dir = mkdtempSync(join(tmpdir(), 'maude-ds-prove-job-'));
  try {
    const file = join(dir, 'job.json');
    writeFileSync(file, JSON.stringify(job));
    const shim = exportShimPath('_ds-prove-playwright.mjs');
    const r = await spawnShim([shim, '--job', file], {
      cwd: dirname(shim),
      signal: opts.signal,
      onProgress: opts.onProgress,
    });
    if (opts.signal?.aborted) throw new Error('cancelled');
    if (r.code !== 0)
      throw new Error(`the visual gate failed to run: ${r.stderr.trim().slice(0, 400)}`);
    return JSON.parse(r.stdoutLines.filter(Boolean).at(-1) ?? '{}') as RenderResult;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* --------------------------------------------------------------- prove */

/** Every canvas and specimen of the system in the staged before/ tree. */
function affectedCanvases(stageDir: string, ds: string): RenderCanvas[] {
  const root = join(stageDir, 'before');
  const designRoot = join(root, '.design');
  const config = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
  const systems = systemConfigsFrom(config);
  const ctx = canvasContext({ root, designRoot, config, systems });
  const sys = systems.find((s) => s.name === ds);
  const out: RenderCanvas[] = [];
  for (const rel of listCanvases(designRoot)) {
    if (checkCanvas(ctx, rel).system !== ds) continue;
    out.push({
      path: rel,
      tokens: sys?.tokensCssRel ?? null,
      components: sys ? `${sys.path}/preview/_components.css` : null,
    });
  }
  return out;
}

function reviewOf(
  stage: StageManifest,
  plan: UpgradePlan,
  result: RenderResult,
  now: number
): { review: Review; failedCanvases: Set<string> } {
  const codemodded = new Map(stage.canvases.map((c) => [c.path, c]));
  const failedCanvases = new Set<string>();
  let systemFailed = false;
  const refused: Review['refused'] = stage.refused.map((r) => ({
    path: r.path,
    reason: r.invariant,
  }));
  for (const c of result.canvases) {
    const failed = c.error === 'after' || c.artboards.some((a) => a.fail);
    if (!failed) continue;
    if (codemodded.has(c.path)) {
      failedCanvases.add(c.path);
      refused.push({ path: c.path, reason: c.error === 'after' ? 'render' : 'visual' });
    } else systemFailed = true;
  }
  const items = plan.items;
  const label = (it: PlanItem) => it.note ?? null;
  const review: Review = {
    format: REVIEW_FORMAT,
    v: 1,
    system: stage.system,
    stamp: stage.stamp,
    provedAt: now,
    systemFailed,
    addsRoles: items.flatMap((it) =>
      addedRoles(it).map((r) => ({
        name: r.name,
        label: label(it),
        ...(r.values.light ? { light: r.values.light } : {}),
        ...(r.values.dark ? { dark: r.values.dark } : {}),
        ...(r.values['*'] ? { light: r.values['*'] } : {}),
        sources: it.sources ?? [],
        contrast: null,
      }))
    ),
    renamesComponents: items
      .filter((i) => i.kind === 'map-component' && i.native)
      .map((i) => ({
        from: i.native as string,
        to: String((i as { to?: unknown }).to ?? ''),
        variantsKept: (i as { variant?: unknown }).variant
          ? [String((i as { variant?: unknown }).variant)]
          : [],
      })),
    keepsOwn: items
      .filter((i) => i.kind === 'prefix-own' && i.native && i.as)
      .map((i) => ({ native: i.native as string, as: i.as as string })),
    updatesCanvases: stage.canvases.map((c) => ({
      path: c.path,
      edits: Object.values(c.edits).reduce((a, b) => a + b, 0),
      diff: failedCanvases.has(c.path) ? 'fail' : 'pass',
    })),
    refused,
    needsPick: items.filter((i) => i.status === 'needs-pick' && i.picked == null).map((i) => i.id),
  };
  return { review, failedCanvases };
}

/**
 * Step 6. Writes diff.json + review.json beside the stage record; returns the review.
 *
 * While it runs it keeps `progress.json` (phase, canvases done, a 2 s heartbeat) and looks for
 * `cancel.json` (the sheet's Cancel): on one it kills the shim, stops both studios and throws
 * `ds-upgrade-cancelled`, so nobody waits out a proof they no longer want (S10.15b).
 */
export async function proveStage(
  designRoot: string,
  ds: string,
  stamp: string,
  deps: ProveDeps = {}
): Promise<Review> {
  systemOf(designRoot, ds);
  const stage = readStage(designRoot, ds, stamp);
  const stateDir = stateDirOf(designRoot, ds, stamp);
  const plan = JSON.parse(readFileSync(join(stateDir, 'plan.json'), 'utf8')) as UpgradePlan;
  const boot = deps.bootStudio ?? bootHeadlessStudio;
  const render = deps.render ?? renderWithShim;
  const canvases = affectedCanvases(stage.dir, ds);
  const studios: Studio[] = [];
  let result: RenderResult;

  // an old cancel is not this proof's
  clearCancel(stateDir);
  const ctl = new AbortController();
  const progress: ProveProgress = {
    phase: 'booting',
    current: 0,
    total: canvases.length,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    pid: process.pid,
  };
  let finished = false;
  const beat = () => {
    if (finished) return; // a late line from a killed shim must not bring the file back
    progress.updatedAt = Date.now();
    writeProgress(stateDir, progress);
  };
  beat();
  const heart = setInterval(beat, 2000);
  const watch = setInterval(() => {
    if (cancelRequested(stateDir)) ctl.abort();
  }, deps.pollMs ?? 300);
  const cancelled = () =>
    new DsUpgradeError('ds-upgrade-cancelled', 'the proof was cancelled; nothing changed');
  try {
    // allSettled: a studio that booted while its sibling failed is still stopped below
    const booted = await Promise.allSettled([
      boot(join(stage.dir, 'before')),
      boot(join(stage.dir, 'after')),
    ]);
    for (const b of booted) if (b.status === 'fulfilled') studios.push(b.value);
    const failed = booted.find((b) => b.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    if (ctl.signal.aborted) throw cancelled();
    const [before, after] = studios;
    progress.phase = 'rendering';
    beat();
    result = await render(
      {
        before: before.origin,
        after: after.origin,
        canvases,
        deltaE: DELTA_E,
        ratio: FAIL_RATIO,
        timeout: 20000,
      },
      {
        signal: ctl.signal,
        onProgress: (u) => {
          progress.current = u.current;
          progress.total = u.total;
          beat();
        },
      }
    );
    if (ctl.signal.aborted) throw cancelled();
  } catch (e) {
    if (e instanceof DsUpgradeError) throw e;
    if (ctl.signal.aborted) throw cancelled();
    throw new DsUpgradeError(
      'ds-upgrade-proof-failed',
      `the proof could not run: ${(e as Error).message}`.slice(0, 400)
    );
  } finally {
    clearInterval(heart);
    clearInterval(watch);
    await Promise.all(studios.map((s) => s.stop().catch(() => {})));
    finished = true;
    clearProgress(stateDir);
    clearCancel(stateDir);
  }
  const now = (deps.now ?? Date.now)();
  writeFileSync(
    join(stateDir, 'diff.json'),
    `${JSON.stringify({ format: DIFF_FORMAT, v: 1, deltaE: DELTA_E, ratio: FAIL_RATIO, ...result }, null, 2)}\n`
  );
  const { review } = reviewOf(stage, plan, result, now);
  writeFileSync(join(stateDir, 'review.json'), `${JSON.stringify(review, null, 2)}\n`);
  return review;
}

export { reviewOf };
