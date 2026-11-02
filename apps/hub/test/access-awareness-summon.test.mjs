// V2-1.7 §5.5 — `summon` (Bring everyone here, C33) on the peer door (S9.5).
//
// `beforeHandleAwareness` strips a `summon` field from any connection lacking
// the `summon` capability on that document: a viewer's (Can comment) or a
// comment-grant's field never reaches a peer; an editor's does. Every other
// field passes untouched (v1 peers render what they know).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { stripSummon } from '../src/access-docs.mjs';
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
  dataDir = tmpDir('maude-acl-summon-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir);
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

const stateOf = (provider, name) =>
  [...provider.awareness.getStates().values()].find((s) => s?.user?.name === name);

async function summonFrom(role, name) {
  const sender = await openDoc(hub.ws, t[role], docOf(A), { keep: true });
  const watcher = await openDoc(hub.ws, t.owner, docOf(A), { keep: true });
  try {
    sender.provider.setAwarenessField('user', { name });
    sender.provider.setAwarenessField('summon', { id: `s-${name}`, at: Date.now() });
    await until(() => stateOf(watcher.provider, name), 5000, `${name}'s presence`);
    await sleep(200);
    return stateOf(watcher.provider, name);
  } finally {
    sender.close();
    watcher.close();
  }
}

describe('summon is stripped from connections lacking it', () => {
  test('a member’s and an edit grant’s summon reach peers', async () => {
    assert.ok((await summonFrom('member', 'Max')).summon, 'member');
    assert.ok((await summonFrom('aEdit', 'Petra')).summon, 'edit grant');
  });

  test('a viewer’s and a comment grant’s summon never reach a peer; the rest does', async () => {
    for (const [role, name] of [
      ['viewer', 'Vera'],
      ['aComment', 'Cyril'],
    ]) {
      const s = await summonFrom(role, name);
      assert.equal(s.summon, undefined, `${role}: summon stripped`);
      assert.deepEqual(s.user, { name }, `${role}: other fields pass`);
    }
  });
});

describe('stripSummon (unit)', () => {
  const states = () => new Map([[1, { user: { name: 'x' }, summon: { id: 'a', at: 1 } }]]);
  test('keeps the field for a holder, the dev hub and server-internal updates', () => {
    for (const context of [
      { user: { summon: true } },
      { user: { name: 'anon', anon: true } },
      undefined,
    ]) {
      const s = states();
      stripSummon({ states: s, context });
      assert.ok(s.get(1).summon, JSON.stringify(context));
    }
  });
  test('drops it for a non-holder and for a read-only context with no decision', () => {
    for (const context of [{ user: { summon: false } }, { user: { readOnly: true } }]) {
      const s = states();
      stripSummon({ states: s, context });
      assert.equal(s.get(1).summon, undefined, JSON.stringify(context));
      assert.deepEqual(s.get(1).user, { name: 'x' });
    }
  });
});
