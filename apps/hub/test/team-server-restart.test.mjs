// The whole road, on a real process, across a RESTART — in the shape the
// reference team server runs: workspace mode, hybrid provider sign-in limited
// to one domain, a seeded first admin (MAUDE_ADMIN_EMAIL), backups, a checkout.
//
//   seeded admin signs in → links their own provider sign-in → invites by
//   email → the invitee opens /join, continues with the provider and is in
//   (no pending row) → the admin sees them in People, changes the role, turns
//   them off → the hub is KILLED and started again → every step is still in
//   Activity, and the settings and the people are as they were left.
//
// The hub is a separate process running its real entry (`runAsMain`, via
// test/fixtures/serve-team-server.mjs); only the provider is in-memory. The
// studio child is off (MAUDE_STUDIO_CHILD=0): it is not what is under test and
// would build from this checkout.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { browser, ISSUER, signInAs } from './_fake-issuer.mjs';
import { until } from './_until.mjs';

const FIXTURE = new URL('./fixtures/serve-team-server.mjs', import.meta.url).pathname;
const ADMIN = { email: 'michal@example.test', password: 'seeded-admin-pass-1' };
const ADMIN_ID = { sub: 'sub-michal', email: ADMIN.email };
const MAREK = { sub: 'sub-marek', email: 'marek@example.test' };

let root;
let port;
let base;
let proc = null;
let log = '';

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
  });

async function start() {
  proc = spawn(process.execPath, [FIXTURE], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NO_OPEN: '1',
      PORT: String(port),
      DATA_DIR: join(root, 'data'),
      HUB_SECRET: 'smoke-admin-key',
      HUB_PUBLIC_URL: base,
      HUB_INSECURE_HTTP: '1',
      // Every sign-in here comes from one address within a second; the doors'
      // per-address budget (5 a minute) is real and is not what is under test.
      HUB_ADMIN_RATE_LIMIT: 'off',
      // the reference deployment's shape
      HUB_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_REPO_DIR: join(root, 'repo'),
      MAUDE_STUDIO_CHILD: '0',
      MAUDE_ADMIN_EMAIL: ADMIN.email,
      MAUDE_ADMIN_PASSWORD: ADMIN.password,
      MAUDE_BACKUP_TARGET: `file://${join(root, 'backups')}`,
      HUB_OIDC_MODE: 'hybrid',
      HUB_OIDC_ISSUER: ISSUER,
      HUB_OIDC_CLIENT_ID: 'hub',
      HUB_OIDC_CLIENT_SECRET: 'smoke-client-secret',
      HUB_OIDC_ALLOWED_DOMAINS: 'example.test',
      HUB_OIDC_LABEL: 'Example ID',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => {
    log += d;
  });
  proc.stderr.on('data', (d) => {
    log += d;
  });
  await until(
    async () => {
      try {
        return (await fetch(`${base}/health`)).status === 200;
      } catch {
        return false;
      }
    },
    20_000,
    'the hub answering /health',
    () => log.slice(-2000)
  );
}

async function stop() {
  if (!proc) return;
  const p = proc;
  proc = null;
  const gone = new Promise((resolve) => p.once('exit', resolve));
  p.kill('SIGTERM');
  const timer = setTimeout(() => p.kill('SIGKILL'), 10_000);
  await gone;
  clearTimeout(timer);
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'maude-team-server-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'repo', '.design'), { recursive: true });
  writeFileSync(join(root, 'repo', '.design', 'config.json'), '{}\n');
  const git = (...args) =>
    execFileSync('git', ['-C', join(root, 'repo'), ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=smoke@example.test', '-c', 'user.name=smoke', 'add', '-A');
  git('-c', 'user.email=smoke@example.test', '-c', 'user.name=smoke', 'commit', '-qm', 'init');
  port = await freePort();
  base = `http://localhost:${port}`;
  await start();
});
after(async () => {
  await stop();
  // The hub writes a last backup as it stops; give the directory a moment to settle.
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const body = async (res) => {
  assert.ok(res.status < 300, `HTTP ${res.status} ${await res.clone().text()}`);
  return res.json();
};
const people = async (b) => (await body(await b.json('/admin/api/people'))).people;

test('seeded admin → link my sign-in → invite → invitee in through the provider → role, turn off → RESTART → all of it is in Activity', async () => {
  // ---- the seeded admin opens /admin, signs in with the seeded password ----
  const admin = browser(base);
  assert.equal((await body(await admin.json('/admin/api/me'))).signedIn, false);
  await admin.get('/studio/signin?return=admin');
  const signedIn = await admin.form('/studio/signin', ADMIN);
  assert.equal(signedIn.status, 302);
  assert.equal(signedIn.headers.get('location'), '/admin', 'back to the admin page');
  const me = await body(await admin.json('/admin/api/me'));
  assert.equal(me.admin, true, 'no admin key asked for');
  assert.equal(me.provider, 'Example ID', 'the configured label, never a hard-coded brand');
  assert.equal(me.canLink, true, 'the seeded account has no provider sign-in yet');

  // ---- signing in through the provider with the SAME verified address does
  //      NOT reach the seeded account (no link by address): it asks to join ----
  const stray = browser(base);
  const pending = await signInAs(stray, await stray.get('/auth/oidc/start'), ADMIN_ID);
  assert.equal(pending.status, 403);
  assert.equal(stray.jar.get('maude_studio'), undefined);
  assert.equal(
    (await people(admin)).find((p) => p.kind === 'request')?.email,
    ADMIN.email,
    'the admin sees it under Asks to join'
  );
  // "Let in" cannot be used to take the account over either.
  const takeover = await admin.json('/admin/api/people/let-in', {
    sub: ADMIN_ID.sub,
    role: 'admin',
  });
  assert.equal(takeover.status, 409);

  // ---- "Link my sign-in": signed in as that account, same verified address ----
  const linked = await signInAs(
    admin,
    await admin.form('/auth/oidc/start', { link: '1' }),
    ADMIN_ID
  );
  assert.equal(linked.status, 302);
  assert.equal(linked.headers.get('location'), '/admin');
  assert.equal((await body(await admin.json('/admin/api/me'))).canLink, false);
  assert.equal(
    (await people(admin)).some((p) => p.kind === 'request'),
    false,
    'the request is gone'
  );

  // ---- who can join, the name ----
  const saved = await body(
    await admin.json('/admin/api/settings', { name: 'Example Design', whoCanJoin: 'invite-only' })
  );
  assert.equal(saved.whoCanJoin, 'invite-only');

  // ---- invite by email ----
  const invited = await body(
    await admin.json('/admin/api/people/invite', { emails: [MAREK.email], role: 'member' })
  );
  const link = invited.invites[0].url;
  assert.ok(link.startsWith(`${base}/join/inv_`));
  assert.match(
    (await people(admin)).find((p) => p.email === MAREK.email).statusLabel,
    /^Invited · 7 days left$/
  );

  // ---- the invitee: open the link, continue with the provider, be in ----
  const marek = browser(base);
  const joinPage = await marek.get(new URL(link).pathname);
  assert.equal(joinPage.status, 200);
  assert.match(await joinPage.text(), /Continue with Example ID/);
  const value = new URL(link).pathname.split('/join/')[1];
  const joined = await signInAs(
    marek,
    await marek.form('/auth/oidc/start', { invite: value }),
    MAREK
  );
  assert.equal(joined.status, 302, 'signed in — no waiting room');
  assert.ok(marek.jar.get('maude_studio'));
  const marekMe = await body(await marek.json('/admin/api/me'));
  assert.equal(marekMe.admin, false);
  assert.equal(marekMe.roleLabel, 'Can edit');
  assert.deepEqual(marekMe.runBy, ['Michal']);
  assert.equal((await marek.json('/admin/api/people')).status, 403, 'a member sees no admin data');

  // ---- the admin sees them in People — an account, no pending row ----
  let list = await people(admin);
  assert.equal(
    list.some((p) => p.kind === 'request'),
    false,
    'nobody is waiting'
  );
  let row = list.find((p) => p.email === MAREK.email);
  assert.equal(row.kind, 'account');
  assert.equal(row.linked, true);
  assert.equal(row.sessions.length, 1);
  const overview = await body(await admin.json('/admin/api/overview'));
  assert.equal(overview.hub.name, 'Example Design');
  assert.equal(overview.needs.length, 0);
  const health = Object.fromEntries(overview.health.map((h) => [h.key, h]));
  assert.notEqual(health.git.word, 'Not set up', 'this hub has a checkout');
  assert.notEqual(health.backups.word, 'Not set up', 'and a backup target');

  // ---- role change, then turn off ----
  const promoted = await body(
    await admin.json('/admin/api/people/role', { id: row.id, role: 'admin' })
  );
  assert.equal(promoted.user.role, 'admin');
  assert.equal(
    (await body(await marek.json('/admin/api/me'))).signedIn,
    false,
    'signed out at once'
  );
  await body(await admin.json('/admin/api/people/turn-off', { id: row.id }));
  const refused = browser(base);
  const off = await signInAs(refused, await refused.get('/auth/oidc/start'), MAREK);
  assert.equal(off.status, 403, 'a turned-off person cannot sign in');

  // ════════════════ RESTART ════════════════
  await stop();
  await start();

  // The old cookie is still a session (the token store is on disk) …
  assert.equal((await body(await admin.json('/admin/api/me'))).admin, true);
  // … and the admin can now sign in through the provider directly.
  const again = browser(base);
  const direct = await signInAs(again, await again.get('/auth/oidc/start'), ADMIN_ID);
  assert.equal(direct.status, 302);

  list = await people(again);
  row = list.find((p) => p.email === MAREK.email);
  assert.equal(row.statusLabel, 'Turned off');
  assert.equal(row.roleLabel, 'Admin');
  const settings = await body(await again.json('/admin/api/settings'));
  assert.equal(settings.name, 'Example Design');
  assert.equal(settings.whoCanJoin, 'invite-only');

  const events = (await body(await again.json('/admin/api/activity?limit=200'))).events;
  const has = (kind, where) =>
    assert.ok(
      events.some((e) => e.kind === kind && where(e)),
      `Activity lost "${kind}" across the restart: ${JSON.stringify(events.map((e) => e.kind))}`
    );
  has('signin-browser', (e) => e.actor === ADMIN.email);
  has('oidc-pending', (e) => e.actor === ADMIN.email);
  has('oidc-self-link', (e) => e.actor === ADMIN.email);
  has(
    'settings',
    (e) => e.actor === ADMIN.email && /who can join: ask → invite-only/.test(e.detail)
  );
  has('invite-create', (e) => e.actor === ADMIN.email && e.target === MAREK.email);
  has('invite-redeem', (e) => e.actor === MAREK.email);
  has(
    'role-change',
    (e) => e.actor === ADMIN.email && e.target === MAREK.email && e.detail === 'Can edit → Admin'
  );
  has('user-disable', (e) => e.actor === ADMIN.email && e.target === MAREK.email);
  has('oidc-refused', (e) => e.actor === MAREK.email);
  has('oidc-signin', (e) => e.actor === ADMIN.email);
  const text = JSON.stringify(events);
  assert.ok(!text.includes(value), 'the invite value is nowhere in the log');
  assert.ok(!text.includes('smoke-admin-key') && !text.includes(ADMIN.password));

  const csv = await again.json('/admin/api/activity.csv?kind=people');
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /role-change/);
  // The admin key still works, and still reaches what a session cannot.
  const viaKey = await fetch(`${base}/admin/api/tokens`, {
    headers: { authorization: 'Bearer smoke-admin-key' },
  });
  assert.equal(viaKey.status, 200);
  assert.equal((await again.json('/admin/api/tokens')).status, 403);
});
