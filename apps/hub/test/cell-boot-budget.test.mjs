// Boot + reconcilers on a cell — cell materializer Phase 1 (Task 13).
//
// THE GUARD AGAINST THE PLAN'S TOP RISK. On a cell the checkout's media is a
// cache: a photo can be absent (never hydrated, or evicted) and an old copy can
// reappear (a git-bundle restore). Neither may ever turn into a journal row —
// an absence read as a deletion tombstones the file on EVERY desktop, and a
// stale copy read as a write puts old bytes back over a newer row.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  closeJournal,
  openJournal,
  quarantineStaleInert,
  reportLostFiles,
  walkImport,
} from '../src/journal.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const quiet = { log() {}, warn() {}, error() {} };
const PHOTO = 'system/ds/assets/photo.jpg';
const CSS = 'system/ds/brand.css';

let dataDir;
let designRoot;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cell-boot-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'cell-boot-root-'));
  mkdirSync(join(designRoot, 'system/ds/assets'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    '{"canvasGroups":[{"path":"ui"},{"path":"system"}]}'
  );
  writeFileSync(join(designRoot, PHOTO), 'PHOTO-V1');
  writeFileSync(join(designRoot, CSS), ':root{}');
});
afterEach(() => {
  closeJournal(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

function cellJournal() {
  const j = openJournal(dataDir);
  walkImport({ journal: j, designRoot, log: quiet }); // seeded before cell mode
  j.setInertCached(true);
  return j;
}

/** What the studio-report handler does for one reported path. */
function studioReport(j, rel) {
  const row = j.recordWrite({ designRoot, path: rel, source: 'studio-report' });
  if (row === null) j.recordGone({ designRoot, path: rel, source: 'studio-report' });
}

describe('cell mode — absence of media is never a deletion', () => {
  it('unlinking a media checkout path + a studio report → NO tombstone', () => {
    const j = cellJournal();
    rmSync(join(designRoot, PHOTO)); // an eviction, or a hydrate that never ran
    studioReport(j, PHOTO);
    const row = j.latestFor(PHOTO);
    assert.equal(row.deleted, false, 'a tombstone here deletes the photo on every desktop');
    assert.equal(row.sha256, sha('PHOTO-V1'));
  });

  it('…while a code/companion file that vanishes IS still a deletion (unchanged)', () => {
    const j = cellJournal();
    rmSync(join(designRoot, CSS));
    studioReport(j, CSS);
    assert.equal(j.latestFor(CSS).deleted, true);
  });

  it('off a cell the old behaviour stands: a vanished photo is tombstoned', () => {
    const j = openJournal(dataDir);
    walkImport({ journal: j, designRoot, log: quiet });
    rmSync(join(designRoot, PHOTO));
    studioReport(j, PHOTO);
    assert.equal(j.latestFor(PHOTO).deleted, true);
  });
});

describe('cell mode — the walk never journals what the cache happens to hold', () => {
  it('an OLD media copy on disk is not appended over a newer row', () => {
    const j = cellJournal();
    // The newer bytes arrived through the door and live in the cache only.
    j.recordVerifiedWrite({
      designRoot,
      path: PHOTO,
      sha256: sha('PHOTO-V2'),
      size: 8,
      source: 'peer-put',
    });
    // The checkout still holds V1 (a git-bundle restore after a restart).
    const r = walkImport({ journal: j, designRoot, log: quiet });
    assert.equal(r.appended, 0);
    assert.equal(j.latestFor(PHOTO).sha256, sha('PHOTO-V2'));
  });

  it('a stale media copy is moved aside at boot so the checkout cannot serve it', () => {
    const j = cellJournal();
    j.recordVerifiedWrite({
      designRoot,
      path: PHOTO,
      sha256: sha('PHOTO-V2'),
      size: 8,
      source: 'peer-put',
    });
    writeFileSync(join(designRoot, 'system/ds/assets/untracked.jpg'), 'NOBODY-CLAIMS-ME');
    const r = quarantineStaleInert({ journal: j, designRoot, log: quiet });
    assert.equal(r.moved, 1);
    assert.equal(existsSync(join(designRoot, PHOTO)), false);
    assert.ok(
      existsSync(join(designRoot, 'system/ds/assets/untracked.jpg')),
      'no row ⇒ left alone'
    );
    // Quarantined, never unlinked — and the move cannot tombstone it either.
    studioReport(j, PHOTO);
    assert.equal(j.latestFor(PHOTO).deleted, false);
  });

  it('a copy that matches its row stays where it is', () => {
    const j = cellJournal();
    const r = quarantineStaleInert({ journal: j, designRoot, log: quiet });
    assert.equal(r.moved, 0);
    assert.equal(readFileSync(join(designRoot, PHOTO), 'utf8'), 'PHOTO-V1');
  });
});

describe('cell mode — "lost" media means the bytes are nowhere', () => {
  it('a mirrored photo absent from disk is not lost; an unmirrored, unpinned one is', async () => {
    const j = cellJournal();
    j.markMirrored(j.latestFor(PHOTO).seq);
    j.recordVerifiedWrite({
      designRoot,
      path: 'system/ds/assets/never-mirrored.jpg',
      sha256: sha('X'),
      size: 1,
      source: 'peer-put',
    });
    j.recordVerifiedWrite({
      designRoot,
      path: 'system/ds/assets/pinned.jpg',
      sha256: sha('P'),
      size: 1,
      source: 'peer-put',
    });
    rmSync(join(designRoot, PHOTO));
    const r = await reportLostFiles({
      journal: j,
      designRoot,
      hydrate: { failed: 0, skippedForBudget: 0 },
      isPinned: (s) => s === sha('P'),
      log: quiet,
    });
    assert.equal(r.lost, 1);
    assert.equal(j.latestFor('system/ds/assets/never-mirrored.jpg').sha256, null);
    assert.equal(j.latestFor('system/ds/assets/pinned.jpg').sha256, sha('P'));
    assert.equal(j.latestFor(PHOTO).sha256, sha('PHOTO-V1'));
  });
});
