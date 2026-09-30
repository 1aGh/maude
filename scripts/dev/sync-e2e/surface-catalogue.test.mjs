import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ANNOTATIONS_V2_NOT_DRIVEN,
  ANNOTATIONS_V2_ROWS,
  buildSurfaceCatalogue,
  cataloguePath,
} from './surface-catalogue.mjs';

test('committed coverage inventory cannot silently omit changed toolbar/photo registries', () => {
  const actual = buildSurfaceCatalogue();
  const committed = JSON.parse(readFileSync(cataloguePath, 'utf8'));
  assert.deepEqual(
    actual,
    committed,
    'Review new controls and their required cases, then regenerate with node scripts/dev/sync-e2e/surface-catalogue.mjs --write'
  );
  // Every declared action points at a row (surface-requirements.mjs): derived,
  // so this flips back the moment one is left unasserted.
  assert.equal(actual.catalogueComplete, true);
  assert.equal(actual.surfaces.length, 24);
  assert.ok(actual.cases.some((c) => c.id === 'L09.shape-triangle-down.delete'));
  assert.ok(actual.cases.some((c) => c.id === 'L13.photo.invert'));
  assert.ok(actual.cases.some((c) => c.id.startsWith('L24.requirement.')));
});

test('every annotations-v2 catalogue row is a row the rig actually emits', () => {
  const rig = readFileSync(
    new URL('../../../apps/desktop/e2e/multiplayer/surface.e2e.ts', import.meta.url),
    'utf8'
  );
  const emitted = new Set([...rig.matchAll(/check\(\s*'(L09\.v2\.[a-z0-9-]+)'/g)].map((m) => m[1]));
  const catalogued = ANNOTATIONS_V2_ROWS.map(([id]) => id);
  assert.deepEqual([...emitted].sort(), [...catalogued].sort());
  // The plan rows with no rig row each say why.
  for (const [row, reason] of Object.entries(ANNOTATIONS_V2_NOT_DRIVEN))
    assert.ok(reason.length > 40, `${row}: "${reason}" does not say enough to act on`);
});
