/**
 * WebdriverIO config — the invite landing lane (S6.11; 02 ob-invite-landed, ob-edge-accounts).
 *
 * Starts like the Home lane (no MAUDE_PROJECT_ROOT, an empty e2e app-state → the `home` window) with a
 * STUB control plane on loopback in MAUDE_CLOUD_URL, so an invite peek never reaches cloud.maude.sh:
 *   GET /api/invites/<LIVE>/peek → Tereza's invite to "Alligators brand" for you@work-studio.cz
 *   GET /api/invites/<anything else>/peek → the one 404 body (DEAD_LINK rule)
 * Every request the stub answers is appended to MAUDE_E2E_INVITE_LOG (one JSON line: method + path —
 * the id is in the cloud API path by contract §5.3), so the spec, which runs in the worker, can read it.
 * Profiles, cloud.json and the keychain are throwaway (XDG_CONFIG_HOME, MAUDE_CLOUD_CONFIG,
 * MAUDE_E2E_FAKE_KEYCHAIN): the developer's ~/.config/maude and keychain are never read or written.
 *
 * Run: `pnpm --filter @maude/desktop-e2e e2e:invite-landing` (debug build; under /tmp/maude-e2e.lock).
 */
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const LIVE_INVITE = '0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab';
export const DEAD_INVITE = '0b6f3d4e-1c2a-4b5d-8e9f-00000000dead';
export const INVITE_PEEK = {
  projectName: 'Alligators brand',
  fromName: 'Tereza',
  email: 'you@work-studio.cz',
  role: 'member',
  canvas: { path: 'ui/Combine-kampan.tsx', name: 'Combine-kampan' },
  thread: 'th_01',
};
const GONE = {
  reason: 'gone',
  error: 'This invitation link is not valid. Ask the person who invited you for a new one.',
};

delete process.env.MAUDE_PROJECT_ROOT;

// Evaluated by the launcher (which starts the app) AND the worker: the stub and the scratch dirs are
// made once, in the launcher; the worker inherits their env.
if (!process.env.MAUDE_E2E_INVITE_LOG) {
  const e2eConfigDir = join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e');
  for (const f of ['app-state.json', 'last-project.txt'])
    rmSync(join(e2eConfigDir, f), { force: true });
  const scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-invite-'));
  const log = join(scratch, 'stub.ndjson');
  const srv = createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    appendFileSync(log, `${JSON.stringify({ method: req.method, path })}\n`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const peek = /^\/api\/invites\/([0-9a-f-]{36})\/peek$/.exec(path);
    if (peek && req.method === 'GET')
      return peek[1] === LIVE_INVITE ? send(200, INVITE_PEEK) : send(404, GONE);
    send(404, { error: 'not stubbed' });
  });
  const port: number = await new Promise((ok) =>
    srv.listen(0, '127.0.0.1', () => ok((srv.address() as { port: number }).port))
  );
  process.env.MAUDE_CLOUD_URL = `http://127.0.0.1:${port}`;
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'cloud.json');
  process.env.HUBS_CONFIG_PATH = join(scratch, 'hubs.json');
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'maude-e2e-xdg-'));
  process.env.MAUDE_INDEX_DIR = mkdtempSync(join(tmpdir(), 'maude-e2e-invite-index-'));
  process.env.MAUDE_E2E_FAKE_KEYCHAIN = '1';
  process.env.MAUDE_E2E_INVITE_LOG = log;
}

process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/invite-landing',
  new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
);

const { config: base } = await import('./wdio.conf.ts');

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'invite-landing.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 240_000 },
};
