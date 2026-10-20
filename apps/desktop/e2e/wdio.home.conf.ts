/**
 * WebdriverIO config for the HOME window scenario (V2-3.3, contract V2-1.1 §7 `home.e2e.ts`).
 *
 * Like the onboarding lane this one does NOT set MAUDE_PROJECT_ROOT and starts from an empty
 * e2e app-state — so the boot opens the `home` window (no welcome-project sidecar) and the
 * WebDriver session starts on it.
 *
 * Two fixture projects are seeded into a fresh MAUDE_INDEX_DIR (fixtures/seed-home-index.ts, bun):
 * a snapshot, one canvas with a cover picture and a `_recent.json` each. The app inherits
 * MAUDE_INDEX_DIR, so the Home server and both project servers read the same index.
 *
 * Run: `pnpm test:e2e:desktop:home`.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

delete process.env.MAUDE_PROJECT_ROOT;

// This module is evaluated twice: by the launcher (which starts the app — its env is what the
// app and every server it spawns inherit) and again by the worker (which runs the spec, with the
// launcher's env). Seed ONCE, in the launcher: a second seed in the worker would hand the spec
// fixtures in an index dir the app never reads.
if (!process.env.MAUDE_E2E_HOME_FIXTURES) {
  const e2eConfigDir = join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e');
  for (const f of ['app-state.json', 'last-project.txt']) {
    rmSync(join(e2eConfigDir, f), { force: true });
  }
  process.env.MAUDE_INDEX_DIR = mkdtempSync(join(tmpdir(), 'maude-home-e2e-index-'));
  // V2-3.9: New Project… on Home creates `<this>/<name>` (home/create-local.ts), never ~/Maude.
  process.env.MAUDE_HOME_PROJECTS_DIR = mkdtempSync(join(tmpdir(), 'maude-home-e2e-projects-'));
  process.env.MAUDE_E2E_HOME_FIXTURES = execFileSync(
    'bun',
    [resolve(HERE, 'fixtures', 'seed-home-index.ts')],
    { env: process.env, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();
  // S6.11b — step 9 fires a real `maude://invite/<id>`, and Home now PEEKS it (S6.11 invite-flow): the
  // control plane is a loopback stub, as in wdio.invite-landing.conf.ts, so nothing reaches
  // cloud.maude.sh. Every peek is the one 404 (a dead invite); anything else is "not stubbed". Each
  // request is one JSON line (method + path) in MAUDE_E2E_HOME_CLOUD_LOG for the spec to read.
  const cloudLog = join(mkdtempSync(join(tmpdir(), 'maude-home-e2e-cloud-')), 'stub.ndjson');
  writeFileSync(cloudLog, '');
  const stub = createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    appendFileSync(cloudLog, `${JSON.stringify({ method: req.method, path })}\n`);
    const peek = req.method === 'GET' && /^\/api\/invites\/[0-9a-f-]{36}\/peek$/.test(path);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        peek
          ? {
              reason: 'gone',
              error:
                'This invitation link is not valid. Ask the person who invited you for a new one.',
            }
          : { error: 'not stubbed' }
      )
    );
  });
  const port: number = await new Promise((ok) =>
    stub.listen(0, '127.0.0.1', () => ok((stub.address() as { port: number }).port))
  );
  process.env.MAUDE_CLOUD_URL = `http://127.0.0.1:${port}`;
  // signed out, in throwaway files: the developer's cloud session never travels to the stub
  process.env.MAUDE_CLOUD_CONFIG = join(dirname(cloudLog), 'cloud.json');
  process.env.HUBS_CONFIG_PATH = join(dirname(cloudLog), 'hubs.json');
  process.env.MAUDE_E2E_HOME_CLOUD_LOG = cloudLog;
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/home', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'home.e2e.ts')],
  // Two cold project servers + the Home server.
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
