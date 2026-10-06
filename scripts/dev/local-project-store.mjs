#!/usr/bin/env node
// A LOCAL ProjectStore — the cloud's accepted-revision store on your machine.
//
// The cell's Durable Object runs `apps/cells/project-store.mjs` (the shared
// `store-core`) over the DO's SQLite, reached from the container over HTTP.
// This serves the SAME host over the SAME wire shape as the T32 verification
// Worker (`POST /t/<project>/v1/<method>` {args} → {ok, value|error}, bearer),
// on better-sqlite3, with an injected per-call latency — so a hub from source
// or the self-host image (MAUDE_PROJECT_STORE_URL + _TOKEN) behaves like a
// cloud cell without an account: every store call is a round trip.
//
//   node scripts/dev/local-project-store.mjs --dir <data dir> [--port 8788]
//        [--latency-ms 40] [--token <secret>] [--host 0.0.0.0]
//
// Prints one JSON line { url, token, port } when it listens.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// Built-in SQLite, no native module: the script runs as it is in a plain
// `node:24-slim` container (the cloud-shaped fixture puts it on the hub's
// docker network) as well as on the host.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createProjectStoreHost } = await import(join(ROOT, 'apps/cells/project-store.mjs'));

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const dir = resolve(arg('dir', join(process.cwd(), 'local-project-store')));
const port = Number(arg('port', '8788'));
const host = arg('host', '127.0.0.1');
const latencyMs = Number(arg('latency-ms', '40'));
const token = arg('token', randomBytes(16).toString('hex'));
mkdirSync(dir, { recursive: true });

/** One SQLite file per project; `ctx.storage` shaped like a Durable Object's. */
const hosts = new Map();
function hostFor(project) {
  if (!hosts.has(project)) {
    const db = new DatabaseSync(join(dir, `${project}.sqlite`));
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    const storage = {
      sql: {
        exec(query, ...params) {
          let stmt;
          try {
            stmt = db.prepare(query);
          } catch (err) {
            // A DO's sql.exec runs a multi-statement script (migrations); a
            // prepared statement is one statement.
            if (params.length === 0) {
              db.exec(query);
              return { toArray: () => [] };
            }
            throw err;
          }
          const rows = stmt.columns().length
            ? stmt.all(...params).map((r) => ({ ...r }))
            : (stmt.run(...params), []);
          return { toArray: () => rows };
        },
      },
      transactionSync(fn) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const out = fn();
          db.exec('COMMIT');
          return out;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      },
    };
    hosts.set(project, createProjectStoreHost(storage));
  }
  return hosts.get(project);
}

const METHOD = /^\/t\/([a-z0-9][a-z0-9-]{0,62})\/v1\/([A-Za-z]+)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ calls }));
    return;
  }
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end('unauthorized');
    return;
  }
  const m = METHOD.exec(new URL(req.url, 'http://x').pathname);
  if (!m || req.method !== 'POST') {
    res.writeHead(404).end('not found');
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let args = [];
  try {
    args = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.args ?? [];
  } catch {
    /* host answers a bad request */
  }
  calls += 1;
  // Half the latency on the way in, half on the way out: a round trip.
  if (latencyMs > 0) await sleep(latencyMs / 2);
  const answer = hostFor(m[1])(m[2], args);
  if (latencyMs > 0) await sleep(latencyMs / 2);
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
});
server.listen(port, host, () => {
  console.log(JSON.stringify({ url: `http://${host}:${port}`, port, token, latencyMs, dir }));
});
