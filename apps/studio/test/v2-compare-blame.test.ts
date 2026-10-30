// S1.15 — Compare's words and who-made-what (11 · pn-compare, V2-1.9 §5.7).
//
// Client half (client/v2/history/blame.js): the server's lines grouped by artboard, the summary line, the
// face or spark each line carries, the why-line that names what Restore takes back from others, and which
// artboard "Restore only …" may put back. Server half (history/changes.ts): the line a blame names is the
// NEWEST row in (A, B] whose own description has the same key; the answer carries the artboards' names.
import { describe, expect, test } from 'bun:test';

import {
  COMPARE_WORDS,
  focusGroup,
  groupByArtboard,
  keyInWords,
  makerOf,
  makerWords,
  restoreOnlyTarget,
  summaryLine,
  whyLine,
} from '../client/v2/history/blame.js';
import { describeBetween } from '../history/changes.ts';
import { describeVersion } from '../history/describe-version.ts';
import type { HistoryRowLike } from '../history/versions.ts';

const at = (h: number, m: number) => new Date(2026, 9, 18, h, m).getTime();

// The pn-compare example, line for line: 4 changes, 3 on the jersey, 1 on the helmet.
const change = (artboards: string[], words: string, kind = 'style') => ({
  artboards,
  grade: 'W1',
  kind,
  words,
});
const CHANGES = [
  change(['front'], 'Dres: černá → zelená'),
  change(['front'], 'Límec: zelený → černý'),
  change(['front'], 'Číslo 27: 120 → 150 px'),
  change(['helmet'], 'Logo na helmě: added', 'added'),
];
const LABELS = { front: 'Venkovní dres · přední', helmet: 'Helma z boku' };
const ROWS = [
  {
    id: 'a43',
    who: { kind: 'ai', actor: 'ai:you', name: 'AI', you: true },
    madeAt: at(14, 32),
  },
  {
    id: 'a42',
    who: { kind: 'person', actor: 'you', name: 'You', you: true },
    madeAt: at(14, 5),
  },
  {
    id: 'a40',
    who: { kind: 'person', actor: 'tereza', name: 'Tereza', you: false },
    madeAt: at(11, 20),
  },
  {
    id: 'a39',
    who: { kind: 'outside', actor: 'disk', name: 'Someone', you: false },
    madeAt: at(10, 0),
  },
];
// line index → the row the server blamed
const BLAME = { 0: 'a43', 1: 'a43', 2: 'a42', 3: 'a40' };

describe('the lines, grouped by artboard', () => {
  test('in the order met, each under the artboard’s name; canvas-level lines under "this canvas"', () => {
    const g = groupByArtboard(
      [...CHANGES, change([], 'Changed this canvas', 'canvas-text')],
      LABELS
    );
    expect(g.map((x) => [x.id, x.label, x.lines.map((l) => l.index)])).toEqual([
      ['front', 'Venkovní dres · přední', [0, 1, 2]],
      ['helmet', 'Helma z boku', [3]],
      ['', 'this canvas', [4]],
    ]);
  });

  test('an artboard the server sent no name for reads as its id in words', () => {
    const g = groupByArtboard([change(['front-view'], 'x')], {});
    expect(g[0]?.label).toBe('Front view');
    expect(keyInWords('disc-*')).toBe('Disc');
    expect(keyInWords('')).toBe('this canvas');
  });

  test('the summary line is the design’s, singular and empty included', () => {
    const g = groupByArtboard(CHANGES, LABELS);
    expect(summaryLine(g, 4)).toBe(
      '4 changes between A and B — 3 on Venkovní dres · přední, 1 on Helma z boku'
    );
    expect(summaryLine(groupByArtboard(CHANGES.slice(3), LABELS), 1)).toBe(
      '1 change between A and B — 1 on Helma z boku'
    );
    expect(summaryLine([], 0)).toBe(COMPARE_WORDS.none);
  });
});

describe('who made a line', () => {
  test('the row the server named gives the spark or a face, and the time', () => {
    expect(makerWords(makerOf(0, BLAME, ROWS))).toBe('Made by AI, 14:32');
    expect(makerWords(makerOf(2, BLAME, ROWS))).toBe('You, 14:05');
    expect(makerWords(makerOf(3, BLAME, ROWS))).toBe('Tereza, 11:20');
    expect(makerOf(0, BLAME, ROWS)?.kind).toBe('ai');
    expect(makerOf(3, BLAME, ROWS)).toMatchObject({ kind: 'person', name: 'Tereza', you: false });
  });

  test('no entry in the blame, a row that is not on screen, or a change made outside Maude: no face', () => {
    expect(makerOf(9, BLAME, ROWS)).toBeNull(); // nobody's row made it
    expect(makerOf(0, { 0: 'a_gone' }, ROWS)).toBeNull(); // the row is not in the list
    expect(makerOf(0, { 0: 'a39' }, ROWS)).toBeNull(); // changed outside Maude: nobody to show
    expect(makerWords(null)).toBe('changed in between');
  });
});

describe('the why-line: what Restore takes back from others', () => {
  const groups = groupByArtboard(CHANGES, LABELS);

  test('names the other person and where — never you, never the AI you asked', () => {
    expect(whyLine(groups, BLAME, ROWS)).toBe(
      'Restores the whole canvas as it was at A, as a new version — Tereza’s change to Helma z boku goes too. Now stays in the list.'
    );
  });

  test('several people, several changes: plural, in the order met', () => {
    const rows = [
      ...ROWS,
      { id: 'a41', who: { kind: 'person', name: 'Jonas', you: false }, madeAt: at(12, 0) },
    ];
    const blame = { 0: 'a41', 1: 'a41', 2: 'a42', 3: 'a40' };
    expect(whyLine(groups, blame, rows)).toBe(
      'Restores the whole canvas as it was at A, as a new version — Jonas’s changes to Venkovní dres · přední and Tereza’s change to Helma z boku go too. Now stays in the list.'
    );
  });

  test('nothing of anyone else’s: no dash, no names', () => {
    expect(whyLine(groups, { 0: 'a43', 2: 'a42' }, ROWS)).toBe(
      'Restores the whole canvas as it was at A, as a new version. Now stays in the list.'
    );
  });
});

describe('Restore only <artboard>', () => {
  const groups = groupByArtboard(
    [
      ...CHANGES,
      change(['disc-*'], 'Disc: size 1 → 2', 'artboard-resized'),
      change(['new'], 'Artboard “New” added', 'artboard-added'),
    ],
    LABELS
  );
  const by = (id: string) => groups.find((g) => g.id === id);

  test('a real artboard A holds is offered; a family, a canvas-level line and one added since are not', () => {
    expect(restoreOnlyTarget(by('front'))).toEqual({
      id: 'front',
      label: 'Venkovní dres · přední',
    });
    expect(restoreOnlyTarget(by('disc-*'))).toBeNull(); // generated artboards have no id to put back
    expect(restoreOnlyTarget(by('new'))).toBeNull(); // A has nothing of it
    expect(restoreOnlyTarget(groupByArtboard([change([], 'x')], {})[0])).toBeNull();
    expect(restoreOnlyTarget(null)).toBeNull();
  });

  test('focus: the clicked artboard, else the first with one', () => {
    expect(focusGroup(groups, 'helmet')?.id).toBe('helmet');
    expect(focusGroup(groups, null)?.id).toBe('front');
    expect(focusGroup(groups, 'gone')?.id).toBe('front');
    expect(focusGroup([], null)).toBeNull();
  });
});

// ── the server half ─────────────────────────────────────────────────────────────────────────────

const board = (text: string, color: string) =>
  `export default () => (<DesignCanvas>\n<DCArtboard id="hero" label="Hero" width={100} height={100}><h1 style={{ color: '${color}' }}>${text}</h1></DCArtboard>\n</DesignCanvas>);\n`;

const MIN = 60_000;
const T0 = new Date(2026, 9, 18, 9, 0).getTime();
const SOURCES: Record<number, string> = {
  1: board('A', 'red'),
  2: board('B', 'red'), // Tereza: the text, first time
  3: board('C', 'red'), // Jonas: the text again
  4: board('C', 'blue'), // Tereza: the colour
};
const actors = ['jonas', 'jonas', 'tereza', 'jonas', 'tereza'];
const HISTORY: HistoryRowLike[] = [1, 2, 3, 4].map((n) => ({
  revision: n,
  actionId: `a${n}`,
  actor: actors[n] as string,
  mine: false,
  kind: 'edit',
  label: null,
  committedAt: T0 + n * 30 * MIN,
  madeAt: T0 + n * 30 * MIN,
  undoes: null,
  canvases: ['ui/a.tsx'],
  lanes: { 'ui/a.tsx': ['html'] },
}));
const runtime = {
  async acceptedHistory(q: { before?: number | null; kind?: string | null; limit?: number }) {
    return HISTORY.filter((r) => !q.before || r.revision < q.before)
      .filter((r) => !q.kind || r.kind === q.kind)
      .sort((a, b) => b.revision - a.revision)
      .slice(0, q.limit ?? 50);
  },
  async acceptedVersion(_p: string, rev: number, lane = 'html') {
    return lane === 'html' ? (SOURCES[rev] ?? null) : null;
  },
};

describe('the server names the newest row with the same key', () => {
  test('a line changed twice names the newer version; another line names its own', async () => {
    const r = await describeBetween({
      runtime,
      repoRel: '.design/ui/a.tsx',
      canvas: 'ui/a.tsx',
      from: { kind: 'rev', rev: 1 },
      to: { kind: 'rev', rev: 4 },
    });
    if (!r.ok) throw new Error(`not ok: ${r.reason}`);
    const text = r.changes.findIndex((c) => c.kind === 'text');
    const colour = r.changes.findIndex((c) => c.kind !== 'text');
    expect(text).toBeGreaterThanOrEqual(0);
    expect(colour).toBeGreaterThanOrEqual(0);
    expect(r.blame[text]).toBe('a3'); // B then C: Jonas’s, the newer — not Tereza’s r2
    expect(r.blame[colour]).toBe('a4');
  });

  test('a pair that stops before the colour change does not blame it on anyone', async () => {
    const r = await describeBetween({
      runtime,
      repoRel: '.design/ui/a.tsx',
      canvas: 'ui/a.tsx',
      from: { kind: 'rev', rev: 1 },
      to: { kind: 'rev', rev: 3 },
    });
    if (!r.ok) throw new Error('not ok');
    expect(Object.values(r.blame)).toEqual(['a3']);
  });

  test('the answer carries the artboards’ names for the group headers', async () => {
    const r = await describeBetween({
      runtime,
      repoRel: '.design/ui/a.tsx',
      canvas: 'ui/a.tsx',
      from: { kind: 'rev', rev: 1 },
      to: { kind: 'rev', rev: 4 },
    });
    if (!r.ok) throw new Error('not ok');
    expect(r.labels).toEqual({ hero: 'Hero' });
    const lanes = (tsx: string) => ({ tsx, css: null, meta: null, annotations: null });
    const w = describeVersion('ui/a.tsx', lanes(SOURCES[1] as string), lanes(SOURCES[2] as string));
    expect(w.labels).toEqual({ hero: 'Hero' });
  });
});
