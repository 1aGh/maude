// Cloud Phase 3 Task 2 — the hub's authenticated asset proxy.
//
// The properties worth proving are all about what the route REFUSES: an
// unauthenticated peer, a non-content-addressed key, a write attempt, and a
// content type that could turn an asset into a document on the hub's origin.

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import {
  assetContentType,
  handleAssetRoute,
  handleCheckoutAssetRoute,
  parseAssetPath,
  parseCheckoutAssetPath,
} from '../src/assets.mjs';
import { handleFileDoor, resetQuotas } from '../src/file-door.mjs';
import { checkConnRateLimit } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

let dataDir;
let store;
let s3server;
let s3;

beforeEach(async () => {
  resetQuotas(); // the door's per-label quota map is process-global by design
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-assets-'));
  store = new Map();
  s3server = createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace('/bucket/', ''));
    const body = store.get(key);
    if (req.method === 'HEAD') {
      if (!body) return void res.writeHead(404).end();
      return void res.writeHead(200, { 'Content-Length': body.length }).end();
    }
    if (req.method === 'GET') {
      if (!body) return void res.writeHead(404).end();
      return void res.writeHead(200).end(body);
    }
    res.writeHead(405).end();
  });
  await new Promise((resolve) => s3server.listen(0, '127.0.0.1', resolve));
  s3 = {
    endpoint: `http://127.0.0.1:${s3server.address().port}`,
    bucket: 'bucket',
    accessKeyId: 'AKIA',
    secretAccessKey: 'secret',
    region: 'auto',
  };
});

afterEach(async () => {
  await new Promise((resolve) => s3server.close(resolve));
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/**
 * Mirror the server's ONE-DOOR dispatch (Sync v2 Increment 5): a PUT whose
 * legacy URL parses is rewritten to `PUT /api/file/<rel>` and handled by the
 * file door, exactly as `server.mjs` does; everything else drives the legacy
 * handler directly. `body` (a Buffer or an array of Buffers) makes the request
 * async-iterable, the way the door consumes a real IncomingMessage.
 */
async function doorPut({
  rel,
  token,
  designRoot = null,
  body = null,
  onWritten,
  maxPutBytes,
  putBudget,
  checkRateLimit,
  checkWriteRateLimit,
}) {
  const captured = { status: 0, headers: {}, body: null };
  const response = {
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers ?? {};
      return this;
    },
    end(body) {
      captured.body = body ?? null;
      return this;
    },
  };
  const chunks = body === null ? [] : Array.isArray(body) ? body : [body];
  const handled = await handleFileDoor({
    request: {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    },
    response,
    pathname: `/api/file/${rel.split('/').map(encodeURIComponent).join('/')}`,
    method: 'PUT',
    dataDir,
    secret: '',
    designRoot,
    journal: null,
    onWritten,
    // The server passes no overrides; tests map the legacy knobs onto the
    // door's equivalents so the caps stay pinned.
    ...(maxPutBytes !== undefined ? { maxFileBytes: maxPutBytes } : {}),
    ...(putBudget !== undefined ? { budget: putBudget } : {}),
    checkRateLimit,
    checkWriteRateLimit,
  });
  return { handled, ...captured };
}

async function call({
  pathname,
  method = 'GET',
  token,
  withS3 = true,
  designRoot = null,
  body = null,
  onWritten,
  maxPutBytes,
  putBudget,
  checkRateLimit,
  checkWriteRateLimit,
}) {
  if (method === 'PUT') {
    const key = parseAssetPath(pathname);
    if (key !== null) {
      return doorPut({
        rel: `assets/${key}`,
        token,
        designRoot,
        body,
        onWritten,
        maxPutBytes,
        putBudget,
        checkRateLimit,
        checkWriteRateLimit,
      });
    }
    // An unparseable key never reaches the door — same as the server, where
    // the legacy handler then refuses to match it at all.
  }
  const captured = { status: 0, headers: {}, body: null };
  const response = {
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers ?? {};
      return this;
    },
    end(body) {
      captured.body = body ?? null;
      return this;
    },
  };
  const chunks = body === null ? [] : Array.isArray(body) ? body : [body];
  const handled = await handleAssetRoute({
    request: {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    },
    response,
    pathname,
    method,
    dataDir,
    secret: '',
    s3: withS3 ? s3 : null,
    designRoot,
    onWritten,
    maxPutBytes,
    putBudget,
    checkRateLimit,
    checkWriteRateLimit,
  });
  return { handled, ...captured };
}

test('parseAssetPath admits the shapes real projects actually use', () => {
  // Content-addressed — what `maude design fetch-asset` mints.
  assert.equal(parseAssetPath('/assets/deadbeef.png'), 'deadbeef.png');
  assert.equal(parseAssetPath('/assets/deadbeef'), 'deadbeef');
  // Authored — a design system's own fonts and graphics, referenced by path.
  // Requiring hashes (the rule until Cloud Phase 15) left a hosted project
  // rendering without its own brand and reported nothing anywhere.
  assert.equal(parseAssetPath('/assets/gator_badge_roundel.svg'), 'gator_badge_roundel.svg');
  assert.equal(parseAssetPath('/assets/graphics/camo-bg.png'), 'graphics/camo-bg.png');
  assert.equal(parseAssetPath('/assets/fonts/Gators-Bold.woff2'), 'fonts/Gators-Bold.woff2');
});

test('parseAssetPath cannot be walked out of the assets prefix', () => {
  for (const bad of [
    '/assets/',
    '/assets/../hub.db',
    '/assets/a/../../hub.db',
    '/assets/..',
    '/assets//double',
    '/assets/.hidden',
    '/assets/a/b/c/d/e/f/too-deep.png',
    '/assets/has space.png',
    '/assets/query.png?x=1',
    '/health',
  ]) {
    assert.equal(parseAssetPath(bad), null, `expected null for ${bad}`);
  }
});

test('a key that LOOKS like a backup path still cannot reach one', () => {
  // The widened charset admits `backups/<gen>/hub.db.gz` as a NAME. What keeps
  // it harmless is that the proxy always reads `assets/<key>` — the confinement
  // is the prefix, not the regex, and this pins that so a future refactor that
  // drops the prefix fails here instead of in production.
  assert.equal(
    parseAssetPath('/assets/backups/20260728T203000Z/hub.db.gz'),
    'backups/20260728T203000Z/hub.db.gz'
  );
  assert.equal(
    ASSET_OBJECT_KEY('backups/20260728T203000Z/hub.db.gz'),
    'assets/backups/20260728T203000Z/hub.db.gz'
  );
});

/** The one place the proxy turns a parsed key into an object key. */
const ASSET_OBJECT_KEY = (key) => `assets/${key}`;

test('content types are chosen from the extension and never text/html', () => {
  assert.equal(assetContentType('deadbeef.png'), 'image/png');
  assert.equal(assetContentType('deadbeef.mp4'), 'video/mp4');
  assert.equal(assetContentType('deadbeef'), 'application/octet-stream');
  assert.equal(assetContentType('deadbeef.html'), 'application/octet-stream');
  assert.equal(assetContentType('deadbeef.js'), 'application/octet-stream');
});

test('an unauthenticated request is 401 and never touches the bucket', async () => {
  store.set('assets/deadbeef.png', Buffer.from('image bytes'));
  const res = await call({ pathname: '/assets/deadbeef.png' });
  assert.equal(res.handled, true);
  assert.equal(res.status, 401);
  assert.match(res.body, /unauthorized/);
});

test('an invalid token is 401', async () => {
  store.set('assets/deadbeef.png', Buffer.from('image bytes'));
  const res = await call({ pathname: '/assets/deadbeef.png', token: 'mau_not_a_real_token' });
  assert.equal(res.status, 401);
});

test('a valid peer token streams the bytes with immutable, sniff-proof headers', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  store.set('assets/deadbeef.png', Buffer.from('image bytes'));

  const res = await call({ pathname: '/assets/deadbeef.png', token: minted.value });
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), 'image bytes');
  assert.equal(res.headers['Content-Type'], 'image/png');
  // Content-addressed ⇒ the bytes under a key never change ⇒ cache forever.
  assert.match(res.headers['Cache-Control'], /immutable/);
  // An asset must not be able to become a document on the hub's own origin.
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(res.headers['Content-Security-Policy'], /sandbox/);
});

test('HEAD reports size without downloading the object', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  store.set('assets/deadbeef.mp4', Buffer.alloc(1024, 7));
  const res = await call({ pathname: '/assets/deadbeef.mp4', method: 'HEAD', token: minted.value });
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Length'], 1024);
  assert.equal(res.body, null);
});

test('a missing object is 404', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const res = await call({ pathname: '/assets/00000000.png', token: minted.value });
  assert.equal(res.status, 404);
});

/* --------------------- 2026-08-15 RCA — the checkout serves before the bucket */

test('a file in the CHECKOUT is served even when the bucket misses it', async () => {
  // The eraser-adjacent half of the annotations-assets RCA: a browser upload
  // (or a peer push) lands in the checkout instantly, and the bucket mirror
  // lags or fails. This route used to be bucket-only, so a peer's asset pull
  // got 404 for a file the same process was serving to browsers.
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-serve-'));
  try {
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/65c3a940.png'), 'checkout bytes');
    // NOT in the bucket (store empty for this key).
    const res = await call({
      pathname: '/assets/65c3a940.png',
      token: minted.value,
      designRoot,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), 'checkout bytes');
    assert.equal(res.headers['Content-Type'], 'image/png');
    assert.match(res.headers['Cache-Control'], /immutable/);

    const head = await call({
      pathname: '/assets/65c3a940.png',
      method: 'HEAD',
      token: minted.value,
      designRoot,
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers['Content-Length'], 14);
    assert.equal(head.body, null);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('checkout serve works with NO bucket configured — 404 is the miss, not 503', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-nos3-'));
  try {
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/deadbeef.png'), 'x');
    const hit = await call({
      pathname: '/assets/deadbeef.png',
      token: minted.value,
      withS3: false,
      designRoot,
    });
    assert.equal(hit.status, 200);
    const miss = await call({
      pathname: '/assets/00000000.png',
      token: minted.value,
      withS3: false,
      designRoot,
    });
    assert.equal(miss.status, 404, 'a real miss with a checkout present is 404');
    const noStore = await call({
      pathname: '/assets/00000000.png',
      token: minted.value,
      withS3: false,
    });
    assert.equal(noStore.status, 503, 'no checkout AND no bucket stays 503');
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a symlink inside assets/ cannot serve bytes from outside it', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-link-'));
  try {
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'secret.txt'), 'not-an-asset');
    symlinkSync(join(designRoot, 'secret.txt'), join(designRoot, 'assets/aaaabbbb.png'));
    const res = await call({
      pathname: '/assets/aaaabbbb.png',
      token: minted.value,
      withS3: false,
      designRoot,
    });
    // Containment refuses the link target outside assets/; with no bucket the
    // answer is the checkout miss.
    assert.equal(res.status, 404);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a hub without a checkout is NOT an upload endpoint', async () => {
  // The pre-DDR-217 posture, still true wherever there is no durable checkout
  // to write into: accepting writes there would make the hub an
  // authenticated-but-cheap disk-fill surface.
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  for (const method of ['PUT', 'POST', 'DELETE']) {
    const res = await call({ pathname: '/assets/deadbeef.png', method, token: minted.value });
    assert.equal(res.status, 405, `${method} must be refused`);
  }
});

/* -------------------------------------------- DDR-217 — the desktop push */

test('an authenticated PUT streams into the checkout and fires the mirror hook', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  let mirrored = 0;
  try {
    const res = await call({
      pathname: '/assets/graphics/camo-bg.png',
      method: 'PUT',
      token: minted.value,
      designRoot,
      body: [Buffer.from('cam'), Buffer.from('o-bytes')],
      onWritten: () => {
        mirrored += 1;
      },
    });
    assert.equal(res.status, 200, res.body);
    // The door's receipt: `path` (not the legacy `key`), plus the sha256 and
    // seq the plane clients read. Legacy clients never parse a PUT body.
    const receipt = JSON.parse(res.body);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.path, 'assets/graphics/camo-bg.png');
    assert.equal(receipt.bytes, 10);
    assert.equal(
      readFileSync(join(designRoot, 'assets/graphics/camo-bg.png'), 'utf8'),
      'camo-bytes'
    );
    assert.equal(mirrored, 1, 'the bucket mirror fires per successful push');
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('an unauthenticated PUT is 401 — the token gate comes before everything', async () => {
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  try {
    const res = await call({
      pathname: '/assets/deadbeef.png',
      method: 'PUT',
      designRoot,
      body: Buffer.from('x'),
    });
    assert.equal(res.status, 401);
    assert.equal(existsSync(join(designRoot, 'assets/deadbeef.png')), false);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('an over-cap PUT aborts mid-stream and leaves no partial behind', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  let mirrored = 0;
  try {
    const res = await call({
      pathname: '/assets/deadbeef.mp4',
      method: 'PUT',
      token: minted.value,
      designRoot,
      body: [Buffer.alloc(6, 1), Buffer.alloc(6, 2)],
      maxPutBytes: 8,
      onWritten: () => {
        mirrored += 1;
      },
    });
    assert.equal(res.status, 413);
    assert.equal(existsSync(join(designRoot, 'assets/deadbeef.mp4')), false);
    const leftovers = readdirSync(join(designRoot, 'assets'));
    assert.deepEqual(leftovers, [], `no partial/temp file: ${leftovers.join(', ')}`);
    assert.equal(mirrored, 0, 'a refused push never mirrors');
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a PUT cannot follow a peer-committed symlink out of assets/ (F1 blocker)', async () => {
  // DDR-054: a peer can COMMIT a symlink under assets/ into the shared repo.
  // `assets/escape -> ../../ui` + PUT assets/escape/welcome.tsx would, with a
  // lexical-only check, write attacker bytes over a served canvas the studio
  // child then compiles (data→code, DDR-193 §2). The realpath guard refuses it.
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  try {
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    // The escape link: assets/escape resolves to the sibling ui/ directory.
    symlinkSync(join(designRoot, 'ui'), join(designRoot, 'assets', 'escape'));

    const res = await call({
      pathname: '/assets/escape/welcome.tsx',
      method: 'PUT',
      token: minted.value,
      designRoot,
      body: Buffer.from('export default () => <script>PWNED</script>;'),
    });
    assert.equal(res.status, 400, 'the symlink-escaping PUT is refused');
    assert.equal(
      existsSync(join(designRoot, 'ui', 'welcome.tsx')),
      false,
      'nothing written outside assets/'
    );
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('the per-process PUT budget bounds total accepted bytes (F2)', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  // One SHARED budget across both requests — the process singleton, in miniature.
  const putBudget = { cap: 8, used: 0 };
  try {
    // First PUT exactly fills the budget; once spent, the next is refused 507
    // up front (a stream that would OVERRUN a partial budget is 413 instead —
    // both bound total bytes, this asserts the exhausted-up-front path).
    const first = await call({
      pathname: '/assets/aaaaaaaa.png',
      method: 'PUT',
      token: minted.value,
      designRoot,
      body: Buffer.alloc(8, 1),
      maxPutBytes: 1024,
      putBudget,
    });
    assert.equal(first.status, 200, first.body);
    assert.equal(putBudget.used, 8, 'the budget records the committed bytes');
    const second = await call({
      pathname: '/assets/bbbbbbbb.png',
      method: 'PUT',
      token: minted.value,
      designRoot,
      body: Buffer.alloc(1, 2),
      maxPutBytes: 1024,
      putBudget,
    });
    assert.equal(second.status, 507, 'budget exhausted');
    assert.equal(existsSync(join(designRoot, 'assets/bbbbbbbb.png')), false);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a traversal key never reaches the PUT branch — the parser refuses it first', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  try {
    for (const bad of ['/assets/../secret.png', '/assets/a/../../etc/passwd', '/assets//x.png']) {
      const res = await call({
        pathname: bad,
        method: 'PUT',
        token: minted.value,
        designRoot,
        body: Buffer.from('x'),
      });
      assert.equal(res.handled, false, `${bad} must not be handled as an asset`);
    }
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a hub with no asset store says so rather than failing obscurely', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const res = await call({ pathname: '/assets/deadbeef.png', token: minted.value, withS3: false });
  assert.equal(res.status, 503);
  assert.match(res.body, /no asset store configured/);
});

test('a non-asset path is not handled at all (the router keeps dispatching)', async () => {
  const res = await call({ pathname: '/health' });
  assert.equal(res.handled, false);
  assert.equal(res.status, 0);
});

/* -------------------------- DDR-217 addendum — checkout asset route (DS/brand) */

/** Drive the checkout-file route with a fake req/res (mirrors `call`). */
async function callCheckout({
  pathname,
  method = 'PUT',
  token,
  designRoot = null,
  body = null,
  checkRateLimit,
  checkWriteRateLimit,
}) {
  if (method === 'PUT') {
    const rel = parseCheckoutAssetPath(pathname);
    if (rel !== null) {
      return doorPut({ rel, token, designRoot, body, checkRateLimit, checkWriteRateLimit });
    }
  }
  const captured = { status: 0, headers: {}, body: null };
  const response = {
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers ?? {};
      return this;
    },
    end(body) {
      captured.body = body ?? null;
      return this;
    },
  };
  const chunks = body === null ? [] : Array.isArray(body) ? body : [body];
  const handled = await handleCheckoutAssetRoute({
    request: {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    },
    response,
    pathname,
    method,
    dataDir,
    secret: '',
    designRoot,
    checkRateLimit,
    checkWriteRateLimit,
  });
  return { handled, ...captured };
}

test('parseCheckoutAssetPath is the SHAPE gate — class admission moved to the route', () => {
  // feature-sync-file-plane: the parser refuses only what no checkout
  // configuration could ever admit (the shape); membership — which needs the
  // checkout's own canvas groups and tree — is judged in the route by
  // `resolveCheckoutFileWrite`, and refuses with 400 rather than falling
  // through. So shapes that used to be refused HERE now parse, and the tests
  // below pin where each refusal lives.
  assert.equal(
    parseCheckoutAssetPath('/_asset-file/system/alligators/assets/logos/horizontal-green.svg'),
    'system/alligators/assets/logos/horizontal-green.svg'
  );
  assert.equal(
    parseCheckoutAssetPath('/_asset-file/system/ds/assets/fonts/Gators-Bold.woff2'),
    'system/ds/assets/fonts/Gators-Bold.woff2'
  );
  assert.equal(parseCheckoutAssetPath('/_asset-file/assets/x.png'), 'assets/x.png');
  // The classes the plane carries now parse (and the route decides):
  assert.equal(parseCheckoutAssetPath('/_asset-file/system/ds/brand.css'), 'system/ds/brand.css');
  assert.equal(
    // The underscore FILE the DDR-115 shape accident left laneless.
    parseCheckoutAssetPath('/_asset-file/system/ds/preview/_brand-css.ts'),
    'system/ds/preview/_brand-css.ts'
  );
  // Shape-clean but class-refused at the route (400 there, not null here):
  assert.equal(parseCheckoutAssetPath('/_asset-file/config.json'), 'config.json');
  assert.equal(parseCheckoutAssetPath('/_asset-file/assets/x'), 'assets/x');

  for (const bad of [
    '/_asset-file/../etc/passwd', // traversal
    '/_asset-file/system/ds/assets/../../../../etc/x.png', // traversal with a valid tail
    '/_asset-file//assets/x.png', // empty component
    '/_asset-file/', // empty
    '/_asset-file/_history/x.png', // underscore DIRECTORY — runtime state, structurally out
    '/_asset-file/system/ds/assets/.hidden.png', // dotfile
    '/_asset-file/a/b/c/d/e/f/g/h/i.png', // 9 segments
  ]) {
    assert.equal(parseCheckoutAssetPath(bad), null, `expected null for ${bad}`);
  }
});

test('the route refuses never + canvas-owned with 400, and admits the flowing classes', async () => {
  // `role: 'owner'` — the door gates code-module writes on the owner role
  // (Increment 4 closed the half-gate), and `_brand-css.ts` below is one.
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*', role: 'owner' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    mkdirSync(join(designRoot, 'system/ds/preview'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/preview/specimen.tsx'), 'export default 1');
    // never: the design root's trust anchors and unclassified extensions.
    for (const rel of ['config.json', 'system/ds/assets/config.json', 'assets/x']) {
      const res = await callCheckout({
        pathname: `/_asset-file/${rel}`,
        token: minted.value,
        designRoot,
        body: Buffer.from('x'),
      });
      assert.equal(res.status, 400, `${rel} must refuse`);
      assert.equal(existsSync(join(designRoot, rel)), false, `${rel} must not land`);
    }
    // canvas-owned: a body and its sibling css are the CRDT lanes' — the
    // file route must not become a way to overwrite them.
    for (const rel of ['system/ds/preview/specimen.tsx', 'system/ds/preview/specimen.css']) {
      const res = await callCheckout({
        pathname: `/_asset-file/${rel}`,
        token: minted.value,
        designRoot,
        body: Buffer.from('overwrite'),
      });
      assert.equal(res.status, 400, `${rel} must refuse`);
    }
    // The flowing classes land — including the RCA's laneless files.
    for (const rel of [
      'system/ds/brand.css',
      'system/ds/preview/_layout.css',
      'system/ds/preview/_brand-css.ts',
      'system/ds/README.md',
    ]) {
      const res = await callCheckout({
        pathname: `/_asset-file/${rel}`,
        token: minted.value,
        designRoot,
        body: Buffer.from('content'),
      });
      assert.equal(res.status, 200, `${rel} must be admitted`);
      assert.equal(readFileSync(join(designRoot, rel), 'utf8'), 'content');
    }
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('an authenticated PUT writes a DS asset to the checkout at its real path', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    const res = await callCheckout({
      pathname: '/_asset-file/system/alligators/assets/logos/horizontal-green.svg',
      token: minted.value,
      designRoot,
      body: [Buffer.from('<svg'), Buffer.from('/>')],
    });
    assert.equal(res.status, 200, res.body);
    const receipt = JSON.parse(res.body);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.path, 'system/alligators/assets/logos/horizontal-green.svg');
    assert.equal(receipt.bytes, 6);
    assert.equal(
      readFileSync(join(designRoot, 'system/alligators/assets/logos/horizontal-green.svg'), 'utf8'),
      '<svg/>'
    );
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('HEAD is the desktop skip-probe: 200 when present, 404 when not', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    mkdirSync(join(designRoot, 'system/ds/assets/logos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/assets/logos/there.svg'), 'x');
    const present = await callCheckout({
      pathname: '/_asset-file/system/ds/assets/logos/there.svg',
      method: 'HEAD',
      token: minted.value,
      designRoot,
    });
    assert.equal(present.status, 200);
    const missing = await callCheckout({
      pathname: '/_asset-file/system/ds/assets/logos/nope.svg',
      method: 'HEAD',
      token: minted.value,
      designRoot,
    });
    assert.equal(missing.status, 404);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('an unauthenticated checkout PUT is 401 and writes nothing', async () => {
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    const res = await callCheckout({
      pathname: '/_asset-file/system/ds/assets/logos/x.svg',
      designRoot,
      body: Buffer.from('x'),
    });
    assert.equal(res.status, 401);
    assert.equal(existsSync(join(designRoot, 'system/ds/assets/logos/x.svg')), false);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a symlink-escaping checkout PUT is refused (same guard as the bucket PUT)', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  const outside = mkdtempSync(join(tmpdir(), 'maude-hub-outside-'));
  try {
    mkdirSync(join(designRoot, 'system/ds/assets'), { recursive: true });
    // A peer-committed symlink pointing OUT of the design root entirely.
    symlinkSync(outside, join(designRoot, 'system/ds/assets/escape'));
    const res = await callCheckout({
      pathname: '/_asset-file/system/ds/assets/escape/pwn.svg',
      token: minted.value,
      designRoot,
      body: Buffer.from('<svg/>'),
    });
    assert.equal(res.status, 400, 'symlink escape refused');
    assert.equal(existsSync(join(outside, 'pwn.svg')), false);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlink landing on runtime state is refused — the class is judged on the REAL path', async () => {
  // feature-sync-file-plane: the old assets-parent rule is gone; what
  // replaces it is stronger — a committed link that stays INSIDE the root
  // but maps a benign lexical path onto runtime state (`media -> _history`)
  // is refused because the LANDING path classifies `never`.
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    mkdirSync(join(designRoot, '_history'), { recursive: true });
    symlinkSync(join(designRoot, '_history'), join(designRoot, 'media'));
    const res = await callCheckout({
      pathname: '/_asset-file/media/x.png',
      token: minted.value,
      designRoot,
      body: Buffer.from('x'),
    });
    assert.equal(res.status, 400, 'runtime-state landing refused');
    assert.equal(existsSync(join(designRoot, '_history', 'x.png')), false);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a symlink landing on a CRDT-owned sidecar is refused for the same reason', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    mkdirSync(join(designRoot, 'system/ds/preview'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/preview/specimen.tsx'), 'export default 1');
    symlinkSync(join(designRoot, 'system/ds/preview'), join(designRoot, 'p'));
    // Lexically `p/specimen.css` is a plain companion stylesheet; it LANDS as
    // the canvas's own css lane, which plane B must never write.
    const res = await callCheckout({
      pathname: '/_asset-file/p/specimen.css',
      token: minted.value,
      designRoot,
      body: Buffer.from('.pwn{}'),
    });
    assert.equal(res.status, 400, 'CRDT-owned landing refused');
    assert.equal(existsSync(join(designRoot, 'system/ds/preview/specimen.css')), false);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a checkout PUT to a hub with no checkout is 405 (not an upload endpoint)', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const res = await callCheckout({
    pathname: '/_asset-file/system/ds/assets/logos/x.svg',
    token: minted.value,
    designRoot: null,
    body: Buffer.from('x'),
  });
  assert.equal(res.status, 405);
});

test('HEAD is rate-limited too — no unmetered existence oracle (F4)', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    mkdirSync(join(designRoot, 'system/ds/assets/logos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/assets/logos/there.svg'), 'x');
    const res = await callCheckout({
      pathname: '/_asset-file/system/ds/assets/logos/there.svg',
      method: 'HEAD',
      token: minted.value,
      designRoot,
      checkWriteRateLimit: () => false, // over the limit
    });
    assert.equal(res.status, 429, 'HEAD is metered, not a free oracle');
    assert.equal(res.headers['Retry-After'], '60', 'a 429 must say when to come back');
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

/* ------------------- RCA 2026-08-11 — the write lane has its OWN bucket */

test('a real 182-asset sweep is not throttled by the per-IP admin bucket', async () => {
  // The regression in one line: the authenticated write lane consumed the tight
  // per-IP admin bucket (5/min), so a first link of a real project 429'd after
  // ~5 files. `checkRateLimit` here is PINNED SHUT — the write path must not
  // read it at all; only the generous per-label write bucket applies.
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  const writeBuckets = new Map();
  try {
    for (let i = 0; i < 25; i++) {
      const bucket = await call({
        pathname: `/assets/sweep-${i}.png`,
        method: 'PUT',
        token: minted.value,
        designRoot,
        body: Buffer.from('x'),
        checkRateLimit: () => false,
        checkWriteRateLimit: (label) => checkConnRateLimit(writeBuckets, label, 600),
      });
      assert.equal(bucket.status, 200, `bucket-route write #${i + 1} must pass`);
      const checkout = await callCheckout({
        pathname: `/_asset-file/system/ds/assets/logos/mark-${i}.svg`,
        method: 'PUT',
        token: minted.value,
        designRoot,
        body: Buffer.from('<svg/>'),
        checkRateLimit: () => false,
        checkWriteRateLimit: (label) => checkConnRateLimit(writeBuckets, label, 600),
      });
      assert.equal(checkout.status, 200, `checkout-route write #${i + 1} must pass`);
    }
    // …and every one of them is metered — the bucket is generous, not absent.
    assert.equal(writeBuckets.get('peer-a').count, 50);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('the write bucket still has a ceiling — the (max+1)th write is 429', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  const writeBuckets = new Map();
  const checkWriteRateLimit = (label) => checkConnRateLimit(writeBuckets, label, 3);
  try {
    for (let i = 0; i < 3; i++) {
      const ok = await call({
        pathname: `/assets/burst-${i}.png`,
        method: 'PUT',
        token: minted.value,
        designRoot,
        body: Buffer.from('x'),
        checkWriteRateLimit,
      });
      assert.equal(ok.status, 200);
    }
    const over = await call({
      pathname: '/assets/burst-3.png',
      method: 'PUT',
      token: minted.value,
      designRoot,
      body: Buffer.from('x'),
      checkWriteRateLimit,
    });
    assert.equal(over.status, 429, 'the ceiling is real');
    assert.equal(over.headers['Retry-After'], '60');
    assert.equal(
      existsSync(join(designRoot, 'assets/burst-3.png')),
      false,
      'a refused write touches no disk'
    );
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('the write bucket is PER LABEL — one peer cannot starve another', async () => {
  const a = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const b = addToken(dataDir, { label: 'peer-b', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  const writeBuckets = new Map();
  const checkWriteRateLimit = (label) => checkConnRateLimit(writeBuckets, label, 1);
  try {
    const first = await call({
      pathname: '/assets/a.png',
      method: 'PUT',
      token: a.value,
      designRoot,
      body: Buffer.from('x'),
      checkWriteRateLimit,
    });
    assert.equal(first.status, 200);
    const aAgain = await call({
      pathname: '/assets/a2.png',
      method: 'PUT',
      token: a.value,
      designRoot,
      body: Buffer.from('x'),
      checkWriteRateLimit,
    });
    assert.equal(aAgain.status, 429, 'peer-a spent its own budget');
    const other = await call({
      pathname: '/assets/b.png',
      method: 'PUT',
      token: b.value,
      designRoot,
      body: Buffer.from('x'),
      checkWriteRateLimit,
    });
    assert.equal(other.status, 200, "peer-b's budget is its own");
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

/* -------- RCA 2026-08-11 part 2 — a HEAD does not reach a cell as a HEAD */

test('GET is a presence probe on the checkout route — existence, never bytes', async () => {
  // On a Cloud cell a HEAD arrives as GET, so GET has to answer the same
  // question. What it must NOT do is serve the file: that would turn a write
  // route into a read surface for the checkout.
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    mkdirSync(join(designRoot, 'system/ds/assets/logos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/assets/logos/there.svg'), '<svg>secret</svg>');
    const present = await callCheckout({
      pathname: '/_asset-file/system/ds/assets/logos/there.svg',
      method: 'GET',
      token: minted.value,
      designRoot,
    });
    assert.equal(present.status, 200);
    assert.equal(present.body, null, 'the probe answers existence, not the file');
    assert.equal(present.headers['Content-Length'], 0);
    const missing = await callCheckout({
      pathname: '/_asset-file/system/ds/assets/logos/nope.svg',
      method: 'GET',
      token: minted.value,
      designRoot,
    });
    assert.equal(missing.status, 404);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a GET probe is refused for an unauthenticated peer, like every other verb', async () => {
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    mkdirSync(join(designRoot, 'system/ds/assets/logos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/assets/logos/there.svg'), 'x');
    const res = await callCheckout({
      pathname: '/_asset-file/system/ds/assets/logos/there.svg',
      method: 'GET',
      designRoot,
    });
    assert.equal(res.status, 401);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('a GET probe cannot follow a symlink onto runtime state', async () => {
  // Same decision as the write (`resolveCheckoutFileWrite`): the probe judges
  // the REAL landing path, so a link onto `_history/` answers 400 exactly
  // like the write would — never an existence oracle for runtime state.
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-ck-'));
  try {
    mkdirSync(join(designRoot, '_history'), { recursive: true });
    writeFileSync(join(designRoot, '_history/welcome.png'), 'x');
    symlinkSync(join(designRoot, '_history'), join(designRoot, 'media'));
    const res = await callCheckout({
      pathname: '/_asset-file/media/welcome.png',
      method: 'GET',
      token: minted.value,
      designRoot,
    });
    assert.equal(res.status, 400, 'the probe obeys the same admission as the write');
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

test('the UNAUTHENTICATED path keeps the tight per-IP bucket (and says Retry-After)', async () => {
  // The brute-force control the write lane was wrongly sharing. It stays.
  const designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-put-'));
  try {
    const bucket = await call({
      pathname: '/assets/x.png',
      method: 'PUT',
      designRoot,
      body: Buffer.from('x'),
      checkRateLimit: () => false,
      checkWriteRateLimit: () => true,
    });
    assert.equal(bucket.status, 429, 'an unauthenticated storm is still throttled');
    assert.equal(bucket.headers['Retry-After'], '60');
    const checkout = await callCheckout({
      pathname: '/_asset-file/system/ds/assets/logos/x.svg',
      method: 'PUT',
      designRoot,
      body: Buffer.from('x'),
      checkRateLimit: () => false,
      checkWriteRateLimit: () => true,
    });
    assert.equal(checkout.status, 429);
    assert.equal(existsSync(join(designRoot, 'assets/x.png')), false);
  } finally {
    rmSync(designRoot, { recursive: true, force: true });
  }
});

/* ------------- cell materializer Task 11 — on a cell the disk is a cache */

async function callCell({ pathname, method = 'GET', token, materializer, designRoot = null }) {
  const { Writable } = await import('node:stream');
  const chunks = [];
  let status = 0;
  let headers = {};
  const response = new Writable({
    write(c, _e, cb) {
      chunks.push(Buffer.from(c));
      cb();
    },
  });
  response.writeHead = (s, h = {}) => {
    status = s;
    headers = h;
    return response;
  };
  const finished = new Promise((r) => response.on('finish', r));
  await handleAssetRoute({
    request: { headers: { authorization: `Bearer ${token}` } },
    response,
    pathname,
    method,
    dataDir,
    secret: '',
    s3: { bucket: 'b' },
    designRoot,
    materializer,
  });
  await finished;
  return { status, headers, body: Buffer.concat(chunks) };
}

test('CELL: a checkout miss is materialized, verified bytes STREAMED — not the bucket buffer', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  const blobDir = mkdtempSync(join(tmpdir(), 'maude-hub-blob-'));
  try {
    const blob = join(blobDir, 'a'.repeat(64));
    writeFileSync(blob, 'verified bytes');
    const asked = [];
    const materializer = {
      materialize: async (rel) => {
        asked.push(rel);
        return { path: blob, sha: 'a'.repeat(64), size: 14 };
      },
    };
    // Something IS in the bucket under this key — and must not be what is
    // served: bucket bytes reach a client only through the verifying cache.
    store.set('assets/deadbeef.png', Buffer.from('UNVERIFIED BUCKET BYTES'));
    const res = await callCell({
      pathname: '/assets/deadbeef.png',
      token: minted.value,
      materializer,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), 'verified bytes');
    assert.equal(res.headers['Content-Type'], 'image/png');
    assert.match(res.headers['Cache-Control'], /immutable/);
    assert.deepEqual(asked, ['assets/deadbeef.png']);
  } finally {
    rmSync(blobDir, { recursive: true, force: true });
  }
});

test('CELL: a mismatch or an unknown asset is 404, a fill in progress is 503 + Retry-After', async () => {
  const minted = addToken(dataDir, { label: 'peer-a', scope: '*' });
  store.set('assets/deadbeef.png', Buffer.from('bucket has something'));
  for (const miss of ['mismatch', 'absent', 'unmirrored']) {
    const res = await callCell({
      pathname: '/assets/deadbeef.png',
      token: minted.value,
      materializer: { materialize: async () => ({ miss }) },
    });
    assert.equal(res.status, 404, miss); // DDR-224 amended: no unverified fallback on a cell
  }
  const res = await callCell({
    pathname: '/assets/deadbeef.png',
    token: minted.value,
    materializer: { materialize: async () => ({ miss: 'timeout' }) },
  });
  assert.equal(res.status, 503);
  assert.equal(res.headers['Retry-After'], '5');
});
