// T2.5 (#163) — switching to Preview changes only the toolbar: the Canvases and AI chat panels stay where the
// person left them. Preview never folds them to their corner icons (⌘\ is still the person's own hide).
import { describe, expect, test } from 'bun:test';

import { foldsPanels, modeCell } from '../bridge/mode-shows.ts';
import { createShellMode } from '../client/v2/shell/canvas-mode.js';
import { wantsFold } from '../client/v2/shell/use-canvas-mode-lane.js';

describe('Preview keeps the panels', () => {
  test('the what-shows table: Canvases and AI chat show in Preview as in Edit', () => {
    expect(modeCell('left-panels', 'preview')).toBe('shown');
    expect(modeCell('ai-panel', 'preview')).toBe('shown');
    expect(foldsPanels('preview')).toBe(false);
  });
  test('a Preview someone CHOSE does not fold them either', () => {
    const mode = createShellMode();
    mode.select('preview');
    expect(mode.get().nonce).toBeGreaterThan(0);
    expect(wantsFold('preview', mode.get())).toBe(false);
  });
});
