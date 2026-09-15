// The single file write door — Sync v2 (DDR-226 §5).
//
// Two things justify a new door beside the existing ones, and both are tested
// here because both are safety properties rather than conveniences:
//
//   • **Compare-and-swap.** Without it, two peers editing one file inside a
//     poll round-trip resolve as silent last-writer-wins AT THE DOOR — no
//     conflict copy materializes anywhere, and "both ends SEE it" is false in
//     exactly the concurrent case the guarantee exists for.
//   • **The owner gate on code modules.** Until now the receiver gated them and
//     the door did not, so any peer token could land executable modules in a
//     project's `system/**` and the only thing stopping them was that other
//     peers would decline to pull them. A gate on one side is half a gate.
//
// Everything else the door does — shape, containment, class admission, caps —
// is DDR-217's, unchanged, and is covered where those rules live.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  handleFileDoor,
  parseFileDoorPath,
  quotaFor,
  quotaSnapshot,
  resetQuotas,
} from '../src/file-door.mjs';
import { closeJournal, openJournal } from '../src/journal.mjs';
import { addToken } from '../src/tokens.mjs';

let dataDir;
let designRoot;
let token;
let ownerToken;

const sha = (s) => createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'file-door-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'file-door-root-'));
  mkdirSync(join(designRoot, 'system/ds/preview'), { recursive: true });
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), '{"canvasGroups":[{"path":"system"}]}');
  token = addToken(dataDir, { label: 'peer', scope: '*' }).value;
  ownerToken = addToken(dataDir, { label: 'owner-peer', scope: '*', role: 'owner' }).value;
});

afterEach(() => {
  closeJournal(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

/** A request/response pair the door can answer into. */
function exchange({ rel, body = 'BYTES', headers = {}, method = 'PUT', bearer = token }) {
  const chunks = body === null ? [] : [Buffer.from(body)];
  const request = {
    headers: { authorization: bearer ? `Bearer ${bearer}` : undefined, ...headers },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
  let status = 0;
  let payload = '';
  const response = new Writable({
    write(c, _e, cb) {
      payload += c;
      cb();
    },
  });
  response.writeHead = (s) => {
    status = s;
    return response;
  };
  return {
    request,
    response,
    method,
    pathname: `/api/file/${rel}`,
    result: () => ({ status, json: payload ? JSON.parse(payload) : null }),
  };
}

const call = async (ex, over = {}) => {
  const journal = openJournal(dataDir);
  const handled = await handleFileDoor({
    request: ex.request,
    response: ex.response,
    pathname: ex.pathname,
    method: ex.method,
    dataDir,
    secret: '',
    designRoot,
    journal,
    onWritten: ({ path }) => journal.recordWrite({ designRoot, path, source: 'peer-put' }),
    onDeleted: ({ path }) =>
      journal.recordWrite({ designRoot, path, source: 'peer-put', deleted: true }),
    ...over,
  });
  return { handled, ...ex.result() };
};

describe('parseFileDoorPath', () => {
  it('accepts an ordinary project path', () => {
    assert.equal(parseFileDoorPath('/api/file/system/ds/brand.css'), 'system/ds/brand.css');
  });

  it('refuses traversal, absolutes and control characters outright', () => {
    for (const p of [
      '/api/file/../../etc/passwd',
      '/api/file//etc/passwd',
      '/api/file/a/./b',
      '/api/file/a/../b',
      '/api/file/',
      '/api/files/x',
    ]) {
      assert.equal(parseFileDoorPath(p), null, p);
    }
  });

  it('is not this handler’s business for another route', () => {
    assert.equal(parseFileDoorPath('/api/journal'), null);
  });
});

describe('the door writes, and answers with a receipt', () => {
  it('lands the bytes and returns the seq the doručenka needs', async () => {
    const res = await call(exchange({ rel: 'system/ds/brand.css', body: ':root{}' }));
    assert.equal(res.status, 200);
    assert.equal(res.json.sha256, sha(':root{}'));
    assert.equal(typeof res.json.seq, 'number');
    assert.equal(readFileSync(join(designRoot, 'system/ds/brand.css'), 'utf8'), ':root{}');
  });

  it('refuses a body whose declared hash is not what arrived', async () => {
    // A declared hash is a claim; the bytes are the fact. A mismatch is a
    // truncated or tampered upload and the partial is discarded, not kept.
    const res = await call(
      exchange({
        rel: 'system/ds/brand.css',
        body: 'real bytes',
        headers: { 'x-maude-content-sha256': sha('different bytes') },
      })
    );
    assert.equal(res.status, 400);
    assert.equal(existsSync(join(designRoot, 'system/ds/brand.css')), false);
  });

  it('refuses a read-only token', async () => {
    const ro = addToken(dataDir, { label: 'viewer', scope: '*', readOnly: true }).value;
    const res = await call(exchange({ rel: 'system/ds/brand.css', bearer: ro }));
    assert.equal(res.status, 403);
  });

  it('a missing credential and a bad one are the same answer', async () => {
    for (const bearer of [null, 'mau_nope']) {
      const res = await call(exchange({ rel: 'system/ds/brand.css', bearer }));
      assert.equal(res.status, 401);
    }
  });

  it('refuses a path the classifier does not admit', async () => {
    // `config.json` is `never`: a hub that can write it can re-point the sync.
    const res = await call(exchange({ rel: 'config.json', body: '{}' }));
    assert.equal(res.status, 400);
    assert.match(readFileSync(join(designRoot, 'config.json'), 'utf8'), /canvasGroups/);
  });

  it('a disk that refuses the write is answered at once, not left hanging (plan T31/L22)', async () => {
    // The temp file cannot be created in a folder the hub may not write to.
    // The stream's error was swallowed and the write then waited for a
    // `drain` that never came, so the peer timed out on every attempt and
    // its person saw nothing but a slow "waiting".
    mkdirSync(join(designRoot, 'system/locked'), { recursive: true });
    chmodSync(join(designRoot, 'system/locked'), 0o555);
    try {
      const big = 'x'.repeat(4 * 1024 * 1024);
      const t0 = Date.now();
      const res = await Promise.race([
        call(exchange({ rel: 'system/locked/brand.css', body: big })),
        new Promise((r) => setTimeout(() => r({ status: 'hung' }), 5000)),
      ]);
      assert.equal(res.status, 500);
      assert.ok(Date.now() - t0 < 5000);
      assert.equal(existsSync(join(designRoot, 'system/locked/brand.css')), false);
    } finally {
      chmodSync(join(designRoot, 'system/locked'), 0o755);
    }
  });

  it('refuses a method that is not PUT', async () => {
    const res = await call(exchange({ rel: 'system/ds/brand.css', method: 'GET' }));
    assert.equal(res.status, 405);
  });
});

describe('compare-and-swap — why this door exists', () => {
  it('"the hub must hold nothing" succeeds on a first write', async () => {
    const res = await call(
      exchange({
        rel: 'system/ds/brand.css',
        body: 'v1',
        headers: { 'x-maude-expect-hash': 'none' },
      })
    );
    assert.equal(res.status, 200);
  });

  it('…and is REFUSED once the hub holds something', async () => {
    await call(exchange({ rel: 'system/ds/brand.css', body: 'v1' }));
    const res = await call(
      exchange({
        rel: 'system/ds/brand.css',
        body: 'v2',
        headers: { 'x-maude-expect-hash': 'none' },
      })
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.current, sha('v1'));
    // The bytes on disk are untouched — a refused CAS writes nothing.
    assert.equal(readFileSync(join(designRoot, 'system/ds/brand.css'), 'utf8'), 'v1');
  });

  it('an expectation that MATCHES lands', async () => {
    await call(exchange({ rel: 'system/ds/brand.css', body: 'v1' }));
    const res = await call(
      exchange({
        rel: 'system/ds/brand.css',
        body: 'v2',
        headers: { 'x-maude-expect-hash': sha('v1') },
      })
    );
    assert.equal(res.status, 200);
    assert.equal(readFileSync(join(designRoot, 'system/ds/brand.css'), 'utf8'), 'v2');
  });

  it('a STALE expectation is refused, and the answer says what to re-decide against', async () => {
    // The live-concurrent case: we decided from v1, somebody landed v2, and
    // our upload must not silently become v3-over-v2.
    await call(exchange({ rel: 'system/ds/brand.css', body: 'v1' }));
    await call(exchange({ rel: 'system/ds/brand.css', body: 'v2' }));
    const res = await call(
      exchange({
        rel: 'system/ds/brand.css',
        body: 'mine',
        headers: { 'x-maude-expect-hash': sha('v1') },
      })
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.current, sha('v2'));
    assert.equal(readFileSync(join(designRoot, 'system/ds/brand.css'), 'utf8'), 'v2');
  });

  it('NO expectation still works — an older client is not locked out', async () => {
    // The compat matrix is binding: a peer that predates CAS keeps writing.
    await call(exchange({ rel: 'system/ds/brand.css', body: 'v1' }));
    const res = await call(exchange({ rel: 'system/ds/brand.css', body: 'v2' }));
    assert.equal(res.status, 200);
  });
});

describe('the owner gate on code modules — new, and at the DOOR', () => {
  it('an ordinary peer token cannot land executable modules', async () => {
    const res = await call(
      exchange({ rel: 'system/ds/preview/_x.ts', body: 'export const a = 1' })
    );
    assert.equal(res.status, 403);
    assert.equal(existsSync(join(designRoot, 'system/ds/preview/_x.ts')), false);
  });

  it('an owner-scoped one can', async () => {
    const res = await call(
      exchange({
        rel: 'system/ds/preview/_x.ts',
        body: 'export const a = 1',
        bearer: ownerToken,
      })
    );
    assert.equal(res.status, 200);
    assert.equal(existsSync(join(designRoot, 'system/ds/preview/_x.ts')), true);
  });

  it('and the gate is about the CLASS, not the caller’s luck with a path', async () => {
    // Media is admitted for any writer; the gate is narrow on purpose.
    const res = await call(exchange({ rel: 'assets/x.png', body: 'PNG' }));
    assert.equal(res.status, 200);
  });
});

describe('a hub with no checkout', () => {
  it('answers 405 rather than pretending to accept', async () => {
    const res = await call(exchange({ rel: 'system/ds/brand.css' }), {
      designRoot: null,
      journal: null,
    });
    assert.equal(res.status, 405);
  });
});

describe('the gates are asked about where the bytes LAND, not what the peer typed', () => {
  // DDR-054's stated model: a peer can COMMIT a symlink into the shared repo.
  // Admission already classifies the symlink-resolved path — so every later
  // gate has to ask about the same one, or the two disagree exactly where the
  // threat lives.
  it('a directory symlink cannot walk a code module past the owner gate', async () => {
    // A `.tsx` INSIDE a canvas group is canvas-owned (Plane A's business); the
    // same name OUTSIDE one is a code module. So a symlink out of the group is
    // all it takes to make the lexical class and the real class disagree —
    // admission judges the real one and admits, and the owner gate, asked
    // about the lexical one, sees nothing to gate.
    writeFileSync(join(designRoot, 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    mkdirSync(join(designRoot, 'lib'), { recursive: true });
    symlinkSync(join(designRoot, 'lib'), join(designRoot, 'ui/shared'), 'dir');

    const res = await call(exchange({ rel: 'ui/shared/payload.tsx', body: 'export default 1' }));
    assert.equal(res.status, 403, 'a non-owner may not land a module outside the canvas groups');
    assert.equal(existsSync(join(designRoot, 'lib/payload.tsx')), false);
  });

  it('an owner may — the gate is about the role, not the symlink', async () => {
    writeFileSync(join(designRoot, 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    mkdirSync(join(designRoot, 'lib'), { recursive: true });
    symlinkSync(join(designRoot, 'lib'), join(designRoot, 'ui/shared'), 'dir');

    const res = await call(
      exchange({ rel: 'ui/shared/payload.tsx', body: 'export default 1', bearer: ownerToken })
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.path, 'lib/payload.tsx', 'the receipt names where the bytes went');
  });

  it('and the receipt names the real landing path, so one file cannot alias two CAS states', async () => {
    mkdirSync(join(designRoot, 'media'), { recursive: true });
    symlinkSync(join(designRoot, 'assets'), join(designRoot, 'media/shared'), 'dir');

    const res = await call(exchange({ rel: 'media/shared/x.png', body: 'PNG' }));
    assert.equal(res.status, 200);
    assert.equal(res.json.path, 'assets/x.png');
  });
});

describe('scope confines the WRITE half too, not only the read half', () => {
  it('a token scoped to one canvas may not write the whole project', async () => {
    const scoped = addToken(dataDir, { label: 'alice', scope: 'ui/alice' }).value;
    const res = await call(
      exchange({ rel: 'system/ds/brand.css', body: ':root{}', bearer: scoped })
    );
    assert.equal(res.status, 403);
    assert.equal(existsSync(join(designRoot, 'system/ds/brand.css')), false);
  });

  it('inside its own scope it writes normally', async () => {
    writeFileSync(
      join(designRoot, 'config.json'),
      '{"canvasGroups":[{"path":"ui"},{"path":"system"}]}'
    );
    mkdirSync(join(designRoot, 'ui/alice'), { recursive: true });
    const scoped = addToken(dataDir, { label: 'alice', scope: 'ui/alice' }).value;
    const res = await call(exchange({ rel: 'ui/alice/note.md', body: '# hi', bearer: scoped }));
    assert.equal(res.status, 200);
  });
});

describe('compare-and-swap survives the body upload, not just the check', () => {
  it('a crossing write is refused instead of silently overwriting', async () => {
    // Both peers decided from the same state: the file is absent.
    const first = call(exchange({ rel: 'system/ds/a.css', body: 'FIRST' }), {
      headers: {},
    });
    // Start the second before the first has published. Both passed the
    // pre-check; only one may publish.
    const a = exchange({ rel: 'system/ds/a.css', body: 'FIRST' });
    a.request.headers['x-maude-expect-hash'] = 'none';
    const b = exchange({ rel: 'system/ds/a.css', body: 'SECOND' });
    b.request.headers['x-maude-expect-hash'] = 'none';
    await first;

    const [ra, rb] = await Promise.all([call(a), call(b)]);
    const codes = [ra.status, rb.status].sort();
    assert.deepEqual(codes, [409, 409], 'the file already exists — both are stale');
  });

  it('two simultaneous first-writes leave exactly one winner', async () => {
    const a = exchange({ rel: 'system/ds/b.css', body: 'A' });
    a.request.headers['x-maude-expect-hash'] = 'none';
    const b = exchange({ rel: 'system/ds/b.css', body: 'B' });
    b.request.headers['x-maude-expect-hash'] = 'none';

    const [ra, rb] = await Promise.all([call(a), call(b)]);
    const codes = [ra.status, rb.status].sort();
    assert.deepEqual(codes, [200, 409], 'one publishes, the other is told it collided');
  });
});

describe('the write quota is per token and per window, not per process forever', () => {
  beforeEach(() => resetQuotas());
  afterEach(() => resetQuotas());

  it('one token exhausting its quota does not lock the door for anyone else', async () => {
    // The old shape was a single module-level counter shared by every token
    // and never decayed: 2 GiB of entirely legitimate cumulative writes and
    // the door answered 507 for the whole tenant until the process restarted.
    const mine = quotaFor('peer');
    mine.used = mine.cap; // as if this token had just written its whole quota

    const refused = await call(exchange({ rel: 'system/ds/a.css', body: 'x' }));
    assert.equal(refused.status, 507, 'the greedy token is refused');

    const other = addToken(dataDir, { label: 'somebody-else', scope: '*' }).value;
    const ok = await call(exchange({ rel: 'system/ds/b.css', body: 'y', bearer: other }));
    assert.equal(ok.status, 200, 'everybody else still writes');
  });

  it('the window rolls, so a quota is a pause and not a permanent outage', () => {
    const t0 = 1_000_000;
    const first = quotaFor('peer', t0);
    first.used = first.cap;
    assert.equal(quotaFor('peer', t0).used, first.cap, 'same window, same row');

    const later = quotaFor('peer', t0 + 60 * 60 * 1000 + 1);
    assert.equal(later.used, 0, 'a new window starts clean');
  });

  it('is observable rather than an invisible module global', async () => {
    await call(exchange({ rel: 'system/ds/c.css', body: 'hello' }));
    const snap = quotaSnapshot();
    const row = snap.find((r) => r.label === 'peer');
    assert.ok(row, `the writing token appears in the snapshot: ${JSON.stringify(snap)}`);
    assert.equal(row.used, 5);
  });
});

describe('DELETE — a tombstone is a row, and the bytes are quarantined', () => {
  it('removes the file, parks it, and appends a tombstone peers can read', async () => {
    await call(exchange({ rel: 'system/ds/gone.css', body: ':root{}' }));
    assert.equal(existsSync(join(designRoot, 'system/ds/gone.css')), true);

    // Post-burn-down contract (B14): the precondition is REQUIRED.
    const res = await call(
      exchange({
        rel: 'system/ds/gone.css',
        method: 'DELETE',
        body: null,
        headers: { 'x-maude-expect-hash': sha(':root{}') },
      })
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.deleted, true);
    assert.equal(existsSync(join(designRoot, 'system/ds/gone.css')), false);

    // Quarantined, never unlinked — the recoverability spine.
    assert.ok(res.json.parked?.startsWith('_trash/'), `parked: ${res.json.parked}`);
    assert.equal(existsSync(join(designRoot, res.json.parked)), true);

    const journal = openJournal(dataDir);
    const row = journal.latestFor('system/ds/gone.css');
    assert.ok(row.deleted, 'the tombstone is a ROW, not an absence');
    assert.equal(row.sha256, null);
  });

  it('is idempotent — a retry after a dropped response is not an error', async () => {
    await call(exchange({ rel: 'system/ds/twice.css', body: 'x' }));
    const del = () =>
      call(
        exchange({
          rel: 'system/ds/twice.css',
          method: 'DELETE',
          body: null,
          // The retry carries the same precondition the first attempt did; the
          // hub then holds nothing, so the SAME header answers noop (F-8's
          // "none means the hub holds nothing" is exactly the retry shape).
          headers: { 'x-maude-expect-hash': sha('x') },
        })
      );
    const first = await del();
    const again = await call(
      exchange({
        rel: 'system/ds/twice.css',
        method: 'DELETE',
        body: null,
        headers: { 'x-maude-expect-hash': sha('x') },
      })
    );
    assert.equal(first.status, 200);
    assert.equal(again.status, 200);
    assert.equal(again.json.noop, true);
  });

  it('an edit that raced the delete WINS — the CAS refuses the stale precondition', async () => {
    const put = await call(exchange({ rel: 'system/ds/race.css', body: 'v1' }));
    const staleHash = put.json.sha256;
    // Somebody else edits it after we decided to delete.
    await call(exchange({ rel: 'system/ds/race.css', body: 'v2' }));

    const del = exchange({ rel: 'system/ds/race.css', method: 'DELETE', body: null });
    del.request.headers['x-maude-expect-hash'] = staleHash;
    const res = await call(del);

    assert.equal(res.status, 409, 'an edit beats a delete');
    assert.equal(readFileSync(join(designRoot, 'system/ds/race.css'), 'utf8'), 'v2');
  });

  it('refuses a delete from a token that may not write there', async () => {
    await call(exchange({ rel: 'system/ds/scoped.css', body: 'x' }));
    const scoped = addToken(dataDir, { label: 'alice', scope: 'ui/alice' }).value;
    const res = await call(
      exchange({ rel: 'system/ds/scoped.css', method: 'DELETE', body: null, bearer: scoped })
    );
    assert.equal(res.status, 403);
    assert.equal(existsSync(join(designRoot, 'system/ds/scoped.css')), true);
  });

  it('a read-only token cannot delete', async () => {
    await call(exchange({ rel: 'system/ds/ro.css', body: 'x' }));
    const viewer = addToken(dataDir, { label: 'viewer', scope: '*', readOnly: true }).value;
    const res = await call(
      exchange({ rel: 'system/ds/ro.css', method: 'DELETE', body: null, bearer: viewer })
    );
    assert.equal(res.status, 403);
    assert.equal(existsSync(join(designRoot, 'system/ds/ro.css')), true);
  });
});

describe('DELETE — the burn-down contract (F-7 / F-8 / F-14 / B14)', () => {
  const put = async (rel, body) =>
    call(
      exchange({
        rel,
        body,
        headers: { 'x-maude-content-sha256': sha(body), 'x-maude-expect-hash': 'none' },
      })
    );
  const del = (rel, expect) =>
    call(
      exchange({
        rel,
        body: null,
        method: 'DELETE',
        headers: expect === undefined ? {} : { 'x-maude-expect-hash': expect },
      })
    );

  it('B14: a DELETE with NO precondition is 428, not an unconditional purge', async () => {
    await put('system/ds/tokens.css', 'body{}');
    const res = await del('system/ds/tokens.css', undefined);
    assert.equal(res.status, 428);
    assert.ok(existsSync(join(designRoot, 'system/ds/tokens.css')));
  });

  it('F-8: "none" means the same thing as on PUT — the hub holds something, so 409', async () => {
    await put('system/ds/tokens.css', 'body{}');
    const res = await del('system/ds/tokens.css', 'none');
    assert.equal(res.status, 409);
    assert.equal(res.json.current, sha('body{}'));
    assert.ok(existsSync(join(designRoot, 'system/ds/tokens.css')));
  });

  it('a matching expectation deletes, quarantines, and the receipt names the TOMBSTONE seq', async () => {
    const w = await put('system/ds/tokens.css', 'body{}');
    const res = await del('system/ds/tokens.css', sha('body{}'));
    assert.equal(res.status, 200);
    assert.equal(res.json.deleted, true);
    assert.ok(res.json.parked?.startsWith('_trash/'));
    // F-7 — the seq is the tombstone's own row, strictly after the write's.
    assert.ok(typeof res.json.seq === 'number' && res.json.seq > w.json.seq);
    assert.ok(!existsSync(join(designRoot, 'system/ds/tokens.css')));
  });

  it('a stale expectation is refused with what to re-decide against', async () => {
    await put('system/ds/tokens.css', 'body{}');
    const res = await del('system/ds/tokens.css', sha('SOMETHING ELSE'));
    assert.equal(res.status, 409);
    assert.equal(res.json.current, sha('body{}'));
  });

  it('F-14: a file on disk but NOT in the journal is a real delete, never a noop receipt', async () => {
    // A fresh checkout before boot-scan: bytes on disk, no journal row.
    writeFileSync(join(designRoot, 'system/ds/unjournaled.css'), 'a{}');
    const res = await del('system/ds/unjournaled.css', sha('a{}'));
    assert.equal(res.status, 200);
    assert.equal(res.json.deleted, true);
    assert.notEqual(res.json.noop, true);
    assert.ok(!existsSync(join(designRoot, 'system/ds/unjournaled.css')));
    // …and the delete is journaled, so it cannot come back on the next walk.
    const journal = openJournal(dataDir);
    assert.ok(journal.latestFor('system/ds/unjournaled.css')?.deleted);
  });

  it('F-14 CAS: the unjournaled branch compares against the DISK bytes', async () => {
    writeFileSync(join(designRoot, 'system/ds/unjournaled.css'), 'a{}');
    const res = await del('system/ds/unjournaled.css', sha('stale view'));
    assert.equal(res.status, 409);
    assert.equal(res.json.current, sha('a{}'));
    assert.ok(existsSync(join(designRoot, 'system/ds/unjournaled.css')));
  });

  it('genuinely absent everywhere stays an idempotent noop', async () => {
    const res = await del('system/ds/never-existed.css', 'none');
    assert.equal(res.status, 200);
    assert.equal(res.json.noop, true);
  });

  it('F-7: when the tombstone append fails, the bytes come BACK and the answer is 500', async () => {
    await put('system/ds/tokens.css', 'body{}');
    const res = await call(
      exchange({
        rel: 'system/ds/tokens.css',
        body: null,
        method: 'DELETE',
        headers: { 'x-maude-expect-hash': sha('body{}') },
      }),
      { onDeleted: () => null } // the F-7 failure: append refused/reclassified
    );
    assert.equal(res.status, 500);
    // The quarantined copy was restored — the delete that was not journaled
    // did not happen.
    assert.ok(existsSync(join(designRoot, 'system/ds/tokens.css')));
    assert.equal(readFileSync(join(designRoot, 'system/ds/tokens.css'), 'utf8'), 'body{}');
  });
});
