#!/usr/bin/env node
// The hub of the share-roles lane: a REAL hub from source, running the way a cloud cell runs
// (cloud identity, the control plane as the access authority) with `roles-v2` ON — Can view, canvas
// scope and share links are what the lane exercises, and `ROLES_V2_ADVERTISED` is still false by
// default (apps/hub/src/routes-v2/access.mjs). `serve-hub.mjs` cannot say that (no `rolesV2`, a fixed
// secret), so this is its sibling; everything else is the same.
//
//   node share-roles-hub.mjs <dataDir>
//
// Env (the cell's own): HUB_SECRET (the derived cell secret the control plane checks), MAUDE_TENANT_ID,
// MAUDE_CONTROL_PLANE_URL, MAUDE_CLOUD_IDENTITY=1, MAUDE_PROJECT_TOKEN_KEY. Prints one JSON line
// `{ http, ws, port }` once it listens, then serves until SIGTERM. Run under NODE 24 (better-sqlite3).
import { mkdirSync } from 'node:fs';

import { createHub } from '../../../hub/src/server.mjs';

const [dataDir] = process.argv.slice(2);
if (!dataDir) {
  process.stderr.write('usage: share-roles-hub.mjs <dataDir>\n');
  process.exit(2);
}
for (const key of ['HUB_SECRET', 'MAUDE_TENANT_ID', 'MAUDE_CONTROL_PLANE_URL']) {
  if (!process.env[key]) {
    process.stderr.write(`share-roles-hub: ${key} is required (the cell's env)\n`);
    process.exit(2);
  }
}
mkdirSync(dataDir, { recursive: true });

const built = createHub({
  port: 0,
  dataDir,
  secret: process.env.HUB_SECRET,
  rolesV2: true,
  verbose: false,
});
await built.server.listen();
await built.acceptedReady;
const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1').replace(/\/$/, '');
const ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');

// The accepted-revisions mode the other lanes' local hub runs in (fixtures/local-hub.mjs default).
const state = await built.accepted.kernel.state();
if (state.mode !== 'transactions') {
  await built.accepted.setMode({ mode: 'transactions', expectEpoch: state.epoch });
}

process.stdout.write(`${JSON.stringify({ http, ws, port: new URL(http).port })}\n`);

const stop = async () => {
  try {
    await built.server.destroy();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
