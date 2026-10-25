// p8-c4b — the stored-grant canvas-ness signal on the hub (gate-b-c4k's split). An OLD canvas (no
// meta, no board, no DesignCanvas) that another canvas imports was "a helper" by its file, so a
// canvas-only member of the importer read its source through the file plane. A canvas any stored
// grant names (an account's, an invite's, a minted session's) is a canvas: refused as an import.
// The cell's studio child gets the same list through a hub-owned file. Studio halves:
// apps/studio/test/p8-c4b-known-canvases.test.ts.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  fileAccessForClaim,
  registerKnownCanvases,
  resetFileAccessCaches,
} from '../src/access-files.mjs';
import { closeInvites, createInvite } from '../src/invites.mjs';
import {
  createKnownCanvasesFile,
  KNOWN_CANVASES_ENV,
  storedGrantCanvases,
} from '../src/known-canvases.mjs';
import { childEnv } from '../src/studio-child.mjs';
import { addToken } from '../src/tokens.mjs';
import { closeUsers, createUser } from '../src/users.mjs';

const A = 'ui/a.tsx';
const OLD = 'ui/old-board.tsx';
const FILES = {
  'config.json': JSON.stringify({ canvasGroups: [{ path: 'ui', label: 'UI' }] }),
  [A]: "import { DesignCanvas } from '@maude/canvas-lib';\nimport Old from './old-board.tsx';\nexport default () => <DesignCanvas><Old /></DesignCanvas>;\n",
  'ui/a.meta.json': '{}',
  [OLD]: 'export default () => <section>CANARY-OLD</section>;\n',
};
const memberOfA = { v: 1, role: null, grants: [{ c: A, r: 'member' }] };
const PASSWORD = 'correct-horse-battery';

describe('p8-c4b — a canvas a stored grant names is never in an importer’s closure', () => {
  let root;
  let designRoot;
  let dataDir;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'c4b-hub-'));
    designRoot = join(root, 'design');
    dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    for (const [rel, text] of Object.entries(FILES)) {
      mkdirSync(join(designRoot, rel, '..'), { recursive: true });
      writeFileSync(join(designRoot, rel), text);
    }
    resetFileAccessCaches();
  });
  after(() => {
    registerKnownCanvases(designRoot, null);
    closeUsers(dataDir);
    closeInvites(dataDir);
    rmSync(root, { recursive: true, force: true });
  });

  test('nothing names it: the old canvas is A’s helper (the gap this closes)', () => {
    const files = fileAccessForClaim(memberOfA, { designRoot });
    assert.equal(files.sees(A), true);
    assert.equal(files.sees(OLD), true);
  });

  test('an explicit list names it: refused (A reads only its own)', () => {
    const files = fileAccessForClaim(memberOfA, { designRoot, knownCanvases: [OLD] });
    assert.equal(files.sees(A), true);
    assert.equal(files.sees(OLD), false);
  });

  test('every store counts: an account, an invite, a minted session', () => {
    assert.deepEqual(storedGrantCanvases(dataDir), []);
    createUser(dataDir, {
      email: 'c@example.com',
      password: PASSWORD,
      role: 'member',
      access: { v: 1, role: null, grants: [{ c: 'ui/by-account.tsx', r: 'member' }] },
    });
    createInvite(dataDir, {
      email: 'i@example.com',
      ttlHours: 1,
      access: { v: 1, role: null, grants: [{ c: 'ui/by-invite.tsx', r: 'member' }] },
    });
    addToken(dataDir, {
      label: 'cell-session',
      scope: '*',
      access: { v: 1, role: null, grants: [{ c: OLD, r: 'member' }] },
    });
    assert.deepEqual(storedGrantCanvases(dataDir), ['ui/by-account.tsx', 'ui/by-invite.tsx', OLD]);
  });

  test('the registered source (server.mjs wiring): a member of A no longer sees it', () => {
    registerKnownCanvases(designRoot, () => storedGrantCanvases(dataDir));
    const files = fileAccessForClaim(memberOfA, { designRoot });
    assert.equal(files.sees(A), true);
    assert.equal(files.sees(OLD), false);
    // a session granted both still reads it (its own grant)
    const both = fileAccessForClaim(
      { v: 1, role: null, grants: [...memberOfA.grants, { c: OLD, r: 'member' }] },
      { designRoot }
    );
    assert.equal(both.sees(OLD), true);
  });

  test('the child’s file: written on a change only, by rename, named by env', () => {
    const file = join(dataDir, 'known-canvases.json');
    let list = [A];
    const k = createKnownCanvasesFile({ dataDir, file, list: () => list });
    k.refresh();
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { canvases: [A] });
    const ino = statSync(file).ino;
    k.refresh();
    assert.equal(statSync(file).ino, ino, 'unchanged → not rewritten');
    list = [A, OLD];
    k.refresh();
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { canvases: [A, OLD] });
    assert.notEqual(statSync(file).ino, ino);
    assert.equal(KNOWN_CANVASES_ENV, 'MAUDE_HUB_KNOWN_CANVASES_FILE');
    assert.equal(
      childEnv({ PATH: '/bin' }, { port: 1, knownCanvasesFile: file })[KNOWN_CANVASES_ENV],
      file
    );
    assert.equal(childEnv({ PATH: '/bin' }, { port: 1 })[KNOWN_CANVASES_ENV], undefined);
  });

  test('server.mjs registers the source and refreshes the file before it forwards', () => {
    const src = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
    assert.match(
      src,
      /registerKnownCanvases\(journalDesignRoot, \(\) => storedGrantCanvases\(dataDir\)\)/
    );
    assert.match(src, /knownCanvasesFile: knownCanvasesFile\?\.file/);
    assert.match(
      src,
      /knownCanvasesFile\?\.refresh\(\);\n\s+const handled = await studioProxy\.handleCanvas\(/
    );
    assert.match(
      src,
      /knownCanvasesFile\?\.refresh\(\);\n\s+const handled = await studioProxy\.handle\(/
    );
  });
});
