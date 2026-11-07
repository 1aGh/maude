// #167 T5.3 — the hub folder boundary's held-file follow-ups (p8-hub-folder-boundary,
// p8-held-surface, p8-holds-fix residuals; decision maude/v2-p8-boundary-harden-config-never-promotes-to-code).
//
//   overflow — past the hold cap (or the walk cap) a boundary canvas went un-noted, and after a
//              declaration it was journalled as owner code: a persisted flag now fails closed.
//   delta    — every tail write carried the whole hold set, so an older hub counted it malformed on
//              every wake; the tail now carries only what changed since its generation.
//   replay   — replay only ever added holds: a hold pruned after the generation came back and refused
//              the owner's later code row; and a pruned hold left no memory, so teammate bytes
//              restored by an unhooked writer after the declaration were journalled as code.
//   wake     — after a wake, a teammate editing the held canvas writes no code-module row.

import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { heldCodePaths, listProjectFiles, registerClassHolds } from '../src/file-manifest.mjs';
import {
  closeJournal,
  createJournalTail,
  handleJournalRoutes,
  JOURNAL_PATH,
  JOURNAL_TAIL_KEY,
  journalDbPath,
  openJournal,
  replayTailFromTarget,
  walkImport,
} from '../src/journal.mjs';
import { addToken, matchesScope, verifyToken } from '../src/tokens.mjs';

let dataDir;
let root;
let journal;
const quiet = { log() {}, warn() {}, error() {} };
const extra = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'holds53-data-'));
  root = mkdtempSync(join(tmpdir(), 'holds53-root-'));
  journal = openJournal(dataDir);
  registerClassHolds(root, journal);
});
afterEach(() => {
  registerClassHolds(root, null);
  closeJournal(dataDir);
  for (const d of extra.splice(0)) {
    closeJournal(d);
    rmSync(d, { recursive: true, force: true });
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

function put(rel, text) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}
const declare = (paths) =>
  writeFileSync(
    join(root, 'config.json'),
    JSON.stringify({ canvasGroups: paths.map((p) => ({ label: p, path: p })) })
  );
const walk = (j = journal) => walkImport({ journal: j, designRoot: root, log: quiet });
const holdRows = (j = journal) =>
  j.db
    .prepare('SELECT path FROM class_holds ORDER BY path')
    .all()
    .map((r) => r.path);
const TEAMMATE = 'export default () => <i>teammate</i>;\n';
const CODE = 'export const Owner = () => null;\n';

function memoryTarget() {
  const store = new Map();
  return {
    store,
    async put(key, buf) {
      store.set(key, Buffer.from(buf));
    },
    async get(key) {
      return store.get(key) ?? null;
    },
  };
}

/** A backup generation: a byte copy of journal.db (WAL checkpointed first). */
function generation(j = journal) {
  j.db.pragma('wal_checkpoint(TRUNCATE)');
  const gen = mkdtempSync(join(tmpdir(), 'holds53-gen-'));
  extra.push(gen);
  copyFileSync(journalDbPath(dataDir), journalDbPath(gen));
  return gen;
}

/** Wake from a generation: a fresh data dir holding the generation's db, then the tail replay. */
async function wake(gen, target) {
  const wakeData = mkdtempSync(join(tmpdir(), 'holds53-wake-'));
  extra.push(wakeData);
  copyFileSync(journalDbPath(gen), journalDbPath(wakeData));
  const woken = openJournal(wakeData);
  registerClassHolds(root, woken);
  const errors = [];
  const r = await replayTailFromTarget({
    journal: woken,
    target,
    designRoot: root,
    log: { log() {}, error: (m) => errors.push(m) },
  });
  return { woken, r, errors };
}

function ownerRead(token, j = journal) {
  let out = null;
  handleJournalRoutes({
    path: JOURNAL_PATH,
    method: 'GET',
    query: {},
    bearer: token,
    verify: (t) => verifyToken(dataDir, t, ''),
    matchesScope,
    designRoot: root,
    journal: j,
    body: null,
    isLoopback: true,
    respondJson: (status, payload) => {
      out = { status, payload };
    },
  });
  return out;
}

describe('overflow — past the hold cap, a boundary canvas fails closed', () => {
  function capped() {
    const capData = mkdtempSync(join(tmpdir(), 'holds53-cap-'));
    extra.push(capData);
    const j = openJournal(capData, { maxHolds: 2, log: quiet });
    registerClassHolds(root, j);
    return { j, capData };
  }

  test('an un-noted canvas past the cap is never journalled as code after a declaration', () => {
    const { j } = capped();
    for (const n of ['a', 'b', 'c']) put(`brand/${n}.tsx`, TEAMMATE);
    walk(j);
    assert.equal(holdRows(j).length, 2);
    assert.equal(j.holdsOverflowed(), true);
    declare(['ui']);
    walk(j);
    for (const n of ['a', 'b', 'c']) assert.equal(j.latestFor(`brand/${n}.tsx`), null, n);
    assert.ok(!listProjectFiles(root).files.some((f) => f.path.startsWith('brand/')));
  });

  test('the flag is persisted: a reopened journal still fails closed', () => {
    const { j, capData } = capped();
    for (const n of ['a', 'b', 'c']) put(`brand/${n}.tsx`, TEAMMATE);
    walk(j);
    closeJournal(capData);
    const again = openJournal(capData, { maxHolds: 2, log: quiet });
    registerClassHolds(root, again);
    assert.equal(again.holdsOverflowed(), true);
    declare(['ui']);
    walk(again);
    assert.equal(again.latestFor('brand/c.tsx'), null);
  });

  test("owner code keeps its lane: an existing code row, and the owner's own door write", () => {
    const { j } = capped();
    declare(['ui']);
    put('lib/Old.tsx', CODE);
    walk(j); // journalled as code while declared
    rmSync(join(root, 'config.json'));
    for (const n of ['a', 'b', 'c']) put(`brand/${n}.tsx`, TEAMMATE);
    walk(j);
    assert.equal(j.holdsOverflowed(), true);
    declare(['ui']);
    walk(j);
    assert.equal(j.latestFor('lib/Old.tsx')?.class, 'code-module');
    put('lib/New.tsx', CODE.replace('Owner', 'Fresh'));
    j.recordWrite({ designRoot: root, path: 'lib/New.tsx', source: 'peer-put' });
    assert.equal(j.latestFor('lib/New.tsx')?.class, 'code-module');
  });

  test('the owner is told the hold list overflowed', () => {
    const { j } = capped();
    const owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
    const editor = addToken(dataDir, { label: 'tereza', scope: '*', role: 'editor' }).value;
    for (const n of ['a', 'b', 'c']) put(`brand/${n}.tsx`, TEAMMATE);
    walk(j);
    declare(['ui']);
    assert.equal(ownerRead(owner, j).payload.heldOverflow, true);
    assert.equal('heldOverflow' in ownerRead(editor, j).payload, false);
  });

  test('a complete undeclared walk under the cap clears the flag', () => {
    const { j } = capped();
    for (const n of ['a', 'b', 'c']) put(`brand/${n}.tsx`, TEAMMATE);
    walk(j);
    assert.equal(j.holdsOverflowed(), true);
    rmSync(join(root, 'brand/c.tsx'));
    walk(j); // prunes nothing (a, b held), notes nothing new, refuses nothing
    assert.equal(j.holdsOverflowed(), false);
  });
});

describe('delta — the tail carries only the holds changed since its generation', () => {
  test('a hold from before the generation is not rewritten; a new one is', async () => {
    const target = memoryTarget();
    const tail = createJournalTail({ journal, target, log: quiet });
    put('ui/a.css', 'a{}\n');
    put('brand/old.tsx', TEAMMATE);
    walk();
    put('ui/b.css', 'b{}\n');
    walk();
    await tail.rotate(journal.head()); // a generation snapshotted the db here
    const holdLine = () =>
      journal
        .tailLines(journal.head())
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .find((r) => 'holds' in r);
    assert.equal(holdLine(), undefined, 'no hold changed since the generation: no hold line');
    put('brand/new.tsx', TEAMMATE);
    walk();
    assert.deepEqual(holdLine().holds, ['brand/new.tsx']);
    await tail.stop();
  });

  test('an older reader of a tail with no hold changes sees only rows', async () => {
    const target = memoryTarget();
    const tail = createJournalTail({ journal, target, log: quiet });
    put('brand/old.tsx', TEAMMATE);
    put('ui/a.css', 'a{}\n');
    walk();
    put('ui/b.css', 'b{}\n');
    walk();
    await tail.rotate(journal.head());
    put('ui/c.css', 'c{}\n');
    walk();
    await tail.flush();
    const lines = target.store.get(JOURNAL_TAIL_KEY).toString('utf8').split('\n');
    assert.ok(lines.every((l) => typeof JSON.parse(l).seq === 'number'));
    await tail.stop();
  });
});

describe('replay — pruned holds go, and a pruned hold remembers its path', () => {
  test("a hold pruned after the generation does not refuse the owner's later code row", async () => {
    const target = memoryTarget();
    const tail = createJournalTail({ journal, target, log: quiet });
    put('brand/x.tsx', TEAMMATE);
    walk();
    declare(['ui']);
    walk();
    const gen = generation(); // holds brand/x.tsx
    await tail.rotate(journal.head());
    rmSync(join(root, 'brand/x.tsx'));
    walk(); // pruned
    put('brand/x.tsx', CODE); // the owner's own code through the write door
    journal.recordWrite({ designRoot: root, path: 'brand/x.tsx', source: 'peer-put' });
    const ownerSha = journal.latestFor('brand/x.tsx')?.sha256;
    assert.ok(ownerSha);
    await tail.stop();

    rmSync(join(root, 'brand/x.tsx')); // a cell wakes with the file not yet hydrated
    const { woken, r, errors } = await wake(gen, target);
    assert.equal(r.malformed, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(holdRows(woken), []);
    assert.equal(woken.latestFor('brand/x.tsx')?.sha256, ownerSha);
    put('brand/x.tsx', CODE); // the hydrate refills the owner's bytes
    woken.recordWrite({ designRoot: root, path: 'brand/x.tsx', source: 'hydrate' });
    walk(woken);
    assert.equal(woken.latestFor('brand/x.tsx')?.class, 'code-module');
    assert.deepEqual(heldCodePaths(root), []);
  });

  test('teammate bytes restored at a pruned path after the declaration are held, not code', () => {
    put('brand/x.tsx', TEAMMATE);
    walk();
    declare(['ui']);
    rmSync(join(root, 'brand/x.tsx'));
    walk(); // pruned
    assert.deepEqual(holdRows(), []);
    put('brand/x.tsx', TEAMMATE); // a git restore — no hook, the walk finds it
    walk();
    assert.equal(journal.latestFor('brand/x.tsx'), null);
    assert.deepEqual(heldCodePaths(root), ['brand/x.tsx']);
  });

  test("the owner's door write at a pruned path is code, and stays code", () => {
    put('brand/x.tsx', TEAMMATE);
    walk();
    declare(['ui']);
    rmSync(join(root, 'brand/x.tsx'));
    walk();
    put('brand/x.tsx', CODE);
    journal.recordWrite({ designRoot: root, path: 'brand/x.tsx', source: 'peer-put' });
    walk();
    assert.equal(journal.latestFor('brand/x.tsx')?.class, 'code-module');
    assert.deepEqual(heldCodePaths(root), []);
  });
});

describe('wake — a teammate editing the held canvas after a wake writes no code row', () => {
  test('wake → the teammate edits the doc → no code-module row', async () => {
    const target = memoryTarget();
    const tail = createJournalTail({ journal, target, log: quiet });
    put('ui/a.css', 'a{}\n');
    walk();
    const gen = generation(); // before the hold
    put('brand/x.tsx', TEAMMATE);
    walk();
    declare(['ui']);
    await tail.stop();

    const { woken } = await wake(gen, target);
    walk(woken); // the boot walk-import
    // The teammate edits the canvas: the doc lane writes the body, the studio child nudges.
    put('brand/x.tsx', TEAMMATE.replace('teammate', 'teammate, edited'));
    woken.recordWrite({ designRoot: root, path: 'brand/x.tsx', source: 'studio-report' });
    walk(woken);
    const rows = woken.db.prepare("SELECT * FROM file_journal WHERE path = 'brand/x.tsx'").all();
    assert.deepEqual(rows, []);
    assert.ok(existsSync(join(root, 'brand/x.tsx')));
    assert.deepEqual(heldCodePaths(root), ['brand/x.tsx']);
  });
});
