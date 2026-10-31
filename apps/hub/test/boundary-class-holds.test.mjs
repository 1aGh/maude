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
  heldCodePaths,
  listProjectFiles,
  registerClassHolds,
} from '../src/file-manifest.mjs';
import { closeJournal, openJournal, walkImport } from '../src/journal.mjs';
import { handleProjectConfigDoor, PROJECT_CONFIG_PATH } from '../src/project-config-door.mjs';
import { addToken } from '../src/tokens.mjs';

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
