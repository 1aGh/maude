// Control-plane Worker routes + cron — Cloud Phase 12.
//
// The D1 binding is better-sqlite3 behind the SAME statement interface
// (db.mjs `d1FromSqlite`) — real SQLite semantics, not a mock of an API
// nobody has seen misbehave. schema.sql is applied verbatim, so a schema
// drift breaks these tests before it breaks production.

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { d1FromSqlite, enqueueReconcile, listProjects, pendingJobs } from './db.mjs';
import { MIGRATIONS } from './migrate.mjs';
import worker, { reconcileSweep } from './worker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(here, 'schema.sql'), 'utf8');
const NOW = 1_800_000_000_000;
const SECRET = 'whsec_worker_test';

function freshEnv({ fetchImpl } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  // Baseline AND migrations — the Worker assumes a migrated schema (its cron
  // applies them before every sweep), so a fixture that stops at schema.sql
  // fails on whatever column shipped last rather than on the behaviour under
  // test. The one place that deliberately starts un-migrated is the test for
  // the migration step itself, further down.
  sqlite.exec(SCHEMA);
  for (const m of MIGRATIONS) for (const stmt of m.statements) sqlite.exec(stmt);
  sqlite.exec(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ${MIGRATIONS.map((m) => `(${m.version}, 0)`).join(',')}`
  );
  const env = {
    DB: d1FromSqlite(sqlite),
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_SECRET_KEY: 'sk_test_x',
  };
  if (fetchImpl) env._fetch = fetchImpl;
  return { env, sqlite };
}

function seedProject(sqlite, { id = 'alligators', state = 'active', subscription = 'sub_1' } = {}) {
  sqlite
    .prepare(
      "INSERT INTO accounts (id, email, created_at) VALUES ('acct_1', 'a@example.com', ?) ON CONFLICT DO NOTHING"
    )
    .run(NOW);
  sqlite
    .prepare(
      'INSERT INTO projects (id, account_id, name, state, state_since, subscription_id, created_at, cell_running) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      id,
      'acct_1',
      id,
      state,
      NOW - 86_400_000,
      subscription,
      NOW - 86_400_000,
      state === 'active' ? 1 : 0
    );
}

// Signed with the CURRENT clock so the tolerance window passes in a live run.
function signedRequestNow(body) {
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  return new Request('https://cloud.maude.sh/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${t},v1=${sig}` },
    body,
  });
}

// ------------------------------------------------------------------- health

test('/health reports D1 reachability truthfully', async () => {
  const { env } = freshEnv();
  const res = await worker.fetch(new Request('https://x/health'), env);
  const body = await res.json();
  assert.equal(res.status, 200);
  // Cloud Phase 25 A-1 — the storage posture is part of health, because
  // shipping the per-tenant path is not the same as being in it: unconfigured
  // means every cell is still on the fleet-wide key, and that must be readable
  // rather than assumed.
  assert.deepEqual(body, { ok: true, version: 'phase-13', d1: 'ok', r2Creds: 'legacy-shared' });

  const configured = await worker.fetch(new Request('https://x/health'), {
    ...freshEnv().env,
    CF_ACCOUNT_ID: 'acct',
    R2_CREDS_TOKEN: 't',
    R2_PARENT_ACCESS_KEY_ID: 'k',
    MAUDE_R2_BUCKET: 'b',
  });
  assert.equal((await configured.json()).r2Creds, 'per-tenant');

  const broken = await worker.fetch(new Request('https://x/health'), {
    DB: { prepare: () => ({ first: () => Promise.reject(new Error('down')) }) },
  });
  const b = await broken.json();
  assert.equal(b.ok, false);
  assert.equal(b.d1, 'unreachable');
});

// ------------------------------------------------------------------ webhook

test('an unsigned webhook is a bare 400 — no reason in the response', async () => {
  const { env } = freshEnv();
  const res = await worker.fetch(
    new Request('https://x/webhooks/stripe', { method: 'POST', body: '{}' }),
    env
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false });
});

test('a verified webhook ENQUEUES a job — it never mutates project state', async () => {
  const { env, sqlite } = freshEnv();
  seedProject(sqlite);
  const body = JSON.stringify({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'past_due' } },
  });
  const res = await worker.fetch(signedRequestNow(body), env);
  assert.deepEqual(await res.json(), { ok: true, handled: true });

  const jobs = await pendingJobs(env.DB);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].project_id, 'alligators');
  assert.equal(jobs[0].reason, 'webhook');
  // The webhook carried a status; the row must NOT have moved — the reconciler
  // re-derives from Stripe, never trusts the event payload.
  const row = sqlite.prepare("SELECT state FROM projects WHERE id='alligators'").get();
  assert.equal(row.state, 'active');
});

test('an event for an unknown project is ACKED and audited, never retried into a loop', async () => {
  const { env, sqlite } = freshEnv();
  const body = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { metadata: { project_id: 'ghost' } } },
  });
  const res = await worker.fetch(signedRequestNow(body), env);
  assert.deepEqual(await res.json(), { ok: true, handled: false });
  const audit = sqlite.prepare('SELECT action FROM audit_log').all();
  assert.deepEqual(
    audit.map((a) => a.action),
    ['webhook-unknown-project']
  );
});

// --------------------------------------------------------------------- cron

function stubStripe(subscriptionsById) {
  return async (url) => {
    const id = String(url).split('/').pop();
    const sub = subscriptionsById[id];
    if (sub === undefined) return { status: 404, ok: false };
    if (sub === 'DOWN') return { status: 503, ok: false };
    return { status: 200, ok: true, json: async () => sub };
  };
}

test('the sweep drains jobs AND sweeps unswept projects — a missed webhook costs an hour, not correctness', async (t) => {
  const { env, sqlite } = freshEnv();
  seedProject(sqlite, { id: 'jobbed', subscription: 'sub_j' });
  seedProject(sqlite, { id: 'quiet', subscription: 'sub_q' });
  await enqueueReconcile(env.DB, { projectId: 'jobbed', reason: 'webhook' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = stubStripe({
    sub_j: { status: 'active' },
    sub_q: { status: 'active' },
  });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const outcomes = await reconcileSweep(env, { now: NOW });
  assert.deepEqual(
    outcomes.map((o) => [o.projectId, o.outcome]),
    [
      ['jobbed', 'ok'],
      ['quiet', 'ok'],
    ]
  );
  assert.equal((await pendingJobs(env.DB)).length, 0, 'job drained');
});

test('a Stripe outage HALTS the project untouched — an outage must not start the export clock', async (t) => {
  const { env, sqlite } = freshEnv();
  seedProject(sqlite, { id: 'alligators', subscription: 'sub_1' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = stubStripe({ sub_1: 'DOWN' });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const outcomes = await reconcileSweep(env, { now: NOW });
  assert.equal(outcomes[0].outcome, 'halted');
  const row = sqlite.prepare("SELECT state FROM projects WHERE id='alligators'").get();
  assert.equal(row.state, 'active', 'state untouched during the outage');
});

test('a VANISHED subscription (404) alerts and holds — it is an anomaly, not a cancellation', async (t) => {
  // A customer who cancels shows up as status "canceled" (→ suspended, the
  // lifecycle path). A subscription the API cannot FIND is something else —
  // wrong id, deleted sandbox data — and active→pending is an illegal
  // transition the reconciler refuses. Suspending a paying customer over an
  // anomaly would be the bug; the designed behavior is: touch nothing, alert.
  const { env, sqlite } = freshEnv();
  seedProject(sqlite, { id: 'alligators', subscription: 'sub_gone' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = stubStripe({}); // everything 404s
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const outcomes = await reconcileSweep(env, { now: NOW });
  assert.equal(outcomes[0].outcome, 'ok');
  assert.ok(
    outcomes[0].actions.some((a) => a.kind === 'alert'),
    `expected an alert action, got ${JSON.stringify(outcomes[0].actions)}`
  );
  const row = sqlite
    .prepare("SELECT state, cell_running FROM projects WHERE id='alligators'")
    .get();
  assert.equal(row.state, 'active', 'state is held, not silently degraded');
  assert.equal(row.cell_running, 1, 'the running cell is left alone');
});

// ------------------------------------------------- the actions become real
//
// Cloud Phase 24 B3. Until this phase `runOne` computed suspend-cell /
// resume-cell / send-export and wrote them into the job detail — the comment
// said "become real in Phase 15" and it was still saying it in Phase 23. A
// tenant who stopped paying kept a serving cell, and the export-before-
// teardown guarantee never sent itself.

/** A network that records every call and answers everything plausibly. */
function stubNetwork({ subscriptions = {}, exportOk = true, calls = [] } = {}) {
  return async (input, init = {}) => {
    const url = String(input?.url ?? input);
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (url.includes('api.stripe.com')) {
      const id = url.split('/').pop();
      const sub = subscriptions[id];
      if (sub === undefined) return { status: 404, ok: false };
      return { status: 200, ok: true, json: async () => sub };
    }
    if (url.includes('/api/export')) {
      return new Response(JSON.stringify({ ok: exportOk }), { status: exportOk ? 200 : 502 });
    }
    if (url.includes('api.resend.com')) return Response.json({ id: 'em_1' });
    return Response.json({ success: true, result: [] });
  };
}

/** An in-memory R2 binding — list + delete, the two the purge needs. */
function fakeExports(keys = []) {
  const store = new Set(keys);
  return {
    store,
    async list({ prefix }) {
      return { objects: [...store].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
    async delete(keys) {
      for (const k of [].concat(keys)) store.delete(k);
    },
  };
}

test('suspension builds the copy and emails it BEFORE the address goes away', async (t) => {
  const { env, sqlite } = freshEnv();
  seedProject(sqlite, { id: 'alligators', state: 'active', subscription: 'sub_1' });
  // The subscription has read non-active for a day. Since 2026-08-01 a single
  // adverse reading no longer tears anything down, so a fixture that means
  // "this really is cancelled" has to say the reading has persisted.
  sqlite
    .prepare("UPDATE projects SET adverse_since = ? WHERE id = 'alligators'")
    .run(NOW - 86_400_000);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubNetwork({ subscriptions: { sub_1: { status: 'canceled' } }, calls });
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  Object.assign(env, {
    CELL_SECRET_MASTER: 'master',
    CF_PROVISION_TOKEN: 'cf',
    CF_ACCOUNT_ID: 'acct',
    RESEND_API_KEY: 'k',
  });

  await reconcileSweep(env, { now: NOW });

  const order = calls.map((c) => c.url);
  const exported = order.findIndex((u) => u.includes('/api/export'));
  const detached = order.findIndex((u) => u.includes('api.cloudflare.com'));
  assert.ok(exported >= 0, 'the export was actually built');
  assert.ok(detached >= 0, 'the address was actually detached');
  assert.ok(exported < detached, 'DDR-193 §3: the copy goes out before the teardown');

  const mail = calls.find((c) => c.url.includes('api.resend.com'));
  assert.ok(mail, 'the owner was told');
  assert.match(JSON.parse(mail.body).subject, /has paused/);

  const row = sqlite
    .prepare("SELECT state, export_sent_at FROM projects WHERE id='alligators'")
    .get();
  assert.equal(row.state, 'suspended');
  assert.ok(row.export_sent_at > 0, 'the guarantee is recorded, not merely intended');
});

test('the promised deletion actually deletes — retention over, bytes gone', async (t) => {
  const { env, sqlite } = freshEnv();
  seedProject(sqlite, { id: 'alligators', state: 'exported', subscription: 'sub_1' });
  sqlite
    .prepare("UPDATE projects SET export_sent_at = ?, state_since = ? WHERE id = 'alligators'")
    .run(NOW - 40 * 86_400_000, NOW - 40 * 86_400_000);
  // A DELIVERED export must be PRESENT — since the 2026-08-01 review the purge
  // asserts the artefact rather than trusting the flag.
  env.EXPORTS = fakeExports([
    'tenants/alligators/exports/20260801T000000Z/repo.bundle',
    'tenants/alligators/repo.bundle',
    'tenants/other-club/repo.bundle',
  ]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubNetwork({ subscriptions: { sub_1: { status: 'canceled' } } });
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  Object.assign(env, {
    CELL_SECRET_MASTER: 'master',
    CF_PROVISION_TOKEN: 'cf',
    CF_ACCOUNT_ID: 'a',
  });

  await reconcileSweep(env, { now: NOW });

  assert.equal(
    sqlite.prepare("SELECT state FROM projects WHERE id='alligators'").get().state,
    'purged'
  );
  assert.deepEqual([...env.EXPORTS.store], ['tenants/other-club/repo.bundle']);
});

// Found by the D3 Stripe-test-clock run, 2026-08-01: the "two days left" mail
// went out TWICE. `audit()` defaults to the wall clock while the guard compares
// against `state_since`, which the sweep wrote with ITS clock — let the two
// diverge and the guard stops matching and re-sends on every hourly tick.
test('the deletion warning is sent once, however many times the cron ticks', async (t) => {
  const { env, sqlite } = freshEnv();
  const pausedAt = NOW - 29 * 86_400_000; // inside the 28–30 day warning window
  seedProject(sqlite, { id: 'alligators', state: 'suspended', subscription: 'sub_1' });
  sqlite
    .prepare(
      "UPDATE projects SET state_since = ?, export_sent_at = ?, cell_running = 0 WHERE id='alligators'"
    )
    .run(pausedAt, pausedAt);
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubNetwork({ subscriptions: { sub_1: { status: 'canceled' } } });
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  Object.assign(env, { CELL_SECRET_MASTER: 'master', RESEND_API_KEY: 'k' });

  // Three hourly ticks inside the window.
  for (const tick of [0, 3600_000, 7200_000]) await reconcileSweep(env, { now: NOW + tick });

  const warnings = sqlite
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'do.warn-deletion'")
    .get().n;
  assert.equal(warnings, 1, 'one warning, not one per tick');
});

// The other half of the 2026-08-01 critical finding. `reconcile()` decides the
// purge from a FLAG; the executor must check the ARTEFACT. Trusting the flag is
// how a project whose export never actually landed gets destroyed anyway.
test('purge REFUSES when no export is in storage, and says so', async (t) => {
  const { env, sqlite } = freshEnv();
  seedProject(sqlite, { id: 'alligators', state: 'exported', subscription: 'sub_1' });
  sqlite
    .prepare("UPDATE projects SET export_sent_at = ?, state_since = ? WHERE id = 'alligators'")
    .run(NOW - 40 * 86_400_000, NOW - 40 * 86_400_000);
  // The flag says an export went out. Storage says otherwise — storage wins.
  env.EXPORTS = fakeExports(['tenants/alligators/repo.bundle']);
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubNetwork({ subscriptions: { sub_1: { status: 'canceled' } } });
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  Object.assign(env, {
    CELL_SECRET_MASTER: 'master',
    CF_PROVISION_TOKEN: 'cf',
    CF_ACCOUNT_ID: 'a',
  });

  await reconcileSweep(env, { now: NOW });

  assert.deepEqual([...env.EXPORTS.store], ['tenants/alligators/repo.bundle'], 'nothing destroyed');
  const said = sqlite
    .prepare("SELECT detail FROM audit_log WHERE action = 'do.purge-data' ORDER BY at DESC LIMIT 1")
    .get();
  assert.match(said.detail, /refusing to purge/);
});

test('a paying tenant is never touched by any of the teardown effects', async (t) => {
  const { env, sqlite } = freshEnv();
  seedProject(sqlite, { id: 'alligators', state: 'active', subscription: 'sub_1' });
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubNetwork({ subscriptions: { sub_1: { status: 'active' } }, calls });
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  Object.assign(env, {
    CELL_SECRET_MASTER: 'master',
    CF_PROVISION_TOKEN: 'cf',
    CF_ACCOUNT_ID: 'a',
  });

  await reconcileSweep(env, { now: NOW });
  assert.ok(!calls.some((c) => c.url.includes('/api/export')));
  assert.ok(!calls.some((c) => c.url.includes('api.cloudflare.com')));
  assert.ok(!calls.some((c) => c.url.includes('_cell/restart')));
});

test('the sweep is a FIXED POINT — a second run right after does nothing', async (t) => {
  const { env, sqlite } = freshEnv();
  seedProject(sqlite, { id: 'alligators', subscription: 'sub_1' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = stubStripe({ sub_1: { status: 'active' } });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  await reconcileSweep(env, { now: NOW });
  const second = await reconcileSweep(env, { now: NOW + 1000 });
  assert.ok(
    second.every((o) => o.outcome === 'ok' && o.actions.length === 0),
    `second sweep must be action-free, got ${JSON.stringify(second)}`
  );
});

test('listProjects returns every row — the sweep has no silent cap', async () => {
  const { env, sqlite } = freshEnv();
  for (let i = 0; i < 7; i++) seedProject(sqlite, { id: `p${i}`, subscription: `s${i}` });
  assert.equal((await listProjects(env.DB)).length, 7);
});

test('the cron applies pending migrations BEFORE sweeping', async () => {
  // The Phase-13 bug: code expected schema v2, live D1 was on v1, and every
  // signup failed on a missing column behind a friendly error message.
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  // Only the baseline — as the live database actually was.
  sqlite.exec(SCHEMA);
  assert.equal(sqlite.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 1);

  await worker.scheduled({}, { DB });
  // Derived, not literal — the point is "up to what the code expects", and a
  // hardcoded number turns every future migration into an edit to a test about
  // something else.
  const latest = Math.max(...MIGRATIONS.map((m) => m.version));
  assert.equal(
    sqlite.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,
    latest,
    'the cron brought the schema up to what the code expects'
  );
});

test('a failed migration STOPS the sweep — never reconcile on an unknown schema', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (m) => errors.push(m);
  try {
    await worker.scheduled(
      {},
      {
        DB: {
          prepare: () => {
            throw new Error('d1 down');
          },
        },
      }
    );
  } finally {
    console.error = realError;
  }
  assert.ok(errors.some((e) => /\[migrate\] failed/.test(e)));
});

// ------------------------------------------------------ tenant stats (Phase 26)

/**
 * A cell's `/health` answer, in the shape `probeCellBody` actually reads.
 *
 * It reads `.text()` rather than `.json()` — the body comes from a process we
 * do not trust to its peers, so it is size-bounded before it is parsed.
 */
function cellHealth(body) {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (k === 'content-length' ? String(text.length) : null) },
    text: async () => text,
  };
}
//
// The cell counts what it holds; the sweep that already asks it `/health`
// carries the answer to Analytics Engine. Never into D1 — schema.sql earns
// "a total loss of this database costs a customer nothing" by holding no
// design content, and a counts table would be the first crack in that.

test('the hourly sweep never wakes a sleeping cell to read its stats', async () => {
  // Every sweep used to START each sleeping container just to count it, and a
  // start re-hydrates the whole project from R2 (Alligators: ~7 GB an hour,
  // all of September). The probe asks not to wake; a sleeping cell says so.
  const written = [];
  const { env, sqlite } = freshEnv();
  env.EVENTS = { writeDataPoint: (dp) => written.push(dp) };
  seedProject(sqlite, { id: 'alligators', subscription: 'sub_1' });

  const healthAsks = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/health')) {
      healthAsks.push(init?.headers ?? {});
      return cellHealth({ state: 'asleep' });
    }
    return stubStripe({ sub_1: { status: 'active' } })(url);
  };
  try {
    await reconcileSweep(env, { now: NOW });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.ok(healthAsks.length > 0, 'the sweep still asks');
  for (const h of healthAsks) assert.equal(h['x-maude-wake'], 'never');
  // Asleep is unknown, and unknown is never a zero on the board.
  assert.equal(
    written.find((dp) => dp.indexes[0] === 'tenant_stats'),
    undefined
  );
});

test('the sweep carries a cell’s own counts to analytics, and never to D1', async () => {
  const written = [];
  const { env, sqlite } = freshEnv();
  env.EVENTS = { writeDataPoint: (dp) => written.push(dp) };
  seedProject(sqlite, { id: 'alligators', subscription: 'sub_1' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/health')) {
      return cellHealth({
        ok: true,
        stats: {
          canvases: 12,
          artboards: 40,
          designSystems: 2,
          assetsBytes: 900,
          render: { builds: 6, cacheHits: 5, cacheMisses: 1, windowStartedAt: 7 },
        },
      });
    }
    return stubStripe({ sub_1: { status: 'active' } })(url);
  };
  try {
    await reconcileSweep(env, { now: NOW });
  } finally {
    globalThis.fetch = realFetch;
  }

  const stats = written.find((dp) => dp.indexes[0] === 'tenant_stats');
  assert.ok(stats, 'the counts reached analytics');
  assert.equal(stats.blobs[1], 'alligators');
  assert.deepEqual(stats.doubles, [12, 40, 2, 900]);

  const render = written.find((dp) => dp.indexes[0] === 'tenant_render');
  assert.ok(render, 'the build counters reached analytics');
  // Two counts travel; the ratio is divided at read time.
  assert.equal(render.doubles[1], 5);
  assert.equal(render.doubles[2], 1);

  // And nothing about the customer's content landed in the control plane.
  const columns = sqlite
    .prepare('PRAGMA table_info(projects)')
    .all()
    .map((c) => c.name);
  for (const forbidden of ['canvases', 'artboards', 'assets_bytes', 'builds']) {
    assert.ok(!columns.includes(forbidden), `projects grew a "${forbidden}" column`);
  }
});

test('a cell that reports no stats contributes NOTHING — unknown is never zero', async () => {
  // An older image, mid-canary. The board must render an em-dash for it, and
  // the only way that stays true is if the sweep emits no datapoint at all.
  const written = [];
  const { env, sqlite } = freshEnv();
  env.EVENTS = { writeDataPoint: (dp) => written.push(dp) };
  seedProject(sqlite, { id: 'oldimage', subscription: 'sub_1' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/health')) return cellHealth({ ok: true, version: 'phase-24' });
    return stubStripe({ sub_1: { status: 'active' } })(url);
  };
  try {
    await reconcileSweep(env, { now: NOW });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(written.filter((dp) => dp.indexes[0].startsWith('tenant_')).length, 0);
});

test('an unreachable cell does not stop the sweep, and reports no figures', async () => {
  const written = [];
  const { env, sqlite } = freshEnv();
  env.EVENTS = { writeDataPoint: (dp) => written.push(dp) };
  seedProject(sqlite, { id: 'alligators', subscription: 'sub_1' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/health')) throw new Error('connect ETIMEDOUT');
    return stubStripe({ sub_1: { status: 'active' } })(url);
  };
  let outcomes;
  try {
    outcomes = await reconcileSweep(env, { now: NOW });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(outcomes[0].outcome, 'ok', 'the subscription pass still ran');
  assert.equal(written.filter((dp) => dp.indexes[0].startsWith('tenant_')).length, 0);
});
