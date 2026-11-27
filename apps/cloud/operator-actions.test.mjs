// The operator's account page and the operator's actions — through the live
// worker, a real session, real SQLite. Canvas 16: cl-operator, cl-op-promo,
// cl-op-account.
//
// Every action here is a POST that (1) only an allowlisted operator reaches —
// anyone else gets the worker's own 404, (2) carries the session-derived CSRF
// token, (3) needs a reason, (4) writes an audit row naming the operator, the
// target and the reason, and (5) can be sent twice without doing its work twice.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sha256Hex } from './accounts.mjs';
import {
  addMember,
  assertNoStripe,
  auditRows,
  bind,
  DAY,
  env_,
  freshEnv,
  get,
  installNetwork,
  makeOperator,
  post,
  project,
  seedProject,
  signUp,
  text,
} from './admin-test-kit.mjs';
import { TRIAL_DAYS } from './billing.mjs';
import { planState } from './project-access.mjs';
import worker from './worker.mjs';

async function world(t) {
  const net = installNetwork(t);
  const { env, sqlite } = await freshEnv();
  const op = await makeOperator(env, sqlite);
  const jan = await signUp(env, sqlite, 'jan@kolar.studio');
  bind(env, op, jan);
  net.mails.length = 0; // the sign-up confirmations are not what these tests count
  t.after(() => assertNoStripe(net));
  return { net, env, sqlite, op, jan };
}

const REASON = 'Studio is deciding after the pilot';

// ------------------------------------------------------------ the account page

describe('GET /operator/accounts/:id — one account, everything about it', () => {
  test('header, every project with its plan, people, and the account’s log', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const now = Date.now();
    sqlite.prepare('UPDATE accounts SET google_sub = ? WHERE id = ?').run('g-1', jan.id);
    sqlite
      .prepare(
        'INSERT INTO personal_tokens (id, account_id, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(await sha256Hex('mpt_x'), jan.id, 'Jan’s MacBook', now, now);
    seedProject(sqlite, {
      id: 'kolar-web',
      owner: jan.id,
      name: 'Kolář web',
      trialEndsAt: now + 2 * DAY - 1000,
    });
    seedProject(sqlite, {
      id: 'plakaty',
      owner: jan.id,
      name: 'Plakáty 2027',
      subscription: 'sub_1',
    });
    seedProject(sqlite, { id: 'cenik', owner: jan.id, name: 'Ceník', trialEndsAt: now - 3 * DAY });
    const anna = await signUp(env, sqlite, 'anna@example.com');
    addMember(sqlite, 'plakaty', anna.id);

    const res = await get(`/operator/accounts/${jan.id}`, op);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const page = text(await res.text());
    assert.match(page, /jan@kolar\.studio/);
    assert.match(page, /signed up .* with Google/);
    assert.match(page, /1 Mac/);
    assert.match(page, /Kolář web/);
    assert.match(page, /Trial · 2 days left/);
    assert.match(page, /Plakáty 2027/);
    assert.match(page, /Cloud Project · paid/);
    assert.match(page, /Paused · trial ended/);
    // The page is the looking: it is recorded, against the account looked at.
    const [seen] = auditRows(sqlite, 'operator.account.viewed');
    assert.equal(seen.account_id, jan.id);
    assert.equal(seen.actor, `operator:${op.email}`);
    // …and that row is itself in the log the page shows next time.
    const again = text(await (await get(`/operator/accounts/${jan.id}`, op)).text());
    // In words, never the dotted key (owner, 2026-11-27).
    assert.match(again, /Maude opened the owner’s account record/);
    assert.doesNotMatch(again, /operator\.account\.viewed/);
  });

  test('an unknown account is the worker’s 404; so is the page for a non-operator', async (t) => {
    const { op, jan } = await world(t);
    assert.equal((await get('/operator/accounts/acct_nobody', op)).status, 404);
    const res = await get(`/operator/accounts/${jan.id}`, jan);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('content-type'), 'application/json');
  });

  test('the accounts list and a project page both link to it', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, name: 'Kolář web' });
    const list = await (await get('/operator/accounts', op)).text();
    assert.ok(list.includes(`href="/operator/accounts/${jan.id}"`));
    const detail = await (await get('/operator/projects/kolar-web', op)).text();
    assert.ok(detail.includes(`href="/operator/accounts/${jan.id}"`));
  });

  test('search: by e-mail, by project name, by project id — and only matches', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const eva = await signUp(env, sqlite, 'eva@pokorna.cz');
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, name: 'Kolář web' });
    seedProject(sqlite, { id: 'plakaty-2027', owner: eva.id, name: 'Plakáty' });
    const find = async (q) =>
      text(await (await get(`/operator/accounts?q=${encodeURIComponent(q)}`, op)).text());
    const byMail = await find('kolar.studio');
    assert.match(byMail, /jan@kolar\.studio/);
    assert.doesNotMatch(byMail, /eva@pokorna\.cz/);
    const byName = await find('Plakáty');
    assert.match(byName, /eva@pokorna\.cz/);
    assert.doesNotMatch(byName, /jan@kolar\.studio/);
    assert.match(await find('kolar-web'), /jan@kolar\.studio/);
    // A LIKE wildcard is a character here, not a pattern.
    assert.doesNotMatch(await find('%'), /jan@kolar\.studio/);
    assert.match(await find('nobody-at-all'), /No account matches/);
  });
});

// ------------------------------------------------------------------- free time

describe('give free time', () => {
  test('30 days on a trial project: the date moves, the owner gets ONE e-mail, the log says who and why', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    const now = Date.now();
    const end = now + 2 * DAY;
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, name: 'Kolář web', trialEndsAt: end });
    const claims = () => sqlite.prepare('SELECT COUNT(*) AS n FROM trial_claims').get().n;
    const before = claims();

    const res = await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-00000001',
      days: '30',
      reason: REASON,
    });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /^\/operator\/projects\/kolar-web\?done=free-time/);

    assert.equal(project(sqlite, 'kolar-web').trial_ends_at, end + 30 * DAY, 'added on top');
    assert.equal(planState(project(sqlite, 'kolar-web')), 'trial');
    assert.equal(claims(), before, 'free time is not a second trial claim');

    const [row] = auditRows(sqlite, 'operator.free-time.given');
    assert.equal(row.actor, `operator:${op.email}`);
    assert.equal(row.project_id, 'kolar-web');
    assert.equal(row.account_id, jan.id);
    assert.equal(row.reason, REASON);
    const detail = JSON.parse(row.detail);
    assert.equal(detail.operator, op.id);
    assert.equal(detail.to, end + 30 * DAY);

    assert.equal(net.mails.length, 1);
    assert.deepEqual(net.mails[0].to, ['jan@kolar.studio']);
    assert.match(net.mails[0].subject, /^Kolář web is free until \d+ \w+ \d{4}$/);
    // Not woken: it was not paused.
    assert.ok(!net.cell.some((c) => c.url.endsWith('/_cell/restart')));
  });

  test('the same form sent twice adds the days ONCE: one date, one e-mail, one log row', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    const end = Date.now() + 2 * DAY;
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: end });
    const send = () =>
      post('/operator/projects/kolar-web/free-time', op, {
        rid: 'rid-00000002',
        days: '14',
        reason: REASON,
      });
    assert.equal((await send()).status, 303);
    assert.equal((await send()).status, 303);
    assert.equal(project(sqlite, 'kolar-web').trial_ends_at, end + 14 * DAY);
    assert.equal(net.mails.length, 1);
    assert.equal(auditRows(sqlite, 'operator.free-time.given').length, 1);
    // A NEW form (a new request id) is a new gift.
    await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-00000003',
      days: '14',
      reason: REASON,
    });
    assert.equal(project(sqlite, 'kolar-web').trial_ends_at, end + 28 * DAY);
  });

  test('a project paused because its trial ended is woken — counted from today, cell restarted', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    const now = Date.now();
    seedProject(sqlite, { id: 'cenik', owner: jan.id, name: 'Ceník', trialEndsAt: now - 20 * DAY });
    assert.equal(planState(project(sqlite, 'cenik')), 'paused');
    await post('/operator/projects/cenik/free-time', op, {
      rid: 'rid-00000004',
      days: '30',
      reason: REASON,
    });
    const after = project(sqlite, 'cenik');
    assert.equal(planState(after), 'trial');
    assert.ok(after.trial_ends_at >= now + 30 * DAY - 1000, 'from today, not from the old end');
    assert.ok(after.trial_ends_at <= Date.now() + 30 * DAY);
    assert.equal(after.state, 'active', 'no state write: the trial pause was never a state');
    assert.equal(
      net.cell.filter((c) => c.url.includes('cenik') && c.url.endsWith('/_cell/restart')).length,
      1
    );
  });

  test('"until a date" sets that day', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    const until = new Date(Date.now() + 100 * DAY).toISOString().slice(0, 10);
    await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-00000005',
      days: 'until',
      until,
      reason: REASON,
    });
    assert.equal(
      new Date(project(sqlite, 'kolar-web').trial_ends_at).toISOString().slice(0, 10),
      until
    );
    // A date that is not later than what the project already has changes nothing.
    const past = await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-00000006',
      days: 'until',
      until: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10),
      reason: REASON,
    });
    assert.match(past.headers.get('location'), /error=free-not-later/);
  });

  test('a PAID project is never touched: a refusal with its own message, and a log row', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'plakaty', owner: jan.id, subscription: 'sub_live', trialEndsAt: 5 });
    const res = await post('/operator/projects/plakaty/free-time', op, {
      rid: 'rid-00000007',
      days: '30',
      reason: REASON,
    });
    assert.match(res.headers.get('location'), /error=free-paid/);
    assert.equal(project(sqlite, 'plakaty').trial_ends_at, 5);
    assert.equal(net.mails.length, 0);
    assert.equal(auditRows(sqlite, 'operator.free-time.given').length, 0);
    const [refused] = auditRows(sqlite, 'operator.free-time.refused');
    assert.equal(refused.project_id, 'plakaty');
    assert.equal(JSON.parse(refused.detail).why, 'paid');
    const page = text(await (await get(res.headers.get('location'), op)).text());
    assert.match(page, /has a paid plan/);
    assert.match(page, /Nothing was changed/);
  });

  test('every project of an account: the free ones move, the paid one is refused, ONE e-mail', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    const now = Date.now();
    seedProject(sqlite, {
      id: 'kolar-web',
      owner: jan.id,
      name: 'Kolář web',
      trialEndsAt: now + 2 * DAY,
    });
    seedProject(sqlite, { id: 'cenik', owner: jan.id, name: 'Ceník', trialEndsAt: now - 3 * DAY });
    seedProject(sqlite, { id: 'plakaty', owner: jan.id, subscription: 'sub_live' });
    const res = await post(`/operator/accounts/${jan.id}/free-time`, op, {
      rid: 'rid-00000008',
      days: '90',
      reason: REASON,
    });
    assert.equal(res.status, 303);
    assert.match(
      res.headers.get('location'),
      new RegExp(`^/operator/accounts/${jan.id}\\?done=free-time`)
    );
    assert.equal(project(sqlite, 'kolar-web').trial_ends_at, now + 92 * DAY);
    assert.equal(planState(project(sqlite, 'cenik')), 'trial');
    assert.equal(project(sqlite, 'plakaty').trial_ends_at, null);
    assert.equal(auditRows(sqlite, 'operator.free-time.given').length, 2);
    assert.equal(auditRows(sqlite, 'operator.free-time.refused').length, 1);
    assert.equal(net.mails.length, 1);
    assert.match(net.mails[0].text, /Kolář web — until/);
    assert.match(net.mails[0].text, /Ceník — until/);
    assert.doesNotMatch(net.mails[0].text, /plakaty/i);
  });

  test('no token, no reason, no operator: nothing is written', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    const end = Date.now() + DAY;
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: end });
    const fields = { rid: 'rid-00000009', days: '30', reason: REASON };

    const forged = await post('/operator/projects/kolar-web/free-time', op, fields, { csrf: null });
    assert.equal(forged.status, 403);
    const blank = await post('/operator/projects/kolar-web/free-time', op, {
      ...fields,
      reason: '  ',
    });
    assert.match(blank.headers.get('location'), /error=no-reason/);
    const stranger = await post('/operator/projects/kolar-web/free-time', jan, fields, {
      csrf: 'operator',
    });
    assert.equal(stranger.status, 404);
    // A cross-site browser post never reaches the route at all.
    const crossSite = await post('/operator/projects/kolar-web/free-time', op, fields, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossSite.status, 403);

    assert.equal(project(sqlite, 'kolar-web').trial_ends_at, end);
    assert.equal(net.mails.length, 0);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'operator.free%'").get()
        .n,
      0
    );
  });
});

// ----------------------------------------------------------------------- promo

describe('mark as Promo / end Promo', () => {
  test('Promo: tier, reason, no end — never a trial again, logged, and not a trial claim', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'alligators', owner: jan.id, name: 'Alligators brand' });
    assert.equal(planState(project(sqlite, 'alligators')), 'none');
    const res = await post('/operator/projects/alligators/promo', op, {
      tier: 'dedicated',
      ends: '',
      reason: 'Our own club — showcase project',
    });
    assert.match(res.headers.get('location'), /done=promo/);
    const row = project(sqlite, 'alligators');
    assert.equal(planState(row), 'promo');
    assert.equal(row.promo_tier, 'dedicated');
    assert.equal(row.promo_ends_at, null);
    assert.equal(row.trial_ends_at, null);
    const [log] = auditRows(sqlite, 'operator.promo.set');
    assert.equal(log.reason, 'Our own club — showcase project');
    assert.equal(log.actor, `operator:${op.email}`);
    assert.equal(JSON.parse(log.detail).tier, 'dedicated');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM trial_claims').get().n, 0);
    const page = text(await (await get('/operator/projects/alligators', op)).text());
    assert.match(page, /Promo · Dedicated · 250 GB/);
  });

  test('sending it again with the same values writes nothing new', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'alligators', owner: jan.id });
    const send = () =>
      post('/operator/projects/alligators/promo', op, {
        tier: 'unlimited',
        ends: '',
        reason: 'x y z',
      });
    await send();
    const since = project(sqlite, 'alligators').promo_since;
    await send();
    assert.equal(project(sqlite, 'alligators').promo_since, since);
    assert.equal(auditRows(sqlite, 'operator.promo.set').length, 1);
  });

  test('a Promo on a project whose trial had ended wakes it', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'cenik', owner: jan.id, trialEndsAt: Date.now() - DAY });
    await post('/operator/projects/cenik/promo', op, {
      tier: 'project',
      ends: '',
      reason: 'friend',
    });
    assert.equal(planState(project(sqlite, 'cenik')), 'promo');
    assert.equal(net.cell.filter((c) => c.url.endsWith('/_cell/restart')).length, 1);
  });

  test('a paid project cannot be made Promo; an unknown tier is refused', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'plakaty', owner: jan.id, subscription: 'sub_live' });
    seedProject(sqlite, { id: 'alligators', owner: jan.id });
    const paid = await post('/operator/projects/plakaty/promo', op, {
      tier: 'project',
      ends: '',
      reason: 'x y z',
    });
    assert.match(paid.headers.get('location'), /error=promo-paid/);
    assert.equal(project(sqlite, 'plakaty').promo_since, null);
    assert.equal(auditRows(sqlite, 'operator.promo.refused').length, 1);
    const tier = await post('/operator/projects/alligators/promo', op, {
      tier: 'enterprise',
      ends: '',
      reason: 'x y z',
    });
    assert.match(tier.headers.get('location'), /error=promo-tier/);
    assert.equal(project(sqlite, 'alligators').promo_since, null);
  });

  test('end Promo sets the date it stops; after it the project needs a plan', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'alligators', owner: jan.id, promoSince: 1, promoTier: 'project' });
    const ends = new Date(Date.now() + 40 * DAY).toISOString().slice(0, 10);
    const res = await post('/operator/projects/alligators/promo/end', op, {
      ends,
      reason: 'the season is over',
    });
    assert.match(res.headers.get('location'), /done=promo-end/);
    const row = project(sqlite, 'alligators');
    assert.equal(new Date(row.promo_ends_at).toISOString().slice(0, 10), ends);
    assert.equal(planState(row), 'promo');
    assert.equal(planState(row, { now: row.promo_ends_at }), 'paused');
    assert.equal(auditRows(sqlite, 'operator.promo.ended')[0].reason, 'the season is over');
    // Not Promo: nothing to end.
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    const no = await post('/operator/projects/kolar-web/promo/end', op, { ends, reason: 'x y z' });
    assert.match(no.headers.get('location'), /error=promo-none/);
  });
});

// ----------------------------------------------------------------- pause / wake

describe('pause and wake by hand', () => {
  test('pause: through the reconciler — suspended, cell stopped, address detached, NO export mail', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    const res = await post('/operator/projects/kolar-web/pause', op, {
      reason: 'abuse report #12',
    });
    assert.match(res.headers.get('location'), /done=paused/);
    const row = project(sqlite, 'kolar-web');
    assert.equal(row.state, 'suspended');
    assert.equal(row.cell_running, 0);
    assert.ok(row.hold_since > 0);
    assert.equal(row.export_sent_at, null);
    assert.ok(
      net.cell.some((c) => c.url.endsWith('/_cell/restart')),
      'the container was stopped'
    );
    assert.ok(
      net.cloudflare.some((c) => c.method === 'DELETE' || c.method === 'GET'),
      'the address was detached'
    );
    assert.equal(net.mails.length, 0, 'a pause by hand never mails "your subscription ended"');
    assert.equal(auditRows(sqlite, 'operator.project.paused')[0].reason, 'abuse report #12');
    assert.equal(auditRows(sqlite, 'do.suspend-cell').length, 1);
    // Twice is once.
    await post('/operator/projects/kolar-web/pause', op, { reason: 'abuse report #12' });
    assert.equal(auditRows(sqlite, 'operator.project.paused').length, 1);
    assert.equal(project(sqlite, 'kolar-web').hold_since, row.hold_since);
  });

  test('wake: the hold is lifted and the same machine brings it back', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + 5 * DAY });
    await post('/operator/projects/kolar-web/pause', op, { reason: 'checking something' });
    net.cloudflare.length = 0;
    const res = await post('/operator/projects/kolar-web/wake', op, { reason: 'all clear' });
    assert.match(res.headers.get('location'), /done=woken/);
    const row = project(sqlite, 'kolar-web');
    assert.equal(row.hold_since, null);
    assert.equal(row.state, 'active');
    assert.equal(row.cell_running, 1);
    assert.ok(
      net.cloudflare.some((c) => c.method === 'PUT'),
      'the address was attached again'
    );
    assert.equal(auditRows(sqlite, 'operator.project.woken')[0].reason, 'all clear');
    // Waking what is not held is a refusal, not a state write.
    const again = await post('/operator/projects/kolar-web/wake', op, { reason: 'all clear' });
    assert.match(again.headers.get('location'), /error=wake-not-held/);
  });

  test('a project that is not running cannot be paused', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'old', owner: jan.id, state: 'exported' });
    const res = await post('/operator/projects/old/pause', op, { reason: 'x y z' });
    assert.match(res.headers.get('location'), /error=pause-not-running/);
    assert.equal(project(sqlite, 'old').hold_since, null);
  });
});

// ------------------------------------------------------------------ new project

describe('new project for an account, no checkout', () => {
  const fields = {
    owner: 'Jana@Novakova.design',
    name: 'Novaková — identita 2027',
    plan: 'promo',
    tier: 'dedicated',
    ends: '',
    invites: 'radek@alligators.cz, eva@example.com',
    reason: 'Design studio we work with',
  };

  test('makes the account (no password), the Promo project, ONE owner e-mail, and the invites', async (t) => {
    const { net, sqlite, op } = await world(t);
    const res = await post('/operator/new-project', op, fields);
    assert.equal(res.status, 303);
    const owner = sqlite
      .prepare("SELECT * FROM accounts WHERE email = 'jana@novakova.design'")
      .get();
    assert.ok(owner, 'the account exists');
    assert.equal(owner.password_hash, null, 'nobody chose a password for her');
    assert.equal(res.headers.get('location'), `/operator/accounts/${owner.id}?done=project-made`);

    const row = project(sqlite, 'novakova-identita-2027');
    assert.equal(row.account_id, owner.id);
    assert.equal(row.state, 'active', 'routed and live — no waiting room, no checkout');
    assert.equal(planState(row), 'promo');
    assert.equal(row.promo_tier, 'dedicated');
    assert.equal(row.subscription_id, null);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM checkout_attempts').get().n, 0);
    assert.ok(net.cloudflare.some((c) => c.method === 'PUT'));

    const toOwner = net.mails.filter((m) => m.to[0] === 'jana@novakova.design');
    assert.equal(toOwner.length, 1);
    assert.match(toOwner[0].text, /\/auth\/reset\?t=mer_/);
    const invites = sqlite.prepare('SELECT email, role FROM project_invites ORDER BY email').all();
    assert.deepEqual(
      invites.map((i) => [i.email, i.role]),
      [
        ['eva@example.com', 'member'],
        ['radek@alligators.cz', 'member'],
      ]
    );
    assert.equal(net.mails.length, 3);

    const [log] = auditRows(sqlite, 'operator.project.created');
    assert.equal(log.project_id, 'novakova-identita-2027');
    assert.equal(log.account_id, owner.id);
    assert.equal(log.reason, 'Design studio we work with');
    assert.equal(JSON.parse(log.detail).accountCreated, true);
  });

  test('sent twice: still one account, one project, one owner e-mail, one invite each', async (t) => {
    const { net, sqlite, op } = await world(t);
    await post('/operator/new-project', op, fields);
    const again = await post('/operator/new-project', op, fields);
    assert.equal(again.status, 303);
    assert.equal(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM accounts WHERE email = 'jana@novakova.design'")
        .get().n,
      1
    );
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM project_invites').get().n, 2);
    assert.equal(net.mails.length, 3);
    assert.equal(auditRows(sqlite, 'operator.project.created').length, 1);
  });

  test('Trial for an existing account: 14 days, it IS that address’s trial, one e-mail with no password link', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    const res = await post('/operator/new-project', op, {
      owner: jan.email,
      name: 'Kolář web',
      plan: 'trial',
      invites: '',
      reason: 'demo for the studio',
    });
    assert.equal(res.headers.get('location'), `/operator/accounts/${jan.id}?done=project-made`);
    const row = project(sqlite, 'kolar-web');
    assert.equal(planState(row), 'trial');
    const days = (row.trial_ends_at - Date.now()) / DAY;
    assert.ok(days > TRIAL_DAYS - 0.01 && days <= TRIAL_DAYS);
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM trial_claims WHERE project_id = ?').get('kolar-web')
        .n,
      1
    );
    assert.equal(net.mails.length, 1);
    assert.doesNotMatch(net.mails[0].text, /auth\/reset/);
    assert.equal(
      JSON.parse(auditRows(sqlite, 'operator.project.created')[0].detail).accountCreated,
      false
    );
  });

  test('a name that is somebody else’s address, a bad e-mail, a missing reason — each refused, nothing made', async (t) => {
    const { net, sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'novakova-identita-2027', owner: jan.id });
    const taken = await post('/operator/new-project', op, fields);
    assert.equal(taken.status, 409);
    assert.match(text(await taken.text()), /already a web address/);
    const bad = await post('/operator/new-project', op, {
      ...fields,
      name: 'Another one',
      owner: 'not-an-address',
    });
    assert.equal(bad.status, 400);
    const blank = await post('/operator/new-project', op, {
      ...fields,
      name: 'Another one',
      reason: '',
    });
    assert.equal(blank.status, 400);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email LIKE '%novakova%'").get().n,
      0
    );
    assert.equal(net.mails.length, 0);
    assert.equal((await post('/operator/new-project', jan, fields)).status, 404);
  });
});

// ------------------------------------------------------- move · sign out

describe('move a project, and sign an account out everywhere', () => {
  test('move: the new owner owns it, the old one stays on it as Can edit, both logged', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const eva = await signUp(env, sqlite, 'eva@pokorna.cz');
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    addMember(sqlite, 'kolar-web', eva.id, 'viewer');
    const res = await post('/operator/projects/kolar-web/move', op, {
      to: 'Eva@Pokorna.cz',
      reason: 'Jan left the studio',
    });
    assert.match(res.headers.get('location'), /done=moved/);
    assert.equal(project(sqlite, 'kolar-web').account_id, eva.id);
    const members = sqlite
      .prepare("SELECT account_id, role FROM project_members WHERE project_id = 'kolar-web'")
      .all();
    assert.deepEqual(
      members.map((m) => [m.account_id, m.role]),
      [[jan.id, 'member']]
    );
    const [log] = auditRows(sqlite, 'operator.project.moved');
    assert.equal(log.reason, 'Jan left the studio');
    assert.deepEqual([JSON.parse(log.detail).from, JSON.parse(log.detail).to], [jan.id, eva.id]);
    // The old owner's live connection is ended (it carried the owner's rights).
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM member_revocations WHERE project_id = 'kolar-web' AND email = ?"
        )
        .get(jan.email).n,
      1
    );
    // Again: already hers — nothing changes, nothing more is logged.
    await post('/operator/projects/kolar-web/move', op, {
      to: eva.email,
      reason: 'Jan left the studio',
    });
    assert.equal(auditRows(sqlite, 'operator.project.moved').length, 1);
  });

  test('move refuses an address with no account, and a project with a subscription', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const eva = await signUp(env, sqlite, 'eva@pokorna.cz');
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    seedProject(sqlite, { id: 'plakaty', owner: jan.id, subscription: 'sub_live' });
    const nobody = await post('/operator/projects/kolar-web/move', op, {
      to: 'x@nowhere.cz',
      reason: 'x y z',
    });
    assert.match(nobody.headers.get('location'), /error=move-no-account/);
    const paid = await post('/operator/projects/plakaty/move', op, {
      to: eva.email,
      reason: 'x y z',
    });
    assert.match(paid.headers.get('location'), /error=move-paid/);
    assert.equal(project(sqlite, 'kolar-web').account_id, jan.id);
    assert.equal(project(sqlite, 'plakaty').account_id, jan.id);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email = 'x@nowhere.cz'").get().n,
      0
    );
  });

  test('sign out everywhere: every browser session and every Mac of THAT account, and nobody else’s', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const now = Date.now();
    sqlite
      .prepare(
        'INSERT INTO personal_tokens (id, account_id, label, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(await sha256Hex('mpt_jan'), jan.id, 'MacBook', now);
    sqlite
      .prepare(
        'INSERT INTO personal_tokens (id, account_id, label, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(await sha256Hex('mpt_op'), op.id, 'iMac', now);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: now + DAY });
    assert.equal((await get('/', jan)).status, 200);

    const res = await post(`/operator/accounts/${jan.id}/sign-out`, op, {
      reason: 'laptop stolen',
    });
    assert.match(res.headers.get('location'), /done=signed-out/);
    // Jan's cookie is dead: "/" is the signed-out home, and a protected page redirects.
    const after = await worker.fetch(
      new Request('https://cloud.test/account', {
        headers: { cookie: `maude_session=${jan.session}` },
      }),
      env
    );
    assert.equal(after.status, 303);
    assert.equal(
      sqlite
        .prepare(
          'SELECT COUNT(*) AS n FROM personal_tokens WHERE account_id = ? AND revoked_at IS NULL'
        )
        .get(jan.id).n,
      0
    );
    assert.equal(
      sqlite
        .prepare(
          'SELECT COUNT(*) AS n FROM personal_tokens WHERE account_id = ? AND revoked_at IS NULL'
        )
        .get(op.id).n,
      1
    );
    assert.equal((await get('/operator', op)).status, 200, 'the operator is still signed in');
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM member_revocations WHERE project_id = 'kolar-web' AND email = ?"
        )
        .get(jan.email).n,
      1
    );
    const [log] = auditRows(sqlite, 'operator.account.signed-out');
    assert.equal(log.account_id, jan.id);
    assert.equal(log.reason, 'laptop stolen');
    // Asked again, it is done again and logged again: a project connection can
    // outlive every sign-in, so "nothing was signed in" is never the answer.
    await post(`/operator/accounts/${jan.id}/sign-out`, op, { reason: 'laptop stolen' });
    assert.equal(auditRows(sqlite, 'operator.account.signed-out').length, 2);
  });
});

// ---------------------------------------------- what the customer can read

describe('the Activity page — "you can see that we touched it", and only yours', () => {
  test('the owner reads every operator action on the project, in plain words, with the reason', async (t) => {
    const { sqlite, op, jan } = await world(t);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-activity-1',
      days: '14',
      reason: 'asked for more time',
    });
    await post('/operator/projects/kolar-web/promo', op, {
      tier: 'project',
      ends: '',
      reason: 'a friend',
    });
    await post('/operator/projects/kolar-web/pause', op, { reason: 'checking a report' });
    await post('/operator/projects/kolar-web/wake', op, { reason: 'all clear' });
    await post(`/operator/accounts/${jan.id}/sign-out`, op, { reason: 'laptop stolen' });
    // Jan was signed out; he signs in again to read it.
    const again = await signUp(env_(op), sqlite, 'jan2@kolar.studio');
    sqlite.prepare('UPDATE sessions SET account_id = ? WHERE account_id = ?').run(jan.id, again.id);
    bind(env_(op), again);
    const page = text(await (await get('/projects/kolar-web/audit', again)).text());
    for (const line of [
      /Maude gave this project free time[\s\S]*asked for more time/,
      /Maude marked this project as Promo[\s\S]*a friend/,
      /Maude paused this project[\s\S]*checking a report/,
      /Maude woke this project[\s\S]*all clear/,
      /Maude signed this account out everywhere[\s\S]*laptop stolen/,
    ]) {
      assert.match(page, line);
    }
    // No raw action key reaches a customer.
    assert.doesNotMatch(page, /operator\.[a-z-]+\.[a-z-]+/);
  });

  test('ANOTHER customer never reads it — an action on one account is not on everybody’s page', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const eva = await signUp(env, sqlite, 'eva@pokorna.cz');
    bind(env, eva);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    seedProject(sqlite, { id: 'evas', owner: eva.id, trialEndsAt: Date.now() + DAY });
    await post(`/operator/accounts/${jan.id}/sign-out`, op, { reason: 'laptop stolen' });
    await get(`/operator/accounts/${jan.id}`, op);
    await post('/operator/projects/kolar-web/pause', op, { reason: 'abuse report 12' });
    const page = text(await (await get('/projects/evas/audit', eva)).text());
    assert.doesNotMatch(
      page,
      /laptop stolen|abuse report|signed this account out|paused this project/
    );
    // The fleet-wide reads ARE hers to see, as before (they touch everyone).
    await get('/operator/accounts', op);
    const after = text(await (await get('/projects/evas/audit', eva)).text());
    assert.match(after, /Maude looked at the platform-wide account list/);
  });

  test('a MEMBER reads that Maude paused the project — and nothing about its plan or its owner’s account', async (t) => {
    const { env, sqlite, op, jan } = await world(t);
    const anna = await signUp(env, sqlite, 'anna@example.com');
    bind(env, anna);
    seedProject(sqlite, { id: 'kolar-web', owner: jan.id, trialEndsAt: Date.now() + DAY });
    addMember(sqlite, 'kolar-web', anna.id);
    await post('/operator/projects/kolar-web/free-time', op, {
      rid: 'rid-activity-2',
      days: '14',
      reason: 'asked for more time',
    });
    await post('/operator/projects/kolar-web/promo', op, {
      tier: 'project',
      ends: '',
      reason: 'a friend',
    });
    await post(`/operator/accounts/${jan.id}/sign-out`, op, { reason: 'laptop stolen' });
    const page = text(await (await get('/projects/kolar-web/audit', anna)).text());
    assert.doesNotMatch(
      page,
      /free time|Promo|asked for more time|a friend|laptop stolen|signed this account out/
    );
  });
});
