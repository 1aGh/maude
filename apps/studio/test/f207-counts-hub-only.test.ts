// 2.0.7 packaged-app check — after "Keep on the hub", Counts read "19 · all here" although 14 of the
// 19 files are on the hub only now: the count says how many are here, and how many the hub keeps.
import { expect, test } from 'bun:test';
import { syncDetailsModel } from '../client/v2/diagnostics/sync-details/sync-details-model.js';

const status = (hubOnly: number, tracked = 19) => {
  const delivery: Record<string, string> = {};
  for (let i = 0; i < hubOnly; i++) delivery[`ui/r/${i}.png`] = 'hub-only';
  return {
    files: {
      synced: tracked,
      progress: { tracked, delivered: tracked, remaining: 0, phase: 'converged' },
      delivery,
    },
  };
};
const filesCount = (m: { counts: Array<[string, string, string]> }) =>
  m.counts.find((c) => c[0] === 'files')?.[2];

test('files kept on the hub are not counted as here', () => {
  expect(filesCount(syncDetailsModel(status(14)) as never)).toBe('5 here · 14 on the hub only');
});

test('with nothing kept on the hub, it still reads all here', () => {
  expect(filesCount(syncDetailsModel(status(0)) as never)).toBe('19 · all here');
});
