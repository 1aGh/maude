#!/usr/bin/env node
// A real hub for cross-runtime tests (the studio suite runs on Bun, which
// cannot load better-sqlite3). Prints one JSON line — URLs and tokens — once
// the hub listens and its accepted-revisions store is ready, then serves until
// SIGTERM.
//
//   node serve-hub.mjs <dataDir> [port] [--transactions]
//
// Tokens are minted once per data dir and re-read on a restart, so a test can
// kill and restart the same hub (same port, same store) and keep its peers.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createHub } from '../../src/server.mjs';
import { addToken } from '../../src/tokens.mjs';

const [dataDir, portArg] = process.argv.slice(2);
const transactions = process.argv.includes('--transactions');
if (!dataDir) {
  process.stderr.write('usage: serve-hub.mjs <dataDir> [port] [--transactions]\n');
  process.exit(2);
}

mkdirSync(dataDir, { recursive: true });
const tokensFile = join(dataDir, 'test-tokens.json');
let tokens;
if (existsSync(tokensFile)) {
  tokens = JSON.parse(readFileSync(tokensFile, 'utf8'));
} else {
  tokens = {
    owner: addToken(dataDir, { label: 'owner-machine', scope: '*' }).value,
    alice: addToken(dataDir, {
      label: 'alice-laptop',
      scope: '*',
      role: 'member',
      owner: 'alice@x.test',
    }).value,
    bob: addToken(dataDir, {
      label: 'bob-laptop',
      scope: '*',
      role: 'member',
      owner: 'bob@x.test',
    }).value,
    viewer: addToken(dataDir, { label: 'viewer', scope: '*', readOnly: true }).value,
  };
  writeFileSync(tokensFile, JSON.stringify(tokens));
}

const built = createHub({
  port: Number(portArg ?? 0),
  dataDir,
  secret: 'test-secret',
  verbose: false,
});
await built.server.listen();
await built.acceptedReady;
const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
const ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');

if (transactions) {
  const state = await built.accepted.kernel.state();
  if (state.mode !== 'transactions') {
    await built.accepted.setMode({ mode: 'transactions', expectEpoch: state.epoch });
  }
}

process.stdout.write(`${JSON.stringify({ http, ws, port: new URL(http).port, tokens })}\n`);

const stop = async () => {
  try {
    await built.server.destroy();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
