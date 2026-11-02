// S4.17 — Layers in Preview = the annotation list (canvas 15 · an-layers). Model pins, no DOM: the
// header count, the person chips, grouping by section with counts, the row words, the filter foot,
// and the rule that the filter HIDES but never removes.
import { describe, expect, test } from 'bun:test';
import {
  annotationFilterMessage,
  annotationSelectMessage,
  buildList,
  LOCKED_DRAG_TIP,
  lockedToolbarFor,
  personOf,
  toggleFilter,
} from '../client/v2/annotations/annotation-list-model.js';

const ME = { name: 'Michal', id: 'conn-1' };
const by = (name) => ({ kind: 'human', name });
const AI = { kind: 'ai', name: 'Claude' };

const sticky = (id, text, author, extra = {}) => ({
  id,
  type: 'sticky',
  index: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  fill: '#fce8a6',
  text,
  author,
  ...extra,
});

// The an-layers board: Tereza's section with four stickies (one locked), her arrow and marker, and
// 18 more annotations by Jonas (9), You (4) and AI (5) that the Tereza filter hides.
function board() {
  const els = [
    {
      id: 'sec1',
      type: 'section',
      index: 'a0',
      x: 0,
      y: 0,
      w: 430,
      h: 300,
      label: 'Zpětná vazba Tereza',
      author: by('Tereza'),
    },
    sticky('t1', 'Logo na postu o kousek výš', by('Tereza'), { parent: 'sec1', index: 'a1' }),
    sticky('t2', 'Na story méně textu', by('Tereza'), { parent: 'sec1', index: 'a2' }),
    sticky('t3', 'Datum tučně — 14. 3.', by('Tereza'), {
      parent: 'sec1',
      index: 'a3',
      locked: true,
    }),
    sticky('t4', 'Zelená je na tisk moc tmavá?', by('Tereza'), { parent: 'sec1', index: 'a4' }),
    {
      id: 'ar1',
      type: 'arrow',
      index: 'b1',
      start: { x: 1, y: 1 },
      end: { x: 5, y: 5 },
      endHost: { ref: 'ab:post-1x1', label: 'Post 1:1' },
      author: by('Tereza'),
    },
    {
      id: 'pen1',
      type: 'pen',
      index: 'b2',
      points: [0, 0, 5, 5],
      parentArtboard: 'post-1x1',
      author: by('Tereza'),
    },
  ];
  for (let i = 0; i < 9; i++)
    els.push(sticky(`j${i}`, `Jonas ${i}`, by('Jonas'), { index: `c${i}` }));
  for (let i = 0; i < 4; i++) els.push(sticky(`y${i}`, `Mine ${i}`, ME, { index: `d${i}` }));
  for (let i = 0; i < 5; i++) els.push(sticky(`a${i}`, `AI ${i}`, AI, { index: `e${i}` }));
  return els;
}

const ARTBOARDS = { 'post-1x1': 'Post 1:1' };
const artboardLabel = (id) => ARTBOARDS[id] ?? null;

describe('S4.17 · person identity', () => {
  test('You is the signed-in author, AI is kind=ai, the rest keep their name', () => {
    expect(personOf(ME, ME)).toEqual({ key: 'you', label: 'You' });
    expect(personOf({ kind: 'human', name: 'Michal' }, { name: 'Michal' })).toEqual({
      key: 'you',
      label: 'You',
    });
    expect(personOf(AI, ME)).toEqual({ key: 'ai', label: 'AI' });
    expect(personOf(by('Tereza'), ME)).toEqual({ key: 'h:Tereza', label: 'Tereza' });
    expect(personOf(undefined, ME)).toEqual({ key: 'unknown', label: 'Unattributed' });
  });
});

describe('S4.17 · the list', () => {
  test('header count is every annotation — sections are containers, not annotations', () => {
    const l = buildList(board(), { me: ME, artboardLabel });
    expect(l.total).toBe(24);
    expect(l.title).toBe('Annotations');
  });

  test('chips: Everyone · people by name · You · AI', () => {
    const l = buildList(board(), { me: ME, artboardLabel });
    expect(l.chips.map((c) => c.label)).toEqual(['Everyone', 'Jonas', 'Tereza', 'You', 'AI']);
    expect(l.chips.find((c) => c.key === 'everyone').on).toBe(true);
  });

  test('chips keep You and AI even when they have written nothing', () => {
    const l = buildList([sticky('s', 'x', by('Tereza'))], { me: ME, artboardLabel });
    expect(l.chips.map((c) => c.label)).toEqual(['Everyone', 'Tereza', 'You', 'AI']);
  });

  test('groups by section with a count; loose annotations follow', () => {
    const l = buildList(board(), { me: ME, artboardLabel });
    const g = l.groups[0];
    expect(g.id).toBe('sec1');
    expect(g.label).toBe('Zpětná vazba Tereza');
    expect(g.count).toBe(4);
    expect(g.rows.map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(l.loose.slice(0, 2).map((r) => r.label)).toEqual([
      'Arrow to Post 1:1',
      'Marker on Post 1:1',
    ]);
    expect(l.loose).toHaveLength(2 + 18);
  });

  test('a locked sticky says so; a sticky row is its words with its colour', () => {
    const l = buildList(board(), { me: ME, artboardLabel });
    const [t1, , t3] = l.groups[0].rows;
    expect(t3.locked).toBe(true);
    expect(t1.locked).toBe(false);
    expect(t1.label).toBe('Logo na postu o kousek výš');
    expect(t1.color).toBe('#fce8a6');
  });

  test('row words for the other kinds', () => {
    const els = [
      sticky('empty', '   ', by('Tereza')),
      { id: 's', type: 'shape', index: 'z1', kind: 'ellipse', author: by('Tereza') },
      { id: 'tx', type: 'text', index: 'z2', text: 'Hello there', author: by('Tereza') },
      {
        id: 'hl',
        type: 'pen',
        index: 'z3',
        highlighter: true,
        parentArtboard: 'post-1x1',
        author: by('Tereza'),
      },
      { id: 'pn', type: 'pen', index: 'z4', author: by('Tereza') },
      {
        id: 'ar',
        type: 'arrow',
        index: 'z5',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        author: by('Tereza'),
      },
      {
        id: 'ar2',
        type: 'arrow',
        index: 'z6',
        start: { x: 0, y: 0 },
        end: { el: 'tx' },
        author: by('Tereza'),
      },
      { id: 'st', type: 'stamp', index: 'z7', kind: 'heart', author: by('Tereza') },
      { id: 'im', type: 'image', index: 'z8', author: by('Tereza') },
      { id: 'zz', type: 'futuretype', index: 'z9', author: by('Tereza') },
    ];
    const l = buildList(els, { me: ME, artboardLabel });
    expect(l.loose.map((r) => r.label)).toEqual([
      'Empty sticky',
      'Ellipse',
      'Hello there',
      'Highlighter on Post 1:1',
      'Marker',
      'Arrow',
      'Arrow to Hello there',
      'Stamp',
      'Image',
      'Annotation',
    ]);
  });

  test('votes and ballots are metadata — never rows, never counted', () => {
    const els = [
      sticky('s', 'x', by('Tereza')),
      { id: 'v', type: 'vote', index: 'v1', author: by('Tereza') },
      { id: 'b', type: 'ballot', index: 'v2', author: by('Tereza') },
    ];
    const l = buildList(els, { me: ME, artboardLabel });
    expect(l.total).toBe(1);
    expect(l.loose).toHaveLength(1);
  });

  test('an orphan (parent missing) is a loose row, never lost', () => {
    const l = buildList([sticky('s', 'x', by('Tereza'), { parent: 'gone' })], {
      me: ME,
      artboardLabel,
    });
    expect(l.groups).toHaveLength(0);
    expect(l.loose.map((r) => r.id)).toEqual(['s']);
  });

  test('rows follow the board order (fractional index), sections first', () => {
    const els = [
      sticky('b', 'second', by('Tereza'), { index: 'a5' }),
      sticky('a', 'first', by('Tereza'), { index: 'a1' }),
    ];
    const l = buildList(els, { me: ME, artboardLabel });
    expect(l.loose.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('S4.17 · the filter hides, it does not remove', () => {
  const filtered = () => buildList(board(), { filter: ['h:Tereza'], me: ME, artboardLabel });

  test('only Tereza: her section (4), arrow and marker; the header still says 24', () => {
    const l = filtered();
    expect(l.total).toBe(24);
    expect(l.shown).toBe(6);
    expect(l.groups[0].count).toBe(4);
    expect(l.loose.map((r) => r.label)).toEqual(['Arrow to Post 1:1', 'Marker on Post 1:1']);
    expect(l.chips.find((c) => c.key === 'h:Tereza').on).toBe(true);
    expect(l.chips.find((c) => c.key === 'everyone').on).toBe(false);
  });

  test('the foot names who is hidden and how many — Jonas 9 · You 4 · AI 5', () => {
    expect(filtered().foot).toBe('Hidden by the filter: Jonas 9 · You 4 · AI 5');
  });

  test('no filter, no foot', () => {
    expect(buildList(board(), { me: ME, artboardLabel }).foot).toBeNull();
  });

  test('a filter that hides nothing has no foot either', () => {
    const l = buildList([sticky('s', 'x', by('Tereza'))], {
      filter: ['h:Tereza'],
      me: ME,
      artboardLabel,
    });
    expect(l.foot).toBeNull();
  });

  test('building the list never mutates the board', () => {
    const els = board();
    const before = JSON.stringify(els);
    buildList(els, { filter: ['ai'], me: ME, artboardLabel });
    expect(JSON.stringify(els)).toBe(before);
  });

  test('the section follows its children: all of them filtered out, it goes', () => {
    const l = buildList(board(), { filter: ['ai'], me: ME, artboardLabel });
    expect(l.groups).toHaveLength(0);
    expect(l.shown).toBe(5);
    expect(l.foot).toBe('Hidden by the filter: Jonas 9 · Tereza 6 · You 4');
  });

  test('two people at once', () => {
    const l = buildList(board(), { filter: ['h:Tereza', 'you'], me: ME, artboardLabel });
    expect(l.shown).toBe(10);
    expect(l.foot).toBe('Hidden by the filter: Jonas 9 · AI 5');
  });

  test('an empty section stays while its own author passes', () => {
    const els = [{ id: 'e', type: 'section', index: 'a', label: 'Empty', author: by('Tereza') }];
    expect(buildList(els, { filter: ['h:Tereza'], me: ME, artboardLabel }).groups).toHaveLength(1);
    expect(buildList(els, { filter: ['ai'], me: ME, artboardLabel }).groups).toHaveLength(0);
  });

  test('toggling chips: Everyone clears, a person toggles', () => {
    expect(toggleFilter([], 'h:Tereza')).toEqual(['h:Tereza']);
    expect(toggleFilter(['h:Tereza'], 'you')).toEqual(['h:Tereza', 'you']);
    expect(toggleFilter(['h:Tereza', 'you'], 'you')).toEqual(['h:Tereza']);
    expect(toggleFilter(['h:Tereza'], 'h:Tereza')).toEqual([]);
    expect(toggleFilter(['h:Tereza'], 'everyone')).toEqual([]);
  });
});

describe('S4.17 · twisty', () => {
  test('a closed section keeps its count but lists no rows', () => {
    const l = buildList(board(), { me: ME, artboardLabel, closed: new Set(['sec1']) });
    expect(l.groups[0].open).toBe(false);
    expect(l.groups[0].count).toBe(4);
    expect(l.groups[0].rows).toEqual([]);
  });
});

describe('S4.17 · the messages S4.9 owns', () => {
  test('annotation-select carries ids; annotation-filter carries authors', () => {
    expect(annotationSelectMessage(['t1', 't2'])).toEqual({
      dgn: 'annotation-select',
      v: 1,
      ids: ['t1', 't2'],
    });
    expect(annotationFilterMessage(['h:Tereza'])).toEqual({
      dgn: 'annotation-filter',
      v: 1,
      authors: ['h:Tereza'],
    });
    expect(annotationFilterMessage([])).toEqual({ dgn: 'annotation-filter', v: 1, authors: [] });
  });
});

describe('S4.17 · the locked toolbar and the drag tooltip', () => {
  test('one locked selection offers Unlock ⇧⌘L', () => {
    expect(lockedToolbarFor(board(), ['t3'])).toEqual({
      label: 'Locked',
      action: 'Unlock',
      kbd: '⇧⌘L',
    });
  });
  test('a mixed or unlocked selection shows nothing', () => {
    expect(lockedToolbarFor(board(), ['t1'])).toBeNull();
    expect(lockedToolbarFor(board(), ['t1', 't3'])).toBeNull();
    expect(lockedToolbarFor(board(), [])).toBeNull();
  });
  test('the drag tooltip', () => {
    expect(LOCKED_DRAG_TIP).toBe('Locked — unlock to move it');
  });
});
