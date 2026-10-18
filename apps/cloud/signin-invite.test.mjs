// Sign-in return links, the pending invitation, and the device-token landing —
// S6↔S9 contract §5.1 steps 3–7 + §5.2 (Maude v2 S9.14).
//
// Real SQLite behind the D1 shape, real Requests through the live Worker.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { d1FromSqlite } from './db.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const PASSWORD = 'a-long-enough-password';
const STATE = '0123456789abcdef0123456789abcdef';
const form = (f) => new URLSearchParams(f).toString();

async function freshEnv() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  sqlite
    .prepare(
      `INSERT INTO accounts (id, email, name, created_at) VALUES ('a1', 'tereza@example.com', 'Tereza', 1)`
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
       VALUES ('alligators', 'a1', 'Alligators brand', 'active', 1, 1)`
    )
    .run();
  return { env: { DB, CELL_SECRET_MASTER: 'master' }, sqlite };
}

function plantInvite(sqlite, { email = 'jonas@example.com', canvas = null, thread = null } = {}) {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, canvas_path, invited_by, thread)
       VALUES (?, 'alligators', ?, 'member', ?, ?, ?, 'a1', ?)`
    )
    .run(id, email, Date.now(), Date.now() + 86_400_000, canvas, thread);
  return id;
}

async function signup(env, email, { cookie = '', next = null } = {}) {
  return worker.fetch(
    new Request(
      `https://cloud.test/auth/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(cookie ? { cookie } : {}),
        },
        body: form({ email, password: PASSWORD, disclosure: 'yes' }),
      }
    ),
    env
  );
}

const sessionOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => /^maude_session=([^;]+)/.exec(c)?.[1])
    .find(Boolean);

const jpost = (path, body) =>
  new Request(`https://cloud.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// ------------------------------------------------------------------ §5.1 step 5

test('password login with the pending-invite cookie redeems it and clears the reminder', async () => {
  const { env, sqlite } = await freshEnv();
  await signup(env, 'jonas@example.com');
  const id = plantInvite(sqlite);
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `maude_pending_invite=${id}`,
      },
      body: form({ email: 'jonas@example.com', password: PASSWORD }),
    }),
    env
  );
  assert.equal(res.status, 303);
  const cookies = res.headers.getSetCookie();
  assert.ok(sessionOf(res), 'the session cookie is its own header');
  assert.ok(
    cookies.some((c) => /^maude_pending_invite=; .*Max-Age=0/.test(c)),
    'the reminder is cleared'
  );
  assert.ok(
    sqlite.prepare('SELECT redeemed_at FROM project_invites WHERE id = ?').get(id).redeemed_at
  );
  const member = sqlite
    .prepare(
      "SELECT m.role FROM project_members m JOIN accounts a ON a.id = m.account_id WHERE a.email = 'jonas@example.com'"
    )
    .get();
  assert.equal(member.role, 'member');
});

test('signup with the cookie redeems too — and an invitation for SOMEONE ELSE is not', async () => {
  const { env, sqlite } = await freshEnv();
  const mine = plantInvite(sqlite, { email: 'new@example.com' });
  const res = await signup(env, 'new@example.com', { cookie: `maude_pending_invite=${mine}` });
  assert.equal(res.status, 303);
  assert.ok(
    sqlite.prepare('SELECT redeemed_at FROM project_invites WHERE id = ?').get(mine).redeemed_at
  );

  const theirs = plantInvite(sqlite, { email: 'petra@example.com' });
  await signup(env, 'other@example.com', { cookie: `maude_pending_invite=${theirs}` });
  assert.equal(
    sqlite.prepare('SELECT redeemed_at FROM project_invites WHERE id = ?').get(theirs).redeemed_at,
    null,
    'the cookie is a reminder, never a credential'
  );
});

test('signup carries next= back to where the app (or the invite) sent the person', async () => {
  const { env } = await freshEnv();
  const next = `/activate?code=ABCD-EFGH&state=${STATE}`;
  const res = await signup(env, 'fresh@example.com', { next });
  assert.equal(res.headers.get('location'), next);
  const evil = await signup(env, 'fresh2@example.com', { next: '//evil.example/x' });
  assert.equal(evil.headers.get('location'), '/', 'an off-origin next is refused');
});

// --------------------------------------------------------------- §5.1 steps 3–7

test('/activate from the app: state carried, Cancel back to the app, done page nudges', async () => {
  const { env, sqlite } = await freshEnv();
  const session = sessionOf(await signup(env, 'jonas@example.com'));
  const code = await (
    await worker.fetch(jpost('/auth/device/code', { client: 'Maude on macOS' }), env)
  ).json();

  const page = await worker.fetch(
    new Request(`${code.verification_url}&state=${STATE}`, {
      headers: { cookie: `maude_session=${session}` },
    }),
    env
  );
  const html = await page.text();
  assert.match(html, new RegExp(`name="state" value="${STATE}"`));
  assert.match(html, new RegExp(`href="maude://auth/cancelled\\?state=${STATE}"`));
  assert.match(html, /Cancel and go back to the app/);

  const done = await worker.fetch(
    new Request('https://cloud.test/activate', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `maude_session=${session}`,
      },
      body: form({ code: code.user_code, state: STATE }),
    }),
    env
  );
  assert.equal(done.status, 200);
  assert.equal(done.headers.get('location'), null, 'never a maude:// Location header');
  const doneHtml = await done.text();
  assert.match(doneHtml, /<h1>You(?:'|&#39;)re signed in — go back to Maude\.<\/h1>/);
  assert.match(
    doneHtml,
    new RegExp(`<meta http-equiv="refresh" content="0;url=maude://auth/done\\?state=${STATE}">`)
  );
  assert.match(
    doneHtml,
    new RegExp(`<a class="btn" href="maude://auth/done\\?state=${STATE}">Open Maude</a>`)
  );
  assert.ok(sqlite.prepare('SELECT approved_account FROM device_codes').get().approved_account);
});

test('a state that is not 32 lowercase hex never reaches markup (invariant 2)', async () => {
  const { env } = await freshEnv();
  const session = sessionOf(await signup(env, 'jonas@example.com'));
  for (const bad of ['"><img src=x>', STATE.toUpperCase(), `${STATE}0`, 'abc']) {
    const page = await worker.fetch(
      new Request(`https://cloud.test/activate?code=ABCD-EFGH&state=${encodeURIComponent(bad)}`, {
        headers: { cookie: `maude_session=${session}` },
      }),
      env
    );
    const html = await page.text();
    assert.equal(page.status, 200, 'the page still works');
    assert.ok(!html.includes('maude://'), `no app link for ${bad}`);
    assert.ok(!html.includes('<img src=x>'));
    const login = await worker.fetch(
      new Request(
        `https://cloud.test/login?next=${encodeURIComponent(`/activate?code=X&state=${bad}`)}`
      ),
      env
    );
    assert.ok(!(await login.text()).includes('maude://'), `no Cancel on /login for ${bad}`);
  }
});

test('signed out: /activate → /login keeps state + invite; the sign-in page offers the way back', async () => {
  const { env, sqlite } = await freshEnv();
  const id = plantInvite(sqlite);
  const res = await worker.fetch(
    new Request(`https://cloud.test/activate?code=ABCD-EFGH&state=${STATE}&invite=${id}`),
    env
  );
  assert.equal(res.status, 303);
  const location = res.headers.get('location');
  assert.match(location, /^\/login\?next=/);
  assert.match(
    res.headers.get('set-cookie') ?? '',
    new RegExp(`maude_pending_invite=${id}; Path=/; Max-Age=1800;`),
    'the invitation is remembered exactly like GET /invite/<id>'
  );
  const login = await worker.fetch(new Request(`https://cloud.test${location}`), env);
  const html = await login.text();
  assert.match(html, /Sign in to cloud\.test/);
  assert.match(html, /Then this page sends you back to the app\./);
  assert.match(html, new RegExp(`maude://auth/cancelled\\?state=${STATE}`));
  // The invite's address is pre-filled server-side and never put in a URL.
  assert.match(html, /value="jonas@example\.com"/);
  for (const href of html.matchAll(/(?:href|action)="([^"]+)"/g)) {
    assert.ok(!decodeURIComponent(href[1]).includes('jonas@example.com'), href[1]);
  }
  // "New here?" keeps the way back to the app.
  assert.match(html, /href="\/signup\?next=%2Factivate%3F/);

  // A dead invitation id is dropped: no cookie, page still works.
  sqlite.prepare('UPDATE project_invites SET revoked_at = 1 WHERE id = ?').run(id);
  const dead = await worker.fetch(
    new Request(`https://cloud.test/activate?code=ABCD-EFGH&state=${STATE}&invite=${id}`),
    env
  );
  assert.equal(dead.headers.get('set-cookie'), null);
});

// ------------------------------------------------------------------------ §5.2

test('the device-token reply carries landing after an invitation is redeemed at /activate', async () => {
  const { env, sqlite } = await freshEnv();
  const id = plantInvite(sqlite, { canvas: 'brand/Combine-kampan.tsx', thread: 't1' });
  const session = sessionOf(await signup(env, 'jonas@example.com'));
  const code = await (await worker.fetch(jpost('/auth/device/code', {}), env)).json();
  const approve = await worker.fetch(
    new Request('https://cloud.test/activate', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `maude_session=${session}; maude_pending_invite=${id}`,
      },
      body: form({ code: code.user_code, state: STATE }),
    }),
    env
  );
  assert.ok(
    approve.headers.getSetCookie().some((c) => /^maude_pending_invite=; /.test(c)),
    'the approval is a sign-in completion: the reminder is spent'
  );
  const token = await (
    await worker.fetch(jpost('/auth/device/token', { device_code: code.device_code }), env)
  ).json();
  assert.match(token.token, /^mpt_/);
  assert.deepEqual(token.landing, {
    project: 'alligators',
    canvas: 'brand/Combine-kampan.tsx',
    thread: 't1',
  });
});

test('no invitation → the v1 token reply, byte-for-byte keys (no landing key)', async () => {
  const { env } = await freshEnv();
  const session = sessionOf(await signup(env, 'jonas@example.com'));
  const code = await (await worker.fetch(jpost('/auth/device/code', {}), env)).json();
  await worker.fetch(
    new Request('https://cloud.test/activate', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `maude_session=${session}`,
      },
      body: form({ code: code.user_code }),
    }),
    env
  );
  const token = await (
    await worker.fetch(jpost('/auth/device/token', { device_code: code.device_code }), env)
  ).json();
  assert.deepEqual(Object.keys(token).sort(), ['account', 'token']);
});
