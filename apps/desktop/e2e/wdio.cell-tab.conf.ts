/**
 * WebdriverIO config for the cell-tab-browser-door scenario (S9.17): a `409 browser-door` answer
 * opens the cell as a `c-*` tab (once per account and cell, pinned to the cell's https origin, no
 * IPC), a foreign or malformed door is refused, and a project's unread mentions join the Dock
 * badge. Same two-project fixture as wdio.tabs-identity.conf.ts.
 * Run: `pnpm --filter @maude/desktop-e2e e2e:cell-tab` (macOS ≥ 14: cell tabs need per-account
 * WebKit data stores; elsewhere the scenario asserts the refusal instead).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifecycleFixtureOnce } from './fixtures/make-lifecycle-fixture';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

const { primary, secondary } = lifecycleFixtureOnce();
process.env.MAUDE_PROJECT_ROOT = primary;
process.env.MAUDE_E2E_SECONDARY_ROOT = secondary;
process.env.MAUDE_USE_SYSTEM_GIT = '1';
// A throwaway profile registry (profiles.rs), never the person's ~/.config/maude.
process.env.XDG_CONFIG_HOME ??= mkdtempSync(join(tmpdir(), 'maude-e2e-xdg-'));
process.env.MAUDE_E2E_FAKE_KEYCHAIN = '1';

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/cell-tab-browser-door',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'cell-tab-browser-door.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 240_000 },
};
