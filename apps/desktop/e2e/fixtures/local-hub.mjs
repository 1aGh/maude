// A LOCAL hub for the desktop e2e lanes that need one behind a stub control plane (cloud, team-project) — never a
// real hub, never a production cell. It is the hub from source (apps/hub/test/fixtures/serve-hub.mjs: a real
// Hocuspocus hub on 127.0.0.1 with a throwaway data dir), started under NODE 24: `better-sqlite3` is compiled against
// NODE_MODULE_VERSION 137, and any other Node dies at hub boot with a module-version error that reads like a corrupt
// install (memory maude-local-cell-needs-node-24). `findNode24` picks the binary honestly — by asking it for its ABI,
// not by trusting a path or a version string — so a wrong Node fails HERE with the fix, not 30 s later in a log.
//
// `cloud: true` runs the hub the way a cell runs: MAUDE_CLOUD_IDENTITY=1 and a project-token key, so the sign-in door
// takes a project access token (what the control plane hands a person) — `mintProjectToken` makes one the way the
// control plane does (apps/hub/src/cloud-identity.mjs `accessClaims` + `signAccessToken`, shared on purpose).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const NODE_ABI = '137'; // Node 24

const abiOf = (bin) => {
  try {
    return execFileSync(bin, ['-p', 'process.versions.modules'], {
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
};

/** A Node 24 binary: MAUDE_E2E_NODE, this process, PATH, nvm, Homebrew's node@24. Throws with the fix. */
export function findNode24(env = process.env) {
  const candidates = [env.MAUDE_E2E_NODE, process.execPath];
  for (const dir of (env.PATH ?? '').split(delimiter)) candidates.push(join(dir, 'node'));
  const nvm = join(homedir(), '.nvm', 'versions', 'node');
  if (existsSync(nvm)) {
    for (const v of readdirSync(nvm)
      .filter((d) => d.startsWith('v24.'))
      .sort()
      .reverse()) {
      candidates.push(join(nvm, v, 'bin', 'node'));
    }
  }
  candidates.push('/opt/homebrew/opt/node@24/bin/node');
  for (const c of candidates) {
    if (c && existsSync(c) && abiOf(c) === NODE_ABI) return c;
  }
  throw new Error(
    'the local hub needs Node 24 (better-sqlite3 is built for ABI 137) and none was found — set MAUDE_E2E_NODE=/path/to/node24'
  );
}

// What a local hub child inherits from the shell that runs the lane: an allowlist, never `{...process.env}`.
// The hub reads its store, backup, tenant and cloud settings from env (MAUDE_PROJECT_STORE_URL/_TOKEN,
// MAUDE_S3_*, MAUDE_BACKUP_*, HUB_*, MAUDE_TENANT_ID — apps/hub/src/server.mjs), so a developer shell that
// carries any of them (or AWS_*/CLOUDFLARE_*/GH_TOKEN) would point a test hub at a real store. Whatever
// the rig needs it sets itself through `extra` (p8-secfix-f F4).
const HUB_ENV_KEEP = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'TZ',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'NO_OPEN',
  'MAUDE_HUB_DEBUG',
]);

/** The env a local hub child runs with: the allowlisted basics of `base`, plus what the caller sets. */
export function hubEnv(extra = {}, base = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && (HUB_ENV_KEEP.has(k) || k.startsWith('LC_'))) env[k] = v;
  }
  return { ...env, ...extra };
}

/**
 * Start a local hub. Resolves once it listens (and its accepted-revisions store is ready).
 * @param {{ dir: string, port?: number, extraArgs?: string[], transactions?: boolean, users?: boolean, cloudKey?: string, node?: string, workspace?: string }} opts
 *   `dir` is the hub's data dir (a throwaway); `cloudKey` switches on cloud identity with that project-token key.
 */
export function startLocalHub(opts) {
  const node = opts.node ?? findNode24();
  // `port` (additive, P8 G1b): restart the SAME hub — same data dir, same port, same tokens (serve-hub re-reads
  // them) — after a spec stopped it, so the peers' stored hub URL still names it. `extraArgs`: serve-hub flags
  // such as `--asset-write-rate-limit N`.
  const args = [
    join(REPO, 'apps/hub/test/fixtures/serve-hub.mjs'),
    opts.dir,
    String(opts.port ?? 0),
  ];
  if (opts.transactions !== false) args.push('--transactions');
  if (opts.users !== false) args.push('--users');
  for (const a of opts.extraArgs ?? []) args.push(String(a));
  const env = hubEnv({ PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}` });
  if (opts.cloudKey) {
    env.MAUDE_CLOUD_IDENTITY = '1';
    env.MAUDE_PROJECT_TOKEN_KEY = opts.cloudKey;
  }
  // `workspace` (additive, P8 G1b-3 team-cell lane): the hub OWNS a checkout, as a cell does — its file door
  // accepts writes into `<workspace>/.design`, it keeps the file journal (the `ledger` capability) and
  // serve-hub arms the journal's poke. No studio child (MAUDE_STUDIO_CHILD=0): the peers here are a teammate's
  // studio and the app, both outside the hub, exactly like a desktop linked to a cell.
  if (opts.workspace) {
    env.MAUDE_WORKSPACE_MODE = '1';
    env.MAUDE_REPO_DIR = opts.workspace;
    env.MAUDE_DESIGN_ROOT = '.design';
    env.MAUDE_STUDIO_CHILD = '0';
  }
  const spawnHub = opts.spawn ?? spawn;
  return new Promise((ok, fail) => {
    const proc = spawnHub(node, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      fail(new Error(`the local hub did not start in 30 s: ${buf.slice(-600)}`));
    }, 30_000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`the local hub exited (${code}) before it listened: ${buf.slice(-600)}`));
    });
    proc.stdout.on('data', (c) => {
      buf += c.toString('utf8');
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      proc.removeAllListeners('exit');
      const info = JSON.parse(line);
      ok({
        http: String(info.http).replace(/\/$/, ''),
        ws: info.ws,
        tokens: info.tokens,
        pid: proc.pid ?? 0,
        stop: () => proc.kill('SIGTERM'),
      });
    });
    proc.stderr.on('data', (c) => {
      buf += c.toString('utf8');
    });
  });
}

/** A project access token the way the control plane mints one for `email` (role: owner | member | viewer…). */
export async function mintProjectToken(key, { email, role, project = 'e2e-project', ttlMs }) {
  const mod = await import(pathToFileURL(join(REPO, 'apps/hub/src/cloud-identity.mjs')).href);
  return mod.signAccessToken(
    mod.accessClaims({ email, project, role }, ttlMs ? { ttlMs } : undefined),
    key
  );
}
