// 2.1.1 T7 — found by the accounts desktop e2e (send-local-project.e2e.ts, step 2): Diagnostics › Sync on a local
// project offers "Create project on Maude Cloud" (share.move-to-cloud), which opens the Share sheet where Move to
// Maude Cloud lives. The Share sheet opened only for an open canvas (`showShare` needs a canvas path), so with no
// canvas open the button closed Diagnostics and did nothing at all. Moving and Connect are about the PROJECT: they
// open the project's sheet when no canvas is open; the Share button keeps its rule (no canvas, no sheet).
import { describe, expect, test } from 'bun:test';

import { shareTargetFor } from '../client/share-link.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';

describe('the Share sheet’s target', () => {
  test('an open canvas: that canvas', () => {
    expect(shareTargetFor('.design/ui/Smoke.tsx', '.design')).toEqual({
      path: '.design/ui/Smoke.tsx',
      rel: 'ui/Smoke.tsx',
      label: 'Smoke.tsx',
    });
  });
  test('no canvas: nothing — unless the ask is about the project', () => {
    expect(shareTargetFor('', '.design')).toBeNull();
    expect(shareTargetFor(undefined, '.design')).toBeNull();
    expect(shareTargetFor('', '.design', { project: true })).toEqual({
      path: '',
      rel: null,
      label: '',
    });
  });
});

describe('Move to Maude Cloud and Connect ask for the project’s sheet', () => {
  const calls: unknown[][] = [];
  const h = createMenuHandlers({ onShare: (...a: unknown[]) => calls.push(a) } as never) as Record<
    string,
    () => void
  >;
  test('share.move-to-cloud', () => {
    calls.length = 0;
    h['share.move-to-cloud']();
    expect(calls).toEqual([[{ project: true }]]);
  });
  test('sync.connect-link', () => {
    calls.length = 0;
    h['sync.connect-link']();
    expect(calls).toEqual([[{ project: true }]]);
  });
  test('share.open keeps the canvas rule', () => {
    calls.length = 0;
    h['share.open']();
    expect(calls).toEqual([[]]);
  });
});
