// /health endpoint returns the documented JSON shape.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { createHub, gitLockState, STALE_GIT_LOCK_MS } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const PORT = Number.parseInt(process.env.HUB_TEST_PORT ?? '14392', 10);

let hub;
let dataDir;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-health-'));
  const built = createHub({ port: PORT, dataDir, secret: '', verbose: false });
  hub = built.server;
  await hub.listen();
});

afterEach(async () => {
  if (hub) await hub.destroy();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('GET /health returns JSON with expected fields', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/health`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, 'string');
  assert.equal(typeof body.uptimeMs, 'number');
  assert.ok(body.uptimeMs >= 0);
  assert.equal(body.port, PORT);
  // dataDir is a server filesystem path — deliberately OMITTED from the
  // unauthenticated /health payload (recon over-share; security review).
  // It stays in the authenticated /admin/api/status response.
  assert.equal(body.dataDir, undefined);
  assert.equal(body.tokenCount, 0);
  assert.equal(body.authMode, 'dev');
});

test('/health names the RELEASE, beside the bytes', async () => {
  const body = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  // The field the post-deploy gate in cells-deploy.yml compares to the tag it
  // just deployed. It must never be absent: a gate that reads `undefined` and
  // keeps polling looks like a cold start, not like a stale image.
  assert.equal(typeof body.releaseVersion, 'string');
  assert.match(body.releaseVersion, /^\d+\.\d+\.\d+/);
  // And it must not be the 0.0.0 placeholder the app manifests carried before
  // they joined the release line — that is what made `/health` unreadable.
  assert.notEqual(body.releaseVersion, '0.0.0');
});

test('the client identity is a TOP-LEVEL field, not nested under studio', () => {
  // THE SHAPE IS A CONTRACT, because a CI gate reads it with `jq`.
  //
  // `cells-deploy.yml`'s post-deploy gate shipped reading
  // `.studio.client.artifacts[…]`, which is always absent — the payload builder
  // spreads `{ client: identity }` as a SIBLING of `studio`. The gate could
  // only ever time out, and it went green in review because the unit test's
  // fixture was hand-written to match the same wrong assumption. Pinning it
  // here, at the producer, is what stops a consumer from asserting its author's
  // guess: this test reads the real builder's real output.
  //
  // Asserted against the source rather than a live payload because `client`
  // only appears when a studio subprocess is attached, which a hub test does
  // not have — and a gate whose shape is only checked when a studio happens to
  // be up is the gate that let this through.
  const src = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const payload = src.slice(src.indexOf('function buildStatusPayload'));
  const body = payload.slice(0, payload.indexOf('\nfunction '));
  const clientAt = body.indexOf('{ client: identity }');
  assert.ok(clientAt > 0, '`client` is no longer spread as `{ client: identity }` — has it moved?');

  // Where the `studio: { … }` literal actually ends, by BALANCING BRACES rather
  // than guessing an indent. The first cut of this assertion searched for a
  // closing brace at a fixed indent and matched the enclosing ternary's instead,
  // so it failed on correct code — the same species of mistake as the bug it
  // guards, one level up.
  const studioAt = body.indexOf('studio: {');
  assert.ok(studioAt > 0, 'no `studio: {` block — has the payload moved?');
  let depth = 0;
  let studioEnd = -1;
  for (let i = body.indexOf('{', studioAt); i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}' && --depth === 0) {
      studioEnd = i;
      break;
    }
  }
  assert.ok(studioEnd > studioAt, 'could not find the end of the `studio` object');
  assert.ok(
    clientAt > studioEnd,
    '`client` moved INSIDE `studio` — scripts/verify-fleet-release.sh reads it at the top level'
  );
});

test('tokenCount + authMode reflect token store state', async () => {
  addToken(dataDir, { label: 'alice' });
  addToken(dataDir, { label: 'bob' });

  const res = await fetch(`http://127.0.0.1:${PORT}/health`);
  const body = await res.json();
  assert.equal(body.tokenCount, 2);
  assert.equal(body.authMode, 'tokens');
});

test('uptimeMs grows monotonically across two probes', async () => {
  const a = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  await new Promise((r) => setTimeout(r, 25));
  const b = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  assert.ok(b.uptimeMs > a.uptimeMs, `expected ${b.uptimeMs} > ${a.uptimeMs}`);
});

// ------------------------------------------------ D5: the stuck git lock

test('a stale index.lock is reported as a fact, and does not take the cell down', () => {
  // `index.lock` left behind by a killed git process means every subsequent
  // commit fails: the cell keeps serving, the customer keeps working, and
  // nothing is being SAVED. The tell is age — a lock a second old is a commit
  // happening, a lock ten minutes old is a commit that never will.
  const repo = mkdtempSync(join(tmpdir(), 'maude-hub-lock-'));
  try {
    assert.deepEqual(gitLockState(repo), { present: false });

    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.git', 'index.lock'), '');

    const fresh = gitLockState(repo);
    assert.equal(fresh.present, true);
    assert.equal(fresh.stale, false, 'a lock written just now is an operation in flight');

    const old = gitLockState(repo, { now: () => Date.now() + STALE_GIT_LOCK_MS + 1000 });
    assert.equal(old.stale, true);
    assert.ok(old.ageMs > STALE_GIT_LOCK_MS);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// Cloud Phase 26 — WHAT /health MAY SAY TO A STRANGER.
//
// This endpoint is unauthenticated and internet-reachable: every cell is a
// Worker custom domain, so `<project>.cloud.maude.sh` is in Certificate
// Transparency and the ids are not secret. The first cut of the tenant-stats
// work put a customer's canvas count, asset bytes and live build counters
// here — a larger over-share than the `dataDir` this same handler already
// drops for being one, and a recursive filesystem walk anybody could trigger.
// The counts now need the tenant's own derived secret.

test('an anonymous /health carries no tenant counts, and does not walk the disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-hub-health-gate-'));
  const built = createHub({ port: PORT + 1, dataDir: dir, secret: 'cell-secret', verbose: false });
  await built.server.listen();
  try {
    const body = await (await fetch(`http://127.0.0.1:${PORT + 1}/health`)).json();
    assert.equal(body.stats, undefined, 'a stranger learns nothing about what is stored here');
    // The posture half is unchanged — a router still gets what it probes for.
    assert.equal(typeof body.ok, 'boolean');
    assert.equal(typeof body.version, 'string');
    assert.equal(body.dataDir, undefined);
  } finally {
    await built.server.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a WRONG secret is no better than none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-hub-health-wrong-'));
  const built = createHub({ port: PORT + 2, dataDir: dir, secret: 'cell-secret', verbose: false });
  await built.server.listen();
  try {
    for (const auth of ['Bearer wrong', 'Bearer ', 'cell-secret', 'Bearer cell-secre']) {
      const res = await fetch(`http://127.0.0.1:${PORT + 2}/health`, {
        headers: { authorization: auth },
      });
      assert.equal((await res.json()).stats, undefined, `admitted with "${auth}"`);
    }
  } finally {
    await built.server.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a hub with NO secret configured admits nobody to the counts', async () => {
  // Fail closed: a self-hosted hub that never set HUB_SECRET must not treat
  // every caller as its control plane.
  const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
    headers: { authorization: 'Bearer ' },
  });
  assert.equal((await res.json()).stats, undefined);
});

test('/health advertises the sync-v2 capability set — the compat matrix is BINDING', async () => {
  // A capability-gated client (DDR-226 §10) reads this to decide whether it may
  // attach the control channel and relax its polling. A hub with no checkout —
  // which is every self-hosted sync hub, and this test's hub — has no file
  // plane and therefore no `ledger`, and a client MUST keep its legacy lanes
  // against it. The field being present-and-empty is the point: it says "this
  // hub speaks capabilities and has none", which is a different fact from an
  // older hub that omits the field entirely.
  const body = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  assert.ok(Array.isArray(body.capabilities), 'capabilities must be advertised as an array');
  assert.equal(body.capabilities.includes('ledger'), false, 'no checkout ⇒ no file journal');
});

// ------------------------------------------- cell materializer Phase 0

test('a workspace hub ALWAYS reports disk + hydrate — the state publicly, the bytes to the cell', async () => {
  // The 2026-10-01 Alligators restart loop was invisible until the disk was
  // already full: nothing on /health said how close it was. Both keys are
  // present even before any restore (no object storage ⇒ `hydrate: null`),
  // so a monitor can rely on them.
  //
  // But free bytes vs. the floor, polled from the internet, is a dial for how
  // much more to push to shut the write doors (Phase 0 attacker review #5):
  // the public payload carries only `pressure`; the bytes need the cell secret.
  const repo = mkdtempSync(join(tmpdir(), 'maude-hub-health-ws-'));
  mkdirSync(join(repo, '.design'), { recursive: true });
  const saved = process.env.MAUDE_REPO_DIR;
  process.env.MAUDE_REPO_DIR = repo;
  const secret = 'cell-secret-for-health-test-0123456789';
  const port = PORT + 7;
  const ownDir = mkdtempSync(join(tmpdir(), 'maude-hub-health-secret-'));
  const own = createHub({ port, dataDir: ownDir, secret, verbose: false }).server;
  await own.listen();
  try {
    const pub = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.deepEqual(Object.keys(pub.workspace.disk), ['pressure']);
    assert.equal(typeof pub.workspace.disk.pressure, 'boolean');
    assert.ok('hydrate' in pub.workspace, '`hydrate` must be a key even before any restore');
    assert.equal(pub.workspace.degraded, undefined, 'no disk error survived, nothing to report');

    const cell = await (
      await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { authorization: `Bearer ${secret}` },
      })
    ).json();
    for (const k of ['totalBytes', 'freeBytes', 'floorBytes']) {
      assert.equal(typeof cell.workspace.disk[k], 'number', k);
    }
    assert.equal(typeof cell.workspace.disk.pressure, 'boolean');
  } finally {
    await own.destroy();
    rmSync(ownDir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.MAUDE_REPO_DIR;
    else process.env.MAUDE_REPO_DIR = saved;
    rmSync(repo, { recursive: true, force: true });
  }
});
