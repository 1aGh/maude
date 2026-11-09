/**
 * WebdriverIO config — 2.1.1 accounts and connections (plan feature-accounts-and-connections-2.1.1, T7).
 *
 * Three specs, each on a world of its own, all LOCAL and throwaway:
 *
 *   hub-signin-return    a project whose folder names a team server this Mac holds no sign-in for; it signs in
 *                        from Settings › General through the server's own page, and the browser's hop back to
 *                        `/_api/hub-signin/return` is a plain GET from this process — no app session, no key
 *                        (2.1.0 answered `api-key-required` there; T0 fixed it).
 *   broken-signin        the same shape on another server: the toast once, the broken-link badge, "Sign in" with
 *                        the address; then the server stops accepting the sign-in (the account is disabled) and
 *                        the same three say "Sign in again".
 *   send-local-project   a project only on this Mac: Diagnostics › Sync offers both ways out; "Link your server"
 *                        links this folder to an EMPTY server (its canvases land there); a second local project
 *                        meets a server that already holds work and stops at the counts — Cancel leaves it
 *                        unlinked. "Create project on Maude Cloud" is followed only to its own ask.
 *
 * The servers are `fixtures/local-hub.mjs` hubs from source (Node 24) with password accounts, each with a
 * throwaway HOME. Maude Cloud is a loopback TRIPWIRE (MAUDE_CLOUD_URL): it answers 503 to everything and records
 * what reached it, so nothing in this lane can reach a real cloud; the specs assert it stayed silent.
 *
 * ONE PROJECT PER APP: a team-server sign-in from a project that shares its account with another project moves it
 * to an account of its own first (`team_sign_in_prepare`, V2-3.8). So each spec boots the app on its own project
 * root — `onWorkerStart` (the launcher, before the service's health check respawns the app the base config stopped)
 * points MAUDE_PROJECT_ROOT and HUBS_CONFIG_PATH at that spec's world. The canvas-origin split is ON: TSX sync is
 * coupled to it (DDR-060), and a linked folder with nothing syncable proves nothing.
 *
 * Run: `pnpm test:e2e:desktop:accounts` (after `pnpm test:e2e:desktop:build`).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type LocalHub, startLocalHub } from './fixtures/local-hub.mjs';
import { canvasSource } from './helpers/accounts';
import { config as base, completeLane } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_FILES = [
  resolve(HERE, 'scenarios', 'hub-signin-return.e2e.ts'),
  resolve(HERE, 'scenarios', 'broken-signin.e2e.ts'),
  resolve(HERE, 'scenarios', 'send-local-project.e2e.ts'),
];
const SPECS = SPEC_FILES.map((f) => basename(f));

/** What a spec reads from MAUDE_E2E_ACCOUNTS (JSON). */
export interface AccountsWorld {
  scratch: string;
  cloud: string;
  cloudLog: string;
  adminSecret: string;
  password: string;
  email: string;
  specs: Record<
    string,
    {
      root: string;
      hubs: string;
      hub: string;
      owner: string;
      second?: { root: string; hub: string; owner: string };
      /** a folder whose config names the server, but nobody linked or confirmed it on this Mac (a clone) */
      unconfirmed?: { root: string; hub: string };
    }
  >;
}

function project(dir: string, name: string, linkedHub?: string): string {
  mkdirSync(join(dir, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(dir, '.design', 'config.json'),
    JSON.stringify(
      {
        name,
        designRoot: '.design',
        formatVersion: 2,
        canvasGroups: [{ label: 'UI', path: 'ui' }],
        ...(linkedHub ? { linkedHub: { url: linkedHub, linkedAt: Date.now() } } : {}),
      },
      null,
      2
    )
  );
  writeFileSync(join(dir, '.design', 'ui', 'welcome.tsx'), canvasSource(`${name} · welcome`));
  writeFileSync(join(dir, '.design', 'ui', 'pricing.tsx'), canvasSource(`${name} · pricing`));
  return dir;
}

const hubs: LocalHub[] = [];
const lane: { tripwire: Server[] } = { tripwire: [] };
let scratch = '';

/**
 * Maude Cloud for this lane: a loopback server that refuses everything and logs every request line. It is NAMED
 * `localhost` (both loopback families listen on its port), never 127.0.0.1: the shell tells Maude Cloud from your
 * server by host name (`isCloudHub`), and every hub of this lane is a 127.0.0.1 one.
 */
function startTripwire(log: string): Promise<{ url: string; servers: Server[] }> {
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    writeFileSync(log, `${req.method} ${req.url}\n`, { flag: 'a' });
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{"error":"the accounts e2e lane has no Maude Cloud"}');
  };
  return new Promise((ok) => {
    const v4 = createServer(handler);
    v4.listen(0, '127.0.0.1', () => {
      const { port } = v4.address() as { port: number };
      const v6 = createServer(handler);
      const done = () => ok({ url: `http://localhost:${port}`, servers: [v4, v6] });
      v6.once('error', done); // no IPv6 loopback: localhost is 127.0.0.1 only
      v6.listen(port, '::1', done);
    });
  });
}

async function setUp(): Promise<AccountsWorld> {
  scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-accounts-'));
  // the hubs get a HOME and config home of their own, never the person's
  const hubHome = join(scratch, 'hub-home');
  mkdirSync(hubHome, { recursive: true });
  const hubEnv = { HOME: hubHome, XDG_CONFIG_HOME: join(hubHome, '.config') };
  const plain = async (name: string) => {
    const h = await startLocalHub({ dir: join(scratch, `hub-${name}`), env: hubEnv });
    hubs.push(h);
    return h;
  };
  const signinHub = await plain('signin');
  const brokenHub = await plain('broken');
  const emptyHub = await plain('empty');
  // A server that already holds work: one that owns a checkout with a picture in it (its `/api/files` lists it).
  const work = join(scratch, 'work-checkout');
  mkdirSync(join(work, '.design', 'assets'), { recursive: true });
  writeFileSync(
    join(work, '.design', 'config.json'),
    JSON.stringify({
      name: 'Team work',
      designRoot: '.design',
      formatVersion: 2,
      canvasGroups: [{ label: 'UI', path: 'ui' }],
    })
  );
  writeFileSync(
    join(work, '.design', 'assets', 'team-mark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'
  );
  const workHub = await startLocalHub({
    dir: join(scratch, 'hub-work'),
    workspace: work,
    env: hubEnv,
  });
  hubs.push(workHub);

  const cloudLog = join(scratch, 'cloud-tripwire.log');
  writeFileSync(cloudLog, '');
  const cloud = await startTripwire(cloudLog);
  lane.tripwire = cloud.servers;

  const hubsFile = (name: string) => join(scratch, `${name}-hubs.json`);
  // This Mac's link records (sync/link-consent.ts): beside every hubs.json of the lane (one scratch dir), keyed by
  // folder. A folder LINKED before on this Mac has one; its sign-in is what is missing or refused (lead rule
  // 2026-11-09: only that is a broken sign-in). A committed address with no record is a clone's claim.
  const links = join(scratch, 'project-links.json');
  // The store's shape (apps/studio/sync/link-consent.ts `recordProjectLink`): folder realpath → normalized hub.
  const linkedBefore = (root: string, hub: string) => {
    const store = existsSync(links)
      ? JSON.parse(readFileSync(links, 'utf8'))
      : { v: 1, since: Date.now(), links: {} };
    const u = new URL(hub);
    store.links[realpathSync(root)] = {
      hub: `${u.protocol}//${u.host}`,
      at: Date.now(),
      how: 'link',
    };
    writeFileSync(links, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    return root;
  };
  const world: AccountsWorld = {
    scratch,
    cloud: cloud.url,
    cloudLog,
    adminSecret: 'test-secret',
    password: 'designer-pass-1',
    email: 'designer@x.test',
    specs: {
      'hub-signin-return.e2e.ts': {
        root: linkedBefore(
          project(join(scratch, 'Signin return'), 'Signin return', signinHub.http),
          signinHub.http
        ),
        hubs: hubsFile('signin'),
        hub: signinHub.http,
        owner: signinHub.tokens.owner,
      },
      'broken-signin.e2e.ts': {
        root: linkedBefore(
          project(join(scratch, 'Broken signin'), 'Broken signin', brokenHub.http),
          brokenHub.http
        ),
        hubs: hubsFile('broken'),
        hub: brokenHub.http,
        owner: brokenHub.tokens.owner,
        unconfirmed: {
          root: project(join(scratch, 'Cloned poster'), 'Cloned poster', brokenHub.http),
          hub: brokenHub.http,
        },
      },
      'send-local-project.e2e.ts': {
        root: project(join(scratch, 'Logo ideas'), 'Logo ideas'),
        hubs: hubsFile('send'),
        hub: emptyHub.http,
        owner: emptyHub.tokens.owner,
        second: {
          root: project(join(scratch, 'Poster'), 'Poster'),
          hub: workHub.http,
          owner: workHub.tokens.owner,
        },
      },
    },
  };
  return world;
}

// The launcher sets the worlds up once; a worker inherits MAUDE_E2E_ACCOUNTS through its environment.
if (!process.env.MAUDE_E2E_ACCOUNTS) {
  try {
    process.env.MAUDE_E2E_ACCOUNTS = JSON.stringify(await setUp());
  } catch (err) {
    for (const h of hubs) h.stop();
    for (const t of lane.tripwire) t.close();
    throw err;
  }
}
const WORLD = JSON.parse(process.env.MAUDE_E2E_ACCOUNTS as string) as AccountsWorld;

/** Point the app the service (re)starts next at `spec`'s project and its own hubs.json. */
function aimAt(spec: string): void {
  const w = WORLD.specs[basename(spec)];
  if (!w) return;
  process.env.MAUDE_PROJECT_ROOT = w.root;
  process.env.HUBS_CONFIG_PATH = w.hubs;
}

process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';
process.env.MAUDE_CLOUD_URL = WORLD.cloud;
// once, in the launcher: a worker evaluates this file again a minute later and must keep the launcher's dir
if (!process.env.MAUDE_E2E_RUN_DIR?.includes('/scenario-runs/accounts/')) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/accounts', stamp);
}
// The first spec's world before the service's onPrepare spawns the first app (the base module set the fixture).
aimAt(process.env.MAUDE_E2E_ACCOUNTS_ONLY || SPECS[0]);

const only = process.env.MAUDE_E2E_ACCOUNTS_ONLY;
export const config: WebdriverIO.Config = {
  ...base,
  specs: only ? [resolve(HERE, 'scenarios', only)] : SPEC_FILES,
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
  // config hooks run before the service's: the respawn after the base `onWorkerEnd` stopped the app reads this env
  onWorkerStart(_cid, _caps, specs) {
    if (specs[0]) aimAt(specs[0]);
  },
  async onComplete() {
    await completeLane();
    for (const h of hubs) h.stop();
    for (const t of lane.tripwire) t.close();
    if (scratch && !process.env.MAUDE_E2E_KEEP_STATE)
      rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  },
};
