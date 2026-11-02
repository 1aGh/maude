// S3.2a — the first Present row reads Present from “<artboard label>”: the selected artboard (or the one
// the selected element sits in), else the artboard in view; no label when that artboard is not known.
import { describe, expect, test } from 'bun:test';
import { presentFromLabel } from '../client/v2/shell/present-from-label.js';

const boards = [
  { id: 'post-1x1', label: 'Post 1:1' },
  { id: 'story', label: 'Story 9:16' },
  { id: 'blank', label: '  ' },
];

describe('presentFromLabel', () => {
  test('the selected element names its artboard', () => {
    expect(
      presentFromLabel({ selected: { artboardId: 'post-1x1' }, inView: 'story', boards })
    ).toBe('Post 1:1');
  });

  test('a set of one counts; a set of several falls back to the view', () => {
    expect(presentFromLabel({ selected: [{ artboardId: 'story' }], inView: null, boards })).toBe(
      'Story 9:16'
    );
    expect(
      presentFromLabel({
        selected: [{ artboardId: 'story' }, { artboardId: 'post-1x1' }],
        inView: 'post-1x1',
        boards,
      })
    ).toBe('Post 1:1');
  });

  test('no selection: the artboard in view', () => {
    expect(presentFromLabel({ selected: null, inView: 'story', boards })).toBe('Story 9:16');
  });

  test('nothing known: no label, so the row keeps its default words', () => {
    expect(presentFromLabel({ selected: null, inView: null, boards })).toBeNull();
    expect(presentFromLabel({ selected: null, inView: 'gone', boards })).toBeNull();
    expect(presentFromLabel({ selected: null, inView: 'story', boards: null })).toBeNull();
    expect(presentFromLabel({ selected: null, inView: 'blank', boards })).toBeNull();
  });
});
