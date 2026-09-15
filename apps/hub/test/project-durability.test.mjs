// Self-host durability under a real process kill — DDR-241 §2, plan T8/T11.
//
// The hub runs as a separate Node process (test/fixtures/serve-hub.mjs) with
// its store on better-sqlite3 (WAL, synchronous=FULL). Proposals are
// acknowledged, the process is SIGKILLed with one more in flight, and a new
// process on the same data directory must hold every acknowledged revision —
// and never a torn one (a head without its action, an action without its
// effects). The oracle is the restarted hub, not the one that answered.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { laneHash } from '../src/project-transactions/lanes.mjs';

const FIXTURE = new URL('./fixtures/serve-hub.mjs', import.meta.url).pathname;
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function start(dataDir, port = '0') {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [FIXTURE, dataDir, port, '--transactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout.on('data', (c) => {
      buf += c;
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        resolve({ proc, ...JSON.parse(line) });
        return;
      }
    });
    proc.stderr.on('data', (c) => {
      buf += c;
    });
  });
}

const src = (t) => `export default () => <h1 title="${t}">x</h1>;\n`;

test('acknowledged revisions survive SIGKILL of the hub process; nothing is torn', {
  timeout: 90_000,
}, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-durable-'));
  dirs.push(dataDir);
  let hub = await start(dataDir);
  const api =
    (h, token) =>
    async (route, init = {}) => {
      const r = await fetch(`${h.http}/api/projects/current/v1/${route}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      });
      return { status: r.status, body: await r.json() };
    };
  const state = (await api(hub, hub.tokens.owner)('mode')).body;
  const epoch = state.epoch;
  const doc = 'ui-durable';
  let n = 0;
  const propose = (h, operations) =>
    api(h, h.tokens.alice)('proposals', {
      method: 'POST',
      body: JSON.stringify({
        protocol: 1,
        projectId: 'local',
        epoch,
        transactionId: `tx_durable_${++n}_${Date.now()}`,
        action: { kind: 'edit', label: 'durable', operations },
      }),
    });
  const c = await propose(hub, [
    { op: 'doc.create', doc, path: 'ui/durable.tsx', lanes: { html: src('v0') } },
  ]);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  let acknowledged = c.body.revision;
  let prev = src('v0');
  for (let i = 1; i <= 25; i++) {
    const next = src(`v${i}`);
    const r = await propose(hub, [
      { op: 'lane.replace', doc, lane: 'html', base: laneHash(prev), content: next },
    ]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    acknowledged = r.body.revision;
    prev = next;
  }
  // One more in flight when the process dies — its outcome may go either way.
  const inflight = propose(hub, [
    { op: 'lane.replace', doc, lane: 'html', base: laneHash(prev), content: src('in flight') },
  ]).catch(() => null);
  hub.proc.kill('SIGKILL');
  await once(hub.proc, 'exit');
  await inflight;

  hub = await start(dataDir);
  try {
    const s = (await api(hub, hub.tokens.owner)('mode')).body;
    assert.ok(s.revision >= acknowledged, `revision ${s.revision} >= acknowledged ${acknowledged}`);
    const revs = (await api(hub, hub.tokens.owner)('revisions?limit=1000')).body.revisions;
    assert.equal(revs.length, s.revision, 'one action per revision — no torn commit');
    for (const r of revs) assert.ok(r.effects.length > 0, `revision ${r.revision} has its effects`);
    const boot = (await api(hub, hub.tokens.owner)('bootstrap')).body;
    const head = boot.docs.find((d) => d.doc === doc).lanes.html.hash;
    assert.ok(
      head === laneHash(src('v25')) || head === laneHash(src('in flight')),
      'the head is the last acknowledged value or the in-flight one'
    );
    // And the accepted document itself is rebuilt from the store.
    const blob = (await api(hub, hub.tokens.owner)(`blobs/${head}`)).body.body;
    assert.ok(blob === src('v25') || blob === src('in flight'));
  } finally {
    hub.proc.kill('SIGTERM');
    await once(hub.proc, 'exit');
  }
});
