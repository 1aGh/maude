// gate-b-c4k — the hub file plane judges "is this .tsx a canvas?" by the FILE (it renders
// DesignCanvas, or has a meta / board), the same as the studio — not by a canvas group the hub's
// config may not know (M1) or a `components/` path (M2). A canvas-only member of A never sees a
// meta-less DesignCanvas file A imports; a real component A imports stays visible.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { fileAccessForClaim, resetFileAccessCaches } from '../src/access-files.mjs';

const CANVAS = (mark) =>
  `import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas><p>${mark}</p></DesignCanvas>;\n`;

const A = 'ui/a.tsx';
const FILES = {
  // the hub fills canvasGroups once and has no newComponentDir — neither may matter
  'config.json': JSON.stringify({ canvasGroups: [{ path: 'ui', label: 'UI' }] }),
  [A]: "import C1 from './components/Secret.tsx';\nimport C2 from '../system/x/Board.tsx';\nimport C3 from '../elsewhere/Plan.tsx';\nimport Button from './components/Button.tsx';\nexport default () => <Button />;\n",
  'ui/a.meta.json': '{}',
  'ui/components/Secret.tsx': CANVAS('CANARY-1'),
  'system/x/Board.tsx': CANVAS('CANARY-2'),
  'elsewhere/Plan.tsx': CANVAS('CANARY-3'),
  'ui/components/Button.tsx': 'export default () => <button>OK</button>;\n',
};

describe('the hub file plane: a canvas by content is never in an importer’s closure', () => {
  let designRoot;
  before(() => {
    designRoot = mkdtempSync(join(tmpdir(), 'c4k-hub-'));
    for (const [rel, text] of Object.entries(FILES)) {
      mkdirSync(join(designRoot, rel, '..'), { recursive: true });
      writeFileSync(join(designRoot, rel), text);
    }
    resetFileAccessCaches();
  });
  after(() => rmSync(designRoot, { recursive: true, force: true }));

  test('a member of A sees A and Button, none of the meta-less DesignCanvas files', () => {
    const files = fileAccessForClaim(
      { v: 1, role: null, grants: [{ c: A, r: 'member' }] },
      { designRoot }
    );
    assert.equal(files.sees(A), true);
    assert.equal(files.sees('ui/components/Button.tsx'), true);
    for (const rel of ['ui/components/Secret.tsx', 'system/x/Board.tsx', 'elsewhere/Plan.tsx'])
      assert.equal(files.sees(rel), false, rel);
  });
});
