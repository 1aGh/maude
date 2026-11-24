// /admin static asset serving — shell HTML + CSS + JS.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { ADMIN_HTML } from '../src/admin-assets.mjs';
import { createHub } from '../src/server.mjs';
import { decide } from '../src/studio-manifest.mjs';

const PORT = Number.parseInt(process.env.HUB_TEST_PORT ?? '14598', 10);

let hub;
let dataDir;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-admin-static-'));
  const built = createHub({ port: PORT, dataDir, secret: 'test-secret', verbose: false });
  hub = built.server;
  await hub.listen();
});

afterEach(async () => {
  if (hub) await hub.destroy();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('GET /admin returns the admin HTML shell', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/admin`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
  const body = await res.text();
  assert.match(body, /<title>Studio Hub · Admin<\/title>/);
  assert.match(body, /id="invite-form"/);
  assert.match(body, /id="bootstrap-form"/);
});

test('GET /admin shell carries the team-server admin + every JS-referenced ID', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/admin`);
  const body = await res.text();
  // Pre-auth + auth IDs the app.js state machine reads.
  for (const id of [
    'onboard-form',
    'onboard-secret',
    'bootstrap-form',
    'bootstrap-identity',
    'auth-state',
    'forget',
    'dash',
    // the member's page and the sign-in door
    'member',
    'signin-link',
    // server facts (Settings › Advanced)
    's-uptime',
    's-version',
    's-port',
    's-data',
    's-tokens',
    's-peers',
    // Advanced: tokens, connected sessions, the "shown once" modal
    'advanced',
    'adv-key-form',
    'peers-rows',
    'tokens-rows',
    'token-modal',
    'token-command',
    'token-raw',
    'token-copy',
    'token-scope',
    // the five pages
    'view-overview',
    'view-people',
    'view-projects',
    'view-activity',
    'view-settings',
    'ov-needs-rows',
    'ov-health',
    'ov-activity-feed',
    'people-rows',
    'canvases-rows',
    'activity-rows',
    'activity-csv',
    'join-form',
    'settings-form',
    'set-name',
    'set-desc',
    'rotate-admin',
    // the sheets
    'invite-sheet',
    'person-sheet',
  ]) {
    assert.match(body, new RegExp(`id="${id}"`), `missing #${id} in admin shell`);
  }
  // The nav island offers the five pages — Tokens and connected sessions are
  // folded into Settings › Advanced, Canvases is Projects.
  for (const view of ['overview', 'people', 'projects', 'activity', 'settings']) {
    assert.match(body, new RegExp(`data-view="${view}"`), `missing nav item ${view}`);
  }
  for (const gone of ['peers', 'tokens', 'canvases']) {
    assert.doesNotMatch(body, new RegExp(`data-view="${gone}"`), `${gone} is no longer a page`);
  }
  // Every page, sheet and primary action carries a test hook.
  for (const hook of [
    'view-overview',
    'view-people',
    'view-projects',
    'view-activity',
    'view-settings',
    'member-view',
    'invite-sheet',
    'person-sheet',
    'people-invite',
    'admin-signin',
  ]) {
    assert.match(body, new RegExp(`data-testid="${hook}"`), `missing data-testid ${hook}`);
  }
  // Words: a self-hosted hub is a team server here, and never "Maude Cloud".
  assert.match(body, /Team server/);
  assert.doesNotMatch(body, /Maude Cloud/);
});

test('GET /admin?key=... still returns the shell (key is consumed client-side)', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/admin?key=anything`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
});

test('GET /admin/ canonicalizes to /admin (301, relative Location)', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/admin/`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  // Relative Location so the redirect survives a path-stripping reverse proxy
  // (../admin resolves to <prefix>/admin from the browser's <prefix>/admin/).
  assert.equal(res.headers.get('location'), '../admin');
  // Sanity: the browser resolves it to the canonical no-slash path at the root.
  assert.equal(new URL(res.headers.get('location'), 'http://h/admin/').pathname, '/admin');
});

test('GET /admin/style.css returns CSS', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/admin/style.css`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/css/);
  const body = await res.text();
  assert.match(body, /--accent:/);
});

test('GET /admin/app.js returns JavaScript', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/admin/app.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/javascript/);
  const body = await res.text();
  assert.match(body, /maude-hub-secret/);
});

// The header's release stamp — feature-release-reaches-the-fleet.
//
// A wiring check, not a rendering one: the admin console is vanilla JS with no
// DOM harness here, so this asserts that the element the operator reads exists
// in the shell and that the script reads the fields that fill it. What each
// field CATCHES is asserted in bundle-identity.test.mjs; what the fleet answers
// is asserted by scripts/test/verify-fleet-release.test.mjs.
test('the admin header carries a slot for the running release', async () => {
  const html = await (await fetch(`http://127.0.0.1:${PORT}/admin`)).text();
  assert.match(html, /id="nav-hub-version"/);

  const js = await (await fetch(`http://127.0.0.1:${PORT}/admin/app.js`)).text();
  // Both answers, because they fail on different things.
  assert.match(js, /releaseVersion/);
  assert.match(js, /dist\/client\.bundle\.js/);
  // An absent answer must render as nothing, never as a guess.
  const css = await (await fetch(`http://127.0.0.1:${PORT}/admin/style.css`)).text();
  assert.match(css, /\.nav-brand-ver:empty\s*\{\s*display:\s*none/);
});

// "Open the studio" — Cloud Phase 25 E1 put the studio first in the console;
// Cloud Phase 27 C4 / DDR-209 then moved the studio from the hub's own `/studio`
// page to the proxied root `/`. The sign-in redirect followed the move, the two
// console CTAs did not, and a self-hoster's primary button opened
// `{"error":"not found"}` for three weeks. So: every console link must resolve
// to a path this hub serves, and the studio CTAs must resolve to `/` — and
// the test proves `/studio` is DEAD first, so it cannot pass by accident.
test('the console\'s "Open the studio" CTAs point at the studio root, not the deleted /studio page', async () => {
  // The old target is genuinely unroutable — the proxy refuses it as
  // unclassified for every role, including the owner.
  assert.deepEqual(decide('GET', '/studio', 'owner'), {
    allow: false,
    reason: 'unclassified',
    capability: null,
  });
  assert.equal(decide('GET', '/', 'owner').allow, true);

  // `ADMIN_HTML` is the exact string `GET /admin` serves (server.mjs); reading
  // it directly keeps this test off the keep-alive socket pool, which the
  // previous test's three fetches leave pointing at a destroyed listener.
  const html = ADMIN_HTML;
  // Canonical console address (GET /admin/ 301s here), so relative hrefs
  // resolve exactly as the browser resolves them.
  const base = 'http://h/admin';
  for (const id of ['nav-studio', 'topbar-studio']) {
    const m = html.match(new RegExp(`<a[^>]*\\bid="${id}"[^>]*\\bhref="([^"]*)"`));
    assert.ok(m, `#${id} is an <a> with an href`);
    const path = new URL(m[1], base).pathname;
    assert.notEqual(path, '/studio', `#${id} still points at the deleted /studio page`);
    assert.equal(path, '/', `#${id} must open the studio at the root`);
    // Relative, like `admin/style.css` and the `../admin` redirect, so the
    // link survives a path-stripping reverse proxy (<prefix>/admin → <prefix>/).
    assert.ok(!m[1].startsWith('/'), `#${id} href must be relative, got ${m[1]}`);
  }
});
