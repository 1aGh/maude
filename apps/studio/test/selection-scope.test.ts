// V2-2.8 P2 — after a canvas switch, Export must not target the previous canvas's artboard.
import { describe, expect, test } from 'bun:test';

import {
  clearSelectionIntent,
  exportSelectionFor,
  exportSelectionV2,
  intendSelection,
  isOwnSelectEcho,
  localSelectRecord,
  restorePostOf,
  stampSelectionFile,
} from '../client/selection-scope.js';

const A = { file: '.design/ui/a.tsx', artboardId: 'a-hero', selector: '[data-x]' };
const B = { file: '.design/ui/b.tsx', artboardId: 'b-card', selector: '[data-y]' };

describe('select echo', () => {
  const localA = localSelectRecord(A, '.design/ui/a.tsx', 1000);
  test('our own select echoed back for the same canvas is dropped', () => {
    expect(isOwnSelectEcho(A, localA, 1500)).toBe(true);
  });
  test('anything about the same canvas inside the window is dropped, as in v1', () => {
    // an older select's echo (or a parked restore) must not overwrite a newer drill
    expect(isOwnSelectEcho({ ...A, selector: '[data-older]' }, localA, 1500)).toBe(true);
    // after our clear on canvas a, a selection for canvas a is still ours to ignore
    expect(isOwnSelectEcho(A, localSelectRecord(null, '.design/ui/a.tsx', 1000), 1500)).toBe(true);
    // the echo of our own clear
    expect(isOwnSelectEcho(null, localSelectRecord(null, '.design/ui/a.tsx', 1000), 1500)).toBe(
      true
    );
  });
  test('the restore for the canvas we switched to applies, and so does its "none"', () => {
    expect(isOwnSelectEcho(B, localA, 1500)).toBe(false);
    expect(isOwnSelectEcho(null, localA, 1500)).toBe(false);
  });
  test('past the window, or before any local select, nothing is an echo', () => {
    expect(isOwnSelectEcho(A, localA, 3500)).toBe(false);
    expect(isOwnSelectEcho(A, { at: 0, sel: null, file: null }, 1500)).toBe(false);
  });
});

describe('export scope', () => {
  test('a selection on the active canvas scopes the dialog', () => {
    expect(exportSelectionFor(A, A.file, null)).toEqual({
      activeArtboardId: 'a-hero',
      selection: { selector: '[data-x]', file: A.file },
    });
  });
  test('a selection left over from the previous canvas does not', () => {
    expect(exportSelectionFor(A, B.file, 'b-viewport')).toEqual({
      activeArtboardId: 'b-viewport',
      selection: null,
    });
  });
});

// P8-C4 (09 · ex-social, ex-batch-pick) — the sheet names the one artboard it exports, and a multi-selection
// (⌘A, ⇧-click) reaches it: the canvas's list entries carry no `file`, so the shell stamps the open canvas on them.
describe('export sheet selection (09 Export)', () => {
  const board = (id: string, label: string) => ({
    file: A.file,
    artboardId: id,
    selector: `[data-dc-screen="${id}"]`,
    attrs: { 'data-dc-screen': id, 'data-dc-label': label },
  });
  test('one selected artboard: its label names the sheet', () => {
    const r = exportSelectionV2(board('post', 'DOMA · Post 4:5 — feed matchday'), A.file);
    expect(r.selectionLabel).toBe('DOMA · Post 4:5 — feed matchday');
    expect(r.selectedArtboards).toEqual(['post']);
  });
  test('the label falls back to the artboard id; several artboards have no single label', () => {
    expect(
      exportSelectionV2({ file: A.file, artboardId: 'story', selector: 's' }, A.file).selectionLabel
    ).toBe('story');
    const two = exportSelectionV2([board('a', 'A'), board('b', 'B')], A.file);
    expect(two.selectionLabel).toBeNull();
    expect(two.selectedArtboards).toEqual(['a', 'b']);
  });
  test('list entries without a file are stamped with the open canvas, and then count', () => {
    const entries = [
      { id: 'fd13fd41', artboardId: 'hype', selector: 'x' },
      { id: '9ebcb9ab', artboardId: 'hype', selector: 'y' },
    ];
    expect(exportSelectionV2(entries, A.file).hasSelection).toBe(false);
    const stamped = stampSelectionFile(entries, A.file) as { file: string }[];
    expect(stamped.map((s) => s.file)).toEqual([A.file, A.file]);
    const r = exportSelectionV2(stamped, A.file);
    expect(r.hasSelection).toBe(true);
    expect(r.selectedElements).toEqual(['fd13fd41', '9ebcb9ab']);
    // an entry that names another canvas is left alone
    expect((stampSelectionFile([B], A.file) as { file: string }[])[0].file).toBe(B.file);
    expect(stampSelectionFile(null, A.file)).toBeNull();
  });
});

describe('p8-bugs3 #6 — the selection Change kind asked for outlives the reload (decision v2-p8-c4-convert-selects-the-copy)', () => {
  // The shell puts the selection back on a canvas that just reloaded, from what IT holds — the post, until the
  // canvas echoes the copy. A reload that finished after the 0 / 450 / 1200 ms asks for the copy put the post back
  // over it ("dark: the selection stays on the post"). The ask is now remembered: while it is fresh, a restore
  // of the post's whole-artboard selection goes to the copy instead.
  const post = { file: A.file, artboardId: 'post', selector: '[data-dc-screen="post"]' };
  const other = { file: A.file, artboardId: 'story', selector: '[data-dc-screen="story"]' };
  test('a restore of the post goes to the copy while the ask is fresh, and only then', () => {
    clearSelectionIntent();
    expect(restorePostOf(post, A.file)).toEqual({ dgn: 'select-by-id', artboardId: 'post' });
    intendSelection(A.file, { from: 'post', to: 'post-a6' }, { now: 1000, ttl: 5000 });
    expect(restorePostOf(post, A.file, undefined, 2000)).toEqual({
      dgn: 'select-by-id',
      artboardId: 'post-a6',
    });
    // past its time the post is the post again
    expect(restorePostOf(post, A.file, undefined, 7000)).toEqual({
      dgn: 'select-by-id',
      artboardId: 'post',
    });
    clearSelectionIntent();
  });
  test('anything else the person selected meanwhile, or another canvas, is restored as it was', () => {
    intendSelection(A.file, { from: 'post', to: 'post-a6' }, { now: 1000, ttl: 5000 });
    expect(restorePostOf(other, A.file, undefined, 2000)).toEqual({
      dgn: 'select-by-id',
      artboardId: 'story',
    });
    expect(restorePostOf({ ...post, file: B.file }, B.file, undefined, 2000)).toEqual({
      dgn: 'select-by-id',
      artboardId: 'post',
    });
    clearSelectionIntent();
  });
  test('once the copy is what the shell holds, the ask is spent', () => {
    intendSelection(A.file, { from: 'post', to: 'post-a6' }, { now: 1000, ttl: 5000 });
    const copy = { file: A.file, artboardId: 'post-a6', selector: '[data-dc-screen="post-a6"]' };
    expect(restorePostOf(copy, A.file, undefined, 1500)).toEqual({
      dgn: 'select-by-id',
      artboardId: 'post-a6',
    });
    expect(restorePostOf(post, A.file, undefined, 1600)).toEqual({
      dgn: 'select-by-id',
      artboardId: 'post',
    });
  });
});
