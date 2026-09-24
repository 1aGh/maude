// Cloud Phase 27 A2/A3/A4 — the proxy is the authority, and it fails closed.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  canvasTokenTtlMs,
  mintRenderToken,
  RENDER_TOKEN_TTL_MS,
  verifyRenderToken,
} from '../src/render-token.mjs';
import {
  createStudioProxy,
  INJECTED_HEADER_PREFIX,
  sessionKeyFor,
  upstreamHeaders,
} from '../src/studio-proxy.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    headersSent: false,
    // Set BEFORE writeHead and merged by Node at write time — how the canvas
    // origin plants its capability cookie on the shell document without
    // reaching into the forwarder.
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
    destroy() {
      this.destroyed = true;
    },
  };
}

function makeProxy({ ok = true, port = 4399, ...rest } = {}) {
  const forwarded = [];
  const proxy = createStudioProxy({
    upstream: () => ({ ok, port }),
    canvasUpstream: () => ({ ok, port: port + 1 }),
    publicUrl: 'https://alligators.cloud.maude.sh',
    hash: sha,
    forward: async (args) => {
      forwarded.push(args);
      args.response.writeHead(200, {});
      args.response.end('ok');
    },
    forwardUpgrade: (args) => forwarded.push({ upgrade: true, ...args }),
    ...rest,
  });
  return { proxy, forwarded };
}

// ---------------------------------------------------------------- A4: closed

test('no session refuses before it reveals anything about the route table', async () => {
  const { proxy, forwarded } = makeProxy();
  const response = fakeResponse();
  await proxy.handle({
    request: { headers: {}, url: '/_config' },
    response,
    pathname: '/_config',
    method: 'GET',
    session: null,
  });
  assert.equal(response.statusCode, 401);
  assert.equal(forwarded.length, 0);
  // Same answer for a route that does not exist — an unauthenticated caller
  // must not be able to tell the difference.
  const r2 = fakeResponse();
  await proxy.handle({
    request: { headers: {}, url: '/_api/nope' },
    response: r2,
    pathname: '/_api/nope',
    method: 'GET',
    session: null,
  });
  assert.equal(r2.statusCode, 401);
});

test('a session with no role is not a session', async () => {
  const { proxy } = makeProxy();
  const response = fakeResponse();
  await proxy.handle({
    request: { headers: {}, url: '/_config' },
    response,
    pathname: '/_config',
    method: 'GET',
    session: { email: 'a@b.c' },
  });
  assert.equal(response.statusCode, 401);
});

test('every mutating route 403s for a viewer, with the promised sentence', async () => {
  const { proxy, forwarded } = makeProxy();
  for (const [method, path] of [
    ['POST', '/_api/edit-text'],
    ['POST', '/_api/insert-element'],
    ['PUT', '/_api/annotations'],
    ['POST', '/_api/git/commit'],
    ['POST', '/_api/asset'],
  ]) {
    const response = fakeResponse();
    await proxy.handle({
      request: { headers: {}, url: path },
      response,
      pathname: path,
      method,
      session: { email: 'v@b.c', role: 'viewer' },
    });
    assert.equal(response.statusCode, 403, `${method} ${path} was not refused`);
    assert.match(JSON.parse(response.body).error, /look at this project, comment and download/);
  }
  assert.equal(forwarded.length, 0);
});

test('an unclassified route is 404, not 403 — a refusal is a map', async () => {
  const { proxy } = makeProxy();
  const response = fakeResponse();
  await proxy.handle({
    request: { headers: {}, url: '/_api/next-phases-route' },
    response,
    pathname: '/_api/next-phases-route',
    method: 'POST',
    session: { email: 'o@b.c', role: 'owner' },
  });
  assert.equal(response.statusCode, 404);
});

test('a dead upstream is 503 with a retry, never a 500', async () => {
  const { proxy } = makeProxy({ ok: false });
  const response = fakeResponse();
  await proxy.handle({
    request: { headers: {}, url: '/_config' },
    response,
    pathname: '/_config',
    method: 'GET',
    session: { email: 'o@b.c', role: 'owner' },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['retry-after'], '2');
  assert.match(JSON.parse(response.body).error, /Your work is safe/);
});

// ------------------------------------------------------- A3: the role travels

test('the vouched role is injected on every forwarded request', async () => {
  const { proxy, forwarded } = makeProxy();
  await proxy.handle({
    request: { headers: {}, url: '/_config' },
    response: fakeResponse(),
    pathname: '/_config',
    method: 'GET',
    session: { email: 'm@b.c', role: 'member', sessionKey: 'abc123' },
  });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}role`], 'member');
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}user`], 'm@b.c');
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}session`], 'abc123');
});

test('a client CANNOT speak the injected headers', () => {
  const out = upstreamHeaders(
    {
      'x-maude-role': 'owner',
      'X-Maude-Role': 'owner',
      'x-maude-session': 'someone-elses',
      'x-maude-user': 'ceo@company.com',
      accept: 'text/html',
    },
    { role: 'viewer', user: 'v@b.c', sessionKey: 'mine', publicUrl: 'https://p.example' }
  );
  assert.equal(out['x-maude-role'], 'viewer');
  assert.equal(out['x-maude-user'], 'v@b.c');
  assert.equal(out['x-maude-session'], 'mine');
  assert.equal(out.accept, 'text/html');
  // Nothing survived with an owner value under any casing.
  assert.equal(Object.entries(out).filter(([, v]) => v === 'owner').length, 0);
});

test('the render token is injected separately from the canvas token (DDR-230 §c)', () => {
  // The member's own canvas token can be write-capable (their project role);
  // the render token the cell forwards to maude-render is minted viewer-only.
  // upstreamHeaders must carry both as distinct injected headers, and — like
  // every x-maude-* header — refuse a client-supplied one (property 2).
  const out = upstreamHeaders(
    { 'x-maude-render-token': 'FORGED', 'x-maude-canvas-token': 'ALSO-FORGED' },
    { role: 'owner', publicUrl: null, canvasToken: 'canvas-cap', renderToken: 'render-cap' }
  );
  assert.equal(out['x-maude-canvas-token'], 'canvas-cap');
  assert.equal(out['x-maude-render-token'], 'render-cap');
  assert.notEqual(
    out['x-maude-render-token'],
    'FORGED',
    'a forged inbound render token is stripped'
  );
});

test('hop-by-hop headers are not forwarded', () => {
  const out = upstreamHeaders(
    {
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
    },
    { role: 'owner', publicUrl: null }
  );
  assert.equal(out.connection, undefined);
  assert.equal(out['transfer-encoding'], undefined);
  assert.equal(out['content-type'], 'application/json');
});

// --------------------------------------------------------- D4: public identity

test('the Host the studio sees comes from configuration, not from the request', () => {
  const out = upstreamHeaders(
    { host: 'internal-tunnel-7f3a.cfargotunnel.com' },
    { role: 'owner', publicUrl: 'https://alligators.cloud.maude.sh' }
  );
  assert.equal(out.host, 'alligators.cloud.maude.sh');
});

test('a foreign Host header cannot reach the studio even unconfigured', () => {
  const out = upstreamHeaders({ host: 'evil.example' }, { role: 'owner', publicUrl: null });
  assert.equal(out.host, undefined);
});

// ------------------------------------------------------------ D3: the session

test('the session key is stable, per-member, and says nothing', () => {
  const a = sessionKeyFor('alligators', 'a@b.c', sha);
  const b = sessionKeyFor('alligators', 'other@b.c', sha);
  assert.equal(a, sessionKeyFor('alligators', 'a@b.c', sha));
  assert.notEqual(a, b);
  assert.equal(a.length, 16);
  assert.ok(!a.includes('@'), 'a filename-bound key must not carry an address');
});

// -------------------------------------------------------- the canvas lane

test('the canvas lane is capability-gated, and a bare write is refused', async () => {
  const { proxy, forwarded } = makeProxy();
  // A write with no Origin and no explicit `?t=` never reaches auth — an
  // ambient cookie is not proof of intent (the CSRF gate's non-browser rule).
  const post = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html' },
    response: post,
    pathname: '/_canvas-shell.html',
    method: 'POST',
    verifyToken: () => ({ ok: true }),
  });
  assert.equal(post.statusCode, 401);

  const bad = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html' },
    response: bad,
    pathname: '/_canvas-shell.html',
    method: 'GET',
    verifyToken: () => ({ ok: false }),
  });
  assert.equal(bad.statusCode, 401);
  assert.equal(forwarded.length, 0);

  const good = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html?t=x' },
    response: good,
    pathname: '/_canvas-shell.html',
    method: 'GET',
    verifyToken: () => ({ ok: true }),
  });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}role`], 'viewer');
});

test('the canvas lane strips the prefix its ORIGIN carries, and refuses another', async () => {
  // The fleet's shared `canvas.<zone>` hostname puts the tenant in the path.
  const { proxy, forwarded } = makeProxy();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/alligators/_canvas-runtime/react.js?t=x' },
    response: fakeResponse(),
    pathname: '/alligators/_canvas-runtime/react.js',
    method: 'GET',
    pathPrefix: '/alligators',
    verifyToken: () => ({ ok: true }),
  });
  assert.equal(forwarded.at(-1).path, '/_canvas-runtime/react.js?t=x');

  const foreign = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/someone-else/_canvas-shell.html?t=x' },
    response: foreign,
    pathname: '/someone-else/_canvas-shell.html',
    method: 'GET',
    pathPrefix: '/alligators',
    verifyToken: () => ({ ok: true }),
  });
  assert.equal(foreign.statusCode, 404);
});

test('a per-tenant canvas origin has NO path prefix, and is not made to have one', async () => {
  // The regression this pins: deriving the prefix from MAUDE_TENANT_ID, which
  // exists in BOTH deployment shapes. It made every canvas request 404 on a
  // per-tenant origin — the shell, the module, the runtime and every asset —
  // i.e. exactly the grey boxes this phase exists to fix.
  const { proxy, forwarded } = makeProxy({ env: { MAUDE_TENANT_ID: 'alligators' } });
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html?t=x' },
    response: fakeResponse(),
    pathname: '/_canvas-shell.html',
    method: 'GET',
    pathPrefix: '',
    verifyToken: () => ({ ok: true }),
  });
  assert.equal(forwarded.at(-1).path, '/_canvas-shell.html?t=x');
});

// ------------------------------------------------- the canvas WRITE lane
// (RCA: cloud canvas edits never synced — the iframe's only persistence path
// for annotations / artboard layout / media / comment replies is HTTP on this
// origin, and a blanket 405 killed every one of those writes silently while
// the collab WS kept cursors crossing.)

const CANVAS_ORIGIN = 'https://canvas-alligators.cloud.maude.sh';

function makeWriteProxy() {
  return makeProxy({
    env: { MAUDE_PUBLIC_CANVAS_ORIGIN: CANVAS_ORIGIN },
  });
}

/** owner-role capability under `own`, roleless legacy capability under `cap`. */
function writeVerify(t) {
  if (t === 'own') return { ok: true, role: 'owner', subject: 'o@b.c' };
  if (t === 'cap') return { ok: true, subject: 'legacy@b.c' };
  return { ok: false };
}

test('an owner capability writes the canvas-authored lanes at its own role', async () => {
  const { proxy, forwarded } = makeWriteProxy();
  for (const [method, path] of [
    ['PUT', '/_api/annotations'],
    ['PATCH', '/_api/canvas-meta'],
    ['POST', '/_api/asset'],
    ['POST', '/_api/comments/abc123/reply'],
  ]) {
    const r = fakeResponse();
    await proxy.handleCanvas({
      request: {
        headers: { origin: CANVAS_ORIGIN, cookie: 'maude_canvas=own' },
        // DDR-242 — the shell appends the frame's capability to every write.
        url: `${path}?t=own`,
      },
      response: r,
      pathname: path,
      method,
      verifyToken: writeVerify,
    });
    assert.equal(r.statusCode, 200, `${method} ${path} must be forwarded`);
    const h = forwarded.at(-1).headers;
    assert.equal(h[`${INJECTED_HEADER_PREFIX}role`], 'owner');
    assert.equal(h[`${INJECTED_HEADER_PREFIX}readonly`], '0');
    assert.equal(h[`${INJECTED_HEADER_PREFIX}user`], 'o@b.c');
  }
});

test('a roleless capability stays on the viewer floor: comment yes, annotate no', async () => {
  const { proxy, forwarded } = makeWriteProxy();
  // The single write a viewer holds — a comment reply — passes, read-only.
  const reply = fakeResponse();
  await proxy.handleCanvas({
    request: {
      headers: { origin: CANVAS_ORIGIN, cookie: 'maude_canvas=cap' },
      url: '/_api/comments/abc123/reply?t=cap',
    },
    response: reply,
    pathname: '/_api/comments/abc123/reply',
    method: 'POST',
    verifyToken: writeVerify,
  });
  assert.equal(reply.statusCode, 200);
  assert.equal(forwarded.at(-1).headers[`${INJECTED_HEADER_PREFIX}readonly`], '1');

  // An annotation is versioned with the design — the role matrix files it with
  // edit, and this door gives the same 403 sentence the shell door does.
  const annotate = fakeResponse();
  await proxy.handleCanvas({
    request: {
      headers: { origin: CANVAS_ORIGIN, cookie: 'maude_canvas=cap' },
      url: '/_api/annotations?t=cap',
    },
    response: annotate,
    pathname: '/_api/annotations',
    method: 'PUT',
    verifyToken: writeVerify,
  });
  assert.equal(annotate.statusCode, 403);
  assert.match(JSON.parse(annotate.body).error, /look at this project, comment and download/);
});

test('a foreign Origin cannot ride the ambient capability cookie into a write', async () => {
  // The CSWSH gate's HTTP twin: every origin on the zone is same-SITE, so
  // SameSite never expresses this boundary — the proxy must.
  const { proxy, forwarded } = makeWriteProxy();
  const r = fakeResponse();
  await proxy.handleCanvas({
    request: {
      headers: { origin: 'https://evil.cloud.maude.sh', cookie: 'maude_canvas=own' },
      url: '/_api/annotations',
    },
    response: r,
    pathname: '/_api/annotations',
    method: 'PUT',
    verifyToken: writeVerify,
  });
  assert.equal(r.statusCode, 403);
  assert.equal(forwarded.length, 0);
});

test('the project shell is the other legitimate writer', async () => {
  const { proxy, forwarded } = makeWriteProxy();
  const r = fakeResponse();
  await proxy.handleCanvas({
    request: {
      // publicUrl in makeProxy — the tenant's own shell origin.
      headers: { origin: 'https://alligators.cloud.maude.sh', cookie: 'maude_canvas=own' },
      url: '/_api/annotations?t=own',
    },
    response: r,
    pathname: '/_api/annotations',
    method: 'PUT',
    verifyToken: writeVerify,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(forwarded.at(-1).headers[`${INJECTED_HEADER_PREFIX}readonly`], '0');
});

test('an embed origin may frame the studio but never writes through the canvas door (DDR-242)', async () => {
  // MAUDE_EMBED_ORIGINS is a FRAMING list. If it ever leaked into the write
  // allowlist beside MAUDE_EXTRA_SHELL_ORIGINS, the app embedding a read-only
  // view would hold the member's write capability — the whole reason the two
  // lists are separate.
  const { proxy, forwarded } = makeProxy({
    env: {
      MAUDE_PUBLIC_CANVAS_ORIGIN: CANVAS_ORIGIN,
      MAUDE_EMBED_ORIGINS: 'https://orbit.studyfi.com',
    },
  });
  const r = fakeResponse();
  await proxy.handleCanvas({
    request: {
      headers: { origin: 'https://orbit.studyfi.com', cookie: 'maude_canvas=own' },
      url: '/_api/annotations?t=own',
    },
    response: r,
    pathname: '/_api/annotations',
    method: 'PUT',
    verifyToken: writeVerify,
  });
  assert.equal(r.statusCode, 403);
  assert.match(JSON.parse(r.body).error, /cross-origin canvas write refused/);
  assert.equal(forwarded.length, 0);
});

// ---------------------------------------------- DDR-242: the embed is read-only

test('the embed view is handed a READ-ONLY capability; the studio keeps its own', async () => {
  const minted = [];
  const { proxy, forwarded } = makeProxy({
    mintCanvasToken: (_session, opts) => {
      minted.push(opts ?? null);
      return opts?.readOnly ? 'ro-cap' : 'full-cap';
    },
  });
  const session = { email: 'o@b.c', role: 'owner', sessionKey: 'k' };
  for (const url of ['/_config?embed=1', '/_config']) {
    await proxy.handle({
      request: { headers: {}, url },
      response: fakeResponse(),
      pathname: '/_config',
      method: 'GET',
      session,
    });
  }
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}canvas-token`], 'ro-cap');
  assert.equal(forwarded[1].headers[`${INJECTED_HEADER_PREFIX}canvas-token`], 'full-cap');
  assert.deepEqual(minted, [{ readOnly: true }, null]);
});

test('a read-only capability writes NOTHING at the canvas door — not even a comment', async () => {
  const roVerify = (t) =>
    t === 'ro' ? { ok: true, role: 'viewer', subject: 'o@b.c', readOnly: true } : writeVerify(t);
  for (const [method, path] of [
    ['PUT', '/_api/annotations'],
    ['PATCH', '/_api/canvas-meta'],
    ['POST', '/_api/asset'],
    ['POST', '/_api/comments/c_1/reply'],
    ['DELETE', '/_api/annotations'],
  ]) {
    const { proxy, forwarded } = makeWriteProxy();
    const r = fakeResponse();
    await proxy.handleCanvas({
      request: { headers: { origin: CANVAS_ORIGIN }, url: `${path}?t=ro` },
      response: r,
      pathname: path,
      method,
      verifyToken: roVerify,
    });
    assert.equal(r.statusCode, 403, `${method} ${path}`);
    assert.equal(JSON.parse(r.body).reason, 'read-only');
    assert.equal(forwarded.length, 0);
  }
});

test('a write or socket never rides the ambient cookie — even a FULL one (DDR-242)', async () => {
  // The chain the re-review found: the designer's own studio tab plants a
  // full capability as `maude_canvas`; the embed's canvas is same-site with
  // orbit, so that cookie reaches the embedded frame too. Canvas code there
  // omits `?t=` to fall back on it. It must get nothing.
  for (const [method, path] of [
    ['PUT', '/_api/annotations'],
    ['POST', '/_api/asset'],
    ['POST', '/_api/comments/c_1/reply'],
  ]) {
    const { proxy, forwarded } = makeWriteProxy();
    const r = fakeResponse();
    await proxy.handleCanvas({
      request: { headers: { origin: CANVAS_ORIGIN, cookie: 'maude_canvas=own' }, url: path },
      response: r,
      pathname: path,
      method,
      verifyToken: writeVerify,
    });
    assert.equal(r.statusCode, 401, `${method} ${path}`);
    assert.equal(forwarded.length, 0);
  }
  const { proxy, forwarded } = makeProxy({ env: { MAUDE_PUBLIC_CANVAS_ORIGIN: CANVAS_ORIGIN } });
  const socket = fakeSocket();
  proxy.handleCanvasUpgrade({
    request: {
      headers: { upgrade: 'websocket', origin: CANVAS_ORIGIN, cookie: 'maude_canvas=own' },
      url: '/_ws/collab/ui-home',
    },
    socket,
    head: null,
    verifyToken: writeVerify,
  });
  assert.equal(forwarded.length, 0);
  assert.match(socket.written.join(''), /401/);
  // An explicit read-only `?t=` beside the full cookie is still read-only.
  const ro = makeWriteProxy();
  const r = fakeResponse();
  await ro.proxy.handleCanvas({
    request: {
      headers: { origin: CANVAS_ORIGIN, cookie: 'maude_canvas=own' },
      url: '/_api/annotations?t=ro',
    },
    response: r,
    pathname: '/_api/annotations',
    method: 'PUT',
    verifyToken: (t) =>
      t === 'ro' ? { ok: true, role: 'viewer', readOnly: true } : writeVerify(t),
  });
  assert.equal(r.statusCode, 403);
  assert.equal(ro.forwarded.length, 0);
});

test('an embed never overwrites the full cookie; its own one still loads assets (DDR-242)', async () => {
  const verifyToken = (t) =>
    t === 'ro'
      ? { ok: true, role: 'viewer', readOnly: true }
      : t === 'own'
        ? { ok: true, role: 'owner' }
        : { ok: false };
  const shell = makeWriteProxy();
  const embedShell = fakeResponse();
  await shell.proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html?t=ro' },
    response: embedShell,
    pathname: '/_canvas-shell.html',
    method: 'GET',
    verifyToken,
  });
  const planted = String(embedShell.preset['set-cookie']);
  assert.match(planted, /^maude_canvas_embed=ro;/);
  assert.doesNotMatch(planted, /(^|, )maude_canvas=/);

  const studioShell = fakeResponse();
  await shell.proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html?t=own' },
    response: studioShell,
    pathname: '/_canvas-shell.html',
    method: 'GET',
    verifyToken,
  });
  assert.match(String(studioShell.preset['set-cookie']), /^maude_canvas=own;/);

  // An asset the embedded canvas references (no `?t=`) loads on the embed cookie.
  const asset = fakeResponse();
  await shell.proxy.handleCanvas({
    request: { headers: { cookie: 'maude_canvas_embed=ro' }, url: '/.design/assets/a1b2c3d4.png' },
    response: asset,
    pathname: '/.design/assets/a1b2c3d4.png',
    method: 'GET',
    verifyToken,
  });
  assert.equal(asset.statusCode, 200);
});

test('a read-only capability still READS, and a normal one still writes', async () => {
  const roVerify = (t) =>
    t === 'ro' ? { ok: true, role: 'viewer', subject: 'o@b.c', readOnly: true } : writeVerify(t);
  const read = makeWriteProxy();
  const r1 = fakeResponse();
  await read.proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html?t=ro' },
    response: r1,
    pathname: '/_canvas-shell.html',
    method: 'GET',
    verifyToken: roVerify,
  });
  assert.equal(r1.statusCode, 200);
  const write = makeWriteProxy();
  const r2 = fakeResponse();
  await write.proxy.handleCanvas({
    request: { headers: { origin: CANVAS_ORIGIN }, url: '/_api/annotations?t=own' },
    response: r2,
    pathname: '/_api/annotations',
    method: 'PUT',
    verifyToken: roVerify,
  });
  assert.equal(r2.statusCode, 200);
});

test('a read-only capability opens no collab socket, but keeps the HMR one', () => {
  const verifyToken = (t) =>
    t === 'ro' ? { ok: true, subject: 'o@b.c', role: 'viewer', readOnly: true } : { ok: false };
  const collab = makeProxy();
  const s1 = fakeSocket();
  collab.proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: '/_ws/collab/ui-home?t=ro' },
    socket: s1,
    head: null,
    verifyToken,
  });
  assert.equal(collab.forwarded.length, 0);
  assert.match(s1.written.join(''), /403/);
  const hmr = makeProxy();
  hmr.proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: '/_ws?t=ro' },
    socket: fakeSocket(),
    head: null,
    verifyToken,
  });
  assert.equal(hmr.forwarded.length, 1);
});

test('a non-browser write needs the explicit URL capability, and then passes', async () => {
  const { proxy, forwarded } = makeWriteProxy();
  // Cookie alone, no Origin → refused before auth (ambient ≠ intent).
  const ambient = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: { cookie: 'maude_canvas=own' }, url: '/_api/annotations' },
    response: ambient,
    pathname: '/_api/annotations',
    method: 'PUT',
    verifyToken: writeVerify,
  });
  assert.equal(ambient.statusCode, 401);
  assert.equal(forwarded.length, 0);

  // Explicit `?t=` → proof of intent, forwarded at the token's role.
  const explicit = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_api/annotations?t=own' },
    response: explicit,
    pathname: '/_api/annotations',
    method: 'PUT',
    verifyToken: writeVerify,
  });
  assert.equal(explicit.statusCode, 200);
  assert.equal(forwarded.at(-1).headers[`${INJECTED_HEADER_PREFIX}readonly`], '0');
});

test('a write never gets the vendor-runtime exemption', async () => {
  const { proxy, forwarded } = makeWriteProxy();
  const r = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: { origin: CANVAS_ORIGIN }, url: '/_canvas-runtime/react.js' },
    response: r,
    pathname: '/_canvas-runtime/react.js',
    method: 'PUT',
    verifyToken: () => ({ ok: false }),
  });
  assert.equal(r.statusCode, 401);
  assert.equal(forwarded.length, 0);
});

test('an asset landing through the canvas door is mirrored like the shell door', async () => {
  const fired = [];
  const { proxy } = makeProxy({
    env: { MAUDE_PUBLIC_CANVAS_ORIGIN: CANVAS_ORIGIN },
    onAssetWritten: () => fired.push('asset'),
  });
  const r = fakeResponse();
  await proxy.handleCanvas({
    request: {
      headers: { origin: CANVAS_ORIGIN, cookie: 'maude_canvas=own' },
      url: '/_api/asset?t=own',
    },
    response: r,
    pathname: '/_api/asset',
    method: 'POST',
    verifyToken: writeVerify,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(fired.length, 1, 'the object-storage mirror must fire for a canvas-door upload');
});

test('a write the manifest refuses outright is 404 at this door too', async () => {
  // `/_api/export` is REFUSED at the shell door; the canvas door must not
  // become the weaker one. (This exemplar used to be `/_api/photo-edit`,
  // until that route was reclassified `edit` — it stores a validated JSON
  // sidecar and never evaluates anything; see studio-manifest.mjs.)
  const { proxy, forwarded } = makeWriteProxy();
  const r = fakeResponse();
  await proxy.handleCanvas({
    request: {
      headers: { origin: CANVAS_ORIGIN, cookie: 'maude_canvas=own' },
      url: '/_api/export?t=own',
    },
    response: r,
    pathname: '/_api/export',
    method: 'PUT',
    verifyToken: writeVerify,
  });
  assert.equal(r.statusCode, 404);
  assert.equal(forwarded.length, 0);
});

// ------------------------------------------------------------- WS upgrades

test('an unauthenticated upgrade is closed, not upgraded', () => {
  const { proxy, forwarded } = makeProxy();
  const written = [];
  const socket = { write: (s) => written.push(s), destroy() {}, on() {} };
  proxy.handleUpgrade({ request: { headers: {}, url: '/_ws' }, socket, head: null, session: null });
  assert.match(written.join(''), /401/);
  assert.equal(forwarded.length, 0);
});

test('an authenticated upgrade carries the role', () => {
  const { proxy, forwarded } = makeProxy();
  proxy.handleUpgrade({
    request: {
      // The Origin is part of the handshake now, not decoration — see the
      // CSWSH tests below. A real browser always sends it.
      headers: { upgrade: 'websocket', origin: 'https://alligators.cloud.maude.sh' },
      url: '/_ws',
    },
    socket: { write() {}, destroy() {}, on() {} },
    head: null,
    session: { email: 'm@b.c', role: 'member', sessionKey: 'k' },
  });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}role`], 'member');
});

test('the SHELL socket refuses a foreign origin — including the project´s own canvas', () => {
  // The twin of the canvas lane's gate, and the worse of the two: this socket
  // is upgraded at `realm: 'main'`, which the DDR-122 origin gate leaves
  // ungated, so it reaches the body lanes at the member's real role. The
  // credential is the browser SESSION cookie, and `SameSite=Lax` cannot
  // express the boundary — "site" is the registrable domain, so every tenant's
  // shell, every tenant's canvas origin, the control plane and the marketing
  // site are mutually same-site. Only an Origin check separates them.
  const cases = [
    ['https://alligators.cloud.maude.sh', true],
    // THE PROJECT'S OWN CANVAS ORIGIN. Same project, and still refused: that
    // origin exists to run the tenant's untrusted code, and a stored SVG on it
    // is the cheapest same-site foothold there is (DDR-210).
    ['https://canvas-alligators.cloud.maude.sh', false],
    // Another tenant, the control plane, the marketing site — all same-site.
    ['https://someone-else.cloud.maude.sh', false],
    ['https://canvas-someone-else.cloud.maude.sh', false],
    ['https://cloud.maude.sh', false],
    ['https://maude.sh', false],
    // Plainly foreign, and a sandboxed frame's opaque origin.
    ['https://evil.example', false],
    ['null', false],
  ];
  for (const [origin, allowed] of cases) {
    const { proxy, forwarded } = makeProxy();
    const written = [];
    proxy.handleUpgrade({
      request: { headers: { upgrade: 'websocket', origin }, url: '/_ws/collab/ui-home' },
      socket: { write: (s) => written.push(String(s)), destroy() {}, on() {} },
      head: null,
      session: { email: 'o@b.c', role: 'owner', sessionKey: 'k' },
    });
    if (allowed) {
      assert.equal(forwarded.length, 1, `${origin} should have been forwarded`);
    } else {
      assert.equal(forwarded.length, 0, `${origin} must NOT reach the studio`);
      assert.match(written.join(''), /403 Forbidden/, origin);
    }
  }
});

test('the shell socket refuses a handshake with no Origin at all', () => {
  // Unlike the canvas lane there is no `?t=` here — the only credential is an
  // ambient session cookie, so a missing Origin has no way to prove intent.
  const { proxy, forwarded } = makeProxy();
  const written = [];
  proxy.handleUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: '/_ws' },
    socket: { write: (s) => written.push(String(s)), destroy() {}, on() {} },
    head: null,
    session: { email: 'o@b.c', role: 'owner', sessionKey: 'k' },
  });
  assert.equal(forwarded.length, 0);
  assert.match(written.join(''), /403 Forbidden/);
});

test('a hub that never declared its public URL falls back to same-origin', () => {
  // A cell booted by hand, or the local data-plane stand-in: no HUB_PUBLIC_URL,
  // so the comparison is against the request's own Host. Safe for the reason
  // the check works at all — a browser sets Host from the URL it dials, so an
  // attacker's page can never make the two agree.
  const { proxy, forwarded } = makeProxy({ publicUrl: null });
  proxy.handleUpgrade({
    request: {
      headers: { upgrade: 'websocket', origin: 'http://localhost:18500', host: 'localhost:18500' },
      url: '/_ws',
    },
    socket: { write() {}, destroy() {}, on() {} },
    head: null,
    session: { email: 'o@b.c', role: 'owner', sessionKey: 'k' },
  });
  assert.equal(forwarded.length, 1);

  const written = [];
  proxy.handleUpgrade({
    request: {
      headers: { upgrade: 'websocket', origin: 'http://localhost:18501', host: 'localhost:18500' },
      url: '/_ws',
    },
    socket: { write: (s) => written.push(String(s)), destroy() {}, on() {} },
    head: null,
    session: { email: 'o@b.c', role: 'owner', sessionKey: 'k' },
  });
  assert.match(written.join(''), /403 Forbidden/);
});

test('a successful asset upload tells the hub to mirror it — and only then', async () => {
  // Cloud Phase 27 B3. The studio owns the write (tree, sniff, caps,
  // content-addressed name) and in a cell cannot reach object storage: its
  // credentials are deliberately absent from childEnv(). The hub has both, and
  // already sees the request.
  const fired = [];
  const { proxy } = makeProxy({ onAssetWritten: () => fired.push('asset') });

  const ok = fakeResponse();
  await proxy.handle({
    request: { headers: {}, url: '/_api/asset' },
    response: ok,
    pathname: '/_api/asset',
    method: 'POST',
    session: { email: 'o@b.c', role: 'owner', sessionKey: 'k' },
  });
  assert.equal(fired.length, 1, 'a 2xx upload must be mirrored');

  // A read of the same route is not a write.
  await proxy.handle({
    request: { headers: {}, url: '/_api/asset' },
    response: fakeResponse(),
    pathname: '/_api/asset',
    method: 'GET',
    session: { email: 'o@b.c', role: 'owner', sessionKey: 'k' },
  });
  assert.equal(fired.length, 1);

  // Neither is a refusal: a viewer never reaches the studio, so there is
  // nothing on disk to mirror.
  await proxy.handle({
    request: { headers: {}, url: '/_api/asset' },
    response: fakeResponse(),
    pathname: '/_api/asset',
    method: 'POST',
    session: { email: 'v@b.c', role: 'viewer', sessionKey: 'k' },
  });
  assert.equal(fired.length, 1);
});

test('a failed upload is not mirrored', async () => {
  const fired = [];
  const { proxy } = makeProxy({
    onAssetWritten: () => fired.push('asset'),
    forward: async ({ response }) => {
      response.writeHead(413, {});
      response.end('too big');
    },
  });
  await proxy.handle({
    request: { headers: {}, url: '/_api/asset' },
    response: fakeResponse(),
    pathname: '/_api/asset',
    method: 'POST',
    session: { email: 'o@b.c', role: 'owner', sessionKey: 'k' },
  });
  assert.equal(fired.length, 0);
});

test('vendor runtime bundles need no capability; tenant content always does', async () => {
  // The importmap that names them is static and must precede any module load,
  // so there is no moment at which a token could be appended. They are our own
  // React/motion builds, identical for every tenant.
  const { proxy, forwarded } = makeProxy();
  const ok = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-runtime/react.js' },
    response: ok,
    pathname: '/_canvas-runtime/react.js',
    method: 'GET',
    verifyToken: () => ({ ok: false }),
  });
  assert.equal(forwarded.length, 1, 'a vendor bundle must serve without a capability');

  // …and nothing else gets that exemption.
  for (const p of ['/_canvas-shell.html', '/.design/ui/Home.tsx', '/assets/deadbeef.png']) {
    const r = fakeResponse();
    await proxy.handleCanvas({
      request: { headers: {}, url: p },
      response: r,
      pathname: p,
      method: 'GET',
      verifyToken: () => ({ ok: false }),
    });
    assert.equal(r.statusCode, 401, `${p} must require a capability`);
  }
});

test('the capability survives a URL the shell did not write', async () => {
  // THE BUG. Canvas code is the TENANT's source, and it says
  // `<img src="/.design/system/x/assets/logo.svg">`. That request leaves the
  // browser with no query string, because nothing in its path passes through
  // code we wrote — so every asset, font and photograph on a rendered canvas
  // came back 401 and the design was a page of empty boxes. The shell cannot
  // fix it: appending a token to an arbitrary tenant's runtime-computed URLs
  // is not a thing that can be done.
  //
  // So the shell DOCUMENT plants the same capability as a host-scoped cookie,
  // and the assets ride it. Same token, same expiry, same read-only grant —
  // the only thing that changes is which part of the request carries it.
  const valid = (t) => (t === 'cap' ? { ok: true } : { ok: false });

  // 1. The shell document, reached with a token in the URL, sets the cookie.
  const { proxy, forwarded } = makeProxy();
  const shell = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html?t=cap' },
    response: shell,
    pathname: '/_canvas-shell.html',
    method: 'GET',
    verifyToken: valid,
  });
  assert.equal(forwarded.length, 1);
  const cookie = String(shell.preset['set-cookie']);
  assert.match(cookie, /maude_canvas=cap/);
  assert.match(cookie, /HttpOnly/, 'the untrusted canvas must not be able to read it');
  assert.match(cookie, /SameSite=Strict/); // see the dedicated test below for why not Lax

  // 2. An asset with NO query string is served on the strength of that cookie.
  const asset = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: { cookie: 'maude_canvas=cap' }, url: '/.design/system/x/assets/logo.svg' },
    response: asset,
    pathname: '/.design/system/x/assets/logo.svg',
    method: 'GET',
    verifyToken: valid,
  });
  assert.equal(forwarded.length, 2, 'the asset must be forwarded, not refused');
  assert.equal(asset.statusCode, 200);

  // 3. …and a WRONG cookie is still a refusal. The cookie is not an exemption,
  //    it is a second place to present the same signed capability.
  const forged = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: { cookie: 'maude_canvas=nope' }, url: '/.design/ui/Home.tsx' },
    response: forged,
    pathname: '/.design/ui/Home.tsx',
    method: 'GET',
    verifyToken: valid,
  });
  assert.equal(forged.statusCode, 401);
});

test('a re-minted capability re-plants the cookie, and an open canvas keeps loading on it', async () => {
  // The capability expires, and the canvas module's URL still carries the
  // first one. The studio hands an open canvas a fresh one; the shell asks for
  // its own document with it (re-planting the cookie), and the module
  // re-import after a teammate's edit — stale `?t=` and all — is served on
  // the fresh cookie instead of answering 401 for the rest of the session.
  const valid = (t) => (t === 'fresh' ? { ok: true } : { ok: false, reason: 'expired' });
  const { proxy, forwarded } = makeProxy();
  const shell = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html?t=fresh' },
    response: shell,
    pathname: '/_canvas-shell.html',
    method: 'GET',
    verifyToken: valid,
  });
  assert.match(String(shell.preset['set-cookie']), /maude_canvas=fresh/);
  const reimport = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: { cookie: 'maude_canvas=fresh' }, url: '/.design/ui/Home.tsx?t=stale&v=2' },
    response: reimport,
    pathname: '/.design/ui/Home.tsx',
    method: 'GET',
    verifyToken: valid,
  });
  assert.equal(reimport.statusCode, 200);
  assert.equal(forwarded.length, 2);
});

test('the canvas capability lifetime can be shortened for a rig, never lengthened', () => {
  assert.equal(canvasTokenTtlMs({}), RENDER_TOKEN_TTL_MS);
  assert.equal(canvasTokenTtlMs({ MAUDE_CANVAS_TOKEN_TTL_MS: '180000' }), 180_000);
  assert.equal(canvasTokenTtlMs({ MAUDE_CANVAS_TOKEN_TTL_MS: '5' }), 60_000);
  assert.equal(
    canvasTokenTtlMs({ MAUDE_CANVAS_TOKEN_TTL_MS: String(24 * 3600_000) }),
    RENDER_TOKEN_TTL_MS
  );
  assert.equal(canvasTokenTtlMs({ MAUDE_CANVAS_TOKEN_TTL_MS: 'soon' }), RENDER_TOKEN_TTL_MS);
});

test('only the shell document mints the cookie', async () => {
  // The narrower the surface that hands out an ambient credential, the easier
  // it is to say what holds it. Every other response on this origin is a
  // subresource of a shell that already planted one.
  const { proxy } = makeProxy();
  const asset = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/.design/ui/Home.tsx?t=cap' },
    response: asset,
    pathname: '/.design/ui/Home.tsx',
    method: 'GET',
    verifyToken: () => ({ ok: true }),
  });
  assert.equal(asset.preset['set-cookie'], undefined);
});

// -------------------------------------- the canvas origin's live sockets
// (RCA issue-cloud-live-collaboration-dead — the lane whose absence kept
// cloud cursors, annotations and live sync dead.)

function fakeSocket() {
  const written = [];
  return {
    written,
    destroyed: false,
    write: (s) => written.push(s),
    destroy() {
      this.destroyed = true;
    },
    on() {},
  };
}

test('a canvas upgrade without a capability is closed 401, never forwarded', () => {
  const { proxy, forwarded } = makeProxy();
  const socket = fakeSocket();
  proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: '/_ws/collab/ui-home' },
    socket,
    head: null,
    verifyToken: () => ({ ok: false, reason: 'missing' }),
  });
  assert.match(socket.written.join(''), /401/);
  assert.equal(socket.destroyed, true);
  assert.equal(forwarded.length, 0);
});

test('a capability in the URL opens the collab socket at the token role, canvas realm', () => {
  const { proxy, forwarded } = makeProxy();
  proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: '/_ws/collab/ui-home?t=cap' },
    socket: fakeSocket(),
    head: null,
    verifyToken: (t) =>
      t === 'cap' ? { ok: true, subject: 'o@b.c', role: 'owner' } : { ok: false },
  });
  assert.equal(forwarded.length, 1);
  const f = forwarded[0];
  assert.equal(f.upgrade, true);
  // Forwarded to the CANVAS upstream, not the main studio listener.
  assert.equal(f.port, 4400);
  assert.equal(f.path, '/_ws/collab/ui-home?t=cap');
  assert.equal(f.headers[`${INJECTED_HEADER_PREFIX}role`], 'owner');
  // An owner's collab socket is writable — annotations are the point…
  assert.equal(f.headers[`${INJECTED_HEADER_PREFIX}readonly`], '0');
  assert.equal(f.headers[`${INJECTED_HEADER_PREFIX}user`], 'o@b.c');
  // …but it is still marked canvas-realm, so body lanes stay unwritable.
  assert.equal(f.headers[`${INJECTED_HEADER_PREFIX}collab-realm`], 'canvas');
});

test('the capability cookie alone opens NO socket — the shell appends ?t= (DDR-242)', () => {
  // use-collab.tsx builds `wss://<canvas-origin>/_ws/collab/<slug>` with no
  // query string, and the shell document (templates/_shell.html) appends this
  // frame's capability to every socket it opens. The cookie is one per canvas
  // origin — inside an embed it can be ANOTHER tab's full capability — so it
  // never authorises a socket, which carries writes.
  const verifyToken = (t) =>
    t === 'cap' ? { ok: true, subject: 'v@b.c', role: 'viewer' } : { ok: false };
  const headers = {
    upgrade: 'websocket',
    cookie: 'maude_canvas=cap',
    origin: 'https://alligators.cloud.maude.sh',
  };
  const bare = makeProxy();
  const socket = fakeSocket();
  bare.proxy.handleCanvasUpgrade({
    request: { headers, url: '/_ws/collab/ui-home' },
    socket,
    head: null,
    verifyToken,
  });
  assert.equal(bare.forwarded.length, 0);
  assert.match(socket.written.join(''), /401/);

  const { proxy, forwarded } = makeProxy();
  proxy.handleCanvasUpgrade({
    request: { headers, url: '/_ws/collab/ui-home?t=cap' },
    socket: fakeSocket(),
    head: null,
    verifyToken,
  });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}role`], 'viewer');
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}readonly`], '1');
});

test('a token without a role claim opens at the viewer floor', () => {
  const { proxy, forwarded } = makeProxy();
  proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: '/_ws/collab/ui-home?t=old' },
    socket: fakeSocket(),
    head: null,
    // An older token — verifyRenderToken yields role: null for it.
    verifyToken: () => ({ ok: true, subject: 'm@b.c', role: null }),
  });
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}role`], 'viewer');
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}readonly`], '1');
});

test('the HMR socket (/_ws) rides the same lane; anything else on the origin is 404', () => {
  const { proxy, forwarded } = makeProxy();
  proxy.handleCanvasUpgrade({
    request: {
      headers: {
        upgrade: 'websocket',
        cookie: 'maude_canvas=cap',
        origin: 'https://alligators.cloud.maude.sh',
      },
      url: '/_ws?t=cap',
    },
    socket: fakeSocket(),
    head: null,
    verifyToken: (t) =>
      t === 'cap' ? { ok: true, subject: 'v@b.c', role: 'viewer' } : { ok: false },
  });
  assert.equal(forwarded.length, 1);

  const socket = fakeSocket();
  proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket', cookie: 'maude_canvas=cap' }, url: '/_api/asset' },
    socket,
    head: null,
    verifyToken: () => ({ ok: true }),
  });
  assert.match(socket.written.join(''), /404/);
  assert.equal(forwarded.length, 1);
});

test('the upgrade lane strips the shared-origin prefix, and refuses another tenant´s', () => {
  const { proxy, forwarded } = makeProxy();
  proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: '/alligators/_ws/collab/ui-home?t=cap' },
    socket: fakeSocket(),
    head: null,
    pathPrefix: '/alligators',
    verifyToken: () => ({ ok: true, subject: 'o@b.c', role: 'owner' }),
  });
  assert.equal(forwarded.at(-1).path, '/_ws/collab/ui-home?t=cap');

  const socket = fakeSocket();
  proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: '/someone-else/_ws/collab/x?t=cap' },
    socket,
    head: null,
    pathPrefix: '/alligators',
    verifyToken: () => ({ ok: true }),
  });
  assert.match(socket.written.join(''), /404/);
});

test('a dead canvas upstream closes the upgrade 503', () => {
  const { proxy } = makeProxy({ canvasUpstream: () => ({ ok: false, port: null }) });
  const socket = fakeSocket();
  proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: '/_ws/collab/x?t=cap' },
    socket,
    head: null,
    verifyToken: () => ({ ok: true, subject: 'o@b.c', role: 'owner' }),
  });
  assert.match(socket.written.join(''), /503/);
});

test('the canvas HTTP lane vouches the member for presence, at the claimed role', async () => {
  // /_api/git-user on the canvas listener answers with x-maude-user in a cell —
  // without this every cloud peer introduced itself as `anonymous-…`. The role
  // rides too (canvas-writes RCA): the readonly header the studio's gate reads
  // is derived from it, and a hard-coded viewer here is what kept every cloud
  // canvas edit at 403.
  const { proxy, forwarded } = makeProxy();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_api/git-user?t=cap' },
    response: fakeResponse(),
    pathname: '/_api/git-user',
    method: 'GET',
    verifyToken: (t) =>
      t === 'cap' ? { ok: true, subject: 'm@b.c', role: 'member' } : { ok: false },
  });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}user`], 'm@b.c');
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}role`], 'member');
  assert.equal(forwarded[0].headers[`${INJECTED_HEADER_PREFIX}readonly`], '0');
});

// ------------------------------------------------- the role claim round-trip

test('the render token carries the role; an older token verifies to role null', () => {
  const secret = 'test-secret';
  const withRole = mintRenderToken({ secret, project: 'p', subject: 'o@b.c', role: 'owner' });
  const verdict = verifyRenderToken({ secret, token: withRole, project: 'p' });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.role, 'owner');
  assert.equal(verdict.subject, 'o@b.c');

  const without = mintRenderToken({ secret, project: 'p', subject: 'v@b.c' });
  const old = verifyRenderToken({ secret, token: without, project: 'p' });
  assert.equal(old.ok, true);
  assert.equal(old.role, null);
});

test('the read-only claim is signed: minted, verified, and never forged off (DDR-242)', () => {
  const secret = 'test-secret';
  const ro = mintRenderToken({
    secret,
    project: 'p',
    subject: 'o@b.c',
    role: 'viewer',
    readOnly: true,
  });
  assert.equal(verifyRenderToken({ secret, token: ro, project: 'p' }).readOnly, true);
  const full = mintRenderToken({ secret, project: 'p', subject: 'o@b.c', role: 'owner' });
  assert.equal(verifyRenderToken({ secret, token: full, project: 'p' }).readOnly, false);
  // Stripping `ro` from the payload breaks the signature.
  const [body, mac] = [ro.slice(0, ro.lastIndexOf('.')), ro.slice(ro.lastIndexOf('.') + 1)];
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  const { ro: _stripped, ...rest } = claims;
  const forged = `${Buffer.from(JSON.stringify(rest)).toString('base64url')}.${mac}`;
  assert.equal(verifyRenderToken({ secret, token: forged, project: 'p' }).ok, false);
});

test('Secure comes OFF only for a deployment that declared itself plaintext', async () => {
  // The first version derived Secure from `MAUDE_PUBLIC_CANVAS_ORIGIN`
  // starting with `https://`, so a missing / empty / scheme-less / misspelled
  // value silently dropped the flag — fail-OPEN on exactly the input whose
  // absence should fail closed. The default is now ON, and it comes off only
  // for a positively-declared plaintext deployment (the local harness, which
  // would otherwise never store the cookie and revert the whole lane to 401s).
  for (const [env, expected] of [
    [{ MAUDE_PUBLIC_CANVAS_ORIGIN: 'https://canvas-alligators.cloud.maude.sh' }, true],
    [{ MAUDE_PUBLIC_CANVAS_ORIGIN: 'http://localhost:18501' }, false],
    [{ HUB_INSECURE_HTTP: '1' }, false],
    // The fail-open cases: nothing configured, empty, or scheme-less.
    [{}, true],
    [{ MAUDE_PUBLIC_CANVAS_ORIGIN: '' }, true],
    [{ MAUDE_PUBLIC_CANVAS_ORIGIN: 'canvas-alligators.cloud.maude.sh' }, true],
  ]) {
    const { proxy } = makeProxy({ env });
    const r = fakeResponse();
    await proxy.handleCanvas({
      request: { headers: {}, url: '/_canvas-shell.html?t=cap' },
      response: r,
      pathname: '/_canvas-shell.html',
      method: 'GET',
      verifyToken: () => ({ ok: true }),
    });
    assert.equal(/; Secure/.test(String(r.preset['set-cookie'])), expected, JSON.stringify(env));
  }
});

test('the capability cookie is SameSite=Strict, and Lax is a regression', async () => {
  // WHY THIS TEST EXISTS. `Lax` shipped on the reasoning that "a genuinely
  // foreign page gets nothing" — true, and not the threat. `Lax` IS sent on a
  // cross-site top-level GET navigation, which is precisely the request class
  // the canvas origin serves, so any page anywhere could `window.open` a
  // canvas URL and the capability rode along. And "same site" is computed at
  // the REGISTRABLE DOMAIN, so on a multi-tenant `*.<zone>` platform every
  // tenant's origins, the control plane and the marketing site are all
  // same-site with each other — `SameSite` never expressed the tenant boundary
  // at all. `Strict` costs nothing: the legitimate flow is an iframe inside a
  // top-level document on the project's own shell origin, which is same-site.
  const { proxy } = makeProxy({
    env: { MAUDE_PUBLIC_CANVAS_ORIGIN: 'https://canvas-alligators.cloud.maude.sh' },
  });
  const r = fakeResponse();
  await proxy.handleCanvas({
    request: { headers: {}, url: '/_canvas-shell.html?t=cap' },
    response: r,
    pathname: '/_canvas-shell.html',
    method: 'GET',
    verifyToken: () => ({ ok: true }),
  });
  const cookie = String(r.preset['set-cookie']);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /SameSite=Lax/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\//);
});

test('the canvas collab socket refuses a foreign origin', async () => {
  // CROSS-SITE WEBSOCKET HIJACKING. A WS handshake bypasses the same-origin
  // policy and carries cookies, so the moment this lane accepts the ambient
  // capability cookie, "you cannot guess the URL" stops being the protection.
  // `SameSite` cannot express the tenant boundary — "site" is the registrable
  // domain, so every tenant, the control plane and the marketing site are
  // mutually same-site. Only an Origin check separates them.
  const env = {
    MAUDE_PUBLIC_CANVAS_ORIGIN: 'https://canvas-alligators.cloud.maude.sh',
  };
  const cases = [
    // The two legitimate origins: the canvas origin, and the tab it lives in.
    ['https://canvas-alligators.cloud.maude.sh', true],
    ['https://alligators.cloud.maude.sh', true],
    // A DIFFERENT TENANT — same site under `maude.sh`, and the whole point.
    ['https://canvas-someone-else.cloud.maude.sh', false],
    ['https://someone-else.cloud.maude.sh', false],
    // The control plane and the marketing site are same-site too.
    ['https://cloud.maude.sh', false],
    ['https://maude.sh', false],
    // Plainly foreign, and a sandboxed frame's opaque origin.
    ['https://evil.example', false],
    ['null', false],
  ];
  for (const [origin, allowed] of cases) {
    const { proxy, forwarded } = makeProxy({ env });
    const writes = [];
    const socket = { write: (s) => writes.push(String(s)), destroy() {} };
    proxy.handleCanvasUpgrade({
      request: { headers: { origin, cookie: 'maude_canvas=cap' }, url: '/_ws/collab/x?t=cap' },
      socket,
      head: null,
      verifyToken: () => ({ ok: true, subject: 'v@b.c' }),
    });
    if (allowed) {
      assert.equal(forwarded.length, 1, `${origin} should have been forwarded`);
    } else {
      assert.equal(forwarded.length, 0, `${origin} must NOT reach the studio`);
      assert.match(writes.join(''), /403 Forbidden/, origin);
    }
  }
});

test('a non-browser client may omit Origin, but must then present ?t=', async () => {
  // Browsers always send Origin on a WS handshake; a CLI does not. Letting a
  // missing Origin through on the strength of a COOKIE would reopen the hole
  // by omission — a URL token is proof of intent in a way an ambient cookie
  // never is.
  const { proxy, forwarded } = makeProxy();
  const writes = [];
  proxy.handleCanvasUpgrade({
    request: { headers: { cookie: 'maude_canvas=cap' }, url: '/_ws/collab/x' },
    socket: { write: (s) => writes.push(String(s)), destroy() {} },
    head: null,
    verifyToken: () => ({ ok: true }),
  });
  assert.equal(forwarded.length, 0, 'cookie-only, no Origin: must be refused');
  assert.match(writes.join(''), /401 Unauthorized/);

  const ok = makeProxy();
  ok.proxy.handleCanvasUpgrade({
    request: { headers: {}, url: '/_ws/collab/x?t=cap' },
    socket: { write() {}, destroy() {} },
    head: null,
    verifyToken: () => ({ ok: true }),
  });
  assert.equal(ok.forwarded.length, 1, 'explicit ?t= with no Origin: allowed');
});

// ---------------------------------------- the design-system asset read lane

// Reported 2026-08-13: DS logos, fonts and photographs 404'd in the cloud file
// browser, and an annotation's `<image href="/.design/assets/<sha8>.jpg">`
// showed a broken icon — while the same bytes were provably on the cell. The
// manifest never classified the lane, so the proxy answered 404 without asking
// the studio child. These pin the whole chain, not just the verdict: an asset
// must be FORWARDED, and everything else must still die at this door.
test('a design-system asset GET is forwarded to the studio', async () => {
  const { proxy, forwarded } = makeProxy();
  const response = fakeResponse();
  await proxy.handle({
    request: { headers: {}, url: '/.design/system/ds/assets/logos/mark.svg' },
    response,
    pathname: '/.design/system/ds/assets/logos/mark.svg',
    method: 'GET',
    session: { email: 'v@b.c', role: 'viewer' },
  });
  assert.equal(forwarded.length, 1, 'a viewer must be able to read a DS asset');
});

test("an annotation's pasted image is forwarded — the reported broken icon", async () => {
  const { proxy, forwarded } = makeProxy();
  await proxy.handle({
    request: { headers: {}, url: '/.design/assets/9fb5bab5.jpg' },
    response: fakeResponse(),
    pathname: '/.design/assets/9fb5bab5.jpg',
    method: 'GET',
    session: { email: 'v@b.c', role: 'viewer' },
  });
  assert.equal(forwarded.length, 1);
});

test('the lane forwards assets and nothing else', async () => {
  for (const pathname of [
    '/.design/ui/Home.tsx',
    '/.design/config.json',
    '/.design/_comments/assets/pasted.png',
    '/.design/_history/ui-home/assets/shot.png',
  ]) {
    const { proxy, forwarded } = makeProxy();
    const response = fakeResponse();
    await proxy.handle({
      request: { headers: {}, url: pathname },
      response,
      pathname,
      method: 'GET',
      session: { email: 'o@b.c', role: 'owner' },
    });
    assert.equal(forwarded.length, 0, pathname);
    assert.equal(response.statusCode, 404, pathname);
  }
});

// ---------------------------------------- the DS tokens-CSS read lane

// Reported 2026-08-13 (same family, hours later): the inspector's Variables
// tab was empty in every cloud session while the desktop showed the full token
// set — the client fetches each DS's tokens CSS from the main origin and the
// asset lane refuses `.css` by design. The reported path (alligators'
// `tokensCssRel`) is one of the cases by name, so a future narrowing of the
// lane fails loudly on the thing a person actually saw.
test('a DS tokens CSS GET is forwarded to the studio', async () => {
  const { proxy, forwarded } = makeProxy();
  const response = fakeResponse();
  await proxy.handle({
    request: { headers: {}, url: '/.design/system/alligators/colors_and_type.css' },
    response,
    pathname: '/.design/system/alligators/colors_and_type.css',
    method: 'GET',
    session: { email: 'v@b.c', role: 'viewer' },
  });
  assert.equal(forwarded.length, 1, 'a viewer must be able to read the DS tokens CSS');
});

test('the tokens lane forwards css and nothing else — and never a write', async () => {
  for (const { pathname, method } of [
    { pathname: '/.design/ui/Home.tsx', method: 'GET' }, // canvas SOURCE
    { pathname: '/.design/config.json', method: 'GET' }, // project config
    { pathname: '/.design/_history/ui-home/tokens.css', method: 'GET' }, // DDR-115
    { pathname: '/.design/system/alligators/colors_and_type.css', method: 'PUT' },
  ]) {
    const { proxy, forwarded } = makeProxy();
    const response = fakeResponse();
    await proxy.handle({
      request: { headers: {}, url: pathname },
      response,
      pathname,
      method,
      session: { email: 'o@b.c', role: 'owner' },
    });
    assert.equal(forwarded.length, 0, `${method} ${pathname}`);
  }
});
