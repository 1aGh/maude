import assert from 'node:assert/strict';
import { test } from 'node:test';
import { surfaceStatistics } from './surface-statistics.mjs';

const rows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: 'L06.ui-text-edit',
    direction: 'native-to-peers',
    sample: i + 1,
    status: 'pass',
    observations: [{ receiver: 'hub', status: 'pass', observedMs: i + 1, persistedMs: i + 11 }],
  }));
test('requires sufficient homogeneous samples for percentile claims', () => {
  assert.equal(surfaceStatistics(rows(99)).groups[0].rendered.p95Ms, null);
  const group = surfaceStatistics(rows(100)).groups[0];
  assert.equal(group.rendered.p95Ms, 95);
  assert.equal(group.persisted.p95Ms, 105);
  assert.equal(group.rendered.p99Ms, null);
  assert.equal(surfaceStatistics(rows(1000)).groups[0].rendered.p99Ms, 990);
});
test('does not discard timeout, missing timing, or duplicate-sample evidence', () => {
  for (const damage of [
    (sample) => {
      sample.observations[0].status = 'fail';
    },
    (sample) => {
      sample.observations[0].observedMs = undefined;
    },
    (sample) => {
      sample.sample = 1;
    },
  ]) {
    const input = rows(100);
    damage(input[99]);
    assert.equal(surfaceStatistics(input).groups[0].rendered.p95Ms, null);
  }
});
test('a driver failure without receiver observations blocks every receiver group', () => {
  const input = [
    { id: 'bootstrap.participants', roots: { hub: '/fixture' } },
    ...rows(100),
    { id: 'L06.ui-text-edit', direction: 'native-to-peers', sample: 101, status: 'fail' },
  ];
  const group = surfaceStatistics(input).groups[0];
  assert.equal(group.failures, 1);
  assert.equal(group.rendered.p95Ms, null);
});
test('aborted or incomplete sampling cannot certify even an otherwise passing group', () => {
  assert.equal(surfaceStatistics(rows(100), { driverFailed: true }).groups[0].rendered.p95Ms, null);
  const interrupted = surfaceStatistics(rows(100), { expectedSamples: 101 }).groups[0];
  assert.deepEqual(interrupted.missingSamples, [101]);
  assert.equal(interrupted.rendered.p95Ms, null);
  const gap = rows(100);
  gap[99].sample = 101;
  assert.equal(surfaceStatistics(gap, { expectedSamples: 100 }).groups[0].rendered.p95Ms, null);
});
test('a final source reversion invalidates a successful first-effect timing sample', () => {
  const input = rows(100);
  const group = surfaceStatistics(input, {
    invalidatedSamples: [
      {
        id: 'L06.ui-text-edit',
        direction: 'native-to-peers',
        receiver: 'hub',
        sample: 50,
      },
    ],
  }).groups[0];
  assert.equal(group.failures, 1);
  assert.equal(group.finalSourceMismatches, 1);
  assert.equal(group.rendered.p95Ms, null);
  assert.equal(input[49].status, 'pass');
});
