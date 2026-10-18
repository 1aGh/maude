// Proving an address, and getting back in — RCA 2026-08-04.
//
// The bug these cover was not a wrong branch; it was a MISSING one. The
// no-silent-merge rule refuses a Google sign-in until `email_verified_at` is
// set, and for two phases no code path in the product could set it. Every
// password account was barred from Google forever, and with no reset flow a
// forgotten password ended the account.
//
// The shape of the test suite is therefore load-bearing, and one rule runs
// through all of it: NOTHING HERE WRITES `email_verified_at` WITH RAW SQL.
// The old suite's only "verified" fixture did exactly that (accounts.test.mjs
// reaching around the app), which is what an unreachable state looks like from
// the inside — a green test proving a state the product cannot produce. Every
// verified account below is verified by walking the actual doors.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { d1FromSqlite } from './db.mjs';
import { consumeEmailToken, mintEmailToken, peekEmailToken } from './email-tokens.mjs';
import { applySchema, MIGRATIONS } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const PASSWORD = 'a-long-enough-password';
const NEW_PASSWORD = 'a-different-long-password';

async function freshEnv(extra = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  return { env: { DB, RESEND_API_KEY: 'k', ...extra }, sqlite };
}

function form(fields) {
  return new URLSearchParams(fields).toString();
}

/** Run `fn` with the mail provider faked; resolves to every message sent. */
async function capturingMail(fn) {
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('api.resend.com')) {
      sends.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 });
    }
    return realFetch(input, init);
  };
  try {
    await fn(sends);
  } finally {
    globalThis.fetch = realFetch;
  }
  return sends;
}

/** The `?t=` value out of whatever we just mailed somebody. */
function linkFrom(mail, path) {
  const m = new RegExp(`/auth/${path}\\?t=([A-Za-z0-9_]+)`).exec(mail.text);
  assert.ok(m, `no /auth/${path} link in the mail:\n${mail.text}`);
  return m[1];
}

function post(env, path, fields, headers = {}) {
  return worker.fetch(
    new Request(`https://cloud.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: form(fields),
    }),
    env
  );
}

async function signup(env, { email = 'alice@example.com', password = PASSWORD } = {}) {
  const res = await post(env, '/auth/signup', { email, password, disclosure: 'yes' });
  return { res, session: /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] };
}

function fakeIdToken(claims) {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

/**
 * Complete a Google callback for `claims`. Kept separate from `capturingMail`
 * because the refusal path now sends mail DURING the exchange, so a test needs
 * both fakes layered.
 */
async function googleCallback(env, claims) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('api.resend.com')) return realFetch(input, init);
    return new Response(JSON.stringify({ id_token: fakeIdToken(claims) }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    return await worker.fetch(
      new Request('https://cloud.test/auth/google/callback?code=x&state=legit', {
        headers: { cookie: 'maude_oauth=legit.verifier' },
      }),
      env
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

const GOOGLE = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' };

// ------------------------------------------------------ the end-to-end walk

test('THE INVARIANT: signup → emailed link → Google links, with no raw SQL anywhere', async () => {
  const { env, sqlite } = await freshEnv(GOOGLE);

  const mail = await capturingMail(async (sent) => {
    await signup(env);
    assert.equal(sent.length, 1, 'signup mails a confirmation link');

    // Before confirming, the rule still bites — this is the state the reporter
    // was stuck in, and it must remain refused.
    const before = await googleCallback(env, {
      sub: 'g-alice',
      email: 'alice@example.com',
      email_verified: true,
    });
    assert.equal(before.status, 409);
  });
  assert.equal(mail.length, 2, 'signup mails a link, and so does the refusal');
  assert.deepEqual(mail[0].to, ['alice@example.com']);

  // Follow the MOST RECENT link. Minting supersedes an account's earlier live
  // link of the same purpose, so the one the refusal just sent is the live one
  // and signup's is deliberately dead — which is also the order a real person
  // meets them in.
  const confirm = await worker.fetch(
    new Request(`https://cloud.test/auth/verify?t=${linkFrom(mail.at(-1), 'verify')}`),
    env
  );
  assert.equal(confirm.status, 200);
  assert.match(await confirm.text(), /Address confirmed/);

  const after = await googleCallback(env, {
    sub: 'g-alice',
    email: 'alice@example.com',
    email_verified: true,
  });
  assert.equal(after.status, 303, 'Google now links to the existing account');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1, 'one account');
  const row = sqlite.prepare('SELECT * FROM accounts').get();
  assert.equal(row.google_sub, 'g-alice');
  assert.ok(row.email_verified_at > 0);
});

test('the refusal MAILS a link instead of naming a door that does not exist', async () => {
  const { env } = await freshEnv(GOOGLE);
  await capturingMail(async () => {
    await signup(env);
  });

  const sends = await capturingMail(async () => {
    const res = await googleCallback(env, {
      sub: 'g-alice',
      email: 'alice@example.com',
      email_verified: true,
    });
    assert.equal(res.status, 409);
    const text = await res.text();
    // The old copy promised a password sign-in that changed nothing and a
    // settings page that was never built.
    assert.ok(!/from settings/i.test(text), 'must not point at a settings surface');
    assert.match(text, /emailed you a link/i);
  });
  assert.equal(sends.length, 1, 'the link the message promises is actually sent');
  assert.deepEqual(sends[0].to, ['alice@example.com']);
});

test('signing in with the password does NOT confirm the address', async () => {
  // The precise lie in the old copy. Kept as a test so nobody "fixes" the
  // lockout by making login imply proof of the address — that would hand the
  // Google door to whoever pre-registered the address.
  const { env, sqlite } = await freshEnv(GOOGLE);
  await capturingMail(async () => {
    await signup(env);
  });
  const login = await post(env, '/auth/login', { email: 'alice@example.com', password: PASSWORD });
  assert.equal(login.status, 303);
  assert.equal(
    sqlite.prepare('SELECT email_verified_at FROM accounts').get().email_verified_at,
    null
  );
});

// ------------------------------------------------------------- the invite

test('an invite-created account can link Google — redeeming the link IS the proof', async () => {
  const { env, sqlite } = await freshEnv(GOOGLE);
  await capturingMail(async () => {
    await signup(env, { email: 'owner@example.com' });
  });
  const ownerId = sqlite.prepare('SELECT id FROM accounts').get().id;
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
       VALUES ('alligators', ?, 'Brno Alligators', 'active', 1, 1)`
    )
    .run(ownerId);
  const inviteId = '11111111-2222-3333-4444-555555555555';
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at)
       VALUES (?, 'alligators', 'teammate@example.com', 'member', 1, ?)`
    )
    .run(inviteId, Date.now() + 86_400_000);

  const joined = await post(env, `/invite/${inviteId}`, {
    password: PASSWORD,
    disclosure: 'yes',
  });
  assert.equal(joined.status, 303);

  const res = await googleCallback(env, {
    sub: 'g-mate',
    email: 'teammate@example.com',
    email_verified: true,
  });
  assert.equal(res.status, 303, 'the invited teammate is not locked out of Google');
});

// ------------------------------------------------------------------ reset

test('reset: the emailed link sets a new password, signs in, and kills old sessions', async () => {
  const { env } = await freshEnv();
  let stale;
  const mail = await capturingMail(async () => {
    stale = (await signup(env)).session;
    const asked = await post(env, '/auth/forgot', { email: 'alice@example.com' });
    assert.equal(asked.status, 200);
    assert.match(await asked.text(), /If that address has a Maude account/);
  });
  const reset = mail.find((m) => /Choose a new password/.test(m.subject));
  assert.ok(reset, 'a reset mail was sent');

  const t = linkFrom(reset, 'reset');
  const formPage = await worker.fetch(new Request(`https://cloud.test/auth/reset?t=${t}`), env);
  assert.equal(formPage.status, 200, 'the GET renders the form');

  // ...and did NOT spend the link by rendering it.
  const saved = await post(env, '/auth/reset', { t, password: NEW_PASSWORD });
  assert.equal(saved.status, 303);
  assert.ok(/maude_session=/.test(saved.headers.get('set-cookie') ?? ''), 'signed in');

  const old = await worker.fetch(
    new Request('https://cloud.test/auth/session', {
      headers: { cookie: `maude_session=${stale}` },
    }),
    env
  );
  assert.equal(old.status, 401, 'the session from before the reset is dead');

  const relogin = await post(env, '/auth/login', {
    email: 'alice@example.com',
    password: NEW_PASSWORD,
  });
  assert.equal(relogin.status, 303, 'the new password works');
});

test('a reset link works exactly once', async () => {
  const { env } = await freshEnv();
  const mail = await capturingMail(async () => {
    await signup(env);
    await post(env, '/auth/forgot', { email: 'alice@example.com' });
  });
  const t = linkFrom(
    mail.find((m) => /Choose a new password/.test(m.subject)),
    'reset'
  );
  assert.equal((await post(env, '/auth/reset', { t, password: NEW_PASSWORD })).status, 303);
  const again = await post(env, '/auth/reset', { t, password: 'yet-another-password' });
  assert.equal(again.status, 410, 'a spent link is dead');
});

test('reset also confirms the address, so Google works afterwards', async () => {
  const { env } = await freshEnv(GOOGLE);
  const mail = await capturingMail(async () => {
    await signup(env);
    await post(env, '/auth/forgot', { email: 'alice@example.com' });
  });
  const t = linkFrom(
    mail.find((m) => /Choose a new password/.test(m.subject)),
    'reset'
  );
  await post(env, '/auth/reset', { t, password: NEW_PASSWORD });

  const res = await googleCallback(env, {
    sub: 'g-alice',
    email: 'alice@example.com',
    email_verified: true,
  });
  assert.equal(res.status, 303);
});

test('forgot answers identically for a stranger — and sends nothing', async () => {
  const { env } = await freshEnv();
  let known;
  let unknown;
  const mail = await capturingMail(async () => {
    await signup(env);
    known = await (await post(env, '/auth/forgot', { email: 'alice@example.com' })).text();
    unknown = await (await post(env, '/auth/forgot', { email: 'ghost@example.com' })).text();
  });
  assert.equal(known, unknown, 'no membership oracle in the response body');
  assert.equal(
    mail.filter((m) => /Choose a new password/.test(m.subject)).length,
    1,
    'only the real address was mailed'
  );
});

// -------------------------------------------------- the token layer itself

test('purpose is bound: a confirmation link cannot be spent as a reset', async () => {
  // Without this, the 24-hour link sitting in an inbox would also be a password
  // reset, and the weaker flow would set the strength of both.
  const { env, sqlite } = await freshEnv();
  await capturingMail(async () => {
    await signup(env);
  });
  const id = sqlite.prepare('SELECT id FROM accounts').get().id;
  const { token } = await mintEmailToken(env.DB, { accountId: id, purpose: 'verify' });

  assert.equal((await consumeEmailToken(env.DB, token, 'reset')).ok, false);
  assert.equal((await consumeEmailToken(env.DB, token, 'verify')).ok, true, 'still good');
});

test('expired, tampered, and invented links are one indistinguishable failure', async () => {
  const { env, sqlite } = await freshEnv();
  await capturingMail(async () => {
    await signup(env);
  });
  const id = sqlite.prepare('SELECT id FROM accounts').get().id;
  const now = Date.now();
  const { token } = await mintEmailToken(env.DB, { accountId: id, purpose: 'reset' }, { now });

  const expired = await peekEmailToken(env.DB, token, 'reset', { now: now + 2 * 3600_000 });
  const tampered = await peekEmailToken(env.DB, `${token}0`, 'reset', { now });
  const invented = await peekEmailToken(env.DB, 'mer_deadbeef', 'reset', { now });
  assert.equal(expired.ok, false);
  assert.equal(tampered.ok, false);
  assert.equal(invented.ok, false);
  assert.equal(expired.reason, tampered.reason, 'same shape for every failure');
});

test('minting supersedes this account’s earlier live link of the same purpose', async () => {
  const { env, sqlite } = await freshEnv();
  await capturingMail(async () => {
    await signup(env);
  });
  const id = sqlite.prepare('SELECT id FROM accounts').get().id;
  const first = await mintEmailToken(env.DB, { accountId: id, purpose: 'reset' });
  const second = await mintEmailToken(env.DB, { accountId: id, purpose: 'reset' });
  assert.equal(
    (await peekEmailToken(env.DB, first.token, 'reset')).ok,
    false,
    'the old one is dead'
  );
  assert.equal((await peekEmailToken(env.DB, second.token, 'reset')).ok, true);
});

test('the raw link value is never stored', async () => {
  const { env, sqlite } = await freshEnv();
  await capturingMail(async () => {
    await signup(env);
  });
  const id = sqlite.prepare('SELECT id FROM accounts').get().id;
  const { token } = await mintEmailToken(env.DB, { accountId: id, purpose: 'verify' });
  const rows = sqlite.prepare('SELECT * FROM email_tokens').all();
  assert.ok(rows.length >= 1);
  assert.ok(!JSON.stringify(rows).includes(token), 'a database dump is not a bag of live links');
});

// --------------------------------------------------------------- migration

test('migration 16 backfills invite-created accounts and NOTHING else', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  const { applySchema: apply } = await import('./migrate.mjs');
  // Apply everything, then rewind only migration 16: a genuinely pre-fix database.
  await apply(DB, SCHEMA_SQL);
  sqlite.prepare('DELETE FROM schema_migrations WHERE version = 16').run();
  sqlite.prepare('UPDATE accounts SET email_verified_at = NULL').run();
  // The migration this test owns exists exactly once; later migrations (17+)
  // are not its business and must not break it by merely existing.
  assert.equal(MIGRATIONS.filter((m) => m.version === 16).length, 1, 'migration 16 exists once');

  const t = 1_700_000_000_000;
  sqlite
    .prepare(
      `INSERT INTO accounts (id, email, created_at, password_hash, email_verified_at)
       VALUES ('a_invited', 'invited@example.com', ?, 'pbkdf2$1$00$00', NULL),
              ('a_signup',  'signup@example.com',  ?, 'pbkdf2$1$00$00', NULL)`
    )
    .run(t + 1000, t + 1000);
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
       VALUES ('p', 'a_invited', 'P', 'active', 1, 1)`
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, redeemed_at)
       VALUES ('i1', 'p', 'invited@example.com', 'member', ?, ?, ?)`
    )
    .run(t, t + 86_400_000, t + 1000);

  await apply(DB, SCHEMA_SQL);

  const invited = sqlite.prepare("SELECT * FROM accounts WHERE id = 'a_invited'").get();
  const plain = sqlite.prepare("SELECT * FROM accounts WHERE id = 'a_signup'").get();
  assert.equal(invited.email_verified_at, t + 1000, 'proven then, dated then');
  assert.equal(plain.email_verified_at, null, 'a password signup is NOT silently verified');
});

test('migration 16 is idempotent', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  const first = await applySchema(DB, SCHEMA_SQL);
  const second = await applySchema(DB, SCHEMA_SQL);
  assert.equal(first.version, second.version);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 16').get().n,
    1
  );
});
