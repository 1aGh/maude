// S1.12 — rule G (V2-1.9 §5.1): which versions of one canvas share a Version history row.
// The reducer is pure and shared by the server and the panel, so the oracle is its output.

import { describe, expect, test } from 'bun:test';
import {
  filterRows,
  isHardBreak,
  nowRow,
  offlineLine,
  parseFilter,
  ROW_GAP_MS,
  type RowVersion,
  reduceRows,
} from '../client/v2/history/rows.ts';
import type { Change } from '../history/describe.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 12, 0);

const line = (artboard: string, words: string): Change => ({
  artboards: [artboard],
  grade: 'W1',
  kind: 'text',
  words,
});

let n = 0;
function v(over: Partial<RowVersion> & { at: number }): RowVersion {
  n += 1;
  const { at, ...rest } = over;
  return {
    rev: n,
    actionId: `a${n}`,
    actor: 'tereza',
    actorName: 'Tereza',
    mine: false,
    kind: 'edit',
    label: null,
    madeAt: T0 + at * MIN,
    canvas: 'ui/poster.tsx',
    artboards: ['front'],
    changes: [line('front', `Text “${n}”`)],
    ...rest,
  };
}
const fresh = () => {
  n = 0;
};
const clock = (ms: number) => `${Math.round((ms - T0) / MIN)}m`;
const ids = (rows: { actions: string[] }[]) => rows.map((r) => r.actions.join(','));

describe('rule G — which versions share a row', () => {
  test('a gap over 10 min starts a new row; within it they join', () => {
    fresh();
    const rows = reduceRows([v({ at: 0 }), v({ at: 9 }), v({ at: 19.5 }), v({ at: 29 })], [], {
      clock,
    });
    // newest first: [a3,a4] then [a1,a2]
    expect(ids(rows)).toEqual(['a3,a4', 'a1,a2']);
    expect(rows[0]?.ref).toBe('r4');
    expect(rows[0]?.from).toBe('r2');
    expect(rows[0]?.id).toBe('a3');
  });

  test('a row never spans more than 60 min, even with no gap', () => {
    fresh();
    const vs = [0, 8, 16, 24, 32, 40, 48, 56, 61, 64].map((at) => v({ at }));
    expect(ids(reduceRows(vs))).toEqual(['a9,a10', 'a1,a2,a3,a4,a5,a6,a7,a8']);
  });

  test('a name splits the row at the named revision; the named version ends its row', () => {
    fresh();
    const vs = [v({ at: 0 }), v({ at: 2 }), v({ at: 4 }), v({ at: 6 })];
    const rows = reduceRows(
      vs,
      [{ rev: 2, name: 'Before helmets', by: 'jonas', byName: 'Jonas', at: T0 + 40 * MIN }],
      {
        clock,
      }
    );
    expect(ids(rows)).toEqual(['a3,a4', 'a1,a2']);
    expect(rows[1]?.title).toBe('Before helmets');
    expect(rows[1]?.chips).toContain('Named');
    expect(rows[1]?.sub).toBe('40m · Jonas');
    expect(rows[1]?.named?.name).toBe('Before helmets');
  });

  test('a name on a revision that did not change the canvas decorates the version before it', () => {
    fresh();
    const vs = [v({ at: 0 }), v({ at: 2 }), v({ at: 4 })];
    vs[2] = { ...(vs[2] as RowVersion), rev: 10 };
    const rows = reduceRows(vs, [{ rev: 7, name: 'Sent', by: 'tereza', at: T0 }]);
    expect(ids(rows)).toEqual(['a3', 'a1,a2']);
    expect(rows[1]?.named?.name).toBe('Sent');
  });

  test("another actor's version ends the row; the first actor's next edit is a new row", () => {
    fresh();
    const vs = [v({ at: 0 }), v({ at: 1, actor: 'jonas', actorName: 'Jonas' }), v({ at: 2 })];
    const rows = reduceRows(vs, [], { clock });
    expect(ids(rows)).toEqual(['a3', 'a2', 'a1']);
    expect(rows[1]?.sub).toBe('1m · Jonas');
    expect(rows[1]?.who).toEqual({ kind: 'person', actor: 'jonas', name: 'Jonas', you: false });
  });

  test('your own rows read "You"', () => {
    fresh();
    const rows = reduceRows([v({ at: 0, mine: true, actor: 'me' })], [], { clock });
    expect(rows[0]?.sub).toBe('0m · You');
    expect(rows[0]?.who.you).toBe(true);
  });

  test('an AI run is a row of its own, titled by its prompt; a canvas-only session sees the words', () => {
    fresh();
    const vs = [
      v({ at: 0 }),
      v({ at: 1, kind: 'ai', prompt: 'Make the helmet logo bigger', runId: 'run_1' }),
      v({ at: 2 }),
    ];
    const project = reduceRows(vs, [], { clock, artboardLabel: () => 'Helma z boku' });
    expect(ids(project)).toEqual(['a3', 'a2', 'a1']);
    expect(project[1]?.kind).toBe('ai');
    expect(project[1]?.who.kind).toBe('ai');
    expect(project[1]?.title).toBe('Make the helmet logo bigger');
    expect(project[1]?.chips).toEqual(['Made by AI']);
    expect(project[1]?.sub).toBe('1m · Helma z boku');
    const scoped = reduceRows(vs, [], { scope: 'canvas-only' });
    expect(scoped[1]?.title).toBe('Text “2”');
  });

  test('⌘Z inside a row folds into it; a panel or chat undo is a row of its own', () => {
    fresh();
    const a = v({ at: 0 });
    const b = v({ at: 1 });
    const keys = v({ at: 2, kind: 'undo', undoVia: 'keys', undoes: ['a2'] });
    const c = v({ at: 3 });
    expect(ids(reduceRows([a, b, keys, c]))).toEqual(['a1,a2,a3,a4']);
    fresh();
    const a2 = v({ at: 0 });
    const panel = v({
      at: 1,
      kind: 'undo',
      undoVia: 'panel',
      undoes: ['a1'],
      undid: { title: 'x' },
    });
    const chat = v({
      at: 2,
      kind: 'undo',
      undoVia: 'chat',
      undoes: ['a1'],
      undid: { chat: true, changes: 3 },
    });
    const rows = reduceRows([a2, panel, chat]);
    expect(ids(rows)).toEqual(['a3', 'a2', 'a1']);
    expect(rows[0]?.title).toBe('Undid a chat — 3 changes');
    expect(rows[1]?.title).toBe('Undid “x”');
  });

  test('a ⌘Z whose target is outside the open row does not fold', () => {
    fresh();
    const a = v({ at: 0 });
    const b = v({ at: 20 });
    const keys = v({ at: 21, kind: 'undo', undoVia: 'keys', undoes: ['a1'] });
    expect(ids(reduceRows([a, b, keys]))).toEqual(['a3', 'a2', 'a1']);
  });

  test('restore, trash, outside, baseline, aside and a move are rows of their own; name / comment are not rows', () => {
    fresh();
    const vs = [
      v({ at: 0, kind: 'migration.import' }),
      v({ at: 1, kind: 'outside' }),
      v({ at: 2, kind: 'outside' }),
      v({ at: 3, kind: 'history.restore', restored: { name: 'Before helmets' } }),
      v({ at: 4, kind: 'name', label: 'x' }),
      v({ at: 5, kind: 'comment' }),
      v({ at: 6, kind: 'trash', trashedLabel: 'Helma z boku' }),
      v({ at: 7, kind: 'aside' }),
      v({ at: 8, kind: 'canvas.move', label: 'Moved to Brand' }),
    ];
    const rows = reduceRows(vs);
    expect(rows.map((r) => r.kind)).toEqual([
      'moved',
      'aside',
      'trash',
      'restore',
      'outside',
      'outside',
      'baseline',
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(by.baseline?.title).toBe('Version history starts here');
    expect(by.baseline?.from).toBeNull();
    expect(by.restore?.title).toBe('Restored “Before helmets”');
    expect(by.restore?.chips).toEqual(['Restored']);
    expect(by.trash?.title).toBe('Moved “Helma z boku” to the trash');
    expect(by.trash?.thumb).toBeNull();
    expect(by.aside?.chips).toEqual(['Not kept']);
    expect(by.outside?.sub).toContain('· changed outside the app');
  });

  // S1.14: the kernel only knows a restore by its label ("Restored “Before helmets”", "Restored Helma z boku
  // to 5 Oct, 18:40", "Went back to 14:05"); the row reads those words, not "Restored a version".
  test('a restore row takes its title from the action label', () => {
    fresh();
    const rows = reduceRows([
      v({ at: 0, kind: 'history.restore', label: 'Restored “Schváleno trenéry”', restored: {} }),
      v({ at: 20, kind: 'history.restore', label: 'Restored 5 Oct, 18:40', restored: {} }),
      v({ at: 40, kind: 'history.restore', label: 'Went back to 14:05', restored: {} }),
      v({ at: 60, kind: 'history.restore', label: null, restored: {} }),
      v({ at: 80, kind: 'history.restore', label: 'x'.repeat(200), restored: {} }),
    ]);
    expect(rows.map((r) => r.title)).toEqual([
      `${'x'.repeat(79)}…`,
      'Restored a version',
      'Went back to 14:05',
      'Restored 5 Oct, 18:40',
      'Restored “Schváleno trenéry”',
    ]);
  });

  test('a stopped run carries the Stopped chip', () => {
    fresh();
    const rows = reduceRows([v({ at: 0, kind: 'ai', prompt: 'p', partial: true })]);
    expect(rows[0]?.chips).toEqual(['Made by AI', 'Stopped']);
  });
});

describe('a row summarises its versions', () => {
  test('artboards most changes first; the picture is the most-changed artboard at the last revision', () => {
    fresh();
    const rows = reduceRows([
      v({ at: 0, artboards: ['front', 'back'], changes: [line('front', 'a'), line('back', 'b')] }),
      v({ at: 1, artboards: ['back'], changes: [line('back', 'c')] }),
    ]);
    expect(rows[0]?.artboards).toEqual(['back', 'front']);
    expect(rows[0]?.changes).toBe(3);
    expect(rows[0]?.thumb).toEqual({
      canvas: 'ui/poster.tsx',
      artboard: 'back',
      at: { rev: 2 },
      size: 'row',
    });
    expect(rows[0]?.title).toBe('b + 2 more');
  });

  test('"also on N other canvases" only in project scope (U5)', () => {
    fresh();
    const vs = [v({ at: 0, alsoOn: 2 })];
    expect(reduceRows(vs)[0]?.alsoOn).toBe(2);
    expect(reduceRows(vs, [], { scope: 'canvas-only' })[0]?.alsoOn).toBeUndefined();
  });

  test('no pictures in a cloud browser tab (Q7)', () => {
    fresh();
    expect(reduceRows([v({ at: 0 })], [], { pictures: false })[0]?.thumb).toBeNull();
  });
});

describe('filters, paging, Now', () => {
  test('All · Named · Made by AI · People', () => {
    fresh();
    const rows = reduceRows(
      [
        v({ at: 0, kind: 'migration.import' }),
        v({ at: 20 }),
        v({ at: 40, kind: 'ai', prompt: 'p' }),
        v({ at: 60, kind: 'outside' }),
        v({ at: 80, kind: 'aside' }),
      ],
      [{ rev: 2, name: 'N', by: 'tereza', at: T0 }]
    );
    expect(filterRows(rows, 'all').length).toBe(5);
    expect(filterRows(rows, 'named').map((r) => r.ref)).toEqual(['r2']);
    expect(filterRows(rows, 'ai').map((r) => r.kind)).toEqual(['ai']);
    expect(filterRows(rows, 'people').map((r) => r.kind)).toEqual(['edit']);
    expect(parseFilter(undefined)).toBe('all');
    expect(parseFilter('people')).toBe('people');
    expect(parseFilter('everyone')).toBeNull();
  });

  test('a walk started at a hard break agrees with the full walk on every boundary', () => {
    fresh();
    const ats = [0, 5, 9, 30, 35, 40, 45, 50, 55, 60, 65, 70, 95, 100];
    const vs = ats.map((at, i) => v({ at, ...(i === 6 ? { actor: 'jonas' } : {}) }));
    const full = ids(reduceRows(vs));
    for (let i = 1; i < vs.length; i++) {
      if (!isHardBreak(vs[i - 1] as RowVersion, vs[i] as RowVersion)) continue;
      const tail = ids(reduceRows(vs.slice(i)));
      expect(full.slice(0, tail.length)).toEqual(tail);
    }
    expect(isHardBreak(null, vs[0] as RowVersion)).toBe(true);
    // a gap over the threshold is always a break; a same-actor short gap never is
    expect(isHardBreak(vs[2] as RowVersion, vs[3] as RowVersion)).toBe(true);
    expect(isHardBreak(vs[3] as RowVersion, vs[4] as RowVersion)).toBe(false);
    expect(ROW_GAP_MS).toBe(10 * MIN);
  });

  test('the Now row names the newest version; unsent changes read "Saving…" and disable it', () => {
    const base = { canvas: 'ui/a.tsx', canvasLabel: 'Pozvánka', newestRev: 12, canEdit: true };
    expect(nowRow({ ...base, status: 'Saved' })).toEqual({
      canvas: 'ui/a.tsx',
      title: 'Now · Pozvánka · Saved',
      status: 'Saved',
      ref: 'r12',
      nameButton: { label: 'Name this version…', enabled: true },
    });
    expect(nowRow({ ...base, status: 'Saving…' }).nameButton).toEqual({
      label: 'Saving…',
      enabled: false,
    });
    expect(nowRow({ ...base, status: 'Saved', canEdit: false }).nameButton.enabled).toBe(false);
    expect(nowRow({ ...base, status: 'Offline' }).nameButton.enabled).toBe(false);
    expect(offlineLine(T0 + 125 * MIN, clock)).toBe('Offline — showing versions up to 125m');
  });
});
