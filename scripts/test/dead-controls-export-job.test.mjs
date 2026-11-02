// An export job's row ids carry the job's per-run id: a fresh project has no such job, so the walk cannot re-reach
// the row. It is accepted with its reason, and only for that id shape.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explain } from '../v2-verify/dead-controls/explained.mjs';

const row = (control) => ({
  mode: 'tauri',
  surface: `canvas Smoke › share-cluster-exports › ${control}`,
  control,
  effect: 'unreachable',
});

test('an export-job row named by its per-run id is explained', () => {
  const r = row('export-job-more-4961bb3c-d614-4e92-ae42-760b66364400');
  assert.match(explain(r, [r])?.why ?? '', /per-run id/);
  const a = row('export-job-again-4961bb3c-d614-4e92-ae42-760b66364400');
  assert.ok(explain(a, [a]));
});

test('a control that merely starts like one is not', () => {
  const r = row('export-job-more-menu');
  assert.equal(explain(r, [r]), null);
});
