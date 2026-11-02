// S6.16b — 01/cf-select-tweak: "the inspector comes with the selection; the Canvases panel folds." Panel
// only — the camera never moves (I1, bridge/canvas-mode-store.ts: an inset change alone is not a pan).
// The panel comes back when the selection clears, unless the person opened it themselves or pinned panels.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANVASES_FOLD_BELOW,
  CANVASES_RESTORE_ABOVE,
  createCanvasesFold,
} from '../client/v2/shell/inspector-follow.js';

const STUDIO = join(import.meta.dir, '..');

describe('createCanvasesFold', () => {
  test('the Inspector arrives while Canvases is open: it folds, and comes back when the selection clears', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ canvasesOpen: true, pinned: false, width: 1100 })).toBe(true);
    expect(f.clear({ hasSelection: true, canvasesOpen: false, pinned: false })).toBe(false); // still selected
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: false })).toBe(true);
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: false })).toBe(false); // once
  });

  test('a panel that is already folded stays the person’s choice: nothing folds, nothing comes back', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ canvasesOpen: false, pinned: false, width: 1100 })).toBe(false);
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: false })).toBe(false);
  });

  test('pinned panels (docked columns) are never folded for the Inspector', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ canvasesOpen: true, pinned: true, width: 1100 })).toBe(false);
  });

  test('opening Canvases yourself while the Inspector is up ends the claim', () => {
    const f = createCanvasesFold();
    f.arrive({ canvasesOpen: true, pinned: false, width: 1100 });
    f.release(); // the person opened the panel
    expect(f.clear({ hasSelection: false, canvasesOpen: true, pinned: false })).toBe(false);
    expect(f.folded()).toBe(false);
  });

  test('pinning panels while folded: the person chose the docked layout, nothing is reopened under them', () => {
    const f = createCanvasesFold();
    f.arrive({ canvasesOpen: true, pinned: false, width: 1100 });
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: true })).toBe(false);
    expect(f.folded()).toBe(false);
  });

  test('one fold per arrival: a second arrival while folded does not fold twice', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ canvasesOpen: true, pinned: false, width: 1100 })).toBe(true);
    expect(f.arrive({ canvasesOpen: true, pinned: false, width: 1100 })).toBe(false);
  });
});

describe('TD4 — Canvases folds only in a narrow window (two widths, no timer)', () => {
  const open = { canvasesOpen: true, pinned: false };
  test('the two widths are 1240 and 1320', () => {
    expect(CANVASES_FOLD_BELOW).toBe(1240);
    expect(CANVASES_RESTORE_ABOVE).toBe(1320);
  });
  test('a wide window never folds the panel on a selection', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ ...open, width: 1600 })).toBe(false);
    expect(f.arrive({ ...open, width: 1240 })).toBe(false); // "below" is strict
    expect(f.folded()).toBe(false);
  });
  test('a narrow window folds it on arrival and a cleared selection brings it back', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ ...open, width: 1239 })).toBe(true);
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: false })).toBe(true);
  });
  const sel = { hasSelection: true, inspectorOpen: true };
  test('shrinking below 1240 with a selection folds; widening past 1320 restores; the band between does nothing', () => {
    const f = createCanvasesFold();
    expect(f.resize({ ...open, ...sel, width: 1400 })).toBe(null);
    expect(f.resize({ ...open, ...sel, width: 1200 })).toBe('fold');
    expect(f.resize({ canvasesOpen: false, pinned: false, ...sel, width: 1280 })).toBe(null); // hysteresis
    expect(f.resize({ canvasesOpen: false, pinned: false, ...sel, width: 1320 })).toBe(null); // "above" is strict
    expect(f.resize({ canvasesOpen: false, pinned: false, ...sel, width: 1321 })).toBe('restore');
    expect(f.folded()).toBe(false);
    expect(f.resize({ ...open, ...sel, width: 1280 })).toBe(null); // a window that never left the band stays
  });
  test('no selection or no Inspector: a narrowing window folds nothing', () => {
    const f = createCanvasesFold();
    expect(f.resize({ ...open, hasSelection: false, inspectorOpen: false, width: 900 })).toBe(null);
    expect(f.resize({ ...open, hasSelection: true, inspectorOpen: false, width: 900 })).toBe(null);
  });
  test('pinned panels never fold on a resize', () => {
    const f = createCanvasesFold();
    expect(f.resize({ canvasesOpen: true, pinned: true, ...sel, width: 900 })).toBe(null);
  });
  test('a manual unfold is remembered: the next arrival and the next narrowing leave the panel open', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ ...open, width: 1100 })).toBe(true);
    f.release(); // the person opened Canvases by hand while it was folded
    expect(f.arrive({ ...open, width: 1100 })).toBe(false);
    expect(f.resize({ ...open, ...sel, width: 1000 })).toBe(null);
    // the memory ends when the window is wide again
    expect(f.resize({ ...open, ...sel, width: 1400 })).toBe(null);
    expect(f.arrive({ ...open, width: 1100 })).toBe(true);
  });
  test('our own restore is not a manual unfold', () => {
    const f = createCanvasesFold();
    f.arrive({ ...open, width: 1100 });
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: false })).toBe(true);
    f.release(); // the shell's effect runs once the panel is open again
    expect(f.arrive({ ...open, width: 1100 })).toBe(true);
  });
  test('the shell feeds it the window width and listens to resize (no timer)', () => {
    const core = readFileSync(join(STUDIO, 'client/hooks/use-shell-core.jsx'), 'utf8');
    expect(core).toContain('width: window.innerWidth');
    expect(core).toContain("addEventListener('resize', onResize)");
    const rule = readFileSync(join(STUDIO, 'client/v2/shell/inspector-follow.js'), 'utf8');
    expect(rule).not.toMatch(/setTimeout|setInterval|debounce/);
  });
});

describe('the shell wires it to the selection (and only the panel moves)', () => {
  const core = readFileSync(join(STUDIO, 'client/hooks/use-shell-core.jsx'), 'utf8');
  test('the arrival folds Canvases (tree) after the Inspector opens', () => {
    const a = core.indexOf("openRightPanel('inspector');");
    expect(a).toBeGreaterThan(0);
    const body = core.slice(a, a + 900);
    expect(body).toContain('canvasesFold.current.arrive(');
    expect(body).toContain('setSidebarOpen(false)');
  });
  test('a cleared selection restores it; opening it by hand releases the claim', () => {
    expect(core).toContain('canvasesFold.current.clear(');
    expect(core).toContain('setSidebarOpen(true)');
    expect(core).toContain('canvasesFold.current.release()');
  });
  test('no camera call anywhere in the follow rule (I1)', () => {
    const rule = readFileSync(join(STUDIO, 'client/v2/shell/inspector-follow.js'), 'utf8');
    expect(rule).not.toMatch(/camera|zoom|postToCanvas/i);
  });
});
