import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellKey, compareToBaseline } from './surface-baseline.mjs';

const row = (id, direction, status, extra = {}) => ({ id, direction, status, ...extra });

test('a cell that passed and no longer passes is a regression', () => {
  const before = [row('L06.ui-text-edit', 'native-to-peers', 'pass')];
  const after = [row('L06.ui-text-edit', 'native-to-peers', 'fail')];
  const { regressions, held } = compareToBaseline(before, after);
  assert.equal(held, 0);
  assert.deepEqual(regressions, [
    {
      id: 'L06.ui-text-edit',
      direction: 'native-to-peers',
      sample: null,
      now: 'fail',
      why: null,
    },
  ]);
});

test('a cell that stopped being run is a regression, not an absence', () => {
  // The failure mode this whole comparison exists for: a candidate that drops
  // an assertion looks green on its own numbers.
  const before = [row('L08.artboard.resize', 'hub-to-peers', 'pass')];
  assert.equal(compareToBaseline(before, []).regressions[0].now, 'absent');
  assert.equal(
    compareToBaseline(before, [row('L08.artboard.resize', 'hub-to-peers', 'not-run')])
      .regressions[0].now,
    'not-run'
  );
});

test('a repair is reported and never required', () => {
  const before = [row('L21.conflict', 'peer-to-peers', 'fail')];
  const after = [row('L21.conflict', 'peer-to-peers', 'pass')];
  const { regressions, repairs } = compareToBaseline(before, after);
  assert.equal(regressions.length, 0);
  assert.deepEqual(repairs, [
    { id: 'L21.conflict', direction: 'peer-to-peers', sample: null, was: 'fail' },
  ]);
});

test('a candidate may assert more than the baseline did', () => {
  const { regressions, added } = compareToBaseline(
    [row('L01.create', 'hub-to-peers', 'pass')],
    [row('L01.create', 'hub-to-peers', 'pass'), row('L25.brand-new', 'native-to-peers', 'pass')]
  );
  assert.equal(regressions.length, 0);
  assert.deepEqual(added, [
    { id: 'L25.brand-new', direction: 'native-to-peers', sample: null, status: 'pass' },
  ]);
});

test('the same id in three directions and many samples stays three cells and many samples', () => {
  const keys = new Set(
    [
      row('L06.ui-text-edit', 'hub-to-peers', 'pass'),
      row('L06.ui-text-edit', 'native-to-peers', 'pass'),
      row('L06.ui-text-edit', 'peer-to-peers', 'pass'),
      row('L06.ui-text-edit', 'native-to-peers', 'pass', { sample: 2 }),
    ].map(cellKey)
  );
  assert.equal(keys.size, 4);
});

test('an unsupported cell that stays unsupported is neither a regression nor a repair', () => {
  const both = [row('L16.specimen.delete', 'hub-to-peers', 'unsupported')];
  const { regressions, repairs, held } = compareToBaseline(both, both);
  assert.deepEqual([regressions.length, repairs.length, held], [0, 0, 0]);
});
