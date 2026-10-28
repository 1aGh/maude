/**
 * WebdriverIO config — a designer's copy linked to a CELL-shaped hub (P8 G1b-3).
 *
 * team-project's hub (serve-hub.mjs, plain) has no checkout, so every file write it gets answers 405 "this hub
 * does not accept file writes" and the journal file plane — the lane that reports a 429 as "N changes are
 * waiting" — never runs. This lane's hub runs in WORKSPACE mode, the way a cell does: it owns a checkout
 * (`<scratch>/cell`), its file door accepts writes into it, it keeps the file journal and advertises `ledger`.
 * Still the hub from source, local and throwaway (fixtures/local-hub.mjs under Node 24) — never a real hub.
 *
 *   • the cell: serve-hub.mjs with MAUDE_WORKSPACE_MODE=1 + MAUDE_REPO_DIR, no studio child (the peers are outside)
 *   • a teammate's studio already working in the project (alice's token) — it seeds the canvases, and the spec
 *     drives it through its OWN API as the second person
 *   • the designer's copy, linked to the cell on this Mac (bob's token + a project-links record, the same record
 *     `maude design link` writes) and opened as the boot project — sign-in is team-project's leg, not this one's
 *   • a stub `claude` first on PATH, a throwaway XDG/config, nothing of the developer's own
 *
 * The spec may stop the cell and start it again on the same port with the same tokens and checkout
 * (`hubDir`, `hubPort`, `cellRepo` in MAUDE_E2E_TEAM_CELL), e.g. with `--asset-write-rate-limit 1`.
 *
 * Run: `pnpm test:e2e:desktop:team-cell` (after `pnpm test:e2e:desktop:build`).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type LocalHub, startLocalHub } from './fixtures/local-hub.mjs';
import { assertFreshClientDist } from './helpers/dist-fresh';
import { useStubClaude } from './helpers/fake-ai';
import { config as base, completeLane } from './wdio.conf';

// Not imported from wdio.team-project.conf.ts: loading that module starts ITS hub and teammate.
export const canvasSource = (
  title: string
) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Team cell">
        <DCArtboard id="main" label="MAIN" width={480} height={320}>
          <h1 style={{ padding: 32, fontFamily: "system-ui", color: "#111" }}>${title}</h1>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const children: ChildProcess[] = [];
const hubs: LocalHub[] = [];

function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

async function until(what: string, fn: () => Promise<boolean>, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A project's design config, linked to `hub`. */
function writeProject(root: string, hub: string): void {
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(root, '.design', 'config.json'),
    JSON.stringify({
      name: 'Team cell',
      designRoot: '.design',
      canvasGroups: [{ label: 'UI', path: 'ui' }],
      linkedHub: { url: hub, linkedAt: Date.now() },
    })
  );
}

/** A per-Mac credential store (hubs.json) + its link record (project-links.json beside it), mode 0600. */
function writeCredentials(dir: string, hub: string, token: string, folder: string): string {
  mkdirSync(dir, { recursive: true });
  const hubsPath = join(dir, 'hubs.json');
  writeFileSync(
    hubsPath,
    JSON.stringify({
      hubs: { [hub]: { token, role: 'member', linkedAt: Date.now() } },
      trusted: [hub],
    }),
    { mode: 0o600 }
  );
  writeFileSync(
    join(dir, 'project-links.json'),
    JSON.stringify({
      v: 1,
      since: Date.now(),
      links: { [realpathSync(folder)]: { hub, at: Date.now(), how: 'link' } },
    }),
    { mode: 0o600 }
  );
  return hubsPath;
}

// TSX sync is coupled to the canvas-origin split (DDR-060); the base config turns it OFF.
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';

// WDIO loads this file in the launcher AND in each worker: set up once, in the launcher.
let scratch = '';
if (!process.env.MAUDE_E2E_TEAM_CELL) {
  scratch = await setUp();
}

async function setUp(): Promise<string> {
  // No real `claude`, no keychain: a stub first on PATH (inherited by the app, its sidecar and the teammate).
  useStubClaude();
  const scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-cell-'));

  // ── The cell: a hub that owns a checkout ──────────────────────────────────
  const cellRepo = join(scratch, 'cell');
  mkdirSync(join(cellRepo, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(cellRepo, '.design', 'config.json'),
    JSON.stringify({
      name: 'Team cell',
      designRoot: '.design',
      canvasGroups: [{ label: 'UI', path: 'ui' }],
    })
  );
  const hubDir = join(scratch, 'hub');
  const hub = await startLocalHub({ dir: hubDir, workspace: cellRepo });
  hubs.push(hub);
  const health = (await (await fetch(`${hub.http}/health`)).json()) as { capabilities?: string[] };
  if (!health.capabilities?.includes('ledger'))
    throw new Error(
      `the cell does not keep a file journal: ${JSON.stringify(health.capabilities)}`
    );

  // ── The teammate already at work (alice) ──────────────────────────────────
  const teammate = join(scratch, 'teammate');
  writeProject(teammate, hub.http);
  writeFileSync(join(teammate, '.design', 'ui', 'welcome.tsx'), canvasSource('Welcome, team'));
  const teammateHubs = writeCredentials(
    join(scratch, 'teammate-cfg'),
    hub.http,
    hub.tokens.alice,
    teammate
  );
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
        ...process.env, // includes the stub `claude` first on PATH
        HUBS_CONFIG_PATH: teammateHubs,
        MAUDE_CLOUD_CONFIG: join(scratch, 'teammate-cfg', 'cloud.json'),
        MAUDE_NO_AUTOBUILD: '1',
        NO_OPEN: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let teammateLog = '';
  studio.stderr?.on('data', (c) => {
    teammateLog = (teammateLog + c.toString('utf8')).slice(-8_000);
  });
  children.push(studio);
  await until(
    'the teammate’s studio',
    async () => (await fetch(`http://127.0.0.1:${teammatePort}/_health`)).ok,
    90_000
  ).catch((e) => {
    throw new Error(`${String(e)}\n${teammateLog}`);
  });
  await until(
    'the teammate’s canvas on the hub',
    async () => {
      const r = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const boot = (await r.json()) as { docs?: { path: string; retired?: boolean }[] };
      return (boot.docs ?? []).some((d) => !d.retired && d.path === 'ui/welcome.tsx');
    },
    120_000
  );

  // ── The designer's copy (bob), linked on this Mac ─────────────────────────
  const designer = join(scratch, 'designer');
  writeProject(designer, hub.http);
  process.env.HUBS_CONFIG_PATH = writeCredentials(
    join(scratch, 'designer-cfg'),
    hub.http,
    hub.tokens.bob,
    designer
  );
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'designer-cfg', 'cloud.json');
  process.env.MAUDE_PROJECT_ROOT = designer;

  process.env.MAUDE_E2E_TEAM_CELL = JSON.stringify({
    hub: hub.http,
    hubPid: hub.pid,
    hubDir,
    hubPort: Number(new URL(hub.http).port),
    cellRepo,
    teammate,
    teammatePort,
    teammatePid: studio.pid ?? 0,
    designer,
  });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(
    HERE,
    '../../../.ai/device/scenario-runs/team-cell',
    stamp
  );
  return scratch;
}

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'team-cell.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
  async onComplete() {
    await completeLane();
    for (const c of children) {
      try {
        c.kill('SIGCONT');
      } catch {
        /* gone */
      }
      c.kill('SIGTERM');
    }
    for (const h of hubs) h.stop();
    if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  },
};
