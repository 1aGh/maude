// The account pages — Maude v2 S9.16 (canvas 02 ob-settings: People and
// invites · Billing and plan · Your Macs · Download everything · Delete the
// account).
//
// Real SQLite behind the D1 shape, real Requests through the live worker.
// Stripe is never reached: a fetch to api.stripe.com fails the test.
//
// The leak cases are the point: three accounts, each with something the other
// two must never see — Ana owns Studio site (Tereza is on it, Jonas has one
// canvas, someone is invited); Tereza owns Alligators brand (Ana can comment
// there); Olga owns a project neither of them is on.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  ACCOUNT_EXPORT_LIMIT,
  accountCsrf,
  allAccountHtml,
  DELETED_EMAIL_DOMAIN,
  macHandle,
} from './account-pages.mjs';
import { sha256Hex } from './accounts.mjs';
import { d1FromSqlite } from './db.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const DAY = 86_400_000;
const PASSWORD = 'a-long-enough-password';
const MASTER = 'test-master-secret';
const realFetch = globalThis.fetch;

let stripeCalls;
let cellCalls;
before(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    if (url.includes('api.stripe.com')) {
      stripeCalls.push(url);
      return Response.json({ error: { message: 'no Stripe in this test' } }, { status: 500 });
    }
    if (url.includes('/internal/revocation-sweep')) {
      cellCalls.push(url);
      return new Response('{}', { status: 200 });
    }
    return realFetch(input, init);
  };
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  stripeCalls = [];
  cellCalls = [];
});

const form = (fields) => new URLSearchParams(fields).toString();

async function freshEnv() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  return { env: { DB, CELL_SECRET_MASTER: MASTER, STRIPE_SECRET_KEY: 'sk_test_x' }, sqlite };
}

async function signUp(env, sqlite, email, name) {
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email, password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  const session = /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  assert.ok(session, `sign-up for ${email}`);
  sqlite.prepare('UPDATE accounts SET name = ? WHERE email = ?').run(name, email);
  const id = sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email).id;
  return { session, id, email };
}

async function macFor(sqlite, accountId, label, n) {
  const token = `mpt_${String(n).repeat(48)}`.slice(0, 52);
  sqlite
    .prepare(
      'INSERT INTO personal_tokens (id, account_id, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(await sha256Hex(token), accountId, label, Date.now() - 3 * DAY, Date.now() - 120_000);
  return token;
}

function project(sqlite, id, ownerId, name, extra = {}) {
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at, subscription_id, trial_ends_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)`
    )
    .run(
      id,
      ownerId,
      name,
      extra.state ?? 'active',
      extra.subscription_id ?? null,
      extra.trial_ends_at ?? null
    );
}

/** Three accounts and everything each must keep from the others. */
async function world() {
  const { env, sqlite } = await freshEnv();
  const ana = await signUp(env, sqlite, 'ana@example.com', 'Ana');
  const tereza = await signUp(env, sqlite, 'tereza@example.com', 'Tereza');
  const jonas = await signUp(env, sqlite, 'jonas@example.com', 'Jonas');
  const olga = await signUp(env, sqlite, 'olga@example.com', 'Olga');

  project(sqlite, 'studio-site', ana.id, 'Studio site', { trial_ends_at: Date.now() + 12 * DAY });
  project(sqlite, 'alligators', tereza.id, 'Alligators brand', { subscription_id: 'sub_t' });
  project(sqlite, 'olga-secret', olga.id, 'Olga secret project', { subscription_id: 'sub_o' });

  const add = sqlite.prepare(
    'INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, 1)'
  );
  add.run('studio-site', tereza.id, 'member');
  add.run('alligators', ana.id, 'viewer');
  add.run('alligators', jonas.id, 'member'); // Ana must never see Jonas's address here
  add.run('olga-secret', jonas.id, 'member');
  sqlite
    .prepare(
      `INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at)
       VALUES ('studio-site', ?, 'ui/Pricing.tsx', 'viewer', 'invite', 1)`
    )
    .run(jonas.id);
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      'studio-site',
      'pending@example.com',
      'observer',
      1,
      Date.now() + 7 * DAY
    );
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      'olga-secret',
      'olga-invitee@example.com',
      'member',
      1,
      Date.now() + 7 * DAY
    );
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(crypto.randomUUID(), 'alligators', 'ana@example.com', 'member', 1, Date.now() + 7 * DAY);

  const anaMac = await macFor(sqlite, ana.id, 'Maude on Ana’s MacBook', 1);
  const olgaMac = await macFor(sqlite, olga.id, 'Maude on Olga’s iMac', 2);
  return { env, sqlite, ana, tereza, jonas, olga, anaMac, olgaMac };
}

function get(env, path, session, extra = {}) {
  return worker.fetch(
    new Request(`https://cloud.test${path}`, {
      headers: { cookie: `maude_session=${session}`, accept: 'text/html', ...extra },
    }),
    env
  );
}

function post(env, path, session, fields, extra = {}) {
  return worker.fetch(
    new Request(`https://cloud.test${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `maude_session=${session}`,
        ...extra,
      },
      body: form(fields),
    }),
    env
  );
}

const csrfOf = (session) => accountCsrf(session, MASTER);

// ------------------------------------------------------------------- doors

describe('every account page: a session, no-store, no script', () => {
  const PATHS = [
    '/account',
    '/account/people',
    '/account/billing',
    '/account/macs',
    '/account/download',
    '/account/delete',
  ];

  test('signed out → sign in, and back here after', async () => {
    const { env } = await freshEnv();
    for (const path of [...PATHS, '/account/download/account.json']) {
      const res = await worker.fetch(new Request(`https://cloud.test${path}`), env);
      assert.equal(res.status, 303, path);
      assert.equal(res.headers.get('location'), `/login?next=${encodeURIComponent(path)}`, path);
    }
  });

  test('signed in → 200, Cache-Control no-store, strict CSP, no script', async () => {
    const { env, ana } = await world();
    for (const path of PATHS) {
      const res = await get(env, path, ana.session);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('cache-control'), 'no-store', path);
      assert.match(
        res.headers.get('content-security-policy') ?? '',
        /frame-ancestors 'none'/,
        path
      );
      const html = await res.text();
      assert.ok(!/<script/i.test(html), path);
      assert.ok(!/\son[a-z]+\s*=/i.test(html), path);
    }
  });

  test('the overview carries the plan line and the six doors (ob-settings + S9.18 E-mails)', async () => {
    const { env, ana, sqlite } = await world();
    sqlite
      .prepare('UPDATE accounts SET trial_started_at = ? WHERE id = ?')
      .run(Date.now() - 2 * DAY, ana.id);
    const html = await (await get(env, '/account', ana.session)).text();
    assert.match(html, /Free trial · 12 days left/);
    for (const door of [
      'People and invites',
      'Billing and plan',
      'Your Macs',
      'E-mails',
      'Download everything',
      'Delete the account',
    ]) {
      assert.ok(html.includes(door), door);
    }
  });

  test('a POST from another origin is refused, even with the right CSRF field', async () => {
    const { env, ana } = await world();
    const res = await post(
      env,
      '/account/macs',
      ana.session,
      { csrf: await csrfOf(ana.session), mac: 'x' },
      { origin: 'https://studio-site.cloud.maude.sh' }
    );
    assert.equal(res.status, 403);
  });

  test('no CSRF key configured → every account POST fails closed', async () => {
    const { env, ana } = await world();
    env.CELL_SECRET_MASTER = undefined;
    const res = await post(env, '/account/delete', ana.session, {
      csrf: await csrfOf(ana.session),
      confirm: 'ana@example.com',
    });
    assert.equal(res.status, 403);
  });
});

// ------------------------------------------------------------------ people

describe('People and invites', () => {
  test('the owner sees her people, their v2 words, canvas grants and invitations', async () => {
    const { env, ana } = await world();
    const html = await (await get(env, '/account/people', ana.session)).text();
    assert.match(html, /Studio site/);
    assert.match(html, /tereza@example\.com/);
    assert.match(html, /<strong>Can edit<\/strong>/);
    assert.match(html, /Jonas[\s\S]*?<strong>Can comment<\/strong>[\s\S]*?on Pricing only/);
    assert.match(html, /pending@example\.com/);
    assert.match(html, /<strong>Can view<\/strong>/);
    assert.ok(
      !/\b(observer|viewer|member)\b/.test(html.replace(/<[^>]+>/g, ' ')),
      'no wire id is shown'
    );
  });

  test('shared with you: the project, the owner’s NAME and your own access — no other address', async () => {
    const { env, ana } = await world();
    const html = await (await get(env, '/account/people', ana.session)).text();
    assert.match(html, /Alligators brand <span class="quiet">· Tereza’s project/);
    assert.match(html, /Alligators brand[\s\S]*?<strong>Can comment<\/strong>/);
    // Tereza's address appears only where Ana is the owner (Studio site), and
    // Jonas's only as his Studio site grant — never as Alligators' people.
    const shared = html.slice(html.indexOf('Shared with you'));
    assert.ok(!shared.includes('tereza@example.com'), 'the owner’s address');
    assert.ok(!shared.includes('jonas@example.com'), 'another member’s address');
    // An invitation addressed to Ana on Tereza's project is Tereza's to see.
    assert.ok(!/Invited[\s\S]*ana@example\.com/.test(shared));
  });

  test('another account’s project never appears — not its name, people or invitations', async () => {
    const { env, ana, tereza } = await world();
    for (const who of [ana, tereza]) {
      const html = await (await get(env, '/account/people', who.session)).text();
      assert.ok(!html.includes('Olga secret project'), who.email);
      assert.ok(!html.includes('olga@example.com'), who.email);
      assert.ok(!html.includes('olga-invitee@example.com'), who.email);
    }
  });

  test('Make owner is not offered anywhere on the page', async () => {
    const { env, ana } = await world();
    const html = await (await get(env, '/account/people', ana.session)).text();
    assert.doesNotMatch(html, /Make owner|value="owner"/);
  });
});

// ----------------------------------------------------------------- billing

describe('Billing and plan', () => {
  test('trial days left, the plan of each owned project, the picker on a trial project', async () => {
    const { env, ana, tereza, sqlite } = await world();
    sqlite
      .prepare('UPDATE accounts SET trial_started_at = ? WHERE id = ?')
      .run(Date.now() - 2 * DAY, ana.id);
    const html = await (await get(env, '/account/billing', ana.session)).text();
    assert.match(html, /Free trial · 12 days left/);
    assert.match(
      html,
      /<form class="picker" method="post" action="\/projects\/studio-site\/billing\/plan">/
    );
    assert.match(html, /name="plan" value="project"/);
    assert.match(html, /name="interval" value="annual"/);
    assert.ok(!html.includes('Alligators brand'), 'a project shared with her is not hers to bill');

    // Tereza's project has a plan: no picker, the plan word instead.
    const paid = await (await get(env, '/account/billing', tereza.session)).text();
    assert.match(paid, /Cloud Project · plan chosen/);
    assert.doesNotMatch(paid, /billing\/plan/);
    assert.ok(!paid.includes('Studio site'));
    assert.deepEqual(stripeCalls, [], 'reading the billing page never calls Stripe');
  });

  test('a paused trial project says so and offers the picker', async () => {
    const { env, ana, sqlite } = await world();
    sqlite
      .prepare('UPDATE projects SET trial_ends_at = ? WHERE id = ?')
      .run(Date.now() - DAY, 'studio-site');
    const html = await (await get(env, '/account/billing', ana.session)).text();
    assert.match(html, /Paused · Choose a plan to keep editing\./);
    assert.match(html, /action="\/projects\/studio-site\/billing\/plan"/);
  });
});

// -------------------------------------------------------------------- macs

describe('Your Macs', () => {
  test('lists only this account’s Macs, and never a credential or its stored hash', async () => {
    const { env, ana, anaMac, olgaMac, sqlite } = await world();
    const html = await (await get(env, '/account/macs', ana.session)).text();
    assert.match(html, /Maude on Ana’s MacBook/);
    assert.ok(!html.includes('Olga’s iMac'), 'another account’s Mac');
    for (const row of sqlite.prepare('SELECT id FROM personal_tokens').all()) {
      assert.ok(!html.includes(row.id), 'a stored hash reached the page');
    }
    assert.ok(!html.includes(anaMac) && !html.includes(olgaMac), 'a credential reached the page');
    assert.match(html, />Sign out this Mac</);
  });

  test('Sign out this Mac: CSRF required; then that Mac is refused', async () => {
    const { env, ana, anaMac, sqlite } = await world();
    const id = sqlite.prepare('SELECT id FROM personal_tokens WHERE label LIKE ?').get('%Ana%').id;
    const handle = await macHandle(id);

    const noCsrf = await post(env, '/account/macs', ana.session, { mac: handle });
    assert.equal(noCsrf.status, 403);
    // The pre-v2 form (POST /account with the stored id) no longer revokes.
    const legacy = await post(env, '/account', ana.session, { revoke: id });
    assert.equal(legacy.status, 403);
    const still = await worker.fetch(
      new Request('https://cloud.test/api/projects', {
        headers: { authorization: `Bearer ${anaMac}` },
      }),
      env
    );
    assert.equal(still.status, 200, 'nothing was signed out without the CSRF field');

    const res = await post(env, '/account/macs', ana.session, {
      csrf: await csrfOf(ana.session),
      mac: handle,
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Signed out\./);
    const after = await worker.fetch(
      new Request('https://cloud.test/api/projects', {
        headers: { authorization: `Bearer ${anaMac}` },
      }),
      env
    );
    assert.equal(after.status, 401);
  });

  test('a handle of another account’s Mac signs nothing out', async () => {
    const { env, ana, olgaMac, sqlite } = await world();
    const olgaId = sqlite
      .prepare('SELECT id FROM personal_tokens WHERE label LIKE ?')
      .get('%Olga%').id;
    for (const mac of [await macHandle(olgaId), olgaId]) {
      const res = await post(env, '/account/macs', ana.session, {
        csrf: await csrfOf(ana.session),
        mac,
      });
      assert.equal(res.status, 404);
    }
    const still = await worker.fetch(
      new Request('https://cloud.test/api/projects', {
        headers: { authorization: `Bearer ${olgaMac}` },
      }),
      env
    );
    assert.equal(still.status, 200);
  });
});

// ---------------------------------------------------------------- download

describe('Download everything', () => {
  test('the page links each OWNED project’s download, and says what the account file holds', async () => {
    const { env, ana } = await world();
    const html = await (await get(env, '/account/download', ana.session)).text();
    assert.match(html, /href="\/projects\/studio-site\/download"/);
    assert.doesNotMatch(
      html,
      /\/projects\/alligators\/download/,
      'shared projects are their owner’s'
    );
    assert.doesNotMatch(html, /olga-secret/);
    assert.match(html, /1 project is shared with you\. Their owners download them\./);
    assert.match(html, /href="\/account\/download\/account\.json"/);
    assert.match(html, /no one else’s name or address/);
  });

  test('the account file: this account only, no one else’s address, no credential', async () => {
    const { env, ana, anaMac, sqlite } = await world();
    const res = await get(env, '/account/download/account.json', ana.session);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(
      res.headers.get('content-disposition') ?? '',
      /attachment; filename="maude-account\.json"/
    );
    const text = await res.text();
    const file = JSON.parse(text);
    assert.equal(file.format, 'maude-account/1');
    assert.equal(file.account.email, 'ana@example.com');
    assert.equal(file.account.name, 'Ana');
    assert.deepEqual(
      file.projectsYouOwn.map((p) => [p.id, p.plan]),
      [['studio-site', 'trial']]
    );
    assert.deepEqual(
      file.sharedWithYou.map((p) => [p.id, p.access]),
      [['alligators', 'Can comment']]
    );
    assert.deepEqual(
      file.macs.map((m) => m.name),
      ['Maude on Ana’s MacBook']
    );
    for (const other of [
      'tereza@example.com',
      'jonas@example.com',
      'olga@example.com',
      'pending@example.com',
      'olga-invitee@example.com',
      'Olga',
      'Tereza',
      'Jonas',
    ]) {
      assert.ok(!text.includes(other), `${other} leaked into the account file`);
    }
    assert.ok(!text.includes(anaMac));
    for (const row of sqlite.prepare('SELECT id FROM personal_tokens').all()) {
      assert.ok(!text.includes(row.id), 'a stored hash leaked into the account file');
    }
  });

  test('rate-limited per account: after the budget, 429 and no file', async () => {
    const { env, ana, tereza } = await world();
    for (let i = 0; i < ACCOUNT_EXPORT_LIMIT; i++) {
      const res = await get(env, '/account/download/account.json', ana.session);
      assert.equal(res.status, 200, `download ${i + 1}`);
      await res.text();
    }
    const over = await get(env, '/account/download/account.json', ana.session);
    assert.equal(over.status, 429);
    assert.doesNotMatch(over.headers.get('content-type') ?? '', /json/);
    // Another account's budget is its own.
    assert.equal((await get(env, '/account/download/account.json', tereza.session)).status, 200);
  });
});

// ------------------------------------------------------------------ delete

describe('Delete the account', () => {
  test('while she owns a project that is not deleted: the page says which, the POST is 409', async () => {
    const { env, ana, sqlite } = await world();
    const page = await (await get(env, '/account/delete', ana.session)).text();
    assert.match(page, /You still own 1 project\./);
    assert.match(page, /href="\/projects\/studio-site\/delete"/);
    assert.doesNotMatch(page, /name="confirm"/, 'no confirmation form while a project is owned');
    const res = await post(env, '/account/delete', ana.session, {
      csrf: await csrfOf(ana.session),
      confirm: 'ana@example.com',
    });
    assert.equal(res.status, 409);
    assert.equal(
      sqlite.prepare('SELECT email FROM accounts WHERE id = ?').get(ana.id).email,
      'ana@example.com'
    );
  });

  test('CSRF missing, or the wrong address typed: 403 / 400 and nothing changes', async () => {
    const { env, jonas, sqlite } = await world();
    assert.equal(
      (await post(env, '/account/delete', jonas.session, { confirm: 'jonas@example.com' })).status,
      403
    );
    const wrong = await post(env, '/account/delete', jonas.session, {
      csrf: await csrfOf(jonas.session),
      confirm: 'delete',
    });
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /Nothing was deleted\./);
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM project_members WHERE account_id = ?').get(jonas.id)
        .n,
      2
    );
    assert.equal((await get(env, '/account', jonas.session)).status, 200, 'still signed in');
  });

  test('confirmed: signed out everywhere, memberships end, the address leaves, the trial claim stays', async () => {
    const { env, jonas, ana, sqlite } = await world();
    const jonasMac = await macFor(sqlite, jonas.id, 'Maude on Jonas’s Mac', 3);
    sqlite
      .prepare(
        `INSERT INTO trial_claims (email_hash, request_id, account_id, project_id, claimed_at)
         VALUES ('h-jonas', 'r1', ?, 'gone', 1)`
      )
      .run(jonas.id);
    sqlite
      .prepare(
        `INSERT INTO email_tokens (id, account_id, purpose, created_at, expires_at) VALUES ('et1', ?, 'reset', 1, ?)`
      )
      .run(jonas.id, Date.now() + DAY);
    sqlite
      .prepare(
        `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at)
         VALUES ('inv-jonas', 'studio-site', 'jonas@example.com', 'member', 1, ?)`
      )
      .run(Date.now() + DAY);

    const res = await post(env, '/account/delete', jonas.session, {
      csrf: await csrfOf(jonas.session),
      confirm: '  Jonas@Example.com ',
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') ?? '', /maude_session=; .*Max-Age=0/);
    assert.match(await res.text(), /The account is deleted\./);

    // Signed out: the cookie session and the Mac.
    const back = await get(env, '/account', jonas.session);
    assert.equal(back.status, 303);
    const mac = await worker.fetch(
      new Request('https://cloud.test/api/projects', {
        headers: { authorization: `Bearer ${jonasMac}` },
      }),
      env
    );
    assert.equal(mac.status, 401);

    // Memberships and grants end; the cells hear it through the revocation list.
    const left = (table) =>
      sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`).get(jonas.id).n;
    assert.equal(left('project_members'), 0);
    assert.equal(left('canvas_grants'), 0);
    const revoked = sqlite
      .prepare('SELECT project_id FROM member_revocations WHERE email = ? ORDER BY project_id')
      .all('jonas@example.com')
      .map((r) => r.project_id);
    assert.deepEqual(revoked, ['alligators', 'olga-secret', 'studio-site']);

    // The address, name and every way back in are gone.
    const row = sqlite.prepare('SELECT * FROM accounts WHERE id = ?').get(jonas.id);
    assert.equal(row.email, `deleted+${jonas.id}@${DELETED_EMAIL_DOMAIN}`);
    assert.equal(row.name, null);
    assert.equal(row.password_hash, null);
    assert.equal(row.google_sub, null);
    assert.ok(sqlite.prepare("SELECT used_at FROM email_tokens WHERE id = 'et1'").get().used_at);
    assert.ok(
      sqlite.prepare("SELECT revoked_at FROM project_invites WHERE id = 'inv-jonas'").get()
        .revoked_at
    );
    const login = await worker.fetch(
      new Request('https://cloud.test/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ email: 'jonas@example.com', password: PASSWORD }),
      }),
      env
    );
    assert.ok(
      !/maude_session=mcs_/.test(login.headers.get('set-cookie') ?? ''),
      'the old password signs nobody in'
    );

    // S9.15: the claim is kept, so a re-signup on the same address gets no second trial.
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM trial_claims').get().n, 1);

    // Ana's account is untouched; Jonas leaves her people list.
    assert.equal((await get(env, '/account', ana.session)).status, 200);
    const people = await (await get(env, '/account/people', ana.session)).text();
    assert.ok(!people.includes('jonas@example.com'));
    assert.deepEqual(stripeCalls, []);
  });

  test('the address can make a new account afterwards', async () => {
    const { env, jonas, sqlite } = await world();
    await post(env, '/account/delete', jonas.session, {
      csrf: await csrfOf(jonas.session),
      confirm: 'jonas@example.com',
    });
    const again = await signUp(env, sqlite, 'jonas@example.com', 'Jonas again');
    assert.notEqual(again.id, jonas.id);
  });
});

test('the account pages use CONTRACT words: no "we"/"us"/"our", no exclamation marks, no vocabulary of ours', () => {
  const text = allAccountHtml()
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/g, ' ');
  assert.doesNotMatch(text, /\b[Ww]e\b|\b[Uu]s\b|\b[Oo]ur\b/);
  assert.doesNotMatch(text, /!/);
  for (const jargon of ['tenant', 'cell', 'token', 'revoke', 'session', 'container', 'observer']) {
    assert.ok(!new RegExp(`\\b${jargon}`, 'i').test(text), `"${jargon}" leaked`);
  }
});
