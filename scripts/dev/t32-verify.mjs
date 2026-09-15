#!/usr/bin/env node
// T32 — accepted revisions against a REAL durable store (plan T32, DDR-241).
//
// The local hub runs the real kernel; its project store is either the real
// Cloudflare ProjectStore Durable Object (through the disposable verification
// Worker, `--store <url> --token <t>`) or the self-host SQLite store on disk
// (no `--store`). The oracle is the store itself, read back after the hub has
// been SIGKILLed and restarted on a FRESH data directory — the renderer and
// checkout disks a cloud rollout throws away.
//
//   node scripts/dev/t32-verify.mjs [--store https://…/t/<project>] [--token …] [--n 40] [--rounds 1]
//
// Each round: N chained edits, SIGKILL with one more in flight, restart, retry
// that same transaction (the client never learned its outcome). Prints one JSON
// report: ack latency p50/p95/p99 and, per round, acknowledged actions lost,
// duplicate revisions/transactions, the retried action's single effect and
// whether the head equals the last acknowledged content.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = join(root, 'apps/hub/test/fixtures/serve-hub.mjs');
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const storeUrl = arg('store', null);
const token = arg('token', process.env.T32_TOKEN ?? null);
const N = Number(arg('n', '40'));
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const src = (i) => `export default function T() {\n  return <h1 title="v${i}">T32</h1>;\n}\n`;

function startHub(dataDir) {
  return new Promise((ok, fail) => {
    const env = { ...process.env };
    if (storeUrl) {
      env.MAUDE_PROJECT_STORE_URL = storeUrl;
      if (token) env.MAUDE_PROJECT_STORE_TOKEN = token;
    }
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let buf = '';
    const timer = setTimeout(() => fail(new Error(`hub did not start: ${buf}`)), 60_000);
    proc.stdout.on('data', (c) => {
      buf += c;
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      const info = JSON.parse(line);
      ok({ proc, http: info.http.replace(/\/$/, ''), tokens: info.tokens });
    });
    proc.stderr.on('data', (c) => {
      buf += c;
    });
  });
}

async function api(hub, route, body) {
  const res = await fetch(`${hub.http}/api/projects/current/v1/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${hub.tokens.owner}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const pct = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 10) / 10
    : null;
};

const dirs = [];
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 't32-hub-'));
  dirs.push(d);
  return d;
};

const ROUNDS = Number(arg('rounds', '1'));
const report = {
  store: storeUrl ? 'cloudflare-durable-object' : 'self-host-sqlite',
  n: N,
  rounds: ROUNDS,
};
const dataDir = fresh();
let hub = await startHub(dataDir);
try {
  const tag = Date.now().toString(36);
  const doc = `ws/t32/main/ui-t32-${tag}`;
  const acked = [];
  const ack = [];
  const rounds = [];
  let prev = null;
  let boot = (await api(hub, 'bootstrap')).body;
  const projectId = boot.projectId;
  const envelope = (epoch, ops, tx) =>
    JSON.stringify({
      protocol: 1,
      projectId,
      epoch,
      transactionId: tx,
      origin: { deviceId: 't32', sessionId: 's' },
      action: { kind: 'edit', label: 'T32', operations: ops },
    });
  let i = 0;
  for (let round = 0; round < ROUNDS; round++) {
    // A chain of edits, then SIGKILL with one more in flight.
    for (let k = 0; k < N; k++, i++) {
      const ops =
        i === 0
          ? [{ op: 'doc.create', doc, path: `ui/t32-${tag}.tsx`, lanes: { html: src(0) } }]
          : [{ op: 'lane.replace', doc, lane: 'html', base: sha(prev), content: src(i) }];
      const tx = `tx_t32_${i}_${Math.random().toString(36).slice(2, 10)}`;
      const t0 = performance.now();
      const r = await api(hub, 'proposals', envelope(boot.epoch, ops, tx));
      const ms = performance.now() - t0;
      if (r.body?.status !== 'accepted') throw new Error(`proposal ${i} ${JSON.stringify(r.body)}`);
      ack.push(ms);
      acked.push({ tx, revision: r.body.revision, content: src(i) });
      prev = src(i);
    }
    const inflightTx = `tx_t32_inflight_${round}_${Date.now()}`;
    const inflightOps = [
      { op: 'lane.replace', doc, lane: 'html', base: sha(prev), content: src(i) },
    ];
    const inflightBody = envelope(boot.epoch, inflightOps, inflightTx);
    const inflight = api(hub, 'proposals', inflightBody).catch(() => null);
    await new Promise((r) => setTimeout(r, 5 + round * 3));
    hub.proc.kill('SIGKILL');
    const inflightAnswer = await inflight;

    // Cloud: a new hub on a FRESH data directory — every local disk is gone and
    // only the Durable Object remains. Self-host: the same data volume (the
    // store lives on it; the process and its memory are what died).
    hub = await startHub(storeUrl ? fresh() : dataDir);
    boot = (await api(hub, 'bootstrap')).body;
    // The client never learned the in-flight outcome, so it retries the SAME
    // transaction: whether or not the first attempt committed, one effect.
    let retry = await api(hub, 'proposals', inflightBody);
    if (retry.body?.code === 'epoch-stale')
      retry = await api(hub, 'proposals', envelope(boot.epoch, inflightOps, inflightTx));
    const revs = [];
    let cursor = 0;
    for (;;) {
      const page = (await api(hub, `revisions?after=${cursor}&limit=200`)).body?.revisions ?? [];
      if (!page.length) break;
      revs.push(...page);
      cursor = page[page.length - 1].revision;
      if (page.length < 200) break;
    }
    const txOf = (r) => r.transactionId ?? r.tx ?? r.actionId;
    const lost = acked.filter((a) => !revs.some((r) => r.revision === a.revision));
    const inflightRevisions = revs.filter((r) => txOf(r) === inflightTx).length;
    const head = boot.docs.find((d) => d.doc === doc);
    const headAfterRetry = (await api(hub, 'bootstrap')).body.docs.find((d) => d.doc === doc);
    const blob = headAfterRetry
      ? (await api(hub, `blobs/${headAfterRetry.lanes.html.hash}`)).body
      : null;
    const retried = retry.body?.status === 'accepted';
    if (retried) {
      acked.push({ tx: inflightTx, revision: retry.body.revision, content: src(i) });
      prev = src(i);
      i++;
    }
    rounds.push({
      round,
      inflightAnsweredBeforeKill: !!inflightAnswer?.body?.status,
      bootHadHead: !!head,
      retryStatus: retry.body?.status ?? retry.status,
      retryCode: retry.body?.code,
      inflightRevisions,
      revisionsInStore: revs.length,
      acknowledgedLost: lost.length,
      duplicateRevisions: revs.length - new Set(revs.map((r) => r.revision)).size,
      duplicateTransactions: revs.length - new Set(revs.map(txOf)).size,
      headIsLastAcknowledged: blob?.body === prev,
    });
  }
  report.ackMs = { p50: pct(ack, 0.5), p95: pct(ack, 0.95), p99: pct(ack, 0.99), n: ack.length };
  report.rounds = rounds;
  report.ok = rounds.every(
    (r) =>
      r.acknowledgedLost === 0 &&
      r.duplicateRevisions === 0 &&
      r.duplicateTransactions === 0 &&
      r.inflightRevisions === 1 &&
      r.retryStatus === 'accepted' &&
      r.headIsLastAcknowledged
  );
} catch (err) {
  report.ok = false;
  report.error = String(err?.stack ?? err);
} finally {
  hub.proc.kill('SIGTERM');
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
