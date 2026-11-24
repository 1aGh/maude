// Shared fixtures for the operator / owner administration tests — NODE ONLY,
// never imported by the Worker.
//
// Same posture as trial-a3.test.mjs: real SQLite behind the D1 shape, the real
// schema through `applySchema`, real Requests through the live worker, and the
// network faked at `fetch`. A fetch to api.stripe.com that no test declared a
// fake for FAILS the test at teardown (`assertNoStripe`) — none of this may
// reach Stripe.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { accountCsrf } from './account-pages.mjs';
import { d1FromSqlite } from './db.mjs';
import { applySchema } from './migrate.mjs';
import { deriveCsrf } from './operator.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

export const DAY = 86_400_000;
export const ORIGIN = 'https://cloud.test';
const PASSWORD = 'a-long-enough-password';

/**
 * Install the fake network. Returns the live record: `mails` (every Resend
 * send), `cell` (every call to a project's own hostname), `cloudflare`,
 * `stripe` (calls that reached api.stripe.com), `analytics` (SQL bodies), and
 * `routes` — extra `[needle, handler]` pairs a test may unshift.
 */
export function installNetwork(t) {
  const real = globalThis.fetch;
  const net = {
    mails: [],
    cell: [],
    cloudflare: [],
    stripe: [],
    analytics: [],
    routes: [],
    analyticsRows: null,
    cellStatus: 200,
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    const method = init.method ?? 'GET';
    for (const [needle, handler] of net.routes) {
      if (url.includes(needle)) return handler(url, init);
    }
    if (url.includes('api.stripe.com')) {
      net.stripe.push({ url, method });
      return Response.json({ error: { message: 'no fake for this' } }, { status: 500 });
    }
    if (url.includes('api.resend.com')) {
      net.mails.push(JSON.parse(init.body));
      return Response.json({ id: `em_${net.mails.length}` });
    }
    if (url.includes('api.cloudflare.com') && url.includes('analytics_engine')) {
      net.analytics.push(String(init.body));
      if (!net.analyticsRows) return new Response('no', { status: 500 });
      return Response.json({ data: net.analyticsRows(String(init.body)) });
    }
    if (url.includes('api.cloudflare.com')) {
      net.cloudflare.push({ url, method });
      // A listing answers the attached hostnames (so a detach finds one to delete).
      if (method === 'GET') {
        const hostname = new URL(url).searchParams.get('hostname');
        return Response.json({
          success: true,
          result: hostname ? [{ id: 'dom_1', hostname }] : [],
        });
      }
      return Response.json({ success: true, result: {} });
    }
    if (/\.cloud\.maude\.sh\//.test(url)) {
      net.cell.push({ url, method });
      if (url.endsWith('/health')) return Response.json({ ok: true });
      return new Response(net.cellStatus === 200 ? 'ok' : 'no', { status: net.cellStatus });
    }
    throw new Error(`unexpected network call in a test: ${method} ${url}`);
  };
  t.after(() => {
    globalThis.fetch = real;
  });
  return net;
}

/** No test in these files declares a Stripe fake unless it says so. */
export function assertNoStripe(net) {
  assert.deepEqual(net.stripe, [], 'a test reached api.stripe.com');
}

export async function freshEnv() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  const env = {
    DB,
    STRIPE_SECRET_KEY: 'sk_test_x',
    CF_PROVISION_TOKEN: 'cf-token',
    CF_ACCOUNT_ID: 'acct',
    CF_ZONE_ID: 'zone',
    CELL_SECRET_MASTER: 'a-test-master-secret',
    RESEND_API_KEY: 're_test',
    DASHBOARD_URL: ORIGIN,
  };
  return { env, sqlite };
}

const form = (fields) => new URLSearchParams(fields).toString();

/** Sign up through the real route. Returns `{ id, email, session }`. */
export async function signUp(env, sqlite, email, { verify = true } = {}) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email, password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  const session = /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  assert.ok(session, `signup for ${email} gave a session`);
  const row = sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
  if (verify) {
    sqlite
      .prepare('UPDATE accounts SET email_verified_at = ? WHERE id = ?')
      .run(Date.now(), row.id);
  }
  return { id: row.id, email, session };
}

/** An operator: a signed-up account whose id is on the allowlist. */
export async function makeOperator(env, sqlite, email = 'op@maude.test') {
  const op = await signUp(env, sqlite, email);
  env.OPERATOR_ACCOUNT_IDS = op.id;
  return op;
}

export const get = (path, who, headers = {}) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      headers: {
        accept: 'text/html',
        ...(who ? { cookie: `maude_session=${who.session}` } : {}),
        ...headers,
      },
    }),
    env_(who)
  );

// `get`/`post` need the env; a `who` carries it once `bind` has run.
const ENV = new WeakMap();
export const env_ = (who) => ENV.get(who);
export const bind = (env, ...people) => {
  for (const p of people) ENV.set(p, env);
};

/** POST a form as `who`. `csrf` is 'operator' | 'account' | null (none sent). */
export async function post(
  path,
  who,
  fields = {},
  { csrf = 'operator', headers = {}, body = null } = {}
) {
  const env = env_(who);
  const token =
    csrf === 'operator'
      ? await deriveCsrf(who.session, env.CELL_SECRET_MASTER)
      : csrf === 'account'
        ? await accountCsrf(who.session, env.CELL_SECRET_MASTER)
        : null;
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `maude_session=${who.session}`,
        ...headers,
      },
      // `body`: a ready URLSearchParams, for a form with a repeated field.
      body: body
        ? (() => {
            if (token) body.set('csrf', token);
            return body.toString();
          })()
        : form({ ...(token ? { csrf: token } : {}), ...fields }),
    }),
    env
  );
}

/** Insert a project row directly, in whatever plan shape a test needs. */
export function seedProject(sqlite, p) {
  const now = p.now ?? Date.now();
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, subscription_id, plan,
                             cell_running, trial_ends_at, promo_since, promo_tier, promo_ends_at,
                             hold_since, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.id,
      p.owner,
      p.name ?? p.id,
      p.state ?? 'active',
      p.stateSince ?? now,
      p.subscription ?? null,
      p.plan ?? 'project',
      p.cellRunning ?? ((p.state ?? 'active') === 'active' ? 1 : 0),
      p.trialEndsAt ?? null,
      p.promoSince ?? null,
      p.promoTier ?? null,
      p.promoEndsAt ?? null,
      p.holdSince ?? null,
      now
    );
}

export const project = (sqlite, id) =>
  sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(id);

export const auditRows = (sqlite, action) =>
  sqlite.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY at, id').all(action);

export const addMember = (sqlite, projectId, accountId, role = 'member') =>
  sqlite
    .prepare(
      'INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, ?)'
    )
    .run(projectId, accountId, role, Date.now());

/** Page text without tags or style, for reading what a person sees. */
export const text = (html) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');
