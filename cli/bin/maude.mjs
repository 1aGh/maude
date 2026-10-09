#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePkgRoot } from '../lib/pkg-root.mjs';
// maude — Maude CLI. Scaffold .ai workspace, run dev servers, manage config.
import { runUpdateCheck } from '../lib/update-check.mjs';

// DDR-166 T0b — real-disk resolution, safe inside a `bun build --compile`
// standalone binary (see pkg-root.mjs's own doc comment for why the previous
// `dirname(fileURLToPath(import.meta.url))` walk-up broke there).
const PKG_ROOT = resolvePkgRoot();

const COMMANDS = {
  init: () => import('../commands/init.mjs'),
  config: () => import('../commands/config.mjs'),
  cache: () => import('../commands/cache.mjs'),
  codex: () => import('../commands/codex.mjs'),
  preflight: () => import('../commands/preflight.mjs'),
  design: () => import('../commands/design.mjs'),
  'scenario-report': () => import('../commands/scenario-report.mjs'),
  doctor: () => import('../commands/doctor.mjs'),
  kg: () => import('../commands/kg.mjs'),
  help: () => import('../commands/help.mjs'),
  hub: () => import('../commands/hub.mjs'),
  harness: () => import('../commands/harness.mjs'),
  migrate: () => import('../commands/migrate.mjs'),
  version: () => import('../commands/version.mjs'),
};

function readCurrentVersion() {
  try {
    const raw = readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8');
    return JSON.parse(raw).version || null;
  } catch {
    return null;
  }
}

async function main(argv) {
  const args = argv.slice(2);
  const cmd = args[0];

  // Print "update available" notice (from cached registry data) before
  // dispatch, so it lands on stderr ahead of any subcommand output. Hot
  // path is sync + non-blocking — the stale-cache refresh is detached.
  runUpdateCheck(readCurrentVersion());

  if (!cmd || cmd === '--help' || cmd === '-h') {
    const { run } = await COMMANDS.help();
    return run({ args: args.slice(1), pkgRoot: PKG_ROOT });
  }
  if (cmd === '--version' || cmd === '-v') {
    const { run } = await COMMANDS.version();
    return run({ args: [], pkgRoot: PKG_ROOT });
  }

  // `maude studio [...]` — top-level alias for `maude design serve` (DDR-095:
  // the verb now matches the apps/studio home). Checked BEFORE the COMMANDS map
  // so it never falls through to the unknown-command branch; it is deliberately
  // NOT a COMMANDS entry (that would dispatch design.run with positional[0]
  // wrong). `maude design serve` keeps working unchanged.
  if (cmd === 'studio') {
    const { run } = await COMMANDS.design();
    return run({ args: ['serve', ...args.slice(1)], pkgRoot: PKG_ROOT });
  }

  const loader = COMMANDS[cmd];
  if (!loader) {
    process.stderr.write(
      `maude: unknown command "${cmd}"\nKnown: ${Object.keys(COMMANDS).join(', ')}.\nRun \`maude help\` for usage.\n`
    );
    process.exit(2);
  }
  const { run } = await loader();
  return run({ args: args.slice(1), pkgRoot: PKG_ROOT });
}

main(process.argv).catch((err) => {
  process.stderr.write(`maude: ${err.message}\n`);
  if (process.env.MAUDE_DEBUG || process.env.MDCC_DEBUG) process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
