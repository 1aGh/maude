// p8-cloud-attach-regress — a desktop's `GET /api/file-limits` must not spend the sign-in budget.
//
// The file-limits read is metered per IP (a valid token is answered with its quota position, so an
// unauthenticated caller must not drive token verification at will). It was metered on the SAME
// per-IP bucket as `/auth/login` (5 / 60 s), so a linked desktop that started syncing a few times in
// a minute — every sync runtime asks once — left the next sign-in from that address refused with a
// 429, which the studio reports as "The workspace did not accept the sign-in" (the e2e:cloud lane's
// deep-link attach, once its cell held a checkout and the file plane came up).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';
import { createUser } from '../src/users.mjs';

const BASE_PORT = Number.parseInt(process.env.HUB_TEST_PORT ?? '14860', 10);
const PASSWORD = 'designer-pass-1';

let hub;
let dataDir;
let PORT;
let portCounter = 0;

beforeEach(async () => {
  PORT = BASE_PORT + portCounter++;
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-limits-bucket-'));
  createUser(dataDir, { email: 'des@x.test', password: PASSWORD, role: 'member' });
  hub = createHub({
    port: PORT,
    dataDir,
    secret: 'lb-secret',
    verbose: false,
    rateLimit: true,
  }).server;
  await hub.listen();
});

afterEach(async () => {
  if (hub) await hub.destroy();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const login = () =>
  fetch(`http://127.0.0.1:${PORT}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'des@x.test', password: PASSWORD }),
  });

test('six authenticated file-limits reads leave the sign-in from that address answered', async () => {
  const { value } = addToken(dataDir, { label: 'peer-a', scope: '*' });
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/file-limits`, {
      headers: { authorization: `Bearer ${value}` },
    });
    assert.equal(res.status, 200);
    await res.arrayBuffer();
  }
  const res = await login();
  assert.equal(res.status, 200, `sign-in after file-limits reads answered ${res.status}`);
});

test('file-limits stays metered on its own: past the ceiling a token learns no quota position', async () => {
  const { value } = addToken(dataDir, { label: 'peer-b', scope: '*' });
  const read = async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/file-limits`, {
      headers: { authorization: `Bearer ${value}` },
    });
    assert.equal(res.status, 200);
    return res.json();
  };
  const first = await read();
  assert.ok('quotaUsed' in first, 'a valid token within budget learns its quota position');
  for (let i = 0; i < 5; i++) await read();
  const limited = await read();
  assert.ok(!('quotaUsed' in limited), 'past the per-IP ceiling only the public ceilings answer');
});

test('the sign-in bucket still trips on its own traffic', async () => {
  let last;
  for (let i = 0; i < 6; i++) {
    last = await fetch(`http://127.0.0.1:${PORT}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'des@x.test', password: 'wrong' }),
    });
    await last.arrayBuffer();
  }
  assert.equal(last.status, 429);
});
