/**
 * WebdriverIO config for the native first-run ONBOARDING scenario (Phase 29 / E4).
 *
 * Unlike every other config, this one does NOT set MAUDE_PROJECT_ROOT — it deletes the
 * base config's value so resolve_project_root() falls through to the welcome project and
 * `app_is_first_run` returns true, rendering the OnboardingWizard (the exact surface the
 * other configs deliberately suppress). Two debug-only stubs (gated #[cfg(debug_assertions)]
 * in the Rust shell, so NEVER in the release `.app`) make the wizard DOM-drivable without
 * native OS dialogs / OAuth:
 *   • MAUDE_E2E_FAKE_GITHUB_LOGIN — github_sign_in skips the device flow + network and
 *     reports a fake login (Door A · Continue with GitHub).
 *   • MAUDE_E2E_PICK_DIR — pick_directory returns this path instead of opening the native
 *     folder picker (Door B · Open a folder → Set up Maude here).
 * The pick dir is a FRESH EMPTY temp dir (no .design/) so the "set up Maude here" path
 * fires and scaffoldDesign seeds the starter Welcome canvas the scenario then asserts on.
 *
 * Run: `pnpm test:e2e:desktop:onboarding`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// First-run: the wizard only renders when the shell wasn't told what to open. Drop the
// base config's MAUDE_PROJECT_ROOT so resolve_project_root() boots the welcome project
// and app_is_first_run() is true.
delete process.env.MAUDE_PROJECT_ROOT;

// Guarantee a clean first run: clear any remembered project from a prior e2e run. The
// e2e bundle id is `com.maude.app.e2e` — its own app-config dir, isolated from a dev's
// real Maude (com.maude.app). macOS app_config_dir = ~/Library/Application Support/<id>.
const e2eConfigDir = join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e');
for (const f of ['app-state.json', 'last-project.txt']) {
  rmSync(join(e2eConfigDir, f), { force: true });
}

// Door B target: a fresh EMPTY folder (no .design/) so "Open a folder" → "Set up Maude
// here" fires and the seeded starter canvas is written into it.
process.env.MAUDE_E2E_PICK_DIR = mkdtempSync(join(tmpdir(), 'maude-onboarding-'));
// Door A target: a deterministic fake GitHub login (no browser / network / keychain).
process.env.MAUDE_E2E_FAKE_GITHUB_LOGIN = 'e2e-user';
// V2-3.3: a first launch with an empty app-state now opens Home (no welcome
// project). The debug-only MAUDE_FORCE_ONBOARDING keeps the old first-run boot
// — the welcome project's window with the OnboardingWizard over it — so this
// lane still drives the wizard. Never honored in a release build (lib.rs
// `resolve_boot_plan`, app_state.rs `is_first_run`).
process.env.MAUDE_FORCE_ONBOARDING = '1';

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/native-onboarding',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'onboarding.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 }, // first-run boot-self-heal + a sidecar switch
};
