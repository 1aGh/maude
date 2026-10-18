// The runs poke is scoped like the votes poke (V2-1.16 L3, V2-5 sweep-fix):
// `{t:'runs', seq}` on `maude.files` reaches every project session, and a
// canvas-only connection only when the change touched a canvas it can see. An
// A-only socket hears NOTHING for a run on B — not even that something
// happened (a timing signal for AI work on a canvas it cannot see).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { FILES_CTL_DOC } from '../src/files-ctl.mjs';
import { createRunsPoke } from '../src/runs-routes.mjs';
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

const RUNS = '/api/projects/local/v1/runs';

let dataDir;
let hub;
let t;
const closers = [];
let n = 0;

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
        if (payload.includes('"runs"')) heard.push(JSON.parse(payload));
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

const ask = (canvas) => {
  n += 1;
  const runId = `r_scope${String(n).padStart(4, '0')}`;
  return {
    runId,
    askId: `a_${runId.slice(2)}`,
    chatId: 'c1',
    origin: 'maude-chat',
    label: 'Make it greener',
    device: 'mac-1',
    wants: [{ canvas: `path:.design/${canvas}`, artboard: `ab-${n}` }],
    enqueue: true,
  };
};

before(async () => {
  dataDir = tmpDir('maude-runs-poke-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir, { rateLimit: false });
});

after(async () => {
  for (const close of closers) close();
  await hub?.close();
  rm(dataDir);
});

describe('the runs poke over a real ctl socket', () => {
  test('A-only hears nothing for a run on B; it hears A; the member hears both', async () => {
    const member = await ctl(t.member);
    const petra = await ctl(t.aEdit);
    const owner = http(hub.http, t.owner);
    const onB = await owner.post(RUNS, ask(B));
    assert.equal(onB.status, 200, JSON.stringify(onB.body));
    await until(() => member.length > 0, 3000, 'member poke for B');
    await sleep(400); // every chance for a leak to arrive
    assert.deepEqual(petra, [], 'the A-only socket heard a run on B');
    await owner.post(`${RUNS}/${onB.body.run.runId}/end`, { outcome: 'done' });
    await sleep(300);
    assert.deepEqual(petra, [], 'the A-only socket heard a run on B end');

    const before = member.length;
    const onA = await owner.post(RUNS, ask(A));
    assert.equal(onA.status, 200, JSON.stringify(onA.body));
    await until(() => petra.length > 0 && member.length > before, 3000, 'pokes for A');
    for (const f of [...petra, ...member]) {
      assert.deepEqual(Object.keys(f).sort(), ['seq', 't']);
      assert.equal(f.t, 'runs');
    }
  });
});

describe('createRunsPoke (unit)', () => {
  test('no visibility wired ⇒ a canvas-only connection hears nothing', () => {
    const sentAll = [];
    const sentOne = [];
    const scoped = {
      context: { user: { access: { v: 1, role: null, grants: [{ c: A, r: 'member' }] } } },
      sendStateless: (p) => sentOne.push(p),
    };
    const doc = {
      getConnections: () => [scoped],
      broadcastStateless: (p, filter) => {
        if (!filter || filter(scoped)) sentOne.push(p);
        sentAll.push(p);
      },
    };
    const poke = createRunsPoke({
      instance: { documents: new Map([[FILES_CTL_DOC, doc]]) },
      setTimeoutImpl: () => null,
    });
    poke.schedule(3, [A]);
    poke.flushNow();
    assert.equal(sentAll.length, 1, 'project sessions still hear it');
    assert.deepEqual(sentOne, []);
  });
});
