// S3.7b — the hub's relay strip for Present (S3-present-session §2, D11).
//
// `beforeHandleAwareness` drops `present` (and the presenter's `pointer`) from
// any connection without `edit` on that document — a forged `present` from a
// read-only session never reaches a follower. `watching` is never stripped:
// any role may watch. Every other field passes untouched.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { stripPresent } from '../src/present-strip.mjs';
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
  dataDir = tmpDir('maude-present-strip-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir);
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

const PRESENT = {
  v: 1,
  sid: 'abcdefgh12',
  index: 2,
  total: 14,
  artboardId: 'slide-3',
  seq: 7,
  media: null,
};
const POINTER = { x: 10, y: 20, artboardId: 'slide-3' };

const stateOf = (provider, name) =>
  [...provider.awareness.getStates().values()].find((s) => s?.user?.name === name);

async function publishFrom(role, name) {
  const sender = await openDoc(hub.ws, t[role], docOf(A), { keep: true });
  const watcher = await openDoc(hub.ws, t.owner, docOf(A), { keep: true });
  try {
    sender.provider.setAwarenessField('user', { name });
    sender.provider.setAwarenessField('present', PRESENT);
    sender.provider.setAwarenessField('pointer', POINTER);
    sender.provider.setAwarenessField('watching', 'zzzzzzzz99');
    await until(() => stateOf(watcher.provider, name), 5000, `${name}'s presence`);
    await sleep(200);
    return stateOf(watcher.provider, name);
  } finally {
    sender.close();
    watcher.close();
  }
}

describe('present is stripped from connections without edit', () => {
  test('a member’s and an edit grant’s present + pointer reach followers', async () => {
    for (const [role, name] of [
      ['member', 'Max'],
      ['aEdit', 'Petra'],
    ]) {
      const s = await publishFrom(role, name);
      assert.deepEqual(s.present, PRESENT, `${role}: present`);
      assert.deepEqual(s.pointer, POINTER, `${role}: pointer`);
      assert.equal(s.watching, 'zzzzzzzz99', `${role}: watching`);
    }
  });

  test('a read-only session’s forged present never reaches a follower; watching does', async () => {
    for (const [role, name] of [
      ['viewer', 'Vera'],
      ['aComment', 'Cyril'],
    ]) {
      const s = await publishFrom(role, name);
      assert.equal(s.present, undefined, `${role}: present stripped`);
      assert.equal(s.pointer, undefined, `${role}: pointer stripped`);
      assert.equal(s.watching, 'zzzzzzzz99', `${role}: watching kept`);
      assert.deepEqual(s.user, { name }, `${role}: other fields pass`);
    }
  });
});

describe('stripPresent (unit)', () => {
  const states = () =>
    new Map([
      [1, { user: { name: 'x' }, present: PRESENT, pointer: POINTER, watching: 'abcdefgh' }],
    ]);
  test('keeps both fields for an editor, the dev hub and server-internal updates', () => {
    for (const context of [
      { user: { readOnly: false } },
      { user: { name: 'anon', anon: true } },
      undefined,
    ]) {
      const s = states();
      assert.equal(stripPresent({ states: s, context }), 0);
      assert.ok(s.get(1).present && s.get(1).pointer, JSON.stringify(context));
    }
  });
  test('drops them for a read-only connection and keeps watching', () => {
    const s = states();
    assert.equal(stripPresent({ states: s, context: { user: { readOnly: true } } }), 1);
    assert.deepEqual(s.get(1), { user: { name: 'x' }, watching: 'abcdefgh' });
  });
});
