// V2-1.16 L1 — the plane-B file plane, peer door (S9.4).
//
// A canvas-only token for canvas A lists, pulls and probes only A's closure.
// B's files are absent from the journal and the manifest and answer 404 on
// `/_project-file/` exactly as a missing path does (U1); a write to B's sidecar,
// an overwrite of an asset A shares with B, and a write to a missing path all get
// the one `403 not-in-scope`. The journal `head` it sees does not move when only
// B changes (U5). Project sessions answer exactly as before (U7).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { NOT_IN_SCOPE_REFUSAL } from '../src/access-gate.mjs';
import { A_VISIBLE, B_ONLY, bootAclHub, call } from './_acl-files-fixture.mjs';

let hub;
before(async () => {
  hub = await bootAclHub('maude-acl-l1');
});
after(async () => {
  await hub?.stop();
});

const paths = (rows) => rows.map((r) => r.path).sort();
const sha256hex = (b) => createHash('sha256').update(b).digest('hex');
const sha8 = (b) => sha256hex(b).slice(0, 8);
const png = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, n, n, n]);

describe('project sessions keep today’s file plane (U7)', () => {
  test('owner · member · viewer see every plane-B file in journal and manifest', async () => {
    const want = [...A_VISIBLE, ...B_ONLY].sort();
    for (const who of ['owner', 'member', 'viewer', 'observer']) {
      const journal = await call(hub, 'GET', '/api/journal?since=0', hub.tokens[who]);
      assert.equal(journal.status, 200, who);
      for (const p of want)
        assert.ok(paths(journal.body.entries).includes(p), `${who} journal ${p}`);
      const files = await call(hub, 'GET', '/api/files', hub.tokens[who]);
      assert.equal(files.status, 200, who);
      for (const p of want) assert.ok(paths(files.body.files).includes(p), `${who} manifest ${p}`);
    }
  });
});

describe('a canvas-only token sees only its closure', () => {
  test('journal: A’s closure, nothing of B', async () => {
    const r = await call(hub, 'GET', '/api/journal?since=0', hub.tokens.canvasA);
    assert.equal(r.status, 200);
    const got = paths(r.body.entries);
    for (const p of A_VISIBLE) assert.ok(got.includes(p), `missing ${p}`);
    for (const p of B_ONLY) assert.ok(!got.includes(p), `leaked ${p}`);
    assert.equal(r.body.truncated, false);
    // U5 — the head is the last VISIBLE seq.
    assert.equal(r.body.head, Math.max(...r.body.entries.map((e) => e.seq)));
  });

  test('manifest: A’s closure, nothing of B', async () => {
    const r = await call(hub, 'GET', '/api/files', hub.tokens.canvasA);
    assert.equal(r.status, 200);
    assert.deepEqual(paths(r.body.files), [...A_VISIBLE].sort());
    assert.equal(r.body.count, A_VISIBLE.length);
  });

  test('/_project-file/: A’s bytes; B’s answer exactly as a missing path', async () => {
    const a = await call(hub, 'GET', '/_project-file/assets/a-only.png', hub.tokens.canvasA);
    assert.equal(a.status, 200);
    const missing = await call(hub, 'GET', '/_project-file/assets/nope.png', hub.tokens.canvasA);
    assert.equal(missing.status, 404);
    for (const p of B_ONLY) {
      for (const method of ['GET', 'HEAD']) {
        const r = await call(hub, method, `/_project-file/${p}`, hub.tokens.canvasA);
        assert.equal(r.status, 404, `${method} ${p}`);
        if (method === 'GET') assert.deepEqual(r.body, missing.body, p);
      }
    }
  });

  test('a write to B’s sidecar, an A+B asset, or a missing path: one 403 not-in-scope', async () => {
    for (const p of ['assets/b-only.photo.json', 'assets/shared.png', 'ui/zz-missing.css']) {
      const r = await call(hub, 'PUT', `/api/file/${p}`, hub.tokens.canvasA, {
        body: p.endsWith('.png') ? png(9) : '{}',
      });
      assert.equal(r.status, 403, p);
      assert.deepEqual(r.body, NOT_IN_SCOPE_REFUSAL, p);
    }
    const del = await call(hub, 'DELETE', '/api/file/assets/b-only.png', hub.tokens.canvasA, {
      headers: { 'x-maude-expect-hash': 'none' },
    });
    assert.equal(del.status, 403);
    assert.deepEqual(del.body, NOT_IN_SCOPE_REFUSAL);
  });

  test('the legacy asset aliases are the same door', async () => {
    for (const path of ['/assets/b-only.png', '/_asset-file/assets/b-only.photo.json']) {
      const r = await call(hub, 'PUT', path, hub.tokens.canvasA, { body: png(7) });
      assert.equal(r.status, 403, path);
      assert.deepEqual(r.body, NOT_IN_SCOPE_REFUSAL, path);
    }
  });

  test('upload sessions admit only what the door would', async () => {
    const r = await call(hub, 'POST', '/api/file-uploads', hub.tokens.canvasA, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'assets/b-only.photo.json', size: 10, sha256: 'a'.repeat(64) }),
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, NOT_IN_SCOPE_REFUSAL);
  });

  test('a member grant may create a NEW asset only content-addressed (G2, L20)', async () => {
    const bytes = png(5);
    const name = `assets/${sha8(bytes)}.png`;
    const r = await call(hub, 'PUT', `/api/file/${name}`, hub.tokens.canvasA, { body: bytes });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.path, name);
  });

  // V2-5 sweep-fix (lead decision, option a): a free chosen name was written
  // while a name B's closure holds was refused, so the answer told a canvas-only
  // session which asset names exist. Now any name that is not `<sha8>.<ext>` of
  // the bytes sent gets the one refusal, whether or not it exists.
  test('a chosen or mismatched asset name: one refusal, existing or not', async () => {
    const bytes = png(8);
    const cases = [
      ['PUT', '/api/file/assets/new-from-a.png'], // free, chosen name
      ['PUT', '/api/file/assets/b-only.png'], // B's, chosen name
      ['PUT', `/api/file/assets/${sha8(png(99))}.png`], // free, someone else's hash
      ['PUT', '/assets/new-from-a-alias.png'], // the legacy alias
      ['PUT', '/_asset-file/assets/new-from-a-alias2.png'],
    ];
    for (const [method, path] of cases) {
      const r = await call(hub, method, path, hub.tokens.canvasA, { body: bytes });
      assert.equal(r.status, 403, path);
      assert.deepEqual(r.body, NOT_IN_SCOPE_REFUSAL, path);
    }
    const listed = await call(hub, 'GET', '/api/files', hub.tokens.owner);
    for (const [, path] of cases) {
      const rel = path.replace(/^\/(api\/file|_asset-file)\//, '').replace(/^\//, '');
      if (rel !== 'assets/b-only.png') {
        assert.ok(!paths(listed.body.files).includes(rel), `${rel} landed`);
      }
    }
  });

  test('upload sessions: the same content-addressed rule', async () => {
    const up = (path, sha256) =>
      call(hub, 'POST', '/api/file-uploads', hub.tokens.canvasA, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, size: 12, sha256 }),
      });
    const sha = sha256hex(png(3));
    for (const path of [
      'assets/new-upload.png',
      'assets/b-only.png',
      `assets/${'0'.repeat(8)}.png`,
    ]) {
      const r = await up(path, sha);
      assert.equal(r.status, 403, path);
      assert.deepEqual(r.body, NOT_IN_SCOPE_REFUSAL, path);
    }
    const ok = await up(`assets/${sha.slice(0, 8)}.png`, sha);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  test('a viewer grant writes nothing', async () => {
    const r = await call(
      hub,
      'PUT',
      '/api/file/assets/new-from-viewer.png',
      hub.tokens.canvasAViewer,
      {
        body: png(6),
      }
    );
    assert.equal(r.status, 403);
  });

  test('head does not move on a B-only write, and does on an A write (U5)', async () => {
    const before = (await call(hub, 'GET', '/api/journal?since=0', hub.tokens.canvasA)).body.head;
    const ownerBefore = (await call(hub, 'GET', '/api/journal?since=0', hub.tokens.owner)).body
      .head;
    const b = await call(hub, 'PUT', '/api/file/assets/b-only.png', hub.tokens.owner, {
      body: png(11),
    });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    const ownerAfter = (await call(hub, 'GET', '/api/journal?since=0', hub.tokens.owner)).body.head;
    assert.ok(ownerAfter > ownerBefore, 'the write was journaled');
    const mid = await call(hub, 'GET', `/api/journal?since=${before}`, hub.tokens.canvasA);
    assert.equal(mid.body.head, before, 'a B-only write is invisible');
    assert.deepEqual(mid.body.entries, []);
    // A cursor past the visible head is not in this session's log.
    const ahead = await call(hub, 'GET', `/api/journal?since=${ownerAfter}`, hub.tokens.canvasA);
    assert.equal(ahead.body.reanchor, true);
    assert.equal(ahead.body.head, before);
    const a = await call(hub, 'PUT', '/api/file/assets/a-only.png', hub.tokens.owner, {
      body: png(12),
    });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const moved = await call(hub, 'GET', `/api/journal?since=${before}`, hub.tokens.canvasA);
    assert.ok(moved.body.head > before);
    assert.deepEqual(paths(moved.body.entries), ['assets/a-only.png']);
  });
});
