// Phase 8 · stage C round 3 — the review and switch sheets say what changed (13 · ds-edit-review, ds-edit-master,
// ds-multi-switch): the colours' own names on each side, a master's change in the editor's words, and no
// "0 of 0 canvases" above rows that simply cannot move.
import { describe, expect, test } from 'bun:test';
import { masterLines, withValueNames } from '../client/v2/ds/review-model.js';
import { headWords } from '../client/v2/ds/switch-model.js';

const board = {
  themes: { light: 'light', dark: 'dark' },
  tokens: [
    {
      css: '--accent',
      valueNames: { light: 'Azure' },
      pending: { valueNames: { light: 'Deeper azure' } },
    },
    { css: '--bg-0', valueNames: {}, pending: null },
  ],
  components: [
    {
      name: 'Button',
      className: 'btn',
      look: { 'border-radius': '2px', height: '36px' },
      patches: [
        { selector: '.btn', prop: 'border-radius', value: '6px' },
        { selector: '.btn:hover', prop: 'background', value: 'red' },
      ],
    },
    { name: 'Field', className: 'field', look: {}, patches: [] },
  ],
};

describe('review sheet words', () => {
  test('a colour change carries the name of each side: Azure › Deeper azure', () => {
    const out = withValueNames(
      [
        { css: '--accent', before: { light: '#06c' }, after: { light: '#05a' } },
        { css: '--bg-0', before: {}, after: {} },
        { css: '--nope', before: {}, after: {} },
      ],
      board
    );
    expect(out[0]).toMatchObject({ beforeName: 'Azure', afterName: 'Deeper azure' });
    expect(out[1].beforeName).toBeUndefined();
    expect(out[2]).toEqual({ css: '--nope', before: {}, after: {} });
    // no board model (the route did not answer): the changes pass through untouched
    expect(withValueNames([{ css: '--accent' }], null)).toEqual([{ css: '--accent' }]);
  });

  test('a master edit reads "Corners 2 → 6" — only the master’s own look, never a state rule', () => {
    expect(masterLines(board)).toEqual({ Button: ['Corners 2 → 6'] });
    expect(masterLines(null)).toEqual({});
  });
});

describe('switch sheet head', () => {
  test('when nothing can move it says so — never "0 of 0 canvases"', () => {
    const locked = [{ locked: true }, { locked: true }, { locked: true }, { locked: true }];
    expect(headWords(locked, 'Whole project')).toBe(
      'None of the 4 canvases in Whole project can switch'
    );
    // a canvas that can move keeps the counted words
    expect(headWords([{ locked: false, ticked: true }, { locked: true }], 'Studio site')).toBe(
      '1 of 1 canvas in Studio site'
    );
  });
});
