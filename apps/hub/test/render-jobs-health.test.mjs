// S8.5b-2 — the render door is dark by capability (contract S8.5b §4.4, §11, M1), at the real
// hub boot: a hub with no studio child lists no `render-jobs-v1` and answers its rows 404 even
// with a render service configured and the flag on; `/health` and the rows share one predicate.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RENDER_JOBS_CAPABILITY } from '../src/routes-v2/render-jobs.mjs';
import { createHub } from '../src/server.mjs';

const saved = {};
let hub;
let base;
let dataDir;

before(async () => {
  for (const k of ['MAUDE_RENDER_URL', 'MAUDE_RENDER_DOOR']) saved[k] = process.env[k];
  process.env.MAUDE_RENDER_URL = 'http://127.0.0.1:1/never-called';
  process.env.MAUDE_RENDER_DOOR = '1';
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-render-door-'));
  hub = createHub({ port: 0, dataDir, secret: '', verbose: false }).server;
  await hub.listen();
  base = hub.httpURL.replace('0.0.0.0', '127.0.0.1').replace(/\/$/, '');
});

after(async () => {
  if (hub) await hub.destroy();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('a hub without a studio child lists no render-jobs-v1, flag or not', async () => {
  const body = await (await fetch(`${base}/health`)).json();
  assert.ok(Array.isArray(body.capabilities), 'the hub lists capabilities');
  assert.ok(!body.capabilities.includes(RENDER_JOBS_CAPABILITY));
});

test('its render-jobs rows answer 404, like a hub that never had them', async () => {
  const jobs = `${base}/api/projects/current/v1/render-jobs`;
  const post = await fetch(jobs, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'i_00000000000000000001', spec: { v: 2 } }),
  });
  assert.equal(post.status, 404);
  assert.equal((await fetch(`${jobs}/i_00000000000000000001`)).status, 404);
});

test('/health and the rows ask the same predicate, over the same studio', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/server.mjs', import.meta.url)), 'utf8');
  const uses = src.match(/renderDoorEnabled\(\{ studio \}\)/g) ?? [];
  assert.equal(uses.length, 2, 'one for /health, one for the door');
});
