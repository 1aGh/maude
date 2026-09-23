#!/usr/bin/env node
// F3 self-host backend fixture — the production hub image (apps/hub/Dockerfile)
// as an operator runs it: workspace mode, real accounts, operator-created
// invitations accepted through /join, accepted revisions in the hub's SQLite
// store, media/backups in an isolated R2 prefix (real object storage).
//
//   node selfhost.mjs up   --work <dir> [--port 1234] [--build]
//   node selfhost.mjs down --work <dir> [--purge]
//   node selfhost.mjs kill --work <dir>          # SIGKILL the container
//   node selfhost.mjs start --work <dir>         # start it again (same volumes)
//   node selfhost.mjs wipe-disk --work <dir>     # fresh data+repo disks, same S3 prefix
//
// Secrets (S3 keys, passwords, tokens) live only in <work>/fixture.json (0600).
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const IMAGE = 'maude-f3-selfhost:local';
const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (n, fb = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 ? argv[i + 1] : fb;
};
const has = (n) => argv.includes(`--${n}`);
const work = resolve(arg('work') ?? '');
if (!arg('work')) throw new Error('--work required');
const fixturePath = join(work, 'fixture.json');
const docker = (...a) =>
  execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function r2Env() {
  const env = Object.fromEntries(
    readFileSync('/tmp/maude-r2-test.env', 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
  return {
    MAUDE_S3_ENDPOINT: 'https://b5b596efe65abb732777c7171dc18145.r2.cloudflarestorage.com',
    MAUDE_S3_BUCKET: 'maude-multiplayer-test-20260922',
    MAUDE_S3_REGION: 'auto',
    MAUDE_S3_ACCESS_KEY_ID: env.MAUDE_S3_ACCESS_KEY_ID,
    MAUDE_S3_SECRET_ACCESS_KEY: env.MAUDE_S3_SECRET_ACCESS_KEY,
  };
}

async function waitHealthy(url, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {
      /* booting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`hub never became healthy: ${url}`);
}

function runContainer(fx, { allowEmpty }) {
  // The operator path (`maude hub workspace-up`, cli/lib/workspace-plan.mjs):
  // a second hostname for the split canvas origin (DDR-054, finding M7) —
  // without it every canvas iframe points at a container-internal port.
  const port = fx.port;
  const envs = {
    HUB_PUBLIC_URL: `http://studio.selfhost.localhost:${port}`,
    MAUDE_PUBLIC_CANVAS_ORIGIN: `http://canvas.selfhost.localhost:${port}`,
    MAUDE_EXTRA_SHELL_ORIGINS: `http://localhost:${port}`,
    HUB_INSECURE_HTTP: '1',
    HUB_WORKSPACE_MODE: '1',
    HUB_SECRET: fx.operatorSecret,
    MAUDE_ADMIN_EMAIL: fx.users.owner.email,
    MAUDE_ADMIN_PASSWORD: fx.users.owner.password,
    MAUDE_TENANT_ID: fx.tenant,
    MAUDE_PROJECT_NAME: 'F3 self-host',
    MAUDE_BACKUP_PREFIX: fx.tenant,
    ...(allowEmpty ? { MAUDE_ALLOW_EMPTY_START: '1' } : {}),
    ...r2Env(),
  };
  const envArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return docker(
    'run',
    '-d',
    '--name',
    fx.container,
    '-p',
    `127.0.0.1:${fx.port}:1234`,
    '-v',
    `${join(work, 'data')}:/data`,
    '-v',
    `${join(work, 'repo')}:/repo`,
    ...envArgs,
    IMAGE
  );
}

async function json(url, { method = 'GET', headers = {}, body } = {}) {
  const r = await fetch(url, {
    method,
    headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  return { status: r.status, body: parsed };
}

// The hub rate-limits sign-in per client (a real control, kept): wait out a 429.
export async function signIn(url, u) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const login = await json(`${url}/auth/login`, {
      method: 'POST',
      body: { email: u.email, password: u.password },
    });
    if (login.status === 200) return { token: login.body.token, role: login.body.user?.role ?? null };
    if (login.status !== 429) throw new Error(`login ${u.email}: ${login.status}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error(`login ${u.email}: still rate limited`);
}
async function signInAll(fx) {
  const sessions = {};
  for (const [who, u] of Object.entries(fx.users)) sessions[who] = await signIn(fx.url, u);
  return sessions;
}

async function up() {
  mkdirSync(work, { recursive: true, mode: 0o700 });
  if (has('build') || !docker('images', '-q', IMAGE))
    execFileSync('docker', ['build', '-t', IMAGE, '-f', 'apps/hub/Dockerfile', '.'], {
      cwd: REPO,
      stdio: 'inherit',
    });
  const port = Number(arg('port', '1234'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const pw = () => randomBytes(18).toString('base64url');
  const fx = {
    backend: 'self-host',
    image: IMAGE,
    imageId: docker('images', '-q', '--no-trunc', IMAGE),
    container: `maude-f3-selfhost-${stamp.toLowerCase()}`,
    port,
    url: `http://localhost:${port}`,
    tenant: `f3-selfhost-${stamp.toLowerCase()}`,
    operatorSecret: randomBytes(32).toString('hex'),
    users: {
      owner: { email: 'owner@f3-selfhost.invalid', password: pw(), role: 'admin' },
      a: { email: 'designer-a@f3-selfhost.invalid', password: pw(), role: 'member' },
      b: { email: 'designer-b@f3-selfhost.invalid', password: pw(), role: 'member' },
      viewer: { email: 'viewer@f3-selfhost.invalid', password: pw(), role: 'viewer' },
    },
    createdAt: new Date().toISOString(),
  };
  for (const d of ['data', 'repo']) mkdirSync(join(work, d), { recursive: true });
  runContainer(fx, { allowEmpty: true });
  await waitHealthy(fx.url);
  const admin = { authorization: `Bearer ${fx.operatorSecret}` };
  fx.invites = {};
  // A hub's accounts are admin | member; view-only access is not an invite.
  // S02: asking for a viewer invite must be REFUSED, never minted as a writer.
  const viewerInvite = await json(`${fx.url}/admin/api/invites`, {
    method: 'POST',
    headers: admin,
    body: { email: fx.users.viewer.email, role: 'viewer', ttlHours: 48 },
  });
  fx.viewerInviteRefusal = { status: viewerInvite.status, error: viewerInvite.body?.error ?? null };
  if (viewerInvite.status !== 400) throw new Error(`viewer invite not refused: ${viewerInvite.status}`);
  delete fx.users.viewer;
  for (const who of ['a', 'b']) {
    const u = fx.users[who];
    const inv = await json(`${fx.url}/admin/api/invites`, {
      method: 'POST',
      headers: admin,
      body: { email: u.email, role: u.role, ttlHours: 48, createdBy: fx.users.owner.email },
    });
    if (inv.status !== 201) throw new Error(`invite ${who}: ${inv.status} ${JSON.stringify(inv.body)}`);
    const joined = await json(`${fx.url}/join`, {
      method: 'POST',
      body: { token: inv.body.value, email: u.email, password: u.password },
    });
    fx.invites[who] = { id: inv.body.invite.id, joinStatus: joined.status, role: inv.body.invite.role };
    if (joined.status >= 400)
      throw new Error(`join ${who}: ${joined.status} ${JSON.stringify(joined.body)}`);
  }
  writeFileSync(fixturePath, JSON.stringify(fx, null, 2), { mode: 0o600 });
  fx.sessions = await signInAll(fx);
  writeFileSync(fixturePath, JSON.stringify(fx, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        url: fx.url,
        container: fx.container,
        tenant: fx.tenant,
        invites: fx.invites,
        viewerInviteRefusal: fx.viewerInviteRefusal,
        roles: Object.fromEntries(Object.entries(fx.sessions).map(([k, v]) => [k, v.role])),
      },
      null,
      2
    )
  );
}

const fx = () => JSON.parse(readFileSync(fixturePath, 'utf8'));
if (cmd === 'up') await up();
else if (cmd === 'kill') console.log(docker('kill', '--signal', 'KILL', fx().container));
else if (cmd === 'start') {
  console.log(docker('start', fx().container));
  await waitHealthy(fx().url);
} else if (cmd === 'wipe-disk') {
  // A replaced renderer/checkout disk: the container and both volumes go;
  // the SQLite accepted store lives on /data, so this is ONLY valid for the
  // object-storage restore drill (rehydrate from the R2 prefix).
  const f = fx();
  try {
    docker('rm', '-f', f.container);
  } catch {
    /* gone */
  }
  for (const d of ['data', 'repo']) {
    rmSync(join(work, d), { recursive: true, force: true });
    mkdirSync(join(work, d));
  }
  runContainer(f, { allowEmpty: false });
  await waitHealthy(f.url, 300000);
} else if (cmd === 'signin') {
  const f = fx();
  f.sessions = await signInAll(f);
  writeFileSync(fixturePath, JSON.stringify(f, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(f.sessions).map(([k, v]) => [k, v.role]))));
} else if (cmd === 'recreate') {
  // Same volumes (data + checkout), new container configuration.
  const f = fx();
  try {
    docker('rm', '-f', f.container);
  } catch {
    /* gone */
  }
  runContainer(f, { allowEmpty: false });
  await waitHealthy(f.url, 300000);
  f.browserUrl = `http://studio.selfhost.localhost:${f.port}`;
  writeFileSync(fixturePath, JSON.stringify(f, null, 2), { mode: 0o600 });
  console.log(`recreated ${f.container}`);
} else if (cmd === 'down') {
  const f = existsSync(fixturePath) ? fx() : null;
  if (f)
    try {
      docker('rm', '-f', f.container);
    } catch {
      /* gone */
    }
  if (has('purge')) rmSync(work, { recursive: true, force: true });
} else throw new Error('up | signin | down | kill | start | wipe-disk');
