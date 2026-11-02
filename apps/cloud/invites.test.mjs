// The invitation round trip — Cloud Phase 22.
//
// Same posture as auth-routes.test.mjs: real SQLite behind the D1 shape, real
// Request/Response through the live worker, no route mocked. The email
// provider is the one thing faked, because the test asserting "an email left
// the building" belongs to email.test.mjs — here it only matters that the
// invite works whether or not the send did.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { d1FromSqlite } from './db.mjs';
import { allInviteHtml, invitePage } from './invites.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const PASSWORD = 'a-long-enough-password';

async function freshEnv(extra = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  return { env: { DB, ...extra }, sqlite };
}

function form(fields) {
  return new URLSearchParams(fields).toString();
}

async function signup(env, { email = 'owner@example.com', password = PASSWORD } = {}) {
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email, password, disclosure: 'yes' }),
    }),
    env
  );
  return /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
}

/** An owner with a project, plus their session cookie. */
async function ownerWithProject(env, sqlite) {
  const session = await signup(env);
  const ownerId = sqlite.prepare('SELECT id FROM accounts ORDER BY created_at').get().id;
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
       VALUES ('alligators', ?, 'Brno Alligators', 'active', 1, 1)`
    )
    .run(ownerId);
  return { session, ownerId };
}

async function inviteSomeone(env, session, email = 'teammate@example.com') {
  const res = await worker.fetch(
    new Request('https://cloud.test/projects/alligators/people', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `maude_session=${session}`,
      },
      body: form({ do: 'invite', email, role: 'member' }),
    }),
    env
  );
  return res;
}

test('inviting an unknown address writes an invite and dispatches the email', async () => {
  const { env, sqlite } = await freshEnv({ RESEND_API_KEY: 'k' });
  const sends = [];
  globalThis.__origFetch ??= globalThis.fetch;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('api.resend.com')) {
      sends.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 });
    }
    return realFetch(input, init);
  };
  try {
    const { session } = await ownerWithProject(env, sqlite);
    const res = await inviteSomeone(env, session);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Invitation sent to teammate@example\.com/);

    const row = sqlite.prepare('SELECT * FROM project_invites').get();
    assert.equal(row.email, 'teammate@example.com');
    // Selected by recipient rather than counted: the OWNER's own signup, a few
    // lines up, now also sends mail (the address-confirmation link added by the
    // RCA of 2026-08-04), so a bare `sends.length` here would be asserting how
    // many emails the whole fixture happens to produce.
    const invite = sends.filter((m) => m.to.includes('teammate@example.com'));
    assert.equal(invite.length, 1);
    assert.match(invite[0].text, new RegExp(`/invite/${row.id}`));
    assert.match(invite[0].subject, /owner@example\.com invited you to Brno Alligators/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('when sending is not configured, the owner gets the link to share themselves', async () => {
  const { env, sqlite } = await freshEnv(); // no RESEND_API_KEY
  const { session } = await ownerWithProject(env, sqlite);
  const res = await inviteSomeone(env, session);
  const body = await res.text();
  const row = sqlite.prepare('SELECT * FROM project_invites').get();
  assert.match(body, /could not be sent/);
  assert.match(body, new RegExp(`/invite/${row.id}`));
});

test('the invite link signs a new person up AND lands them in the project', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();

  // The page offers account creation for an address with no account.
  const pageRes = await worker.fetch(new Request(`https://cloud.test/invite/${invite.id}`), env);
  assert.equal(pageRes.status, 200);
  const page = await pageRes.text();
  assert.match(page, /Join Brno Alligators/);
  assert.match(page, /Choose a password/);

  const accept = await worker.fetch(
    new Request(`https://cloud.test/invite/${invite.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  assert.equal(accept.status, 303);
  assert.match(accept.headers.get('set-cookie') ?? '', /maude_session=/);

  const member = sqlite
    .prepare(
      `SELECT m.role FROM project_members m JOIN accounts a ON a.id = m.account_id
        WHERE a.email = 'teammate@example.com' AND m.project_id = 'alligators'`
    )
    .get();
  assert.equal(member?.role, 'member');
  assert.ok(sqlite.prepare('SELECT redeemed_at FROM project_invites').get().redeemed_at > 0);
});

test('a redeemed link is dead, with ONE neutral sentence', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();
  await worker.fetch(
    new Request(`https://cloud.test/invite/${invite.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );

  const again = await worker.fetch(new Request(`https://cloud.test/invite/${invite.id}`), env);
  assert.equal(again.status, 404);
  const body = await again.text();
  assert.match(body, /not valid/);
  assert.ok(!/redeem|expired|revoked/i.test(body), 'the reason must not be disclosed');
});

test('an expired link and a guessed id read identically', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();
  sqlite.prepare('UPDATE project_invites SET expires_at = 1 WHERE id = ?').run(invite.id);

  const expired = await worker.fetch(new Request(`https://cloud.test/invite/${invite.id}`), env);
  const guessed = await worker.fetch(
    new Request(`https://cloud.test/invite/${crypto.randomUUID()}`),
    env
  );
  assert.equal(expired.status, 404);
  assert.equal(guessed.status, 404);
  assert.equal(await expired.text(), await guessed.text());
});

test('an account created AFTER the invite is sent to sign in, not to sign up', async () => {
  // An address that already has an account at invite time gets the same
  // pending invitation (gate-b-sec3, pending-invites.test.mjs). This is the
  // other ordering: invited first, signed up independently later.
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();
  await signup(env, { email: 'teammate@example.com' });

  const res = await worker.fetch(new Request(`https://cloud.test/invite/${invite.id}`), env);
  const body = await res.text();
  assert.match(body, /already have a Maude account/);
  assert.ok(!/Choose a password/.test(body));

  // And a POST in that state creates nothing.
  const post = await worker.fetch(
    new Request(`https://cloud.test/invite/${invite.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  assert.equal(post.status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM project_members').get().n, 0);
});

test('signed in as the invitee, one button joins', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();
  const inviteeSession = await signup(env, { email: 'teammate@example.com' });

  const res = await worker.fetch(
    new Request(`https://cloud.test/invite/${invite.id}`, {
      headers: { cookie: `maude_session=${inviteeSession}` },
    }),
    env
  );
  assert.match(await res.text(), /Join the project/);

  const join = await worker.fetch(
    new Request(`https://cloud.test/invite/${invite.id}`, {
      method: 'POST',
      headers: { cookie: `maude_session=${inviteeSession}` },
    }),
    env
  );
  assert.equal(join.status, 303);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM project_members').get().n, 1);
});

// The Google button on this page was reported as "does nothing". It did
// something: it signed the person in as their OWN Google address, returned
// here, found no account for the INVITED address, and re-rendered the same
// screen. A swapped session and an unchanged page is the worst possible answer.
test('signed in as the wrong person, the page says so instead of pretending', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();
  const strangerSession = await signup(env, { email: 'someone.else@example.com' });

  const res = await worker.fetch(
    new Request(`https://cloud.test/invite/${invite.id}`, {
      headers: { cookie: `maude_session=${strangerSession}` },
    }),
    env
  );
  const body = await res.text();
  assert.match(body, /someone\.else@example\.com/, 'names who you actually are');
  assert.match(body, /teammate@example\.com/, 'and who the invitation is for');
  assert.match(body, /action="\/auth\/logout"/, 'and offers the one way out');
  assert.match(body, new RegExp(`value="/invite/${invite.id}"`), 'that comes back here');
});

test('the owner opening their own invitation link is not accused of anything', async () => {
  // The mismatch notice must key on the ADDRESS, not on "somebody is signed in".
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();
  const inviteeSession = await signup(env, { email: 'teammate@example.com' });

  const res = await worker.fetch(
    new Request(`https://cloud.test/invite/${invite.id}`, {
      headers: { cookie: `maude_session=${inviteeSession}` },
    }),
    env
  );
  assert.doesNotMatch(await res.text(), /You are signed in as/);
});

test('the Google door opens on the invited address, not on whoever is logged in', async () => {
  const { env, sqlite } = await freshEnv({
    GOOGLE_CLIENT_ID: 'client-1',
    GOOGLE_CLIENT_SECRET: 'secret-1',
  });
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();

  const res = await worker.fetch(
    new Request(
      `https://cloud.test/auth/google?next=${encodeURIComponent(`/invite/${invite.id}`)}`
    ),
    env
  );
  assert.equal(res.status, 303);
  const to = new URL(res.headers.get('location'));
  assert.equal(to.searchParams.get('login_hint'), 'teammate@example.com');

  // An ordinary sign-in has nobody to preselect, and must not invent one.
  const plain = await worker.fetch(new Request('https://cloud.test/auth/google'), env);
  assert.equal(new URL(plain.headers.get('location')).searchParams.get('login_hint'), null);
});

test('signing out from an invitation comes back to it', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();
  const strangerSession = await signup(env, { email: 'someone.else@example.com' });

  const out = await worker.fetch(
    new Request('https://cloud.test/auth/logout', {
      method: 'POST',
      headers: {
        cookie: `maude_session=${strangerSession}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form({ next: `/invite/${invite.id}` }),
    }),
    env
  );
  assert.equal(out.status, 303);
  assert.equal(out.headers.get('location'), `/invite/${invite.id}`);

  // …and the same field cannot be used to bounce someone off the site.
  const away = await worker.fetch(
    new Request('https://cloud.test/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ next: 'https://evil.example/' }),
    }),
    env
  );
  assert.equal(away.headers.get('location'), '/');
});

test('declining the disclosure creates neither account nor membership', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();

  const res = await worker.fetch(
    new Request(`https://cloud.test/invite/${invite.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ password: PASSWORD }),
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1); // just the owner
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM project_members').get().n, 0);
});

// Cloud Phase 24 A12b. The join screen is the invitee's FIRST contact with
// Maude and was the one door in the funnel offering only "invent 12
// characters" — while the dashboard's own front door offers one click.
test('the join page offers Google ABOVE the password field, carrying the invite', () => {
  const html = invitePage({
    projectName: 'Brno Alligators',
    inviteId: 'x'.repeat(36),
    role: 'viewer',
    mode: 'create',
    email: 'petra@example.com',
    googleEnabled: true,
  });
  const google = html.indexOf('Continue with Google');
  const password = html.indexOf('Choose a password');
  assert.ok(google > 0 && google < password, 'Google must come first on the join screen');
  assert.match(html, /\/auth\/google\?next=%2Finvite%2Fx{36}/);
  // And it names the address, because signing in with the wrong Google account
  // silently lands somebody back on a page asking for a password.
  assert.match(html, /petra@example\.com/);
});

test('with Google unconfigured the join page is exactly what it was', () => {
  const html = invitePage({
    projectName: 'Brno Alligators',
    inviteId: 'x'.repeat(36),
    role: 'member',
    mode: 'create',
    email: 'new@example.com',
  });
  assert.doesNotMatch(html, /Continue with Google/);
  assert.match(html, /Choose a password/);
});

// ------------------------------------------------------------------- strings

test('the invite pages ship no script and escape what they interpolate', () => {
  const html = allInviteHtml();
  assert.ok(!/<script/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
});

test('the invite pages use no vocabulary of ours', () => {
  const html = allInviteHtml();
  for (const jargon of ['tenant', 'cell', 'token', 'revoke', 'session', 'container']) {
    assert.ok(
      !new RegExp(`\\b${jargon}`, 'i').test(html),
      `"${jargon}" leaked into the invite page`
    );
  }
});

test('sign-in mode carries the invite as the login destination, and login honors it', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session);
  const invite = sqlite.prepare('SELECT * FROM project_invites').get();
  await signup(env, { email: 'teammate@example.com' });

  const page = await worker.fetch(new Request(`https://cloud.test/invite/${invite.id}`), env);
  assert.match(await page.text(), new RegExp(`/login\\?next=%2Finvite%2F${invite.id}`));

  const login = await worker.fetch(
    new Request(`https://cloud.test/auth/login?next=%2Finvite%2F${invite.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email: 'teammate@example.com', password: PASSWORD }),
    }),
    env
  );
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), `/invite/${invite.id}`);
});

test('a hostile next is ignored — external and protocol-relative URLs fall back to /', async () => {
  const { env } = await freshEnv();
  await signup(env, { email: 'a@example.com' });
  for (const evil of ['https://evil.example', '//evil.example', 'javascript:alert(1)']) {
    const res = await worker.fetch(
      new Request(`https://cloud.test/auth/login?next=${encodeURIComponent(evil)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ email: 'a@example.com', password: PASSWORD }),
      }),
      env
    );
    assert.equal(res.headers.get('location'), '/', `"${evil}" must not be a destination`);
  }
});

test('the owner’s People page lists pending invitations and Can-view people (S9.16)', async () => {
  const { env, sqlite } = await freshEnv(); // no RESEND_API_KEY: the invite is still created
  const { session, ownerId } = await ownerWithProject(env, sqlite);
  await inviteSomeone(env, session, 'pending@example.com');
  await signup(env, { email: 'guest@example.com' });
  const guest = sqlite.prepare("SELECT id FROM accounts WHERE email = 'guest@example.com'").get();
  sqlite
    .prepare(
      `INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_by, granted_at)
       VALUES ('alligators', ?, 'ui/Homepage.tsx', 'viewer', 'owner', ?, 1)`
    )
    .run(guest.id, ownerId);
  const res = await worker.fetch(
    new Request('https://cloud.test/projects/alligators/people', {
      headers: { cookie: `maude_session=${session}` },
    }),
    env
  );
  const html = await res.text();
  assert.match(html, /pending@example\.com/, 'a pending invitation is listed');
  assert.match(html, /guest@example\.com/, 'a Can-view person is listed');
  assert.match(html, /Homepage/, 'with the canvas they can open');
});

test('the People page invites an account holder like anyone: same answer, nobody added (gate-b-sec3)', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  await signup(env, { email: 'teammate@example.com' });
  const known = await inviteSomeone(env, session, 'teammate@example.com');
  const unknown = await inviteSomeone(env, session, 'nobody-yet@example.com');
  assert.equal(known.status, unknown.status);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM project_members').get().n, 0);
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM project_invites WHERE email = 'teammate@example.com'")
      .get().n,
    1
  );
});
