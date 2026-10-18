// V2-2.8 — ⇧⌘E means ONE thing (decision:maude/v2-2.8-shift-cmd-e-one-sheet, Gate 0 D3; V2-1.3
// contract §2 defect 2).
//
// v1 ran two handlers on one press: with canvas focus the canvas forwarded ⇧⌘E and the shell opened
// its Export sheet, AND the iframe's own export dialog ran `rerunLast()`, which silently re-submitted
// the last export. v2: ⇧⌘E opens the shell's Export sheet and nothing else; "Export again" moved
// onto the sheet's Recent rows (export-one-sheet-again.test.tsx covers the button).
//
// Two halves, both fail-first against v1:
//   · the registry: no canvas-exec action binds ⇧⌘E any more, `export.rerun-last` is a keyless
//     shell action, and the generated canvas keymap agrees;
//   · the iframe's real ExportDialogProvider (happy-dom + React): once it has loaded a history
//     entry, ⇧⌘E on the document submits no export job and opens nothing.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bindingInDocument } from '../actions/documents.ts';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import { CANVAS_KEYMAP } from '../actions/keymap.gen.ts';

const SHIFT_CMD_E = '⇧⌘E';

describe('registry: ⇧⌘E has one owner', () => {
  test('no action runs in the canvas document on ⇧⌘E — the shell sheet is the only owner', () => {
    const bound = ACTIONS.filter((a) => (a.keys ?? []).some((b) => b.chord === SHIFT_CMD_E));
    expect(bound.map((a) => `${a.id}:${a.exec}`)).toEqual(['export.open:shell']);
    // The canvas only FORWARDS the chord (fromCanvas): no canvas-exec action resolves it locally.
    const canvasLocal = ACTIONS.filter(
      (a) =>
        a.exec === 'canvas' &&
        (a.keys ?? []).some((b) => b.chord === SHIFT_CMD_E && bindingInDocument(b, 'canvas'))
    );
    expect(canvasLocal.map((a) => a.id)).toEqual([]);
  });

  test('the generated canvas keymap only FORWARDS ⇧⌘E (export.open), it runs nothing locally', () => {
    const rows = CANVAS_KEYMAP.filter((a) => a.keys.some((b) => b.chord === SHIFT_CMD_E));
    expect(rows.map((a) => `${a.id}:${a.exec}`)).toEqual(['export.open:shell']);
  });

  test('export.rerun-last is a keyless shell action (its home is the sheet’s Recent rows)', () => {
    const a = ACTIONS_BY_ID.get('export.rerun-last');
    expect(a?.label).toBe('Export again');
    expect(a?.exec).toBe('shell');
    expect(a?.keys ?? []).toEqual([]);
  });

  // V2-4.5b (D3, rule 13) unbound ⌘E; S8.2 retired the iframe dialog it opened, and its action with it.
  test('export.canvas-dialog is retired: no action, no ⌘E binding anywhere', () => {
    expect(ACTIONS_BY_ID.get('export.canvas-dialog')).toBeUndefined();
    expect(ACTIONS.filter((a) => (a.keys ?? []).some((b) => b.chord === '⌘E'))).toEqual([]);
  });
});

describe('the iframe has no export dialog of its own (S8.2)', () => {
  test('canvas-shell mounts no ExportDialogProvider and apps/studio/export-dialog.tsx is gone', () => {
    expect(existsSync(join(import.meta.dir, '..', 'export-dialog.tsx'))).toBe(false);
    const shell = readFileSync(join(import.meta.dir, '..', 'canvas-shell.tsx'), 'utf8');
    expect(shell).not.toContain('ExportDialogProvider');
    // its context-menu entries still reach the shell's one sheet, by posting `open-export` themselves
    expect(shell).toContain("dgn: 'open-export'");
  });
});
