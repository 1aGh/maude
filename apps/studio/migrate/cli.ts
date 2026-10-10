// `maude migrate v2 [--apply] [--reverse [--strip]] [--json] [--root <repo>]`
// (V2-1.12 §5.10). Run under bun by `cli/commands/migrate.mjs` (DDR-062/177).
//
// Exit codes: 0 done / clean dry-run · 10 already at target · 11 refused,
// nothing written · 1 error · 2 usage.
//
// Permission tier (A13): the dry-run is read-only and auto-approved; `--apply`
// shows the permission card in the AI chat (V2-2.4b's verb tier table).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { getHubRecord } from '../sync/hubs-config.ts';
import {
  applyMigration,
  capReport,
  EXIT,
  type MigrateOptions,
  type MigrateReport,
  planMigration,
} from './engine.ts';

export interface CliArgs {
  apply: boolean;
  reverse: boolean;
  strip: boolean;
  json: boolean;
  root: string | null;
}

export function parseCliArgs(argv: readonly string[]): CliArgs | { error: string } {
  const a: CliArgs = { apply: false, reverse: false, strip: false, json: false, root: null };
  const rest = [...argv];
  if (rest[0] !== 'v2')
    return {
      error: 'usage: maude migrate v2 [--apply] [--reverse [--strip]] [--json] [--root <repo>]',
    };
  rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--apply') a.apply = true;
    else if (t === '--reverse') a.reverse = true;
    else if (t === '--strip') a.strip = true;
    else if (t === '--json') a.json = true;
    else if (t === '--root') {
      const v = rest[++i];
      if (!v) return { error: '--root needs a path' };
      a.root = v;
    } else return { error: `unknown option ${t}` };
  }
  if (a.strip && !a.reverse) return { error: '--strip only goes with --reverse' };
  return a;
}

function designRelOf(repoRoot: string): string {
  try {
    const cfg = JSON.parse(readFileSync(path.join(repoRoot, '.design', 'config.json'), 'utf8')) as {
      designRoot?: unknown;
    };
    if (typeof cfg.designRoot === 'string' && cfg.designRoot.trim())
      return cfg.designRoot.replace(/^\/+|\/+$/g, '') || '.design';
  } catch {
    /* the engine reports a missing / broken config */
  }
  return '.design';
}

function linkedHub(repoRoot: string): MigrateOptions['hub'] {
  try {
    const cfg = JSON.parse(readFileSync(path.join(repoRoot, '.design', 'config.json'), 'utf8')) as {
      linkedHub?: { url?: unknown };
    };
    const url = cfg.linkedHub?.url;
    if (typeof url !== 'string') return null;
    const rec = getHubRecord(url);
    // Absent role means `member` (hubs-config) — never an owner by default.
    return rec ? { url, token: rec.token, role: rec.role ?? 'member' } : null;
  } catch {
    return null;
  }
}

/** One line per step for people; `--json` prints the report instead. */
export function humanReport(r: MigrateReport): string {
  const out: string[] = [];
  const verb = r.direction === 'forward' ? 'Update for Maude 2' : 'Back to Maude 1';
  out.push(`${verb}${r.dryRun ? ' — dry run, nothing written' : ''}`);
  out.push(`  project format ${r.project.formatBefore} → ${r.project.formatAfter}`);
  for (const ref of r.refusals) out.push(`  refused: ${ref.reason}`);
  for (const s of r.steps) {
    const n = s.filesTotal ?? s.files.length;
    out.push(`  ${s.id.padEnd(20)} ${s.status}${n ? ` · ${n} file${n === 1 ? '' : 's'}` : ''}`);
    for (const ref of s.refusals)
      out.push(`      refused: ${ref.path ? `${ref.path}: ` : ''}${ref.reason}`);
    for (const l of s.lost) out.push(`      removes ${l.field} ×${l.count} in ${l.path}`);
    for (const note of s.notes.slice(0, 5)) out.push(`      ${note}`);
  }
  if (r.snapshot) out.push(`  originals kept in ${r.project.designRoot}/${r.snapshot}`);
  if (r.dryRun && r.exitCode === EXIT.done) out.push(`  run again with --apply to write`);
  return `${out.join('\n')}\n`;
}

export async function main(
  argv: readonly string[],
  env = process.env,
  stdinIsTTY?: boolean
): Promise<number> {
  const args = parseCliArgs(argv);
  if ('error' in args) {
    process.stderr.write(`${args.error}\n`);
    return EXIT.usage;
  }
  const repoRoot = path.resolve(args.root ?? env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (!existsSync(path.join(repoRoot, '.design'))) {
    process.stderr.write(`no .design/ directory at ${repoRoot}\n`);
    return EXIT.error;
  }
  const opts: MigrateOptions = {
    repoRoot,
    designRel: designRelOf(repoRoot),
    direction: args.reverse ? 'reverse' : 'forward',
    strip: args.strip,
    hub: linkedHub(repoRoot),
    log: (l) => process.stderr.write(`${l}\n`),
  };
  // An apply that changes the shared hub (every teammate's format) or strips v2 data is a
  // person's decision: refused without a terminal, so an agent steered by canvas text cannot
  // run it through the auto-approved `maude` verbs (security review, Phase 1 gate — M3).
  if (args.apply && (opts.hub || opts.strip) && !(stdinIsTTY ?? process.stdin.isTTY)) {
    process.stderr.write(
      `maude migrate v2 --apply ${opts.strip ? 'with --strip removes v2 data' : 'changes the linked hub for everyone'}; run it in your own terminal, or use Update project in the app.\n`
    );
    return EXIT.usage;
  }
  try {
    const dry = await planMigration(opts);
    const report = args.apply && dry.exitCode === EXIT.done ? await applyMigration(opts, dry) : dry;
    const shown = capReport(report);
    process.stdout.write(args.json ? `${JSON.stringify(shown, null, 2)}\n` : humanReport(shown));
    return report.exitCode;
  } catch (err) {
    process.stderr.write(`maude migrate v2: ${(err as Error).message}\n`);
    return EXIT.error;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
