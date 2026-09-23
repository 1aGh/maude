#!/usr/bin/env node
// S15 / T8 crash oracle against a deployed backend: N chained accepted edits,
// the backend process killed with one more in flight, restarted, the SAME
// transaction retried. Oracle: the store itself after restart.
//
//   node crash-oracle.mjs --backend selfhost --work <dir> --rounds 4 --n 40 \
//     --kill "node selfhost.mjs kill --work <dir>" --start "node selfhost.mjs start --work <dir>"
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { canvasSource, loadBackend, sha } from './backend.mjs';

const argv = process.argv.slice(2);
const arg = (n, fb = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 ? argv[i + 1] : fb;
};
const N = Number(arg('n', '40'));
const ROUNDS = Number(arg('rounds', '4'));
let B = await loadBackend(arg('backend'), { work: arg('work') });
const tag = randomUUID().slice(0, 8);
const name = `F3Crash${tag}`;
const doc = `ui-${name.toLowerCase()}`;
const src = (i) => canvasSource(name, `v${i}`);
const pct = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] * 10) / 10 : null;
};
const acked = [];
const ack = [];
const rounds = [];
let prev = null;
let i = 0;
let boot = await B.bootstrap('a');
const envelope = (epoch, ops, tx) => ({
  protocol: 1,
  projectId: boot.projectId,
  epoch,
  transactionId: tx,
  origin: { deviceId: 'f3-crash', sessionId: tag },
  action: { kind: 'edit', label: 'F3 crash oracle', operations: ops },
});
const post = (body) => B.api('a', 'proposals', body, { timeout: 30000 });
for (let round = 0; round < ROUNDS; round++) {
  for (let k = 0; k < N; k++, i++) {
    const ops =
      i === 0
        ? [{ op: 'doc.create', doc, path: `ui/${name}.tsx`, lanes: { html: src(0) } }]
        : [{ op: 'lane.replace', doc, lane: 'html', base: sha(prev), content: src(i) }];
    const tx = `tx_f3crash_${i}_${randomUUID().slice(0, 8)}`;
    const t0 = performance.now();
    const r = await post(envelope(boot.epoch, ops, tx));
    ack.push(performance.now() - t0);
    if (r.body?.status !== 'accepted') throw new Error(`proposal ${i}: ${r.status} ${JSON.stringify(r.body)}`);
    acked.push({ tx, revision: r.body.revision });
    prev = src(i);
  }
  const inflightTx = `tx_f3crash_inflight_${round}_${randomUUID().slice(0, 8)}`;
  const inflightOps = [{ op: 'lane.replace', doc, lane: 'html', base: sha(prev), content: src(i) }];
  const inflightBody = envelope(boot.epoch, inflightOps, inflightTx);
  const inflight = post(inflightBody).catch(() => null);
  await new Promise((r) => setTimeout(r, 5 + round * 3));
  const killedAt = Date.now();
  execSync(arg('kill'), { stdio: 'ignore' });
  const inflightAnswer = await inflight;
  execSync(arg('start'), { stdio: 'ignore' });
  const restartMs = Date.now() - killedAt;
  B = await loadBackend(arg('backend'), { work: arg('work') }); // sessions survive? re-sign-in regardless
  boot = await B.bootstrap('a');
  let retry = await post(inflightBody);
  if (retry.body?.code === 'epoch-stale') retry = await post(envelope(boot.epoch, inflightOps, inflightTx));
  const revs = [];
  let cursor = 0;
  for (;;) {
    const page = (await B.api('a', `revisions?after=${cursor}&limit=200`)).body?.revisions ?? [];
    if (!page.length) break;
    revs.push(...page);
    cursor = page.at(-1).revision;
    if (page.length < 200) break;
  }
  const txOf = (r) => r.transactionId ?? r.tx ?? r.actionId;
  const mine = revs.filter((r) => String(txOf(r)).startsWith('tx_f3crash_'));
  const head = (await B.doc(doc, 'a')).source;
  if (retry.body?.status === 'accepted') {
    acked.push({ tx: inflightTx, revision: retry.body.revision });
    prev = src(i);
    i++;
  }
  rounds.push({
    round,
    restartMs,
    inflightAnsweredBeforeKill: !!inflightAnswer?.body?.status,
    retryStatus: retry.body?.status ?? retry.status,
    retryReplayed: !!retry.body?.replay,
    inflightRevisions: revs.filter((r) => txOf(r) === inflightTx).length,
    acknowledgedLost: acked.filter((a) => !revs.some((r) => r.revision === a.revision)).length,
    duplicateRevisions: revs.length - new Set(revs.map((r) => r.revision)).size,
    duplicateTransactions: mine.length - new Set(mine.map(txOf)).size,
    headIsLastAcknowledged: head === prev,
  });
}
const report = {
  backend: B.name,
  doc,
  n: N,
  rounds,
  ackMs: { p50: pct(ack, 0.5), p95: pct(ack, 0.95), p99: pct(ack, 0.99), n: ack.length },
};
report.ok = rounds.every(
  (r) =>
    r.acknowledgedLost === 0 &&
    r.duplicateRevisions === 0 &&
    r.duplicateTransactions === 0 &&
    r.inflightRevisions === 1 &&
    r.retryStatus === 'accepted' &&
    r.headIsLastAcknowledged
);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
