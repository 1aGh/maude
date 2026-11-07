// fix/207 — the design export to a repository (design-sync.mjs) copies the
// design root through a `cp` filter. It dropped every path with ANY `_`
// segment, matched on the ABSOLUTE source path: a design system's own modules
// (`preview/_ui-feedback.tsx`, `_layout.css`) never reached the repository, and
// a `_` folder ABOVE the design root would have dropped everything. Runtime
// state is a `_` folder, or a `_` name at the design root — matched relative
// to the design root (workspace-files.mjs `inRuntimeDir`).

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { designSyncKeeps } from '../src/design-sync.mjs';

describe('design export — which paths reach the repository', () => {
  const root = join('/tmp', '_cells', 'tenant', '.design');
  const keeps = (rel) => designSyncKeeps(root, rel ? join(root, ...rel.split('/')) : root);

  it('keeps a design system’s `_` modules and everything versioned', () => {
    for (const rel of [
      '',
      'system',
      'system/studyfi-v3/preview/_ui-feedback.tsx',
      'system/studyfi-v3/preview/_ui-feedback.css',
      'system/studyfi-v3/preview/_layout.css',
      'ui/home.tsx',
      'config.json',
    ])
      assert.equal(keeps(rel), true, rel);
  });

  it('drops runtime state: `_` names at the design root and `_` folders', () => {
    for (const rel of [
      '_history',
      '_history/ui-home/1.tsx',
      '_state/outbox/x.json',
      '_server.json',
      '_active.json',
      'system/ds/_cache/y.tsx',
    ])
      assert.equal(keeps(rel), false, rel);
  });

  it('never matches the part of the path above the design root', () => {
    assert.equal(keeps('ui/home.tsx'), true);
  });
});
