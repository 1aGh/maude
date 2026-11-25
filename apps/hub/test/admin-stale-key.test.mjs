// The admin page with an OLD admin key in the browser's storage (design.studyfi.com,
// 2026-11-25): the nav said "Admin key · Forget the admin key" over a completely
// blank Overview while the person's own Admin sign-in was valid.
//
// The rules this pins, on the real page (index.html + app.js in happy-dom, the
// API answered the way the hub answers it — a presented Bearer is judged alone,
// admin-people.mjs `adminActorFor`):
//   • a stored key the server rejects (401) is forgotten at once, and the page
//     falls back to the session — or to the sign-in card — with one quiet line;
//   • a valid session admin is preferred over a stored key, unless key mode was
//     chosen in this tab;
//   • no view is left empty: a fetch that fails says so, with Retry.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Window } from 'happy-dom';

import { ADMIN_HTML, ADMIN_JS } from '../src/admin-assets.mjs';

const KEY_REMOVED = 'The saved admin key no longer works — it was removed.';
const GOOD_KEY = 'the-real-admin-key';

const HUB = { name: 'StudyFi Design' };
const SESSION_ADMIN = {
  hub: HUB,
  selfService: true,
  provider: 'Google',
  signedIn: true,
  via: 'session',
  admin: true,
  email: 'michal@studyfi.test',
  roleLabel: 'Admin',
  linked: true,
  canLink: false,
};
const NOBODY = { hub: HUB, selfService: true, provider: 'Google', signedIn: false, admin: false };

const DATA = {
  '/overview': {
    hub: HUB,
    health: [
      { key: 'version', label: 'Version', value: 'Maude 2.4.6', state: 'ok', word: 'Up to date' },
    ],
    needs: [],
    counts: {
      people: 3,
      invited: 0,
      asks: 0,
      hereNow: 1,
      canvases: 4,
      changesThisWeek: 12,
      eventsThisWeek: 5,
    },
    hereNow: ['michal@studyfi.test'],
    changesByDay: [{ day: '2026-11-25', count: 12 }],
    recent: [{ kind: 'settings', actor: 'michal@studyfi.test', at: Date.now(), area: 'settings' }],
    retentionDays: 90,
    signIn: { provider: 'Google', domains: ['studyfi.test'] },
  },
  '/status': {
    uptimeMs: 60_000,
    port: 8443,
    dataDir: '/var/lib/maude-hub',
    tokenCount: 1,
    authMode: 'tokens',
    peersCount: 0,
    identity: {},
    version: '2.4.6',
  },
  '/canvases': { canvases: [] },
  '/people': {
    counts: { everyone: 1, asks: 0, invited: 0, off: 0, people: 1 },
    people: [],
    signIn: { provider: 'Google', passwords: false },
  },
  '/settings': { name: 'StudyFi Design', whoCanJoin: 'ask', signIn: { provider: 'Google' } },
};

/**
 * Boot the admin page. `api(path, { bearer })` answers each request; the
 * default is the hub's rule: a presented key is judged alone (good or 401),
 * no key means the session.
 */
async function openAdmin({
  storedKey = '',
  keyModeInThisTab = false,
  session = SESSION_ADMIN,
  fail = {},
}) {
  const window = new Window({ url: 'https://design.studyfi.test/admin' });
  const calls = [];
  const answer = (status, body) =>
    new window.Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), window.location.href);
    const path = url.pathname.replace(/^\/admin\/api/, '');
    const auth = new window.Headers(init.headers ?? {}).get('Authorization');
    const bearer = auth ? auth.replace(/^Bearer\s+/, '') : null;
    calls.push({ path, bearer });
    if (bearer && bearer !== GOOD_KEY) return answer(401, { error: 'unauthorized' });
    if (path === '/me') {
      return answer(
        200,
        bearer ? { hub: HUB, selfService: true, signedIn: true, admin: true, via: 'key' } : session
      );
    }
    if (!bearer && !session.admin) return answer(401, { error: 'unauthorized' });
    if (fail[path]) return answer(500, { error: fail[path] });
    if (path in DATA) return answer(200, DATA[path]);
    if (path.startsWith('/activity')) return answer(200, { events: [], more: null });
    return answer(404, { error: 'not found' });
  };
  if (storedKey) window.localStorage.setItem('maude-hub-secret', storedKey);
  if (keyModeInThisTab) window.sessionStorage.setItem('maude-hub-key-mode', '1');
  const body = ADMIN_HTML.slice(ADMIN_HTML.indexOf('<body>') + 6, ADMIN_HTML.indexOf('</body>'));
  window.document.body.innerHTML = body.replace(/<script[^>]*><\/script>/g, '');
  window.eval(ADMIN_JS);
  const $ = (id) => window.document.getElementById(id);
  const settle = async (until) => {
    for (let i = 0; i < 100 && !until(); i++) await new Promise((r) => setTimeout(r, 10));
  };
  return { window, $, calls, settle, close: () => window.happyDOM.close() };
}

const visible = (el) => Boolean(el) && !el.hidden;

test('a stored key the server rejects is forgotten and a valid session admin gets the Overview', async () => {
  const page = await openAdmin({ storedKey: 'garbage-from-an-old-key' });
  const { $ } = page;
  try {
    await page.settle(() => visible($('dash')) && $('stat-people')?.textContent === '3');
    assert.ok(visible($('dash')), 'the admin page is shown');
    assert.equal(
      page.window.localStorage.getItem('maude-hub-secret'),
      null,
      'the dead key is gone'
    );
    assert.ok(visible($('page-note')), 'one quiet line says what happened');
    assert.equal($('page-note-text').textContent, KEY_REMOVED);
    assert.doesNotMatch($('me-chip').textContent, /Admin key/, 'the person, not the key');
    assert.match($('me-chip').textContent, /Michal · Admin/);
    assert.ok($('forget').hidden, 'nothing to forget any more');
    assert.ok($('page-note-retry').hidden, 'nothing to retry: it is a notice, not a failure');
    // The Overview is drawn — never blank.
    assert.equal($('stat-people').textContent, '3');
    assert.ok($('ov-health').children.length > 0, 'Health is drawn');
    assert.ok($('ov-activity-feed').children.length > 0, 'What happened is drawn');
    // After the first answer, the dead key is never sent again.
    const firstReject = page.calls.findIndex((c) => c.bearer);
    assert.ok(page.calls.slice(firstReject + 1).every((c) => !c.bearer));
  } finally {
    await page.close();
  }
});

test('a stored key the server rejects, signed out: the sign-in card says the key was removed', async () => {
  const page = await openAdmin({ storedKey: 'garbage-from-an-old-key', session: NOBODY });
  const { $ } = page;
  try {
    await page.settle(() => visible($('onboard')) && visible($('onboard-note')));
    assert.ok(visible($('onboard')), 'the sign-in card');
    assert.ok(!visible($('dash')), 'no admin page');
    assert.ok(
      visible($('onboard-signin')),
      'Sign in is offered — this is a team server, not a cell'
    );
    assert.equal($('onboard-note').textContent, KEY_REMOVED);
    assert.equal(page.window.localStorage.getItem('maude-hub-secret'), null);
  } finally {
    await page.close();
  }
});

test('a valid session admin is preferred over a valid stored key — unless key mode was chosen in this tab', async () => {
  const session = await openAdmin({ storedKey: GOOD_KEY });
  try {
    await session.settle(() => visible(session.$('dash')) && session.$('me-chip').textContent);
    assert.match(session.$('me-chip').textContent, /Michal · Admin/);
    assert.ok(!session.$('forget').hidden, 'the saved key can still be forgotten from the menu');
    // Day-to-day routes go on the session; the key is kept for Advanced.
    assert.ok(session.calls.filter((c) => c.path === '/overview').every((c) => !c.bearer));
  } finally {
    await session.close();
  }
  const keyed = await openAdmin({ storedKey: GOOD_KEY, keyModeInThisTab: true });
  try {
    await keyed.settle(() => visible(keyed.$('dash')) && keyed.$('me-chip').textContent);
    assert.match(keyed.$('me-chip').textContent, /Admin key/);
  } finally {
    await keyed.close();
  }
});

test('no view is left empty: a part that fails says so, with Retry, and Retry loads it', async () => {
  const fail = { '/overview': 'database is locked' };
  const page = await openAdmin({ fail });
  const { $ } = page;
  try {
    await page.settle(() => visible($('page-note')));
    assert.ok(visible($('page-note')), 'the failure is said');
    assert.match($('page-note-text').textContent, /overview could not be loaded/i);
    assert.match($('page-note-text').textContent, /database is locked/);
    assert.ok(visible($('page-note-retry')), 'with Retry');
    delete fail['/overview'];
    $('page-note-retry').click();
    await page.settle(() => $('stat-people').textContent === '3' && !visible($('page-note')));
    assert.equal($('stat-people').textContent, '3');
    assert.ok(!visible($('page-note')), 'the line goes once it loads');
  } finally {
    await page.close();
  }
});
