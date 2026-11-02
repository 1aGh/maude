// S9.13 — the votes poke is scoped (contract S4-S9-votes-comments.md §2.6
// "Pokes", V2-1.16 L3): `{t:'votes', seq}` on `maude.files` reaches every
// project session, and a canvas-only connection only when the vote's canvas is
// one of its grants. An A-only socket hears NOTHING for a vote on B — not even
// that something happened.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { createPokeVisibility } from '../src/access-files.mjs';
import { FILES_CTL_DOC } from '../src/files-ctl.mjs';
import { createVotesPoke } from '../src/routes-v2/votes.mjs';
import {
  A,
  B,
  http,
  rm,
  seedTokens,
  sleep,
  startHub,
  tmpDir,
  until,
} from './_acl-docs-fixture.mjs';

const V = '/api/projects/local/v1/votes';
const TARGETS = ['ab:dir-a', 'ab:dir-b'];

let dataDir;
let hub;
let t;
const closers = [];

function ctl(token) {
  const heard = [];
  const doc = new Y.Doc();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ctl did not sync')), 5000);
    const provider = new HocuspocusProvider({
      url: hub.ws,
      name: FILES_CTL_DOC,
      token,
      document: doc,
      onStateless: ({ payload }) => {
        if (payload.includes('"votes"')) heard.push(JSON.parse(payload));
      },
      onSynced: () => {
        clearTimeout(timer);
        resolve(heard);
      },
    });
    closers.push(() => {
      provider.destroy();
      doc.destroy();
    });
  });
}

before(async () => {
  dataDir = tmpDir('maude-votes-poke-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir, { rateLimit: false });
});

after(async () => {
  for (const close of closers) close();
  await hub?.close();
  rm(dataDir);
});

describe('votesVisible (access-files, additive)', () => {
  const visibility = createPokeVisibility({ designRoot: null, journal: null });
  const conn = (access) => ({ context: { user: { access } } });
  test('a canvas-only claim hears its granted canvases only', () => {
    const onA = conn({ v: 1, role: null, grants: [{ c: A, r: 'observer' }] });
    assert.equal(visibility.votesVisible(onA, A), true);
    assert.equal(visibility.votesVisible(onA, B), false);
    assert.equal(visibility.votesVisible(onA, ''), false);
  });
  test('a connection without a claim is a project session — not this predicate’s', () => {
    assert.equal(visibility.votesVisible({ context: { user: {} } }, A), false);
    assert.equal(visibility.votesVisible(null, A), false);
  });
});

describe('the poke over a real ctl socket', () => {
  test('A-only hears nothing for B; both hear A; the member hears both', async () => {
    const member = await ctl(t.member);
    const petra = await ctl(t.aEdit);
    const owner = http(hub.http, t.owner);
    const onB = (await owner.post(V, { canvas: B, targets: TARGETS })).body.vote;
    await until(() => member.length > 0, 3000, 'member poke for B');
    await sleep(400); // every chance for a leak to arrive
    assert.deepEqual(petra, [], 'the A-only socket heard a vote on B');
    await owner.post(`${V}/${onB.id}/end`, {});
    await sleep(300);
    assert.deepEqual(petra, []);

    const before = member.length;
    await owner.post(V, { canvas: A, targets: TARGETS });
    await until(() => petra.length > 0 && member.length > before, 3000, 'pokes for A');
    for (const f of [...petra, ...member]) {
      assert.deepEqual(Object.keys(f).sort(), ['seq', 't']);
      assert.equal(f.t, 'votes');
    }
  });
});

describe('createVotesPoke (unit)', () => {
  test('coalesces to the latest seq; no visibility wired ⇒ a scoped connection hears nothing', () => {
    const sentAll = [];
    const sentOne = [];
    const scoped = {
      context: { user: { access: { v: 1, role: null, grants: [{ c: A, r: 'viewer' }] } } },
      sendStateless: (p) => sentOne.push(p),
    };
    const doc = {
      getConnections: () => [scoped],
      // The project-session broadcast (its filter excludes claim-judged connections).
      broadcastStateless: (p) => sentAll.push(p),
    };
    const timers = [];
    const poke = createVotesPoke({
      instance: { documents: new Map([[FILES_CTL_DOC, doc]]) },
      setTimeoutImpl: (fn) => {
        timers.push(fn);
        return {};
      },
    });
    poke.schedule(3, [A]);
    poke.schedule(5, [A]);
    assert.equal(timers.length, 1);
    timers[0]();
    assert.deepEqual(sentAll, ['{"t":"votes","seq":5}']);
    assert.deepEqual(sentOne, []);
  });
});
