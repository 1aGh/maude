// `maude design ds-check` — argument parsing, orchestration and output (V2-1.13 §5.8).
// In-process entry for tests and the migrator; `bin/_ds-check.mjs` is the process shim.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCanvasModes } from './canvas-cli.ts';
import { checkSystem, type SystemReport } from './check.ts';
import { emitTokensJson } from './emit.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import { diskFs, loadSystem, type SystemConfig, systemConfigsFrom } from './system.ts';

export const EXIT = {
  ok: 0,
  missing: 10,
  privateOnly: 11,
  canvasBlocked: 12,
  refused: 13,
  error: 1,
  usage: 2,
} as const;

export interface DsCheckArgs {
  systems: string[];
  all: boolean;
  canvases: string[];
  allCanvases: boolean;
  changed: { file: string; from: number; to: number }[];
  json: boolean;
  quiet: boolean;
  hook: boolean;
  cheatsheet: boolean;
  emit: boolean;
  fix: boolean;
  dryRun: boolean;
  root: string | null;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): DsCheckArgs {
  const a: DsCheckArgs = {
    systems: [],
    all: false,
    canvases: [],
    allCanvases: false,
    changed: [],
    json: false,
    quiet: false,
    hook: false,
    cheatsheet: false,
    emit: false,
    fix: false,
    dryRun: false,
    root: null,
  };
  let mode: 'systems' | 'canvas' | 'changed' = 'systems';
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    switch (t) {
      case '--all':
        a.all = true;
        break;
      case '--canvas':
        mode = 'canvas';
        break;
      case '--canvases':
        a.allCanvases = true;
        break;
      case '--changed':
        mode = 'changed';
        break;
      case '--json':
        a.json = true;
        break;
      case '--quiet':
        a.quiet = true;
        break;
      case '--hook':
        a.hook = true;
        break;
      case '--cheatsheet':
        a.cheatsheet = true;
        break;
      case '--emit':
        a.emit = true;
        break;
      case '--fix=mechanical':
        a.fix = true;
        break;
      case '--dry-run':
        a.dryRun = true;
        break;
      case '--root': {
        const v = argv[++i];
        if (!v) throw new UsageError('--root needs a path');
        a.root = v;
        break;
      }
      default:
        if (t.startsWith('--fix'))
          throw new UsageError(`unknown fix mode ${t} (only --fix=mechanical)`);
        if (t.startsWith('--')) throw new UsageError(`unknown flag ${t}`);
        if (mode === 'canvas') a.canvases.push(t);
        else if (mode === 'changed') {
          const m = /^(.+):(\d+)-(\d+)$/.exec(t);
          if (!m) throw new UsageError(`--changed takes <file>:<from>-<to>, got ${t}`);
          a.changed.push({ file: m[1], from: Number(m[2]), to: Number(m[3]) });
        } else a.systems.push(t);
    }
  }
  if (a.dryRun && !a.fix) throw new UsageError('--dry-run only applies to --fix=mechanical');
  return a;
}

export interface Project {
  root: string;
  designRoot: string;
  config: Record<string, unknown>;
  systems: SystemConfig[];
}

export function loadProject(
  rootArg: string | null,
  env: Record<string, string | undefined> = process.env
): Project {
  const root = resolve(rootArg ?? env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const designRoot = join(root, '.design');
  const cfgPath = join(designRoot, 'config.json');
  if (!existsSync(cfgPath)) throw new UsageError(`no .design/config.json under ${root}`);
  const config = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  return { root, designRoot, config, systems: systemConfigsFrom(config) };
}

export function selectSystems(project: Project, names: string[]): SystemConfig[] {
  if (!names.length) return project.systems;
  return names.map((n) => {
    const s = project.systems.find((x) => x.name === n);
    if (!s)
      throw new UsageError(
        `unknown design system "${n}" (config.designSystems: ${project.systems.map((x) => x.name).join(', ') || 'none'})`
      );
    return s;
  });
}

export function systemReports(project: Project, systems: SystemConfig[]): SystemReport[] {
  const idx = indexRegistry(loadRegistry());
  const fs = diskFs(project.designRoot);
  return systems.map((s) => checkSystem(loadSystem(fs, s), idx));
}

/** `--emit`: write each system's tokens.json. Returns refusals (converted systems). */
export function emitManifests(
  project: Project,
  systems: SystemConfig[]
): { written: string[]; refused: string[] } {
  const idx = indexRegistry(loadRegistry());
  const fs = diskFs(project.designRoot);
  const written: string[] = [];
  const refused: string[] = [];
  const pending: { abs: string; text: string; rel: string }[] = [];
  for (const s of systems) {
    const model = loadSystem(fs, s);
    if (model.converted) {
      refused.push(`${s.name}: converted (revisions/head.json) — the app owns tokens.json`);
      continue;
    }
    if (model.css === null) {
      refused.push(`${s.name}: ${s.tokensCssRel} is missing`);
      continue;
    }
    const text = emitTokensJson(model, idx);
    const rel = `${s.path}/tokens.json`;
    if (model.tokensJson === text) continue;
    pending.push({ abs: join(project.designRoot, rel), text, rel });
  }
  if (refused.length) return { written, refused };
  for (const p of pending) {
    const tmp = `${p.abs}.tmp-${process.pid}`;
    writeFileSync(tmp, p.text);
    renameSync(tmp, p.abs);
    written.push(p.rel);
  }
  return { written, refused };
}

function humanSystem(r: SystemReport): string {
  const lines = [
    `${r.name}: ${r.level} (${r.exit})${r.reasons.length ? ` — ${r.reasons.join(', ')}` : ''}`,
  ];
  const t = r.tier1;
  lines.push(`  tier 1: ${t.present}/${t.required} declared`);
  if (t.missing.length) lines.push(`  missing: ${t.missing.join(' ')}`);
  if (Object.keys(t.coveredByAlias).length)
    lines.push(
      `  under a native name: ${Object.entries(t.coveredByAlias)
        .map(([v, n]) => `${v} ← ${n}`)
        .join(', ')}`
    );
  for (const g of t.themeGaps.slice(0, 20)) lines.push(`  theme gap: ${g.name} in ${g.theme}`);
  for (const e of t.typeErrors.slice(0, 20))
    lines.push(`  type: ${e.name} = ${e.value} (expected ${e.expected}, line ${e.line})`);
  for (const u of t.unresolvedRefs.slice(0, 20))
    lines.push(`  unresolved: ${u.name} → var(${u.ref})`);
  for (const c of r.collisions) lines.push(`  collision: ${c.id} on ${c.name}`);
  for (const s of r.noDsScope)
    lines.push(`  no .ds scope: ${s.selectors} (${s.themes.join(', ')})`);
  if (r.own.unprefixed.length) lines.push(`  unprefixed own: ${r.own.unprefixed.join(' ')}`);
  const notInverted = r.aliases.filter((a) => !a.inverted);
  if (notInverted.length)
    lines.push(
      `  alias not inverted: ${notInverted.map((a) => `${a.native} → ${a.v1}`).join(', ')}`
    );
  if (r.reasons.includes('components-missing')) {
    if (r.components.manifest !== 'ok') lines.push(`  components.json: ${r.components.manifest}`);
    for (const e of r.components.errors.slice(0, 10)) lines.push(`    ${e}`);
    for (const [n, c] of Object.entries(r.components.core)) {
      const bad = [
        !c.present && 'absent',
        c.present && !c.class && 'class',
        ...Object.entries(c.variants)
          .filter(([, ok]) => !ok)
          .map(([v]) => `variant ${v}`),
        ...Object.entries(c.sizes)
          .filter(([, ok]) => !ok)
          .map(([v]) => `size ${v}`),
      ].filter(Boolean);
      if (bad.length) lines.push(`  component ${n}: ${bad.join(', ')}`);
    }
  }
  const b = r.components.brand;
  if (!b.logo) lines.push('  brand: no assets/logos/* + preview/logo.*');
  if (b.iconsMissing.length)
    lines.push(
      `  brand: icon map lacks ${b.iconsMissing.length} names (${b.iconsMissing.slice(0, 8).join(' ')}…)`
    );
  if (b.typeRolesMissing.length)
    lines.push(`  brand: type roles missing ${b.typeRolesMissing.join(' ')}`);
  const dm = r.components.declaredMissing;
  if (dm.icons.length)
    lines.push(
      `  info: ${r.name} declares no glyph for ${dm.icons.length} of 40 vocabulary icons (${dm.icons.join(' ')})`
    );
  if (dm.variants.length)
    lines.push(`  info: ${r.name} declares no class for ${dm.variants.join(', ')}`);
  if (r.manifests['tokens.json'] !== 'fresh')
    lines.push(`  tokens.json: ${r.manifests['tokens.json']}`);
  lines.push(
    `  C7: ${r.c7.families} accent famil${r.c7.families === 1 ? 'y' : 'ies'} vs ${r.c7.strategy} → ${r.c7.pass ? 'pass' : 'FAIL'}`
  );
  for (const n of r.notes)
    lines.push(`  note: ${n.id}${n.name ? ` (${n.name})` : ''} — ${n.detail}`);
  return lines.join('\n');
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runDsCheck(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  hookInput: string | null = null
): RunResult {
  const t0 = performance.now();
  let args: DsCheckArgs;
  let project: Project;
  try {
    args = parseArgs(argv);
    project = loadProject(args.root, env);
  } catch (e) {
    if (e instanceof UsageError)
      return { code: EXIT.usage, stdout: '', stderr: `ds-check: ${e.message}\n` };
    return { code: EXIT.error, stdout: '', stderr: `ds-check: ${(e as Error).message}\n` };
  }
  try {
    const systems = selectSystems(project, args.all ? [] : args.systems);
    const canvasMode =
      args.canvases.length ||
      args.allCanvases ||
      args.changed.length ||
      args.cheatsheet ||
      args.fix ||
      args.hook;
    if (canvasMode) {
      if (args.emit) throw new UsageError('--emit is a system flag; run it without canvas flags');
      // `<ds> --canvases`: the system result rides along (its code wins when non-zero)
      const sys = args.allCanvases && args.systems.length ? systemReports(project, systems) : null;
      return runCanvasModes(args, project, sys, t0, hookInput);
    }
    let emitted: { written: string[]; refused: string[] } | null = null;
    if (args.emit) {
      emitted = emitManifests(project, systems);
      if (emitted.refused.length) {
        return {
          code: EXIT.refused,
          stdout: '',
          stderr: `ds-check --emit refused, nothing written:\n  ${emitted.refused.join('\n  ')}\n`,
        };
      }
    }
    const reports = systemReports(project, systems);
    const code = reports.some((r) => r.exit === 11)
      ? 11
      : reports.some((r) => r.exit === 10)
        ? 10
        : 0;
    if (args.json) {
      const out = {
        format: 'maude.ds-check-report',
        v: 1,
        registry: 1,
        durationMs: Math.round(performance.now() - t0),
        systems: reports,
        canvases: [],
        ...(emitted ? { emitted: emitted.written } : {}),
      };
      return { code, stdout: `${JSON.stringify(out, null, 2)}\n`, stderr: '' };
    }
    if (args.quiet) {
      return {
        code,
        stdout: `${reports.map((r) => `${r.name}: ${r.level} (${r.exit})`).join('\n')}\n`,
        stderr: '',
      };
    }
    const head = emitted?.written.length ? `wrote ${emitted.written.join(', ')}\n` : '';
    return { code, stdout: `${head}${reports.map(humanSystem).join('\n\n')}\n`, stderr: '' };
  } catch (e) {
    if (e instanceof UsageError)
      return { code: EXIT.usage, stdout: '', stderr: `ds-check: ${e.message}\n` };
    return { code: EXIT.error, stdout: '', stderr: `ds-check: ${(e as Error).stack ?? e}\n` };
  }
}
