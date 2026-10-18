// V2-1.16 L4 — the accepted-revisions routes and the kernel (DDR-241, S9.5).
//
// A-only: bootstrap, revisions and history contain no B doc, path, hash or
// label; `lane?doc=B` and `blobs/<B hash>` give the same 403 as a random one;
// a proposal touching B, a `dir.move`, and a `doc.create` at B's path all get
// a FINAL `not-in-scope` (never `path-conflict`). Project roles: unchanged.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { laneHash } from '../src/project-transactions/lanes.mjs';
import {
  A,
  B,
  CANARY,
  docOf,
  http,
  NOPE,
  proposal,
  rm,
  seedTokens,
  src,
  startHub,
  tmpDir,
} from './_acl-docs-fixture.mjs';

const V1 = '/api/projects/local/v1';
const NIS = { error: 'not-in-scope', reason: 'not-in-scope' };

let dataDir;
let hub;
let t;
let epoch;
let bHash;

before(async () => {
  dataDir = tmpDir('maude-acl-l4-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir);
  const owner = http(hub.http, t.owner);
  const switched = await owner.post(`${V1}/mode`, { mode: 'transactions', expectEpoch: 0 });
  assert.equal(switched.status, 200);
  epoch = switched.body.epoch;
  const made = await owner.post(
    `${V1}/proposals`,
    proposal(
      epoch,
      [
        { op: 'doc.create', doc: docOf(A), path: A, lanes: { html: src('alpha') } },
        { op: 'doc.create', doc: docOf(B), path: B, lanes: { html: src('CANARY-B-SOURCE') } },
      ],
      { label: 'design: update canary-b-zx and Alpha' }
    )
  );
  assert.equal(made.status, 200, JSON.stringify(made.body));
  bHash = laneHash(src('CANARY-B-SOURCE'));
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

describe('L4 — reads', () => {
  test('bootstrap as A-only: A only, no canvas groups, nothing naming B', async () => {
    const r = await http(hub.http, t.aEdit).get(`${V1}/bootstrap`);
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.docs.map((d) => d.path),
      [A]
    );
    assert.deepEqual(r.body.canvasGroups, []);
    assert.doesNotMatch(r.text, CANARY);
    assert.equal(r.text.includes(bHash), false, 'no B lane hash');
    assert.equal(r.body.you.readOnly, false, 'an edit grant proposes');
  });

  test('bootstrap for owner / member / viewer is unchanged (U7)', async () => {
    for (const role of ['owner', 'member', 'viewer']) {
      const r = await http(hub.http, t[role]).get(`${V1}/bootstrap`);
      assert.equal(r.status, 200, role);
      assert.deepEqual(r.body.docs.map((d) => d.path).sort(), [A, B].sort(), role);
    }
  });

  test('revisions and history as A-only: effects on A only, the label rewritten (U4)', async () => {
    for (const path of [`${V1}/revisions?after=0`, `${V1}/history`]) {
      const r = await http(hub.http, t.aEdit).get(path);
      assert.equal(r.status, 200, path);
      assert.doesNotMatch(r.text, CANARY, path);
      assert.equal(r.text.includes(bHash), false, path);
      const rows = r.body.revisions ?? r.body.history;
      const created = rows.find((a) => a.effects.some((e) => e.doc === docOf(A)));
      assert.equal(created.label, 'Changed Alpha', path);
      assert.equal(created.actor.includes('@'), false, 'a name, never an address');
    }
    // The owner still reads the full label.
    const full = await http(hub.http, t.owner).get(`${V1}/history`);
    assert.match(full.text, /canary-b-zx and Alpha/);
  });

  test('lane?doc=B and blobs/<B hash> answer exactly as unknown ones', async () => {
    const c = http(hub.http, t.aEdit);
    const laneB = await c.get(`${V1}/lane?doc=${encodeURIComponent(docOf(B))}&lane=html&rev=9`);
    const laneNope = await c.get(
      `${V1}/lane?doc=${encodeURIComponent(docOf(NOPE))}&lane=html&rev=9`
    );
    assert.equal(laneB.status, 403);
    assert.deepEqual(laneB.body, NIS);
    assert.deepEqual([laneNope.status, laneNope.body], [laneB.status, laneB.body]);
    const random = createHash('sha256').update('nothing').digest('hex');
    const blobB = await c.get(`${V1}/blobs/${bHash}`);
    const blobRandom = await c.get(`${V1}/blobs/${random}`);
    assert.equal(blobB.status, 403);
    assert.deepEqual([blobRandom.status, blobRandom.text], [blobB.status, blobB.text]);
    assert.doesNotMatch(blobB.text, CANARY);
    // A's own lane and blob are served.
    const aHash = laneHash(src('alpha'));
    assert.equal((await c.get(`${V1}/blobs/${aHash}`)).status, 200);
    const laneA = await c.get(`${V1}/lane?doc=${encodeURIComponent(docOf(A))}&lane=html&rev=9`);
    assert.equal(laneA.status, 200);
    // The owner still gets B (U7).
    assert.equal((await http(hub.http, t.owner).get(`${V1}/blobs/${bHash}`)).status, 200);
  });

  test('mode and parity stay project-level: a canvas-only session is refused at the gate', async () => {
    for (const path of [`${V1}/mode`, `${V1}/parity`]) {
      const r = await http(hub.http, t.aEdit).get(path);
      assert.deepEqual([r.status, r.body], [403, NIS], path);
    }
  });
});

describe('L4 — the kernel judges every op', () => {
  const propose = (who, ops) =>
    http(hub.http, t[who]).post(`${V1}/proposals`, proposal(epoch, ops));
  const head = async (canvas) => {
    const r = await http(hub.http, t.owner).get(`${V1}/bootstrap`);
    return r.body.docs.find((d) => d.path === canvas).lanes.html.hash;
  };

  test('a lane write to B is a final not-in-scope, identical to a write to a missing doc', async () => {
    const base = await head(B);
    const toB = await propose('aEdit', [
      { op: 'lane.replace', doc: docOf(B), lane: 'html', base, content: src('x') },
    ]);
    const toNope = await propose('aEdit', [
      { op: 'lane.replace', doc: docOf(NOPE), lane: 'html', base, content: src('x') },
    ]);
    assert.equal(toB.status, 403);
    assert.equal(toB.body.status, 'rejected');
    assert.equal(toB.body.code, 'not-in-scope');
    assert.equal(toNope.body.code, toB.body.code);
    assert.doesNotMatch(toB.text, CANARY);
    // Nothing named B, no path, no generation (no existence oracle).
    assert.equal(toB.body.doc, undefined);
    assert.equal(toB.body.generation, undefined);
  });

  test('structure is refused: doc.create at B’s path, doc.move, dir.move, a project restore', async () => {
    for (const ops of [
      [{ op: 'doc.create', doc: docOf(B), path: B, lanes: { html: src('y') } }],
      [{ op: 'doc.create', doc: 'ws/local/main/new', path: 'ui/new.tsx', lanes: {} }],
      [{ op: 'doc.move', doc: docOf(A), path: 'ui/Moved.tsx' }],
      [{ op: 'dir.move', path: 'ui', to: 'other' }],
      [{ op: 'history.restore', revision: 1 }],
      [{ op: 'history.restore', revision: 1, docs: [docOf(B)] }],
    ]) {
      const r = await propose('aEdit', ops);
      assert.equal(r.body.code, 'not-in-scope', JSON.stringify(ops));
      assert.notEqual(r.body.code, 'path-conflict');
    }
  });

  test('an edit grant writes A; a comment grant is forbidden there', async () => {
    const base = await head(A);
    const comment = await propose('aComment', [
      { op: 'lane.replace', doc: docOf(A), lane: 'html', base, content: src('c') },
    ]);
    // The gate answers first, with today's viewer sentence (no grant edits).
    assert.equal(comment.status, 403);
    assert.equal(comment.body.reason, 'read-only');
    const edit = await propose('aEdit', [
      { op: 'lane.replace', doc: docOf(A), lane: 'html', base, content: src('alpha 2') },
    ]);
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.status, 'accepted');
  });

  test('owner and member keep today’s answers (U7)', async () => {
    const base = await head(B);
    const member = await propose('member', [
      { op: 'lane.replace', doc: docOf(B), lane: 'html', base, content: src('CANARY-B-SOURCE 2') },
    ]);
    assert.equal(member.body.status, 'accepted');
    const conflict = await propose('owner', [
      { op: 'doc.create', doc: docOf(B), path: B, lanes: { html: src('d') } },
    ]);
    assert.equal(conflict.body.code, 'path-conflict', 'the oracle-free answer is canvas-only only');
  });
});
