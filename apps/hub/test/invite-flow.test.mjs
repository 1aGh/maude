// Cloud Phase 6 Task 1 — the invite path end to end, against a real hub.
//
// The exit gate for this phase is a timed cold start by a real human. This is
// the machine-checkable half of it: link → account → signed in, in one POST,
// with no login form in the middle and no token in a URL a browser navigates
// away from.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { closeInvites } from '../src/invites.mjs';
import { joinPage } from '../src/join-page.mjs';
import { createHub } from '../src/server.mjs';
import { verifyToken } from '../src/tokens.mjs';
import { closeUsers } from '../src/users.mjs';

const BASE_PORT = Number.parseInt(process.env.HUB_INVITE_TEST_PORT ?? '14760', 10);
const SECRET = 'test-admin-secret';

let hub;
let dataDir;
let PORT;
let counter = 0;

beforeEach(async () => {
  PORT = BASE_PORT + counter++;
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-invite-'));
  hub = createHub({
    port: PORT,
    dataDir,
    secret: SECRET,
    publicUrl: `https://acme.cloud.maude.sh`,
    verbose: false,
  }).server;
  await hub.listen();
});

afterEach(async () => {
  if (hub) await hub.destroy();
  if (dataDir) {
    closeUsers(dataDir);
    closeInvites(dataDir);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

const base = () => `http://127.0.0.1:${PORT}`;
const admin = (extra = {}) => ({ Authorization: `Bearer ${SECRET}`, ...extra });
const postJson = (body, headers = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

async function mintInvite(overrides = {}) {
  const res = await fetch(`${base()}/admin/api/invites`, postJson(overrides, admin()));
  assert.equal(res.status, 201);
  return res.json();
}

test('mint → look → redeem → signed in, with no login form in the middle', async () => {
  const { url, value, invite } = await mintInvite({ createdBy: 'alice@example.com' });
  assert.equal(url, `https://acme.cloud.maude.sh/join/${value}`);
  assert.ok(invite.expiresAt > Date.now());

  // The landing page LOOKS. Doing it repeatedly must not consume the invite —
  // a link preview bot following the URL is the ordinary case.
  for (let i = 0; i < 3; i++) {
    const look = await fetch(`${base()}/join/${value}`);
    assert.equal(look.status, 200, `look ${i + 1}`);
    const body = await look.json();
    assert.equal(body.ok, true);
    assert.equal(body.needsEmail, true);
  }

  const redeem = await fetch(
    `${base()}/join`,
    postJson({ token: value, email: 'newbie@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(redeem.status, 201);
  const session = await redeem.json();

  // Signed in immediately — the whole point. A redeem that ends at a login
  // form has reintroduced the form it exists to remove.
  assert.equal(session.user.email, 'newbie@example.com');
  assert.ok(session.expiresAt > Date.now());
  const match = verifyToken(dataDir, session.token, SECRET);
  assert.ok(match, 'the returned session must be a working credential');
  assert.equal(match.owner, 'newbie@example.com');

  // ...and they can sign in again later with the password they chose.
  const login = await fetch(
    `${base()}/auth/login`,
    postJson({ email: 'newbie@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(login.status, 200);
});

test('a used invite is refused, and the message tells the person what to do', async () => {
  const { value } = await mintInvite();
  await fetch(
    `${base()}/join`,
    postJson({ token: value, email: 'first@example.com', password: 'a-perfectly-fine-password' })
  );
  const second = await fetch(
    `${base()}/join`,
    postJson({ token: value, email: 'second@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(second.status, 410);
  const body = await second.json();
  assert.equal(body.reason, 'already-used');
  assert.match(body.error, /already been used/i);
  assert.match(body.error, /ask for a new link/i);
});

test('no string on the invite path uses developer vocabulary', async () => {
  // DDR-193 §5 — the persona is a teammate who has never used git. "Paste your
  // token" tells them the product is not for them.
  const { value } = await mintInvite();
  const surfaces = [
    await (await fetch(`${base()}/join/${value}`)).text(),
    await (await fetch(`${base()}/join/inv_definitely-not-real`)).text(),
    await (
      await fetch(`${base()}/join`, postJson({ token: value, email: 'x@y.com', password: 'short' }))
    ).text(),
  ];
  for (const text of surfaces) {
    const lower = text.toLowerCase();
    for (const word of ['repository', 'repo ', 'github', 'oauth', 'bearer', 'crdt']) {
      assert.ok(!lower.includes(word), `"${word}" must not appear: ${text.slice(0, 200)}`);
    }
  }
});

test('a weak password does NOT burn the invite', async () => {
  const { value } = await mintInvite();
  const weak = await fetch(
    `${base()}/join`,
    postJson({ token: value, email: 'slow@example.com', password: 'short' })
  );
  assert.equal(weak.status, 400);

  const retry = await fetch(
    `${base()}/join`,
    postJson({ token: value, email: 'slow@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(retry.status, 201, 'the invite must survive a rejected password');
});

test('minting requires the admin Bearer; joining does not', async () => {
  const unauth = await fetch(`${base()}/admin/api/invites`, postJson({}));
  assert.equal(unauth.status, 401);

  const { value } = await mintInvite();
  // The join path is deliberately unauthenticated — the invitee has no
  // credential yet; the link IS the credential.
  assert.equal((await fetch(`${base()}/join/${value}`)).status, 200);
});

test('a revoked invite stops working immediately', async () => {
  const { value, invite } = await mintInvite();
  const revoke = await fetch(
    `${base()}/admin/api/invites/revoke`,
    postJson({ id: invite.id }, admin())
  );
  assert.equal(revoke.status, 200);

  const look = await fetch(`${base()}/join/${value}`);
  assert.equal(look.status, 410);
  assert.equal((await look.json()).reason, 'revoked');

  const redeem = await fetch(
    `${base()}/join`,
    postJson({ token: value, email: 'late@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(redeem.status, 410);
});

test('the admin listing shows status and never anything redeemable', async () => {
  const { value, invite } = await mintInvite({ email: 'kim@example.com' });
  await fetch(
    `${base()}/join`,
    postJson({ token: value, email: 'kim@example.com', password: 'a-perfectly-fine-password' })
  );
  const res = await fetch(`${base()}/admin/api/invites`, { headers: admin() });
  const { invites } = await res.json();
  const listed = invites.find((i) => i.id === invite.id);
  assert.equal(listed.status, 'used');
  assert.equal(listed.redeemedBy, 'kim@example.com');
  const serialized = JSON.stringify(invites);
  assert.ok(!serialized.includes(value), 'the listing must never contain a usable invite');
});

test('redeeming an invite is rate-limited like every other credential path', async () => {
  const attempts = [];
  for (let i = 0; i < 12; i++) {
    attempts.push(
      (
        await fetch(
          `${base()}/join`,
          postJson({ token: 'inv_wrong', email: 'a@b.com', password: 'a-perfectly-fine-password' })
        )
      ).status
    );
  }
  assert.ok(attempts.includes(429), `expected a 429 among ${attempts.join(',')}`);
});

// ---- the BROWSER path (2026-08-21) --------------------------------------
//
// The link is opened in a browser by a person, not fetched by a client. For
// the first year of this route that person saw the LOOK endpoint's JSON —
// `{"ok":true,"workspace":…}` — because the desktop deep-link client half of
// Cloud Phase 6 was never built. The browser door (Cloud Phase 25) makes the
// studio a page at `/`, so the landing page now redeems in the browser and
// sets the same session cookie `/studio/signin` does.

const asBrowser = { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };
const postForm = (fields, headers = {}) => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Sec-Fetch-Site': 'same-origin',
    ...asBrowser,
    ...headers,
  },
  body: new URLSearchParams(fields).toString(),
  redirect: 'manual',
});

test('a browser opening the link gets a welcome page with a form, not JSON', async () => {
  const { value } = await mintInvite({ email: 'filip@example.com' });
  const res = await fetch(`${base()}/join/${value}`, { headers: asBrowser });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.ok(!html.trimStart().startsWith('{'), 'must not be JSON');
  assert.match(html, /invited to acme\.cloud\.maude\.sh/i);
  assert.ok(html.includes('action="/join"'), 'the form posts to /join');
  assert.ok(html.includes('value="filip@example.com"'), 'a bound invite shows its address');
  assert.ok(html.includes('name="password"'));
  // The token is on the page ONLY as the hidden field, never in a link.
  assert.equal(html.split(value).length - 1, 1);

  // Looking in a browser does not consume the invite either.
  const again = await fetch(`${base()}/join/${value}`);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).ok, true);
});

test('an open invite asks the browser for an email; a bound one does not', async () => {
  const open = await mintInvite();
  const html = await (await fetch(`${base()}/join/${open.value}`, { headers: asBrowser })).text();
  assert.ok(html.includes('name="email"') && html.includes('required'), 'email field is required');
  assert.ok(!/<input[^>]*name="email"[^>]*readonly/.test(html));
});

test('submitting the form signs the person into the studio: cookie + redirect to /', async () => {
  const { value, invite } = await mintInvite({ email: 'filip@example.com' });
  const res = await fetch(
    `${base()}/join`,
    postForm({ token: value, email: 'filip@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  const cookie = res.headers.get('set-cookie') ?? '';
  const m = cookie.match(/maude_studio=([^;]+)/);
  assert.ok(m, `expected a maude_studio session cookie, got: ${cookie}`);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  // The cookie is a working session with a PROJECT role stored — browserSession
  // treats a token without one as no session at all.
  const match = verifyToken(dataDir, decodeURIComponent(m[1]), SECRET);
  assert.ok(match, 'the cookie must be a working credential');
  assert.equal(match.owner, 'filip@example.com');
  assert.equal(match.role, 'member');

  // Consumed — a second person with the same link gets the plain page.
  const second = await fetch(
    `${base()}/join`,
    postForm({ token: value, email: 'filip@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(second.status, 410);
  assert.match(await second.text(), /already been used/i);

  const listed = (
    await (await fetch(`${base()}/admin/api/invites`, { headers: admin() })).json()
  ).invites.find((i) => i.id === invite.id);
  assert.equal(listed.status, 'used');
});

test('a short password in the form comes back as the form with a sentence, invite intact', async () => {
  const { value } = await mintInvite({ email: 'filip@example.com' });
  const weak = await fetch(
    `${base()}/join`,
    postForm({ token: value, email: 'filip@example.com', password: 'short' })
  );
  assert.equal(weak.status, 400);
  const html = await weak.text();
  assert.ok(html.includes('action="/join"'), 'the form is shown again');
  assert.match(html, /at least 12 characters/i);

  const retry = await fetch(
    `${base()}/join`,
    postForm({ token: value, email: 'filip@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(retry.status, 303, 'the invite must survive a rejected password');
});

test('the API session minted by a JSON redeem carries a project role too', async () => {
  const { value } = await mintInvite();
  const redeem = await fetch(
    `${base()}/join`,
    postJson({ token: value, email: 'api@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(redeem.status, 201);
  const { token } = await redeem.json();
  assert.equal(verifyToken(dataDir, token, SECRET).role, 'member');
});

test("a cross-site form post cannot redeem into a visitor's browser", async () => {
  const { value } = await mintInvite({ email: 'filip@example.com' });
  const res = await fetch(
    `${base()}/join`,
    postForm(
      { token: value, email: 'filip@example.com', password: 'a-perfectly-fine-password' },
      { 'Sec-Fetch-Site': 'cross-site' }
    )
  );
  assert.equal(res.status, 403);
  // ...and the invite is untouched.
  assert.equal((await fetch(`${base()}/join/${value}`)).status, 200);
});

test('a dead link opened in a browser is a page in plain words, not JSON', async () => {
  const res = await fetch(`${base()}/join/inv_definitely-not-real`, { headers: asBrowser });
  assert.equal(res.status, 410);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /isn&#39;t valid/i);
  assert.ok(!html.includes('"ok"'));
});

// ---- security review 2026-08-21 (defender F1–F7, attacker F1–F5) ---------

test('F1: a mangled percent-escape in the link is a 410 page, and the hub is still up', async () => {
  // `decodeURIComponent('%E0')` throws; before the guard that throw left
  // `onRequest`, Hocuspocus rethrew it, and the PROCESS exited — one anonymous
  // GET, every collab socket gone.
  const res = await fetch(`${base()}/join/inv_ab%E0`, { headers: asBrowser });
  assert.equal(res.status, 410);
  assert.match(await res.text(), /isn&#39;t valid/);
  const api = await fetch(`${base()}/join/inv_%`);
  assert.equal(api.status, 410);
  assert.equal((await api.json()).reason, 'unknown');
  assert.equal((await fetch(`${base()}/health`)).status, 200, 'the hub must survive');
});

test('F2: under HUB_OIDC_MODE=strict the POST refuses both bodies — the provider is the only door', async () => {
  const { value } = await mintInvite({ email: 'filip@example.com' });
  process.env.HUB_OIDC_MODE = 'strict';
  try {
    const page = await (await fetch(`${base()}/join/${value}`, { headers: asBrowser })).text();
    assert.ok(!page.includes('name="password"'), 'the page shows no password form under strict');
    const form = await fetch(
      `${base()}/join`,
      postForm({ token: value, email: 'filip@example.com', password: 'a-perfectly-fine-password' })
    );
    assert.equal(form.status, 403);
    assert.ok(!(form.headers.get('set-cookie') ?? '').includes('maude_studio'));
    const json = await fetch(
      `${base()}/join`,
      postJson({ token: value, email: 'filip@example.com', password: 'a-perfectly-fine-password' })
    );
    assert.equal(json.status, 403);
    assert.equal((await json.json()).reason, 'password-refused-oidc-strict');
  } finally {
    delete process.env.HUB_OIDC_MODE;
  }
  // The invite is untouched — it was never the problem.
  assert.equal((await fetch(`${base()}/join/${value}`)).status, 200);
});

test('F3: the form gate fails CLOSED — same-site and header-less submits are refused, Origin rescues old engines', async () => {
  const { value } = await mintInvite({ email: 'filip@example.com' });
  const fields = {
    token: value,
    email: 'filip@example.com',
    password: 'a-perfectly-fine-password',
  };
  const bare = (extra) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...asBrowser, ...extra },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
  // same-site — every cloud tenant and the untrusted canvas origin qualify.
  assert.equal(
    (await fetch(`${base()}/join`, bare({ 'Sec-Fetch-Site': 'same-site' }))).status,
    403
  );
  // no Fetch-Metadata and no Origin — nothing vouches for the submit.
  assert.equal((await fetch(`${base()}/join`, bare({}))).status, 403);
  // no Fetch-Metadata, Origin of a stranger.
  assert.equal(
    (await fetch(`${base()}/join`, bare({ Origin: 'https://evil.example' }))).status,
    403
  );
  // Still unconsumed after three refused attempts.
  assert.equal((await fetch(`${base()}/join/${value}`)).status, 200);
  // A pre-Fetch-Metadata browser on the hub's own page sends Origin = publicUrl.
  const ok = await fetch(`${base()}/join`, bare({ Origin: 'https://acme.cloud.maude.sh' }));
  assert.equal(ok.status, 303);
});

test('F3b: a hub with no publicUrl accepts an Origin that matches the Host header', async () => {
  const { formOriginAllowed } = await import('../src/browser-auth.mjs');
  const req = (headers) => ({ headers });
  assert.equal(formOriginAllowed(req({ 'sec-fetch-site': 'same-origin' }), null), true);
  assert.equal(formOriginAllowed(req({ 'sec-fetch-site': 'none' }), null), true);
  assert.equal(formOriginAllowed(req({ 'sec-fetch-site': 'same-site' }), null), false);
  assert.equal(
    formOriginAllowed(req({ origin: 'http://hub.local:8080', host: 'hub.local:8080' }), null),
    true
  );
  assert.equal(
    formOriginAllowed(req({ origin: 'http://other.local', host: 'hub.local:8080' }), null),
    false
  );
  assert.equal(formOriginAllowed(req({ origin: 'null', host: 'hub.local' }), null), false);
  assert.equal(formOriginAllowed(req({}), null), false);
});

test('F4: a taken address is one neutral sentence, never the store\'s "already exists"', async () => {
  await fetch(
    `${base()}/join`,
    postJson({
      token: (await mintInvite()).value,
      email: 'taken@example.com',
      password: 'a-perfectly-fine-password',
    })
  );
  const { value } = await mintInvite();
  const form = await fetch(
    `${base()}/join`,
    postForm({ token: value, email: 'taken@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(form.status, 400);
  const html = await form.text();
  assert.ok(!/already exists/.test(html), html.slice(0, 300));
  assert.match(html, /can&#39;t be used with this invitation/);
  const json = await fetch(
    `${base()}/join`,
    postJson({ token: value, email: 'taken@example.com', password: 'a-perfectly-fine-password' })
  );
  assert.equal(json.status, 400);
  assert.ok(!/already exists/.test((await json.json()).error));
});

test('F5: the pages carry referrer/framing/CSP hardening, and the landing page opts out of Referer', async () => {
  const { value } = await mintInvite({ email: 'filip@example.com' });
  const res = await fetch(`${base()}/join/${value}`, { headers: asBrowser });
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.match(res.headers.get('content-security-policy') ?? '', /form-action 'self'/);
  assert.match(await res.text(), /<meta name="referrer" content="no-referrer">/);
  const dead = await fetch(`${base()}/join/inv_nope`, { headers: asBrowser });
  assert.equal(dead.headers.get('x-frame-options'), 'DENY');
});

test('F7: a bound invite submitted with another address comes back as the form, not a dead page', async () => {
  const { value } = await mintInvite({ email: 'filip@example.com' });
  const res = await fetch(
    `${base()}/join`,
    postForm({
      token: value,
      email: 'someone-else@example.com',
      password: 'a-perfectly-fine-password',
    })
  );
  assert.equal(res.status, 410);
  const html = await res.text();
  assert.ok(html.includes('action="/join"'), 'the form is shown again');
  assert.match(html, /sent to a different address/);
  assert.equal((await fetch(`${base()}/join/${value}`)).status, 200, 'invite untouched');
});

test('R2: the self-hosted sign-in form has the same login-CSRF gate as the invite form', async () => {
  const body = new URLSearchParams({
    email: 'x@example.com',
    password: 'whatever-it-is',
  }).toString();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', ...asBrowser };
  const blind = await fetch(`${base()}/studio/signin`, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
  });
  assert.equal(blind.status, 403);
  const sameSite = await fetch(`${base()}/studio/signin`, {
    method: 'POST',
    headers: { ...headers, 'Sec-Fetch-Site': 'same-site' },
    body,
    redirect: 'manual',
  });
  assert.equal(sameSite.status, 403);
  // An honest submit reaches the password check (and fails it — no such user).
  const own = await fetch(`${base()}/studio/signin`, {
    method: 'POST',
    headers: { ...headers, 'Sec-Fetch-Site': 'same-origin' },
    body,
    redirect: 'manual',
  });
  assert.equal(own.status, 401);
});

test('R2-1: a malformed session cookie on any door is "no session", not a hub crash', async () => {
  const { cookieValue } = await import('../src/browser-auth.mjs');
  assert.equal(cookieValue({ headers: { cookie: 'maude_studio=%E0' } }, 'maude_studio'), null);
  assert.equal(
    cookieValue({ headers: { cookie: 'a=1; maude_studio=ok%20x' } }, 'maude_studio'),
    'ok x'
  );
  const bad = { Cookie: 'maude_studio=%E0', ...asBrowser };
  const out = await fetch(`${base()}/auth/browser/signout`, {
    method: 'POST',
    headers: bad,
    redirect: 'manual',
  });
  assert.ok([302, 303].includes(out.status), `signout answered ${out.status}`);
  const sess = await fetch(`${base()}/auth/session`, { headers: bad });
  assert.notEqual(sess.status, 500);
  assert.equal((await fetch(`${base()}/health`)).status, 200, 'the hub must survive');
});

// Plan T20 — the invite names the way into the desktop app too: the same
// address and email, in the app's own words. Escaped like every other value.
test('the join page tells a desktop user where to sign in', () => {
  const html = joinPage({
    token: 'inv_x',
    workspace: 'https://design.acme.com',
    email: null,
    env: {},
  });
  assert.match(html, /Open a project you were invited to/);
  assert.match(html, /https:\/\/design\.acme\.com/);
  const hostile = joinPage({
    token: 'inv_x',
    workspace: 'https://x.test/"><script>',
    email: null,
    env: {},
  });
  assert.doesNotMatch(hostile, /<script>/);
});
