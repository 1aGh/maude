/**
 * WebdriverIO config — a designer opens their team's project (plan T21/T22).
 *
 * The designer's whole way in, on a clean install, with nothing stubbed on the
 * sync path:
 *
 *   • a REAL hub (the Node fixture, accepted revisions ON, password accounts)
 *   • a teammate's studio already working in the project — it seeds the
 *     canvases through the hub exactly as a person would
 *   • the debug `.app` on a first-run home: no MAUDE_PROJECT_ROOT, no remembered
 *     project, no managed copies, an empty hub credential file
 *
 * The scenario signs in with an email and password, never picks a folder, and
 * asserts the project's canvases arrive and changes flow both ways.
 *
 * Run: `pnpm test:e2e:desktop:team-project` (after `pnpm test:e2e:desktop:build`).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const children: ChildProcess[] = [];

export const TEAM_PASSWORD = 'designer-pass-1';

function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

function startHub(dataDir: string): Promise<{ http: string; tokens: Record<string, string> }> {
  return new Promise((ok, fail) => {
    const proc = spawn(
      'node',
      [join(ROOT, 'apps/hub/test/fixtures/serve-hub.mjs'), dataDir, '0', '--transactions', '--users'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    children.push(proc);
    let buf = '';
    const timer = setTimeout(() => fail(new Error(`hub did not start: ${buf}`)), 30_000);
    proc.stdout?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      const info = JSON.parse(line);
      ok({ http: info.http.replace(/\/$/, ''), tokens: info.tokens });
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

export const canvasSource = (title: string) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Team project">
        <DCArtboard id="main" label="MAIN" width={480} height={320}>
          <h1 style={{ padding: 32, fontFamily: "system-ui", color: "#111" }}>${title}</h1>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

async function until(what: string, fn: () => Promise<boolean>, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// TSX sync is coupled to the canvas-origin split (DDR-060 / DDR-054 §F1); the
// base config turns the split OFF for frame access, which would leave the
// teammate AND the app with nothing syncable. On for everything in this lane.
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';

// WDIO loads this file in the launcher AND again in each worker. The launcher
// sets everything up once; a worker inherits its environment and must not
// start a second hub and teammate (the app and the spec would then disagree
// about which project is real).
// First run in every process: the base config sets a fixture project root.
delete process.env.MAUDE_PROJECT_ROOT;
let scratch = '';
if (!process.env.MAUDE_E2E_TEAM) {
  scratch = await setUp();
}

async function setUp(): Promise<string> {
  // ── A first-run home for the e2e bundle id ────────────────────────────────
  const appDir = join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e');
  for (const f of ['app-state.json', 'last-project.txt', 'managed-projects.json']) {
    rmSync(join(appDir, f), { force: true });
  }

  const scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-team-'));
  const hub = await startHub(join(scratch, 'hub'));
  const managedDir = join(appDir, 'projects', `${hub.http.replace(/^https?:\/\//, '').replace(':', '-')}--local`);
  rmSync(managedDir, { recursive: true, force: true });

  // ── The teammate already at work ──────────────────────────────────────────
  const teammate = join(scratch, 'teammate');
  mkdirSync(join(teammate, '.design', 'ui'), { recursive: true });
  mkdirSync(join(teammate, '.design', 'screens'), { recursive: true });
  writeFileSync(
    join(teammate, '.design', 'config.json'),
    JSON.stringify({
      name: 'Team project',
      designRoot: '.design',
      canvasGroups: [
        { label: 'UI', path: 'ui' },
        { label: 'Screens', path: 'screens' },
      ],
      linkedHub: { url: hub.http, linkedAt: Date.now() },
    })
  );
  writeFileSync(join(teammate, '.design', 'ui', 'welcome.tsx'), canvasSource('Welcome, team'));
  writeFileSync(join(teammate, '.design', 'screens', 'home.tsx'), canvasSource('Home screen'));
  const teammateHubs = join(scratch, 'teammate-hubs.json');
  writeFileSync(
    teammateHubs,
    JSON.stringify({ hubs: { [hub.http]: { token: hub.tokens.alice, role: 'member', linkedAt: Date.now() } } }),
    { mode: 0o600 }
  );
  const teammatePort = await freePort();
  const studio = spawn(
    'bun',
    ['--no-env-file', join(ROOT, 'apps/studio/server.ts'), '--root', teammate, '--port', String(teammatePort)],
    {
      env: { ...process.env, HUBS_CONFIG_PATH: teammateHubs, MAUDE_NO_AUTOBUILD: '1', NO_OPEN: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  children.push(studio);

  // The project is seeded when the hub's own manifest lists both canvases.
  await until('the teammate’s canvases on the hub', async () => {
    const r = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    const boot = (await r.json()) as { docs?: { path: string; retired?: boolean }[] };
    const paths = (boot.docs ?? []).filter((d) => !d.retired).map((d) => d.path);
    return paths.includes('ui/welcome.tsx') && paths.includes('screens/home.tsx');
  });

  // ── The designer's machine ────────────────────────────────────────────────
  // Nothing of the developer's own: no hub credentials, no Maude Cloud session.
  process.env.HUBS_CONFIG_PATH = join(scratch, 'designer-hubs.json');
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'designer-cloud.json');
  process.env.MAUDE_E2E_TEAM = JSON.stringify({
    hub: hub.http,
    teammate,
    managedDir,
    password: TEAM_PASSWORD,
  });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/team-project', stamp);
  return scratch;
}

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'team-project.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
  onComplete() {
    for (const c of children) c.kill('SIGTERM');
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  },
};
