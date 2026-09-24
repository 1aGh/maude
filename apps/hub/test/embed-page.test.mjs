// DDR-242 — the frameable signed-out answer to an embedded studio request.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { embedSignInPage, isEmbedPageRequest, parseEmbedOrigins } from '../src/embed-page.mjs';

const ORBIT = 'https://orbit.studyfi.com';
const env = { MAUDE_EMBED_ORIGINS: `${ORBIT}, https://other.example.com` };

function req(url, method = 'GET') {
  return { url, method, headers: { accept: 'text/html' } };
}

function scriptOf(html) {
  return /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
}

test('embed origins are normalized, and anything wider than an origin is dropped', () => {
  assert.deepEqual(
    parseEmbedOrigins(
      'https://orbit.studyfi.com/tasks/1, http://localhost:3100 * https://*.studyfi.com ' +
        'javascript:alert(1) not-a-url https://u:p@evil.example null https://orbit.studyfi.com'
    ),
    ['https://orbit.studyfi.com', 'http://localhost:3100']
  );
  assert.deepEqual(parseEmbedOrigins(undefined), []);
  assert.deepEqual(parseEmbedOrigins(''), []);
});

test('only a GET/HEAD of the studio page with embed=1 is an embed request', () => {
  assert.equal(isEmbedPageRequest(req('/?open=ui/a.tsx&embed=1'), '/'), true);
  assert.equal(isEmbedPageRequest(req('/index.html?embed=1'), '/index.html'), true);
  assert.equal(isEmbedPageRequest(req('/?embed=1', 'HEAD'), '/'), true);
  assert.equal(isEmbedPageRequest(req('/?open=ui/a.tsx'), '/'), false);
  assert.equal(isEmbedPageRequest(req('/?embed=true'), '/'), false);
  assert.equal(isEmbedPageRequest(req('/_config?embed=1'), '/_config'), false);
  assert.equal(isEmbedPageRequest(req('/?embed=1', 'POST'), '/'), false);
});

test('the page may be framed by the embed origins — and by nobody else', () => {
  const { headers } = embedSignInPage({ request: req('/?open=ui/a.tsx&embed=1'), env });
  const csp = headers['content-security-policy'];
  assert.match(
    csp,
    /frame-ancestors 'self' https:\/\/orbit\.studyfi\.com https:\/\/other\.example\.com(;|$)/
  );
  // X-Frame-Options has no allowlist form; sending DENY here would break the embed.
  assert.equal(headers['x-frame-options'], undefined);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline'[^;]*script|script-src[^;]*unsafe/);
  assert.equal(headers['cache-control'], 'no-store');
});

test('its one script is pinned by hash', () => {
  const { html, headers } = embedSignInPage({ request: req('/?open=ui/a.tsx&embed=1'), env });
  const script = scriptOf(html);
  const hash = createHash('sha256').update(script, 'utf8').digest('base64');
  assert.match(
    headers['content-security-policy'],
    new RegExp(`script-src 'sha256-${hash.replace(/[+/=]/g, '\\$&')}'`)
  );
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  // No asset at all: nothing that could fail to load inside someone else's page.
  assert.doesNotMatch(html, /<link|src=/);
});

test('the sign-in link opens the full studio at the same file, in a new tab', () => {
  const { html } = embedSignInPage({ request: req('/?open=ui/My%20Board.tsx&embed=1'), env });
  const link = /<a href="([^"]*)" target="_blank" rel="noopener noreferrer">/.exec(html);
  assert.ok(link, 'link present');
  assert.equal(link[1], '/?open=ui/My%20Board.tsx');
  assert.doesNotMatch(link[1], /embed/);
});

test('a hostile open= never becomes a link anywhere else', () => {
  for (const open of ['https://evil.example', '../../etc/passwd', '//evil.example', '']) {
    const { html } = embedSignInPage({
      request: req(`/?open=${encodeURIComponent(open)}&embed=1`),
      env,
    });
    const href = /<a href="([^"]*)"/.exec(html)?.[1];
    assert.equal(href, '/', open);
  }
});

test('auth-required goes to the parent only if it is an embed origin, by exact origin', () => {
  const { html } = embedSignInPage({ request: req('/?open=ui/a.tsx&embed=1'), env });
  const script = scriptOf(html);
  const run = ({ ancestor, referrer, framed = true }) => {
    const posted = [];
    const parent = { postMessage: (msg, target) => posted.push({ msg, target }) };
    const win = {
      location: { ancestorOrigins: ancestor ? [ancestor] : [] },
      parent: framed ? parent : null,
    };
    if (!framed) win.parent = win;
    new Function('window', 'document', script)(win, { referrer: referrer ?? '' });
    return posted;
  };
  assert.deepEqual(run({ ancestor: ORBIT }), [
    {
      msg: { source: 'maude-hub', v: 1, type: 'auth-required', open: 'ui/a.tsx' },
      target: ORBIT,
    },
  ]);
  // Firefox: no ancestorOrigins, the referrer's origin stands in.
  assert.equal(run({ referrer: `${ORBIT}/tasks/ORB-1` })[0]?.target, ORBIT);
  assert.deepEqual(run({ ancestor: 'https://evil.example' }), []);
  assert.deepEqual(run({ ancestor: 'null' }), []);
  assert.deepEqual(run({ ancestor: ORBIT, framed: false }), []);
});

test('the embedded values cannot break out of the script', () => {
  const { html } = embedSignInPage({
    request: req('/?open=ui/%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E.tsx&embed=1'),
    env,
  });
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
});
