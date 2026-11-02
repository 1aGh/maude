/**
 * WebdriverIO config for the native FIRST RUN, which is Home (S6.8; V2-1.1 §7, 02 Onboarding).
 *
 * No wizard any more: a first launch with an empty app-state and an empty index opens the `home`
 * window with the sign-in card on it. So — like the Home lane — this config drops MAUDE_PROJECT_ROOT
 * and starts from an empty e2e
 * app-state. Unlike the Home lane nothing is seeded: the index is a fresh empty dir (no project, so
 * the card shows) and "Just a local project" creates under a throwaway MAUDE_HOME_PROJECTS_DIR, never
 * `~/Maude`.
 *
 * "No account" is a property of the MACHINE, not of this run: the default profile's credential is
 * `$HOME/.config/maude/cloud.json`. The scenario skips itself (loudly) when this Mac is signed in; the
 * cloud leg (a fake control plane, the browser sign-in) needs a debug-only "do not open the browser"
 * switch in the Rust shell and an isolated HOME — see the scenario's header.
 *
 * Run: `pnpm test:e2e:desktop:onboarding`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

delete process.env.MAUDE_PROJECT_ROOT;

// This module is evaluated by the launcher and again by the worker; clear and create ONCE.
if (!process.env.MAUDE_E2E_FIRST_RUN_PROJECTS) {
  // The e2e bundle id is `com.maude.app.e2e` — its own app-config dir, isolated from a dev's real
  // Maude (com.maude.app). macOS app_config_dir = ~/Library/Application Support/<id>.
  const e2eConfigDir = join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e');
  // `home/home.json` holds Home's per-Mac "the first-run card was shown" flag (P8 C8,
  // v2-p8-c8-first-run-card-once): any earlier lane's Home sets it, and then no first run is left to drive.
  for (const f of ['app-state.json', 'last-project.txt', join('home', 'home.json')]) {
    rmSync(join(e2eConfigDir, f), { force: true });
  }
  process.env.MAUDE_INDEX_DIR = mkdtempSync(join(tmpdir(), 'maude-first-run-index-'));
  process.env.MAUDE_HOME_PROJECTS_DIR = mkdtempSync(join(tmpdir(), 'maude-first-run-projects-'));
  process.env.MAUDE_E2E_FIRST_RUN_PROJECTS = process.env.MAUDE_HOME_PROJECTS_DIR;
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/native-onboarding',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'onboarding.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
