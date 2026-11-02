// gate-b-c4l (round 6, ethical hacker M) — the hub file plane serves a canvas-only member only what
// the closure reads, and a grant whose import walk refuses anything reads ONLY its owned files. The
// wrapper variant: B has no DesignCanvas, no meta, no board — it renders `<BoardShell>`, and
// BoardShell.tsx is the canvas. A canvas-only member edits A to import B: A's frame is refused, and
// B's source must not come back from the file plane either (nor an existence oracle by path).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { fileAccessForClaim, resetFileAccessCaches } from '../src/access-files.mjs';

const A = 'ui/a.tsx';
const B = 'ui/b.tsx';
const FILES = {
  [A]: "import B from './b.tsx';\nimport H from './helper.ts';\nexport default () => <B />;\n",
  'ui/a.meta.json': '{}',
  'ui/helper.ts': 'export const H = 1;\n',
  [B]: "import BoardShell from './BoardShell.tsx';\nexport default () => <BoardShell><p>B-SECRET</p></BoardShell>;\n",
  'ui/BoardShell.tsx':
    "import { DesignCanvas } from '@maude/canvas-lib';\nexport default (p) => <DesignCanvas>{p.children}</DesignCanvas>;\n",
  // the barrel variant: a .ts proxy re-exports DesignCanvas under another name
  'ui/c.tsx': "import D from './d.tsx';\nexport default () => <D />;\n",
  'ui/c.meta.json': '{}',
  'ui/kit.ts': "export { DesignCanvas as Shell } from '@maude/canvas-lib';\n",
  'ui/d.tsx':
    "import { Shell } from './kit.ts';\nexport default () => <Shell><p>D-SECRET</p></Shell>;\n",
  // a missing import blocks the same way
  'ui/m.tsx':
    "import X from './missing.tsx';\nimport H from './helper.ts';\nexport default () => <X />;\n",
  'ui/m.meta.json': '{}',
};
const member = (c) => ({ v: 1, role: null, grants: [{ c, r: 'member' }] });

describe('the hub file plane: a blocked walk serves only the grant’s own files', () => {
  let designRoot;
  before(() => {
    designRoot = mkdtempSync(join(tmpdir(), 'c4l-hub-'));
    for (const [rel, text] of Object.entries(FILES)) {
      mkdirSync(join(designRoot, rel, '..'), { recursive: true });
      writeFileSync(join(designRoot, rel), text);
    }
    resetFileAccessCaches();
  });
  after(() => rmSync(designRoot, { recursive: true, force: true }));

  test('the wrapper variant: a member of A never sees B, BoardShell or the helper', () => {
    const files = fileAccessForClaim(member(A), { designRoot });
    assert.equal(files.sees(A), true);
    assert.equal(files.sees('ui/a.meta.json'), true);
    for (const rel of [B, 'ui/BoardShell.tsx', 'ui/helper.ts'])
      assert.equal(files.sees(rel), false, rel);
  });

  test('the barrel variant: a member of C never sees D (a canvas through the proxy)', () => {
    const files = fileAccessForClaim(member('ui/c.tsx'), { designRoot });
    assert.equal(files.sees('ui/d.tsx'), false);
  });

  test('a missing import: the same answer — owned files only', () => {
    const files = fileAccessForClaim(member('ui/m.tsx'), { designRoot });
    assert.equal(files.sees('ui/m.tsx'), true);
    assert.equal(files.sees('ui/helper.ts'), false);
  });
});
