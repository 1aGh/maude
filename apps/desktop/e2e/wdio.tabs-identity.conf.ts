/**
 * WebdriverIO config for the project-tabs-identity scenario (V2-3.5; old plan
 * T13 scenario 2; V2-3.8): each project keeps its own sign-in across tabs and
 * in-tab switches, and a notification click focuses the right tab. Same two-project fixture
 * as wdio.tabs.conf.ts. Run: `pnpm --filter @maude/desktop-e2e e2e:tabs-identity`.
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
// The profile registry lives under $XDG_CONFIG_HOME/maude (profiles.rs) — a
// throwaway one, so the scenario's `e2e-b` never lands in the person's real
// ~/.config/maude/profiles.json. The `default` profile's cloud.json is read
// from $HOME regardless (and only read).
process.env.XDG_CONFIG_HOME ??= mkdtempSync(join(tmpdir(), 'maude-e2e-xdg-'));
// keychain.rs (debug builds only, V2-3.8): an in-memory keychain, so the
// scenario drives the REAL sign-in write path (`e2e_github_sign_in_as`) and
// never touches the person's keychain. Every profile starts signed out.
process.env.MAUDE_E2E_FAKE_KEYCHAIN = '1';
delete process.env.MAUDE_E2E_GITHUB_SIGNED_IN_PROFILES;
process.env.MAUDE_E2E_SHELL_LOG ??= resolve(
  HERE,
  '../../../.ai/device/scenario-runs/project-tabs-identity',
  `shell-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.log`
);

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/project-tabs-identity',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'project-tabs-identity.e2e.ts')],
  // Two cold sidecars, a 10 s close grace, and a reopen.
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
