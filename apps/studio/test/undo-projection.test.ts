// V2-1.5 §5.4 — the ⌘Z projection reducer (client/v2/undo/projection.js, S5.5).

import { describe, expect, test } from 'bun:test';

import {
  eventsFromHistory,
  fold,
  historyRows,
  initialState,
  nextRedo,
  nextUndo,
  reduce,
  undoToHere,
  view,
} from '../client/v2/undo/projection.js';

const C = 'ui/combine.tsx';
const fresh = () => initialState({ canvas: C, openedAt: 100 });
const act = (o: Record<string, unknown>) => ({
  type: 'action',
  action: { mine: true, canvases: [C], ...o },
});

describe('undo projection', () => {
  test('U1: ⌘Z undoes the whole AI run first, then your title; redo re-applies in order', () => {
    let s = fold(fresh(), [
      act({ actionId: 'a_title', kind: 'edit', label: 'Headline text', madeAt: 200, revision: 5 }),
      act({
        actionId: 'a_run',
        kind: 'ai',
        label: 'Restyle the story',
        madeAt: 300,
        revision: 6,
        runId: 'r_1',
        chatId: 'c1',
        artboards: { [C]: ['S'] },
      }),
    ]);
    expect(nextUndo(s)?.actionId).toBe('a_run');
    expect(nextUndo(s)).toMatchObject({ who: 'ai', artboards: ['S'], runId: 'r_1' });
    s = reduce(s, { type: 'undone', actionId: 'a_run' });
    expect(nextUndo(s)?.actionId).toBe('a_title');
    s = reduce(s, { type: 'undone', actionId: 'a_title' });
    expect(nextUndo(s)).toBeNull();
    expect(nextRedo(s)?.actionId).toBe('a_title');
    s = reduce(s, { type: 'redone', actionId: 'a_title' });
    expect(nextRedo(s)?.actionId).toBe('a_run');
    s = reduce(s, { type: 'redone', actionId: 'a_run' });
    expect(nextRedo(s)).toBeNull();
    expect(nextUndo(s)?.actionId).toBe('a_run');
  });

  test('U2: gesture time orders, not acceptance — the run landed after your headline edit', () => {
    // the headline was made at 250 during the run, accepted (revision 8) behind the run (revision 7)
    const s = fold(fresh(), [
      act({ actionId: 'a_run', kind: 'ai', label: 'Footer', madeAt: 400, revision: 7 }),
      act({ actionId: 'a_head', kind: 'edit', label: 'Headline', madeAt: 250, revision: 8 }),
    ]);
    expect(nextUndo(s)?.actionId).toBe('a_run');
    expect(nextUndo(reduce(s, { type: 'undone', actionId: 'a_run' }))?.actionId).toBe('a_head');
  });

  test('a pending gesture is an entry at once and keeps its place when its action arrives', () => {
    let s = reduce(fresh(), {
      type: 'pending',
      entry: { pendingTx: 'tx_1', label: 'Headline', madeAt: 250 },
    });
    expect(nextUndo(s)).toMatchObject({ actionId: null, pendingTx: 'tx_1' });
    s = reduce(s, act({ actionId: 'a_run', kind: 'ai', label: 'Footer', madeAt: 400 }));
    s = reduce(
      s,
      act({
        actionId: 'a_head',
        kind: 'edit',
        label: 'Headline',
        madeAt: 260,
        transactionId: 'tx_1',
      })
    );
    expect(historyRows(s).map((e) => e.actionId)).toEqual(['a_run', 'a_head']);
    expect(historyRows(s)[1]?.madeAt).toBe(250);
  });

  test('a new entry — your AI run landing included — clears redo', () => {
    let s = fold(fresh(), [act({ actionId: 'a1', kind: 'edit', label: 'X', madeAt: 200 })]);
    s = reduce(s, { type: 'undone', actionId: 'a1' });
    expect(nextRedo(s)?.actionId).toBe('a1');
    s = reduce(s, act({ actionId: 'a_run', kind: 'ai', label: 'Run', madeAt: 300 }));
    expect(nextRedo(s)).toBeNull();
  });

  test('U4: a fully conflicting entry turns stale and ⌘Z continues below it', () => {
    let s = fold(fresh(), [
      act({ actionId: 'a1', kind: 'edit', label: 'Layout', madeAt: 200 }),
      act({ actionId: 'a2', kind: 'edit', label: 'Colour', madeAt: 300 }),
    ]);
    s = reduce(s, { type: 'stale', actionId: 'a2', by: 'Tereza' });
    expect(nextUndo(s)?.actionId).toBe('a1');
    expect(historyRows(s)[0]).toMatchObject({ state: 'stale', undoneBy: 'Tereza' });
  });

  test('membership: others, comments, outside writes and actions before the canvas opened stay out', () => {
    const s = fold(fresh(), [
      act({ actionId: 'old', kind: 'edit', label: 'X', madeAt: 50 }),
      act({ actionId: 'theirs', kind: 'edit', label: 'X', madeAt: 200, mine: false }),
      act({ actionId: 'c', kind: 'comment', label: 'X', madeAt: 200 }),
      act({ actionId: 'o', kind: 'outside', label: null, madeAt: 200 }),
      act({ actionId: 'else', kind: 'edit', label: 'X', madeAt: 200, canvases: ['ui/b.tsx'] }),
      act({ actionId: 'chat-undo', kind: 'undo', label: 'Undo this chat', madeAt: 300 }),
    ]);
    // an undo from a panel IS an entry (⌘Z takes it back)
    expect(historyRows(s).map((e) => e.actionId)).toEqual(['chat-undo']);
  });

  test('a stopped run reads " — stopped"', () => {
    const s = fold(fresh(), [
      act({ actionId: 'a', kind: 'ai', label: 'Footer', madeAt: 200, partial: true }),
    ]);
    expect(nextUndo(s)?.label).toBe('Footer — stopped');
  });

  test('U18: Undo history row 3 undoes rows 1–3 as one multi-target undo (stale rows skipped)', () => {
    let s = fold(fresh(), [
      act({ actionId: 'a1', kind: 'edit', label: '1', madeAt: 200 }),
      act({ actionId: 'a2', kind: 'edit', label: '2', madeAt: 300 }),
      act({ actionId: 'a3', kind: 'ai', label: '3', madeAt: 400 }),
      act({ actionId: 'a4', kind: 'edit', label: '4', madeAt: 500 }),
    ]);
    s = reduce(s, { type: 'stale', actionId: 'a3' });
    expect(undoToHere(s, 2)).toEqual(['a4', 'a2']);
  });

  test('the server folds history through the same reducer: ⌘Z / ⇧⌘Z rows flip, panel undos are entries', () => {
    const rows = [
      {
        revision: 1,
        actionId: 'a1',
        mine: true,
        kind: 'edit',
        label: 'X',
        madeAt: 200,
        canvases: [C],
      },
      {
        revision: 2,
        actionId: 'a2',
        mine: true,
        kind: 'ai',
        label: 'Run',
        madeAt: 300,
        canvases: [C],
      },
      {
        revision: 3,
        actionId: 'u1',
        mine: true,
        kind: 'undo',
        label: 'Undo',
        undoes: 'a2',
        canvases: [C],
      },
      {
        revision: 4,
        actionId: 'u2',
        mine: true,
        kind: 'undo',
        label: 'Undo',
        undoes: 'a1',
        canvases: [C],
      },
      {
        revision: 5,
        actionId: 'r1',
        mine: true,
        kind: 'redo',
        label: 'Redo',
        undoes: 'u2',
        canvases: [C],
      },
    ];
    const s = fold(fresh(), eventsFromHistory(rows.reverse()));
    const v = view(s);
    expect(v.entries.map((e: { actionId: string }) => e.actionId)).toEqual(['a1']);
    expect(v.redo.map((e: { actionId: string }) => e.actionId)).toEqual(['a2']);
  });
});
