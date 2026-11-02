// gate-b-c4m (ethical hacker round 7, M + L) — the hub file plane never serves a canvas-only member
// an `.html` canvas (or any non-module file) its canvas imports, nor an `.html` DS specimen; a
// specimen's stylesheet lifted by a real canvas stays readable (defender M-B).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { fileAccessForClaim, resetFileAccessCaches } from '../src/access-files.mjs';

const FILES = {
  'config.json': JSON.stringify({ designSystems: [{ name: 'x', path: 'system/x' }] }),
  'system/x/tokens.css': ':root{--a:1}',
  'system/x/preview/colors.html': '<html>CANARY-SPECIMEN</html>',
  'system/x/preview/empty-state.tsx': 'export default () => <b>SPEC</b>;\n',
  'system/x/preview/empty-state.css': '.empty{}',
  'ui/a.tsx':
    "import B from './b.html';\nimport H from './helper.ts';\nexport default () => <p />;\n",
  'ui/a.meta.json': '{}',
  'ui/helper.ts': 'export const H = 1;\n',
  'ui/b.html': '<html>CANARY-B<img src="../assets/b.png"></html>',
  'assets/b.png': 'PNG',
  'ui/n.tsx':
    "import N from './notes.md' with { type: 'text' };\nexport default () => <p>{N}</p>;\n",
  'ui/n.meta.json': '{}',
  'ui/notes.md': '# CANARY-NOTES',
  'ui/ok.tsx':
    "import '../system/x/preview/empty-state.css';\nimport H from './helper.ts';\nexport default () => <p />;\n",
  'ui/ok.meta.json': '{}',
};
const member = (c) => ({ v: 1, role: null, grants: [{ c, r: 'member' }] });

describe('the hub file plane: .html and non-module imports (gate-b-c4m)', () => {
  let designRoot;
  before(() => {
    designRoot = mkdtempSync(join(tmpdir(), 'c4m-hub-'));
    for (const [rel, text] of Object.entries(FILES)) {
      mkdirSync(join(designRoot, rel, '..'), { recursive: true });
      writeFileSync(join(designRoot, rel), text);
    }
    resetFileAccessCaches();
  });
  after(() => rmSync(designRoot, { recursive: true, force: true }));

  test('A imports ./b.html: B, its asset and A’s helper are refused', () => {
    const files = fileAccessForClaim(member('ui/a.tsx'), { designRoot });
    assert.equal(files.sees('ui/a.tsx'), true);
    for (const rel of ['ui/b.html', 'assets/b.png', 'ui/helper.ts'])
      assert.equal(files.sees(rel), false, rel);
  });

  test('a markdown import as text blocks the same way', () => {
    const files = fileAccessForClaim(member('ui/n.tsx'), { designRoot });
    assert.equal(files.sees('ui/notes.md'), false);
  });

  test('an .html DS specimen is not in a DS user’s read; a lifted specimen stylesheet is', () => {
    const files = fileAccessForClaim(member('ui/ok.tsx'), { designRoot });
    assert.equal(files.sees('system/x/tokens.css'), true);
    assert.equal(files.sees('ui/helper.ts'), true);
    assert.equal(files.sees('system/x/preview/empty-state.css'), true);
    assert.equal(files.sees('system/x/preview/empty-state.tsx'), false);
    assert.equal(files.sees('system/x/preview/colors.html'), false);
  });
});
