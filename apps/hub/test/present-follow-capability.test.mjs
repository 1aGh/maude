// S3.7c — cloud followers: a receive-only `follow` capability + canvas-only
// proxy forwarding (lead decision `v2-lead-cloud-follow-capability`).
//
// In a cell the follower frame used the embed's read-only token, and DDR-247
// refuses every collab upgrade carrying one — so a cloud follower never heard
// `present` / `watching`. The follower now asks `/_config?follow=1&canvas=<rel>`
// and gets a capability that opens exactly that canvas's room, receive-only;
// an embed token is still refused. A canvas-only session (a Can view grant on A)
// is forwarded to the studio with its claim instead of 401'd at the door.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { followAskOf, followRelOf, followRoomPath } from '../src/follow-capability.mjs';
import { mintRenderToken, verifyRenderToken } from '../src/render-token.mjs';
import { createStudioProxy, INJECTED_HEADER_PREFIX } from '../src/studio-proxy.mjs';

const H = INJECTED_HEADER_PREFIX;
const SECRET = 's3-7c-secret';
const PROJECT = 'local';
const CANVAS_ORIGIN = 'https://canvas-alligators.cloud.maude.sh';
const A = 'ui/a.tsx';
const B = 'ui/canary-b-zx.tsx';
const NOPE = 'ui/nope.tsx';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const decodeClaim = (v) => JSON.parse(Buffer.from(v, 'base64url').toString('utf8'));

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    headersSent: false,
    preset: {},
    setHeader(name, value) {
      this.preset[String(name).toLowerCase()] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      if (body) this.body = body;
    },
    destroy() {},
  };
}

function fakeSocket() {
  const written = [];
  return {
    written,
    write: (s) => written.push(s),
    destroy() {
      this.destroyed = true;
    },
    on() {},
  };
}

/** The proxy with the REAL mint/verify pair server.mjs wires (follow passed through). */
function makeProxy() {
  const forwarded = [];
  const proxy = createStudioProxy({
    upstream: () => ({ ok: true, port: 4399 }),
    canvasUpstream: () => ({ ok: true, port: 4400 }),
    publicUrl: 'https://alligators.cloud.maude.sh',
    env: { MAUDE_PUBLIC_CANVAS_ORIGIN: CANVAS_ORIGIN },
    hash: sha,
    mintCanvasToken: (session, { readOnly = false, follow = null } = {}) =>
      mintRenderToken({
        secret: SECRET,
        project: PROJECT,
        subject: session.email,
        role: readOnly ? 'viewer' : session.role,
        readOnly,
        follow,
      }),
    mintRenderToken: () => 'render-cap',
    forward: async (args) => {
      forwarded.push(args);
      args.response.writeHead(200, {});
      args.response.end('ok');
    },
    forwardUpgrade: (args) => forwarded.push({ upgrade: true, ...args }),
  });
  return { proxy, forwarded };
}

const verifyToken = (t) => verifyRenderToken({ secret: SECRET, token: t, project: PROJECT });

/** A Can view person on the project. */
const VIEWER = {
  email: 'v@b.c',
  role: 'observer',
  access: { v: 1, role: 'observer' },
  readOnly: true,
  sessionKey: 'kv',
};
/** A canvas-only session: Can view on A, nothing else (browserSession's canvas-only shape). */
const A_ONLY = {
  email: 'a@b.c',
  role: null,
  access: { v: 1, role: null, grants: [{ c: A, r: 'observer' }] },
  readOnly: true,
  canvasOnly: true,
  sessionKey: 'ka',
};

async function config(proxy, forwarded, session, url) {
  const response = fakeResponse();
  await proxy.handle({
    request: { headers: {}, url },
    response,
    pathname: '/_config',
    method: 'GET',
    session,
  });
  return { response, headers: forwarded.at(-1)?.headers ?? null };
}

function upgrade(proxy, url) {
  const socket = fakeSocket();
  proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket', origin: CANVAS_ORIGIN }, url },
    socket,
    head: null,
    verifyToken,
  });
  return socket;
}

const followUrl = (rel) => `/_config?follow=1&canvas=${encodeURIComponent(rel)}`;

describe('the follow capability', () => {
  test('a Can view follower is minted a follow capability for A: read-only, A only, no role', async () => {
    const { proxy, forwarded } = makeProxy();
    const { headers } = await config(proxy, forwarded, VIEWER, followUrl(A));
    const v = verifyToken(headers[`${H}canvas-token`]);
    assert.equal(v.ok, true);
    assert.equal(v.follow, A);
    assert.equal(v.readOnly, true);
    assert.equal(v.role, 'observer');
    assert.deepEqual(v.grants, []);
  });

  test('it joins A’s room only — receive-only, canvas realm, as a canvas-only observer of A', async () => {
    const { proxy, forwarded } = makeProxy();
    const { headers } = await config(proxy, forwarded, VIEWER, followUrl(A));
    const t = headers[`${H}canvas-token`];
    const socket = upgrade(proxy, `/_ws/collab/ui-a?t=${encodeURIComponent(t)}`);
    assert.equal(socket.written.length, 0, socket.written.join(''));
    const up = forwarded.at(-1);
    assert.equal(up.upgrade, true);
    assert.equal(up.headers[`${H}collab-follow`], '1');
    assert.equal(up.headers[`${H}collab-realm`], 'canvas');
    assert.equal(up.headers[`${H}readonly`], '1');
    assert.deepEqual(decodeClaim(up.headers[`${H}access`]), {
      v: 1,
      role: null,
      grants: [{ c: A, r: 'observer' }],
    });
  });

  test('it cannot follow canvas B: the same refusal as a room that does not exist', async () => {
    const { proxy, forwarded } = makeProxy();
    const { headers } = await config(proxy, forwarded, VIEWER, followUrl(A));
    const t = encodeURIComponent(headers[`${H}canvas-token`]);
    const n = forwarded.length;
    const b = upgrade(proxy, `/_ws/collab/ui-canary-b-zx?t=${t}`);
    const nope = upgrade(proxy, `/_ws/collab/ui-nope?t=${t}`);
    assert.equal(forwarded.length, n);
    assert.match(b.written.join(''), /403/);
    assert.deepEqual(b.written, nope.written);
  });

  test('a canvas-only session on A is minted for A; asking for B looks exactly like a missing canvas', async () => {
    const { proxy, forwarded } = makeProxy();
    const a = await config(proxy, forwarded, A_ONLY, followUrl(A));
    assert.equal(verifyToken(a.headers[`${H}canvas-token`]).follow, A);
    const b = await config(proxy, forwarded, A_ONLY, followUrl(B));
    const nope = await config(proxy, forwarded, A_ONLY, followUrl(NOPE));
    assert.equal(b.headers[`${H}canvas-token`], undefined);
    assert.equal(nope.headers[`${H}canvas-token`], undefined);
    assert.equal(b.response.statusCode, nope.response.statusCode);
  });

  // p8-e2e-link-viewer (decision v2-p8-canvas-only-browser-opens-via-follow-capability) — the browser
  // shell of a canvas-only session opens each canvas it holds through this ask.
  test('a canvas-only session: A’s capability is A only; a plain or malformed ask gets nothing', async () => {
    const { proxy, forwarded } = makeProxy();
    const a = verifyToken(
      (await config(proxy, forwarded, A_ONLY, followUrl(A))).headers[`${H}canvas-token`]
    );
    assert.equal(a.ok, true);
    assert.equal(a.follow, A);
    assert.equal(a.readOnly, true);
    assert.deepEqual(a.grants, []);
    for (const url of [
      '/_config',
      '/_config?embed=1',
      '/_config?follow=1',
      `/_config?follow=1&canvas=${encodeURIComponent('../ui/a.tsx')}`,
      `/_config?follow=1&canvas=${encodeURIComponent('/ui/a.tsx')}`,
      `/_config?follow=1&canvas=${encodeURIComponent('_draw/x.tsx')}`,
      `/_config?follow=1&canvas=${encodeURIComponent(A)}&canvas=${encodeURIComponent(B)}`,
      `/_config?follow=1&canvas=${encodeURIComponent(B)}`,
    ]) {
      const { headers } = await config(proxy, forwarded, A_ONLY, url);
      assert.equal(headers[`${H}canvas-token`], undefined, url);
      assert.equal(headers[`${H}render-token`], undefined, url);
    }
  });

  test('a follow ask never falls back to a wider capability', async () => {
    const { proxy, forwarded } = makeProxy();
    for (const url of [
      '/_config?follow=1',
      '/_config?follow=1&embed=1',
      `/_config?follow=1&canvas=${encodeURIComponent('../x.tsx')}`,
      `/_config?follow=1&canvas=${encodeURIComponent('_draw/x.tsx')}`,
      `/_config?follow=1&canvas=${encodeURIComponent(A)}&canvas=${encodeURIComponent(B)}`,
    ]) {
      const { headers } = await config(proxy, forwarded, VIEWER, url);
      assert.equal(headers[`${H}canvas-token`], undefined, url);
    }
  });

  test('an embed token is still refused on collab (DDR-247 unchanged); its HMR socket stays', async () => {
    const { proxy, forwarded } = makeProxy();
    const { headers } = await config(proxy, forwarded, VIEWER, '/_config?embed=1');
    const t = encodeURIComponent(headers[`${H}canvas-token`]);
    assert.equal(verifyToken(decodeURIComponent(t)).follow, null);
    const n = forwarded.length;
    assert.match(upgrade(proxy, `/_ws/collab/ui-a?t=${t}`).written.join(''), /403/);
    assert.equal(forwarded.length, n);
    upgrade(proxy, `/_ws?t=${t}`);
    assert.equal(forwarded.length, n + 1);
    assert.equal(forwarded.at(-1).headers[`${H}collab-follow`], undefined);
  });

  test('a follow capability writes nothing over HTTP, and its reads are scoped to A', async () => {
    const { proxy, forwarded } = makeProxy();
    const { headers } = await config(proxy, forwarded, VIEWER, followUrl(A));
    const t = encodeURIComponent(headers[`${H}canvas-token`]);
    const w = fakeResponse();
    await proxy.handleCanvas({
      request: { headers: { origin: CANVAS_ORIGIN }, url: `/_api/comments/c_1/reply?t=${t}` },
      response: w,
      pathname: '/_api/comments/c_1/reply',
      method: 'POST',
      verifyToken,
    });
    assert.equal(w.statusCode, 403);
    const r = fakeResponse();
    const n = forwarded.length;
    await proxy.handleCanvas({
      request: { headers: {}, url: `/_canvas-shell.html?canvas=ui/a.tsx&t=${t}` },
      response: r,
      pathname: '/_canvas-shell.html',
      method: 'GET',
      verifyToken,
    });
    assert.equal(forwarded.length, n + 1);
    assert.deepEqual(decodeClaim(forwarded.at(-1).headers[`${H}access`]), {
      v: 1,
      role: null,
      grants: [{ c: A, r: 'observer' }],
    });
    // planted as the embed's read-only cookie, never over the designer's full one
    assert.match(String(r.preset['set-cookie']), /^maude_canvas_embed=/);
  });

  test('the follow claim is signed and must name one canvas', () => {
    assert.throws(() => mintRenderToken({ secret: SECRET, project: PROJECT, follow: '../x.tsx' }));
    const t = mintRenderToken({
      secret: SECRET,
      project: PROJECT,
      subject: 's',
      role: 'owner',
      follow: A,
    });
    const v = verifyToken(t);
    assert.equal(v.role, 'observer'); // the project role never rides a follow capability
    assert.equal(v.readOnly, true);
    // a tampered body fails the signature
    const [body, mac] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), f: B })
    ).toString('base64url');
    assert.equal(verifyToken(`${forged}.${mac}`).ok, false);
  });

  test('grammar: followRelOf / followAskOf / followRoomPath', () => {
    assert.equal(followRelOf(A), A);
    for (const bad of [
      '',
      'x',
      'a/../b.tsx',
      '_x/a.tsx',
      'a\\b.tsx',
      'a:b.tsx',
      'a%2fb.tsx',
      'a/.tsx/',
    ]) {
      assert.equal(followRelOf(bad), null, bad);
    }
    assert.deepEqual(followAskOf({ url: '/_config' }), { asked: false, rel: null });
    assert.deepEqual(followAskOf({ url: followUrl(A) }), { asked: true, rel: A });
    assert.equal(followRoomPath('ui/Deck One.tsx'), '/_ws/collab/ui-deck_one');
  });
});

describe('canvas-only sessions at the studio door', () => {
  test('a canvas-only session reaches the follower page, forwarded with its claim (not 401)', async () => {
    const { proxy, forwarded } = makeProxy();
    const response = fakeResponse();
    await proxy.handle({
      request: { headers: { 'x-maude-access': 'forged' }, url: '/?open=ui/a.tsx&present=follow' },
      response,
      pathname: '/',
      method: 'GET',
      session: A_ONLY,
    });
    assert.equal(response.statusCode, 200);
    const h = forwarded.at(-1).headers;
    assert.deepEqual(decodeClaim(h[`${H}access`]), A_ONLY.access);
    assert.equal(h[`${H}role`], 'observer');
    assert.equal(h[`${H}readonly`], '1');
    // no project-wide capability: neither the canvas token nor the render token
    assert.equal(h[`${H}canvas-token`], undefined);
    assert.equal(h[`${H}render-token`], undefined);
  });

  test('a canvas-only member grant still projects read-only (no project role)', async () => {
    const { proxy, forwarded } = makeProxy();
    const member = { ...A_ONLY, access: { v: 1, role: null, grants: [{ c: A, r: 'member' }] } };
    await proxy.handle({
      request: { headers: {}, url: '/_index-data' },
      response: fakeResponse(),
      pathname: '/_index-data',
      method: 'GET',
      session: member,
    });
    const h = forwarded.at(-1).headers;
    assert.equal(h[`${H}role`], 'member');
    assert.equal(h[`${H}readonly`], '1');
  });

  test('its shell socket is forwarded with the claim', () => {
    const { proxy, forwarded } = makeProxy();
    const socket = fakeSocket();
    proxy.handleUpgrade({
      request: {
        headers: { upgrade: 'websocket', origin: 'https://alligators.cloud.maude.sh' },
        url: '/_ws/collab/ui-a',
      },
      socket,
      head: null,
      session: A_ONLY,
    });
    assert.equal(socket.written.length, 0);
    assert.deepEqual(decodeClaim(forwarded.at(-1).headers[`${H}access`]), A_ONLY.access);
  });

  test('a role-null session without a canvas-only claim is still no session', async () => {
    const { proxy, forwarded } = makeProxy();
    for (const session of [
      { email: 'x@b.c' },
      { email: 'x@b.c', role: null, canvasOnly: true, access: { v: 1, role: null } },
      { email: 'x@b.c', role: null, access: A_ONLY.access }, // not marked canvas-only
    ]) {
      const response = fakeResponse();
      await proxy.handle({
        request: { headers: {}, url: '/' },
        response,
        pathname: '/',
        method: 'GET',
        session,
      });
      assert.equal(response.statusCode, 401);
      const socket = fakeSocket();
      proxy.handleUpgrade({
        request: { headers: { origin: 'https://alligators.cloud.maude.sh' }, url: '/_ws' },
        socket,
        head: null,
        session,
      });
      assert.match(socket.written.join(''), /401/);
    }
    assert.equal(forwarded.length, 0);
  });
});
