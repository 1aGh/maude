/**
 * WebdriverIO config for #206 T6.4 (contract `apps/studio/client/v2/contracts/206-cli-reuses-desktop.md` §9,
 * DDR-250): a terminal design run reuses the running desktop app's server instead of starting its own.
 *
 * The scenario drives the CLI side for real — `cli/lib/desktop-locate.mjs` and `apps/studio/bin/server-up.sh`
 * against the app's own `servers.json` + `cli.sock` in the e2e bundle-id data dir — and checks the app side
 * through the strip, Home and the registry. The first-open consent sheet is native (not DOM-reachable), so this
 * lane starts the debug app with MAUDE_E2E_CLI_CONSENT=1: the shell parks each ticket and the debug-only
 * `e2e_cli_consent` answers it through the same path the sheet's buttons take (a release build compiles none
 * of that — `cli_channel.rs` `the_e2e_consent_answer_is_debug_only`).
 *
 * Isolation is the base conf's: a throwaway `maude-e2e-*` XDG config home, the `com.maude.app.e2e` data dir
 * (reset before and after), a stub `claude` first on PATH, NO_OPEN=1. Every CLI call this lane makes names the
 * e2e registry explicitly (MAUDE_APP_REGISTRY_FILE) — never the person's `com.maude.app` one.
 *
 * Run: `pnpm test:e2e:desktop:cli-reuse` (after `pnpm test:e2e:desktop:build`).
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base, E2E_BUNDLE_ID } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

process.env.MAUDE_E2E_CLI_CONSENT = '1';
process.env.MAUDE_E2E_APP_REGISTRY ??=
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', E2E_BUNDLE_ID, 'servers.json')
    : join(
        process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
        E2E_BUNDLE_ID,
        'servers.json'
      );

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/cli-reuse', stamp);
if (!process.env.MAUDE_E2E_RUN_DIR?.includes('cli-reuse')) process.env.MAUDE_E2E_RUN_DIR = RUN_DIR;
mkdirSync(process.env.MAUDE_E2E_RUN_DIR, { recursive: true });
process.env.MAUDE_E2E_SHELL_LOG ??= resolve(process.env.MAUDE_E2E_RUN_DIR, 'shell.log');

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'cli-reuse.e2e.ts')],
  // three cold sidecars (a worktree, two consent folders) plus a close grace
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
