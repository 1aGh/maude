// V2-1.16 L3 × L2 — the ctl channel's DOCUMENT pokes reach a canvas-only
// connection only for its own canvas (S9.5 wiring of S9.4's poke visibility).
//
// `onAuthenticate` puts the claim on a ctl connection's context; `server.mjs`
// hands both pokes the visibility; an accepted action names its documents.
// A-only hears A's change and never B's; a project member hears both (U7).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import {
  A,
  B,
  docOf,
  http,
  proposal,
  rm,
  seedTokens,
  sleep,
  src,
  startHub,
  tmpDir,
  until,
} from './_acl-docs-fixture.mjs';

const V1 = '/api/projects/local/v1';
let dataDir;
let hub;
let t;
let epoch;
const listeners = [];

before(async () => {
  dataDir = tmpDir('maude-acl-l3-docs-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir);
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
});

after(async () => {
  for (const l of listeners) l.close();
  await hub?.close();
  rm(dataDir);
});

function listen(token) {
  const frames = [];
  const doc = new Y.Doc();
  let synced = false;
  const provider = new HocuspocusProvider({
    url: hub.ws,
    name: 'maude.files',
    token,
    document: doc,
    onSynced: () => {
      synced = true;
    },
    onStateless: ({ payload }) => frames.push(JSON.parse(payload)),
  });
  const l = {
    frames,
    ready: () => until(() => synced, 5000, 'ctl synced'),
    close: () => {
      provider.destroy();
      doc.destroy();
    },
  };
  listeners.push(l);
  return l;
}

async function editAs(canvas, text) {
  const owner = http(hub.http, t.owner);
  const row = (await owner.get(`${V1}/bootstrap`)).body.docs.find((d) => d.path === canvas);
  const r = await owner.post(
    `${V1}/proposals`,
    proposal(epoch, [
      {
        op: 'lane.replace',
        doc: docOf(canvas),
        lane: 'html',
        base: row.lanes.html.hash,
        content: src(text),
      },
    ])
  );
  assert.equal(r.body.status, 'accepted', JSON.stringify(r.body));
}

const docFrames = (l) => l.frames.filter((f) => f.documents === true);

describe('document pokes on the ctl channel', () => {
  test('A-only hears nothing for B and a frame for A; a member hears both', async () => {
    const petra = listen(t.aEdit);
    const max = listen(t.member);
    await petra.ready();
    await max.ready();
    // Let the creation's own store events (the SQLite debounce, ~2 s — they
    // name A as well as B) land, then start from silence.
    await sleep(3000);
    petra.frames.length = 0;
    max.frames.length = 0;

    await editAs(B, 'CANARY-B-SOURCE 2');
    await until(() => docFrames(max).length >= 1, 5000, 'member hears B');
    await sleep(300);
    assert.equal(docFrames(petra).length, 0, 'B never reaches the A-only connection');

    await editAs(A, 'alpha 2');
    await until(() => docFrames(petra).length >= 1, 5000, 'A-only hears A');
    assert.ok(docFrames(max).length >= 2, 'the member hears A too');
    // The payload stays one integer-shaped frame (V2-1.12): nothing names a canvas.
    for (const f of docFrames(petra))
      assert.deepEqual(Object.keys(f).sort(), ['documents', 'head', 't']);
  });
});
