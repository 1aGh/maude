// Phase 23 B2/B6 — removals reach live sessions; strict retires local doors.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { handleAuthRoutes } from '../src/auth-routes.mjs';
import {
  answerRevocationNudge,
  fetchRevocations,
  scheduleRevocationSweep,
} from '../src/cell-ops.mjs';
import { accessClaims, authenticateForMode, signAccessToken } from '../src/cloud-identity.mjs';
import { isRevoked, recordRevocations, resetRevocationCache } from '../src/revocations.mjs';
import { addToken, listTokensForOwner } from '../src/tokens.mjs';

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'revocation-'));
  scratch.push(dir);
  return dir;
}

const CP_ENV = {
  MAUDE_CONTROL_PLANE_URL: 'https://cloud.test',
  MAUDE_TENANT_ID: 'alligators',
  HUB_SECRET: 'derived-secret',
};

test('the sweep revokes a removed member’s tokens and kicks their sockets', async () => {
  const dir = dataDir();
  const { revokeTokensForOwner } = await import('../src/tokens.mjs');
  addToken(dir, { label: 'u-aaaaaaaaaaaa', scope: '*', owner: 'gone@example.com' });
  addToken(dir, { label: 'u-bbbbbbbbbbbb', scope: '*', owner: 'stays@example.com' });

  const kicked = [];
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/internal\/revocations\?tenant=alligators&since=\d+/);
    return new Response(
      JSON.stringify({ revocations: [{ email: 'Gone@Example.com', at: Date.now() }] }),
      { headers: { 'content-type': 'application/json' } }
    );
  };
  const sweep = scheduleRevocationSweep({
    dataDir: dir,
    revokeForOwner: revokeTokensForOwner,
    kickLabel: (label) => kicked.push(label),
    env: CP_ENV,
    fetchImpl,
    log: { log() {}, error() {} },
  });
  assert.equal(sweep.enabled, true);
  const result = await sweep.tick();
  sweep.stop();

  assert.deepEqual(result, { seen: 1, revoked: 1 });
  assert.deepEqual(kicked, ['u-aaaaaaaaaaaa']);
  assert.equal(listTokensForOwner(dir, 'gone@example.com').length, 0, 'removed member has none');
  assert.equal(listTokensForOwner(dir, 'stays@example.com').length, 1, 'nobody else touched');

  // Idempotent: the same answer again revokes nothing further.
  const again = await sweep.tick();
  assert.deepEqual(again, { seen: 1, revoked: 0 });
});

test('a self-hosted hub (no control plane) never ticks', () => {
  const sweep = scheduleRevocationSweep({
    dataDir: dataDir(),
    revokeForOwner: () => [],
    env: {},
  });
  assert.equal(sweep.enabled, false);
});

test('fetchRevocations swallows outages into an empty sweep', async () => {
  const out = await fetchRevocations(
    { controlPlaneUrl: 'https://cloud.test', tenantId: 'x', cellSecret: 's', since: 0 },
    {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    }
  );
  assert.deepEqual(out.revocations, []);
});

// ---- B6: strict cloud identity retires the hub-local doors ----------------

async function callAuth(dir, { method, path, body }) {
  const out = {};
  const handled = await handleAuthRoutes({
    request: { headers: {} },
    response: {},
    path,
    method,
    dataDir: dir,
    secret: 'hub-secret',
    respondJson: (status, payload) => {
      out.status = status;
      out.payload = payload;
    },
    readJsonBody: async () => body ?? {},
    kickLabel: () => 0,
    pushActivity: () => {},
  });
  return { handled, ...out };
}

test('strict: /join answers with directions to the dashboard, never a redemption', async () => {
  const dir = dataDir();
  process.env.MAUDE_CLOUD_IDENTITY = 'strict';
  process.env.MAUDE_TENANT_ID = 'alligators';
  try {
    for (const [method, path] of [
      ['GET', '/join/some-invite-value'],
      ['POST', '/join'],
    ]) {
      const res = await callAuth(dir, { method, path, body: { token: 'x' } });
      assert.equal(res.handled, true);
      assert.equal(res.status, 410);
      assert.match(res.payload.error, /Maude Cloud dashboard/);
    }
  } finally {
    delete process.env.MAUDE_CLOUD_IDENTITY;
    delete process.env.MAUDE_TENANT_ID;
  }
});

test('hybrid: /join keeps working — retirement is strict-only', async () => {
  const dir = dataDir();
  process.env.MAUDE_CLOUD_IDENTITY = '1';
  process.env.MAUDE_TENANT_ID = 'alligators';
  try {
    const res = await callAuth(dir, { method: 'GET', path: '/join/nonsense-value' });
    assert.equal(res.handled, true);
    // A bad invite is refused as a bad INVITE (410 with an invite reason), not
    // as a retired door.
    assert.equal(res.status, 410);
    assert.doesNotMatch(res.payload.error ?? '', /dashboard/);
  } finally {
    delete process.env.MAUDE_CLOUD_IDENTITY;
    delete process.env.MAUDE_TENANT_ID;
  }
});

// ---- validate 2026-07-30 (attacker A2/A3): the sweep must CLOSE the door ---

test('a removed member cannot re-open a session with the token they already hold', async () => {
  const dir = dataDir();
  resetRevocationCache();
  const NOW = 1_700_000_000_000;
  const key = 'a'.repeat(64);
  const env = {
    MAUDE_CLOUD_IDENTITY: '1',
    MAUDE_TENANT_ID: 'alligators',
    MAUDE_PROJECT_TOKEN_KEY: key,
  };

  // A token minted BEFORE the removal — signature and expiry both still good.
  const token = signAccessToken(
    accessClaims(
      { email: 'gone@example.com', project: 'alligators', role: 'member' },
      { now: NOW }
    ),
    key
  );
  const before = authenticateForMode(
    { token },
    {
      local: () => ({ ok: false }),
      revoked: (e, iat) => isRevoked(dir, e, iat),
      env,
      now: NOW + 1000,
    }
  );
  assert.equal(before.ok, true, 'valid before the removal');

  // The sweep learns about the removal.
  recordRevocations(dir, [{ email: 'Gone@Example.com', at: NOW + 60_000 }]);

  const after = authenticateForMode(
    { token },
    {
      local: () => ({ ok: false }),
      revoked: (e, iat) => isRevoked(dir, e, iat),
      env,
      now: NOW + 120_000,
    }
  );
  assert.equal(after.ok, false, 'the same token is spent after the removal');
  assert.equal(after.reason, 'access-withdrawn');
  assert.match(after.message, /add you again/);

  // Re-adding them mints a NEWER token, which must work without a manual reset.
  const fresh = signAccessToken(
    accessClaims(
      { email: 'gone@example.com', project: 'alligators', role: 'member' },
      { now: NOW + 120_000 }
    ),
    key
  );
  const readded = authenticateForMode(
    { token: fresh },
    {
      local: () => ({ ok: false }),
      revoked: (e, iat) => isRevoked(dir, e, iat),
      env,
      now: NOW + 130_000,
    }
  );
  assert.equal(readded.ok, true, 'a token minted after the removal is honoured');
});

test('the registry survives a restart and an outage never empties it', () => {
  const dir = dataDir();
  resetRevocationCache();
  recordRevocations(dir, [{ email: 'gone@example.com', at: 5_000 }]);
  resetRevocationCache(); // simulate a cell restart
  assert.equal(isRevoked(dir, 'gone@example.com', 4_000), true, 'remembered across a restart');
  // An outage yields an EMPTY fetch; recording nothing must not forget.
  recordRevocations(dir, []);
  assert.equal(isRevoked(dir, 'gone@example.com', 4_000), true);
});

// followup-multiplayer-hardening G5 — the control plane asks for a sweep right
// after a removal. If a tick is already running it may have read the list
// BEFORE the removal was written, so the ask must not be dropped: one more
// tick runs when it ends, and that one sees the removal.
test('a tick asked for while one runs is not dropped — it runs once more afterwards', async () => {
  const dir = dataDir();
  const { revokeTokensForOwner } = await import('../src/tokens.mjs');
  addToken(dir, { label: 'u-cccccccccccc', scope: '*', owner: 'late@example.com' });
  let calls = 0;
  let release;
  const firstAnswered = new Promise((r) => {
    release = r;
  });
  const fetchImpl = async () => {
    calls += 1;
    // The first read is slow and predates the removal; the second sees it.
    if (calls === 1) await firstAnswered;
    const revocations = calls === 1 ? [] : [{ email: 'late@example.com', at: Date.now() }];
    return new Response(JSON.stringify({ revocations }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const kicked = [];
  const sweep = scheduleRevocationSweep({
    dataDir: dir,
    revokeForOwner: revokeTokensForOwner,
    kickLabel: (label) => kicked.push(label),
    env: CP_ENV,
    fetchImpl,
    log: { log() {}, error() {} },
  });
  const running = sweep.tick();
  assert.equal(
    await sweep.tick(),
    null,
    'the nudge during a running tick is queued, not run twice at once'
  );
  release();
  assert.deepEqual(await running, { seen: 0, revoked: 0 });
  for (let i = 0; i < 100 && kicked.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  sweep.stop();
  assert.equal(calls, 2, 'exactly one more read');
  assert.deepEqual(kicked, ['u-cccccccccccc']);
  assert.equal(listTokensForOwner(dir, 'late@example.com').length, 0);
});

test('the nudge route: only the derived secret may ask, and it runs the sweep', async () => {
  let ticks = 0;
  const sweep = {
    enabled: true,
    tick: async () => {
      ticks += 1;
      return { seen: 2, revoked: 1 };
    },
  };
  assert.deepEqual(await answerRevocationNudge({ authorized: false, sweep }), {
    status: 401,
    body: { error: 'unauthorized' },
  });
  assert.equal(ticks, 0, 'an unauthorized knock runs nothing');
  assert.deepEqual(await answerRevocationNudge({ authorized: true, sweep }), {
    status: 200,
    body: { ran: true, seen: 2, revoked: 1 },
  });
  assert.equal(
    (await answerRevocationNudge({ authorized: true, sweep: { enabled: false } })).status,
    404
  );
  const busy = { enabled: true, tick: async () => null };
  assert.deepEqual((await answerRevocationNudge({ authorized: true, sweep: busy })).body, {
    ran: false,
    queued: true,
  });
});
