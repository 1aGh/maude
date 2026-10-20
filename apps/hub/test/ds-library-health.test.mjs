// S10.18a — the `ds-library` capability (V2-1.6 §5.14), at the real hub boot. A hub that serves
// no checkout (no studio child, so no design root) lists no `ds-library` and its rows answer
// 404 like a hub that never had them; `/health` and the rows ask the same predicate. A v2
// studio links a library only where the capability is listed (old cells fail closed, S10.18b).

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DS_LIBRARY_CAPABILITY } from '../src/ds-library.mjs';
import { createHub } from '../src/server.mjs';

let hub;
let base;
let dataDir;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-ds-library-'));
  hub = createHub({ port: 0, dataDir, secret: '', verbose: false }).server;
  await hub.listen();
  base = hub.httpURL.replace('0.0.0.0', '127.0.0.1').replace(/\/$/, '');
});

after(async () => {
  if (hub) await hub.destroy();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('the capability word is ds-library', () => {
  assert.equal(DS_LIBRARY_CAPABILITY, 'ds-library');
});

test('a hub without a design root lists no ds-library', async () => {
  const body = await (await fetch(`${base}/health`)).json();
  assert.ok(Array.isArray(body.capabilities), 'the hub lists capabilities');
  assert.ok(!body.capabilities.includes(DS_LIBRARY_CAPABILITY));
});

test('its ds rows answer 404 and never write', async () => {
  const head = `${base}/api/projects/current/v1/ds/brand/head`;
  assert.equal((await fetch(head)).status, 404);
  assert.equal((await fetch(`${head}/../../other/head`)).status, 404);
  const post = await fetch(head, { method: 'POST', body: '{}' });
  assert.equal(post.status, 405);
});

test('/health and the rows ask the same predicate, over the same design root', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/server.mjs', import.meta.url)), 'utf8');
  const has = (needle, why) => assert.ok(src.includes(needle), why);
  has('...(dsLibraryRoutes.enabled() ? [DS_LIBRARY_CAPABILITY] : [])', '/health asks enabled()');
  has('dsLibrary: dsLibraryRoutes', 'the rows get the same runtime');
  const at = src.indexOf('createDsLibraryRoutes({');
  assert.ok(at > 0, 'the hub builds the runtime');
  const lib = src.slice(at, at + 600);
  assert.ok(
    lib.includes('designRoot: () => (studioProxy ? designRootFor() : null)'),
    'design root'
  );
  // S10.18a-2: the grant store's verifier — null while MAUDE_DS_LIBRARY_GRANTS is off.
  assert.ok(lib.includes('verifyGrant: dsGrants.verifyGrant'), 'the grant store decides');
});
