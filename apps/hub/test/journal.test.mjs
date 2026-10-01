// The hub file journal — Sync v2 Increment 1 (DDR-226 §2/§3).
//
// The properties worth proving are the ones the whole redesign leans on:
//
//   - the row is written from the hub's OWN disk, never from a caller's claim;
//   - same-hash is a no-op, so idempotent re-uploads cost zero peer wakeups;
//   - the compaction IS the manifest;
//   - a tail replay after a restore reconstructs the head PAST the generation,
//     idempotently, and without ever handing out a seq twice;
//   - the walk-import reconciler catches a checkout mutation nobody hooked.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  closeJournal,
  createJournalTail,
  JOURNAL_TAIL_KEY,
  openJournal,
  replayTailFromTarget,
  reportLostFiles,
  walkImport,
  walkIntervalFromEnv,
} from '../src/journal.mjs';

let dataDir;
let designRoot;

function seedTree(root) {
  mkdirSync(join(root, 'system/ds/assets'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'ui'), { recursive: true });
  writeFileSync(join(root, 'config.json'), '{"canvasGroups":[{"path":"ui"},{"path":"system"}]}');
  writeFileSync(join(root, 'system/ds/brand.css'), ':root{}');
  writeFileSync(join(root, 'system/ds/assets/logo.svg'), '<svg/>');
  writeFileSync(join(root, 'assets/a1b2c3d4.png'), 'PNGDATA');
}

/** An in-memory stand-in for the backup target's put/get surface. */
function memoryTarget() {
  const store = new Map();
  return {
    store,
    failNext: 0,
    async put(key, body) {
      if (this.failNext > 0) {
        this.failNext -= 1;
        throw new Error('storage unavailable');
      }
      store.set(key, Buffer.from(body));
    },
    async get(key) {
      return store.get(key) ?? null;
    },
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'journal-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'journal-root-'));
  seedTree(designRoot);
});

afterEach(() => {
  closeJournal(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

describe('reportLostFiles — a live row whose bytes the hub lost', () => {
  // v1.5.x: a cell restart wiped checkout files the write-behind had never
  // mirrored (expired credentials). Their rows still said "the hub holds sha
  // X", every desktop agreed, and nobody pushed them back — `_layout.css` and
  // photos stayed missing on Brno Alligators.
  it('marks it live-with-no-hash (never a tombstone), once', async () => {
    const j = openJournal(dataDir);
    walkImport({ journal: j, designRoot, log: { log() {} } });
    const before = j.latestFor('system/ds/brand.css');
    assert.match(before.sha256, /^[0-9a-f]{64}$/);
    rmSync(join(designRoot, 'system/ds/brand.css'));

    const warn = [];
    const first = await reportLostFiles({
      journal: j,
      designRoot,
      log: { warn: (m) => warn.push(m) },
    });
    assert.equal(first.lost, 1);
    assert.equal(warn.length, 1);
    const lost = j.latestFor('system/ds/brand.css');
    assert.equal(lost.deleted, false); // a tombstone would delete it on every desktop
    assert.equal(lost.sha256, null);
    assert.equal(lost.seq > before.seq, true); // travels on the ordinary cursor
    // Present files are untouched; a second pass is a no-op.
    assert.match(j.latestFor('assets/a1b2c3d4.png').sha256, /^[0-9a-f]{64}$/);
    assert.equal((await reportLostFiles({ journal: j, designRoot, log: {} })).lost, 0);
  });

  it('a peer push of the file lands a normal row again', async () => {
    const j = openJournal(dataDir);
    walkImport({ journal: j, designRoot, log: { log() {} } });
    rmSync(join(designRoot, 'system/ds/brand.css'));
    await reportLostFiles({ journal: j, designRoot, log: {} });
    writeFileSync(join(designRoot, 'system/ds/brand.css'), ':root{}');
    const res = j.recordWrite({ designRoot, path: 'system/ds/brand.css', source: 'peer-put' });
    assert.equal(res.noop, false);
    assert.match(j.latestFor('system/ds/brand.css').sha256, /^[0-9a-f]{64}$/);
  });
});

// Cell materializer Phase 0 (Task 4). On the 2026-10-01 Alligators restart
// loop the v1.5.2 pass marked every live row missing from a HALF-hydrated
// checkout as lost — without asking the bucket — and every desktop re-pushed
// gigabytes the bucket already held, into a disk that was already full.
describe('reportLostFiles — asks the bucket, never after a partial hydrate', () => {
  const BRAND = 'system/ds/brand.css';
  /** walk-import, then mirror every row, then lose the file from disk. */
  function mirroredThenLost(j) {
    walkImport({ journal: j, designRoot, log: { log() {} } });
    for (const r of j.compaction()) j.markMirrored(r.seq);
    rmSync(join(designRoot, BRAND));
  }
  const bucketWith = (present) => {
    const asked = [];
    return {
      asked,
      headObject: async (_cfg, key) => {
        asked.push(key);
        return present.has(key) ? { size: 1 } : null;
      },
    };
  };
  const quiet = { warn() {}, error() {} };

  it('a partial hydrate marks NOTHING', async () => {
    const j = openJournal(dataDir);
    walkImport({ journal: j, designRoot, log: { log() {} } });
    rmSync(join(designRoot, BRAND)); // unmirrored, so it WOULD be lost…
    for (const hydrate of [
      { failed: 1, skippedForBudget: 0 },
      { failed: 0, skippedForBudget: 40 },
    ]) {
      const r = await reportLostFiles({ journal: j, designRoot, hydrate, log: quiet });
      assert.deepEqual(r, { lost: 0, skipped: 'hydrate-incomplete' });
    }
    assert.match(j.latestFor(BRAND).sha256, /^[0-9a-f]{64}$/); // …but nothing was marked
  });

  it('mirrored + the bucket holds it → NOT lost', async () => {
    const j = openJournal(dataDir);
    mirroredThenLost(j);
    const b = bucketWith(new Set([`files/${BRAND}`]));
    const r = await reportLostFiles({
      journal: j,
      designRoot,
      hydrate: { failed: 0, skippedForBudget: 0 },
      s3: async () => ({ bucket: 'x' }),
      keyFor: (rel) => `files/${rel}`,
      deps: { headObject: b.headObject },
      log: quiet,
    });
    assert.equal(r.lost, 0);
    assert.deepEqual(b.asked, [`files/${BRAND}`]);
    assert.match(j.latestFor(BRAND).sha256, /^[0-9a-f]{64}$/);
  });

  it('mirrored + the bucket says 404 → lost', async () => {
    const j = openJournal(dataDir);
    mirroredThenLost(j);
    const r = await reportLostFiles({
      journal: j,
      designRoot,
      hydrate: { failed: 0, skippedForBudget: 0 },
      s3: { bucket: 'x' },
      keyFor: (rel) => `files/${rel}`,
      deps: { headObject: bucketWith(new Set()).headObject },
      log: quiet,
    });
    assert.equal(r.lost, 1);
    assert.equal(j.latestFor(BRAND).sha256, null);
  });

  it('never mirrored → lost without asking the bucket', async () => {
    const j = openJournal(dataDir);
    walkImport({ journal: j, designRoot, log: { log() {} } });
    rmSync(join(designRoot, BRAND));
    const b = bucketWith(new Set());
    const r = await reportLostFiles({
      journal: j,
      designRoot,
      hydrate: { failed: 0, skippedForBudget: 0 },
      s3: { bucket: 'x' },
      keyFor: (rel) => `files/${rel}`,
      deps: { headObject: b.headObject },
      log: quiet,
    });
    assert.equal(r.lost, 1);
    assert.deepEqual(b.asked, []);
  });

  it('a bucket error skips the whole pass — unverified is not lost', async () => {
    const j = openJournal(dataDir);
    mirroredThenLost(j);
    const r = await reportLostFiles({
      journal: j,
      designRoot,
      hydrate: { failed: 0, skippedForBudget: 0 },
      s3: { bucket: 'x' },
      keyFor: (rel) => `files/${rel}`,
      deps: {
        headObject: async () => {
          throw new Error('S3 HEAD failed: 403');
        },
      },
      log: quiet,
    });
    assert.deepEqual(r, { lost: 0, skipped: 'bucket-unreachable' });
    assert.match(j.latestFor(BRAND).sha256, /^[0-9a-f]{64}$/);
  });

  it('mirrored rows with no way to ask the bucket are left alone', async () => {
    const j = openJournal(dataDir);
    mirroredThenLost(j);
    const r = await reportLostFiles({ journal: j, designRoot, log: quiet });
    assert.equal(r.lost, 0);
  });

  it('MAUDE_REPORT_LOST=0 turns the pass off', async () => {
    const j = openJournal(dataDir);
    walkImport({ journal: j, designRoot, log: { log() {} } });
    rmSync(join(designRoot, BRAND));
    const r = await reportLostFiles({
      journal: j,
      designRoot,
      env: { MAUDE_REPORT_LOST: '0' },
      log: quiet,
    });
    assert.deepEqual(r, { lost: 0, skipped: 'disabled' });
  });
});

describe('recordWrite — the hub reads its own disk', () => {
  it('appends a row with the hash of what is actually there', () => {
    const j = openJournal(dataDir);
    const res = j.recordWrite({
      designRoot,
      path: 'assets/a1b2c3d4.png',
      source: 'peer-put',
    });
    assert.equal(res.noop, false);
    assert.equal(res.seq, 1);
    // sha256('PNGDATA')
    assert.match(res.sha256, /^[0-9a-f]{64}$/);
    const { entries } = j.entriesSince(0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, 'assets/a1b2c3d4.png');
    assert.equal(entries[0].class, 'inert-media');
    assert.equal(entries[0].size, 7);
    assert.equal(entries[0].deleted, false);
  });

  it('a caller cannot inject content — only a path', () => {
    const j = openJournal(dataDir);
    // Every field a nudge might try to assert is simply not a parameter.
    const res = j.recordWrite({
      designRoot,
      path: 'assets/a1b2c3d4.png',
      source: 'studio-report',
      sha256: 'f'.repeat(64),
      size: 999_999,
    });
    const { entries } = j.entriesSince(0);
    assert.notEqual(entries[0].sha256, 'f'.repeat(64));
    assert.equal(entries[0].size, 7);
    assert.equal(res.sha256, entries[0].sha256);
  });

  it('same bytes ⇒ a no-op at the existing seq (idempotent push costs nothing)', () => {
    const j = openJournal(dataDir);
    const first = j.recordWrite({ designRoot, path: 'system/ds/brand.css', source: 'peer-put' });
    // Touch the mtime so the sha cache misses and the file is genuinely re-read.
    const later = new Date(Date.now() + 5000);
    utimesSync(join(designRoot, 'system/ds/brand.css'), later, later);
    const second = j.recordWrite({ designRoot, path: 'system/ds/brand.css', source: 'peer-put' });
    assert.equal(second.noop, true);
    assert.equal(second.seq, first.seq);
    assert.equal(j.head(), 1);
  });

  it('changed bytes ⇒ a NEW row; the old one stays (append-only)', () => {
    const j = openJournal(dataDir);
    j.recordWrite({ designRoot, path: 'system/ds/brand.css', source: 'peer-put' });
    writeFileSync(join(designRoot, 'system/ds/brand.css'), ':root{--bg-0:#fff}');
    const second = j.recordWrite({ designRoot, path: 'system/ds/brand.css', source: 'peer-put' });
    assert.equal(second.noop, false);
    assert.equal(second.seq, 2);
    assert.equal(j.entriesSince(0).entries.length, 2);
    // The compaction is the manifest: one row per path, the latest.
    const manifest = j.compaction();
    assert.equal(manifest.filter((r) => r.path === 'system/ds/brand.css').length, 1);
    assert.equal(manifest.find((r) => r.path === 'system/ds/brand.css').seq, 2);
  });

  it('a non-plane path gets no journal at all', () => {
    const j = openJournal(dataDir);
    // `config.json` is `never`; a canvas body inside a group is plane A.
    writeFileSync(join(designRoot, 'ui/screen.tsx'), 'export default null');
    assert.equal(j.recordWrite({ designRoot, path: 'config.json', source: 'peer-put' }), null);
    assert.equal(j.recordWrite({ designRoot, path: 'ui/screen.tsx', source: 'peer-put' }), null);
    assert.equal(j.head(), 0);
  });

  it('a missing file appends nothing (absence is never a row)', () => {
    const j = openJournal(dataDir);
    assert.equal(j.recordWrite({ designRoot, path: 'assets/ghost.png', source: 'peer-put' }), null);
    assert.equal(j.head(), 0);
  });

  it('an unknown source is refused', () => {
    const j = openJournal(dataDir);
    assert.equal(
      j.recordWrite({ designRoot, path: 'assets/a1b2c3d4.png', source: 'whatever' }),
      null
    );
    assert.equal(j.head(), 0);
  });

  it('a 0-byte file WITH a row is a stamped truncation, not emptiness', () => {
    const j = openJournal(dataDir);
    writeFileSync(join(designRoot, 'system/ds/brand.css'), '');
    const res = j.recordWrite({ designRoot, path: 'system/ds/brand.css', source: 'peer-put' });
    assert.equal(res.noop, false);
    assert.equal(j.entriesSince(0).entries[0].size, 0);
  });
});

describe('paging and cursors', () => {
  it('entriesSince pages and names its truncation', () => {
    const j = openJournal(dataDir);
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(designRoot, `assets/f${i}.png`), `bytes-${i}`);
      j.recordWrite({ designRoot, path: `assets/f${i}.png`, source: 'peer-put' });
    }
    const page = j.entriesSince(0, 3);
    assert.equal(page.entries.length, 3);
    assert.equal(page.truncated, true);
    const rest = j.entriesSince(page.entries.at(-1).seq, 3);
    assert.equal(rest.entries.length, 2);
    assert.equal(rest.truncated, false);
  });

  it('a cursor carries its epoch and its persistent refused set', () => {
    const j = openJournal(dataDir);
    j.setCursor({ label: 'laptop', epoch: j.epoch(), seq: 12, refused: ['system/ds/evil.css'] });
    const c = j.cursorFor('laptop');
    assert.equal(c.seq, 12);
    assert.equal(c.epoch, j.epoch());
    assert.deepEqual(JSON.parse(c.refused), ['system/ds/evil.css']);
  });

  it('rotating the epoch invalidates every cursor', () => {
    const j = openJournal(dataDir);
    const before = j.epoch();
    j.setCursor({ label: 'laptop', epoch: before, seq: 12 });
    j.rotateEpoch('test');
    assert.notEqual(j.epoch(), before);
    const c = j.cursorFor('laptop');
    assert.equal(c.seq, 0);
    assert.equal(c.epoch, null);
  });
});

describe('the R2 tail — durability across a rehydrate', () => {
  it('write-behind then replay reconstructs the head past the generation', async () => {
    const target = memoryTarget();
    const j = openJournal(dataDir);
    const tail = createJournalTail({ journal: j, target, debounceMs: 0 });

    for (let i = 0; i < 3; i += 1) {
      writeFileSync(join(designRoot, `assets/f${i}.png`), `bytes-${i}`);
      j.recordWrite({ designRoot, path: `assets/f${i}.png`, source: 'peer-put' });
    }
    await tail.flush();
    assert.ok(target.store.has(JOURNAL_TAIL_KEY));
    const head = j.head();

    // A wake: the generation restored an EMPTY journal (the rows landed after
    // the last backup). Replay must bring them back.
    closeJournal(dataDir);
    const restoredDir = mkdtempSync(join(tmpdir(), 'journal-restored-'));
    try {
      const j2 = openJournal(restoredDir);
      const res = await replayTailFromTarget({
        journal: j2,
        target,
        log: { log() {}, error() {} },
      });
      assert.equal(res.state, 'replayed');
      assert.equal(res.applied, 3);
      assert.equal(j2.head(), head);
      // And the seqs are the SAME ones peers already hold.
      assert.deepEqual(
        j2.entriesSince(0).entries.map((e) => e.seq),
        [1, 2, 3]
      );
      closeJournal(restoredDir);
    } finally {
      rmSync(restoredDir, { recursive: true, force: true });
    }
  });

  it('replay is idempotent and never re-issues a seq', async () => {
    const target = memoryTarget();
    const j = openJournal(dataDir);
    const tail = createJournalTail({ journal: j, target, debounceMs: 0 });
    for (let i = 0; i < 2; i += 1) {
      writeFileSync(join(designRoot, `assets/f${i}.png`), `bytes-${i}`);
      j.recordWrite({ designRoot, path: `assets/f${i}.png`, source: 'peer-put' });
    }
    await tail.flush();
    closeJournal(dataDir);

    const restoredDir = mkdtempSync(join(tmpdir(), 'journal-restored2-'));
    try {
      const j2 = openJournal(restoredDir);
      const first = await replayTailFromTarget({
        journal: j2,
        target,
        log: { log() {}, error() {} },
      });
      const second = await replayTailFromTarget({
        journal: j2,
        target,
        log: { log() {}, error() {} },
      });
      assert.equal(first.applied, 2);
      assert.equal(second.applied, 0);
      assert.equal(second.skipped, 2);

      // The AUTOINCREMENT counter moved past the replayed rows — the next
      // organic append must not collide with a seq a peer already consumed.
      writeFileSync(join(designRoot, 'assets/new.png'), 'fresh');
      const next = j2.recordWrite({ designRoot, path: 'assets/new.png', source: 'peer-put' });
      assert.equal(next.seq, 3);
      closeJournal(restoredDir);
    } finally {
      rmSync(restoredDir, { recursive: true, force: true });
    }
  });

  it('a restore whose journal is AHEAD of the tail keeps its own rows', async () => {
    const target = memoryTarget();
    const j = openJournal(dataDir);
    const tail = createJournalTail({ journal: j, target, debounceMs: 0 });
    writeFileSync(join(designRoot, 'assets/f0.png'), 'a');
    j.recordWrite({ designRoot, path: 'assets/f0.png', source: 'peer-put' });
    await tail.flush();
    // The generation is newer than the tail — rows 2 and 3 are in the db.
    writeFileSync(join(designRoot, 'assets/f1.png'), 'b');
    j.recordWrite({ designRoot, path: 'assets/f1.png', source: 'peer-put' });
    const res = await replayTailFromTarget({ journal: j, target, log: { log() {}, error() {} } });
    assert.equal(res.applied, 0);
    assert.equal(j.head(), 2);
  });

  it('a missing tail is "empty", not "lost" — a tenant may simply never have written one', async () => {
    const target = memoryTarget();
    const j = openJournal(dataDir);
    const res = await replayTailFromTarget({ journal: j, target, log: { log() {}, error() {} } });
    assert.equal(res.state, 'empty');
  });

  it('an unreadable tail is LOST — the caller rotates the epoch on that', async () => {
    const j = openJournal(dataDir);
    const broken = {
      async get() {
        throw new Error('bucket unreachable');
      },
      async put() {},
    };
    const res = await replayTailFromTarget({
      journal: j,
      target: broken,
      log: { log() {}, error() {} },
    });
    assert.equal(res.state, 'lost');
  });

  it('malformed lines are counted and skipped, never fatal', () => {
    const j = openJournal(dataDir);
    const out = j.replayTail(
      [
        '{"seq":1,"path":"assets/x.png","sha256":"ab","size":2}',
        'not json',
        '{"path":"no-seq"}',
      ].join('\n')
    );
    assert.equal(out.applied, 1);
    assert.equal(out.malformed, 2);
  });

  it('rotate() shortens the tail to rows after the generation', async () => {
    const target = memoryTarget();
    const j = openJournal(dataDir);
    const tail = createJournalTail({ journal: j, target, debounceMs: 0 });
    for (let i = 0; i < 3; i += 1) {
      writeFileSync(join(designRoot, `assets/f${i}.png`), `bytes-${i}`);
      j.recordWrite({ designRoot, path: `assets/f${i}.png`, source: 'peer-put' });
    }
    await tail.flush();
    assert.equal(target.store.get(JOURNAL_TAIL_KEY).toString().split('\n').length, 3);

    // A backup generation snapshotted the db up to seq 3.
    await tail.rotate(3);
    assert.equal(target.store.get(JOURNAL_TAIL_KEY).toString(), '');

    writeFileSync(join(designRoot, 'assets/f3.png'), 'later');
    j.recordWrite({ designRoot, path: 'assets/f3.png', source: 'peer-put' });
    await tail.flush();
    assert.equal(target.store.get(JOURNAL_TAIL_KEY).toString().split('\n').length, 1);
  });

  it('a failing tail retries and then says so LOUDLY', async () => {
    const target = memoryTarget();
    const errors = [];
    const j = openJournal(dataDir);
    const tail = createJournalTail({
      journal: j,
      target,
      debounceMs: 0,
      maxRetries: 1,
      log: { log() {}, error: (m) => errors.push(m) },
    });
    writeFileSync(join(designRoot, 'assets/f0.png'), 'a');
    j.recordWrite({ designRoot, path: 'assets/f0.png', source: 'peer-put' });
    target.failNext = 2; // both the attempt and its one retry
    const res = await tail.flush();
    assert.equal(res.ok, false);
    assert.equal(tail.failures(), 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /rewind the journal/);
  });

  it('no object storage ⇒ a clean no-op, not a degraded mode', async () => {
    const j = openJournal(dataDir);
    const tail = createJournalTail({ journal: j, target: null });
    const res = await tail.flush();
    assert.equal(res.ok, true);
    assert.equal(res.skipped, 'no-target');
  });
});

describe('walk-import — the permanent reconciler', () => {
  it('catches a checkout mutation no write hook saw', () => {
    const j = openJournal(dataDir);
    const first = walkImport({ journal: j, designRoot, log: { log() {}, error() {} } });
    assert.equal(first.appended, 3); // brand.css, logo.svg, a1b2c3d4.png
    const before = j.head();

    // A git-level restore, a missed hook, a hand edit inside the container.
    writeFileSync(join(designRoot, 'system/ds/brand.css'), ':root{--changed:1}');
    const second = walkImport({ journal: j, designRoot, log: { log() {}, error() {} } });
    assert.equal(second.appended, 1);
    assert.equal(j.head(), before + 1);
    assert.equal(j.compaction().find((r) => r.path === 'system/ds/brand.css').seq, j.head());
  });

  it('a converged tree appends nothing', () => {
    const j = openJournal(dataDir);
    walkImport({ journal: j, designRoot, log: { log() {}, error() {} } });
    const head = j.head();
    const again = walkImport({ journal: j, designRoot, log: { log() {}, error() {} } });
    assert.equal(again.appended, 0);
    assert.equal(j.head(), head);
  });

  it('an absent design root is a quiet no-op, never a throw', () => {
    const j = openJournal(dataDir);
    const out = walkImport({
      journal: j,
      designRoot: join(designRoot, 'nope'),
      log: { log() {}, error() {} },
    });
    assert.equal(out.appended, 0);
  });
});

describe('the walk-import belt is a backstop, and a backstop has to be prompt', () => {
  it('one minute by default — not the fifteen it was tuned to when the walk was assumed expensive', () => {
    assert.equal(walkIntervalFromEnv({}), 60_000);
  });

  it('an operator can retune it', () => {
    assert.equal(walkIntervalFromEnv({ MAUDE_JOURNAL_WALK_MS: '5000' }), 5_000);
  });

  it('clamped at both ends — a sub-second belt is a busy loop, an hourly one is a shrug', () => {
    assert.equal(walkIntervalFromEnv({ MAUDE_JOURNAL_WALK_MS: '1' }), 1_000);
    assert.equal(walkIntervalFromEnv({ MAUDE_JOURNAL_WALK_MS: '99999999' }), 60 * 60_000);
  });

  it('garbage falls back to the default rather than to zero', () => {
    for (const v of ['', 'soon', '-1', '0', 'NaN']) {
      assert.equal(walkIntervalFromEnv({ MAUDE_JOURNAL_WALK_MS: v }), 60_000);
    }
  });
});
