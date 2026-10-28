// V2-8.9 round B L1 — the presence role word ("· Owner") is stamped by the hub from the connection's
// own access in `beforeHandleAwareness`, next to `stripSummon`. A Can comment person connected straight to
// the hub cannot publish `role: "owner"`; a relaying studio's lower per-person roles pass; every state
// leaves marked `roleBy: 'hub'` so a studio can drop a role no hub vouched for.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { stampHubRole } from '../src/access-docs.mjs';
import {
  A,
  docOf,
  openDoc,
  rm,
  seedTokens,
  sleep,
  startHub,
  tmpDir,
  until,
} from './_acl-docs-fixture.mjs';

let dataDir;
let hub;
let t;

before(async () => {
  dataDir = tmpDir('maude-acl-role-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir);
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

const stateOf = (provider, name) =>
  [...provider.awareness.getStates().values()].find((s) => s?.user?.name === name);

async function roleFrom(role, name, sent) {
  const sender = await openDoc(hub.ws, t[role], docOf(A), { keep: true });
  const watcher = await openDoc(hub.ws, t.owner, docOf(A), { keep: true });
  try {
    sender.provider.setAwarenessField('user', { name });
    if (sent) sender.provider.setAwarenessField('role', sent);
    await until(() => stateOf(watcher.provider, name), 5000, `${name}'s presence`);
    await sleep(200);
    return stateOf(watcher.provider, name);
  } finally {
    sender.close();
    watcher.close();
  }
}

describe('the presence role is the hub’s', () => {
  test('a Can comment person who says "owner" is shown as what they hold', async () => {
    const s = await roleFrom('viewer', 'Vera', 'owner');
    assert.equal(s.role, 'viewer');
    assert.equal(s.roleBy, 'hub');
    assert.deepEqual(s.user, { name: 'Vera' });
  });

  test('a comment grant on this canvas is stamped with its grant', async () => {
    const s = await roleFrom('aComment', 'Cyril', 'owner');
    assert.equal(s.role, 'viewer');
  });

  test('a member who sends no role gets theirs', async () => {
    const s = await roleFrom('member', 'Max');
    assert.equal(s.role, 'member');
    assert.equal(s.roleBy, 'hub');
  });
});

describe('stampHubRole (unit)', () => {
  const claim = (role) => ({ v: 1, role });
  test('higher → clamped, lower kept (a relaying room), absent → stamped', () => {
    const states = new Map([
      [1, { role: 'owner' }],
      [2, { role: 'observer' }],
      [3, {}],
    ]);
    stampHubRole({ states, context: { user: { access: claim('member'), canvas: null } } });
    assert.deepEqual(
      [...states.values()].map((s) => [s.role, s.roleBy]),
      [
        ['member', 'hub'],
        ['observer', 'hub'],
        ['member', 'hub'],
      ]
    );
  });
  test('no access decision → no role at all; server-internal updates untouched', () => {
    const states = new Map([[1, { role: 'owner', roleBy: 'hub' }]]);
    stampHubRole({ states, context: { user: { name: 'anon', anon: true } } });
    assert.deepEqual(states.get(1), {});
    const internal = new Map([[1, { role: 'owner' }]]);
    stampHubRole({ states: internal, context: undefined });
    assert.deepEqual(internal.get(1), { role: 'owner' });
  });
});
