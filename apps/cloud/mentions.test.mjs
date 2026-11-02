// Mention e-mails + preferences — Maude v2 S9.18 (canvas 10 co-mention-notify).
//
// The cell forwards a mention here only when the mentioned person had no live
// connection; the control plane decides who that is from D1, honours their
// preference, and sends ONE e-mail through the transport it is handed. Every
// test below hands it a FAKE transport — a real provider is never called (E1
// is the owner's step).
//
//   - no live connection → exactly one e-mail; reached live → none;
//   - the e-mail names only what the recipient can already see (a canvas-only
//     person on their own canvas, nobody on a canvas they cannot open), and
//     carries no address but their own;
//   - `/internal/mentions` answers only the project's own cell secret;
//   - preferences: a cookie-session page with the session-derived CSRF field;
//   - the unsubscribe link is single-purpose and is never a session.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';

import { accountCsrf } from './account-pages.mjs';
import { createAccount, createSession, sessionAccount } from './accounts.mjs';
import { deriveCellSecret } from './cell-token.mjs';
import { d1FromSqlite } from './db.mjs';
import { consumeEmailToken, mintEmailToken, peekEmailToken } from './email-tokens.mjs';
import {
  EMAIL_PREFS_PATH,
  handleMentionRoutes,
  MENTION_EMAILS_PER_PROJECT_PER_DAY,
  MENTIONS_PATH,
  mentionEmailsOn,
  UNSUBSCRIBE_PATH,
} from './mentions.mjs';
import { applySchema, MIGRATIONS } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const MASTER = 'test-master-secret';
const PASSWORD = 'a-long-enough-password';
const POSTER = 'ui/A4 plakat.tsx';
const OTHER = 'ui/dresy.tsx';
const form = (fields) => new URLSearchParams(fields).toString();

async function freshEnv() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  return { env: { DB, CELL_SECRET_MASTER: MASTER }, sqlite };
}

/** An account with a live browser session (the doors are covered elsewhere). */
async function signUp(env, _sqlite, email, name) {
  const { id } = await createAccount(env.DB, { email, password: PASSWORD, name });
  const { token: session } = await createSession(env.DB, id);
  return { session, id, email };
}

/**
 * Alligators brand: Tereza owns it, Jonas edits, Ana can comment, Olga can only
 * view, Lin holds one canvas (the poster), Ned is somebody else entirely.
 */
async function world() {
  const { env, sqlite } = await freshEnv();
  const tereza = await signUp(env, sqlite, 'tereza@example.com', 'Tereza');
  const jonas = await signUp(env, sqlite, 'jonas@example.com', 'Jonas');
  const ana = await signUp(env, sqlite, 'ana@example.com', 'Ana');
  const olga = await signUp(env, sqlite, 'olga@example.com', 'Olga');
  const lin = await signUp(env, sqlite, 'lin@example.com', 'Lin');
  const ned = await signUp(env, sqlite, 'ned@example.com', 'Ned');
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at, subscription_id)
       VALUES ('alligators', ?, 'Alligators brand', 'active', 1, 1, 'sub_t')`
    )
    .run(tereza.id);
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at, subscription_id)
       VALUES ('ned-co', ?, 'Ned Co', 'active', 1, 1, 'sub_n')`
    )
    .run(ned.id);
  const add = sqlite.prepare(
    'INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, 1)'
  );
  add.run('alligators', jonas.id, 'member');
  add.run('alligators', ana.id, 'viewer');
  add.run('alligators', olga.id, 'observer');
  sqlite
    .prepare(
      `INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at)
       VALUES ('alligators', ?, ?, 'viewer', 'invite', 1)`
    )
    .run(lin.id, POSTER);
  return { env, sqlite, tereza, jonas, ana, olga, lin, ned };
}

/** A transport that records and never leaves the process. */
function fakeTransport() {
  const sent = [];
  const send = async (msg) => {
    sent.push(msg);
    return { ok: true, id: `fake_${sent.length}` };
  };
  return { sent, send };
}

async function forward(env, body, { tenant = 'alligators', secret, actor, transport, now } = {}) {
  const auth = secret ?? (await deriveCellSecret(MASTER, tenant));
  const req = new Request(`https://cloud.test${MENTIONS_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${auth}`,
      'content-type': 'application/json',
      ...(actor ? { 'x-maude-actor': actor } : {}),
    },
    body: JSON.stringify({ tenant, ...body }),
  });
  return handleMentionRoutes(req, env, { send: transport.send, ...(now ? { now } : {}) });
}

const mention = (extra = {}) => ({
  canvas: POSTER,
  thread: 'c_9f2a',
  tokens: ['@ana'],
  reached: [],
  from: 'Jonas',
  excerpt: 'Mrkni prosím na datum, je pořád malé.',
  ...extra,
});

const unsubLink = (text) => /\/emails\/unsubscribe\?t=(meu_[0-9a-f]+)/.exec(text)?.[1] ?? null;

describe('POST /internal/mentions — who gets an e-mail', () => {
  test('no live connection: exactly one e-mail, through the fake transport', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    const res = await forward(env, mention(), { actor: 'jonas@example.com', transport: mail });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { sent: 1 });
    assert.equal(mail.sent.length, 1);
    const [m] = mail.sent;
    assert.equal(m.to, 'ana@example.com');
    assert.equal(m.subject, 'Jonas mentioned you in Alligators brand');
    assert.match(m.text, /A4 plakat/);
    assert.match(m.text, /Mrkni prosím na datum, je pořád malé\./);
    assert.match(m.text, /Change which e-mails you get in Settings › General\./);
    assert.match(m.text, /https:\/\/cloud\.test\/projects\/alligators\/connect\?canvas=/);
    assert.match(m.text, /thread=c_9f2a/);
    assert.ok(unsubLink(m.text), 'carries its own unsubscribe link');
    // Nobody else's address: not the author's, not the owner's, not anyone's.
    for (const other of ['jonas@', 'tereza@', 'olga@', 'lin@', 'ned@']) {
      assert.ok(!m.text.includes(other) && !m.subject.includes(other), other);
    }
  });

  test('reached on a live connection: no e-mail', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    const res = await forward(env, mention({ reached: ['Ana@Example.com'] }), {
      actor: 'jonas@example.com',
      transport: mail,
    });
    assert.deepEqual(await res.json(), { sent: 0 });
    assert.equal(mail.sent.length, 0);
  });

  test('the same mention forwarded twice still sends one e-mail', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    await forward(env, mention(), { actor: 'jonas@example.com', transport: mail });
    await forward(env, mention(), { actor: 'jonas@example.com', transport: mail });
    assert.equal(mail.sent.length, 1);
  });

  test('canvas-only: Lin hears about her canvas, never about another one', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    await forward(env, mention({ tokens: ['@lin'] }), {
      actor: 'jonas@example.com',
      transport: mail,
    });
    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0].to, 'lin@example.com');
    const off = fakeTransport();
    await forward(env, mention({ tokens: ['@lin'], canvas: OTHER, thread: 'c_other' }), {
      actor: 'jonas@example.com',
      transport: off,
    });
    assert.equal(off.sent.length, 0, 'a canvas she cannot open sends her nothing');
    // No canvas named → the project scope, which a canvas-only claim does not see.
    const none = fakeTransport();
    await forward(env, mention({ tokens: ['@lin'], canvas: null, thread: 'c_none' }), {
      actor: 'jonas@example.com',
      transport: none,
    });
    assert.equal(none.sent.length, 0);
  });

  test('unknown handles, outsiders and the author are the same silence', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    const res = await forward(env, mention({ tokens: ['@ned', '@nobody', '@jonas'] }), {
      actor: 'jonas@example.com',
      transport: mail,
    });
    assert.deepEqual(await res.json(), { sent: 0 });
    assert.equal(mail.sent.length, 0);
  });

  test('the address local part reaches the person too (`@tereza`)', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    await forward(env, mention({ tokens: ['@tereza', '@olga'] }), {
      actor: 'ana@example.com',
      transport: mail,
    });
    assert.deepEqual(mail.sent.map((m) => m.to).sort(), ['olga@example.com', 'tereza@example.com']);
    assert.equal(mail.sent[0].subject, 'Ana mentioned you in Alligators brand');
  });

  test('an author without comment on the canvas is refused and nothing is sent', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    for (const actor of ['olga@example.com', 'ned@example.com', '', 'nobody@example.com']) {
      const res = await forward(env, mention(), { actor, transport: mail });
      assert.equal(res.status, 403, actor || '(no actor)');
    }
    assert.equal(mail.sent.length, 0);
  });

  test('a subject line cannot be split by a hostile name or excerpt', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    await env.DB.prepare("UPDATE accounts SET name = 'Jonas\r\nBcc: x@evil.test' WHERE email = ?")
      .bind('jonas@example.com')
      .run();
    await forward(env, mention({ excerpt: 'a\r\nb'.repeat(400) }), {
      actor: 'jonas@example.com',
      transport: mail,
    });
    assert.equal(mail.sent.length, 1);
    assert.doesNotMatch(mail.sent[0].subject, /[\r\n]/);
    const quote = mail.sent[0].text.split('\n').find((l) => l.includes('“a'));
    assert.ok(quote && quote.length < 260, 'the excerpt is one short line');
  });

  test('a project sends at most its daily cap of mention e-mails', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    const now = Date.now();
    for (let i = 0; i <= MENTION_EMAILS_PER_PROJECT_PER_DAY; i++) {
      await forward(env, mention({ thread: `c_${i}` }), {
        actor: 'jonas@example.com',
        transport: mail,
        now: now + i,
      });
    }
    assert.equal(mail.sent.length, MENTION_EMAILS_PER_PROJECT_PER_DAY);
  });
});

describe('POST /internal/mentions — only the project’s own cell', () => {
  test('a wrong secret, another project’s secret, or no master key is 401', async () => {
    const { env } = await world();
    const mail = fakeTransport();
    const wrong = await forward(env, mention(), {
      actor: 'jonas@example.com',
      transport: mail,
      secret: 'not-the-secret',
    });
    assert.equal(wrong.status, 401);
    const otherCell = await forward(env, mention(), {
      actor: 'jonas@example.com',
      transport: mail,
      secret: await deriveCellSecret(MASTER, 'ned-co'),
    });
    assert.equal(otherCell.status, 401);
    const noKey = await forward({ ...env, CELL_SECRET_MASTER: '' }, mention(), {
      actor: 'jonas@example.com',
      transport: mail,
    });
    assert.equal(noKey.status, 401);
    assert.equal(mail.sent.length, 0);
  });

  test('the worker routes it, and a browser session is not a cell', async () => {
    const { env, jonas } = await world();
    const res = await worker.fetch(
      new Request(`https://cloud.test${MENTIONS_PATH}`, {
        method: 'POST',
        headers: { cookie: `maude_session=${jonas.session}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tenant: 'alligators', ...mention() }),
      }),
      env
    );
    assert.equal(res.status, 401);
  });

  test('without a provider key the worker never reaches a real provider', async () => {
    const { env } = await world();
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      calls.push(String(input?.url ?? input));
      return new Response('{}', { status: 500 });
    };
    try {
      const res = await worker.fetch(
        new Request(`https://cloud.test${MENTIONS_PATH}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await deriveCellSecret(MASTER, 'alligators')}`,
            'x-maude-actor': 'jonas@example.com',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ tenant: 'alligators', ...mention() }),
        }),
        env
      );
      assert.equal(res.status, 202);
      assert.deepEqual(await res.json(), { sent: 0 });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(!calls.some((u) => u.includes('resend.com')), calls.join(','));
  });
});

describe('preferences — Settings › General links here', () => {
  const page = (env, session, init = {}) =>
    worker.fetch(
      new Request(`https://cloud.test${EMAIL_PREFS_PATH}`, {
        ...init,
        headers: {
          ...(session ? { cookie: `maude_session=${session}` } : {}),
          ...(init.headers ?? {}),
        },
      }),
      env
    );

  test('signed out → sign in first', async () => {
    const { env } = await world();
    const res = await page(env, null);
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /^\/login\?next=/);
  });

  test('the page shows the one switch, on by default, with the session’s CSRF field', async () => {
    const { env, ana } = await world();
    const res = await page(env, ana.session);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.text();
    assert.match(body, /when someone mentions you/i);
    assert.match(body, /name="mentions"[^>]*checked/);
    assert.ok(body.includes(await accountCsrf(ana.session, MASTER)));
    assert.doesNotMatch(body, /<script/i);
  });

  test('a POST without the CSRF field, or from another origin, changes nothing', async () => {
    const { env, ana } = await world();
    const post = (fields, headers = {}) =>
      page(env, ana.session, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: form(fields),
      });
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ csrf: 'nope' })).status, 403);
    const csrf = await accountCsrf(ana.session, MASTER);
    assert.equal((await post({ csrf }, { origin: 'https://evil.test' })).status, 403);
    assert.equal(await mentionEmailsOn(env.DB, ana.id), true);
  });

  test('turning it off stops the e-mails; on again, they come back', async () => {
    const { env, ana } = await world();
    const csrf = await accountCsrf(ana.session, MASTER);
    const save = (fields) =>
      page(env, ana.session, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://cloud.test',
        },
        body: form({ csrf, ...fields }),
      });
    const off = await save({});
    assert.equal(off.status, 303);
    assert.equal(await mentionEmailsOn(env.DB, ana.id), false);
    const mail = fakeTransport();
    await forward(env, mention(), { actor: 'jonas@example.com', transport: mail });
    assert.equal(mail.sent.length, 0);
    await save({ mentions: 'on' });
    assert.equal(await mentionEmailsOn(env.DB, ana.id), true);
    await forward(env, mention({ thread: 'c_next' }), {
      actor: 'jonas@example.com',
      transport: mail,
    });
    assert.equal(mail.sent.length, 1);
  });
});

describe('the unsubscribe link', () => {
  async function mailed() {
    const w = await world();
    const mail = fakeTransport();
    await forward(w.env, mention(), { actor: 'jonas@example.com', transport: mail });
    return { ...w, token: unsubLink(mail.sent[0].text) };
  }
  const visit = (env, path, init = {}) =>
    worker.fetch(new Request(`https://cloud.test${path}`, init), env);

  test('opening it asks first; a prefetch changes nothing', async () => {
    const { env, ana, token } = await mailed();
    const res = await visit(env, `${UNSUBSCRIBE_PATH}?t=${token}`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<form method="post" action="\/emails\/unsubscribe"/);
    assert.ok(!body.includes('ana@example.com'), 'the page names no address');
    assert.equal(await mentionEmailsOn(env.DB, ana.id), true);
  });

  test('confirming turns mention e-mails off, signs nobody in, and works once', async () => {
    const { env, ana, token } = await mailed();
    const confirm = () =>
      visit(env, UNSUBSCRIBE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ t: token }),
      });
    const res = await confirm();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('set-cookie'), null, 'no session is minted');
    assert.match(await res.text(), /Settings › General/);
    assert.equal(await mentionEmailsOn(env.DB, ana.id), false);
    const again = await confirm();
    assert.equal(again.status, 410);
  });

  test('it is never a session and never another link', async () => {
    const { env, token } = await mailed();
    assert.equal(await sessionAccount(env.DB, token), null);
    const asCookie = await visit(env, EMAIL_PREFS_PATH, {
      headers: { cookie: `maude_session=${token}` },
    });
    assert.equal(asCookie.status, 303, 'the prefs page wants a real session');
    const asBearer = await visit(env, '/api/projects', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(asBearer.status, 401);
    assert.equal((await peekEmailToken(env.DB, token, 'reset')).ok, false);
    assert.equal((await consumeEmailToken(env.DB, token, 'verify')).ok, false);
    assert.equal((await peekEmailToken(env.DB, token, 'unsub')).ok, true, 'still unspent');
  });

  test('a reset link is not an unsubscribe link', async () => {
    const { env, ana } = await world();
    const { token } = await mintEmailToken(env.DB, { accountId: ana.id, purpose: 'reset' });
    const res = await visit(env, UNSUBSCRIBE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ t: token }),
    });
    assert.equal(res.status, 410);
    assert.equal(await mentionEmailsOn(env.DB, ana.id), true);
    assert.equal((await peekEmailToken(env.DB, token, 'reset')).ok, true, 'reset untouched');
  });

  test('each e-mail keeps its own working link (no supersede for unsub)', async () => {
    const { env, ana } = await world();
    const a = await mintEmailToken(env.DB, { accountId: ana.id, purpose: 'unsub' });
    const b = await mintEmailToken(env.DB, { accountId: ana.id, purpose: 'unsub' });
    assert.equal((await peekEmailToken(env.DB, a.token, 'unsub')).ok, true);
    assert.equal((await peekEmailToken(env.DB, b.token, 'unsub')).ok, true);
  });
});

describe('migration v20', () => {
  test('a v19 database keeps its verify/reset links and gains unsub + prefs', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const DB = d1FromSqlite(sqlite);
    const v20 = MIGRATIONS.findIndex((m) => m.version === 20);
    assert.ok(v20 > 0, 'v20 exists');
    const rest = MIGRATIONS.splice(v20);
    try {
      await applySchema(DB, SCHEMA_SQL);
    } finally {
      MIGRATIONS.push(...rest);
    }
    sqlite
      .prepare(
        "INSERT INTO accounts (id, email, name, created_at) VALUES ('acct_1', 'a@example.com', 'A', 1)"
      )
      .run();
    const { token } = await mintEmailToken(DB, { accountId: 'acct_1', purpose: 'reset' });
    const { version } = await applySchema(DB, SCHEMA_SQL);
    assert.equal(version, Math.max(...MIGRATIONS.map((m) => m.version)));
    const versions = MIGRATIONS.map((m) => m.version);
    for (let i = 1; i < versions.length; i++) {
      assert.equal(versions[i], versions[i - 1] + 1, 'contiguous');
    }
    assert.equal((await peekEmailToken(DB, token, 'reset')).ok, true, 'old link survives');
    assert.ok((await mintEmailToken(DB, { accountId: 'acct_1', purpose: 'unsub' })).token);
    assert.equal(await mentionEmailsOn(DB, 'acct_1'), true);
  });
});
