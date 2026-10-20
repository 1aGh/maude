// S6.16b — 01/cf-duplicate-done: after "Duplicate at another width" the shell says
// "Duplicated at Laptop — 1280 wide." with an Undo. The words and the action come from the SHELL, off the
// edit-op request it forwarded and the answer it got (decision maude/v2-sec-a-canvas-toast-no-undo: a canvas
// notice can never carry an Undo button — the canvas could not prove the button is the person's own step).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { duplicatedAtWords, settleDuplicateAtWidth } from '../client/v2/create/duplicate-done.js';

const STUDIO = join(import.meta.dir, '..');
const dup = (
  items: Array<{ artboard: string; width?: number }>,
  op = 'artboard.duplicate-at-width'
) => ({
  op,
  params: { items },
});

describe('the words (01 cf-duplicate-done, exact)', () => {
  test('a preset names itself and its width', () => {
    expect(duplicatedAtWords(1280)).toBe('Duplicated at Laptop — 1280 wide.');
    expect(duplicatedAtWords(834)).toBe('Duplicated at Tablet — 834 wide.');
    expect(duplicatedAtWords(390)).toBe('Duplicated at Mobile — 390 wide.');
  });
  test('a custom width has no preset to name', () => {
    expect(duplicatedAtWords(1000)).toBe('Duplicated at 1000 wide.');
  });
});

describe('settleDuplicateAtWidth', () => {
  test('one copy at Laptop: the words and an Undo that runs the shell undo', () => {
    let undone = 0;
    const toast = settleDuplicateAtWidth(
      dup([{ artboard: 'desktop', width: 1280 }]),
      { ok: true },
      () => {
        undone++;
      }
    );
    expect(toast?.message).toBe('Duplicated at Laptop — 1280 wide.');
    expect(toast?.action?.label).toBe('Undo');
    toast?.action?.onClick();
    expect(undone).toBe(1);
  });

  test('several boards copied to the same width read as one sentence', () => {
    const toast = settleDuplicateAtWidth(
      dup([
        { artboard: 'a', width: 834 },
        { artboard: 'b', width: 834 },
      ]),
      { ok: true },
      () => {}
    );
    expect(toast?.message).toBe('Duplicated at Tablet — 834 wide.');
  });

  test('says nothing for a refusal, another op, a plain ⌘D, or mixed widths', () => {
    const undo = () => {};
    const one = dup([{ artboard: 'a', width: 1280 }]);
    expect(settleDuplicateAtWidth(one, { ok: false }, undo)).toBeNull();
    expect(
      settleDuplicateAtWidth(
        dup([{ artboard: 'a', width: 1280 }], 'artboard.duplicate'),
        { ok: true },
        undo
      )
    ).toBeNull();
    expect(settleDuplicateAtWidth(dup([{ artboard: 'a' }]), { ok: true }, undo)).toBeNull();
    expect(
      settleDuplicateAtWidth(
        dup([
          { artboard: 'a', width: 834 },
          { artboard: 'a', width: 390 },
        ]),
        { ok: true },
        undo
      )
    ).toBeNull();
    expect(settleDuplicateAtWidth(dup([]), { ok: true }, undo)).toBeNull();
    expect(settleDuplicateAtWidth(undefined, { ok: true }, undo)).toBeNull();
  });

  test('a width that is no honest number says nothing (the canvas is untrusted)', () => {
    const undo = () => {};
    for (const width of [Number.NaN, -5, 0, 1e9, '1280' as unknown as number]) {
      expect(
        settleDuplicateAtWidth(dup([{ artboard: 'a', width }]), { ok: true }, undo)
      ).toBeNull();
    }
  });

  test('without an undo runner there is words only, no button', () => {
    const toast = settleDuplicateAtWidth(dup([{ artboard: 'a', width: 1280 }]), { ok: true });
    expect(toast?.message).toBe('Duplicated at Laptop — 1280 wide.');
    expect(toast?.action).toBeUndefined();
  });
});

describe('the bridge settles it', () => {
  const bridge = readFileSync(join(STUDIO, 'client/hooks/use-canvas-bridge.jsx'), 'utf8');
  test('after the inspector’s own S7.21 toast had its turn, with the shell’s own edit.undo', () => {
    expect(bridge).toContain("from '../v2/create/duplicate-done.js'");
    const i = bridge.indexOf('settleAddedWidths(body, result)');
    const j = bridge.indexOf('settleDuplicateAtWidth(', i);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(bridge.slice(j, j + 200)).toContain("menuRunner.run('edit.undo')");
  });
  test('the canvas never sends an action: the notice parser still takes text only', () => {
    const msg = readFileSync(join(STUDIO, 'canvas-notice-message.ts'), 'utf8');
    expect(msg).not.toMatch(/data\.action|action:/);
  });
});
