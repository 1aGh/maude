// p8-holds-fix — the class-hold store is fed only by real canvas bodies, shrinks when they go, is
// capped, and survives a cell's sleep/wake (V2-8.9 final-3 recheck N1 + N2;
// decision maude/v2-p8-boundary-harden-config-never-promotes-to-code).
//
// N1: holds used to be noted inside `hubCheckoutClass` on EVERY classification — the read route,
// every write door — so any token probing `GET /_project-file/lib/Foo.tsx` on an undeclared hub
// planted a `code_sha = NULL` hold for a path that does not exist. After the owner declared, that
// path was `never` for good: the owner's real code push was refused, and the held list hid it
// (file not on disk). N2: holds reached the bucket only inside a `journal.db` generation, so a cell
// that slept after a declaration lost them and the boot walk journalled teammate canvases as code.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  checkoutFileClass,
  handleProjectFileRoute,
  heldCodeEntries,
  heldCodePaths,
  listProjectFiles,
  PROJECT_FILE_PREFIX,
  registerClassHolds,
  resolveCheckoutFileWrite,
} from '../src/file-manifest.mjs';
import {
  closeJournal,
  createJournalTail,
  handleJournalRoutes,
  JOURNAL_REPORT_PATH,
  openJournal,
  replayTailFromTarget,
  walkImport,
} from '../src/journal.mjs';
import { addToken, matchesScope, verifyToken } from '../src/tokens.mjs';

let dataDir;
let root;
let journal;
const quiet = { log() {}, warn() {}, error() {} };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'holdsb-data-'));
  root = mkdtempSync(join(tmpdir(), 'holdsb-root-'));
  journal = openJournal(dataDir);
  registerClassHolds(root, journal);
});
afterEach(() => {
  registerClassHolds(root, null);
  closeJournal(dataDir);
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

async function readRoute(token, rel) {
  let status = 0;
  const response = new Writable({ write: (_c, _e, cb) => cb() });
  response.writeHead = (s) => {
    status = s;
    return response;
  };
  response.setHeader = () => {};
  response.end = () => {};
  await handleProjectFileRoute({
    request: { headers: { authorization: `Bearer ${token}` } },
    response,
    pathname: `${PROJECT_FILE_PREFIX}${rel}`,
    method: 'GET',
    dataDir,
    secret: '',
    designRoot: root,
    matchesScope,
  });
  return status;
}

describe('N1 — a read or a door never plants a hold', () => {
  test('a viewer probing missing code paths while undeclared leaves no hold behind', async () => {
    const viewer = addToken(dataDir, {
      label: 'jonas',
      scope: '*',
      role: 'viewer',
      readOnly: true,
    }).value;
    for (const rel of ['lib/Foo.tsx', 'lib/Bar.tsx', 'components/Button.tsx']) {
      assert.equal(await readRoute(viewer, rel), 404);
    }
    assert.deepEqual(holdRows(), [], 'the read route classified, it did not note');
  });

  test('door classification of a path (write/probe admission) notes nothing', () => {
    put('lib/Real.tsx', 'export const x = 1;\n'); // even an existing body: a door is not a note site
    for (const rel of ['lib/Foo.tsx', 'lib/Real.tsx']) {
      checkoutFileClass(rel, root);
      resolveCheckoutFileWrite(root, rel);
    }
    assert.deepEqual(holdRows(), []);
  });

  test("after the probes, the owner's real code at a probed path is code, not held", async () => {
    const editor = addToken(dataDir, { label: 'tereza', scope: '*', role: 'editor' }).value;
    assert.equal(await readRoute(editor, 'lib/Foo.tsx'), 404);
    checkoutFileClass('lib/Foo.tsx', root);
    declare(['ui']);
    assert.equal(checkoutFileClass('lib/Foo.tsx', root), 'code-module', 'the door takes it');
    put('lib/Foo.tsx', 'export const Foo = () => null;\n'); // the owner's push lands
    walk();
    assert.equal(journal.latestFor('lib/Foo.tsx')?.class, 'code-module');
    assert.deepEqual(heldCodePaths(root), []);
  });

  test("a peer PUT row (only ever the owner's code — the door refuses canvases) notes nothing", () => {
    put('lib/Owner.tsx', 'export const Owner = () => null;\n');
    journal.recordWrite({ designRoot: root, path: 'lib/Owner.tsx', source: 'peer-put' });
    assert.deepEqual(holdRows(), []);
    declare(['ui']);
    walk();
    assert.equal(journal.latestFor('lib/Owner.tsx')?.class, 'code-module');
  });

  test('a nudge for a path with no body notes nothing', () => {
    const child = addToken(dataDir, { label: 'cell-child', scope: '*', role: 'editor' }).value;
    let out = null;
    handleJournalRoutes({
      path: JOURNAL_REPORT_PATH,
      method: 'POST',
      query: {},
      bearer: child,
      verify: (t) => verifyToken(dataDir, t, ''),
      matchesScope,
      designRoot: root,
      journal,
      body: { paths: ['lib/Ghost.tsx'] },
      isLoopback: true,
      respondJson: (status, payload) => {
        out = { status, payload };
      },
    });
    assert.equal(out.status, 200);
    assert.deepEqual(holdRows(), []);
  });

  test('a real canvas body is still noted by the walk and held after a declaration', () => {
    put('brand/x.tsx', 'export default () => <i>teammate</i>;\n');
    walk();
    assert.deepEqual(holdRows(), ['brand/x.tsx']);
    declare(['ui']);
    walk();
    assert.equal(journal.latestFor('brand/x.tsx'), null);
    assert.deepEqual(heldCodePaths(root), ['brand/x.tsx']);
  });
});

describe('N1 — a hold goes when its file goes, and the store is bounded', () => {
  test('the walk drops a hold whose file is gone', () => {
    put('brand/x.tsx', 'export default () => null;\n');
    put('brand/y.tsx', 'export default () => null;\n');
    walk();
    assert.deepEqual(holdRows(), ['brand/x.tsx', 'brand/y.tsx']);
    rmSync(join(root, 'brand/x.tsx'));
    walk();
    assert.deepEqual(holdRows(), ['brand/y.tsx']);
  });

  test('a studio nudge for a removed canvas drops its hold at once', () => {
    put('brand/x.tsx', 'export default () => null;\n');
    walk();
    rmSync(join(root, 'brand/x.tsx'));
    journal.recordGone({ designRoot: root, path: 'brand/x.tsx', source: 'studio-report' });
    assert.deepEqual(holdRows(), []);
  });

  test('once the gone file is pruned, the owner can put code at that path', () => {
    put('brand/x.tsx', 'export default () => <i>teammate</i>;\n');
    walk();
    declare(['ui']);
    rmSync(join(root, 'brand/x.tsx'));
    walk();
    assert.equal(checkoutFileClass('brand/x.tsx', root), 'code-module');
  });

  test('a held path whose file is missing is still listed to the owner until pruned', () => {
    put('brand/x.tsx', 'export default () => null;\n');
    walk();
    declare(['ui']);
    rmSync(join(root, 'brand/x.tsx'));
    // No walk yet: the hold still blocks the path, so the owner must see it.
    assert.deepEqual(heldCodeEntries(root), [
      { path: 'brand/x.tsx', reason: 'canvas-before-folders' },
    ]);
  });

  test('the hold store is capped; past the cap it refuses loudly', () => {
    const capData = mkdtempSync(join(tmpdir(), 'holdsb-cap-'));
    const errors = [];
    const capped = openJournal(capData, { maxHolds: 2, log: { error: (m) => errors.push(m) } });
    registerClassHolds(root, capped);
    try {
      for (const n of ['a', 'b', 'c', 'd']) put(`brand/${n}.tsx`, `export default () => '${n}';\n`);
      walk(capped);
      walk(capped);
      assert.equal(holdRows(capped).length, 2);
      assert.equal(errors.length, 1, 'one loud line, not one per pass');
      assert.match(errors[0], /cap/);
    } finally {
      registerClassHolds(root, journal);
      closeJournal(capData);
      rmSync(capData, { recursive: true, force: true });
    }
  });
});

/** An in-memory object-storage target — the R2 tail's only contract is put/get. */
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

describe('N2 — holds ride the write-behind tail, so a cell that sleeps keeps them', () => {
  test('a note schedules a tail write (no journal row is appended for a canvas)', () => {
    const target = memoryTarget();
    let scheduled = 0;
    const tail = createJournalTail({
      journal,
      target,
      log: quiet,
      setTimeoutImpl: () => {
        scheduled += 1;
        return 1;
      },
      clearTimeoutImpl: () => {},
    });
    put('brand/x.tsx', 'export default () => null;\n');
    walk();
    assert.equal(scheduled, 1, 'the hold alone woke the write-behind');
    void tail.stop();
  });

  test('restore-from-bucket: an older journal.db + the tail still holds the teammate canvas', async () => {
    const target = memoryTarget();
    const tail = createJournalTail({ journal, target, log: quiet });
    put('ui/Card.tsx', 'export default () => null;\n'); // a canvas the generation already had
    put('brand/x.tsx', 'export default () => <i>teammate</i>;\n');
    walk(); // noted while undeclared — AFTER the last generation
    declare(['ui']); // the owner declares; the cell then sleeps
    await tail.stop();

    // Wake: the generation's journal.db predates the hold — a fresh db here.
    const wakeData = mkdtempSync(join(tmpdir(), 'holdsb-wake-'));
    const woken = openJournal(wakeData);
    registerClassHolds(root, woken);
    try {
      const r = await replayTailFromTarget({
        journal: woken,
        target,
        designRoot: root,
        log: quiet,
      });
      assert.equal(r.state, 'replayed');
      assert.deepEqual(holdRows(woken), ['brand/x.tsx']);
      walk(woken); // the boot walk-import
      assert.equal(woken.latestFor('brand/x.tsx'), null, 'not journalled as owner code');
      assert.ok(!listProjectFiles(root).files.some((f) => f.path === 'brand/x.tsx'));
      assert.deepEqual(heldCodePaths(root), ['brand/x.tsx']);
    } finally {
      registerClassHolds(root, journal);
      closeJournal(wakeData);
      rmSync(wakeData, { recursive: true, force: true });
    }
  });

  test('a tail with no holds is byte-identical to the old shape', () => {
    put('ui/a.css', 'a{}\n');
    walk();
    const lines = journal.tailLines(0).split('\n');
    assert.ok(lines.every((l) => typeof JSON.parse(l).seq === 'number'));
  });

  test('a hold line from the tail is shape-checked, and can never pick the lifting sha', () => {
    const CODE = 'export const Button = () => null;\n';
    declare(['ui']);
    put('components/Button.tsx', CODE);
    walk();
    const ownerSha = journal.latestFor('components/Button.tsx').sha256;
    const line = JSON.stringify({
      holds: [
        '../etc/passwd.tsx',
        '_state/x.tsx',
        { path: 'brand/obj.tsx' },
        'brand/fine.tsx',
        'components/Button.tsx',
      ],
    });
    const res = journal.replayTail(line, { designRoot: root });
    assert.equal(res.malformed, 3, 'each bad entry is counted, like a bad row');
    assert.deepEqual(holdRows(), ['brand/fine.tsx', 'components/Button.tsx']);
    // The code sha comes from this journal, not from the tail.
    assert.equal(journal.heldCodeSha('components/Button.tsx'), ownerSha);
    assert.equal(journal.heldCodeSha('brand/fine.tsx'), null);
  });
});
