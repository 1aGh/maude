// The journal's two routes — Sync v2 Increment 1 (DDR-226 §5).
//
// What matters here is what they REFUSE and how they fail:
//
//   - `GET /api/journal` fails CLOSED. An epoch mismatch, a cursor from the
//     future and a negative cursor all answer `reanchor`, never "nothing
//     changed" — the shape that lets a stale peer believe it is current.
//   - entries are scope-filtered like the manifest.
//   - `POST /api/journal/report` is LOOPBACK-ONLY and is a NUDGE: it carries
//     paths and nothing else, and the hub reads its own disk. A caller cannot
//     state a hash, a size, a class or a deletion, and there is no parameter
//     through which it could try.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  closeJournal,
  handleJournalRoutes,
  JOURNAL_PATH,
  JOURNAL_REPORT_PATH,
  openJournal,
} from '../src/journal.mjs';

let dataDir;
let designRoot;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'journal-routes-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'journal-routes-root-'));
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  mkdirSync(join(designRoot, 'system/ds'), { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), '{"canvasGroups":[{"path":"system"}]}');
  writeFileSync(join(designRoot, 'assets/a.png'), 'A');
  writeFileSync(join(designRoot, 'system/ds/brand.css'), ':root{}');
});

afterEach(() => {
  closeJournal(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

/** Collect one respondJson call. */
function collector() {
  const out = { status: null, payload: null, calls: 0 };
  return {
    out,
    respondJson: (status, payload) => {
      out.status = status;
      out.payload = payload;
      out.calls += 1;
    },
  };
}

function baseCtx(overrides = {}) {
  const c = collector();
  return {
    ctx: {
      path: JOURNAL_PATH,
      method: 'GET',
      query: {},
      bearer: 'tok',
      verify: () => ({ label: 'laptop', scope: '*' }),
      matchesScope: () => true,
      designRoot,
      journal: null,
      body: null,
      isLoopback: false,
      respondJson: c.respondJson,
      ...overrides,
    },
    out: c.out,
  };
}

describe('GET /api/journal', () => {
  it('is not this handler’s business for another path', () => {
    const { ctx } = baseCtx({ path: '/api/files' });
    assert.equal(handleJournalRoutes(ctx), false);
  });

  it('refuses a write method', () => {
    const { ctx, out } = baseCtx({ method: 'POST' });
    assert.equal(handleJournalRoutes(ctx), true);
    assert.equal(out.status, 405);
  });

  it('a missing credential and a bad one are the same answer', () => {
    for (const bearer of [null, 'nope']) {
      const { ctx, out } = baseCtx({ bearer, verify: () => null });
      handleJournalRoutes(ctx);
      assert.equal(out.status, 401);
    }
  });

  it('a hub with no checkout answers the empty journal, not an error', () => {
    const { ctx, out } = baseCtx({ journal: null });
    handleJournalRoutes(ctx);
    assert.equal(out.status, 200);
    assert.deepEqual(out.payload, { epoch: null, head: 0, entries: [], truncated: false });
  });

  it('returns entries after the cursor with the epoch and head', () => {
    const journal = openJournal(dataDir);
    journal.recordWrite({ designRoot, path: 'assets/a.png', source: 'peer-put' });
    journal.recordWrite({ designRoot, path: 'system/ds/brand.css', source: 'peer-put' });
    const { ctx, out } = baseCtx({ journal, query: { since: '1' } });
    handleJournalRoutes(ctx);
    assert.equal(out.status, 200);
    assert.equal(out.payload.epoch, journal.epoch());
    assert.equal(out.payload.head, 2);
    assert.deepEqual(
      out.payload.entries.map((e) => e.path),
      ['system/ds/brand.css']
    );
  });

  it('FAILS CLOSED on an epoch mismatch — reanchor, never "nothing changed"', () => {
    const journal = openJournal(dataDir);
    journal.recordWrite({ designRoot, path: 'assets/a.png', source: 'peer-put' });
    const { ctx, out } = baseCtx({ journal, query: { since: '0', epoch: 'someone-elses-epoch' } });
    handleJournalRoutes(ctx);
    assert.equal(out.payload.reanchor, true);
    assert.equal(out.payload.entries, undefined);
  });

  it('FAILS CLOSED on a cursor from the future', () => {
    const journal = openJournal(dataDir);
    journal.recordWrite({ designRoot, path: 'assets/a.png', source: 'peer-put' });
    const { ctx, out } = baseCtx({ journal, query: { since: '9999' } });
    handleJournalRoutes(ctx);
    assert.equal(out.payload.reanchor, true);
  });

  it('FAILS CLOSED on a negative cursor', () => {
    const journal = openJournal(dataDir);
    journal.recordWrite({ designRoot, path: 'assets/a.png', source: 'peer-put' });
    const { ctx, out } = baseCtx({ journal, query: { since: '-4' } });
    handleJournalRoutes(ctx);
    assert.equal(out.payload.reanchor, true);
  });

  it('a garbage cursor reads as 0, not as NaN', () => {
    const journal = openJournal(dataDir);
    journal.recordWrite({ designRoot, path: 'assets/a.png', source: 'peer-put' });
    const { ctx, out } = baseCtx({ journal, query: { since: 'banana' } });
    handleJournalRoutes(ctx);
    assert.equal(out.payload.reanchor, undefined);
    assert.equal(out.payload.entries.length, 1);
  });

  it('entries are scope-filtered like the manifest', () => {
    const journal = openJournal(dataDir);
    journal.recordWrite({ designRoot, path: 'assets/a.png', source: 'peer-put' });
    journal.recordWrite({ designRoot, path: 'system/ds/brand.css', source: 'peer-put' });
    const { ctx, out } = baseCtx({
      journal,
      matchesScope: (_scope, path) => path.startsWith('assets/'),
    });
    handleJournalRoutes(ctx);
    assert.deepEqual(
      out.payload.entries.map((e) => e.path),
      ['assets/a.png']
    );
    // The head is still the TRUE head — a scope filter must not make a peer
    // think the log ended where its visibility does.
    assert.equal(out.payload.head, 2);
  });

  it('is rate-limited (the /api/files gap, not repeated)', () => {
    const journal = openJournal(dataDir);
    const { ctx, out } = baseCtx({ journal, checkRateLimit: () => false });
    handleJournalRoutes(ctx);
    assert.equal(out.status, 429);
  });
});

describe('POST /api/journal/report — a nudge, never data', () => {
  it('is 404 off loopback — not 403, no oracle', () => {
    const journal = openJournal(dataDir);
    const { ctx, out } = baseCtx({
      path: JOURNAL_REPORT_PATH,
      method: 'POST',
      journal,
      isLoopback: false,
      body: { paths: ['assets/a.png'] },
    });
    handleJournalRoutes(ctx);
    assert.equal(out.status, 404);
    assert.equal(journal.head(), 0);
  });

  it('refuses a read method', () => {
    const { ctx, out } = baseCtx({ path: JOURNAL_REPORT_PATH, method: 'GET', isLoopback: true });
    handleJournalRoutes(ctx);
    assert.equal(out.status, 405);
  });

  it('appends from the hub’s OWN disk for a named path', () => {
    const journal = openJournal(dataDir);
    const { ctx, out } = baseCtx({
      path: JOURNAL_REPORT_PATH,
      method: 'POST',
      journal,
      isLoopback: true,
      body: { paths: ['assets/a.png'] },
    });
    handleJournalRoutes(ctx);
    assert.equal(out.status, 200);
    const row = journal.entriesSince(0).entries[0];
    assert.equal(row.path, 'assets/a.png');
    assert.equal(row.size, 1); // 'A' — read from disk, not from the report
  });

  it('a report about a file that is NOT there appends nothing', () => {
    const journal = openJournal(dataDir);
    const { ctx, out } = baseCtx({
      path: JOURNAL_REPORT_PATH,
      method: 'POST',
      journal,
      isLoopback: true,
      body: { paths: ['assets/imaginary.png'] },
    });
    handleJournalRoutes(ctx);
    assert.equal(out.payload.noted, 1);
    assert.equal(journal.head(), 0);
  });

  // Plan T31/L03 — the hub's own studio renamed or deleted a file: the child
  // names the path, the hub finds nothing there. A file the journal tracked as
  // live gets a tombstone so it leaves teammates' disks too; one it never
  // tracked still appends nothing (above).
  it('a report about a TRACKED file that is gone from the disk tombstones it', () => {
    const journal = openJournal(dataDir);
    const report = (paths) => {
      const { ctx } = baseCtx({
        path: JOURNAL_REPORT_PATH,
        method: 'POST',
        journal,
        isLoopback: true,
        body: { paths },
      });
      handleJournalRoutes(ctx);
    };
    report(['assets/a.png']);
    assert.equal(journal.head(), 1);
    rmSync(join(designRoot, 'assets/a.png'));
    report(['assets/a.png']);
    const rows = journal.entriesSince(0).entries;
    assert.equal(rows.length, 2);
    assert.equal(rows[1].path, 'assets/a.png');
    assert.equal(rows[1].deleted, true);
    // Reported again: already a tombstone, nothing more.
    report(['assets/a.png']);
    assert.equal(journal.head(), 2);
    // Back on disk: an ordinary write row again.
    writeFileSync(join(designRoot, 'assets/a.png'), 'B');
    report(['assets/a.png']);
    const last = journal.entriesSince(0).entries.at(-1);
    assert.equal(last.deleted, false);
    assert.equal(last.size, 1);
  });

  it('the answer is NOT an existence oracle — present and absent read alike', () => {
    // `noted` is a pure function of the request. If the response distinguished
    // "this path exists in the checkout" from "it does not", anyone who reached
    // this route would have a filesystem probe over a customer's project — and
    // "the loopback gate protects it" is exactly the assumption a future proxy
    // hop would quietly invalidate.
    const journal = openJournal(dataDir);
    const ask = (p) => {
      const { ctx, out } = baseCtx({
        path: JOURNAL_REPORT_PATH,
        method: 'POST',
        journal,
        isLoopback: true,
        body: { paths: [p] },
      });
      handleJournalRoutes(ctx);
      return out;
    };
    const present = ask('assets/a.png');
    const absent = ask('assets/definitely-not-here.png');
    assert.deepEqual(present.payload, absent.payload);
    assert.equal(present.status, absent.status);
  });

  it('refuses a traversal or a malformed path outright', () => {
    const journal = openJournal(dataDir);
    const { ctx, out } = baseCtx({
      path: JOURNAL_REPORT_PATH,
      method: 'POST',
      journal,
      isLoopback: true,
      body: {
        paths: [
          '../../etc/passwd',
          '/etc/passwd',
          'assets/../../x.png',
          '',
          42,
          null,
          `assets/${'x'.repeat(400)}.png`,
        ],
      },
    });
    handleJournalRoutes(ctx);
    assert.equal(out.payload.noted, 0);
    assert.equal(journal.head(), 0);
  });

  it('caps how many paths one nudge may name', () => {
    const journal = openJournal(dataDir);
    const paths = Array.from({ length: 200 }, (_, i) => `assets/f${i}.png`);
    const { ctx, out } = baseCtx({
      path: JOURNAL_REPORT_PATH,
      method: 'POST',
      journal,
      isLoopback: true,
      body: { paths },
    });
    handleJournalRoutes(ctx);
    assert.equal(out.payload.noted, 64);
  });

  it('a bodyless / unparseable report is a quiet no-op', () => {
    const journal = openJournal(dataDir);
    const { ctx, out } = baseCtx({
      path: JOURNAL_REPORT_PATH,
      method: 'POST',
      journal,
      isLoopback: true,
      body: null,
    });
    handleJournalRoutes(ctx);
    assert.equal(out.status, 200);
    assert.equal(out.payload.noted, 0);
  });
});
