// V2-1.16 L11 — presence on the peer door (S9.5, hub half).
//
// Awareness is per document, and L2 decides who opens which document — so a
// person present on B never reaches an A-only connection, even while that
// person is also present on A under another document. The ctl channel
// (`maude.files`) still carries no presence at all.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  A,
  B,
  CANARY,
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
  dataDir = tmpDir('maude-acl-l11-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir);
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

const others = (provider) =>
  [...provider.awareness.getStates().entries()]
    .filter(([id]) => id !== provider.awareness.clientID)
    .map(([, s]) => s);

describe('L11 — awareness never crosses canvases', () => {
  test('a member on B is invisible to an A-only session; a member on A is visible', async () => {
    const onB = await openDoc(hub.ws, t.member, docOf(B), { keep: true });
    const onA = await openDoc(hub.ws, t.owner, docOf(A), { keep: true });
    const petra = await openDoc(hub.ws, t.aEdit, docOf(A), { keep: true });
    try {
      onB.provider.setAwarenessField('user', { name: 'Bea canary-b', canvas: B });
      onA.provider.setAwarenessField('user', { name: 'Olga', canvas: A });
      await until(
        () => others(petra.provider).some((s) => s.user?.name === 'Olga'),
        5000,
        'A peer'
      );
      // Give B's state every chance to arrive.
      await sleep(300);
      const seen = JSON.stringify(others(petra.provider));
      assert.doesNotMatch(seen, CANARY);
      assert.doesNotMatch(seen, /Bea/);
    } finally {
      onB.close();
      onA.close();
      petra.close();
    }
  });

  test('an A-only session cannot even join B’s room', async () => {
    const r = await openDoc(hub.ws, t.aEdit, docOf(B));
    assert.notEqual(r.status, 'synced');
  });
});
