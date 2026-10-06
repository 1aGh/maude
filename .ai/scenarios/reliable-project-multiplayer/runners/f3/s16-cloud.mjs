#!/usr/bin/env node
// S16 on the cloud cell: the accepted store under the failures the cloud can
// actually meet. The self-host variants do not all transfer — the cloud's
// store is one ProjectStore Durable Object per project, so:
//
//   A  two coordinators on one store is not constructible (the platform runs
//      one DO instance per id and serializes it). What IS the cloud's version:
//      two people racing on one document through the one cell, and the cell
//      process dying with proposals in flight — every acknowledgment is in the
//      store exactly once at its revision (a `noop` acknowledgment — the merge
//      already was the head — adds none), a round both people win is exactly
//      the three-way merge of the two, and a retry of an unacknowledged
//      transaction (same id) after the restart is accepted exactly once.
//   B  a missing payload / C a full store — not injectable: payloads and head
//      live in the DO's own storage, which a test cannot corrupt or fill
//      without breaking the platform object. Recorded, not faked.
//   D  a deleted canvas with history, then the cell restarted on a fresh disk
//      (its disk is ephemeral — every restart is a replaced checkout disk):
//      same head, same chain, deleted stays deleted, the deleted canvas's
//      history readable, parity (store ↔ live documents ↔ fresh checkout).
//
//   F3_CLOUD_CREDS=… F3_CLOUD_SESSIONS=… node s16-cloud.mjs --out <dir>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasSource, loadBackend, sha } from './backend.mjs';

const { mergeLane } = await import(new URL('../../../../../apps/hub/src/project-transactions/lanes.mjs', import.meta.url).href);

const HERE = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const out = argv[argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
const tag = randomBytes(3).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ops = (cmd) =>
  JSON.parse(execFileSync('node', [join(HERE, 'cloud-ops.mjs'), cmd], { encoding: 'utf8', timeout: 360000 }).trim().split('\n').at(-1));
// A restart ends every cell session: sign in afresh through the real path.
const signIn = async () => {
  if (process.env.F3_CLOUD_SESSIONS) rmSync(process.env.F3_CLOUD_SESSIONS, { force: true });
  return loadBackend('cloud');
};
const restart = async () => {
  const killed = ops('kill');
  const back = ops('start');
  return { killed: killed.status, uptimeMs: back.uptimeMs };
};

let B = await loadBackend('cloud');
assert.equal((await B.api('owner', 'mode')).body?.mode, 'transactions', 'S16 needs an accepted project');
const log = async () => {
  const all = [];
  for (let after = 0; ; ) {
    const r = await B.api('owner', `revisions?after=${after}&limit=1000`);
    assert.equal(r.status, 200, `revisions ${r.status}`);
    all.push(...r.body.revisions);
    if (r.body.revisions.length < 1000) return all;
    after = r.body.revisions.at(-1).revision;
  }
};
const chain = (rows) => {
  const revs = rows.map((r) => r.revision);
  const txs = rows.map((r) => r.tx);
  return {
    revisions: revs.length,
    contiguous: revs.every((v, i) => i === 0 || v === revs[i - 1] + 1),
    duplicateTransactions: txs.length - new Set(txs).size,
  };
};
const create = async (name, title) => {
  const src = canvasSource(name, title);
  const doc = `ui-${name.toLowerCase()}`;
  const r = await B.propose('owner', [{ op: 'doc.create', doc, path: `ui/${name}.tsx`, lanes: { html: src } }]);
  assert.equal(r.status, 200, `create ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return { doc, rel: `ui/${name}.tsx`, src };
};
const edit = (who, c, from, to, opts) =>
  B.propose(who, [{ op: 'lane.replace', doc: c.doc, lane: 'html', base: sha(from), content: to }], opts);
const ackedAtItsRevision = (rows, acks) => {
  const byTx = new Map(rows.map((r) => [r.tx, r.revision]));
  return acks.filter((a) => byTx.get(a.tx) !== a.revision);
};
const result = { tag, backend: 'cloud', B: { notInjectable: true }, C: { notInjectable: true } };
const save = () => writeFileSync(join(out, 's16-cloud.json'), JSON.stringify(result, null, 2));

// ── A: races through the one cell, and the cell dying mid-write ────────────
{
  const R = await create(`F3CloudRace${tag}`, 'Race');
  const acks = [];
  const outcomes = {};
  let current = R.src;
  const tally = (r) => {
    const k = `${r.status}${r.body?.code ? ` ${r.body.code}` : ''}`;
    outcomes[k] = (outcomes[k] ?? 0) + 1;
  };
  const rounds = [];
  for (let round = 0; round < 20; round++) {
    const contents = ['a', 'b'].map((who) => R.src.replace('Race<', `Race r${round} by ${who}<`));
    const rs = await Promise.all(['a', 'b'].map((who, i) => edit(who, R, current, contents[i])));
    rs.forEach(tally);
    const won = rs
      .map((r, i) => ({ r, content: contents[i] }))
      .filter(({ r }) => r.status === 200)
      .sort((x, y) => x.r.body.revision - y.r.body.revision || (x.r.body.noop ? 1 : 0) - (y.r.body.noop ? 1 : 0));
    for (const { r } of won) acks.push({ tx: r.body.transactionId, revision: r.body.revision, noop: r.body.noop === true });
    const head = (await B.doc(R.doc, 'owner')).source;
    // What the head must be: the one winner, or the merge of the second onto
    // the first — computed here with the hub's own merge, independently.
    let expected = won[0]?.content ?? current;
    if (won.length === 2) {
      const m = mergeLane('html', current, won[1].content, won[0].content);
      expected = m.ok ? m.content : null;
    }
    rounds.push({ round, winners: won.length, noop: won.filter(({ r }) => r.body.noop).length, headAsExpected: head === expected });
    current = head;
  }
  // The cell dies while a burst of proposals is in flight.
  const burst = [];
  const inflight = [];
  let text = current;
  for (let i = 0; i < 40; i++) {
    const next = text.replace('</h1>', ` b${i}</h1>`);
    const transactionId = `tx_s16c_${randomUUID()}`;
    burst.push({ i, transactionId, from: text, to: next });
    text = next;
  }
  const sent = (async () => {
    for (const p of burst) {
      const r = await edit('a', R, p.from, p.to, { transactionId: p.transactionId }).catch((e) => ({ status: 0, error: String(e) }));
      p.first = r.status;
      p.revision = r.body?.revision ?? null;
      if (r.status === 200) acks.push({ tx: r.body.transactionId, revision: r.body.revision, noop: r.body.noop === true });
      else break;
    }
  })();
  inflight.push(sent);
  await sleep(700);
  const cut = await restart();
  await Promise.all(inflight);
  B = await signIn();
  // Every proposal the cell did not answer is retried with its own id.
  const retries = [];
  for (const p of burst) {
    if (p.first === 200) continue;
    const r = await edit('a', R, p.from, p.to, { transactionId: p.transactionId });
    retries.push({ i: p.i, first: p.first, retry: r.status, code: r.body?.code ?? null });
    if (r.status === 200) acks.push({ tx: r.body.transactionId, revision: r.body.revision, noop: r.body.noop === true });
    else break;
  }
  // …and an acknowledged one retried again is not applied twice.
  const replay = burst.find((p) => p.first === 200);
  const replayed = replay ? await edit('a', R, replay.from, replay.to, { transactionId: replay.transactionId }) : null;
  const rows = await log();
  const head = await B.doc(R.doc, 'owner');
  result.A = {
    races: {
      rounds: 20,
      outcomes,
      bothWon: rounds.filter((r) => r.winners === 2).length,
      noopAcks: rounds.reduce((n, r) => n + r.noop, 0),
      everyHeadAsExpected: rounds.every((r) => r.headAsExpected),
      notAsExpected: rounds.filter((r) => !r.headAsExpected),
    },
    restart: cut,
    burst: { sent: burst.length, ackedBeforeCut: burst.filter((p) => p.first === 200).length, retries },
    replayOfAcked: replayed && { status: replayed.status, code: replayed.body?.code ?? null, revision: replayed.body?.revision ?? null },
    chain: chain(rows),
    ackedNotAtItsRevision: ackedAtItsRevision(rows, acks.filter((a) => !a.noop)),
    everyAckInStoreOnce: acks.filter((a) => !a.noop).every((a) => rows.filter((r) => r.tx === a.tx).length === 1),
    noopAcksLeaveNoRow: acks.filter((a) => a.noop).every((a) => !rows.some((r) => r.tx === a.tx)),
    headIsLastBurstStep: head.source === burst.at(-1).to,
  };
  const a = result.A;
  a.status =
    a.races.everyHeadAsExpected &&
    a.noopAcksLeaveNoRow &&
    a.chain.contiguous &&
    a.chain.duplicateTransactions === 0 &&
    a.ackedNotAtItsRevision.length === 0 &&
    a.everyAckInStoreOnce &&
    a.headIsLastBurstStep &&
    retries.every((r) => r.retry === 200) &&
    (!replayed || (replayed.status === 200 && replayed.body?.revision === replay.revision) || replayed.status === 409)
      ? 'pass'
      : 'fail';
  save();
}

// ── D: a deleted canvas's history across a fresh cell disk ─────────────────
{
  const G = await create(`F3CloudGone${tag}`, `Gone ${tag}`);
  const versions = [G.src];
  for (let i = 1; i <= 3; i++) {
    const next = G.src.replace(`Gone ${tag}<`, `Gone ${tag} v${i}<`);
    assert.equal((await edit('a', G, versions.at(-1), next)).status, 200);
    versions.push(next);
  }
  const gRevs = (await log()).filter((r) => r.effects?.some((e) => e.doc === G.doc)).map((r) => r.revision);
  const del = await B.propose('a', [{ op: 'doc.delete', doc: G.doc }]);
  assert.equal(del.status, 200, `delete ${del.status} ${JSON.stringify(del.body)}`);
  await create(`F3CloudKept${tag}`, `Kept ${tag}`);
  const expected = Object.fromEntries(gRevs.map((rev, i) => [rev, sha(versions[i])]));
  const snapshot = async () => {
    const rows = await log();
    const head = await B.bootstrap('owner');
    const lanes = {};
    for (const rev of gRevs) {
      const l = await B.api('owner', `lane?doc=${G.doc}&lane=html&rev=${rev}`);
      lanes[rev] = l.status === 200 ? sha(l.body.body ?? '') : `status ${l.status}`;
    }
    return {
      revision: head.revision,
      chainHash: sha(JSON.stringify(rows.map((r) => [r.revision, r.tx]))),
      liveDocs: head.docs.filter((d) => !d.retired).map((d) => [d.doc, d.lanes?.html?.hash]).sort(),
      deletedLive: head.docs.some((d) => d.doc === G.doc && !d.retired),
      deletedHistory: lanes,
    };
  };
  const before = await snapshot();
  const cut = await restart();
  B = await signIn();
  // The fresh checkout is rebuilt from the store; give it the time it takes.
  let parity = null;
  for (let i = 0; i < 40; i++) {
    parity = (await B.api('owner', 'parity')).body;
    if (parity?.ok) break;
    await sleep(3000);
  }
  const after = await snapshot();
  result.D = {
    restart: cut,
    deletedCanvasRevisions: gRevs,
    historyBeforeRestart: JSON.stringify(before.deletedHistory) === JSON.stringify(expected),
    afterFreshDisk: {
      sameHead: after.revision === before.revision,
      sameChain: after.chainHash === before.chainHash,
      sameLiveDocs: JSON.stringify(after.liveDocs) === JSON.stringify(before.liveDocs),
      deletedStaysDeleted: !after.deletedLive,
      deletedHistoryReadable: JSON.stringify(after.deletedHistory) === JSON.stringify(expected),
      parity: parity?.ok ?? null,
      parityChecked: parity?.checked ?? null,
      mismatches: parity?.mismatches?.slice(0, 5) ?? null,
    },
  };
  const a = result.D.afterFreshDisk;
  result.D.status =
    result.D.historyBeforeRestart && a.sameHead && a.sameChain && a.sameLiveDocs && a.deletedStaysDeleted && a.deletedHistoryReadable && a.parity === true
      ? 'pass'
      : 'fail';
  save();
}

result.status = result.A.status === 'pass' && result.D.status === 'pass' ? 'pass' : 'fail';
save();
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
