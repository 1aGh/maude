// ds-check's canvas modes (V2-1.13 §5.8): --canvas / --canvases / --changed / --fix=mechanical /
// --cheatsheet / --hook. Kept apart from cli.ts so the system half stays small.

import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  type CanvasContext,
  type CanvasReport,
  canvasRelOf,
  checkCanvas,
  fixCanvas,
  isCanvasFile,
  scopeToChanged,
} from './canvas-check.ts';
import { checkSystem, type SystemReport } from './check.ts';
import type { DsCheckArgs, Project, RunResult } from './cli.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import { diskFs, loadSystem, type SystemModel } from './system.ts';

export function canvasContext(project: Project): CanvasContext {
  const idx = indexRegistry(loadRegistry());
  const fs = diskFs(project.designRoot);
  const models = new Map<string, SystemModel>();
  const reports = new Map<string, SystemReport>();
  for (const s of project.systems) {
    const m = loadSystem(fs, s);
    models.set(s.name, m);
    reports.set(s.name, checkSystem(m, idx));
  }
  return {
    designRoot: project.designRoot,
    config: project.config,
    systems: project.systems,
    models,
    reports,
    idx,
  };
}

/** Every canvas under the design root (files whose path has no `_` / `.` segment). */
export function listCanvases(designRoot: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(join(designRoot, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (isCanvasFile(r)) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

/** The system a tokens / components stylesheet belongs to, when the file is one. */
function systemOfFile(project: Project, rel: string): string | null {
  for (const s of project.systems) {
    if (
      rel === s.tokensCssRel ||
      rel === `${s.path}/preview/_components.css` ||
      rel === `${s.path}/components.json`
    )
      return s.name;
  }
  return null;
}

export function cheatsheet(ctx: CanvasContext, ds: string): string {
  const reg = ctx.idx.reg;
  const report = ctx.reports.get(ds);
  const model = ctx.models.get(ds);
  if (!report || !model) return `ds-check: unknown design system "${ds}"\n`;
  const lines: string[] = [`# ${ds} — schema v1 roles (use these names; never a literal)`];
  const groups = new Map<string, string[]>();
  for (const r of reg.roles) {
    if (r.family === 'presence' && !model.config.activeFamilies.includes('presence')) continue;
    const g = groups.get(r.group) ?? [];
    g.push(r.name);
    groups.set(r.group, g);
  }
  for (const [g, names] of groups) lines.push(`${g}: ${names.join(' ')}`);
  lines.push(
    'meanings: --accent = action fill · --accent-text = accent as text/link · --accent-soft/--accent-on-soft = tint + its text'
  );
  lines.push(
    '          --bg-0 page · --bg-1 card · --bg-2 popover · --bg-3 input/hover · --bg-4 pressed · --fg-0..3 primary→disabled'
  );
  lines.push(
    '          --status-X fill · --status-X-fg text on it · --status-X-soft tint · --status-X-text as text · --scrim backdrop'
  );
  const t2 = Object.entries(report.tier2).map(([k, v]) => `${k}: ${v.join(' ')}`);
  if (t2.length) lines.push(`tier 2 (this system): ${t2.join(' · ')}`);
  if (report.own.prefixed.length)
    lines.push(`own (--x-*, puts the canvas in review): ${report.own.prefixed.join(' ')}`);
  const cj = model.componentsJson.data as {
    components?: Record<string, { class: string }>;
    typeRoles?: Record<string, string>;
  } | null;
  const comps = reg.components.core.map(
    (c) =>
      `${c.name}${cj?.components?.[c.name] ? `=.${cj.components[c.name].class.replace(/ /g, '.')}` : ''}`
  );
  lines.push(`components (@maude/ds): ${comps.join(' ')}`);
  lines.push(
    `type roles: ${reg.typeRoles
      .filter((t) => t.required)
      .map((t) => `.${cj?.typeRoles?.[t.role] ?? t.class}`)
      .join(' ')} (+ <Text role>)`
  );
  const missing = report.components.declaredMissing.icons;
  lines.push(
    `icons (<Icon name>): ${reg.icons.vocabulary.filter((n) => !missing.includes(n)).join(' ')}${missing.length ? ` — no glyph: ${missing.join(' ')}` : ''}`
  );
  lines.push(
    'rules: wrap artboards in class="ds" + data-theme (<DSRoot> when canvas-lib has it), set meta.designSystem; a palette opt-out goes in a --c-* block on the canvas root;'
  );
  lines.push(
    '       never import system/<ds>/preview/*.tsx or another system; never a literal colour, size or font outside --c-*.'
  );
  return `${lines.slice(0, 60).join('\n')}\n`;
}

function hookJson(context: string): string {
  return `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } })}\n`;
}

/** The 1-based line span an Edit / MultiEdit wrote, located in the file as it is now. */
function editedRange(
  project: Project,
  file: string,
  hookInput: string | null
): { file: string; from: number; to: number } | null {
  try {
    const j = JSON.parse(hookInput ?? '');
    const ti = j?.tool_input ?? {};
    const news: string[] =
      typeof ti.new_string === 'string'
        ? [ti.new_string]
        : Array.isArray(ti.edits)
          ? ti.edits
              .map((e: { new_string?: string }) => e?.new_string)
              .filter((s: unknown) => typeof s === 'string')
          : [];
    if (!news.length || news.some((s) => !s)) return null;
    const rel = canvasRelOf(project.designRoot, project.root, file);
    const text = readFileSync(join(project.designRoot, rel), 'utf8');
    let from = Number.POSITIVE_INFINITY;
    let to = 0;
    for (const s of news) {
      const at = text.indexOf(s);
      if (at < 0) return null;
      const a = text.slice(0, at).split('\n').length;
      from = Math.min(from, a);
      to = Math.max(to, a + s.split('\n').length - 1);
    }
    return { file: rel, from, to };
  } catch {
    return null;
  }
}

function fileFromHookInput(hookInput: string | null): string | null {
  if (!hookInput) return null;
  try {
    const j = JSON.parse(hookInput);
    const p = j?.tool_input?.file_path ?? j?.tool_input?.path ?? j?.tool_response?.filePath;
    return typeof p === 'string' ? p : null;
  } catch {
    return null;
  }
}

function summarize(r: CanvasReport, limit = 20): string[] {
  const out = [`${r.path} (${r.system ?? 'no system'}): ${r.state}`];
  const rank = { blocker: 0, autofix: 1, warning: 2 } as const;
  const ordered = [...r.findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
  for (const f of ordered.slice(0, limit))
    out.push(
      `  ${f.severity === 'blocker' ? '✗' : f.severity === 'autofix' ? '↺' : '!'} ${f.rule} ${f.kind}${f.name ? ` ${f.name}` : ''} — ${f.file}:${f.line}${f.fix ? ` → ${f.fix}` : ''}`
    );
  if (r.findings.length > limit) out.push(`  … ${r.findings.length - limit} more`);
  const pins = Object.entries(r.pins);
  if (pins.length) out.push(`  pins: ${pins.map(([k, v]) => `${k}×${v}`).join(', ')}`);
  return out;
}

export function runCanvasModes(
  args: DsCheckArgs,
  project: Project,
  systemsSelected: SystemReport[] | null,
  t0: number,
  hookInput: string | null
): RunResult {
  const ctx = canvasContext(project);
  if (args.cheatsheet) {
    const ds =
      args.systems[0] ??
      (project.config.defaultDesignSystem as string | undefined) ??
      project.systems[0]?.name;
    return { code: 0, stdout: cheatsheet(ctx, ds as string), stderr: '' };
  }
  // ── which canvases ────────────────────────────────────────────────────────
  let targets: string[] = [];
  const hookSystems: string[] = [];
  const inputs = [...args.canvases, ...args.changed.map((c) => c.file)];
  // An Edit hook names the text it wrote: lint those lines only (like /design:edit), so the
  // agent hears about what it just did, not the canvas's legacy debt. A Write lints the file.
  let hookRange: { file: string; from: number; to: number } | null = null;
  if (args.hook && !inputs.length) {
    const f = fileFromHookInput(hookInput);
    if (f) {
      inputs.push(f);
      hookRange = editedRange(project, f, hookInput);
    }
  }
  for (const input of inputs) {
    const rel = canvasRelOf(project.designRoot, project.root, input);
    const sys = systemOfFile(project, rel);
    if (sys) {
      hookSystems.push(sys);
      continue;
    }
    const tsx = rel.endsWith('.css') ? rel.replace(/\.css$/, '.tsx') : rel;
    if (isCanvasFile(tsx)) targets.push(tsx);
  }
  if (args.allCanvases) {
    const names = new Set(args.systems.length ? args.systems : project.systems.map((s) => s.name));
    for (const c of listCanvases(project.designRoot)) {
      const r = checkCanvas(ctx, c);
      if (r.system && names.has(r.system)) targets.push(c);
    }
  }
  targets = [...new Set(targets)];
  let reports = targets.map((c) => checkCanvas(ctx, c));
  if (hookRange)
    reports = reports.map((r) =>
      scopeToChanged(r, [hookRange as { file: string; from: number; to: number }])
    );
  if (args.changed.length) {
    const ranges = args.changed.map((g) => ({
      ...g,
      file: canvasRelOf(project.designRoot, project.root, g.file),
    }));
    reports = reports.map((r) => scopeToChanged(r, ranges));
  }

  // ── hook: always exit 0, findings as additionalContext ───────────────────
  if (args.hook) {
    if (project.config.schemaLint === 'off') return { code: 0, stdout: '', stderr: '' };
    const lines: string[] = [];
    for (const s of hookSystems) {
      const r = ctx.reports.get(s) as SystemReport;
      lines.push(
        `ds-check ${s}: ${r.level} (${r.exit})${r.reasons.length ? ` — ${r.reasons.join(', ')}` : ''}`
      );
      if (ctx.models.get(s)?.converted)
        lines.push(
          '  (converted system: this outside edit will arrive as a review in the Maude app)'
        );
    }
    for (const r of reports)
      if (r.findings.length || r.state === 'blocked') lines.push(...summarize(r, 12));
    if (!lines.length) return { code: 0, stdout: '', stderr: '' };
    lines.push(
      'Schema names: maude design ds-check --cheatsheet <ds>. Mechanical fixes (↺): maude design ds-check --fix=mechanical --canvas <file>.'
    );
    return { code: 0, stdout: hookJson(lines.join('\n')), stderr: '' };
  }

  // ── fix ───────────────────────────────────────────────────────────────────
  const fixed: { file: string; edits: number }[] = [];
  if (args.fix) {
    const plans = reports.map((r) => fixCanvas(ctx, r));
    // refuse everything if any file changed since it was read
    for (const plan of plans)
      for (const [file, p] of plan)
        if (readFileSync(join(project.designRoot, file), 'utf8') !== p.before)
          return {
            code: 13,
            stdout: '',
            stderr: `ds-check --fix refused, nothing written: ${file} changed while checking\n`,
          };
    for (const plan of plans)
      for (const [file, p] of plan) {
        if (p.after === p.before) continue;
        fixed.push({ file, edits: p.edits });
        if (args.dryRun) continue;
        const abs = join(project.designRoot, file);
        const tmp = `${abs}.tmp-${process.pid}`;
        writeFileSync(tmp, p.after);
        renameSync(tmp, abs);
      }
    if (!args.dryRun && fixed.length) reports = targets.map((c) => checkCanvas(ctx, c));
  }

  const blocked = reports.some((r) => r.state === 'blocked');
  const sysCode = systemsSelected?.length
    ? systemsSelected.some((r) => r.exit === 11)
      ? 11
      : systemsSelected.some((r) => r.exit === 10)
        ? 10
        : 0
    : 0;
  const code = sysCode || (blocked ? 12 : 0);
  if (args.json) {
    const out = {
      format: 'maude.ds-check-report',
      v: 1,
      registry: 1,
      durationMs: Math.round(performance.now() - t0),
      systems: systemsSelected ?? [],
      canvases: reports.map((r) => ({ ...r, findings: r.findings.map(({ span: _s, ...f }) => f) })),
      ...(args.fix ? { fixed, dryRun: args.dryRun } : {}),
    };
    return { code, stdout: `${JSON.stringify(out, null, 2)}\n`, stderr: '' };
  }
  const lines: string[] = [];
  if (args.fix)
    lines.push(
      fixed.length
        ? `${args.dryRun ? 'would fix' : 'fixed'}: ${fixed.map((f) => `${f.file} (${f.edits})`).join(', ')}`
        : 'nothing to fix'
    );
  for (const r of reports) lines.push(...(args.quiet ? [`${r.path}: ${r.state}`] : summarize(r)));
  if (!reports.length) lines.push('no canvas matched');
  return { code, stdout: `${lines.join('\n')}\n`, stderr: '' };
}

export { relative, resolve };
