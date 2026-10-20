// S7.17 — the hub's relay strip for working on one video together (07 · ve-together).
//
// Two awareness fields ride the hub: `timeline` (where a person's playhead is) and `editing` (the caption
// word they are fixing — a soft lock everyone else's UI honours). A connection without `edit` on the
// document may play the video (its `timeline` passes) but cannot fix a caption, so its `editing` is dropped
// in `beforeHandleAwareness` before any other peer hears it: a viewer cannot lock members out of a word.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { EDITOR_ONLY_FIELDS, stripPresent } from '../src/present-strip.mjs';
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
  dataDir = tmpDir('maude-timeline-strip-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir);
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

const TIMELINE = { artboardId: 'nabor-16x9', frame: 222 };
const WORD = {
  since: Date.now(),
  kind: 'caption-word',
  artboardId: 'nabor-16x9',
  wordKey: 'assets/huddle.mp4|w12|clip-3',
};

const stateOf = (provider, name) =>
  [...provider.awareness.getStates().values()].find((s) => s?.user?.name === name);

async function publishFrom(role, name) {
  const sender = await openDoc(hub.ws, t[role], docOf(A), { keep: true });
  const watcher = await openDoc(hub.ws, t.owner, docOf(A), { keep: true });
  try {
    sender.provider.setAwarenessField('user', { name });
    sender.provider.setAwarenessField('timeline', TIMELINE);
    sender.provider.setAwarenessField('editing', WORD);
    await until(() => stateOf(watcher.provider, name), 5000, `${name}'s presence`);
    await sleep(200);
    return stateOf(watcher.provider, name);
  } finally {
    sender.close();
    watcher.close();
  }
}

describe('the caption word lock needs edit; the playhead does not', () => {
  test('a member’s and an edit grant’s playhead + word reach the others', async () => {
    for (const [role, name] of [
      ['member', 'Tereza'],
      ['aEdit', 'Petra'],
    ]) {
      const s = await publishFrom(role, name);
      assert.deepEqual(s.timeline, TIMELINE, `${role}: timeline`);
      assert.deepEqual(s.editing, WORD, `${role}: editing`);
    }
  });

  test('a read-only session’s word claim never reaches anyone; its playhead does', async () => {
    for (const [role, name] of [
      ['viewer', 'Vera'],
      ['aComment', 'Cyril'],
    ]) {
      const s = await publishFrom(role, name);
      assert.equal(s.editing, undefined, `${role}: editing stripped`);
      assert.deepEqual(s.timeline, TIMELINE, `${role}: timeline kept`);
      assert.deepEqual(s.user, { name }, `${role}: other fields pass`);
    }
  });
});

describe('stripPresent covers editing (unit)', () => {
  test('editing is an editor-only field', () => {
    assert.deepEqual([...EDITOR_ONLY_FIELDS], ['editing']);
  });
  test('kept for an editor, dropped for a read-only connection with the playhead left alone', () => {
    const states = () => new Map([[1, { user: { name: 'x' }, timeline: TIMELINE, editing: WORD }]]);
    const kept = states();
    assert.equal(stripPresent({ states: kept, context: { user: { readOnly: false } } }), 0);
    assert.deepEqual(kept.get(1).editing, WORD);
    const ro = states();
    assert.equal(stripPresent({ states: ro, context: { user: { readOnly: true } } }), 1);
    assert.deepEqual(ro.get(1), { user: { name: 'x' }, timeline: TIMELINE });
  });
});
