// The no-wake probe (feature-cloud-cost-and-cold-start-ux, Task 1).
//
// The control plane's hourly telemetry read used to START every sleeping cell,
// and each start re-hydrated the whole project from R2. The header may only
// ever SUPPRESS a start — these cases pin both halves of that.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { safeReturnPath, WAKE_HEADER, wakePolicy, wakesWithoutAsking } from './cell-config.mjs';

const h = (o = {}) => new Headers(o);

test('a no-wake probe to a sleeping cell is answered without a start', () => {
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: false, authorized: true }),
    'asleep-reply'
  );
});

test('a no-wake probe to a running cell is proxied as today', () => {
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: true, authorized: true }),
    'proxy'
  );
});

test('an ordinary request to a sleeping cell still wakes it', () => {
  assert.equal(wakePolicy({ headers: h(), running: false, authorized: true }), 'block-and-start');
});

test('only the literal value suppresses a start', () => {
  for (const v of ['', 'no', 'NEVER', 'false', '0']) {
    assert.equal(
      wakePolicy({ headers: h({ [WAKE_HEADER]: v }), running: false, authorized: true }),
      'block-and-start',
      v
    );
  }
});

test('an unknown running flag is treated as not running (the safe side)', () => {
  assert.equal(wakePolicy({ headers: h(), running: undefined }), 'block-and-start');
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: 'yes', authorized: true }),
    'asleep-reply'
  );
});

test('without the cell secret the header is ignored — no awake/asleep oracle', () => {
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: false, authorized: false }),
    'block-and-start'
  );
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: false }),
    'block-and-start'
  );
});

// Scanner paths on a cold cell (feature-cells-no-wake-for-scanners). The policy
// may refuse a START, never change what a running cell answers.
const scan = new URL('https://alligators.cloud.maude.sh/wp-login.php');
const page = new URL('https://alligators.cloud.maude.sh/');

test('a scanner path to a sleeping cell is refused without a start', () => {
  assert.equal(wakePolicy({ headers: h(), running: false, url: scan }), 'refuse-cold');
  assert.equal(wakePolicy({ headers: h(), running: undefined, url: scan }), 'refuse-cold');
});

test('a scanner path to a running cell is proxied as today', () => {
  assert.equal(wakePolicy({ headers: h(), running: true, url: scan }), 'proxy');
});

test('a scanner path carrying an owner signal still wakes the cell', () => {
  assert.equal(
    wakePolicy({ headers: h({ authorization: 'Bearer t' }), running: false, url: scan }),
    'block-and-start'
  );
  assert.equal(
    wakePolicy({ headers: h({ cookie: 'maude_studio=s' }), running: false, url: scan }),
    'block-and-start'
  );
});

test('a member request to a sleeping cell still wakes it', () => {
  for (const headers of [
    h({ authorization: 'Bearer t' }),
    h({ cookie: 'maude_studio=s' }),
    h({ cookie: 'x=1; maude_canvas=c' }),
  ]) {
    assert.equal(wakePolicy({ headers, running: false, url: page }), 'block-and-start');
    assert.equal(
      wakePolicy({ headers, running: false, url: page, navigation: true }),
      'block-and-start'
    );
  }
});

test('the no-wake probe is unchanged by the scanner rule', () => {
  assert.equal(
    wakePolicy({
      headers: h({ [WAKE_HEADER]: 'never' }),
      running: false,
      authorized: true,
      url: new URL('https://alligators.cloud.maude.sh/health'),
    }),
    'asleep-reply'
  );
});

// Members-only wake (2026-10-04). After v1.6.11 every overnight wake was an
// anonymous `GET /` from a bot. An anonymous browser now gets a page with one
// button; a non-browser gets a sentence. Nothing that could be a member's
// changes, and a running cell is never affected.
const at = (p) => new URL(p, 'https://alligators.cloud.maude.sh');

test('an anonymous browser on a sleeping cell gets the asleep page, not a start', () => {
  for (const p of ['/', '/app', '/canvases', '/sign-in', '/random']) {
    assert.equal(
      wakePolicy({ headers: h(), running: false, url: at(p), navigation: true }),
      'wake-page',
      p
    );
  }
});

test('an anonymous non-browser on a sleeping cell gets a sentence, not a start', () => {
  assert.equal(wakePolicy({ headers: h(), running: false, url: page }), 'asleep-text');
  assert.equal(wakePolicy({ headers: h(), running: undefined, url: at('/x') }), 'asleep-text');
});

test('scanner paths keep their 404 ahead of the asleep page', () => {
  assert.equal(
    wakePolicy({ headers: h(), running: false, url: scan, navigation: true }),
    'refuse-cold'
  );
});

test('a running cell answers every anonymous request as today', () => {
  for (const navigation of [true, false]) {
    assert.equal(wakePolicy({ headers: h(), running: true, url: page, navigation }), 'proxy');
  }
});

test('a deep link or a canvas capability wakes without the click', () => {
  for (const p of ['/?open=ui/test.tsx', '/?open=a%2Fb.tsx&x=1', '/app?t=abc']) {
    assert.equal(
      wakePolicy({ headers: h(), running: false, url: at(p), navigation: true }),
      'block-and-start',
      p
    );
  }
  // An empty value is not a deep link.
  assert.equal(
    wakePolicy({ headers: h(), running: false, url: at('/?open='), navigation: true }),
    'wake-page'
  );
});

test('sign-in, OIDC, invite and studio routes wake without the click', () => {
  for (const p of [
    '/auth/oidc/callback?code=x&state=y',
    '/auth/login',
    '/studio/signin',
    '/oidc/approve',
    '/join/abc',
    '/join',
    '/invites/xyz',
    '/_canvas-shell',
    '/_ws',
    '/_project-file/x.png',
    '/assets/app.js',
    '/api/files',
    '/health',
    '/.well-known/openid-configuration',
    '/_cell/wake',
  ]) {
    assert.equal(
      wakePolicy({ headers: h(), running: false, url: at(p), navigation: true }),
      'block-and-start',
      p
    );
  }
});

test('the canvas origin and a start already in flight never get the asleep page', () => {
  assert.equal(
    wakePolicy({ headers: h(), running: false, url: page, navigation: true, canvas: true }),
    'block-and-start'
  );
  assert.equal(
    wakePolicy({ headers: h(), running: false, url: page, navigation: true, starting: true }),
    'block-and-start'
  );
});

test('wakesWithoutAsking: a garbage URL errs toward the old behaviour', () => {
  assert.equal(wakesWithoutAsking('not a url'), true);
  assert.equal(wakesWithoutAsking(at('/joinx')), false);
  assert.equal(wakesWithoutAsking(at('/AUTH/login')), true);
});

test('safeReturnPath keeps the visitor on this origin', () => {
  const o = 'https://alligators.cloud.maude.sh';
  assert.equal(safeReturnPath('/?open=ui/test.tsx', o), '/?open=ui/test.tsx');
  assert.equal(safeReturnPath('/app', o), '/app');
  for (const bad of [
    'https://evil.example/',
    '//evil.example/x',
    '/\\evil.example',
    'javascript:alert(1)',
    // Dot-segments collapse to `//host` after parsing (2026-10-04 review).
    '/.//evil.com',
    '/a/..//evil.com',
    '/..//evil.com',
    '/./\\evil.com',
    '',
    null,
    undefined,
    42,
    `/${'a'.repeat(3000)}`,
  ]) {
    assert.equal(safeReturnPath(bad, o), '/', String(bad).slice(0, 30));
  }
});

test('a socket upgrade wakes without the click (the desktop sync socket carries no header)', () => {
  assert.equal(
    wakePolicy({ headers: h({ upgrade: 'websocket' }), running: false, url: page }),
    'block-and-start'
  );
});
