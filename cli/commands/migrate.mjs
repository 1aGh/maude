// `maude migrate v2 [--apply] [--reverse [--strip]] [--json] [--root <repo>]`
// — V2-1.12 §5.10 (Gate 0 A17). The engine is TypeScript in the studio tree
// (`apps/studio/migrate/cli.ts`, reused in-process by the app's "Update
// project"), so this shim only finds a Bun to run it with: a real `bun` on
// PATH, else the bundled compiled binary acting as Bun (`BUN_BE_BUN=1`,
// DDR-177 — the target user has no terminal and no bun). stdout, stderr and
// the exit code (0 / 10 / 11 / 1 / 2) pass straight through.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { isCompiledBinary } from '../lib/pkg-root.mjs';
import { resolveServerBinary } from './design.mjs';

const USAGE = 'usage: maude migrate v2 [--apply] [--reverse [--strip]] [--json] [--root <repo>]\n';

function bunOnPath(pathStr) {
  for (const dir of (pathStr || '').split(':'))
    if (dir && existsSync(join(dir, 'bun'))) return true;
  return false;
}

/** `{ cmd, env }` that runs a .ts file under Bun, or null. */
export function resolveBunRunner(pkgRoot, env = process.env) {
  if (bunOnPath(env.PATH)) return { cmd: 'bun', env };
  const candidates = [
    env.MAUDE_DEV_SERVER_BIN,
    isCompiledBinary() ? process.execPath : null,
    resolveServerBinary({ pkgRoot }),
  ];
  const bin = candidates.find((c) => c && existsSync(c));
  return bin ? { cmd: bin, env: { ...env, BUN_BE_BUN: '1' } } : null;
}

export async function run({ args, pkgRoot }) {
  if (args[0] !== 'v2' || args.includes('--help') || args.includes('-h')) {
    process.stderr.write(USAGE);
    process.exit(args[0] === 'v2' ? 0 : 2);
  }
  const script = join(pkgRoot, 'apps', 'studio', 'migrate', 'cli.ts');
  if (!existsSync(script)) {
    process.stderr.write(`maude migrate: the migrator is missing at ${script}. Reinstall maude.\n`);
    process.exit(1);
  }
  const runner = resolveBunRunner(pkgRoot);
  if (!runner) {
    process.stderr.write(
      'maude migrate: no Bun runtime found (install bun, or use Update project in the app).\n'
    );
    process.exit(1);
  }
  const r = spawnSync(runner.cmd, ['run', script, ...args], { stdio: 'inherit', env: runner.env });
  process.exit(typeof r.status === 'number' ? r.status : 1);
}
