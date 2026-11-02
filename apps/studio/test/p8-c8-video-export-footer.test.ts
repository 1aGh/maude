// P8 C8 (07 · ve-export, 09 · ex-video) — the footer names the lane the Render row PICKED.

import { describe, expect, test } from 'bun:test';
import { renderChoice } from '../client/export-lane.js';
import { estimateForLane, summaryWords } from '../client/v2/export/export-copy.js';

const est = { files: 1, bytes: 12_000_000, seconds: 45, lane: 'this-mac' };
const render = (picked: string | null) =>
  renderChoice({ pref: 'auto', render: { cloud: true, suggest: 'this-mac' }, picked, seconds: 45 });

describe('the footer follows the picked lane', () => {
  test('a ticked cloud card makes the footer say "in the cloud"', () => {
    expect(summaryWords(estimateForLane(est, render('cloud')))).toContain('in the cloud');
    expect(summaryWords(estimateForLane(est, render('cloud')))).not.toContain('on this Mac');
  });

  test('this Mac picked (or suggested) says "on this Mac"', () => {
    expect(summaryWords(estimateForLane(est, render('this-mac')))).toContain('on this Mac');
    expect(summaryWords(estimateForLane({ ...est, lane: 'cloud' }, render(null)))).toContain(
      'on this Mac'
    );
  });

  test('no Render row (no cloud) leaves the estimate as the server said it', () => {
    const none = renderChoice({ pref: 'auto', render: null });
    expect(estimateForLane(est, none)).toBe(est);
    expect(estimateForLane(null, render('cloud'))).toBeNull();
  });
});
