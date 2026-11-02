/**
 * WebdriverIO config for the ZERO-TERMINAL ACP COLD-START scenario (DDR-166,
 * Phase 0 / T0f). Proves the guided, button-driven install → sign-in → connect
 * flow works end to end with no terminal and no app restart.
 *
 * Three debug-only, env-gated stubs make this deterministic and CI-safe
 * (never present in the release `.app` — see the `desktop-e2e` skill):
 *   • MAUDE_E2E_FORCE_CLAUDE_STATUS=missing — simulates a machine with no
 *     `claude` on PATH (readiness.ts / probe.ts).
 *   • MAUDE_E2E_FAKE_CLAUDE_INSTALL=1 — `startInstall()` (login-state.ts)
 *     skips the real `curl | bash` installer and instead writes a tiny,
 *     offline, deterministic stand-in binary through the SAME freshness +
 *     content-hash verification path a real install goes through, so the
 *     security-critical trust logic stays exercised, not bypassed.
 *   • MAUDE_E2E_CLAUDE_INSTALL_PATH — redirects the "well-known install path"
 *     to a disposable temp file for this run only, so the stub NEVER writes
 *     into a real developer's actual `~/.local/bin/claude`.
 * A verified MAUDE_CLAUDE_BIN override always wins over the force-missing
 * stub once the fake install completes (probe.ts / readiness.ts precedence
 * fix) — otherwise the scenario could never observe its own install taking
 * effect.
 *
 * Run: `pnpm test:e2e:desktop:acp-cold-start`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// The e2e bundle id (com.maude.app.e2e) persists its own app-config dir
// ACROSS runs (unlike a fresh install) — a prior interactive session (e.g.
// toggling the Settings "auto setup" checkbox by hand while poking at the
// e2e build) can leave `claude_auto_setup: false` on disk, which would
// silently suppress the install/sign-in buttons this scenario exists to
// exercise. Reset to the default (unset → prefs.rs's own `true` default)
// so this scenario's result depends only on the code, not on ambient state
// from an unrelated prior run — mirrors wdio.onboarding.conf.ts's reset of
// its own app-state.json/last-project.txt for the same reason.
rmSync(join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e', 'prefs.json'), {
  force: true,
});

process.env.MAUDE_E2E_FORCE_CLAUDE_STATUS = 'missing';
// wdio.conf.ts names the lane's stub in MAUDE_CLAUDE_BIN, and an explicit override out-ranks the forced-missing
// status (acp/probe.ts) — this lane starts with NO claude, so it empties it; the install flow sets it again.
process.env.MAUDE_CLAUDE_BIN = '';
process.env.MAUDE_E2E_FAKE_CLAUDE_INSTALL = '1';
const installDir = mkdtempSync(join(tmpdir(), 'maude-e2e-claude-install-'));
process.env.MAUDE_E2E_CLAUDE_INSTALL_PATH = join(installDir, 'claude');

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/acp-cold-start',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'acp-cold-start.e2e.ts')],
  // Install stub (1.2s) + up to two 2s sign-in poll ticks + first-launch
  // boot-self-heal headroom inherited from the base config.
  mochaOpts: { ...base.mochaOpts, timeout: 240_000 },
};
