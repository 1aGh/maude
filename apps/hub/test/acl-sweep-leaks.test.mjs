// The leaks the repaired canary sweep found (V2-5 sweep-fix), one focused test
// each, so a regression names its door instead of a 100-row sweep diff.
//
// 1. `history.undo` / `history.redo` of someone else's action told a
//    canvas-only session the action EXISTS (403 `forbidden`, "undo targets your
//    own actions") where an unknown id answers 409 `dependency-missing` — an
//    existence oracle over action ids on canvases the session cannot see (U1).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { laneHash } from '../src/project-transactions/lanes.mjs';
import {
  A,
  B,
  docOf,
  http,
  proposal,
  rm,
  seedTokens,
  src,
  startHub,
  tmpDir,
} from './_acl-docs-fixture.mjs';

const V1 = '/api/projects/local/v1';

let dataDir;
let hub;
let t;
let epoch;
let bAction;

before(async () => {
  dataDir = tmpDir('maude-acl-sweep-leaks-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir, { rateLimit: false });
  const owner = http(hub.http, t.owner);
  epoch = (await owner.post(`${V1}/mode`, { mode: 'transactions', expectEpoch: 0 })).body.epoch;
  const made = await owner.post(
    `${V1}/proposals`,
    proposal(epoch, [
      { op: 'doc.create', doc: docOf(A), path: A, lanes: { html: src('alpha') } },
      { op: 'doc.create', doc: docOf(B), path: B, lanes: { html: src('CANARY-B-SOURCE') } },
    ])
  );
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const bOnly = await owner.post(
    `${V1}/proposals`,
    proposal(epoch, [
      {
        op: 'lane.replace',
        doc: docOf(B),
        lane: 'html',
        base: laneHash(src('CANARY-B-SOURCE')),
        content: src('CANARY-B-SOURCE two'),
      },
    ])
  );
  assert.equal(bOnly.status, 200, JSON.stringify(bOnly.body));
  bAction = bOnly.body.actionId;
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

/** The answer with its per-request fields zeroed. */
const shape = (r) => ({
  status: r.status,
  body: { ...r.body, transactionId: 0, proposalHash: 0 },
});

describe('undo / redo of an action on an invisible canvas (U1)', () => {
  for (const op of ['history.undo', 'history.redo']) {
    for (const form of ['actionId', 'actionIds']) {
      test(`${op} { ${form} }: B's action answers exactly as an unknown one`, async () => {
        const aEdit = http(hub.http, t.aEdit);
        const target = (id) => (form === 'actionId' ? { actionId: id } : { actionIds: [id] });
        const missing = bAction.replace(/[0-9a-f]/g, (c) => (c === '0' ? '1' : '0'));
        const onB = await aEdit.post(
          `${V1}/proposals`,
          proposal(epoch, [{ op, ...target(bAction) }])
        );
        const onNothing = await aEdit.post(
          `${V1}/proposals`,
          proposal(epoch, [{ op, ...target(missing) }])
        );
        assert.deepEqual(shape(onB), shape(onNothing));
        assert.equal(onB.body.code, 'dependency-missing');
      });
    }
  }

  test('a project session still hears "your own actions" (v1 unchanged)', async () => {
    const member = http(hub.http, t.member);
    const r = await member.post(
      `${V1}/proposals`,
      proposal(epoch, [{ op: 'history.undo', actionId: bAction }])
    );
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'forbidden');
  });
});
