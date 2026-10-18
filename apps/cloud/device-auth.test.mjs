// The device sign-in round trip — Cloud Phase 23 C1/C2.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { d1FromSqlite } from './db.mjs';
import { allDeviceHtml, makeUserCode } from './device-auth.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const PASSWORD = 'a-long-enough-password';

async function freshEnv(extra = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  return { env: { DB, CELL_SECRET_MASTER: 'master', ...extra }, sqlite };
}

const form = (f) => new URLSearchParams(f).toString();

async function signedIn(env, email = 'owner@example.com') {
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email, password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  return /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
}

const jpost = (path, body, headers = {}) =>
  new Request(`https://cloud.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** The whole happy path, reused: code → approve → token. */
async function connectDevice(env, session) {
  const code = await (
    await worker.fetch(jpost('/auth/device/code', { client: 'Maude Desktop' }), env)
  ).json();
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
  return { code, token };
}

test('the flow: code → human approves on /activate → poll → personal token', async () => {
  const { env } = await freshEnv();
  const session = await signedIn(env);

  const code = await (
    await worker.fetch(jpost('/auth/device/code', { client: 'Maude Desktop on MacBook' }), env)
  ).json();
  assert.match(code.user_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(code.verification_url, /\/activate\?code=/);

  // Polling BEFORE approval: pending, not an error, not a token.
  const pending = await worker.fetch(
    jpost('/auth/device/token', { device_code: code.device_code }),
    env
  );
  assert.equal(pending.status, 202);
  assert.equal((await pending.json()).pending, true);

  // The human approves. The activate page requires the dashboard session.
  const anon = await worker.fetch(
    new Request(`https://cloud.test/activate?code=${code.user_code}`),
    env
  );
  assert.equal(anon.status, 303);
  assert.match(anon.headers.get('location'), /^\/login\?next=/);

  const approve = await worker.fetch(
    new Request('https://cloud.test/activate', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `maude_session=${session}`,
      },
      body: form({ code: code.user_code.toLowerCase() }), // case must not matter
    }),
    env
  );
  // Words per the S6↔S9 contract §5.1 step 6 (Maude v2 S9.14).
  assert.match(await approve.text(), /You're signed in — go back to Maude\./);

  const minted = await (
    await worker.fetch(jpost('/auth/device/token', { device_code: code.device_code }), env)
  ).json();
  assert.match(minted.token, /^mpt_[0-9a-f]{48}$/);
  assert.equal(minted.account.email, 'owner@example.com');

  // The code is burnt — a second poll cannot mint a second credential.
  const replay = await worker.fetch(
    jpost('/auth/device/token', { device_code: code.device_code }),
    env
  );
  assert.equal(replay.status, 400);
});

test('the personal token lists projects and opens one', async () => {
  const { env, sqlite } = await freshEnv();
  const session = await signedIn(env);
  const ownerId = sqlite.prepare('SELECT id FROM accounts').get().id;
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
       VALUES ('alligators', ?, 'Brno Alligators', 'active', 1, 1)`
    )
    .run(ownerId);
  const { token } = await connectDevice(env, session);

  const list = await (
    await worker.fetch(
      new Request('https://cloud.test/api/projects', {
        headers: { authorization: `Bearer ${token.token}` },
      }),
      env
    )
  ).json();
  assert.equal(list.projects.length, 1);
  assert.equal(list.projects[0].id, 'alligators');
  assert.equal(list.projects[0].role, 'owner');
  assert.equal(list.projects[0].stateLabel, 'Ready');

  // The same Bearer opens the project — no cookie anywhere in the lane.
  const opened = await (
    await worker.fetch(
      jpost(
        '/projects/open',
        { project: 'alligators' },
        { authorization: `Bearer ${token.token}` }
      ),
      env
    )
  ).json();
  assert.match(opened.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(opened.role, 'owner');
});

test('revoking from /account cuts the device off, with ONE neutral 401', async () => {
  const { env, sqlite } = await freshEnv();
  const session = await signedIn(env);
  const { token } = await connectDevice(env, session);

  const id = sqlite.prepare('SELECT id FROM personal_tokens').get().id;
  await worker.fetch(
    new Request('https://cloud.test/account', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `maude_session=${session}`,
      },
      body: form({ revoke: id }),
    }),
    env
  );

  const after = await worker.fetch(
    new Request('https://cloud.test/api/projects', {
      headers: { authorization: `Bearer ${token.token}` },
    }),
    env
  );
  assert.equal(after.status, 401);
});

test('an expired or foreign code cannot be approved', async () => {
  const { env, sqlite } = await freshEnv();
  const session = await signedIn(env);
  const code = await (await worker.fetch(jpost('/auth/device/code', {}), env)).json();
  sqlite.prepare('UPDATE device_codes SET expires_at = 1').run();

  const res = await worker.fetch(
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
  assert.equal(res.status, 400);
  assert.match(await res.text(), /not waiting for approval/);
});

test('user codes avoid look-alike characters', () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(!/[01OI]/.test(makeUserCode().replace('-', '')));
  }
});

test('the device pages ship no script and no vocabulary of ours', () => {
  const html = allDeviceHtml();
  assert.ok(!/<script/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  for (const jargon of [
    'tenant',
    'cell',
    'token',
    'container',
    'provision',
    'webhook',
    'oauth',
    'device flow',
  ]) {
    assert.ok(
      !new RegExp(`\\b${jargon}`, 'i').test(html),
      `"${jargon}" leaked into the device pages`
    );
  }
});

test('a prefilled code NAMES the app that asked — consent without a subject is the phishing shape', async () => {
  const { env } = await freshEnv();
  const session = await signedIn(env);
  const code = await (
    await worker.fetch(jpost('/auth/device/code', { client: 'Maude Studio on darwin' }), env)
  ).json();

  const page = await worker.fetch(
    new Request(`https://cloud.test/activate?code=${code.user_code}`, {
      headers: { cookie: `maude_session=${session}` },
    }),
    env
  );
  const html = await page.text();
  assert.match(html, /Maude Studio on darwin/, 'the requesting app is named');
  assert.match(html, /wants to use your account/);
  assert.match(html, /Confirm the code/, 'and the label reflects that it is prefilled');
});

test('a prefilled code that is NOT waiting names nothing and invents nothing', async () => {
  const { env } = await freshEnv();
  const session = await signedIn(env);
  const page = await worker.fetch(
    new Request('https://cloud.test/activate?code=ZZZZ-ZZZZ', {
      headers: { cookie: `maude_session=${session}` },
    }),
    env
  );
  const html = await page.text();
  assert.doesNotMatch(html, /wants to use your account/);
  assert.match(html, /Enter the code/, 'it falls back to the plain ask');
});
