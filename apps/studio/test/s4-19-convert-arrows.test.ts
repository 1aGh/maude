// S4.19 an-convert: Turn into a comment leaves no arrow with a loose start. The thread sits where the sticky's
// arrow pointed, so the arrow goes to the trash in the SAME batch (one undo brings sticky and arrows back).

import { expect, test } from 'bun:test';

import type { AnnotationElement } from '../annotations/types.ts';
import { convertOps } from '../routes/annotations.ts';

const el = (o: Record<string, unknown>) => ({ index: 'a0', x: 0, y: 0, ...o }) as AnnotationElement;
const board = [
  el({ id: 's1', type: 'sticky', text: 'Make the hero bigger', w: 200, h: 200 }),
  el({ id: 's2', type: 'sticky', text: 'Another', w: 200, h: 200 }),
  // the sticky's own arrow: starts on it, ends on a button
  el({
    id: 'a_out',
    type: 'arrow',
    start: { el: 's1', nx: 0.5, ny: 1 },
    end: { x: 400, y: 300 },
    endHost: { ref: 'el:home/btn' },
  }),
  // somebody else's arrow pointing AT the sticky: the dangling card reads that one
  el({ id: 'a_in', type: 'arrow', start: { x: 10, y: 10 }, end: { el: 's1', nx: 0, ny: 0.5 } }),
  // an arrow of another sticky
  el({ id: 'a_other', type: 'arrow', start: { el: 's2', nx: 0.5, ny: 1 }, end: { x: 9, y: 9 } }),
];

test('the sticky and the arrows that start on it go together, in order', () => {
  expect(convertOps(board, 's1')).toEqual([
    { op: 'delete', id: 's1' },
    { op: 'delete', id: 'a_out' },
  ]);
});

test('an arrow pointing at the sticky, and another sticky arrows, stay', () => {
  const ids = convertOps(board, 's1').map((o) => o.id);
  expect(ids).not.toContain('a_in');
  expect(ids).not.toContain('a_other');
});

test('a sticky with no arrows is just itself', () => {
  expect(convertOps([board[0] as AnnotationElement], 's1')).toEqual([{ op: 'delete', id: 's1' }]);
});
