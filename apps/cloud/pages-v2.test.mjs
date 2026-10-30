// The v2 public pages — sign in, the invitation, shared links (Maude v2 S9.14,
// canvases 02 ob-signin-browser + ob-invite-page; words per CONTRACT §3–§4).

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { DESKTOP_DOWNLOAD_URL } from './brand.mjs';
import { d1FromSqlite } from './db.mjs';
import { allDeviceHtml } from './device-auth.mjs';
import { allInviteHtml } from './invites.mjs';
import { allLinkPages, LINK_OFF } from './links.mjs';
import { applySchema } from './migrate.mjs';
import {
  checkInboxPage,
  forgotPage,
  homePage,
  loginPage,
  messagePage,
  resetPage,
  signupPage,
  verifiedPage,
} from './pages.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const STATE = 'fedcba9876543210fedcba9876543210';

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
  return { env: { DB }, sqlite };
}

function plantInvite(sqlite, { canvas = null, thread = null, by = 'a1' } = {}) {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, canvas_path, invited_by, thread)
       VALUES (?, 'alligators', 'jonas@example.com', 'viewer', ?, ?, ?, ?, ?)`
    )
    .run(id, Date.now(), Date.now() + 86_400_000, canvas, by, thread);
  return id;
}

/**
 * The visible words the PAGE speaks: markup, styles and attribute values
 * stripped. A consent checkbox's label is the person speaking ("I’ve read …"),
 * not the page, so it is left out — §4 is about how the product talks.
 */
function words(html) {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<label[^>]*><input type="checkbox"[\s\S]*?<\/label>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');
}

const OWNED_PAGES = async () =>
  [
    allInviteHtml(),
    allDeviceHtml(),
    await allLinkPages(),
    signupPage({ googleEnabled: true }),
    signupPage({ googleEnabled: true, next: `/activate?code=X&state=${STATE}` }),
    loginPage({ googleEnabled: true, next: `/activate?code=X&state=${STATE}` }),
    loginPage({ googleEnabled: true, error: 'That email and password don’t match.' }),
    forgotPage(),
    checkInboxPage(),
    resetPage({ token: 'x'.repeat(48) }),
    verifiedPage({ googleEnabled: true }),
    homePage({ googleEnabled: true }),
    homePage({ account: { email: 'a@example.com' } }),
    messagePage('Sign-in didn’t complete', 'Please try again from the sign-in page.'),
  ].join('\n');

test('the public pages answer with the strict page headers (CSP, no-referrer, no-store)', async () => {
  const { env, sqlite } = await freshEnv();
  const id = plantInvite(sqlite);
  for (const path of [
    `/login?next=${encodeURIComponent(`/activate?code=X&state=${STATE}`)}`,
    '/signup',
    `/invite/${id}`,
    `/invite/${crypto.randomUUID()}`,
    '/l/nope',
  ]) {
    const res = await worker.fetch(new Request(`https://cloud.test${path}`), env);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/, path);
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.doesNotMatch(csp, /script-src/, `${path}: no script is ever allowed`);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', path);
    const html = await res.text();
    assert.ok(!/<script/i.test(html), path);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), path);
  }
});

test('the sign-in page from the app: canvas words, and the cancel URL is exactly the nudge', async () => {
  const { env } = await freshEnv();
  const res = await worker.fetch(
    new Request(
      `https://cloud.test/login?next=${encodeURIComponent(`/activate?code=ABCD-EFGH&state=${STATE}`)}`
    ),
    env
  );
  const html = await res.text();
  assert.match(html, /<h1>Sign in to cloud\.test<\/h1>/);
  assert.match(html, /Then this page sends you back to the app\./);
  assert.match(html, /Continue with Google|<label for="email">Email/);
  const links = [...html.matchAll(/href="(maude:[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(links, [`maude://auth/cancelled?state=${STATE}`]);
  // Without the app's hand-off it is the plain sign-in: no app link.
  const plain = await (await worker.fetch(new Request('https://cloud.test/login'), env)).text();
  assert.match(plain, /<h1>Sign in<\/h1>/);
  assert.ok(!plain.includes('maude://'));
});

test('the invitation: who, to what, the comment — one download, Open in Maude, the browser path', async () => {
  const { env, sqlite } = await freshEnv();
  const id = plantInvite(sqlite, { canvas: 'brand/Combine-kampan.tsx', thread: 't1' });
  const res = await worker.fetch(new Request(`https://cloud.test/invite/${id}`), env);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>Tereza invited you to Alligators brand<\/h1>/);
  assert.match(html, /<strong>Combine-kampan<\/strong>/);
  assert.match(html, /Tereza left a comment for you on this canvas\./);
  assert.match(html, /You’re on Combine-kampan, by Tereza’s comment/);
  assert.equal([...html.matchAll(/Download Maude for Mac/g)].length, 1, 'exactly one download');
  assert.ok(html.includes(`href="${DESKTOP_DOWNLOAD_URL}"`));
  assert.match(html, new RegExp(`href="maude://invite/${id}">Already installed\\? Open in Maude`));
  assert.match(html, /Just looking\? See it in the browser/);
  // Invariant 1: a maude:// URL carries no e-mail, no project name, no credential.
  for (const [, url] of html.matchAll(/"(maude:[^"]*)"/g)) {
    for (const leak of ['@', 'Alligators', 'alligators', 'mpt_', 'mhc_', 'mdc_', 'Tereza']) {
      assert.ok(!decodeURIComponent(url).includes(leak), `${url} carries ${leak}`);
    }
  }
  // The inviter's e-mail never reaches the page.
  assert.ok(!html.includes('tereza@example.com'));
  // The pending-invite reminder is set exactly as before (S9 Q6).
  assert.match(res.headers.get('set-cookie') ?? '', new RegExp(`maude_pending_invite=${id};`));
});

test('an inviter without a name and a project-wide invitation read plainly (O3)', async () => {
  const { env, sqlite } = await freshEnv();
  sqlite.prepare("UPDATE accounts SET name = NULL WHERE id = 'a1'").run();
  const id = plantInvite(sqlite);
  const html = await (
    await worker.fetch(new Request(`https://cloud.test/invite/${id}`), env)
  ).text();
  assert.match(html, /<h1>You’re invited to Alligators brand<\/h1>/);
  assert.match(html, /You’re in Alligators brand/);
  assert.ok(!html.includes('left a comment') && !html.includes('A comment is waiting'));
});

test('a turned-off link says so, in the same shell', async () => {
  const { env, sqlite } = await freshEnv();
  sqlite
    .prepare(
      `INSERT INTO share_links (id, project_id, role, who, created_by, created_at, revoked_at)
       VALUES ('lnk_0123456789abcdef', 'alligators', 'viewer', 'team', 'a1', 1, 2)`
    )
    .run();
  const res = await worker.fetch(new Request('https://cloud.test/l/lnk_0123456789abcdef'), env);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, new RegExp(`<h1>${LINK_OFF.replace('.', '\\.')}</h1>`));
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
});

test('words per CONTRACT §4 — no "we", no "I", no "us"/"our", no exclamation marks', async () => {
  const text = words(await OWNED_PAGES());
  for (const [label, re] of [
    ['we', /\b[Ww]e(?:’|'|\b)/],
    ['I', /(?:^|\s)I(?:’|'|\s)/],
    ['us', /\bus\b/],
    ['our', /\b[Oo]urs?\b/],
    ['!', /!/],
    ['workspace', /\bworkspace\b/i],
    ['Oops', /\bOops\b/i],
  ]) {
    const m = re.exec(text);
    assert.ok(
      !m,
      `"${label}" in: …${m ? text.slice(Math.max(0, m.index - 60), m.index + 40) : ''}…`
    );
  }
});
