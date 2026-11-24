// The People view — Track B.
//
// `/admin/api/users*` and `/admin/api/invites` have existed and been tested
// since Cloud Phase 2, and NOTHING in the console called them: `grep users
// app.js` returned zero hits. A self-hoster's only way to add a teammate was to
// curl an undocumented admin API with HUB_SECRET, and the topbar's "Generate
// invite" was the peer-TOKEN generator — it asked for a label, not an address.
//
// These are source-level pins, in the house style of `admin-static.test.mjs`:
// the console is vanilla HTML + one script, so "does the UI call the route"
// is a question about the file.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ADMIN_HTML, ADMIN_JS } from '../src/admin-assets.mjs';

test('the nav offers People', () => {
  assert.match(ADMIN_HTML, /data-view="people"/);
  assert.match(ADMIN_HTML, /id="view-people"/);
});

test('every people route the view needs is actually called', () => {
  // The regression this whole track exists to fix: routes that existed and
  // nothing called. The view now reads ONE list and acts through /people/*.
  for (const route of [
    '/people',
    '/people/invite',
    '/people/invite/reissue',
    '/people/invite/revoke',
    '/people/let-in',
    '/people/dismiss',
    '/people/role',
    '/people/turn-on',
    '/people/signout',
    '/users/password',
  ]) {
    assert.ok(ADMIN_JS.includes(`'${route}'`), `the console never calls ${route}`);
  }
  // Turn off and Remove share one call, keyed by the button.
  assert.match(ADMIN_JS, /post\(`\/people\/\$\{x\}`/);
  assert.match(ADMIN_JS, /data-x="turn-off"/);
  assert.match(ADMIN_JS, /data-x="remove"/);
});

test('a person shows where they are signed in — the answer to "did the offboard take effect"', () => {
  // GET /people returns each account's live sessions; the row counts them and
  // the sheet lists them, each with its own Sign out.
  assert.match(ADMIN_JS, /p\.sessions/);
  assert.match(ADMIN_JS, /data-signout-label=/);
});

test('an invite is created for EMAILS — several at once — not a label', () => {
  assert.match(ADMIN_HTML, /<label[^>]*for="person-invite-email">Emails<\/label>/);
  assert.match(ADMIN_HTML, /<textarea id="person-invite-email"/);
  assert.match(ADMIN_JS, /post\('\/people\/invite', \{\s*emails,/);
});

test('the invite link is shown, never claimed to be sent', () => {
  // The hub has no SMTP and gains none. Saying "invite sent" would be a lie
  // the operator only discovers when the teammate never arrives.
  assert.match(ADMIN_HTML, /does not send email/i);
});

test('the peer TOKEN card no longer reads as an account invite', () => {
  // One is a terminal credential for a git peer, the other is a person's
  // account. Conflating them is what the view exists to end.
  assert.match(ADMIN_HTML, /Peer token/);
  assert.ok(
    !/Generate invite <span class="sku">HUB/.test(ADMIN_HTML),
    'the old label survived and still reads as an account invite'
  );
});

test('People hides under CLOUD strict identity — and only that one', () => {
  // Two flags are spelled `strict` and mean opposite things here:
  // identity.mode === 'strict' (cloud owns membership → hide People) versus
  // HUB_OIDC_MODE=strict (password login off → People is MORE necessary).
  assert.match(ADMIN_JS, /identity\?\.mode === 'strict'/);
  assert.match(ADMIN_JS, /data-view="people"/);
  assert.match(ADMIN_JS, /HUB_OIDC_MODE/, 'the collision must be documented where it bites');
});

test('the one-time reveal is reused, not reimplemented', () => {
  // A second "shown once" MODAL is a second place for that promise to drift:
  // a link that cannot be copied straight to the clipboard goes through the
  // same modal a peer token does.
  assert.match(ADMIN_JS, /const showSecret = \(url, label\) =>\s*showInvite\(/);
  assert.equal(ADMIN_JS.match(/\$\('token-modal'\)\.showModal\(\)/g)?.length, 1);
});

// The bug this pin exists for: the nav item, the panel, `loadPeople()` and the
// count badge all shipped — and clicking People bounced straight back to
// Overview, because `setView` reads `VIEW_TITLES[name]` and falls back to
// `overview` on a missing key. Every assertion above passed the whole time.
//
// So presence is not reachability, and asserting markup exists says nothing
// about whether a person can GET there. This checks the router instead, for
// every nav item at once — the next view added without a title fails here
// rather than in someone's browser.
test('every nav item is reachable — setView has a title for it', () => {
  const titles = ADMIN_JS.match(/const VIEW_TITLES = \{([\s\S]*?)\}/);
  assert.ok(titles, 'VIEW_TITLES not found in app.js');
  const known = new Set([...titles[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]));
  const navItems = [...ADMIN_HTML.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(navItems.length >= 5, 'expected the nav island to be parsed');
  for (const view of new Set(navItems)) {
    assert.ok(
      known.has(view),
      `nav item "${view}" has no VIEW_TITLES entry — setView sends it to overview`
    );
  }
});

// ── the invite panel's three lies (autonomous e2e, 2026-08-19) ──────────────
// Each was found by driving the real console against a real hub, and each is a
// source-level question, in this file's house style.

test('Revoke calls the route the hub actually routes', () => {
  // `DELETE /invites/<id>` is not a route. It 404'd, `api()` swallowed it, the
  // row vanished on the reload that followed — and the link stayed redeemable.
  assert.ok(
    !/\/invites\/\$\{encodeURIComponent\(id\)\}`, \{ method: 'DELETE' \}/.test(ADMIN_JS),
    'the console still tries DELETE /invites/<id>, which the hub does not route'
  );
  assert.match(ADMIN_JS, /'\/people\/invite\/revoke'/);
});

test('only redeemable invites are listed as people', async () => {
  // The store returns every invite ever issued, each with a `status`; the one
  // list (admin-people.mjs `listPeople`) keeps the open ones. The behaviour is
  // asserted in people-api.test.mjs ("a cancelled invite is not a person").
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/admin-people.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(i\.status !== 'open'\) continue;/);
});

test('the icon-only Revoke button carries an accessible name', () => {
  assert.match(ADMIN_JS, /data-revoke=[\s\S]{0,200}aria-label="Revoke the invitation/);
});

test('an expiry is rendered as time REMAINING, not as an age', () => {
  // `formatTime` measures how long ago something happened; an expiry a week
  // out has a negative age, so it fell into the "< 60s" arm and every invite
  // read "just now".
  assert.match(ADMIN_JS, /function formatUntil/);
  assert.match(ADMIN_JS, /formatUntil\(p\.expiresAt\)/);
});
