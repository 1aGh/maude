// A paused cloud project — Maude v2 S9.15 (Gate 0 A3, S9-slices Q11).
//
// When the trial ends with no subscription, the control plane marks the
// project paused and the cell starts with `MAUDE_PLAN_STATE=paused`. The cell
// then answers reads and exports, and refuses writes and sync with
//
//   402 { reason: 'plan', error: 'Choose a plan to keep editing.' }   (owner)
//   402 { reason: 'plan', error: <no billing words> }                 (anyone else)
//
// 402 is distinct from 403, so a v2 client shows the plan callout and never
// renews credentials on it. A role that could not write anyway keeps today's
// 403 — the pause tells nobody anything they could not already see.
//
// v1: a 1.9.1 desktop's write is refused BEFORE its handler runs, so nothing is
// half-written; its outbox retries, and the retry lands once the plan is chosen.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, test } from 'node:test';

import {
  hubAccessRefusal,
  OBSERVER_REFUSAL,
  PLAN_OWNER_REFUSAL,
  PLAN_PAUSED_REFUSAL,
  planPausedFromEnv,
  READ_ONLY_REFUSAL,
} from '../src/access-gate.mjs';
import { runHubRoutes } from '../src/routes-v2/index.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const MATCHES = {
  owner: { label: 'o', owner: 'o@x.test', role: 'owner', readOnly: false, scope: '*' },
  member: { label: 'm', owner: 'm@x.test', role: 'member', readOnly: false, scope: '*' },
  viewer: { label: 'v', owner: 'v@x.test', role: 'viewer', readOnly: true, scope: '*' },
  observer: {
    label: 'b',
    owner: 'b@x.test',
    role: 'observer',
    readOnly: true,
    scope: '*',
    access: { v: 1, role: 'observer' },
  },
  // A token minted before roles existed (admin console) — the read_only bit decides.
  legacyMember: { label: 'l', readOnly: false, scope: '*' },
};
const verifyAs = (who) => (token) => (token === `tok-${who}` ? MATCHES[who] : null);

async function call({ who, method, path }) {
  const sent = [];
  const answered = await runHubRoutes({
    request: { headers: { authorization: `Bearer tok-${who}` } },
    response: {},
    method,
    path,
    verify: verifyAs(who),
    respondJson: (status, body) => sent.push({ status, body }),
  });
  return { answered, sent: sent[0] ?? null };
}

const savedPlan = process.env.MAUDE_PLAN_STATE;
afterEach(() => {
  if (savedPlan === undefined) delete process.env.MAUDE_PLAN_STATE;
  else process.env.MAUDE_PLAN_STATE = savedPlan;
});

describe('the refusal bodies', () => {
  test('owner: the contract sentence; anyone else: no billing words, no details', () => {
    assert.deepEqual(PLAN_OWNER_REFUSAL, {
      reason: 'plan',
      error: 'Choose a plan to keep editing.',
    });
    assert.equal(PLAN_PAUSED_REFUSAL.reason, 'plan');
    assert.doesNotMatch(PLAN_PAUSED_REFUSAL.error, /plan|trial|billing|card|pay/i);
    assert.deepEqual(Object.keys(PLAN_PAUSED_REFUSAL).sort(), ['error', 'reason']);
  });

  test('the switch is explicit: only MAUDE_PLAN_STATE=paused pauses', () => {
    assert.equal(planPausedFromEnv({}), false);
    assert.equal(planPausedFromEnv({ MAUDE_PLAN_STATE: '' }), false);
    assert.equal(planPausedFromEnv({ MAUDE_PLAN_STATE: 'trial' }), false);
    assert.equal(planPausedFromEnv({ MAUDE_PLAN_STATE: 'paused' }), true);
  });
});

describe('the gate while paused', () => {
  const WRITES = [
    ['PUT', '/api/file/assets/a.png'],
    ['DELETE', '/api/documents/ws%2Fx%2Fmain%2Fa'],
    ['PUT', '/api/project-config'],
    ['POST', '/api/projects/current/v1/proposals'],
    ['POST', '/_api/anything-new'],
  ];

  for (const [method, path] of WRITES) {
    test(`${method} ${path}: writers get 402, read-only roles keep today’s 403`, async () => {
      process.env.MAUDE_PLAN_STATE = 'paused';
      for (const who of ['owner', 'member', 'legacyMember']) {
        const { answered, sent } = await call({ who, method, path });
        assert.equal(answered, true, who);
        assert.equal(sent.status, 402, who);
        assert.deepEqual(sent.body, who === 'owner' ? PLAN_OWNER_REFUSAL : PLAN_PAUSED_REFUSAL);
      }
      assert.deepEqual((await call({ who: 'viewer', method, path })).sent, {
        status: 403,
        body: READ_ONLY_REFUSAL,
      });
      assert.deepEqual((await call({ who: 'observer', method, path })).sent, {
        status: 403,
        body: OBSERVER_REFUSAL,
      });
    });
  }

  test('reads, downloads and sign-out stay open for every role', async () => {
    process.env.MAUDE_PLAN_STATE = 'paused';
    for (const who of ['owner', 'member', 'viewer']) {
      for (const [method, path] of [
        ['GET', '/api/files'],
        ['GET', '/_project-file/assets/a.png'],
        ['GET', '/api/projects/current/v1/bootstrap'],
        ['POST', '/api/export'],
        ['POST', '/auth/logout'],
      ]) {
        const { sent } = await call({ who, method, path });
        assert.equal(sent, null, `${who} ${method} ${path} is not refused`);
      }
    }
  });

  test('not paused: the answer is today’s, byte for byte', async () => {
    delete process.env.MAUDE_PLAN_STATE;
    for (const who of ['owner', 'member']) {
      const { answered, sent } = await call({ who, method: 'PUT', path: '/api/file/a.png' });
      assert.equal(answered, false);
      assert.equal(sent, null);
    }
  });

  test('a caller may pass the plan explicitly (tests, a future pushed state)', () => {
    delete process.env.MAUDE_PLAN_STATE;
    const refusal = hubAccessRefusal({
      request: { headers: { authorization: 'Bearer tok-member' } },
      capability: 'comment',
      scope: 'project',
      verify: verifyAs('member'),
      plan: 'paused',
    });
    assert.deepEqual(refusal, { status: 402, body: PLAN_PAUSED_REFUSAL });
  });
});

// ------------------------------------------------- a live hub, a 1.9.1 write

describe('v1: a write to a paused cell is refused, and nothing is lost', () => {
  const dirs = [];
  let hub;
  let repoDir;
  const tokens = {};
  let savedEnv;

  before(async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-paused-data-'));
    repoDir = mkdtempSync(join(tmpdir(), 'maude-paused-repo-'));
    dirs.push(dataDir, repoDir);
    mkdirSync(join(repoDir, '.design', 'assets'), { recursive: true });
    writeFileSync(join(repoDir, '.design', 'assets', 'a.png'), Buffer.from([0x89, 0x50]));
    writeFileSync(
      join(repoDir, '.design', 'config.json'),
      JSON.stringify({ name: 'paused', canvasGroups: [{ label: 'UI', path: 'ui' }] })
    );
    savedEnv = {
      HUB_WORKSPACE_MODE: process.env.HUB_WORKSPACE_MODE,
      MAUDE_STUDIO_CHILD: process.env.MAUDE_STUDIO_CHILD,
      MAUDE_REPO_DIR: process.env.MAUDE_REPO_DIR,
    };
    process.env.HUB_WORKSPACE_MODE = '1';
    process.env.MAUDE_STUDIO_CHILD = '0';
    process.env.MAUDE_REPO_DIR = repoDir;
    tokens.owner = addToken(dataDir, {
      label: 'owner',
      scope: '*',
      role: 'owner',
      owner: 'o@x.test',
    }).value;
    tokens.member = addToken(dataDir, {
      label: 'member',
      scope: '*',
      role: 'member',
      owner: 'm@x.test',
    }).value;
    const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
    await built.server.listen();
    await built.acceptedReady;
    hub = { built, http: built.server.httpURL.replace('0.0.0.0', '127.0.0.1') };
  });

  after(async () => {
    for (const [k, v] of Object.entries(savedEnv ?? {})) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await hub?.built.stopJournal?.();
    await hub?.built.server.destroy();
    hub?.built.projectStore?.close?.();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const put = (token) =>
    fetch(`${hub.http}/api/file/assets/b.png`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

  test('paused: 402 plan, the file is not written, reads still answer', async () => {
    process.env.MAUDE_PLAN_STATE = 'paused';
    for (const who of ['owner', 'member']) {
      const res = await put(tokens[who]);
      assert.equal(res.status, 402, who);
      const body = await res.json();
      assert.equal(body.reason, 'plan');
      assert.equal(
        body.error,
        who === 'owner' ? 'Choose a plan to keep editing.' : PLAN_PAUSED_REFUSAL.error
      );
    }
    assert.equal(existsSync(join(repoDir, '.design', 'assets', 'b.png')), false, 'nothing on disk');
    const absent = await fetch(`${hub.http}/_project-file/assets/b.png`, {
      headers: { authorization: `Bearer ${tokens.member}` },
    });
    assert.equal(absent.status, 404, 'nothing half-written anywhere the hub serves from');
    const read = await fetch(`${hub.http}/_project-file/assets/a.png`, {
      headers: { authorization: `Bearer ${tokens.member}` },
    });
    assert.equal(read.status, 200);
  });

  test('a plan is chosen: the outbox’s retry of the same write lands', async () => {
    delete process.env.MAUDE_PLAN_STATE;
    const res = await put(tokens.member);
    assert.ok(res.status < 300, `retry status ${res.status}`);
    const landed = await fetch(`${hub.http}/_project-file/assets/b.png`, {
      headers: { authorization: `Bearer ${tokens.member}` },
    });
    assert.equal(landed.status, 200);
  });
});
