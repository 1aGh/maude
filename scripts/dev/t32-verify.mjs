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
//   node scripts/dev/t32-verify.mjs [--store https://…/t/<project>] [--token …] [--n 40]
//
// Prints one JSON report: proposals acknowledged, ack latency p50/p95/p99,
// what survived the kill, duplicates, and whether the replayed documents equal
// the accepted heads.

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
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 10) / 10 : null;
};

const dirs = [];
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 't32-hub-'));
  dirs.push(d);
  return d;
};

const report = { store: storeUrl ? 'cloudflare-durable-object' : 'self-host-sqlite', n: N };
let hub = await startHub(fresh());
try {
  const boot = (await api(hub, 'bootstrap')).body;
  const projectId = boot.projectId;
  let epoch = boot.epoch;
  const doc = `ws/t32/main/ui-t32-${Date.now().toString(36)}`;
  const envelope = (ops, tx) =>
    JSON.stringify({
      protocol: 1,
      projectId,
      epoch,
      transactionId: tx,
      origin: { deviceId: 't32', sessionId: 's' },
      action: { kind: 'edit', label: 'T32', operations: ops },
    });
  const acked = [];
  const ack = [];
  let prev = null;
  // Create, then a chain of edits; kill the hub with one in flight.
  for (let i = 0; i < N; i++) {
    const ops =
      i === 0
        ? [{ op: 'doc.create', doc, path: 'ui/t32.tsx', lanes: { html: src(0) } }]
        : [{ op: 'lane.replace', doc, lane: 'html', base: sha(prev), content: src(i) }];
    const tx = `tx_t32_${i}_${Math.random().toString(36).slice(2, 10)}`;
    const t0 = performance.now();
    const r = await api(hub, 'proposals', envelope(ops, tx));
    const ms = performance.now() - t0;
    if (r.body?.status !== 'accepted') throw new Error(`proposal ${i} ${JSON.stringify(r.body)}`);
    ack.push(ms);
    acked.push({ tx, revision: r.body.revision, content: src(i) });
    prev = src(i);
  }
  report.ackMs = { p50: pct(ack, 0.5), p95: pct(ack, 0.95), p99: pct(ack, 0.99), n: ack.length };
  // One more proposal in flight at the kill.
  const inflightTx = `tx_t32_inflight_${Date.now()}`;
  const inflight = api(
    hub,
    'proposals',
    envelope([{ op: 'lane.replace', doc, lane: 'html', base: sha(prev), content: src(N) }], inflightTx)
  ).catch(() => null);
  await new Promise((r) => setTimeout(r, 5));
  hub.proc.kill('SIGKILL');
  const inflightAnswer = await inflight;
  report.killedWithInflight = { answered: !!inflightAnswer?.body?.status };

  // Cloud: a new hub on a FRESH data directory — every local disk is gone and
  // only the Durable Object remains. Self-host: the same data volume (the
  // store lives on it; the process and its memory are what died).
  hub = await startHub(storeUrl ? fresh() : dirs[0]);
  const after = (await api(hub, 'bootstrap')).body;
  epoch = after.epoch;
  const revs = [];
  let cursor = 0;
  for (;;) {
    const page = (await api(hub, `revisions?after=${cursor}&limit=200`)).body?.revisions ?? [];
    if (!page.length) break;
    revs.push(...page);
    cursor = page[page.length - 1].revision;
    if (page.length < 200) break;
  }
  const byTx = new Map(revs.map((r) => [r.transactionId ?? r.tx ?? r.actionId, r]));
  const lost = acked.filter((a) => !revs.some((r) => r.revision === a.revision));
  const head = after.docs.find((d) => d.doc === doc);
  const blob = head ? (await api(hub, `blobs/${head.lanes.html.hash}`)).body : null;
  const expectedHead = inflightAnswer?.body?.status === 'accepted' ? src(N) : prev;
  const headMatches = blob?.body === expectedHead || blob?.body === src(N) || blob?.body === prev;
  // The replayed document (reconciled on boot) equals the accepted head.
  const lane = (await api(hub, `lane?doc=${encodeURIComponent(doc)}&lane=html`)).body;
  report.afterKill = {
    revisionsInStore: revs.length,
    acknowledgedLost: lost.length,
    duplicateRevisions: revs.length - new Set(revs.map((r) => r.revision)).size,
    distinctActions: new Set(revs.map((r) => r.actionId)).size,
    headIsAnAcknowledgedOrInflightValue: headMatches,
    inflightCommitted: blob?.body === src(N),
    laneRoute: lane?.body !== undefined ? lane.body === blob?.body : false,
    byTxCount: byTx.size,
  };
  report.ok =
    lost.length === 0 && report.afterKill.duplicateRevisions === 0 && headMatches === true;
} catch (err) {
  report.ok = false;
  report.error = String(err?.stack ?? err);
} finally {
  hub.proc.kill('SIGTERM');
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
