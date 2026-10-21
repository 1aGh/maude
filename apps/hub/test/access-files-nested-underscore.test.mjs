// gate-b-c4b — the hub's project listing (access-files `projectReader`) treats runtime state as
// FIRST-segment `_*` only, like the studio's: a design system's nested `_` folder is versioned
// content a canvas-only member's closure reads; a top-level `_` folder stays out.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { projectReader } from '../src/access-files.mjs';

const root = mkdtempSync(join(tmpdir(), 'hub-nested-underscore-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('nested `_` dirs are listed; first-segment `_` dirs are not', () => {
  mkdirSync(join(root, 'system', 'ds', 'preview', '_parts'), { recursive: true });
  writeFileSync(join(root, 'system', 'ds', 'preview', '_parts', 'card.css'), '.c{}\n');
  writeFileSync(join(root, 'system', 'ds', 'preview', '_components.css'), '.a{}\n');
  mkdirSync(join(root, '_history', 'x'), { recursive: true });
  writeFileSync(join(root, '_history', 'x', 'snap.tsx'), 'export default 1\n');
  const files = projectReader({ designRoot: root, journal: null }).list();
  assert.equal(files.has('system/ds/preview/_parts/card.css'), true);
  assert.equal(files.has('system/ds/preview/_components.css'), true);
  assert.equal(files.has('_history/x/snap.tsx'), false);
});
