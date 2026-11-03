#!/usr/bin/env node
// rc3-j (issue #162) — Move to cloud against a REAL local cell, with no production anywhere.
//
// What runs, all on 127.0.0.1, all throwaway:
//   • the CELL: scripts/dev/local-cell.mjs (the hub from source, workspace mode + its studio child),
//     switched into cloud-identity mode the way apps/cells/cell-config.mjs does it
//     (MAUDE_CLOUD_IDENTITY, MAUDE_PROJECT_TOKEN_KEY, MAUDE_TENANT_ID and, unless
//     `--no-control-plane`, MAUDE_CONTROL_PLANE_URL);
//   • the CONTROL PLANE's access authority: the REAL apps/cloud Worker (`worker.fetch`) over a
//     node:sqlite D1 seeded like a just-created project (the account + the project row it owns).
//     The device/projects/open half is a small stub, as in the e2e cloud lane, because the real
//     `POST /api/projects` provisions on Cloudflare. One shim: local-cell.mjs pins its HUB_SECRET,
//     so the cell's bearer is rewritten to the derived cell secret before the Worker sees it
//     (on the fleet HUB_SECRET IS that derived secret — cell-config.mjs:782);
//   • the DESKTOP: apps/studio/server.ts on a copy of the e2e fixture project, throwaway HOME/XDG,
//     MAUDE_CLOUD_CONFIG/HUBS_CONFIG_PATH in the run dir, NO_OPEN=1, MAUDE_NO_AUTOBUILD=1, stub claude.
//
// It runs the move (POST /_api/cloud/move as the window does), then asks every share route the
// Share sheet asks the moment the move reaches `uploading`/`ready`, several times over ~5 s, and
// counts /projects/open calls and the hub sessions the cell minted for the person.
//
//   PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH node repro-move-real-cell.mjs [--no-control-plane] [--hold]

import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../..');
const has = (f) => process.argv.includes(`--${f}`);
const withControlPlane = !has('no-control-plane');
const CELL_PORT = 4791;
const DESK_PORT = 4795;
const TENANT = 'moved-proj';
const EMAIL = 'mover@example.com';
const MASTER = 'rc3j-master-not-a-secret';
const LOCAL_CELL_SECRET = 'local-cell-secret-not-for-production';

const imp = (rel) => import(pathToFileURL(join(REPO, rel)).href);
const { deriveCellSecret } = await imp('apps/cloud/cell-token.mjs');
const { d1FromSqlite } = await imp('apps/cloud/db.mjs');
const { applySchema } = await imp('apps/cloud/migrate.mjs');
const { SCHEMA_SQL } = await imp('apps/cloud/schema.mjs');
const worker = (await imp('apps/cloud/worker.mjs')).default;
const cloudIdentity = await imp('apps/hub/src/cloud-identity.mjs');
const { stubClaudeEnv } = await imp('scripts/lib/stub-claude.mjs');

const run = mkdtempSync(join(tmpdir(), 'rc3j-move-'));
const log = [];
const note = (event, detail = {}) => {
  const row = { t: Date.now(), event, ...detail };
  log.push(row);
  process.stdout.write(`${JSON.stringify(row)}\n`);
};

// ── the control plane ─────────────────────────────────────────────────────
const sqlite = new DatabaseSync(':memory:');
const DB = d1FromSqlite(sqlite);
await applySchema(DB, SCHEMA_SQL);
sqlite.prepare('INSERT INTO accounts (id, email, name, created_at) VALUES (?, ?, ?, 1)').run('a1', EMAIL, 'Mover');
const cpEnv = { DB, CELL_SECRET_MASTER: MASTER, CELL_ZONE: 'cell.localhost' };
const projectTokenKey = await deriveCellSecret(MASTER, TENANT, 'project-token');
const cellSecret = await deriveCellSecret(MASTER, TENANT);
const CELL = `http://127.0.0.1:${CELL_PORT}`;
let created = false;
const counts = { open: 0, internalAccess: [] };

const cp = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url, 'http://cp.local');
  if (url.pathname.startsWith('/internal/')) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    if (headers.get('authorization') === `Bearer ${LOCAL_CELL_SECRET}`)
      headers.set('authorization', `Bearer ${cellSecret}`);
    const r = await worker.fetch(
      new Request(`https://cloud.test${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        ...(raw.length ? { body: raw } : {}),
      }),
      cpEnv,
      { waitUntil: () => {} }
    );
    counts.internalAccess.push({ path: url.pathname, status: r.status });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    // What the real create does first: the project row, owned by the caller (then provisioning).
    if (!created) {
      sqlite
        .prepare(
          `INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES (?, 'a1', 'Moved', 'active', 1, 1)`
        )
        .run(TENANT);
      created = true;
    }
    note('cp.create');
    return send(201, { project: { id: TENANT, name: 'Moved', state: 'provisioning' } });
  }
  if (url.pathname === '/api/projects') {
    return send(200, {
      projects: created ? [{ id: TENANT, name: 'Moved', state: 'active', role: 'owner', url: CELL }] : [],
    });
  }
  if (url.pathname === '/projects/open') {
    counts.open++;
    note('cp.open', { n: counts.open });
    const token = await cloudIdentity.signAccessToken(
      cloudIdentity.accessClaims({ email: EMAIL, project: TENANT, role: 'owner' }),
      projectTokenKey
    );
    return send(200, { token, role: 'owner', url: CELL, expiresAt: Date.now() + 3600_000 });
  }
  if (url.pathname === '/api/home') return send(200, { account: { email: EMAIL }, projects: [], shared: [] });
  if (url.pathname === '/health') return send(200, { ok: true });
  send(404, { error: 'not stubbed' });
});
await new Promise((ok) => cp.listen(0, '127.0.0.1', ok));
const CP = `http://127.0.0.1:${cp.address().port}`;
note('cp.up', { url: CP, withControlPlane });

// ── the cell (local-cell.mjs) ─────────────────────────────────────────────
const home = join(run, 'home');
mkdirSync(home, { recursive: true });
const isolated = {
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  NO_OPEN: '1',
  MAUDE_NO_AUTOBUILD: '1',
  ...stubClaudeEnv(home),
};
const cellEnv = {
  ...process.env,
  ...isolated,
  MAUDE_CLOUD_IDENTITY: '1',
  MAUDE_PROJECT_TOKEN_KEY: projectTokenKey,
  MAUDE_TENANT_ID: TENANT,
  MAUDE_STUDIO_PORT: String(CELL_PORT - 200),
};
if (withControlPlane) cellEnv.MAUDE_CONTROL_PLANE_URL = CP;
else delete cellEnv.MAUDE_CONTROL_PLANE_URL;
const cellDir = join(run, 'cell');
const cellProc = spawn(
  process.execPath,
  [join(REPO, 'scripts/dev/local-cell.mjs'), '--dir', cellDir, '--port', String(CELL_PORT), '--no-peer', '--keep'],
  { env: cellEnv, cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] }
);
let cellOut = '';
cellProc.stdout.on('data', (c) => (cellOut += c));
cellProc.stderr.on('data', (c) => (cellOut += c));

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
const health = await waitFor(
  async () => {
    const r = await fetch(`${CELL}/health`);
    return r.ok ? r.json() : null;
  },
  120_000,
  'cell /health'
);
note('cell.up', { node: process.version, access: health.access, formatVersion: health.formatVersion });

// ── the desktop studio ────────────────────────────────────────────────────
const proj = join(run, 'desktop-project');
cpSync(join(REPO, 'apps/desktop/e2e/fixtures/project'), proj, { recursive: true });
const machine = join(run, 'machine');
mkdirSync(machine, { recursive: true });
writeFileSync(
  join(machine, 'cloud.json'),
  JSON.stringify({ url: CP, token: 'mpt_rc3j', email: EMAIL, connectedAt: Date.now() })
);
const deskProc = spawn(
  'bun',
  [join(REPO, 'apps/studio/server.ts'), '--root', proj, '--port', String(DESK_PORT)],
  {
    env: {
      ...process.env,
      ...isolated,
      MAUDE_CLOUD_URL: CP,
      MAUDE_CLOUD_CONFIG: join(machine, 'cloud.json'),
      HUBS_CONFIG_PATH: join(machine, 'hubs.json'),
      MAUDE_MACHINE_FILE: join(machine, 'machine.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let deskOut = '';
deskProc.stdout.on('data', (c) => (deskOut += c));
deskProc.stderr.on('data', (c) => (deskOut += c));
const DESK = `http://127.0.0.1:${DESK_PORT}`;
await waitFor(async () => (await fetch(`${DESK}/_health`)).ok, 60_000, 'desktop /_health');
note('desk.up', { url: DESK });

const win = { origin: DESK, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const ask = async (path) => {
  const r = await fetch(`${DESK}${path}`, { headers: { 'sec-fetch-site': 'same-origin' } });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: r.status, body };
};

let failed = false;
try {
  if (has('hold') && has('ui')) {
    note('hold.ui', {
      desk: DESK,
      pids: { cell: cellProc.pid, desk: deskProc.pid },
      note: 'drive the Share sheet by hand / a browser now',
    });
    await new Promise(() => {});
  }
  const post = await fetch(`${DESK}/_api/cloud/move`, { method: 'POST', headers: win, body: '{}' });
  note('move.post', { status: post.status, body: await post.json() });
  let state = '';
  const seen = new Set();
  const end = Date.now() + 60_000;
  // Probe exactly what the sheet asks once posture says linked: posture, me, people.
  while (Date.now() < end) {
    const m = await ask('/_api/cloud/move');
    state = m.body?.state;
    if (!seen.has(state)) {
      seen.add(state);
      note('move.state', { state, error: m.body?.error });
    }
    if (state === 'uploading' || state === 'ready') {
      for (const p of ['/_api/share/posture', '/_api/share/me', '/_api/share/people?canvas=ui%2FSmoke.tsx', '/_api/share/people']) {
        const r = await ask(p);
        note('share', { at: state, path: p, status: r.status, error: r.body?.error, reason: r.body?.reason, people: Array.isArray(r.body?.people) ? r.body.people.length : undefined, linked: r.body?.linked, reachable: r.body?.reachable });
      }
    }
    if (state === 'ready' || state === 'failed') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // and over the next few seconds (the "first moments after a move")
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await ask('/_api/share/people');
    note('share.later', { s: i + 1, status: r.status, error: r.body?.error, reason: r.body?.reason, people: Array.isArray(r.body?.people) ? r.body.people.length : undefined });
  }
  const { listTokensForOwner } = await imp('apps/hub/src/tokens.mjs');
  const sessions = listTokensForOwner(join(cellDir, 'data'), EMAIL);
  note('summary', {
    withControlPlane,
    finalState: state,
    projectsOpen: counts.open,
    cellSessionsForPerson: sessions.length,
    internalAccess: counts.internalAccess,
  });
} catch (err) {
  failed = true;
  note('error', { message: err.message });
} finally {
  writeFileSync(join(run, 'run.jsonl'), log.map((r) => JSON.stringify(r)).join('\n'));
  writeFileSync(join(run, 'cell.log'), cellOut);
  writeFileSync(join(run, 'desk.log'), deskOut);
  note('artifacts', { run });
  if (has('hold')) {
    note('hold', { desk: DESK, pids: { cell: cellProc.pid, desk: deskProc.pid } });
    await new Promise(() => {});
  }
  deskProc.kill('SIGTERM');
  cellProc.kill('SIGTERM');
  cp.close();
  setTimeout(() => process.exit(failed ? 1 : 0), 2500);
}
