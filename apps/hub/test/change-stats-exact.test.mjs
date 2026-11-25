// "Changes" is an exact number, not an estimate.
//
// ONE CHANGE = one accepted save of a canvas by a person: one committed action
// in the project store (accepted revisions), or — on a project that does not
// save through it — one debounced store of a synced document. Never one per
// keystroke, per peer the edit is relayed to, or per file the hub writes out.
//
// The same two edits once read as 1 and once as 3 in the cloud harness: the
// store count was cached for a minute whatever happened meanwhile, so the
// answer depended on WHEN it was first asked. A commit now invalidates it.

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { closeAudit } from '../src/audit-log.mjs';
import { laneHash } from '../src/project-transactions/lanes.mjs';
import { addToken } from '../src/tokens.mjs';
import {
  A,
  docOf,
  http,
  openDoc,
  proposal,
  rm,
  seedTokens,
  sleep,
  src,
  startHub,
  tmpDir,
  until,
} from './_acl-docs-fixture.mjs';

const dirs = [];
let hub = null;
after(async () => {
  await hub?.close();
  for (const d of dirs) {
    closeAudit(d);
    rm(d);
  }
});

const week = async () => {
  const res = await fetch(`${hub.http}/admin/api/overview`, {
    headers: { authorization: 'Bearer test-secret' },
  });
  const o = await res.json();
  return o.counts.changesThisWeek ?? null;
};
/** Longer than the hub's store debounce (2 s): whatever was going to be flushed has been. */
const settle = () => sleep(2600);

describe('live sync (no accepted revisions)', () => {
  test('N spaced edits are exactly N; M keystrokes in one flush are exactly 1; a relay to a second peer adds nothing', async () => {
    const dataDir = tmpDir('maude-changes-exact-sync-');
    dirs.push(dataDir);
    const token = (label, owner) =>
      addToken(dataDir, { label, scope: '*', role: 'member', owner }).value;
    hub = await startHub(dataDir, { rateLimit: false, env: {} });
    const a = await openDoc(hub.ws, token('a-mac', 'a@x.test'), 'ui-welcome', { keep: true });
    const b = await openDoc(hub.ws, token('b-mac', 'b@x.test'), 'ui-welcome', { keep: true });
    const text = (p) => p.doc.getText('body');

    const N = 3;
    for (let i = 1; i <= N; i++) {
      text(a).insert(0, `edit ${i};`);
      // The edit is relayed to B…
      await until(() => text(b).toString().includes(`edit ${i};`), 5000, `edit ${i} reaching B`);
      // …and once the hub has stored it, it is one change — not one per peer.
      await settle();
      assert.equal(await week(), i, `after ${i} spaced edit(s)`);
    }

    const M = 40;
    for (let i = 0; i < M; i++) text(b).insert(0, 'k');
    await until(() => text(a).toString().startsWith('k'.repeat(M)), 5000, 'the burst reaching A');
    await settle();
    assert.equal(await week(), N + 1, `${M} keystrokes inside one flush are one change`);

    // Nothing else moves it: a quiet flush window, a reader opening the canvas.
    const reader = await openDoc(hub.ws, token('c-mac', 'c@x.test'), 'ui-welcome', { keep: true });
    await settle();
    assert.equal(await week(), N + 1);
    for (const p of [a, b, reader]) p.close();
    await hub.close();
    hub = null;
  });
});

describe('accepted revisions (the project store)', () => {
  const V1 = '/api/projects/local/v1';

  test('one committed action is exactly one change, at once — relayed to peers and written out by the hub, still one', async () => {
    const dataDir = tmpDir('maude-changes-exact-accepted-');
    dirs.push(dataDir);
    const t = seedTokens(dataDir);
    hub = await startHub(dataDir, { rateLimit: false, env: {} });
    const owner = http(hub.http, t.owner);
    const member = http(hub.http, t.member);
    const switched = await owner.post(`${V1}/mode`, { mode: 'transactions', expectEpoch: 0 });
    assert.equal(switched.status, 200);
    const epoch = switched.body.epoch;
    assert.equal(await week(), 0, 'accepted revisions, nothing committed yet: a real zero');

    const made = await owner.post(
      `${V1}/proposals`,
      proposal(epoch, [{ op: 'doc.create', doc: docOf(A), path: A, lanes: { html: src('v0') } }])
    );
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal(
      await week(),
      1,
      'creating a canvas is one change — read straight after the commit'
    );

    // Two peers hold the document open: every accepted revision is relayed to both.
    const p1 = await openDoc(hub.ws, t.member, docOf(A), { keep: true });
    const p2 = await openDoc(hub.ws, t.viewer, docOf(A), { keep: true });

    const N = 3;
    let content = src('v0');
    for (let i = 1; i <= N; i++) {
      const next = src(`v${i}`);
      const r = await member.post(
        `${V1}/proposals`,
        proposal(epoch, [
          {
            op: 'lane.replace',
            doc: docOf(A),
            lane: 'html',
            base: laneHash(content),
            content: next,
          },
        ])
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      content = next;
      assert.equal(await week(), 1 + i, `exactly one more, immediately (edit ${i})`);
    }

    // A refused proposal (stale base) is not a change.
    const stale = await member.post(
      `${V1}/proposals`,
      proposal(epoch, [
        {
          op: 'lane.replace',
          doc: docOf(A),
          lane: 'html',
          base: laneHash(src('v0')),
          content: src('lost'),
        },
      ])
    );
    assert.notEqual(stale.body.status, 'accepted');
    // The hub wrote each revision into the shared documents and both peers got
    // it; none of that is a second change, however long we wait.
    await settle();
    assert.equal(await week(), 1 + N);
    p1.close();
    p2.close();

    // The store is the truth: after a restart the same number is read back.
    await hub.close();
    closeAudit(dataDir);
    hub = await startHub(dataDir, { rateLimit: false, env: {} });
    await until(
      async () => (await week()) === 1 + N,
      8000,
      'the count being read back from the store'
    );
  });
});
