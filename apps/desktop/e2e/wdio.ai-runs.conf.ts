/**
 * WebdriverIO config — AI runs across two Macs on one local hub (S5.15, multiplayer/ai-runs.e2e.ts).
 *
 * Everything the rig touches is throwaway and set up ONCE, in the launcher:
 *
 *   • a REAL hub, LOCAL (fixtures/local-hub.mjs: apps/hub from source under Node 24, accepted revisions ON)
 *   • Mac 2 — Tereza: a studio child on its own project copy, linked to the hub with her token. It seeds the
 *     canvas through the hub the way a person's studio does.
 *   • Mac 1 — you: the debug `.app` booted on ANOTHER throwaway project (MAUDE_PROJECT_ROOT), linked to the same
 *     hub, with its own hubs.json. Never the committed `fixtures/project`: the fake run writes the canvas, and a lane
 *     never writes into the repo tree.
 *
 * Both links are the app's own (MAUDE_APP_BOUND_HUB, gate-b-sec4 `sync/link-consent.ts`): a committed `linkedHub`
 * alone is parked behind Connect, so without it neither side would sync. Mac 1's sidecar inherits it from the app's
 * environment (sidecar.rs only ADDS the registry's binding for a managed copy).
 *
 * Run: `pnpm --filter @maude/desktop-e2e e2e:ai-runs` (after `pnpm test:e2e:desktop:build`).
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type LocalHub, startLocalHub } from './fixtures/local-hub.mjs';
import { assertFreshClientDist } from './helpers/dist-fresh';
import { useStubClaude } from './helpers/fake-ai';
import { config as base, completeLane } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const REL = 'ui/Combine-kampan.tsx';
const children: ChildProcess[] = [];
const hubs: LocalHub[] = [];

export const aiRunsCanvas = (
  post = 'Post title',
  story = 'Story title'
) => `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function CombineKampan() {
  return (
    <DesignCanvas>
      <DCSection id="kampan" title="Combine kampaň">
        <DCArtboard id="post" label="Post 1:1" width={1080} height={1080}><h1>${post}</h1><p>keep one</p></DCArtboard>
        <DCArtboard id="story" label="Story 9:16" width={1080} height={1920}><h1>${story}</h1><p>keep two</p></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

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

/** A project folder linked to `hub`, a git repo whose author is `who` (the studio's `/_api/git-user`). */
function project(dir: string, hub: string, who: string, withCanvas: boolean): void {
  mkdirSync(join(dir, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(dir, '.design', 'config.json'),
    JSON.stringify({ name: 'Combine kampaň', designRoot: '.design', formatVersion: 2, linkedHub: { url: hub, linkedAt: Date.now() } })
  );
  if (withCanvas) writeFileSync(join(dir, '.design', REL), aiRunsCanvas());
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['config', 'user.name', who],
    ['config', 'user.email', `${who.split(' ')[0].toLowerCase()}@x.test`],
  ]) {
    spawnSync('git', args, { cwd: dir, stdio: 'ignore' });
  }
}

const hubsFile = (file: string, hub: string, token: string) =>
  writeFileSync(
    file,
    JSON.stringify({ hubs: { [hub]: { token, role: 'member', linkedAt: Date.now() } } }),
    { mode: 0o600 }
  );

// TSX sync is coupled to the canvas-origin split (DDR-060 / DDR-054 §F1); the base turns it off for frame access.
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';

// WDIO loads this file in the launcher AND in each worker; only the launcher sets up (the worker inherits the env).
let scratch = '';
if (!process.env.MAUDE_E2E_AI_RUNS) scratch = await setUp();

async function setUp(): Promise<string> {
  useStubClaude();
  const scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-ai-runs-'));
  const hub = await startLocalHub({ dir: join(scratch, 'hub') });
  hubs.push(hub);

  // ── Mac 2 — Tereza, already at work ─────────────────────────────────────
  const mac2Root = join(scratch, 'mac2');
  project(mac2Root, hub.http, 'Tereza Nováková', true);
  mkdirSync(join(scratch, 'mac2-config'), { recursive: true });
  const mac2Hubs = join(scratch, 'mac2-config', 'hubs.json');
  hubsFile(mac2Hubs, hub.http, hub.tokens.bob);
  assertFreshClientDist(join(ROOT, 'apps/studio'));
  const mac2Port = await freePort();
  const mac2 = spawn(
    'bun',
    ['--no-env-file', join(ROOT, 'apps/studio/server.ts'), '--root', mac2Root, '--port', String(mac2Port)],
    {
      env: {
        ...process.env, // the stub `claude` first on PATH
        HUBS_CONFIG_PATH: mac2Hubs,
        MAUDE_CLOUD_CONFIG: join(scratch, 'mac2-config', 'cloud.json'),
        MAUDE_APP_BOUND_HUB: hub.http,
        MAUDE_MACHINE_FILE: join(scratch, 'mac2-config', 'machine.json'),
        MAUDE_NO_AUTOBUILD: '1',
        NO_OPEN: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  children.push(mac2);
  await until('Tereza’s canvas on the hub', async () => {
    const r = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    const boot = (await r.json()) as { docs?: { path: string; retired?: boolean }[] };
    return (boot.docs ?? []).some((d) => !d.retired && d.path === REL);
  });

  // ── Mac 1 — you, the app ──────────────────────────────────────────────────
  const mac1Root = join(scratch, 'mac1');
  project(mac1Root, hub.http, 'Michal Dovrtěl', false);
  mkdirSync(join(scratch, 'mac1-config'), { recursive: true });
  process.env.HUBS_CONFIG_PATH = join(scratch, 'mac1-config', 'hubs.json');
  hubsFile(process.env.HUBS_CONFIG_PATH, hub.http, hub.tokens.alice);
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'mac1-config', 'cloud.json');
  process.env.MAUDE_MACHINE_FILE = join(scratch, 'mac1-config', 'machine.json');
  process.env.MAUDE_APP_BOUND_HUB = hub.http;
  process.env.MAUDE_PROJECT_ROOT = mac1Root;
  process.env.MAUDE_AI_RUNS_E2E = '1';
  process.env.MAUDE_E2E_AI_RUNS = JSON.stringify({
    hub: hub.http,
    mac1Root,
    mac2Root,
    mac2Origin: `http://127.0.0.1:${mac2Port}`,
    mac2Pid: mac2.pid,
  });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/ai-runs', stamp);
  return scratch;
}

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'multiplayer', 'ai-runs.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 600_000 },
  async onComplete() {
    await completeLane();
    for (const c of children) {
      c.kill('SIGCONT');
      c.kill('SIGTERM');
    }
    for (const h of hubs) h.stop();
    if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  },
};
