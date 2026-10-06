// annotations-v2 (DDR-242 AD7, Task 19) — an edit session as ops: drafts,
// concurrent typing by two people, a delete while editing, undo to the base.
// Two "stores" (A, B) talk to one board through applyOps, the way both the
// studio server and the hub kernel apply them.

import { describe, expect, test } from 'bun:test';
import { applyOps, diffToOps, type Op } from '../annotations/ops.ts';
import { validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  aimCommitOps,
  draftOp,
  markSent,
  openSession,
  remotelyEdited,
  restoreOp,
  slotText,
} from '../annotations/ui/text-session.ts';

function boardOf(raw: unknown[]): Map<string, AnnotationElement> {
  return new Map(validateElements(raw).elements.map((e) => [e.id, e]));
}

const sticky = { id: 's', type: 'sticky', index: 'a0', x: 0, y: 0, w: 200, h: 200, text: 'hello' };

/** The shared board: every batch lands in acceptance order. */
class Board {
  state: Map<string, AnnotationElement>;
  constructor(raw: unknown[]) {
    this.state = boardOf(raw);
  }
  send(ops: Op[]) {
    const r = applyOps(this.state, ops);
    this.state = r.state;
    return r;
  }
  get(id: string) {
    return this.state.get(id);
  }
}

describe('two people typing in one sticky', () => {
  test('A drafts, B types elsewhere, A commits — both edits survive', () => {
    const board = new Board([sticky]);
    let a = openSession(board.get('s') as AnnotationElement);
    let b = openSession(board.get('s') as AnnotationElement);
    if (!a || !b) throw new Error('no session');

    // A pauses mid-typing: a draft lands.
    const d1 = draftOp(a, board.get('s'), 'hello there');
    board.send([d1 as Op]);
    a = markSent(a, 'hello there');

    // B, who opened on "hello", prefixes a word and commits.
    const bd = draftOp(b, board.get('s'), 'Oh, hello');
    board.send([bd as Op]);
    b = markSent(b, 'Oh, hello');
    expect(slotText(board.get('s') as AnnotationElement, 'text')).toBe('Oh, hello there');

    // A sees the text moved under the editor (the "edited by" marker)…
    expect(remotelyEdited(a, board.get('s'))).toBe(true);
    // …and commits its final text: expect = what A last sent, not the base.
    const diff = diffToOps(
      new Map([['s', board.get('s') as AnnotationElement]]),
      new Map([['s', { ...(board.get('s') as AnnotationElement), text: 'hello there, friend' }]])
    );
    board.send(aimCommitOps(diff, a));
    expect(slotText(board.get('s') as AnnotationElement, 'text')).toBe('Oh, hello there, friend');
  });

  test('expecting the base instead of the last draft would lose the collaborator (why lastSent)', () => {
    const board = new Board([sticky]);
    const a = openSession(board.get('s') as AnnotationElement);
    if (!a) throw new Error('no session');
    board.send([draftOp(a, board.get('s'), 'hello there') as Op]);
    board.send([
      { op: 'patch', id: 's', set: { text: 'Oh, hello there' }, expect: { text: 'hello there' } },
    ]);
    // Commit aimed at the BASE: A's own draft now overlaps A's final text.
    board.send([
      { op: 'patch', id: 's', set: { text: 'hello there, friend' }, expect: { text: 'hello' } },
    ]);
    expect(slotText(board.get('s') as AnnotationElement, 'text')).toBe('hello there, friend');
  });

  test('a draft of nothing new sends nothing', () => {
    const board = new Board([sticky]);
    const a = openSession(board.get('s') as AnnotationElement);
    if (!a) throw new Error('no session');
    expect(draftOp(a, board.get('s'), 'hello')).toBeNull();
  });
});

describe('shape labels and section titles', () => {
  test('a label draft keeps the label’s other fields', () => {
    const board = new Board([
      {
        id: 'r',
        type: 'shape',
        index: 'a0',
        x: 0,
        y: 0,
        w: 100,
        h: 60,
        label: { text: 'abc', fontSize: 22, bold: true },
      },
    ]);
    const a = openSession(board.get('r') as AnnotationElement);
    if (!a) throw new Error('no session');
    board.send([draftOp(a, board.get('r'), 'abcd') as Op]);
    expect(board.get('r')?.label).toEqual({ text: 'abcd', fontSize: 22, bold: true });
  });

  test('a section title merges like any other text', () => {
    const board = new Board([
      { id: 'sec', type: 'section', index: 'a0', x: 0, y: 0, w: 400, h: 300, label: 'Plan' },
    ]);
    const a = openSession(board.get('sec') as AnnotationElement);
    if (!a) throw new Error('no session');
    board.send([{ op: 'patch', id: 'sec', set: { label: 'Plan!' }, expect: { label: 'Plan' } }]);
    board.send(
      aimCommitOps(
        [{ op: 'patch', id: 'sec', set: { label: 'Big Plan' }, expect: { label: 'Plan!' } }],
        a
      )
    );
    expect(board.get('sec')?.label).toBe('Big Plan!');
  });
});

describe('deleted while editing', () => {
  test('B deletes the sticky A is typing in — A keeps the text by restoring it', () => {
    const board = new Board([sticky]);
    const a = openSession(board.get('s') as AnnotationElement);
    if (!a) throw new Error('no session');
    const lastKnown = board.get('s') as AnnotationElement;
    board.send([{ op: 'delete', id: 's' }]);
    // The draft has nowhere to land: no op, the editor stays open.
    expect(draftOp(a, board.get('s'), 'hello and more')).toBeNull();
    board.send([restoreOp(a, lastKnown, 'hello and more', true)]);
    expect(board.get('s')).toMatchObject({ id: 's', type: 'sticky', text: 'hello and more' });
  });

  test('restoring into a section that is gone too lands at the last world position', () => {
    const board = new Board([
      { id: 'sec', type: 'section', index: 'a0', x: 100, y: 100, w: 400, h: 300 },
      { ...sticky, parent: 'sec', x: 10, y: 20 },
    ]);
    const a = openSession(board.get('s') as AnnotationElement);
    if (!a) throw new Error('no session');
    const lastKnown = board.get('s') as AnnotationElement;
    board.send([
      { op: 'delete', id: 's' },
      { op: 'delete', id: 'sec' },
    ]);
    const r = board.send([restoreOp(a, lastKnown, 'kept', false, { x: 110, y: 120 })]);
    expect(r.rejected).toEqual([]);
    expect(board.get('s')).toMatchObject({ x: 110, y: 120, text: 'kept' });
    expect(board.get('s')?.parent).toBeUndefined();
  });
});

describe('undo goes back to the text before the edit, not to a draft', () => {
  test('the undo batch is the inverse of base → final', () => {
    const board = new Board([sticky]);
    let a = openSession(board.get('s') as AnnotationElement);
    if (!a) throw new Error('no session');
    board.send([draftOp(a, board.get('s'), 'hello w') as Op]);
    a = markSent(a, 'hello w');
    board.send(
      aimCommitOps(
        [{ op: 'patch', id: 's', set: { text: 'hello world' }, expect: { text: 'hello w' } }],
        a
      )
    );
    // The undo record is built from base → final (drafts never enter undo).
    const undo: Op = {
      op: 'patch',
      id: 's',
      set: { text: a.base },
      expect: { text: 'hello world' },
    };
    board.send([undo]);
    expect(slotText(board.get('s') as AnnotationElement, 'text')).toBe('hello');
  });
});
