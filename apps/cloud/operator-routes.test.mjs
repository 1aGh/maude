// Cloud Phase 26 Stage 1 — the operator routes.
//
// D1 is better-sqlite3 behind db.mjs's `d1FromSqlite`, the same harness
// worker.test.mjs uses: real SQLite semantics against the real schema, so a
// column that moves breaks a test rather than a deploy.
//
// Most of what is asserted here is refusal. That is deliberate — this surface
// reads every tenant's row, and the interesting behaviours are the ones where
// it declines to.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { d1FromSqlite } from './db.mjs';
import { MIGRATIONS } from './migrate.mjs';
import { deriveCsrf } from './operator.mjs';
import { handleOperatorRoutes } from './operator-routes.mjs';
import worker from './worker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(here, 'schema.sql'), 'utf8');

const OPERATOR = { id: 'acct_op', email: 'op@example.com' };
const CUSTOMER = { id: 'acct_1', email: 'a@example.com' };

function fresh({ operators = 'acct_op' } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  for (const m of MIGRATIONS) for (const stmt of m.statements) sqlite.exec(stmt);
  sqlite.exec(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ${MIGRATIONS.map((m) => `(${m.version}, 0)`).join(',')}`
  );
  sqlite.exec(
    `INSERT INTO accounts (id, email, created_at) VALUES
       ('acct_1', 'a@example.com', 1000), ('acct_op', 'op@example.com', 900)`
  );
  sqlite.exec(
    `INSERT INTO projects (id, account_id, name, state, state_since, plan, cell_running, created_at)
       VALUES ('alligators', 'acct_1', 'Brno Alligators', 'active', 0, 'project', 1, 1000)`
  );
  const env = {
    DB: d1FromSqlite(sqlite),
    OPERATOR_ACCOUNT_IDS: operators,
    // The CSRF token is derived from (session, key), so both halves have to
    // exist for the one write to be reachable at all.
    CELL_SECRET_MASTER: 'cell-secret-master',
  };
  return { env, sqlite };
}

/** The session the derived CSRF token is bound to. */
const SESSION = 'sess_operator';

const get = (path, headers = {}) =>
  new Request(`https://cloud.maude.sh${path}`, {
    headers: { cookie: `maude_session=${SESSION}`, ...headers },
  });

function post(path, fields, { session = SESSION } = {}) {
  const body = new URLSearchParams(fields);
  return new Request(`https://cloud.maude.sh${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(session ? { cookie: `maude_session=${session}` } : {}),
    },
    body,
  });
}

/** The token this session's own page would have rendered. */
const tokenFor = (env, session = SESSION) => deriveCsrf(session, env.CELL_SECRET_MASTER);

const call = (request, env, account, ctx = { waitUntil: (p) => p }) =>
  handleOperatorRoutes(request, env, { account, ctx });

const rows = (sqlite, sql) => sqlite.prepare(sql).all();

// -------------------------------------------------------------------- gating

describe('who gets in', () => {
  it('does not claim a path that is not ours', async () => {
    const { env } = fresh();
    assert.equal(await call(get('/'), env, OPERATOR), null);
    // The prefix match must not swallow a sibling route that merely starts
    // with the same letters.
    assert.equal(await call(get('/operators'), env, OPERATOR), null);
  });

  it('a signed-in NON-operator gets 404, never 403', async () => {
    // 403 confirms the surface exists and that this person is simply not on
    // the list. The precedent is openProject: "404 for everything that is not
    // sign in".
    const { env } = fresh();
    for (const path of ['/operator', '/operator/projects', '/operator/accounts']) {
      const res = await call(get(path), env, CUSTOMER);
      assert.equal(res.status, 404, path);
      assert.doesNotMatch(await res.text(), /fleet|operator/i);
    }
  });

  it('an unset allowlist disables the surface for EVERYBODY', async () => {
    // Turning it on is a deploy-time act. Until then the routes do not exist,
    // including for the account that would otherwise be the operator.
    const { env } = fresh({ operators: '' });
    assert.equal((await call(get('/operator'), env, OPERATOR)).status, 404);
  });

  it('a caller with no session gets the 404 an unknown URL gets — no redirect', async () => {
    // It used to be sent to /login?next=…, which told a stranger the path was
    // real (security review, 2026-11-24). An operator signs in at /login.
    const { env } = fresh();
    const res = await call(get('/operator/projects'), env, null);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('location'), null);
  });

  it('a BEARER-carrying caller with no cookie gets 404, not a login redirect', async () => {
    // The invariant this protects: a leaked device token must not become a
    // fleet key. Pointing a token-holder at a login page implies there is a
    // second door here; there is exactly one.
    const { env } = fresh();
    const res = await call(get('/operator', { authorization: 'Bearer pat_stolen' }), env, null);
    assert.equal(res.status, 404);
  });

  it('the module never imports the personal-token door', async () => {
    // Mechanically, not by convention. The two-door pattern is CORRECT at
    // worker.mjs:82 for opening one project, which is exactly why somebody
    // could copy it here in good faith.
    const source = readFileSync(join(here, 'operator-routes.mjs'), 'utf8');
    // Comments stripped first: the module's own header NAMES the door it must
    // not use, and a test that reads prose would go red for the explanation
    // rather than for the mistake.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const imported = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.ok(!imported.some((s) => s.includes('device-auth')), imported.join(', '));
    assert.doesNotMatch(code, /personalTokenAccount/);
  });

  it('a PAT-authenticated request never reaches the board through the worker either', async () => {
    // End to end, through the real router: the account worker.mjs hands us is
    // the cookie session, and there is no cookie here.
    const { env } = fresh();
    const res = await worker.fetch(get('/operator', { authorization: 'Bearer pat_stolen' }), env, {
      waitUntil: (p) => p,
    });
    assert.equal(res.status, 404);
    assert.doesNotMatch(await res.text(), /MRR|Fleet overview/);
  });
});

// --------------------------------------------------------------------- reads

describe('the read surfaces', () => {
  it('the overview renders the board and records that it was looked at', async () => {
    const { env, sqlite } = fresh();
    const res = await call(get('/operator'), env, OPERATOR);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Fleet overview/);
    assert.match(body, /MRR \(believed\)/);
    assert.match(body, /€19\b/);

    const [entry] = rows(sqlite, 'SELECT * FROM audit_log');
    assert.equal(entry.action, 'operator.board.viewed');
    assert.equal(entry.actor, 'operator:op@example.com');
    assert.equal(entry.account_id, 'acct_op');
  });

  it('the projects list shows every project with its owner', async () => {
    const { env } = fresh();
    const body = await (await call(get('/operator/projects'), env, OPERATOR)).text();
    assert.match(body, /alligators/);
    assert.match(body, /a@example\.com/);
  });

  it('the accounts list is audited as its own action', async () => {
    // Every customer's address in one place is the most break-glass read on
    // the surface; folding it into a generic page view would lose that.
    const { env, sqlite } = fresh();
    const body = await (await call(get('/operator/accounts'), env, OPERATOR)).text();
    assert.match(body, /a@example\.com/);
    assert.match(body, />1</, 'the owner holds one project');
    assert.equal(rows(sqlite, 'SELECT * FROM audit_log')[0].action, 'operator.accounts.viewed');
  });

  it('a project detail page records WHICH project was opened', async () => {
    const { env, sqlite } = fresh();
    const res = await call(get('/operator/projects/alligators'), env, OPERATOR);
    assert.equal(res.status, 200);
    const [entry] = rows(sqlite, 'SELECT * FROM audit_log');
    assert.equal(entry.action, 'operator.project.viewed');
    assert.equal(entry.project_id, 'alligators');
  });

  it('an unknown project is 404, same as an unknown page', async () => {
    const { env } = fresh();
    assert.equal((await call(get('/operator/projects/nope'), env, OPERATOR)).status, 404);
  });

  it('every read is no-store — an operator board is the last page to cache', async () => {
    const { env } = fresh();
    const res = await call(get('/operator'), env, OPERATOR);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  it('a D1 outage renders an empty board rather than an error page', async () => {
    // A fleet health page that cannot answer during an outage is a page with
    // no purpose.
    const env = {
      OPERATOR_ACCOUNT_IDS: 'acct_op',
      DB: {
        prepare() {
          throw new Error('D1 unreachable');
        },
      },
    };
    const res = await call(get('/operator'), env, OPERATOR, { waitUntil: () => {} });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Fleet overview/);
  });
});

// ---------------------------------------------------------------------- CSRF

describe('the CSRF token', () => {
  it('is rendered into the form, and sets no cookie of its own', async () => {
    // Derived from (session, key), so there is nothing to store and nothing
    // for a sibling subdomain to toss. The first cut used a double-submit
    // cookie; on this domain every workspace is a sibling of the board, and a
    // sibling can set a parent-domain cookie even though it cannot read one.
    const { env } = fresh();
    const res = await call(get('/operator/projects/alligators'), env, OPERATOR);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.match(await res.text(), new RegExp(`value="${await tokenFor(env)}"`));
  });

  it('every tab of the same session renders the same token', async () => {
    const { env } = fresh();
    const a = await (await call(get('/operator/projects/alligators'), env, OPERATOR)).text();
    const b = await (await call(get('/operator/projects/alligators'), env, OPERATOR)).text();
    const token = await tokenFor(env);
    assert.match(a, new RegExp(`value="${token}"`));
    assert.match(b, new RegExp(`value="${token}"`));
  });

  it('another session’s token is not this session’s', async () => {
    const { env } = fresh();
    assert.notEqual(await tokenFor(env, 'sess_someone_else'), await tokenFor(env));
  });
});

// ----------------------------------------------------------------- the write

describe('the one write', () => {
  it('enqueues a manual job and records the reason', async () => {
    const { env, sqlite } = fresh();
    const token = await tokenFor(env);
    const res = await call(
      post('/operator/projects/alligators/reconcile', {
        csrf: token,
        reason: 'customer reported it stuck in setup',
      }),
      env,
      OPERATOR
    );
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/operator/projects/alligators?nudged=1');

    const [job] = rows(sqlite, 'SELECT * FROM jobs');
    assert.equal(job.project_id, 'alligators');
    assert.equal(job.reason, 'manual');
    assert.equal(job.finished_at, null, 'the hourly sweep drains it');

    const [entry] = rows(
      sqlite,
      "SELECT * FROM audit_log WHERE action = 'operator.reconcile.nudged'"
    );
    assert.equal(entry.actor, 'operator:op@example.com');
    assert.equal(entry.reason, 'customer reported it stuck in setup');
    assert.equal(entry.project_id, 'alligators');
  });

  it('refuses a request with no CSRF token, and writes NOTHING', async () => {
    // `sameSiteGate` fails open on a missing Sec-Fetch-Site header, so this
    // is the only thing standing between a stolen cookie and a fleet write.
    const { env, sqlite } = fresh();
    const res = await call(
      post('/operator/projects/alligators/reconcile', { reason: 'because' }),
      env,
      OPERATOR
    );
    assert.equal(res.status, 403);
    assert.equal(rows(sqlite, 'SELECT * FROM jobs').length, 0);
    assert.equal(rows(sqlite, 'SELECT * FROM audit_log').length, 0);
  });

  it('refuses ANOTHER session’s token', async () => {
    // A token minted for somebody else's session is not this session's, which
    // is the whole reason the value is derived rather than supplied.
    const { env, sqlite } = fresh();
    const res = await call(
      post('/operator/projects/alligators/reconcile', {
        csrf: await tokenFor(env, 'sess_attacker'),
        reason: 'x',
      }),
      env,
      OPERATOR
    );
    assert.equal(res.status, 403);
    assert.equal(rows(sqlite, 'SELECT * FROM jobs').length, 0);
  });

  it('refuses a blank reason and says why, without writing', async () => {
    const { env, sqlite } = fresh();
    const token = await tokenFor(env);
    const res = await call(
      post('/operator/projects/alligators/reconcile', { csrf: token, reason: '   ' }),
      env,
      OPERATOR
    );
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /error=no-reason/);
    assert.equal(rows(sqlite, 'SELECT * FROM jobs').length, 0);
  });

  it('a forged request cannot use this route to probe which projects exist', async () => {
    // CSRF is checked BEFORE existence, so an unknown id and a known id are
    // indistinguishable to a caller without a token.
    const { env } = fresh();
    const bad = await call(
      post('/operator/projects/does-not-exist/reconcile', { reason: 'x' }),
      env,
      OPERATOR
    );
    const good = await call(
      post('/operator/projects/alligators/reconcile', { reason: 'x' }),
      env,
      OPERATOR
    );
    assert.equal(bad.status, good.status);
    assert.equal(await bad.text(), await good.text());
  });

  it('a valid nudge for an unknown project is 404', async () => {
    const { env, sqlite } = fresh();
    const token = await tokenFor(env);
    const res = await call(
      post('/operator/projects/ghost/reconcile', { csrf: token, reason: 'why' }),
      env,
      OPERATOR
    );
    assert.equal(res.status, 404);
    assert.equal(rows(sqlite, 'SELECT * FROM jobs').length, 0);
  });

  it('a non-operator cannot nudge, whatever token they carry', async () => {
    const { env, sqlite } = fresh();
    const token = await tokenFor(env);
    const res = await call(
      post('/operator/projects/alligators/reconcile', { csrf: token, reason: 'why' }),
      env,
      CUSTOMER
    );
    assert.equal(res.status, 404);
    assert.equal(rows(sqlite, 'SELECT * FROM jobs').length, 0);
  });

  it('the nudged page shows the notice and the error copy', async () => {
    const { env } = fresh();
    const ok = await (
      await call(get('/operator/projects/alligators?nudged=1'), env, OPERATOR)
    ).text();
    assert.match(ok, /Reconcile enqueued/);
    const bad = await (
      await call(get('/operator/projects/alligators?error=no-reason'), env, OPERATOR)
    ).text();
    assert.match(bad, /A reason is required/);
  });

  it('the list pages take no write at all', async () => {
    // Every write is on ONE target's page and goes through the gate
    // (operator-actions.test.mjs). A POST to a list is not a route. Comp and
    // refund stay in Stripe.
    const { env } = fresh();
    for (const path of ['/operator', '/operator/projects', '/operator/accounts']) {
      assert.equal((await call(post(path, {}), env, OPERATOR)).status, 404, path);
    }
  });
});

// ------------------------------------------------- analytics is always optional

describe('the board comes up whatever analytics is doing', () => {
  // Node's global fetch, swapped for the duration of one call. `analytics.mjs`
  // takes a `fetchImpl` for its own tests; the ROUTES use the global, which is
  // what production does — so that is what these exercise.
  const withFetch = async (impl, fn) => {
    const real = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      return await fn();
    } finally {
      globalThis.fetch = real;
    }
  };

  it('renders the whole board with NO analytics token at all', async () => {
    // The deployed default. Every figure analytics would provide is simply
    // absent; nothing 500s and nothing renders a misleading zero.
    const { env } = fresh();
    const body = await (await call(get('/operator'), env, OPERATOR)).text();
    assert.match(body, /Fleet overview/);
    assert.doesNotMatch(body, /Active accounts/);
    assert.doesNotMatch(body, /Canvas builds/);
    assert.match(body, /no spend figure has ever been collected/);
  });

  it('the usage page says how to connect it rather than erroring', async () => {
    const { env } = fresh();
    const res = await call(get('/operator/events'), env, OPERATOR);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /CF_ANALYTICS_TOKEN/);
  });

  it('an analytics OUTAGE degrades the board rather than taking it down', async () => {
    // The failure mode that matters: this is the page somebody opens when
    // something is wrong, and "something is wrong" may well include the
    // analytics API.
    const { env } = fresh();
    const withToken = { ...env, CF_ACCOUNT_ID: 'cf', CF_ANALYTICS_TOKEN: 'tok' };
    const res = await withFetch(
      async () => {
        throw new Error('analytics api unreachable');
      },
      () => call(get('/operator'), withToken, OPERATOR)
    );
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Fleet overview/);
    assert.doesNotMatch(body, /Active accounts/, 'no tile is drawn from data we do not have');
  });

  it('renders the content + build columns once cells have reported', async () => {
    const { env } = fresh();
    const withToken = { ...env, CF_ACCOUNT_ID: 'cf', CF_ANALYTICS_TOKEN: 'tok' };
    const body = await withFetch(
      async (_url, init) => {
        const sql = String(init.body);
        const data = sql.includes("index1 = 'tenant_stats'")
          ? [
              {
                project: 'alligators',
                canvases: 12,
                artboards: 40,
                designSystems: 2,
                assetsBytes: 900,
              },
            ]
          : sql.includes("index1 = 'tenant_render'")
            ? [
                {
                  project: 'alligators',
                  builds: 10,
                  cacheHits: 9,
                  cacheMisses: 1,
                  timeouts: 0,
                  memoryKills: 0,
                  durationMsP95: 300,
                  windowStartedAt: 1,
                },
              ]
            : [];
        return new Response(JSON.stringify({ data }), { status: 200 });
      },
      async () => (await call(get('/operator/projects'), withToken, OPERATOR)).text()
    );
    assert.match(body, /Canvases/);
    assert.match(body, /Cache hit/);
    assert.match(body, />12</);
    assert.match(body, /90%/);
  });
});

// ------------------------------------------- the claims, checked as behaviour
//
// Four properties this surface CLAIMED in its first cut and did not have. Each
// is now a test, because a security invariant stated in a comment and not in a
// test is a security invariant nobody re-checks.

describe('the refusals are indistinguishable from a wrong URL', () => {
  it('a non-operator gets the SAME body and content-type the worker’s 404 gives', async () => {
    // Not merely the same status. The first cut answered text/html here while
    // the generic 404 answers JSON, so the content-type alone confirmed the
    // surface existed. A distinguishable 404 is a 403 with a different number.
    const { env } = fresh();
    const mine = await call(get('/operator'), env, CUSTOMER);
    const generic = await worker.fetch(get('/no-such-surface'), env, { waitUntil: (p) => p });
    assert.equal(mine.status, generic.status);
    assert.equal(mine.headers.get('content-type'), generic.headers.get('content-type'));
    assert.equal(await mine.text(), await generic.text());
  });

  it('an empty allowlist 404s a SIGNED-OUT caller too', async () => {
    // "Every /operator hit 404s" has to be true for everybody, or a stranger
    // learns the path is real from a redirect to /login.
    const { env } = fresh({ operators: '' });
    const res = await call(get('/operator'), env, null);
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.headers.get('location') ?? '', /login/);
  });

  it('keeps the edge’s frame-ancestors and base-uri, which its own CSP replaced', async () => {
    // edge.mjs: a route may TIGHTEN what the edge stamps but can no longer
    // forget it. `harden()` only fills an ABSENT header, so a route setting
    // its own CSP inherits nothing — and this is the page with the one
    // privileged form on it.
    const { env } = fresh();
    const csp = (await call(get('/operator'), env, OPERATOR)).headers.get(
      'content-security-policy'
    );
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
  });
});

describe('a cross-tenant read is visible to the customer it touched', () => {
  it('unions the fleet-wide reads into the project’s own activity page', async () => {
    // The promise is "you can see that we looked". Bulk reads carry no
    // project_id, so filtering on project_id alone hid exactly the reads that
    // touched EVERYONE — the inverse of the promise.
    const { env, sqlite } = fresh();
    await call(get('/operator/accounts'), env, OPERATOR);
    const bulk = rows(sqlite, "SELECT * FROM audit_log WHERE action = 'operator.accounts.viewed'");
    assert.equal(bulk.length, 1);
    assert.equal(bulk[0].project_id, null, 'a fleet-wide read is about no single project');

    const { auditPage, AUDIT_COPY } = await import('./project-admin.mjs');
    const html = auditPage({
      account: { email: 'a@example.com' },
      project: { id: 'alligators', name: 'Brno Alligators', state: 'active' },
      isOwner: true,
      entries: bulk,
    });
    assert.match(html, new RegExp(AUDIT_COPY['operator.accounts.viewed']));
  });
});
