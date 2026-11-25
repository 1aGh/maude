// People, Overview and the kept Activity — the team server admin's routes
// (admin-people.mjs), driven with the admin key and with a signed-in admin.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { closeAudit, listAudit, recordAudit } from '../src/audit-log.mjs';
import { closeInvites, createInvite, listInvites, peekInvite } from '../src/invites.mjs';
import { listTokensForOwner } from '../src/tokens.mjs';
import {
  closeUsers,
  createUser,
  getUser,
  getUserByOidcSub,
  recordPendingOidc,
} from '../src/users.mjs';
import { rm, startHub, tmpDir } from './_acl-docs-fixture.mjs';
import { browser } from './_fake-issuer.mjs';

const PW = 'correct horse battery staple';
let hub;
let dataDir;
let michal;

const key = async (path, body) => {
  const res = await fetch(`${hub.http}/admin/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: 'Bearer test-secret',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* csv */
  }
  return { status: res.status, json, text, headers: res.headers };
};
const asAdmin = async (path, body) => {
  const res = await michal.json(`/admin/api${path}`, body);
  return { status: res.status, json: await res.json() };
};
async function signedIn(email) {
  const b = browser(hub.http);
  const res = await b.form('/studio/signin', { email, password: PW });
  assert.equal(res.status, 302);
  return b;
}
const person = async (email) => (await key('/people')).json.people.find((p) => p.email === email);

before(async () => {
  dataDir = tmpDir('maude-people-');
  createUser(dataDir, { email: 'michal@x.test', password: PW, role: 'admin' });
  createUser(dataDir, { email: 'jonas@x.test', password: PW, role: 'member' });
  hub = await startHub(dataDir, {
    rateLimit: false,
    env: {},
    publicUrl: 'https://design.x.test',
  });
  michal = await signedIn('michal@x.test');
});
after(async () => {
  await hub.close();
  closeUsers(dataDir);
  closeInvites(dataDir);
  closeAudit(dataDir);
  rm(dataDir);
});

describe('one list', () => {
  test('accounts, people who ask, open invites and turned-off people, each with a status in words', async () => {
    recordPendingOidc(dataDir, { sub: 'sub-lukas', email: 'lukas@x.test' });
    createInvite(dataDir, { email: 'petra@x.test', role: 'member' });
    const used = createInvite(dataDir, { email: 'gone@x.test' });
    await key('/invites/revoke', { id: used.id });
    createUser(dataDir, { email: 'filip@x.test', password: PW, role: 'member' });
    await key('/people/turn-off', { email: 'filip@x.test' });

    const { status, json } = await key('/people');
    assert.equal(status, 200);
    const by = Object.fromEntries(json.people.map((p) => [p.email, p]));
    assert.equal(by['lukas@x.test'].statusLabel, 'Asks to join');
    assert.equal(by['lukas@x.test'].kind, 'request');
    assert.match(by['petra@x.test'].statusLabel, /^Invited · 7 days left$/);
    assert.equal(by['filip@x.test'].statusLabel, 'Turned off');
    assert.equal(by['michal@x.test'].roleLabel, 'Admin');
    assert.equal(by['jonas@x.test'].roleLabel, 'Can edit');
    assert.equal(by['jonas@x.test'].statusLabel, 'Away');
    assert.equal(by['gone@x.test'], undefined, 'a cancelled invite is not a person');
    assert.deepEqual(
      {
        asks: json.counts.asks,
        invited: json.counts.invited,
        off: json.counts.off,
        people: json.counts.people,
      },
      { asks: 1, invited: 1, off: 1, people: 3 }
    );
    // The signed-in admin has one browser session, last used now; nothing secret is in the list.
    assert.equal(by['michal@x.test'].sessions.length, 1);
    assert.equal(by['michal@x.test'].sessions[0].kind, 'browser');
    assert.ok(by['michal@x.test'].lastSeen > 0);
    const text = JSON.stringify(json);
    assert.ok(!/"hash"|scrypt|inv_[0-9a-f]{8}|mau_/.test(text));
    assert.equal(json.whoCanJoin, 'ask');
  });
});

describe('inviting', () => {
  test('many addresses in one call: a link each, shown once; bad and already-here addresses say why', async () => {
    const { status, json } = await asAdmin('/people/invite', {
      emails: 'marek@x.test, Eva@X.test\nnot-an-address jonas@x.test marek@x.test',
      role: 'member',
    });
    assert.equal(status, 201);
    const by = Object.fromEntries(json.invites.map((i) => [i.email, i]));
    assert.equal(json.invites.length, 4, 'a repeated address is one invite');
    assert.match(by['marek@x.test'].url, /^https:\/\/design\.x\.test\/join\/inv_[0-9a-f]+$/);
    assert.ok(by['eva@x.test'].ok);
    assert.equal(by['not-an-address'].ok, false);
    assert.equal(by['jonas@x.test'].error, 'Already here.');
    assert.equal(
      peekInvite(dataDir, by['marek@x.test'].url.split('/join/')[1]).invite.email,
      'marek@x.test'
    );

    const rows = listAudit(dataDir, { kind: 'invite-create' });
    assert.ok(rows.some((r) => r.actor === 'michal@x.test' && r.target === 'marek@x.test'));
    assert.ok(!JSON.stringify(listAudit(dataDir)).includes('inv_'), 'no invite value in the log');

    const tooMany = await key('/people/invite', {
      emails: Array.from({ length: 51 }, (_, i) => `p${i}@x.test`),
    });
    assert.equal(tooMany.status, 400);
    const admin = await key('/people/invite', { emails: ['boss2@x.test'], role: 'owner' });
    assert.equal(admin.status, 400, 'an unknown role is never an escalation');
  });

  test('no address at all: one link for whoever opens it', async () => {
    const { status, json } = await key('/people/invite', { role: 'member' });
    assert.equal(status, 201);
    assert.equal(json.invites[0].email, null);
    assert.ok(json.invites[0].url);
  });

  test('"Send again" makes a new link and kills the old one; "Cancel" ends it', async () => {
    const first = (await key('/people/invite', { emails: ['nina@x.test'] })).json.invites[0];
    const oldValue = first.url.split('/join/')[1];
    const again = await key('/people/invite/reissue', { id: first.id });
    assert.equal(again.status, 200);
    assert.notEqual(again.json.url, first.url);
    assert.equal(peekInvite(dataDir, oldValue).ok, false, 'the old link is dead');
    assert.equal(peekInvite(dataDir, again.json.url.split('/join/')[1]).ok, true);

    assert.equal((await key('/people/invite/revoke', { id: first.id })).status, 200);
    assert.equal(listInvites(dataDir).find((i) => i.id === first.id).status, 'revoked');
    assert.equal((await key('/people/invite/reissue', { id: first.id })).status, 404);
    const kinds = listAudit(dataDir, { who: 'nina@x.test' }).map((r) => r.kind);
    assert.deepEqual(kinds, ['invite-revoke', 'invite-reissue', 'invite-create']);
  });
});

describe('people who ask to join', () => {
  test('"Let in" creates the account with the chosen role and links the sign-in; "Dismiss" drops the request', async () => {
    const let_in = await asAdmin('/people/let-in', { sub: 'sub-lukas', role: 'member' });
    assert.equal(let_in.status, 201);
    assert.equal(getUserByOidcSub(dataDir, 'sub-lukas')?.email, 'lukas@x.test');
    assert.equal((await person('lukas@x.test')).kind, 'account');

    recordPendingOidc(dataDir, { sub: 'sub-noise', email: 'noise@x.test' });
    assert.equal((await key('/people/dismiss', { sub: 'sub-noise' })).json.removed, true);
    assert.equal(await person('noise@x.test'), undefined);
    assert.equal((await key('/people/let-in', { sub: 'sub-noise' })).status, 404);
  });

  test('letting in never reaches an existing account', async () => {
    recordPendingOidc(dataDir, { sub: 'sub-fake-jonas', email: 'jonas@x.test' });
    const res = await key('/people/let-in', { sub: 'sub-fake-jonas', role: 'admin' });
    assert.equal(res.status, 409);
    assert.equal(getUserByOidcSub(dataDir, 'sub-fake-jonas'), null);
    assert.equal(getUser(dataDir, 'jonas@x.test').role, 'member');
    await key('/people/dismiss', { sub: 'sub-fake-jonas' });
  });
});

describe('changing a person', () => {
  test('role: Admin ⇄ Can edit, at once (their sessions end), and it is logged with who did it', async () => {
    const jonas = await signedIn('jonas@x.test');
    assert.equal(listTokensForOwner(dataDir, 'jonas@x.test').length, 1);
    const up = await asAdmin('/people/role', { email: 'jonas@x.test', role: 'admin' });
    assert.equal(up.status, 200);
    assert.equal(up.json.revoked, 1);
    assert.equal(getUser(dataDir, 'jonas@x.test').role, 'admin');
    assert.equal((await jonas.json('/admin/api/me').then((r) => r.json())).signedIn, false);
    const row = listAudit(dataDir, { kind: 'role-change' })[0];
    assert.deepEqual(
      { actor: row.actor, target: row.target, detail: row.detail },
      { actor: 'michal@x.test', target: 'jonas@x.test', detail: 'Can edit → Admin' }
    );
    const by_id = await key('/people/role', {
      id: (await person('jonas@x.test')).id,
      role: 'member',
    });
    assert.equal(by_id.status, 200);
    assert.equal(getUser(dataDir, 'jonas@x.test').role, 'member');
    assert.equal(
      (await key('/people/role', { email: 'jonas@x.test', role: 'viewer' })).status,
      400
    );
    assert.equal(
      (await key('/people/role', { email: 'nobody@x.test', role: 'admin' })).status,
      404
    );
  });

  test('the last admin cannot be demoted, turned off or removed — by anyone', async () => {
    for (const [path, body] of [
      ['/people/role', { email: 'michal@x.test', role: 'member' }],
      ['/people/turn-off', { email: 'michal@x.test' }],
      ['/people/remove', { email: 'michal@x.test' }],
    ]) {
      const res = await key(path, body);
      assert.equal(res.status, 409, path);
      assert.match(res.json.error, /only admin/i);
    }
    const u = getUser(dataDir, 'michal@x.test');
    assert.equal(u.role, 'admin');
    assert.equal(u.disabled, false);
  });

  test('an admin cannot lock themself out, even when another admin exists', async () => {
    await key('/people/role', { email: 'jonas@x.test', role: 'admin' });
    for (const [path, body] of [
      ['/people/role', { email: 'michal@x.test', role: 'member' }],
      ['/people/turn-off', { email: 'michal@x.test' }],
      ['/people/remove', { email: 'michal@x.test' }],
      ['/users/disable', { email: 'michal@x.test' }],
      ['/users/delete', { email: 'michal@x.test' }],
    ]) {
      const res = await asAdmin(path, body);
      assert.equal(res.status, 409, path);
      assert.match(res.json.error, /yourself/i);
    }
    assert.equal(getUser(dataDir, 'michal@x.test').disabled, false);
    await key('/people/role', { email: 'jonas@x.test', role: 'member' });
  });

  test('"Turn off" ends every session and keeps the account; "Turn back on" restores it', async () => {
    const jonas = await signedIn('jonas@x.test');
    const off = await asAdmin('/people/turn-off', { email: 'jonas@x.test' });
    assert.equal(off.json.revoked, 1);
    assert.equal((await person('jonas@x.test')).statusLabel, 'Turned off');
    assert.equal((await jonas.json('/admin/api/me').then((r) => r.json())).signedIn, false);
    const refused = await browser(hub.http).form('/studio/signin', {
      email: 'jonas@x.test',
      password: PW,
    });
    assert.equal(refused.status, 401);
    await asAdmin('/people/turn-on', { email: 'jonas@x.test' });
    assert.equal((await person('jonas@x.test')).statusLabel, 'Away');
  });

  test('"Sign out": one session by its label, or all — never somebody else\'s', async () => {
    await signedIn('jonas@x.test');
    await signedIn('jonas@x.test');
    const sessions = (await person('jonas@x.test')).sessions;
    assert.equal(sessions.length, 2);
    const mine = (await person('michal@x.test')).sessions[0].label;
    const wrong = await key('/people/signout', { email: 'jonas@x.test', label: mine });
    assert.equal(wrong.status, 404);
    assert.equal(
      (await key('/people/signout', { email: 'jonas@x.test', label: sessions[0].label })).json
        .revoked,
      1
    );
    assert.equal((await person('jonas@x.test')).sessions.length, 1);
    assert.equal((await key('/people/signout', { email: 'jonas@x.test' })).json.revoked, 1);
    assert.equal((await person('jonas@x.test')).sessions.length, 0);
    assert.equal((await asAdmin('/people', undefined)).status, 200, 'the admin is still signed in');
  });

  test('"Remove" deletes the account and its sessions', async () => {
    createUser(dataDir, { email: 'temp@x.test', password: PW, role: 'member' });
    await signedIn('temp@x.test');
    const res = await asAdmin('/people/remove', { email: 'temp@x.test' });
    assert.equal(res.status, 200);
    assert.equal(getUser(dataDir, 'temp@x.test'), null);
    assert.equal(listTokensForOwner(dataDir, 'temp@x.test').length, 0);
    assert.equal(listAudit(dataDir, { kind: 'user-delete' })[0].target, 'temp@x.test');
  });
});

describe('activity', () => {
  test('filters by kind, person and text; one person by account id; older events by paging', async () => {
    const all = await key('/activity');
    assert.equal(all.status, 200);
    assert.ok(Array.isArray(all.json.activity), 'the in-memory feed is still served');
    assert.ok(all.json.events.length > 5);
    assert.equal(all.json.retentionDays, 90);

    const people = await key('/activity?kind=people');
    assert.ok(people.json.events.every((e) => e.area === 'people'));
    const signins = await key('/activity?kind=signin');
    assert.ok(signins.json.events.some((e) => e.kind === 'signin-browser'));
    const id = (await person('jonas@x.test')).id;
    const jonas = await key(`/activity?who=${id}`);
    assert.ok(jonas.json.events.length > 0);
    assert.ok(
      jonas.json.events.every((e) => e.actor === 'jonas@x.test' || e.target === 'jonas@x.test')
    );
    const q = await key('/activity?q=Can%20edit%20%E2%86%92%20Admin');
    assert.ok(q.json.events.every((e) => e.kind === 'role-change'));
    const page = await key('/activity?limit=2');
    const next = await key(`/activity?limit=2&before=${page.json.more}`);
    assert.ok(next.json.events[0].id < page.json.events[1].id);
  });

  test('the CSV download carries the same rows', async () => {
    const res = await key('/activity.csv?kind=people');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="activity\.csv"/);
    const lines = res.text.trim().split('\r\n');
    assert.equal(lines[0], 'when,who,what,about,detail,where');
    assert.ok(lines.length > 3);
    assert.ok(lines.slice(1).every((l) => l.endsWith('"people"')));
  });

  test('key-only actions are logged too: tokens and the admin key', async () => {
    await key('/token', { label: 'ci-bot' });
    await key('/token/rotate', { label: 'ci-bot' });
    await key('/token/delete', { label: 'ci-bot' });
    const kinds = listAudit(dataDir, { kind: 'server' }).map((r) => r.kind);
    for (const k of ['token', 'token-rotate', 'token-delete']) assert.ok(kinds.includes(k), k);
    assert.ok(!JSON.stringify(listAudit(dataDir)).includes('mau_'), 'no token value in the log');
  });
});

describe('overview', () => {
  test('what needs you: people who ask, and invites nobody opened for a day', async () => {
    recordPendingOidc(dataDir, { sub: 'sub-ask-2', email: 'asks@x.test' });
    const old = (await key('/people/invite', { emails: ['old@x.test'] })).json.invites[0];
    const { status, json } = await asAdmin('/overview');
    assert.equal(status, 200);
    assert.ok(json.needs.some((n) => n.type === 'request' && n.email === 'asks@x.test'));
    assert.ok(!json.needs.some((n) => n.id === old.id), 'a minute-old invite is not a problem yet');
    const later = (await import('../src/admin-people.mjs')).buildOverview(dataDir, {
      peers: new Map(),
      now: Date.now() + 2 * 86_400_000,
      version: '0.0.0',
      env: {},
    });
    assert.ok(later.needs.some((n) => n.type === 'invite' && n.id === old.id));

    assert.equal(json.hub.name, 'Studio Hub');
    assert.equal(typeof json.counts.people, 'number');
    assert.equal(json.counts.asks, 1);
    assert.equal(typeof json.counts.canvases, 'number');
    assert.ok(json.counts.eventsThisWeek > 5, 'events are counted from the kept log');
    assert.equal(
      'changesThisWeek' in json.counts,
      false,
      'no journal here: changes are absent, not 0'
    );
    assert.ok(json.recent.length > 0);
  });

  test('health says "Not set up" honestly when backups and Git are absent', async () => {
    const { json } = await key('/overview');
    const by = Object.fromEntries(json.health.map((h) => [h.key, h]));
    assert.match(by.version.value, /^Maude \d/);
    assert.equal(by.backups.word, 'Not set up');
    assert.equal(by.backups.state, 'off');
    assert.equal(by.git.word, 'Not set up');
  });

  test("an eight-day-old event is not this week's change", async () => {
    const before = (await key('/overview')).json.counts.eventsThisWeek;
    recordAudit(dataDir, { kind: 'login', actor: 'x@x.test', at: Date.now() - 8 * 86_400_000 });
    assert.equal(listAudit(dataDir, { who: 'x@x.test' }).length, 1, 'it is kept');
    assert.equal((await key('/overview')).json.counts.eventsThisWeek, before, 'and not counted');
  });
});
