// Issue #204 — a member's first sync of its own project must not meet the READ ceiling as a wall.
//
// File-plane reads (`/_project-file/` GETs, the journal cursor, the presence report) share one
// per-label bucket. It borrowed the asset WRITE ceiling (600/min), so a new Mac pulling a 5 000-file
// project could not go faster than 10 requests a second whatever its bandwidth, and the 2.0.x client
// met it as `HTTP 429` in the field. The bucket is now its own figure (1 800/min), still a ceiling,
// and advertised in `/api/file-limits` so a client paces under it instead of discovering it.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { ASSET_WRITE_RATE_LIMIT_MAX, createHub, FILE_READ_RATE_LIMIT_MAX } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const BASE_PORT = Number.parseInt(process.env.HUB_TEST_PORT ?? '14960', 10);
let portCounter = 0;
let hub = null;
let dataDir = null;

async function boot(config = {}) {
  const port = BASE_PORT + portCounter++;
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-read-limit-'));
  hub = createHub({
    port,
    dataDir,
    secret: 'rl-secret',
    verbose: false,
    rateLimit: true,
    ...config,
  }).server;
  await hub.listen();
  const { value } = addToken(dataDir, { label: 'member-mac', scope: '*', role: 'member' });
  return { base: `http://127.0.0.1:${port}`, token: value };
}

afterEach(async () => {
  if (hub) await hub.destroy();
  hub = null;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

const journalRead = async (base, token) => {
  const res = await fetch(`${base}/api/journal?since=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  await res.arrayBuffer();
  return res.status;
};

test('the read ceiling is its own figure, above the write one it used to borrow', () => {
  assert.equal(FILE_READ_RATE_LIMIT_MAX, 1800);
  assert.ok(FILE_READ_RATE_LIMIT_MAX > ASSET_WRITE_RATE_LIMIT_MAX);
});

test('a member reads past the old 600 a minute without a 429', async () => {
  const { base, token } = await boot();
  const statuses = [];
  for (let i = 0; i < ASSET_WRITE_RATE_LIMIT_MAX + 50; i++)
    statuses.push(await journalRead(base, token));
  assert.equal(
    statuses.filter((s) => s === 429).length,
    0,
    'no read inside the first 650 of a minute is refused'
  );
});

test('it is still a ceiling: past it, the label is refused', async () => {
  const { base, token } = await boot({ fileReadRateLimit: 5 });
  for (let i = 0; i < 5; i++) assert.equal(await journalRead(base, token), 200);
  assert.equal(await journalRead(base, token), 429);
});

test('/api/file-limits advertises the read ceiling a client paces under', async () => {
  const { base, token } = await boot({ fileReadRateLimit: 900 });
  const res = await fetch(`${base}/api/file-limits`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  assert.equal(body.readsPerMinute, 900);
});

test('a hub that does not meter reads advertises no ceiling', async () => {
  const { base } = await boot({ rateLimit: false });
  const body = await (await fetch(`${base}/api/file-limits`)).json();
  assert.equal('readsPerMinute' in body, false);
});
