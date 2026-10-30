// S6.16b — 01/cf-select-tweak: "the inspector comes with the selection; the Canvases panel folds." Panel
// only — the camera never moves (I1, bridge/canvas-mode-store.ts: an inset change alone is not a pan).
// The panel comes back when the selection clears, unless the person opened it themselves or pinned panels.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvasesFold } from '../client/v2/shell/inspector-follow.js';

const STUDIO = join(import.meta.dir, '..');

describe('createCanvasesFold', () => {
  test('the Inspector arrives while Canvases is open: it folds, and comes back when the selection clears', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ canvasesOpen: true, pinned: false })).toBe(true);
    expect(f.clear({ hasSelection: true, canvasesOpen: false, pinned: false })).toBe(false); // still selected
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: false })).toBe(true);
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: false })).toBe(false); // once
  });

  test('a panel that is already folded stays the person’s choice: nothing folds, nothing comes back', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ canvasesOpen: false, pinned: false })).toBe(false);
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: false })).toBe(false);
  });

  test('pinned panels (docked columns) are never folded for the Inspector', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ canvasesOpen: true, pinned: true })).toBe(false);
  });

  test('opening Canvases yourself while the Inspector is up ends the claim', () => {
    const f = createCanvasesFold();
    f.arrive({ canvasesOpen: true, pinned: false });
    f.release(); // the person opened the panel
    expect(f.clear({ hasSelection: false, canvasesOpen: true, pinned: false })).toBe(false);
    expect(f.folded()).toBe(false);
  });

  test('pinning panels while folded: the person chose the docked layout, nothing is reopened under them', () => {
    const f = createCanvasesFold();
    f.arrive({ canvasesOpen: true, pinned: false });
    expect(f.clear({ hasSelection: false, canvasesOpen: false, pinned: true })).toBe(false);
    expect(f.folded()).toBe(false);
  });

  test('one fold per arrival: a second arrival while folded does not fold twice', () => {
    const f = createCanvasesFold();
    expect(f.arrive({ canvasesOpen: true, pinned: false })).toBe(true);
    expect(f.arrive({ canvasesOpen: true, pinned: false })).toBe(false);
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
