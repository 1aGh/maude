// S1.7 — the shared Trash on a real hub (S1-trash.md §5, S1-canvas-row-slots §4, V2-1.16 L18).
//
//   - the proposals route passes the per-op gate: `trash.clear` (`delete`) is the project
//     owner's — a member's is `forbidden`, the owner's commits;
//   - the hub door `POST /api/trash/clear` refuses a member (403) and every canvas-only
//     session (403 not-in-scope), and clears for the owner;
//   - `GET v1/trash` lists the records, cut to a canvas-only session's canvases;
//   - bootstrap advertises the four S1.6 ops, so a v2 studio can spot an older hub.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  A,
  B,
  closeAll,
  docOf,
  http,
  proposal,
  rm,
  seedTokens,
  src,
  startHub,
  tmpDir,
} from './_acl-docs-fixture.mjs';

describe('the shared Trash on the hub', () => {
  let dataDir;
  let hub;
  let t;
  let epoch = 0;
  const V1 = '/api/projects/local/v1';
  const as = (token) => http(hub.http, token);
  const propose = (token, operations, label = 'edit') =>
    as(token).post(`${V1}/proposals`, proposal(epoch, operations, { label }));

  before(async () => {
    dataDir = tmpDir('maude-trash-door-');
    t = seedTokens(dataDir);
    hub = await startHub(dataDir);
    const m = await as(t.owner).post(`${V1}/mode`, { mode: 'transactions' });
    assert.equal(m.status, 200, m.text);
    epoch = m.body.epoch;
    for (const [canvas, text] of [
      [A, 'alpha'],
      [B, 'canary-b'],
    ]) {
      const r = await propose(t.owner, [
        { op: 'doc.create', doc: docOf(canvas), path: canvas, lanes: { html: src(text) } },
      ]);
      assert.equal(r.status, 200, r.text);
    }
    const boot = (await as(t.owner).get(`${V1}/bootstrap`)).body;
    for (const canvas of [A, B]) {
      const d = boot.docs.find((x) => x.path === canvas);
      const r = await propose(t.owner, [
        { op: 'doc.delete', doc: d.doc, generation: d.generation },
      ]);
      assert.equal(r.status, 200, r.text);
    }
  });
  after(async () => {
    closeAll();
    await hub?.close();
    rm(dataDir);
  });

  test('bootstrap advertises the S1.6 ops', async () => {
    const boot = (await as(t.member).get(`${V1}/bootstrap`)).body;
    for (const op of ['history.name', 'history.aside', 'trash.restore', 'trash.clear'])
      assert.ok(boot.capabilities.operations.includes(op), op);
  });

  test('GET v1/trash: a member sees both; A-only sees A and never B', async () => {
    const all = await as(t.member).get(`${V1}/trash`);
    assert.equal(all.status, 200, all.text);
    assert.deepEqual(all.body.canvases.map((c) => c.path).sort(), [A, B].sort());
    const aOnly = await as(t.aEdit).get(`${V1}/trash`);
    assert.equal(aOnly.status, 200, aOnly.text);
    assert.deepEqual(
      aOnly.body.canvases.map((c) => c.path),
      [A]
    );
    assert.doesNotMatch(aOnly.text, /canary-b/i);
  });

  test('a member’s clear-out is refused on both doors; a canvas-only session’s is not-in-scope', async () => {
    const viaProposal = await propose(t.member, [{ op: 'trash.clear' }]);
    assert.equal(viaProposal.status, 403, viaProposal.text);
    assert.equal(viaProposal.body.code, 'forbidden');
    const door = await as(t.member).post('/api/trash/clear', {});
    assert.equal(door.status, 403, door.text);
    const scoped = await as(t.aEdit).post('/api/trash/clear', {});
    assert.equal(scoped.status, 403, scoped.text);
    assert.equal(scoped.body.reason, 'not-in-scope'); // the gate's U1 refusal, before the handler
    // nothing was cleared
    assert.equal((await as(t.member).get(`${V1}/trash`)).body.canvases.length, 2);
  });

  test('the owner clears out: one item through a proposal, the rest through the door', async () => {
    const listed = (await as(t.owner).get(`${V1}/trash`)).body.canvases;
    const a = listed.find((c) => c.path === A);
    const one = await propose(t.owner, [{ op: 'trash.clear', items: [a.id] }]);
    assert.equal(one.status, 200, one.text);
    assert.deepEqual(one.body.cleared, [a.id]);
    const rest = await as(t.owner).post('/api/trash/clear', {});
    assert.equal(rest.status, 200, rest.text);
    assert.equal(rest.body.cleared.length, 1);
    assert.deepEqual((await as(t.owner).get(`${V1}/trash`)).body.canvases, []);
    // a cleared item stays gone
    const back = await propose(t.owner, [{ op: 'trash.restore', entry: a.entry }]);
    assert.equal(back.body.code, 'cleared', back.text);
  });
});
