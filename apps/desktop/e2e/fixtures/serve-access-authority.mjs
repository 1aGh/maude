#!/usr/bin/env node
// The control plane's ACCESS AUTHORITY for the cloud lane's local cell — the REAL
// `apps/cloud/access-forward.mjs` (what `/internal/projects/:p/access/*` runs on the fleet) over a
// throwaway node:sqlite D1, seeded the way a just-created project is: the owner's account and the
// project row it owns. Loopback only; nothing leaves this machine.
//
// rc3-j (#162): a cloud-identity cell decides nothing about access — it forwards every
// `/api/access/*` to its control plane (routes-v2/access.mjs `forward`). The lane's cell had no
// control plane to forward to, so every Share sheet answer was the cell's own 503 "Sharing is not
// available right now" — a red line under "Moved to Maude Cloud" that no real cell draws.
//
// The lane's hub (apps/hub/test/fixtures/serve-hub.mjs) signs with a fixed secret; on the fleet a
// cell's HUB_SECRET IS `deriveCellSecret(master, tenant)` (apps/cells/cell-config.mjs). So the
// bearer that equals `--cell-secret` is swapped for the derived one before the forwarder checks it;
// any other bearer reaches the forwarder as sent and is refused there.
//
//   node serve-access-authority.mjs --project <id> --owner <email> --cell-secret <s>
// prints one JSON line `{ "http": "http://127.0.0.1:<port>" }` once it listens.

import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const project = arg('project');
const owner = arg('owner');
const cellSecret = arg('cell-secret');
if (!project || !owner || !cellSecret) {
  process.stderr.write('usage: --project <id> --owner <email> --cell-secret <secret>\n');
  process.exit(2);
}

const imp = (rel) => import(pathToFileURL(join(REPO, rel)).href);
const { handleAccessForward } = await imp('apps/cloud/access-forward.mjs');
const { deriveCellSecret } = await imp('apps/cloud/cell-token.mjs');
const { d1FromSqlite } = await imp('apps/cloud/db.mjs');
const { applySchema } = await imp('apps/cloud/migrate.mjs');
const { SCHEMA_SQL } = await imp('apps/cloud/schema.mjs');

const MASTER = `lane-${Math.random().toString(36).slice(2)}`;
const sqlite = new DatabaseSync(':memory:');
const DB = d1FromSqlite(sqlite);
await applySchema(DB, SCHEMA_SQL);
sqlite
  .prepare('INSERT INTO accounts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
  .run('owner', owner, owner.split('@')[0], Date.now());
sqlite
  .prepare(
    `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
     VALUES (?, 'owner', ?, 'active', ?, ?)`
  )
  .run(project, project, Date.now(), Date.now());
const env = { DB, CELL_SECRET_MASTER: MASTER };
const derived = await deriveCellSecret(MASTER, project);

const srv = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  if (headers.get('authorization') === `Bearer ${cellSecret}`)
    headers.set('authorization', `Bearer ${derived}`);
  const body = Buffer.concat(chunks);
  let answer = null;
  try {
    answer = await handleAccessForward(
      new Request(`http://control-plane.local${req.url}`, {
        method: req.method,
        headers,
        ...(body.length && req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}),
      }),
      env,
      { ctx: { waitUntil: () => {} } }
    );
  } catch (err) {
    process.stderr.write(`[access-authority] ${err?.message ?? err}\n`);
    answer = Response.json({ error: 'authority failed' }, { status: 500 });
  }
  answer ??= Response.json({ error: 'not here' }, { status: 404 });
  res.writeHead(answer.status, Object.fromEntries(answer.headers));
  res.end(Buffer.from(await answer.arrayBuffer()));
});
srv.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ http: `http://127.0.0.1:${srv.address().port}` })}\n`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => srv.close(() => process.exit(0)));
