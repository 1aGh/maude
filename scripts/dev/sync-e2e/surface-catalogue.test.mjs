import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildSurfaceCatalogue, cataloguePath } from './surface-catalogue.mjs';

test('committed coverage inventory cannot silently omit changed toolbar/photo registries', () => {
  const actual = buildSurfaceCatalogue();
  const committed = JSON.parse(readFileSync(cataloguePath, 'utf8'));
  assert.deepEqual(
    actual,
    committed,
    'Review new controls and their required cases, then regenerate with node scripts/dev/sync-e2e/surface-catalogue.mjs --write'
  );
  assert.equal(actual.catalogueComplete, false);
  assert.equal(actual.surfaces.length, 24);
  assert.ok(actual.cases.some((c) => c.id === 'L09.shape-triangle-down.delete'));
  assert.ok(actual.cases.some((c) => c.id === 'L13.photo.invert'));
  assert.ok(actual.cases.some((c) => c.id.startsWith('L24.requirement.')));
});
