// The pages a person sees when a project is starting, broken, or absent
// (feature-cloud-cost-and-cold-start-ux Phase B).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isNavigation } from './cell-config.mjs';
import {
  ASLEEP_PAGE_CSP,
  asleepPage,
  couldNotStartPage,
  htmlResponse,
  nextWaitUrl,
  notFoundPage,
  PAGE_CSP,
  readWait,
  startingPage,
  stripWait,
  WAIT_PARAM,
} from './pages.mjs';

const NOW = 1_790_000_000_000;
const studio = new URL('https://alligators.cloud.maude.sh/projects/x?tab=1');

test('the starting page says why, promises speed, and says the work is safe', () => {
  const html = startingPage({ url: studio, now: NOW });
  assert.match(html, /took a nap/);
  assert.match(html, /flies like a rocket/);
  assert.match(html, /Your work is safe/);
  assert.match(html, /refreshes by itself/);
});

test('it refreshes to the same URL, one attempt further, keeping the original start', () => {
  const html = startingPage({ url: studio, now: NOW });
  const m = /content="3;url=([^"]+)"/.exec(html);
  assert.ok(m, 'meta refresh present');
  const next = new URL(m[1].replaceAll('&amp;', '&'), studio);
  assert.equal(next.pathname, '/projects/x');
  assert.equal(next.searchParams.get('tab'), '1');
  assert.equal(next.searchParams.get(WAIT_PARAM), `1.${NOW}`);

  const later = startingPage({ url: next, now: NOW + 42_000 });
  assert.match(later, /waiting 0:42/);
  assert.match(later, new RegExp(`${WAIT_PARAM}=2\\.${NOW}`));
});

test('the status line changes from one refresh to the next', () => {
  const lines = new Set();
  for (let i = 0; i < 4; i++) {
    const u = new URL(studio);
    u.searchParams.set(WAIT_PARAM, `${i}.${NOW}`);
    lines.add(/class="status">([^<]+)</.exec(startingPage({ url: u, now: NOW + 1000 }))[1]);
  }
  assert.equal(lines.size, 4);
});

test('a long wait is acknowledged', () => {
  const u = new URL(studio);
  u.searchParams.set(WAIT_PARAM, `60.${NOW}`);
  assert.match(startingPage({ url: u, now: NOW + 4 * 60_000 }), /carrying a lot of photos/);
});

test('a garbage or hostile wait parameter is just a fresh start', () => {
  for (const raw of ['', 'x', '1.2', `1.${NOW + 10_000}`, '99999999.1', '<script>.1']) {
    const u = new URL(studio);
    u.searchParams.set(WAIT_PARAM, raw);
    assert.deepEqual(readWait(u, NOW), { attempt: 0, startedAt: null }, raw);
    assert.doesNotThrow(() => startingPage({ url: u, now: NOW }));
  }
});

test('the wait parameter never reaches the project', () => {
  const u = new URL(nextWaitUrl(studio, { attempt: 3, startedAt: NOW }, NOW), studio);
  const clean = stripWait(u);
  assert.equal(clean.searchParams.has(WAIT_PARAM), false);
  assert.equal(clean.searchParams.get('tab'), '1');
});

test('no page carries script', () => {
  for (const html of [
    startingPage({ url: studio, now: NOW }),
    startingPage({ url: studio, canvas: true, now: NOW }),
    couldNotStartPage({ url: studio }),
    couldNotStartPage({ url: studio, canvas: true }),
    notFoundPage(),
    notFoundPage({ canvas: true }),
    asleepPage({ url: studio, wakePath: '/_cell/wake' }),
  ]) {
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /\son[a-z]+=/i);
  }
});

test('the canvas variant names no project and links nowhere (DDR-054)', () => {
  const canvasUrl = new URL('https://canvas-alligators.cloud.maude.sh/x');
  for (const html of [
    startingPage({ url: canvasUrl, projectName: 'alligators', canvas: true, now: NOW }),
    couldNotStartPage({ url: canvasUrl, canvas: true }),
    notFoundPage({ canvas: true }),
  ]) {
    assert.doesNotMatch(html, /alligators/i);
    assert.doesNotMatch(html, /href=/i);
  }
});

test('a reason is escaped, never rendered as markup', () => {
  assert.match(couldNotStartPage({ url: studio, reason: '<img src=x>' }), /&lt;img src=x&gt;/);
});

test('the response is HTML under a strict CSP, never cached', () => {
  const res = htmlResponse('<p>x</p>', 503, { retryAfter: 3 });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('content-security-policy'), PAGE_CSP);
  assert.match(PAGE_CSP, /default-src 'none'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('retry-after'), '3');
});

const req = (headers, method = 'GET') => new Request('https://x.test/', { method, headers });

test('a top-level page load and an iframe load are navigations', () => {
  assert.equal(
    isNavigation(req({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })),
    true
  );
  assert.equal(
    isNavigation(req({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' })),
    true
  );
});

test('scripts, sockets, writes and probes are not', () => {
  assert.equal(isNavigation(req({ 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })), false);
  assert.equal(
    isNavigation(req({ 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' })),
    false
  );
  assert.equal(isNavigation(req({ upgrade: 'websocket', accept: 'text/html' })), false);
  assert.equal(
    isNavigation(req({ 'sec-fetch-mode': 'navigate', accept: 'text/html' }, 'POST')),
    false
  );
  // The desktop's sync client and the control plane's probe send neither header.
  assert.equal(isNavigation(req({ accept: 'application/json' })), false);
  assert.equal(isNavigation(req({})), false);
});

test('without Fetch Metadata, a GET that prefers HTML counts', () => {
  assert.equal(isNavigation(req({ accept: 'text/html,application/xhtml+xml' })), true);
});

// Members-only wake (2026-10-04): the page an anonymous browser gets instead
// of a start.
test('the asleep page is one form that posts back here with where you were going', () => {
  const url = new URL(`https://alligators.cloud.maude.sh/?open=ui/test.tsx&${WAIT_PARAM}=2.${NOW}`);
  const html = asleepPage({ url, wakePath: '/_cell/wake' });
  assert.match(html, /<form method="post" action="\/_cell\/wake"/);
  assert.match(html, /name="to" value="\/\?open=ui%2Ftest.tsx"/);
  assert.doesNotMatch(html, new RegExp(WAIT_PARAM));
  assert.match(html, /<button[^>]*type="submit">Open project<\/button>/);
  // Anonymous visitor: the project is not named.
  assert.doesNotMatch(html, /alligators/i);
});

test('the asleep page escapes the path it carries', () => {
  const html = asleepPage({
    url: new URL('https://x.test/a"><img src=x>'),
    wakePath: '/_cell/wake',
  });
  assert.doesNotMatch(html, /<img src=x>/);
});

test('the asleep page CSP allows its own form and nothing else new', () => {
  assert.match(ASLEEP_PAGE_CSP, /form-action 'self'/);
  assert.match(ASLEEP_PAGE_CSP, /frame-ancestors 'none'/);
  assert.match(ASLEEP_PAGE_CSP, /default-src 'none'/);
  assert.doesNotMatch(ASLEEP_PAGE_CSP, /script-src/);
  const res = htmlResponse('<p>x</p>', 200, { csp: ASLEEP_PAGE_CSP });
  assert.equal(res.headers.get('content-security-policy'), ASLEEP_PAGE_CSP);
});

test('the asleep page tells crawlers not to index it', () => {
  assert.match(
    asleepPage({ url: studio, wakePath: '/_cell/wake' }),
    /name="robots" content="noindex/
  );
  const res = htmlResponse('<p>x</p>', 200, { noindex: true });
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(htmlResponse('<p>x</p>', 200).headers.get('x-robots-tag'), null);
});
