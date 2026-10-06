// The file plane's hub half — the manifest (`GET /api/files`) and the read
// route (`GET /_project-file/<rel>`), feature-sync-file-plane.
//
// The properties worth proving are about what the routes REFUSE: an
// unauthenticated peer, a write method, a `never` path (config.json, runtime
// state), a CANVAS-OWNED path (plane disjointness at the source), traversal
// and symlink escapes, and out-of-scope names — plus that every post-auth
// refusal on the read route is the same 404 (no oracle).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  FILES_PATH,
  handleFilesRoute,
  handleProjectFileRoute,
  listProjectFiles,
  parseProjectFilePath,
  resolveProjectFileTarget,
} from '../src/file-manifest.mjs';
import { addToken, matchesScope } from '../src/tokens.mjs';

let dataDir;
let designRoot;
let outside;

/** The RCA fixture shape: a canvas + the 103-file gap's representatives. */
function seedTree(root) {
  mkdirSync(join(root, 'system/ds/preview'), { recursive: true });
  mkdirSync(join(root, 'system/ds/assets/logos'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, '_history/junk'), { recursive: true });
  mkdirSync(join(root, '_untrusted'), { recursive: true });
  writeFileSync(join(root, 'config.json'), '{"canvasGroups":[{"path":"ui"},{"path":"system"}]}');
  writeFileSync(join(root, 'system/ds/brand.css'), ':root { --bg-0: #fff }');
  writeFileSync(join(root, 'system/ds/README.md'), '# ds');
  writeFileSync(join(root, 'system/ds/preview/_brand-css.ts'), 'export {}');
  writeFileSync(join(root, 'system/ds/preview/_layout.css'), '.x{}');
  writeFileSync(join(root, 'system/ds/preview/specimen.tsx'), 'export default 1');
  writeFileSync(join(root, 'system/ds/preview/specimen.css'), '.spec{}');
  writeFileSync(join(root, 'system/ds/preview/specimen.meta.json'), '{}');
  writeFileSync(join(root, 'system/ds/assets/logos/logo.svg'), '<svg/>');
  writeFileSync(join(root, 'assets/c0fa9c7f.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(root, '_server.json'), '{}');
  writeFileSync(join(root, '_history/junk/old.tsx'), 'x');
  writeFileSync(join(root, '_untrusted/INDEX.json'), '{}');
  writeFileSync(join(root, '.DS_Store'), 'junk');
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-files-'));
  designRoot = mkdtempSync(join(tmpdir(), 'maude-hub-checkout-'));
  outside = mkdtempSync(join(tmpdir(), 'maude-hub-outside-'));
  seedTree(designRoot);
  writeFileSync(join(outside, 'secret.css'), 'body{}');
});

afterEach(() => {
  for (const d of [dataDir, designRoot, outside]) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// GET /api/files — the manifest
// ---------------------------------------------------------------------------

function callManifest(overrides = {}) {
  const sent = [];
  const handled = handleFilesRoute({
    path: FILES_PATH,
    method: 'GET',
    bearer: 'good',
    verify: (t) => (t === 'good' ? { scope: '*', label: 'peer' } : null),
    matchesScope,
    designRoot,
    respondJson: (status, payload) => sent.push({ status, payload }),
    ...overrides,
  });
  return { handled, sent };
}

describe('GET /api/files', () => {
  it('lists exactly the flowing classes, with hash + size + mtime + class', () => {
    const { handled, sent } = callManifest();
    assert.equal(handled, true);
    assert.equal(sent[0].status, 200);
    const byPath = new Map(sent[0].payload.files.map((f) => [f.path, f]));
    assert.deepEqual([...byPath.keys()].sort(), [
      'assets/c0fa9c7f.png',
      'system/ds/README.md',
      'system/ds/assets/logos/logo.svg',
      'system/ds/brand.css',
      'system/ds/preview/_brand-css.ts',
      'system/ds/preview/_layout.css',
    ]);
    const brand = byPath.get('system/ds/brand.css');
    assert.equal(brand.class, 'companion-text');
    assert.equal(brand.sha256, createHash('sha256').update(':root { --bg-0: #fff }').digest('hex'));
    assert.equal(brand.size, Buffer.byteLength(':root { --bg-0: #fff }'));
    assert.equal(typeof brand.mtimeMs, 'number');
    assert.equal(byPath.get('system/ds/preview/_brand-css.ts').class, 'code-module');
    assert.equal(byPath.get('system/ds/assets/logos/logo.svg').class, 'inert-media');
  });

  it('a canvas body and its sidecars NEVER appear — plane disjointness at the source', () => {
    const { sent } = callManifest();
    const paths = sent[0].payload.files.map((f) => f.path);
    for (const owned of [
      'system/ds/preview/specimen.tsx',
      'system/ds/preview/specimen.css',
      'system/ds/preview/specimen.meta.json',
    ]) {
      assert.ok(!paths.includes(owned), `${owned} must not be offered on plane B`);
    }
  });

  it('config.json and runtime state never appear', () => {
    const { sent } = callManifest();
    const paths = sent[0].payload.files.map((f) => f.path);
    for (const never of [
      'config.json',
      '_server.json',
      '_history/junk/old.tsx',
      '_untrusted/INDEX.json',
      '.DS_Store',
    ]) {
      assert.ok(!paths.includes(never), `${never} must never be offered`);
    }
  });

  it('refuses a missing and an invalid token identically', () => {
    const missing = callManifest({ bearer: null });
    const bad = callManifest({ bearer: 'nope' });
    assert.equal(missing.sent[0].status, 401);
    assert.equal(bad.sent[0].status, 401);
    assert.deepEqual(missing.sent[0].payload, bad.sent[0].payload);
  });

  it('is read-only: a write method is refused, not served', () => {
    const { sent } = callManifest({ method: 'POST' });
    assert.equal(sent[0].status, 405);
  });

  it('declines paths that are not its own', () => {
    const { handled, sent } = callManifest({ path: '/api/documents' });
    assert.equal(handled, false);
    assert.equal(sent.length, 0);
  });

  it('a hub with no checkout answers an empty manifest, not an error', () => {
    const { sent } = callManifest({ designRoot: null });
    assert.equal(sent[0].status, 200);
    assert.deepEqual(sent[0].payload, { files: [], count: 0 });
  });

  it('scope-filters entries exactly like the documents listing', () => {
    const { sent } = callManifest({
      verify: () => ({ scope: 'system', label: 'scoped' }),
    });
    const paths = sent[0].payload.files.map((f) => f.path);
    assert.ok(paths.length > 0);
    for (const p of paths) assert.ok(p.startsWith('system/'), `${p} escaped the scope`);
    assert.ok(!paths.includes('assets/c0fa9c7f.png'));
  });
});

describe('listProjectFiles', () => {
  it('honours the declared canvasGroups from the checkout config.json', () => {
    // `config.json` declares ui+system; a css beside a tsx inside those
    // groups is canvas-owned and stays out. The walk proved that above; here
    // prove the OTHER direction — with no config, the default groups apply.
    rmSync(join(designRoot, 'config.json'));
    const { files } = listProjectFiles(designRoot);
    const paths = files.map((f) => f.path);
    assert.ok(!paths.includes('system/ds/preview/specimen.css'));
    assert.ok(paths.includes('system/ds/brand.css'));
  });
});

// ---------------------------------------------------------------------------
// GET /_project-file/<rel> — the read route
// ---------------------------------------------------------------------------

function makeResponse() {
  const captured = { status: 0, headers: {}, chunks: [], destroyed: false };
  const response = new Writable({
    write(chunk, _enc, cb) {
      captured.chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  response.writeHead = (status, headers) => {
    captured.status = status;
    captured.headers = headers ?? {};
    return response;
  };
  const origDestroy = response.destroy.bind(response);
  response.destroy = () => {
    captured.destroyed = true;
    return origDestroy();
  };
  captured.body = () => Buffer.concat(captured.chunks);
  return { response, captured };
}

async function callRead({
  rel,
  method = 'GET',
  token,
  root = () => designRoot,
  checkRateLimit,
  checkReadRateLimit,
  rawPath,
  materializer,
  range,
} = {}) {
  const { response, captured } = makeResponse();
  const handled = await handleProjectFileRoute({
    request: {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(range ? { range } : {}),
      },
    },
    response,
    pathname: rawPath ?? `/_project-file/${rel.split('/').map(encodeURIComponent).join('/')}`,
    method,
    dataDir,
    secret: '',
    designRoot: root(),
    matchesScope,
    checkRateLimit,
    checkReadRateLimit,
    materializer,
  });
  return { handled, ...captured };
}

describe('GET /_project-file/<rel>', () => {
  let token;
  beforeEach(() => {
    token = addToken(dataDir, { label: 'peer', scope: '*' }).value;
  });

  it('serves a companion stylesheet with the read-only header set', async () => {
    const r = await callRead({ rel: 'system/ds/brand.css', token });
    assert.equal(r.handled, true);
    assert.equal(r.status, 200);
    assert.equal(r.body().toString(), ':root { --bg-0: #fff }');
    assert.equal(r.headers['Content-Type'], 'text/css; charset=utf-8');
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(r.headers['Content-Disposition'], 'attachment');
  });

  it('serves a code module as inert bytes, never something runnable', async () => {
    const r = await callRead({ rel: 'system/ds/preview/_brand-css.ts', token });
    assert.equal(r.status, 200);
    assert.equal(r.headers['Content-Type'], 'application/octet-stream');
  });

  it('HEAD answers the headers and no body', async () => {
    const r = await callRead({ rel: 'system/ds/brand.css', token, method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(Number(r.headers['Content-Length']), Buffer.byteLength(':root { --bg-0: #fff }'));
    assert.equal(r.body().length, 0);
  });

  it('is read-only by construction — every write method is 405', async () => {
    for (const method of ['PUT', 'POST', 'DELETE', 'PATCH']) {
      const r = await callRead({ rel: 'system/ds/brand.css', token, method });
      assert.equal(r.status, 405, method);
    }
  });

  it('refuses a missing and an invalid token identically', async () => {
    const missing = await callRead({ rel: 'system/ds/brand.css' });
    const bad = await callRead({ rel: 'system/ds/brand.css', token: 'nope' });
    assert.equal(missing.status, 401);
    assert.equal(bad.status, 401);
  });

  it('a never path, a canvas-owned path, and an absent file are ONE answer: 404', async () => {
    const refusals = [
      'config.json', // trust anchors
      '_server.json', // runtime state
      '_untrusted/INDEX.json',
      '_history/junk/old.tsx',
      'system/ds/preview/specimen.tsx', // canvas body — plane A's
      'system/ds/preview/specimen.css', // its sibling css lane
      'system/ds/preview/specimen.meta.json',
      'system/ds/absent.css', // classifiable, simply not there
      '.DS_Store',
    ];
    for (const rel of refusals) {
      const r = await callRead({ rel, token });
      assert.equal(r.status, 404, rel);
      assert.equal(r.body().toString(), JSON.stringify({ error: 'not found' }), rel);
    }
  });

  it('traversal shapes cannot leave the checkout, encoded or raw', async () => {
    for (const rawPath of [
      '/_project-file/../hub.db',
      '/_project-file/..%2f..%2fhub.db',
      '/_project-file/system%2F..%2F..%2Fsecret.css',
      '/_project-file/%2e%2e/secret.css',
    ]) {
      const r = await callRead({ rel: 'x', rawPath, token });
      assert.equal(r.status, 404, rawPath);
    }
  });

  it('a symlinked directory inside the checkout cannot reach outside it', async () => {
    // A peer can COMMIT a symlink into the shared repo (DDR-054) — the
    // realpath containment is what actually decides.
    symlinkSync(outside, join(designRoot, 'linked'));
    const r = await callRead({ rel: 'linked/secret.css', token });
    assert.equal(r.status, 404);
  });

  it('a FINAL-component symlink to an in-root never file is refused, not followed', async () => {
    // The one confirmed read-route blocker (security review 2026-08-14): a
    // leaf symlink whose target stays INSIDE the design root passes
    // containment, and its class is judged on the LINK name (a flowing
    // class). Without lstat, statSync/createReadStream would FOLLOW it and
    // serve the target's bytes — config.json, runtime state, a CRDT body.
    mkdirSync(join(designRoot, 'assets/logos'), { recursive: true });
    symlinkSync(join(designRoot, 'config.json'), join(designRoot, 'assets/logos/logo.svg'));
    symlinkSync(join(designRoot, '_server.json'), join(designRoot, 'assets/logos/rt.png'));
    symlinkSync(
      join(designRoot, 'system/ds/preview/specimen.tsx'),
      join(designRoot, 'assets/logos/body.svg')
    );
    for (const rel of ['assets/logos/logo.svg', 'assets/logos/rt.png', 'assets/logos/body.svg']) {
      const r = await callRead({ rel, token });
      assert.equal(r.status, 404, rel);
      // proves it did NOT serve the linked target's bytes
      assert.equal(r.body().toString(), JSON.stringify({ error: 'not found' }), rel);
    }
  });

  it('an out-of-scope path answers exactly like an absent one', async () => {
    const scoped = addToken(dataDir, { label: 'scoped', scope: 'system' }).value;
    const inScope = await callRead({ rel: 'system/ds/brand.css', token: scoped });
    assert.equal(inScope.status, 200);
    const outOfScope = await callRead({ rel: 'assets/c0fa9c7f.png', token: scoped });
    assert.equal(outOfScope.status, 404);
    assert.equal(outOfScope.body().toString(), JSON.stringify({ error: 'not found' }));
  });

  it('rides the generous per-label bucket, answering 429 when it is spent', async () => {
    const r = await callRead({
      rel: 'system/ds/brand.css',
      token,
      checkReadRateLimit: () => false,
    });
    assert.equal(r.status, 429);
    assert.equal(r.headers['Retry-After'], '60');
  });

  it('a hub with no checkout answers 404, not an error', async () => {
    const r = await callRead({ rel: 'system/ds/brand.css', token, root: () => null });
    assert.equal(r.status, 404);
  });

  it('declines paths that are not its own', async () => {
    const r = await callRead({ rel: 'x', rawPath: '/api/documents', token });
    assert.equal(r.handled, false);
  });
});

describe('resolveProjectFileTarget / parseProjectFilePath', () => {
  it('resolves a contained path to its real on-disk location', () => {
    const target = resolveProjectFileTarget(designRoot, 'system/ds/brand.css');
    assert.equal(target.ok, true);
    assert.ok(target.abs.endsWith(join('system', 'ds', 'brand.css')));
  });

  it('refuses escapes, lexical and real', () => {
    assert.equal(resolveProjectFileTarget(designRoot, '../outside.css').ok, false);
    symlinkSync(outside, join(designRoot, 'sneaky'));
    assert.equal(resolveProjectFileTarget(designRoot, 'sneaky/secret.css').ok, false);
  });

  it('parses only its own prefix, refusing malformed encodings', () => {
    assert.equal(parseProjectFilePath('/_project-file/a/b.css'), 'a/b.css');
    assert.equal(parseProjectFilePath('/_project-file/a%2Fb.css'), 'a/b.css');
    assert.equal(parseProjectFilePath('/_project-file/'), null);
    assert.equal(parseProjectFilePath('/_project-file/%zz'), null);
    assert.equal(parseProjectFilePath('/api/files'), null);
  });
});

// Cell materializer Task 11 — on a cell the disk is a cache.
describe('CELL MODE: the read paths answer from the journal and the bucket', () => {
  let token;
  beforeEach(() => {
    token = addToken(dataDir, { label: 'peer', scope: '*' }).value;
  });

  it('/_project-file: a disk miss for inert media streams the materialized blob, with Range', async () => {
    const blob = join(outside, 'f'.repeat(64));
    writeFileSync(blob, '0123456789');
    const asked = [];
    const materializer = {
      materialize: async (rel) => {
        asked.push(rel);
        return { path: blob, sha: 'f'.repeat(64), size: 10 };
      },
    };
    const whole = await callRead({ rel: 'system/ds/assets/photo.jpg', token, materializer });
    assert.equal(whole.status, 200);
    assert.equal(whole.body().toString(), '0123456789');
    const part = await callRead({
      rel: 'system/ds/assets/photo.jpg',
      token,
      materializer,
      range: 'bytes=2-4',
    });
    assert.equal(part.status, 206);
    assert.equal(part.body().toString(), '234');
    assert.deepEqual(asked, ['system/ds/assets/photo.jpg', 'system/ds/assets/photo.jpg']);
  });

  it('/_project-file: a file ON disk never asks; code and css never take the hop', async () => {
    const materializer = {
      materialize: async () => assert.fail('the materializer must not be asked'),
    };
    const onDisk = await callRead({ rel: 'system/ds/brand.css', token, materializer });
    assert.equal(onDisk.status, 200);
    const missingCss = await callRead({ rel: 'system/ds/gone.css', token, materializer });
    assert.equal(missingCss.status, 404);
  });

  it('/_project-file: a fill in progress is a HOLD (503), not "the hub lost it" (404)', async () => {
    const r = await callRead({
      rel: 'system/ds/assets/photo.jpg',
      token,
      materializer: { materialize: async () => ({ miss: 'timeout' }) },
    });
    assert.equal(r.status, 503);
    assert.equal(r.headers['Retry-After'], '5');
  });

  it('/api/files: inert media is listed from the JOURNAL, never hashed off the cache', () => {
    const journal = {
      compaction: () => [
        // On disk in the fixture, but the journal is the word on a cell.
        {
          path: 'assets/c0fa9c7f.png',
          sha256: 'a'.repeat(64),
          size: 4,
          class: 'inert-media',
          deleted: false,
        },
        // Not on disk at all — budget-skipped, in the bucket.
        {
          path: 'system/ds/assets/big.jpg',
          sha256: 'b'.repeat(64),
          size: 9e8,
          class: 'inert-media',
          deleted: false,
        },
        {
          path: 'system/ds/assets/gone.jpg',
          sha256: null,
          size: null,
          class: 'inert-media',
          deleted: true,
        },
      ],
    };
    const { sent } = callManifest({ inertFromJournal: journal });
    const byPath = new Map(sent[0].payload.files.map((f) => [f.path, f]));
    assert.equal(byPath.get('assets/c0fa9c7f.png').sha256, 'a'.repeat(64));
    assert.equal(byPath.get('system/ds/assets/big.jpg').size, 9e8);
    assert.equal(byPath.has('system/ds/assets/gone.jpg'), false);
    // Non-media classes still come off the disk.
    assert.ok(byPath.has('system/ds/brand.css'));
    // A disk-only inert file the journal does not list is the cache's, not the project's.
    assert.equal(byPath.has('system/ds/assets/logos/logo.svg'), false);
  });
});
