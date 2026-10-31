// p8-boundary-harden — "a config change never promotes a path into code-module" (final-3 attacker
// L1, defender I5; decision maude/v2-p8-boundary-harden-config-never-promotes-to-code).
//
// While the owner has declared no folders the hub is the folder boundary, so a teammate's
// `brand/x.tsx` is a canvas (doc lane, any editor). When the owner later declares folders that
// leave `brand/` out, the classifier says `code-module`: the reconciler (walk-import) journalled it
// as new code, it travelled the owner-trusted lane and the owner's desktop auto-committed it under
// the owner's name. Now the hub notes each boundary-only canvas and HOLDS it as `never` once the
// class would flip — unless its bytes are exactly the owner's last code version (nothing was
// promoted). The reverse (I5): the owner's code in a non-default folder on an undeclared hub turns
// canvas; no tombstone is written and its last code row stays, so desktops keep it.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  checkoutFileClass,
  heldCodeEntries,
  heldCodePaths,
  listProjectFiles,
  registerClassHolds,
} from '../src/file-manifest.mjs';
import {
  closeJournal,
  handleJournalRoutes,
  JOURNAL_PATH,
  JOURNAL_REPORT_PATH,
  openJournal,
  walkImport,
} from '../src/journal.mjs';
import { handleProjectConfigDoor, PROJECT_CONFIG_PATH } from '../src/project-config-door.mjs';
import { addToken, matchesScope, verifyToken } from '../src/tokens.mjs';

let dataDir;
let root;
let journal;
let owner;
const quiet = { log() {}, warn() {}, error() {} };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'holds-data-'));
  root = mkdtempSync(join(tmpdir(), 'holds-root-'));
  journal = openJournal(dataDir);
  registerClassHolds(root, journal);
  owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
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
const undeclare = () => rmSync(join(root, 'config.json'), { force: true });
const listed = () => listProjectFiles(root).files.map((f) => f.path);
const walk = () => walkImport({ journal, designRoot: root, log: quiet });

/** The owner declares folders through the real owner-only door, wired as server.mjs wires it. */
async function ownerDeclares(paths) {
  const request = {
    headers: { authorization: `Bearer ${owner}` },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(
        JSON.stringify({ canvasGroups: paths.map((p) => ({ label: p, path: p })) })
      );
    },
  };
  let status = 0;
  const response = new Writable({ write: (_c, _e, cb) => cb() });
  response.writeHead = (s) => {
    status = s;
    return response;
  };
  await handleProjectConfigDoor({
    request,
    response,
    pathname: PROJECT_CONFIG_PATH,
    method: 'PUT',
    dataDir,
    secret: '',
    designRoot: root,
    beforeChange: () => listProjectFiles(root),
  });
  assert.equal(status, 200);
}

describe('L1 — declaring folders never turns a teammate canvas into owner code', () => {
  test('a boundary canvas the hub has seen is held as never after the owner declares', async () => {
    put('brand/x.tsx', 'export default () => <i>teammate</i>;\n');
    walk(); // the cell's own reconciler tick while undeclared
    assert.equal(journal.latestFor('brand/x.tsx'), null, 'a canvas has no file-plane row');

    await ownerDeclares(['ui']);
    walk();
    assert.equal(journal.latestFor('brand/x.tsx'), null, 'never journalled as new code');
    assert.ok(!listed().includes('brand/x.tsx'), 'never offered on the code lane');
    assert.equal(checkoutFileClass('brand/x.tsx', root), 'never', 'no door takes it as code');
    assert.deepEqual(heldCodePaths(root), ['brand/x.tsx'], 'named for the owner');
  });

  test('the flip moment: a canvas no walk has seen yet is noted by the declaration itself', async () => {
    put('brand/y.tsx', 'export default () => <i>just written</i>;\n');
    await ownerDeclares(['ui']); // no walk between the write and the declare
    walk();
    assert.equal(journal.latestFor('brand/y.tsx'), null);
    assert.deepEqual(heldCodePaths(root), ['brand/y.tsx']);
  });

  test('moving the folder into the declaration makes it a canvas again — nothing held', async () => {
    put('brand/x.tsx', 'export default () => null;\n');
    walk();
    await ownerDeclares(['ui']);
    declare(['ui', 'brand']);
    assert.equal(checkoutFileClass('brand/x.tsx', root), 'canvas-owned');
    assert.deepEqual(heldCodePaths(root), []);
  });
});

describe('I5 — owner code on an undeclared hub is never lost', () => {
  const CODE = 'export const Button = () => null;\n';

  test('undeclared: no tombstone, the code row stays; re-declared and unchanged: code again', async () => {
    declare(['ui']);
    put('components/Button.tsx', CODE);
    walk();
    const row = journal.latestFor('components/Button.tsx');
    assert.equal(row?.class, 'code-module');

    undeclare(); // the cell runs undeclared (an older config, or none)
    walk();
    const still = journal.latestFor('components/Button.tsx');
    assert.equal(still.seq, row.seq, 'no new row');
    assert.ok(!still.deleted, 'no tombstone — desktops keep the owner version');
    assert.ok(!listed().includes('components/Button.tsx'), 'a canvas while undeclared (Michal A)');

    await ownerDeclares(['ui']);
    walk();
    assert.ok(listed().includes('components/Button.tsx'), 'unchanged owner code is code again');
    assert.equal(checkoutFileClass('components/Button.tsx', root), 'code-module');
    assert.deepEqual(heldCodePaths(root), []);
    assert.equal(journal.latestFor('components/Button.tsx').seq, row.seq, 'same bytes, no churn');
  });

  test('edited on the doc lane while undeclared: held, and the owner version stays the row', async () => {
    declare(['ui']);
    put('components/Button.tsx', CODE);
    walk();
    const row = journal.latestFor('components/Button.tsx');

    undeclare();
    walk();
    put('components/Button.tsx', 'export const Button = () => <b>teammate</b>;\n');
    walk();

    await ownerDeclares(['ui']);
    walk();
    assert.equal(journal.latestFor('components/Button.tsx').sha256, row.sha256, 'not promoted');
    assert.equal(checkoutFileClass('components/Button.tsx', root), 'never');
    assert.deepEqual(heldCodePaths(root), ['components/Button.tsx']);
  });
});

describe('the hub wires it', () => {
  test('server.mjs registers the journal as the holds store and walks before a declaration', () => {
    const src = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
    assert.match(src, /registerClassHolds\(journalDesignRoot, journal\)/);
    assert.match(
      src,
      /beforeChange: \(\) => \{\s*if \(journal && journalDesignRoot\) listProjectFiles\(journalDesignRoot\);/
    );
  });
});

/** One `GET /api/journal` (or report POST) through the real route with a real token check. */
function journalRead(token, { designRoot = root, j = journal, path = JOURNAL_PATH, body } = {}) {
  let out = null;
  handleJournalRoutes({
    path,
    method: path === JOURNAL_PATH ? 'GET' : 'POST',
    query: {},
    bearer: token,
    verify: (t) => verifyToken(dataDir, t, ''),
    matchesScope,
    designRoot,
    journal: j,
    body: body ?? null,
    isLoopback: true,
    respondJson: (status, payload) => {
      out = { status, payload };
    },
  });
  return out;
}

describe('p8-held-surface — the owner is told what is held, and only the owner', () => {
  async function holdOne() {
    put('brand/x.tsx', 'export default () => <i>teammate</i>;\n');
    walk();
    await ownerDeclares(['ui']);
    walk();
  }

  test('the owner journal read names each held path with its reason', async () => {
    await holdOne();
    const got = journalRead(owner);
    assert.equal(got.status, 200);
    assert.deepEqual(got.payload.held, [{ path: 'brand/x.tsx', reason: 'canvas-before-folders' }]);
    assert.equal(got.payload.heldCount, 1);
  });

  test('an editor, a viewer and a canvas-scoped token never see the held list', async () => {
    await holdOne();
    const editor = addToken(dataDir, { label: 'tereza', scope: '*', role: 'editor' }).value;
    const viewer = addToken(dataDir, {
      label: 'jonas',
      scope: '*',
      role: 'viewer',
      readOnly: true,
    }).value;
    const readOnlyOwner = addToken(dataDir, {
      label: 'owner-ro',
      scope: '*',
      role: 'owner',
      readOnly: true,
    }).value;
    const scopedOwner = addToken(dataDir, { label: 'owner-ui', scope: 'ui', role: 'owner' }).value;
    for (const t of [editor, viewer, readOnlyOwner, scopedOwner]) {
      const got = journalRead(t);
      assert.equal(got.status, 200);
      assert.ok(!('held' in got.payload), 'no held field for a non-owner');
      assert.ok(!('heldCount' in got.payload));
    }
  });

  test("another tenant's holds never reach this owner", async () => {
    await holdOne();
    // A second checkout with its own journal and its own hold.
    const otherData = mkdtempSync(join(tmpdir(), 'holds-data-b-'));
    const otherRoot = mkdtempSync(join(tmpdir(), 'holds-root-b-'));
    const otherJournal = openJournal(otherData);
    registerClassHolds(otherRoot, otherJournal);
    try {
      mkdirSync(join(otherRoot, 'secret'), { recursive: true });
      writeFileSync(join(otherRoot, 'secret/plan.tsx'), 'export default () => null;\n');
      walkImport({ journal: otherJournal, designRoot: otherRoot, log: quiet });
      writeFileSync(
        join(otherRoot, 'config.json'),
        JSON.stringify({ canvasGroups: [{ label: 'ui', path: 'ui' }] })
      );
      assert.deepEqual(heldCodePaths(otherRoot), ['secret/plan.tsx']);
      const got = journalRead(owner);
      assert.deepEqual(
        got.payload.held.map((h) => h.path),
        ['brand/x.tsx'],
        'only this checkout'
      );
    } finally {
      registerClassHolds(otherRoot, null);
      closeJournal(otherData);
      rmSync(otherData, { recursive: true, force: true });
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  test('owner code edited on the canvas lane is held with its own reason', async () => {
    declare(['ui']);
    put('components/Button.tsx', 'export const Button = () => null;\n');
    walk();
    undeclare();
    walk();
    put('components/Button.tsx', 'export const Button = () => <b>teammate</b>;\n');
    walk();
    await ownerDeclares(['ui']);
    walk();
    assert.deepEqual(heldCodeEntries(root), [
      { path: 'components/Button.tsx', reason: 'changed-as-canvas' },
    ]);
  });

  test('an owner with nothing held gets an empty list (a panel row clears)', () => {
    declare(['ui']);
    const got = journalRead(owner);
    assert.deepEqual(got.payload.held, []);
    assert.equal(got.payload.heldCount, 0);
  });
});

describe('p8-held-surface — a config that arrives by git never promotes a teammate canvas', () => {
  // The project-config door walks before it writes (beforeChange). A config.json that a
  // pull or checkout writes straight to disk has no door and no pre-walk: the next
  // walk-import is the first classification under the new groups. The hold must already
  // exist by then — every door a teammate canvas enters through notes it at the write.
  const gitWritesConfig = (paths) => declare(paths); // a plain disk write, no door, no walk

  test('a canvas written through the studio nudge (no walk since) is held after a git config', () => {
    put('brand/x.tsx', 'export default () => <i>teammate via the cell</i>;\n');
    const child = addToken(dataDir, { label: 'cell-child', scope: '*', role: 'editor' }).value;
    const nudge = journalRead(child, {
      path: JOURNAL_REPORT_PATH,
      body: { paths: ['brand/x.tsx'] },
    });
    assert.equal(nudge.status, 200);
    gitWritesConfig(['ui']);
    walk();
    assert.equal(journal.latestFor('brand/x.tsx'), null, 'never journalled as code');
    assert.ok(!listed().includes('brand/x.tsx'), 'never offered on the code lane');
    assert.equal(checkoutFileClass('brand/x.tsx', root), 'never');
    assert.deepEqual(heldCodePaths(root), ['brand/x.tsx']);
  });

  test('a canvas a peer PUT recorded (recordWrite) is held after a git config', () => {
    put('brand/z.tsx', 'export default () => <i>teammate via a peer</i>;\n');
    const row = journal.recordWrite({ designRoot: root, path: 'brand/z.tsx', source: 'peer-put' });
    assert.equal(row, null, 'a canvas has no file-plane row');
    gitWritesConfig(['ui']);
    walk();
    assert.equal(journal.latestFor('brand/z.tsx'), null);
    assert.deepEqual(heldCodePaths(root), ['brand/z.tsx']);
  });

  test('a canvas seen by a manifest read is held after a git config', () => {
    put('brand/w.tsx', 'export default () => null;\n');
    listProjectFiles(root); // a peer's manifest read while undeclared
    gitWritesConfig(['ui']);
    walk();
    assert.equal(journal.latestFor('brand/w.tsx'), null);
    assert.deepEqual(heldCodePaths(root), ['brand/w.tsx']);
  });

  test('owner code that arrives WITH the git config is code, not held', () => {
    put('brand/x.tsx', 'export default () => null;\n');
    walk();
    // The pull brings the declaration AND new owner code in one go.
    put('components/Button.tsx', 'export const Button = () => null;\n');
    gitWritesConfig(['ui']);
    walk();
    assert.equal(journal.latestFor('components/Button.tsx')?.class, 'code-module');
    assert.deepEqual(heldCodePaths(root), ['brand/x.tsx'], 'only the teammate canvas');
  });
});
