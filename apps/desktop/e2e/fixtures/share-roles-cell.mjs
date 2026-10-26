#!/usr/bin/env node
// The share-roles lane's CELL: the link viewer's door (decision maude/v2-p8-e2e-link-viewer-on-cell-door).
//
// A person who opens a share link has no Maude app — they are a plain browser on the project's cell. The
// cell's door is the only place the link-off refusal comes from (a 401 `{reason:'link-off'}` for a session
// an access notice ended, ended-sessions.mjs), and the door exists only in WORKSPACE mode: the hub owns a
// checkout, supervises the real studio as a child on loopback and proxies the browser to it. So this is
// share-roles-hub.mjs's sibling in workspace mode — the same cloud-identity env and roles-v2, plus what
// scripts/dev/local-cell.mjs gives a cell (MAUDE_REPO_DIR, HUB_PUBLIC_URL, the canvas origin through the
// hub's door), read by createHub from the environment.
//
//   node share-roles-cell.mjs <dataDir> <port>
//
// The port is fixed by the caller because HUB_PUBLIC_URL / MAUDE_PUBLIC_CANVAS_ORIGIN must name it before
// the hub listens. Prints one JSON line `{ http, studioPort }` once the hub listens and its studio child
// answers, then serves until SIGTERM (which also stops the child). Run under NODE 24 (better-sqlite3).
import { mkdirSync } from 'node:fs';

import { createHub } from '../../../hub/src/server.mjs';

const [dataDir, portArg] = process.argv.slice(2);
const port = Number(portArg);
if (!dataDir || !Number.isInteger(port) || port <= 0) {
  process.stderr.write('usage: share-roles-cell.mjs <dataDir> <port>\n');
  process.exit(2);
}
for (const key of [
  'HUB_SECRET',
  'MAUDE_TENANT_ID',
  'MAUDE_CONTROL_PLANE_URL',
  'MAUDE_REPO_DIR',
  'HUB_PUBLIC_URL',
  'MAUDE_STUDIO_PORT',
]) {
  if (!process.env[key]) {
    process.stderr.write(`share-roles-cell: ${key} is required (the cell's env)\n`);
    process.exit(2);
  }
}
if (process.env.MAUDE_WORKSPACE_MODE !== '1') {
  process.stderr.write('share-roles-cell: MAUDE_WORKSPACE_MODE=1 is what makes this a cell\n');
  process.exit(2);
}
mkdirSync(dataDir, { recursive: true });

const built = createHub({
  port,
  dataDir,
  secret: process.env.HUB_SECRET,
  publicUrl: process.env.HUB_PUBLIC_URL,
  insecureHttp: true,
  rateLimit: false,
  rolesV2: true,
  verbose: false,
});
if (!built.studio) {
  process.stderr.write('share-roles-cell: the hub supervises no studio — not in workspace mode\n');
  process.exit(2);
}
await built.server.listen();
built.attachStudioUpgrades();
built.studio.start();

// Ready = the studio child answers on loopback (the hub's own supervisor probes the same `/_health`).
const studioPort = built.studio.port;
const deadline = Date.now() + 90_000;
for (;;) {
  try {
    const r = await fetch(`http://127.0.0.1:${studioPort}/_health`);
    if (r.ok) break;
  } catch {
    /* not yet */
  }
  if (Date.now() > deadline) {
    process.stderr.write('share-roles-cell: the studio child did not answer in 90 s\n');
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 250));
}

process.stdout.write(`${JSON.stringify({ http: `http://127.0.0.1:${port}`, studioPort })}\n`);

const stop = async () => {
  try {
    await built.studio.stop();
  } catch {
    /* gone */
  }
  try {
    await built.server.destroy();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
