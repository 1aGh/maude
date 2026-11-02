// S9.13 — ballot secrecy, one assertion per lane of the contract's table
// (S4-S9-votes-comments.md §2.6). A ballot (any picks, and any count derived
// from them before the end) appears in exactly two places: the `ballots` table
// and the voter's own answer. The canary is a target id PAIRED with a count:
// `"ab:canary-zq":3` must never appear anywhere but Vera's own answers.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { FILES_CTL_DOC } from '../src/files-ctl.mjs';
import { projectStorePath } from '../src/project-transactions/store-sqlite.mjs';
import {
  A,
  docOf,
  http,
  proposal,
  rm,
  seedTokens,
  src,
  startHub,
  tmpDir,
  until,
} from './_acl-docs-fixture.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const V1 = '/api/projects/local/v1';
const V = `${V1}/votes`;
const CANARY = 'canary-zq';
const PAIRED = /canary-zq\\?"\s*:\s*\d/;

let dataDir;
let hub;
let t;
let as;
const seen = { updates: [], stateless: [], awareness: [] };
const providers = [];

function listen(token, name) {
  const doc = new Y.Doc();
  doc.on('update', (u) => seen.updates.push(Buffer.from(u).toString('latin1')));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no sync for ${name}`)), 5000);
    const provider = new HocuspocusProvider({
      url: hub.ws,
      name,
      token,
      document: doc,
      onStateless: ({ payload }) => seen.stateless.push(payload),
      onAwarenessUpdate: ({ states }) => seen.awareness.push(JSON.stringify(states)),
      onSynced: () => {
        clearTimeout(timer);
        resolve(provider);
      },
    });
    providers.push(() => {
      provider.destroy();
      doc.destroy();
    });
  });
}

const ballotRows = () => {
  const db = new Database(projectStorePath(dataDir), { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ballots`).get().n;
  } finally {
    db.close();
  }
};

let vote;
let before_;
let logged = '';
const consoleWas = {};

before(async () => {
  dataDir = tmpDir('maude-votes-secrecy-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir, { rateLimit: false });
  as = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, http(hub.http, v)]));
  const epoch = (await as.owner.post(`${V1}/mode`, { mode: 'transactions', expectEpoch: 0 })).body
    .epoch;
  const made = await as.owner.post(
    `${V1}/proposals`,
    proposal(epoch, [{ op: 'doc.create', doc: docOf(A), path: A, lanes: { html: src('alpha') } }])
  );
  assert.equal(made.status, 200, JSON.stringify(made.body));
  await listen(t.member, FILES_CTL_DOC);
  await listen(t.member, docOf(A));
  await listen(t.viewer, docOf(A));
  before_ = {
    revisions: (await as.owner.get(`${V1}/revisions?after=0`)).body.revisions.length,
    history: (await as.owner.get(`${V1}/history`)).body.history.length,
  };
  for (const k of ['log', 'info', 'warn', 'error']) {
    consoleWas[k] = console[k];
    console[k] = (...args) => {
      logged += `${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
      consoleWas[k](...args);
    };
  }
  // The vote: Vera (Can comment) puts all three dots on the canary target.
  vote = (await as.owner.post(V, { canvas: A, targets: ['ab:dir-a', `ab:${CANARY}`], expected: 3 }))
    .body.vote;
  const cast = await as.viewer.post(`${V}/${vote.id}/ballot`, { picks: { [`ab:${CANARY}`]: 3 } });
  assert.equal(cast.status, 200);
  assert.ok(PAIRED.test(JSON.stringify(cast.body)), 'the voter gets their own picks back');
  await as.member.post(`${V}/${vote.id}/ballot`, { picks: { 'ab:dir-a': 1 } });
  await until(() => seen.stateless.some((p) => p.includes('"votes"')), 3000, 'a votes poke');
});

after(async () => {
  for (const [k, fn] of Object.entries(consoleWas)) console[k] = fn;
  for (const close of providers) close();
  await hub?.close();
  rm(dataDir);
});

describe('before the end (§2.6)', () => {
  test('other people: no mine, no picks, no partial count — only who is done', async () => {
    for (const who of ['owner', 'member', 'observer', 'aEdit']) {
      const one = await as[who].get(`${V}/${vote.id}`);
      const list = await as[who].get(V);
      for (const r of [one, list]) {
        assert.equal(r.status, 200, who);
        assert.equal(PAIRED.test(r.text), false, `${who}: ${r.text}`);
        assert.equal(/"(tallies|voters|picks)"/.test(r.text), false, `${who}: ${r.text}`);
      }
      if (who !== 'member') assert.equal('mine' in one.body, false, who);
      assert.deepEqual(one.body.vote.done, ['max@x.test', 'vera@x.test']);
    }
  });

  test('Yjs: no document update carries the vote (the hub writes none)', () => {
    assert.ok(seen.updates.length > 0, 'the listeners synced');
    for (const u of seen.updates) assert.equal(u.includes(CANARY), false);
  });

  test('pokes: payload-free {t:"votes", seq}, nothing else', () => {
    const votes = seen.stateless.filter((p) => p.includes('votes'));
    assert.ok(votes.length > 0);
    for (const p of votes) {
      const frame = JSON.parse(p);
      assert.deepEqual(Object.keys(frame).sort(), ['seq', 't']);
      assert.equal(frame.t, 'votes');
    }
    for (const p of seen.stateless) assert.equal(p.includes(CANARY), false, p);
  });

  test('awareness carries nothing of the vote', () => {
    for (const a of seen.awareness) assert.equal(a.includes(CANARY), false, a);
  });

  test('history: votes are not kernel actions (no revision, no history row)', async () => {
    assert.equal(
      (await as.owner.get(`${V1}/revisions?after=0`)).body.revisions.length,
      before_.revisions
    );
    assert.equal((await as.owner.get(`${V1}/history`)).body.history.length, before_.history);
  });

  test('bootstrap lists store docs and heads only', async () => {
    const r = await as.owner.get(`${V1}/bootstrap`);
    assert.equal(r.status, 200);
    assert.equal(r.text.includes(vote.id), false);
    assert.equal(r.text.includes(CANARY), false);
  });

  test('the store holds the live ballots (the hub operator is trusted with them)', () => {
    assert.equal(ballotRows(), 2);
  });
});

describe('the end', () => {
  test('counts revealed, ballots deleted — nobody can tell who picked what', async () => {
    const e = await as.owner.post(`${V}/${vote.id}/end`, {});
    assert.equal(e.status, 200);
    assert.deepEqual(e.body.vote.tallies, { 'ab:dir-a': 1, [`ab:${CANARY}`]: 3 });
    assert.equal(e.body.vote.voters, 2);
    assert.equal(ballotRows(), 0);
    // Not even Vera gets her picks back now.
    const mine = await as.viewer.get(`${V}/${vote.id}`);
    assert.equal('mine' in mine.body, false);
  });

  test('logs: the hub never logged a pick', () => {
    assert.equal(PAIRED.test(logged), false, logged);
    assert.equal(logged.includes(CANARY), false, logged);
  });
});

describe('export, backup and every other module (static pin)', () => {
  test('only the votes store and its routes name the ballot tables', () => {
    const root = join(import.meta.dirname, '../src');
    const allowed = new Set(['votes.mjs', 'routes-v2/votes.mjs']);
    const walk = (dir, rel = '') => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), r);
        else if (e.name.endsWith('.mjs') && !allowed.has(r)) {
          const text = readFileSync(join(dir, e.name), 'utf8');
          assert.equal(
            /(?:FROM|INTO|UPDATE|TABLE(?: IF NOT EXISTS)?)\s+(?:ballots|votes)\b|picks_json|votes_meta/i.test(
              text
            ),
            false,
            `${r} names the ballot tables`
          );
          // Export / backup / admin never call the vote methods.
          if (/export|backup|admin|tenant-stats|bootstrap/.test(r)) {
            assert.equal(/votes(Get|List|Cast|Start|End)\b/.test(text), false, r);
          }
        }
      }
    };
    walk(root);
  });

  test('the votes modules never log picks', () => {
    for (const f of ['votes.mjs', 'routes-v2/votes.mjs']) {
      const text = readFileSync(join(import.meta.dirname, '../src', f), 'utf8');
      for (const line of text
        .split('\n')
        .filter((l) => /console\.|log\.(error|warn|info)/.test(l))) {
        assert.equal(/picks|mine|ballot/i.test(line), false, `${f}: ${line}`);
      }
    }
  });
});
