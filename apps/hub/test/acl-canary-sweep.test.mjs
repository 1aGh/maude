// The hub canary sweep — V2-1.16 §7, the peer door's "a canvas-scoped member
// gets NOTHING" bar (S9.5).
//
// Fixture: canvas A, and canvas B named `canary-b-zx` carrying CANARY-B-SOURCE
// and a comment CANARY-B-COMMENT, created through an action whose label names
// B; a member present on B. With an A-only peer token the sweep walks EVERY
// row of the hub route table (U3, `routes-v2`), the studio default lane, the
// Yjs door and the ctl channel, and asserts:
//   - no response body, header, socket frame or stateless message contains
//     (case-folded) `canary-b`, nor the hex of any B lane hash;
//   - every B-targeted call answers byte-identically to the same call for a
//     target that does not exist (U1).
//
// The sweep is table-driven on purpose: a row added to `HUB_ROUTE_ROWS` is
// swept the day it lands, and a door that starts answering B is red here.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { laneHash } from '../src/project-transactions/lanes.mjs';
import { HUB_ROUTE_ROWS } from '../src/routes-v2/index.mjs';
import {
  A,
  B,
  docOf,
  http,
  NOPE,
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
import { checkSweepTable, requestsFor, studioDefaultRequests } from './_acl-sweep-requests.mjs';

const V1 = '/api/projects/local/v1';
const hex = (s) => createHash('sha256').update(s).digest('hex');
const CANARY_B_COMMENT = JSON.stringify([{ id: 'c1', text: 'CANARY-B-COMMENT' }]);

let dataDir;
let hub;
let t;
let epoch;
let leaks; // every B secret, case-folded
let bTargets;
let nopeTargets;

before(async () => {
  dataDir = tmpDir('maude-acl-sweep-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir, { rateLimit: false });
  const owner = http(hub.http, t.owner);
  epoch = (await owner.post(`${V1}/mode`, { mode: 'transactions', expectEpoch: 0 })).body.epoch;
  const made = await owner.post(
    `${V1}/proposals`,
    proposal(
      epoch,
      [
        { op: 'doc.create', doc: docOf(A), path: A, lanes: { html: src('alpha') } },
        {
          op: 'doc.create',
          doc: docOf(B),
          path: B,
          lanes: { html: src('CANARY-B-SOURCE'), comments: CANARY_B_COMMENT },
        },
      ],
      { label: 'design: update canary-b-zx' }
    )
  );
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const bHashes = [laneHash(src('CANARY-B-SOURCE')), laneHash(CANARY_B_COMMENT)];
  // A B-only action (the seed above touched A too), for the transactions row.
  const bOnly = await owner.post(
    `${V1}/proposals`,
    proposal(
      epoch,
      [
        {
          op: 'lane.replace',
          doc: docOf(B),
          lane: 'html',
          base: bHashes[0],
          content: src('CANARY-B-SOURCE two'),
        },
      ],
      { label: 'canary-b only', transactionId: 'tx_sweep_b_only' }
    )
  );
  assert.equal(bOnly.status, 200, JSON.stringify(bOnly.body));
  const bAction = bOnly.body.actionId;
  assert.match(bAction, /^a_/);
  // A vote on B (the owner's), so the votes rows have a real B target.
  const voted = await owner.post(`${V1}/votes`, {
    canvas: B,
    targets: ['ab:canary-b-t1', 'ab:canary-b-t2'],
    expected: 3,
  });
  assert.equal(voted.status, 201, JSON.stringify(voted.body));
  const bVote = voted.body.vote.id;
  leaks = ['canary-b', ...bHashes, laneHash(src('CANARY-B-SOURCE two')), bVote, bAction];
  bTargets = {
    action: bAction,
    path: B,
    doc: docOf(B),
    hash: bHashes[0],
    commentsHash: bHashes[1],
    slug: 'canary-b-zx',
    vote: bVote,
    tx: 'tx_sweep_b_only',
    sha: hex('b commit').slice(0, 40),
    css: 'ui/canary-b-zx.css',
    asset: 'assets/canary-b-only.png',
  };
  nopeTargets = {
    action: bAction.replace(/[0-9a-f]/g, (c) => (c === '0' ? '1' : '0')),
    path: NOPE,
    doc: docOf(NOPE),
    hash: hex('not a lane'),
    commentsHash: hex('not a comments lane'),
    slug: 'nothing-here',
    vote: bVote.replace(/[0-9a-f]/g, (c) => (c === '0' ? '1' : '0')),
    tx: 'tx_sweep_seed_n',
    sha: hex('no commit').slice(0, 40),
    css: 'ui/nothing-here.css',
    asset: 'assets/nothing-here.png',
  };
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

/** Replace the request's own target strings (an echo reveals nothing) before comparing. */
function normalize(text, targets) {
  let out = String(text);
  for (const v of Object.values(targets)) {
    out = out.split(v).join('<T>').split(encodeURIComponent(v)).join('<T>');
  }
  // Volatile fields a refusal may carry (proposal ids, timestamps).
  return out.replace(
    /"(proposalHash|transactionId|committedAt|at|date|uptimeMs|startedAt|now)":("[^"]*"|\d+)/g,
    '"$1":0'
  );
}

function assertNoLeak(where, ...texts) {
  for (const text of texts) {
    const folded = String(text).toLowerCase();
    for (const leak of leaks) {
      assert.equal(folded.includes(leak.toLowerCase()), false, `${where} leaks ${leak}`);
    }
  }
}

async function send(token, [method, path, body]) {
  const res = await fetch(`${hub.http}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
    redirect: 'manual',
  });
  const text = method === 'HEAD' ? '' : await res.text();
  return {
    status: res.status,
    text,
    headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n'),
  };
}

// Routes whose requests mutate or sign the session out are swept last, in
// their own pass, so they cannot change what the other rows see.
const SESSION_ENDING = new Set(['/auth/logout', '/auth/browser/signout']);

describe('the hub canary sweep (A-only peer token)', () => {
  test('the sweep table reaches every row (no /v1/undefined, no unsubstituted segment)', () => {
    const problems = checkSweepTable(HUB_ROUTE_ROWS, [bTargets, nopeTargets], { epoch });
    assert.deepEqual(problems, []);
  });

  test('every route-table row: no B byte, and B answers exactly as a missing target', async () => {
    const rows = HUB_ROUTE_ROWS.filter((r) => !SESSION_ENDING.has(r.path));
    const ctx = { epoch };
    const passes = [
      ...rows.map((row) => [
        row,
        requestsFor(row, bTargets, ctx),
        requestsFor(row, nopeTargets, ctx),
      ]),
      // A path no row names is the studio's lane (DEFAULT_ROW).
      [
        { path: '(studio default)' },
        studioDefaultRequests(bTargets),
        studioDefaultRequests(nopeTargets),
      ],
    ];
    let swept = 0;
    const findings = [];
    const check = (fn) => {
      try {
        fn();
      } catch (err) {
        findings.push(err.message.split('\n')[0]);
      }
    };
    for (const [row, bReqs, nReqs] of passes) {
      for (let i = 0; i < bReqs.length; i++) {
        const where = `${bReqs[i][0]} ${bReqs[i][1].split('?')[0]} [${row.path ?? row.pattern}]`;
        const b = await send(t.aEdit, bReqs[i]);
        const n = await send(t.aEdit, nReqs[i]);
        const bText = normalize(b.text, bTargets);
        const nText = normalize(n.text, nopeTargets);
        check(() => assertNoLeak(where, bText, b.headers.replace(/^date:.*$/m, '')));
        check(() => assertNoLeak(`${where} (twin)`, n.text));
        check(() =>
          assert.equal(b.status, n.status, `${where}: status B ${b.status} ≠ missing ${n.status}`)
        );
        check(() =>
          assert.equal(bText, nText, `${where}: body differs from missing — ${bText} | ${nText}`)
        );
        if (process.env.SWEEP_DEBUG) console.log(`SW ${b.status} ${where} ${bText.slice(0, 90)}`);
        swept += 1;
      }
    }
    // Every finding at once: one red run names every leaking row.
    assert.deepEqual(findings, []);
    assert.ok(swept >= rows.length * 2, `swept ${swept} requests`);
  });

  test('the project-wide reads carry no B byte (bootstrap, revisions, history, documents)', async () => {
    const c = http(hub.http, t.aEdit);
    for (const path of [
      `${V1}/bootstrap`,
      `${V1}/revisions?after=0`,
      `${V1}/history`,
      '/api/documents',
      '/api/journal?since=0',
      '/api/files',
    ]) {
      const r = await c.get(path);
      assertNoLeak(path, r.text);
    }
  });

  test('the Yjs door: B refuses as missing; A carries no B byte', async () => {
    const b = await openDoc(hub.ws, t.aEdit, docOf(B));
    const n = await openDoc(hub.ws, t.aEdit, docOf(NOPE));
    assert.notEqual(b.status, 'synced');
    assert.equal(b.status, n.status);
    const a = await openDoc(hub.ws, t.aEdit, docOf(A), { keep: true });
    try {
      assertNoLeak('doc A', JSON.stringify(a.doc.toJSON()));
    } finally {
      a.close();
    }
  });

  test('sockets: presence on B and B activity never reach A-only connections', async () => {
    const frames = [];
    const ctlDoc = new Y.Doc();
    const ctl = new HocuspocusProvider({
      url: hub.ws,
      name: 'maude.files',
      token: t.aEdit,
      document: ctlDoc,
      onStateless: ({ payload }) => frames.push(payload),
    });
    const onA = await openDoc(hub.ws, t.aEdit, docOf(A), { keep: true });
    onA.provider.on('stateless', ({ payload }) => frames.push(payload));
    const onB = await openDoc(hub.ws, t.member, docOf(B), { keep: true });
    try {
      onB.provider.setAwarenessField('user', { name: 'canary-b member' });
      // B activity while A listens.
      const owner = http(hub.http, t.owner);
      const head = (await owner.get(`${V1}/bootstrap`)).body.docs.find((d) => d.path === B);
      await owner.post(
        `${V1}/proposals`,
        proposal(
          epoch,
          [
            {
              op: 'lane.replace',
              doc: docOf(B),
              lane: 'html',
              base: head.lanes.html.hash,
              content: src('CANARY-B-SOURCE again'),
            },
          ],
          { label: 'canary-b again' }
        )
      );
      await until(() => onA.provider.isSynced, 3000, 'A synced');
      await sleep(400);
      const presence = [...onA.provider.awareness.getStates().values()];
      assertNoLeak('A awareness', JSON.stringify(presence));
      assertNoLeak('frames', JSON.stringify(frames));
      assertNoLeak('ctl awareness', JSON.stringify([...ctl.awareness.getStates().values()]));
    } finally {
      ctl.destroy();
      ctlDoc.destroy();
      onA.close();
      onB.close();
    }
  });

  test('the session-ending rows are swept too, last', async () => {
    for (const path of SESSION_ENDING) {
      const r = await send(t.aEdit, ['POST', path, '{}']);
      assertNoLeak(path, r.text, r.headers);
    }
  });
});
