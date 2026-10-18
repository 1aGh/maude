// S9.13 — picks never ride presence (contract S4-S9-votes-comments.md §2.6
// "Awareness"). No vote client publishes them; the hub's `beforeHandleAwareness`
// drops the keys `ballot`, `picks` and `vote` from EVERY client state anyway
// (defence in depth), whoever sent them.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { stripVoteAwareness, VOTE_AWARENESS_KEYS } from '../src/routes-v2/votes.mjs';
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

describe('stripVoteAwareness (unit)', () => {
  test('drops ballot / picks / vote, keeps everything else', () => {
    const states = new Map([
      [1, { user: { name: 'Olga' }, ballot: { x: 1 }, picks: { 'ab:a': 3 }, vote: 'vote-1' }],
      [2, { user: { name: 'Max' }, cursor: { x: 1, y: 2 } }],
      [3, null],
    ]);
    assert.equal(stripVoteAwareness({ states }), 1);
    assert.deepEqual(states.get(1), { user: { name: 'Olga' } });
    assert.deepEqual(states.get(2), { user: { name: 'Max' }, cursor: { x: 1, y: 2 } });
    assert.deepEqual([...VOTE_AWARENESS_KEYS], ['ballot', 'picks', 'vote']);
  });
  test('tolerates no states', () => {
    assert.equal(stripVoteAwareness({ states: null }), 0);
  });
});

describe('through the hub', () => {
  let dataDir;
  let hub;
  let t;
  before(async () => {
    dataDir = tmpDir('maude-votes-aw-');
    t = seedTokens(dataDir);
    hub = await startHub(dataDir, { rateLimit: false });
  });
  after(async () => {
    await hub?.close();
    rm(dataDir);
  });

  test('another person on the canvas never receives the keys', async () => {
    const sender = await openDoc(hub.ws, t.member, docOf(A), { keep: true });
    const watcher = await openDoc(hub.ws, t.owner, docOf(A), { keep: true });
    const others = () =>
      [...watcher.provider.awareness.getStates().entries()]
        .filter(([id]) => id !== watcher.provider.awareness.clientID)
        .map(([, s]) => s);
    sender.provider.setAwarenessField('picks', { 'ab:canary-zq': 3 });
    sender.provider.setAwarenessField('ballot', { 'ab:canary-zq': 3 });
    sender.provider.setAwarenessField('vote', {
      id: 'vote-aaaaaaaaaa',
      mine: { 'ab:canary-zq': 3 },
    });
    sender.provider.setAwarenessField('user', { name: 'Max' });
    await until(() => others().some((s) => s.user?.name === 'Max'), 5000, 'presence');
    await sleep(200);
    const text = JSON.stringify(others());
    assert.equal(text.includes('canary-zq'), false, text);
    for (const s of others()) for (const k of VOTE_AWARENESS_KEYS) assert.equal(k in s, false, k);
  });
});
