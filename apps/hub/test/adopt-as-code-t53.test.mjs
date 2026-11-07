// #167 T5.3 item 2 — "Adopt as code": the owner's explicit way out of a class hold.
//
// A hold with no owner code sha never lifts while its file exists (final-4 recheck L2): a teammate's
// canvas at a path the owner later wants for code stays `never`. Implicit adoption by an owner write
// was rejected on purpose (decision v2-p8-holds-fix-no-implicit-owner-adoption), so the way out is an
// explicit, owner-only action: `POST /api/journal/adopt { path }` drops the hold, clears the ghost
// and journals the bytes on disk as the owner's code.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { heldCodePaths, listProjectFiles, registerClassHolds } from '../src/file-manifest.mjs';
import {
  closeJournal,
  handleJournalRoutes,
  JOURNAL_ADOPT_PATH,
  openJournal,
  walkImport,
} from '../src/journal.mjs';
import { addToken, matchesScope, verifyToken } from '../src/tokens.mjs';

let dataDir;
let root;
let journal;
const quiet = { log() {}, warn() {}, error() {} };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'adopt53-data-'));
  root = mkdtempSync(join(tmpdir(), 'adopt53-root-'));
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
const walk = () => walkImport({ journal, designRoot: root, log: quiet });
const TEAMMATE = 'export default () => <i>teammate</i>;\n';

function adopt(token, body, { method = 'POST' } = {}) {
  let out = null;
  const handled = handleJournalRoutes({
    path: JOURNAL_ADOPT_PATH,
    method,
    query: {},
    bearer: token,
    verify: (t) => verifyToken(dataDir, t, ''),
    matchesScope,
    designRoot: root,
    journal,
    body,
    isLoopback: false,
    respondJson: (status, payload) => {
      out = { status, payload };
    },
  });
  assert.equal(handled, true);
  return out;
}

/** A teammate canvas made while undeclared, held once the owner declares `ui` only. */
function heldTeammateCanvas(rel = 'brand/x.tsx') {
  put(rel, TEAMMATE);
  walk();
  declare(['ui']);
  walk();
  assert.deepEqual(heldCodePaths(root), [rel]);
  assert.equal(journal.latestFor(rel), null);
}

describe('POST /api/journal/adopt — owner only', () => {
  test('an editor, a member, a viewer and a read-only owner get 403 and the file stays held', () => {
    heldTeammateCanvas();
    const tokens = [
      addToken(dataDir, { label: 'tereza', scope: '*', role: 'editor' }).value,
      addToken(dataDir, { label: 'petr', scope: '*', role: 'member' }).value,
      addToken(dataDir, { label: 'eva', scope: '*', role: 'viewer' }).value,
      addToken(dataDir, { label: 'ro-owner', scope: '*', role: 'owner', readOnly: true }).value,
      // a canvas-scoped owner token is not the project owner either
      addToken(dataDir, { label: 'scoped', scope: 'brand/x.tsx', role: 'owner' }).value,
    ];
    for (const t of tokens) {
      const r = adopt(t, { path: 'brand/x.tsx' });
      assert.equal(r.status, 403, JSON.stringify(r.payload));
    }
    assert.deepEqual(heldCodePaths(root), ['brand/x.tsx']);
    assert.equal(journal.latestFor('brand/x.tsx'), null);
  });

  test('no token is 401, a GET is 405', () => {
    heldTeammateCanvas();
    assert.equal(adopt(null, { path: 'brand/x.tsx' }).status, 401);
    const owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
    assert.equal(adopt(owner, null, { method: 'GET' }).status, 405);
  });

  test("the owner's adopt drops the hold and the file syncs as code from then on", () => {
    heldTeammateCanvas();
    const owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
    const r = adopt(owner, { path: 'brand/x.tsx' });
    assert.equal(r.status, 200, JSON.stringify(r.payload));
    assert.equal(r.payload.adopted, true);
    assert.deepEqual(heldCodePaths(root), []);
    const row = journal.latestFor('brand/x.tsx');
    assert.equal(row?.class, 'code-module');
    assert.equal(journal.latestSourceFor('brand/x.tsx'), 'owner-adopt');
    assert.ok(listProjectFiles(root).files.some((f) => f.path === 'brand/x.tsx'));
    // The next walk keeps it code: nothing re-holds it.
    walk();
    assert.deepEqual(heldCodePaths(root), []);
    assert.equal(journal.latestFor('brand/x.tsx')?.class, 'code-module');
  });

  test('a ghost path (a pruned hold, teammate bytes restored) is adopted too, and the ghost is gone', () => {
    heldTeammateCanvas();
    rmSync(join(root, 'brand/x.tsx'));
    walk(); // the prune: the hold goes, a ghost stays
    put('brand/x.tsx', TEAMMATE); // an unhooked writer restores the teammate bytes
    walk();
    assert.deepEqual(heldCodePaths(root), ['brand/x.tsx']);
    const owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
    assert.equal(adopt(owner, { path: 'brand/x.tsx' }).status, 200);
    assert.equal(journal.isGhost('brand/x.tsx'), false);
    walk();
    assert.deepEqual(heldCodePaths(root), []);
    assert.equal(journal.latestFor('brand/x.tsx')?.class, 'code-module');
  });

  test('a path that is not held, or not there, answers 404 and writes nothing', () => {
    heldTeammateCanvas();
    const owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
    put('ui/a.tsx', TEAMMATE); // inside a declared canvas folder: never held
    const before = journal.head();
    for (const path of ['ui/a.tsx', 'lib/nope.tsx', '../etc/passwd', 42, '']) {
      const r = adopt(owner, { path });
      assert.equal(r.status, 404, `${path}: ${JSON.stringify(r.payload)}`);
    }
    assert.equal(adopt(owner, null).status, 404);
    assert.equal(journal.head(), before);
    assert.deepEqual(heldCodePaths(root), ['brand/x.tsx']);
  });

  test('while no folders are declared there is nothing to adopt', () => {
    put('brand/x.tsx', TEAMMATE);
    walk();
    const owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
    assert.equal(adopt(owner, { path: 'brand/x.tsx' }).status, 404);
  });
});
