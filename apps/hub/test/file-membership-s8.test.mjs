// S8 asset sidecars — the hub mirror of the file-plane classifier (contract
// S8-asset-sidecars §5.5, §8). The studio's bun test pins this file to
// `apps/studio/sync/file-membership.ts`; this one holds the hub's own answers
// under node, the runtime the hub image actually ships.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyProjectFile, isRuntimeStateRel } from '../src/file-membership.mjs';

test('the per-use photo edit and the generation sidecar sync (companion-text)', () => {
  for (const rel of [
    'assets/0a1b2c3d.9f8e7d6c.photo.json',
    'assets/0a1b2c3d.9f8e7d6c0b1a.photo.json',
    'assets/0a1b2c3d.gen.json',
    'assets/0a1b2c3d.photo.json', // the every-use file, unchanged
  ]) {
    assert.equal(classifyProjectFile(rel), 'companion-text', rel);
  }
});

test('the rejected `~` spelling, a bare suffix and a trailing extension stay never', () => {
  for (const rel of ['assets/0a1b2c3d~9f8e7d6c.photo.json', 'gen.json', 'evil.gen.json.txt']) {
    assert.equal(classifyProjectFile(rel), 'never', rel);
  }
});

test('the per-Mac original path is runtime state, never on the plane', () => {
  assert.equal(isRuntimeStateRel('_canvas-state/asset-origins.json'), true);
  assert.equal(classifyProjectFile('_canvas-state/asset-origins.json'), 'never');
});
