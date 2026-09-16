/**
 * WebdriverIO config — S20: the invited designer, on a REAL upgraded deployment.
 *
 * The scenario spec's S20 cell is the one check that cannot be satisfied by a
 * fixture: "invite → open → edit → undo → quit → reopen on actual upgraded
 * initial deployments". `wdio.team-project.conf.ts` runs the same door against
 * a local hub it starts itself; this config starts nothing. It points the
 * debug `.app` at a deployment that is already live and lets the product do
 * the rest.
 *
 * Because the target is somebody's production project, this config is
 * deliberately inert without explicit addressing:
 *
 *   MAUDE_S20_HUB       https://design.example.com — the deployment
 *   MAUDE_S20_EMAIL     the invited designer's address
 *   MAUDE_S20_PASSWORD  the password they set when they redeemed the invite
 *   MAUDE_S20_LABEL     optional, names the run in the report
 *
 * Absent any of the three, every test skips. There is no default target.
 *
 * What it still isolates: the designer's machine. A fresh first-run home for
 * the e2e bundle id, an empty hub credential file and an empty cloud session,
 * so the run can neither read nor write the developer's own `hubs.json`
 * (plan T31's gotcha).
 *
 * Run: `pnpm test:e2e:desktop:s20` (after `pnpm test:e2e:desktop:build`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// TSX sync is coupled to the canvas-origin split (DDR-060 / DDR-054 §F1); the
// base config turns the split OFF for frame access, which would leave the app
// with nothing syncable. On here — S20 is a sync scenario, and every step of
// it is driven from the shell DOM rather than from inside the canvas.
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';

// The base config points the shell at a fixture project; S20 must arrive at
// the real first run instead.
delete process.env.MAUDE_PROJECT_ROOT;

const hub = (process.env.MAUDE_S20_HUB ?? '').trim().replace(/\/$/, '');
const email = (process.env.MAUDE_S20_EMAIL ?? '').trim();
const password = process.env.MAUDE_S20_PASSWORD ?? '';

let scratch = '';
// WDIO loads this file in the launcher AND again in each worker; the worker
// inherits the environment the launcher prepared.
if (hub && email && password && !process.env.MAUDE_E2E_S20) {
  const appDir = join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e');
  for (const f of ['app-state.json', 'last-project.txt', 'managed-projects.json']) {
    rmSync(join(appDir, f), { force: true });
  }
  scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-s20-'));
  process.env.HUBS_CONFIG_PATH = join(scratch, 'designer-hubs.json');
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'designer-cloud.json');
  process.env.MAUDE_E2E_S20 = JSON.stringify({
    hub,
    email,
    password,
    label: (process.env.MAUDE_S20_LABEL ?? hub.replace(/^https?:\/\//, '')).trim(),
    appDir,
    scratch,
  });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(
    HERE,
    '../../../.ai/device/scenario-runs/s20-deployment',
    stamp
  );
}

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 's20-deployment.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 600_000 },
  onComplete() {
    // The managed copy of somebody's real project is NOT deleted here — the
    // spec's own cleanup removes what it created, and a checkout that took
    // minutes to arrive is worth keeping for a look afterwards.
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  },
};
