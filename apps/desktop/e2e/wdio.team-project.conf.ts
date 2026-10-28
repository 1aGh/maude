/**
 * WebdriverIO config — a designer opens their team's project (plan T21/T22).
 *
 * The designer's whole way in, on a clean install, with nothing stubbed on the
 * sync path:
 *
 *   • a REAL hub, LOCAL and throwaway (fixtures/local-hub.mjs: apps/hub from source under Node 24, accepted
 *     revisions ON, password accounts) — never a hub that belongs to anyone
 *   • a teammate's studio already working in the project — it seeds the
 *     canvases through the hub exactly as a person would
 *   • the debug `.app` on a first-run home: no MAUDE_PROJECT_ROOT, no remembered
 *     project, no managed copies, an empty hub credential file
 *
 * The scenario signs in with an email and password, never picks a folder, and
 * asserts the project's canvases arrive and changes flow both ways.
 *
 * FIRST RUN, REALLY (P8 e2e live lanes): Home shows its sign-in card only on a first run — no project, no account,
 * and Home's per-Mac "the first-run card was shown" flag (`home/home.json`, P8 C8) not yet set. Any earlier lane's
 * Home sets that flag, so this lane clears it, points Home's index and projects dir at fresh empty dirs (as
 * wdio.onboarding.conf.ts does) and holds the real `claude` off with a stub. Without that the lane sat 180 s on a
 * sign-in card that never came and every later step failed behind it.
 *
 * Run: `pnpm test:e2e:desktop:team-project` (after `pnpm test:e2e:desktop:build`).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type LocalHub, startLocalHub } from './fixtures/local-hub.mjs';
import { assertFreshClientDist } from './helpers/dist-fresh';
import { useFakeAi } from './helpers/fake-ai';
import { config as base, completeLane } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const children: ChildProcess[] = [];
const hubs: LocalHub[] = [];

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

/**
 * MAUDE_E2E_HUB_TARGET may only name a hub on THIS machine (the Docker gate's loopback container) — the lane
 * signs in with a password and kills/stops the hub, so a real hub's URL there must stop the run, not be believed.
 */
export function assertLoopbackHubTarget(url: string): void {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* unparseable: refused below */
  }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    throw new Error(
      `MAUDE_E2E_HUB_TARGET names "${host || url}": the team-project lane runs on a loopback hub only (127.0.0.1, localhost or ::1), never a real one`
    );
  }
}

export const canvasSource = (
  title: string
) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

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
  for (const f of [
    'app-state.json',
    'last-project.txt',
    'managed-projects.json',
    join('home', 'home.json'),
  ]) {
    rmSync(join(appDir, f), { force: true });
  }
  // Home's index and projects dir: fresh and empty, so nothing on this Mac hides the first-run card.
  process.env.MAUDE_INDEX_DIR = mkdtempSync(join(tmpdir(), 'maude-e2e-team-index-'));
  process.env.MAUDE_HOME_PROJECTS_DIR = mkdtempSync(join(tmpdir(), 'maude-e2e-team-projects-'));
  // P8 G1b (01 cf-offline-create): the scripted fake AI, signed in, so a prompt queued while the hub is away is
  // seen to SEND when it returns (the agent answers "ok."). It also puts its stub `claude` first on PATH, so the
  // person's real CLI and keychain are never reached (what useStubClaude did here before).
  useFakeAi();

  const scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-team-'));
  // V2-8.18 — MAUDE_E2E_HUB_TARGET (a 0600 JSON file the Docker gate writes): the same lane against a
  // self-hosted hub CONTAINER instead of the in-process hub. Its people already exist (designer@x.test with
  // TEAM_PASSWORD, invited through /join; a teammate session); the server-away steps become `docker kill` +
  // `docker start` (or pause/unpause) on the same volume. Absent, nothing changes.
  const target = process.env.MAUDE_E2E_HUB_TARGET
    ? (JSON.parse(readFileSync(process.env.MAUDE_E2E_HUB_TARGET, 'utf8')) as {
        http: string;
        container: string;
        adminSecret: string;
        ownerToken: string;
        teammateToken: string;
        away?: 'kill' | 'pause';
      })
    : null;
  if (target) assertLoopbackHubTarget(target.http);
  const hub: LocalHub = target
    ? {
        http: target.http.replace(/\/$/, ''),
        ws: '',
        tokens: { owner: target.ownerToken, alice: target.teammateToken },
        pid: 0,
        stop: () => {},
      }
    : await startLocalHub({ dir: join(scratch, 'hub') });
  hubs.push(hub);
  const managedDir = join(
    appDir,
    'projects',
    `${hub.http.replace(/^https?:\/\//, '').replace(':', '-')}--local`
  );
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
    JSON.stringify({
      hubs: { [hub.http]: { token: hub.tokens.alice, role: 'member', linkedAt: Date.now() } },
    }),
    { mode: 0o600 }
  );
  // p8-e2e-fix-r12: the teammate serves this tree's client bundle — never a stale one
  assertFreshClientDist(join(ROOT, 'apps/studio'));
  const teammatePort = await freePort();
  const studio = spawn(
    'bun',
    [
      '--no-env-file',
      join(ROOT, 'apps/studio/server.ts'),
      '--root',
      teammate,
      '--port',
      String(teammatePort),
    ],
    {
      env: {
        ...process.env, // includes the fake AI's stub `claude` first on PATH (useFakeAi)
        HUBS_CONFIG_PATH: teammateHubs,
        // gate-b-sec4: the harness is the app that made this link (sync/link-consent.ts)
        MAUDE_APP_BOUND_HUB: hub.http,
        MAUDE_NO_AUTOBUILD: '1',
        NO_OPEN: '1',
      },
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
    // The spec pauses the hub (SIGSTOP/SIGCONT) for the server-away step, and
    // disables/enables the designer through the admin API (fixture secret).
    hubPid: hub.pid,
    adminSecret: target?.adminSecret ?? 'test-secret',
    ...(target
      ? { hubContainer: target.container, hubAway: target.away ?? 'kill' }
      : {
          // P8 G1b: the hub's data dir + port, so the spec can STOP it (connection refused → "Offline — kept on this
          // Mac") and restart the same hub on the same port, with the same tokens (serve-hub re-reads them).
          hubDir: join(scratch, 'hub'),
          hubPort: Number(new URL(hub.http).port),
        }),
  });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(
    HERE,
    '../../../.ai/device/scenario-runs/team-project',
    stamp
  );
  return scratch;
}

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'team-project.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
  async onComplete() {
    await completeLane();
    for (const c of children) c.kill('SIGTERM');
    for (const h of hubs) h.stop();
    if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  },
};
