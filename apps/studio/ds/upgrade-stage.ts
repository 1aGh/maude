// "Bring it up to the schema" — step 5, stage (V2-1.13 §5.10, S10.15a).
//
// A stage is two throwaway copies of the design root, `before/.design` and `after/.design`, in a
// fresh `mkdtemp` folder under the OS temp dir (never inside the live tree: the live studio's
// watchers, index and sync must not see a second copy of every canvas). Runtime state is stripped
// (the DDR-115 list), `assets/` folders and media files are symlinked, `config.json` loses
// `linkedHub` so a staged studio can never reach the team server. The plan is applied to `after/`
// only: the system half (span edits + manifests), then the canvas codemods computed against it.
//
// The record of a stage lives in the live tree's runtime state:
//   <designRoot>/_state/ds-upgrade/<ds>/<stamp>/stage.json   (+ plan.json; prove adds diff.json,
//                                                                review.json)
// `beforeTreeHash` covers every versioned file the copy took, so apply (step 8) refuses when the
// live tree moved after staging. The live tree is never written here (step 9).

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { isRuntimeStateRel } from '../sync/file-membership.ts';
import { canvasContext } from './canvas-cli.ts';
import { checkSystem } from './check.ts';
import { emitTokensJson } from './emit.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import { diskFs, loadSystem, type SystemConfig, systemConfigsFrom } from './system.ts';
import {
  applySystemPlan,
  mergeJudged,
  modelWithCss,
  type PlanItem,
  planMechanical,
  type Refusal,
  type UpgradePlan,
  validatePlan,
  validateResult,
} from './upgrade.ts';
import { type CodemodPlan, planCanvasCodemods } from './upgrade-codemod.ts';

export const STAGE_FORMAT = 'maude.ds-upgrade-stage';
export const STAGE_PREFIX = 'maude-ds-upgrade-';
export const STATE_REL = '_state/ds-upgrade';

export type UpgradeCode =
  | 'ds-unknown-system'
  | 'ds-upgrade-refused'
  | 'ds-upgrade-converted'
  | 'ds-upgrade-outside'
  | 'ds-upgrade-no-stage'
  | 'ds-upgrade-not-proved'
  | 'ds-upgrade-proof-failed'
  | 'ds-upgrade-stale'
  | 'ds-upgrade-usage'
  | 'ds-kernel-unavailable'
  | 'ds-kernel-rejected';

const STATUS: Partial<Record<UpgradeCode, number>> = {
  'ds-unknown-system': 404,
  'ds-upgrade-no-stage': 404,
  'ds-upgrade-refused': 422,
  'ds-upgrade-usage': 400,
  'ds-kernel-unavailable': 503,
};

/** Same shape as the engine's refusals (`ds-*` code + numeric `status`), so the route answers it alike. */
export class DsUpgradeError extends Error {
  readonly code: UpgradeCode;
  readonly status: number;
  readonly detail?: Record<string, unknown>;
  constructor(code: UpgradeCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'DsUpgradeError';
    this.code = code;
    this.status = STATUS[code] ?? 409;
    if (detail) this.detail = detail;
  }
}

export interface StageManifest {
  format: typeof STAGE_FORMAT;
  v: 1;
  system: string;
  stamp: string;
  /** the throwaway folder holding before/ and after/ (absolute, under the OS temp dir) */
  dir: string;
  beforeTreeHash: string;
  /** system files the apply writes on Plane B: tokens CSS, tokens.json, config.json */
  systemFiles: { rel: string; before: string | null; after: string }[];
  canvases: { path: string; edits: Record<string, number>; files: string[] }[];
  skipped: CodemodPlan['skipped'];
  refused: CodemodPlan['refused'];
  /** ds-check of the staged system exits 0 → apply sets `designSystems[].schema: 1` */
  conformantAfter: boolean;
  createdAt: number;
}

const MEDIA =
  /\.(?:png|jpe?g|gif|webp|avif|heic|svg|ico|mp4|mov|m4v|webm|mp3|wav|m4a|aac|ogg|flac|woff2?|ttf|otf|pdf|psd|zip)$/i;

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

/** A path inside the stage that is neither copied nor hashed: runtime state, VCS, deps. */
function skipped(rel: string, name: string): boolean {
  return (
    name === '.git' || name === 'node_modules' || name === '.DS_Store' || isRuntimeStateRel(rel)
  );
}
const linked = (name: string, dir: boolean) =>
  (dir && name === 'assets') || (!dir && MEDIA.test(name));

/**
 * The live tree's hash: every versioned, non-media file of the design root (path + bytes). Media
 * and `assets/` count by path only — they are symlinked into the stage, never rewritten.
 */
export function treeHash(designRoot: string): string {
  const h = createHash('sha256');
  const walk = (rel: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(join(designRoot, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skipped(r, e.name) || e.isSymbolicLink()) continue;
      const dir = e.isDirectory();
      if (linked(e.name, dir)) {
        h.update(`L\0${r}\0`);
        continue;
      }
      if (dir) walk(r);
      else if (e.isFile()) h.update(`F\0${r}\0${sha(readFileSync(join(designRoot, r)))}\0`);
    }
  };
  walk('');
  return `sha256:${h.digest('hex')}`;
}

function copyTree(src: string, dst: string): void {
  const walk = (rel: string) => {
    const to = join(dst, rel);
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(join(src, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skipped(r, e.name) || e.isSymbolicLink()) continue;
      const dir = e.isDirectory();
      if (linked(e.name, dir)) symlinkSync(join(src, r), join(dst, r));
      else if (dir) walk(r);
      else if (e.isFile()) copyFileSync(join(src, r), join(dst, r));
    }
  };
  walk('');
}

function readJson(abs: string): Record<string, unknown> {
  const v = JSON.parse(readFileSync(abs, 'utf8'));
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${abs} is not an object`);
  return v as Record<string, unknown>;
}

const jsonText = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** The system's config entry, or a refusal. */
export function systemOf(designRoot: string, ds: string): SystemConfig {
  const config = readJson(join(designRoot, 'config.json'));
  const cfg = systemConfigsFrom(config).find((s) => s.name === ds);
  if (!cfg)
    throw new DsUpgradeError(
      'ds-unknown-system',
      `no design system named ${String(ds).slice(0, 64)}`
    );
  return cfg;
}

/** `<designRoot>/_state/ds-upgrade/<ds>/<stamp>` — the stamp is digits only (never a path). */
export function stateDirOf(designRoot: string, ds: string, stamp: string): string {
  if (!/^[0-9]{1,20}(?:-[0-9]{1,4})?$/.test(stamp))
    throw new DsUpgradeError('ds-upgrade-usage', 'a stage is named by its stamp');
  return join(designRoot, STATE_REL, ds, stamp);
}

/** Read a stage record and check its throwaway folder is one this module made. */
export function readStage(designRoot: string, ds: string, stamp: string): StageManifest {
  const dir = stateDirOf(designRoot, ds, stamp);
  const file = join(dir, 'stage.json');
  if (!existsSync(file))
    throw new DsUpgradeError('ds-upgrade-no-stage', `no stage ${stamp} for ${ds}`);
  const m = readJson(file) as unknown as StageManifest;
  if (m.format !== STAGE_FORMAT || m.v !== 1 || m.system !== ds || m.stamp !== stamp)
    throw new DsUpgradeError('ds-upgrade-no-stage', `stage ${stamp} is not a ${ds} stage`);
  assertThrowaway(m.dir);
  return m;
}

/** A stage folder must sit directly in the OS temp dir with our prefix — never anywhere else. */
export function assertThrowaway(dir: unknown): string {
  const tmp = realpathSync(tmpdir());
  const abs = typeof dir === 'string' ? resolve(dir) : '';
  const real = abs && existsSync(abs) ? realpathSync(abs) : abs;
  const parent = dirname(real);
  const base = real.slice(parent.length + 1);
  if (!real || parent !== tmp || !base.startsWith(STAGE_PREFIX) || base.includes(sep))
    throw new DsUpgradeError('ds-upgrade-outside', 'the stage folder is not a throwaway copy');
  return real;
}

export interface StageInput {
  designRoot: string;
  ds: string;
  /** the judged items (or a whole plan) merged into the mechanical plan */
  judged: PlanItem[] | UpgradePlan;
  now?: () => number;
}

export interface StageResult {
  stage: StageManifest;
  plan: UpgradePlan;
}

/** Steps 2 + 4 + 5: plan, validate (13 on a breach), copy, apply to after/, record. */
export function stageUpgrade(inp: StageInput): StageResult {
  const now = inp.now ?? Date.now;
  const cfg = systemOf(inp.designRoot, inp.ds);
  const idx = indexRegistry(loadRegistry());
  const live = diskFs(inp.designRoot);
  const model = loadSystem(live, cfg);
  if (model.converted)
    throw new DsUpgradeError(
      'ds-upgrade-converted',
      `${cfg.name} is on a Design system canvas — bring it up through a publish`
    );
  const judged = Array.isArray(inp.judged) ? inp.judged : (inp.judged?.items ?? []);
  const plan = mergeJudged(planMechanical(model, idx), judged);
  const refusals: Refusal[] = validatePlan(model, idx, plan);
  const css = refusals.length ? null : applySystemPlan(model, plan);
  if (css !== null) refusals.push(...validateResult(model, modelWithCss(live, cfg, css), plan));
  if (refusals.length || css === null)
    throw new DsUpgradeError('ds-upgrade-refused', 'the plan breaks an invariant; nothing staged', {
      refused: refusals,
    });

  const beforeTreeHash = treeHash(inp.designRoot);
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `${STAGE_PREFIX}${cfg.name}-`));
  const before = join(dir, 'before', '.design');
  const after = join(dir, 'after', '.design');
  try {
    copyTree(inp.designRoot, before);
    copyTree(inp.designRoot, after);
    // a staged studio never reaches the team server, and never stamps the live machine file
    for (const root of [before, after]) {
      const { linkedHub: _hub, ...c } = readJson(join(root, 'config.json'));
      writeFileSync(join(root, 'config.json'), jsonText(c));
    }
    // the system half on after/
    const systemFiles: StageManifest['systemFiles'] = [];
    const put = (rel: string, text: string) => {
      const prev = existsSync(join(inp.designRoot, rel))
        ? readFileSync(join(inp.designRoot, rel), 'utf8')
        : null;
      if (prev === text) return;
      writeFileSync(join(after, rel), text);
      systemFiles.push({ rel, before: prev, after: text });
    };
    put(cfg.tokensCssRel, css);
    const afterModel = loadSystem(diskFs(after), cfg);
    if (plan.items.some((i) => i.kind === 'emit-manifests'))
      put(`${cfg.path}/tokens.json`, emitTokensJson(afterModel, idx));
    const report = checkSystem(loadSystem(diskFs(after), cfg), idx);
    const conformantAfter = report.reasons.length === 0;
    if (conformantAfter) {
      const liveConfig = readJson(join(inp.designRoot, 'config.json'));
      const list = liveConfig.designSystems as Record<string, unknown>[];
      const entry = list.find((s) => s && s.name === cfg.name);
      if (entry && entry.schema !== 1) {
        entry.schema = 1;
        const text = jsonText(liveConfig);
        // the staged copy keeps its own linkedHub-free config, with the same schema flag
        const staged = readJson(join(after, 'config.json'));
        const se = (staged.designSystems as Record<string, unknown>[]).find(
          (s) => s && s.name === cfg.name
        );
        if (se) se.schema = 1;
        writeFileSync(join(after, 'config.json'), jsonText(staged));
        systemFiles.push({
          rel: 'config.json',
          before: readFileSync(join(inp.designRoot, 'config.json'), 'utf8'),
          after: text,
        });
      }
    }
    // the canvas half, against the staged system
    const ctx = canvasContext({
      root: dirname(after),
      designRoot: after,
      config: readJson(join(after, 'config.json')),
      systems: systemConfigsFrom(readJson(join(after, 'config.json'))),
    });
    const cm = planCanvasCodemods(ctx, cfg.name);
    for (const c of cm.codemods)
      for (const f of c.files) writeFileSync(join(after, f.rel), f.after);
    const full: UpgradePlan = {
      ...plan,
      items: [...plan.items.filter((i) => i.kind !== 'canvas-codemod'), ...cm.items],
    };
    let stamp = String(now());
    let stateDir = stateDirOf(inp.designRoot, cfg.name, stamp);
    for (let i = 1; existsSync(stateDir); i++) {
      stamp = `${now()}-${i}`;
      stateDir = stateDirOf(inp.designRoot, cfg.name, stamp);
    }
    mkdirSync(stateDir, { recursive: true });
    const stage: StageManifest = {
      format: STAGE_FORMAT,
      v: 1,
      system: cfg.name,
      stamp,
      dir,
      beforeTreeHash,
      systemFiles,
      canvases: cm.codemods.map((c) => ({
        path: c.path,
        edits: c.edits,
        files: c.files.map((f) => f.rel),
      })),
      skipped: cm.skipped,
      refused: cm.refused,
      conformantAfter,
      createdAt: now(),
    };
    writeFileSync(
      join(stateDir, 'plan.json'),
      jsonText({ ...full, beforeTreeHash, analysis: null })
    );
    writeFileSync(join(stateDir, 'stage.json'), jsonText(stage));
    return { stage, plan: full };
  } catch (e) {
    rmSync(assertThrowaway(dir), { recursive: true, force: true });
    throw e;
  }
}

/**
 * `--discard`: the throwaway folder goes, and so does the record. The folder is removed only
 * after `assertThrowaway` proves it is a direct child of the OS temp dir with our prefix.
 */
export function discardStage(designRoot: string, ds: string, stamp: string): { discarded: string } {
  const stateDir = stateDirOf(designRoot, ds, stamp);
  let dir: string | null = null;
  try {
    dir = readStage(designRoot, ds, stamp).dir;
  } catch (e) {
    if (!(e instanceof DsUpgradeError) || e.code !== 'ds-upgrade-no-stage') throw e;
  }
  if (dir && existsSync(dir)) rmSync(assertThrowaway(dir), { recursive: true, force: true });
  if (existsSync(stateDir)) {
    // the record folder holds only what this module wrote; remove those names, then the folder
    for (const n of ['stage.json', 'plan.json', 'diff.json', 'review.json'])
      rmSync(join(stateDir, n), { force: true });
    try {
      rmdirSync(stateDir);
    } catch {
      /* something else is in there: keep it */
    }
  }
  return { discarded: stamp };
}
