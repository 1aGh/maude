// figma/comments-to-pins.ts — Figma design comments become comment pins (S8.17b,
// decision:maude/v2-michal-figma-comments-as-pins).
//
// Fixture: a page with two frames and a Figma file's comments — two threads, one with a reply, one
// resolved — plus one on a node that is not on the page. The pins must sit where Figma pinned them,
// on the artboard the node lives in, carry the Figma writer as a label (never as `author`), and
// mention nobody.

import { describe, expect, test } from 'bun:test';

import { importedLabel } from '../comments/imported-from.ts';
import { mentionsOf } from '../comments/mentions.ts';
import { BEL, hiddenCodePoints, LRI, LRO, RLO, ZWSP } from '../test/_hostile-names.ts';
import type { FigmaComment } from './client.ts';
import { artboardIdOf, commentsToPins, MAX_COMMENT_PINS } from './comments-to-pins.ts';
import { ImportReport } from './sanitize.ts';
import { normalizeDocument } from './types.ts';

const KEY = 'dGNzRC2kmrmGnOxaBa0RI7';
const NOW = '2026-10-21T10:00:00.000Z';
const FILE = '.design/ui/Uniformy-2027 (Figma).tsx';

function page() {
  return normalizeDocument(
    {
      id: '0:0',
      name: 'Page',
      type: 'CANVAS',
      children: [
        {
          id: '2:1',
          name: 'Dres domaci',
          type: 'FRAME',
          visible: true,
          absoluteBoundingBox: { x: 1000, y: 500, width: 900, height: 1280 },
          children: [
            {
              id: '2:7',
              name: 'Logo',
              type: 'RECTANGLE',
              visible: true,
              absoluteBoundingBox: { x: 1100, y: 600, width: 80, height: 80 },
            },
          ],
        },
        {
          id: '2:2',
          name: 'Dres venkovni',
          type: 'FRAME',
          visible: true,
          absoluteBoundingBox: { x: 2000, y: 500, width: 900, height: 1280 },
        },
      ],
    },
    { fileKey: KEY, surface: 'design' }
  ).root;
}

const ORIGIN = { x: 1000, y: 500 };
const comment = (over: Partial<FigmaComment> = {}): FigmaComment => ({
  id: 'c1',
  message: 'Logo je moc male',
  nodeId: '2:7',
  x: 10,
  y: 20,
  resolved: false,
  author: 'Jonas Novak',
  createdAt: '2026-10-02T08:00:00Z',
  ...over,
});

let n = 0;
const run = (
  comments: FigmaComment[],
  over: Partial<Parameters<typeof commentsToPins>[4]> = {}
) => {
  const root = page();
  const nodes = new Map<string, (typeof root.children)[number]>();
  const walk = (x: typeof root): void => {
    nodes.set(x.id, x);
    for (const c of x.children ?? []) walk(c);
  };
  walk(root);
  const report = new ImportReport();
  n = 0;
  const out = commentsToPins(comments, nodes, ORIGIN, report, {
    file: FILE,
    importer: 'Michal',
    now: NOW,
    frameIds: ['2:1', '2:2'],
    pageId: '0:0',
    newId: () => `c_t${++n}`,
    newReplyId: () => `r_t${++n}`,
    ...over,
  });
  return { ...out, report };
};

describe('two threads (one with a reply, one resolved) import as two pins', () => {
  const threads: FigmaComment[] = [
    comment({ id: 'a', message: 'Logo je moc male' }),
    comment({
      id: 'a2',
      parentId: 'a',
      message: 'Zvetsim na 96',
      author: 'Tereza K',
      createdAt: '2026-10-02T09:30:00Z',
    }),
    comment({
      id: 'b',
      message: 'Hotovo, barva sedi',
      nodeId: '2:2',
      x: 40,
      y: 50,
      resolved: true,
      author: 'Tereza K',
      createdAt: '2026-10-03T08:00:00Z',
    }),
  ];

  test('two pins, anchored where Figma pinned them, on the artboard the node lives in', () => {
    const { records, placedIds } = run(threads);
    expect(records).toHaveLength(2);
    expect(placedIds).toEqual(['a', 'b']);
    const [one, two] = records;
    // node (1100,600) + offset (10,20), minus the page origin (1000,500)
    expect(one?.world).toEqual({ x: 110, y: 120 });
    expect(one?.artboard).toBe(artboardIdOf('2:1'));
    // the second frame is at x=2000: 2000 + 40 - 1000
    expect(two?.world).toEqual({ x: 1040, y: 50 });
    expect(two?.artboard).toBe(artboardIdOf('2:2'));
    // a pin is a floating thread on the canvas: no element selector to go stale
    expect(one?.selector).toBe('');
    expect(one?.file).toBe(FILE);
  });

  test('the reply is a thread reply; resolved stays resolved', () => {
    const { records } = run(threads);
    const [one, two] = records;
    expect(one?.status).toBe('open');
    expect(one?.resolved_at).toBeNull();
    expect(one?.thread).toHaveLength(1);
    expect(one?.thread[0]).toMatchObject({
      body: 'Zvetsim na 96',
      created: '2026-10-02T09:30:00.000Z',
    });
    expect(two?.status).toBe('resolved');
    expect(two?.resolved_at).toBe(NOW);
    expect(two?.thread).toEqual([]);
  });

  test('the Figma writer is a label on the thread and on each reply; `by` is the importer', () => {
    const { records } = run(threads);
    const [one, two] = records;
    expect(one?.author).toBe('Michal');
    expect(one?.importedFrom).toEqual({
      source: 'figma',
      author: { name: 'Jonas Novak' },
      at: '2026-10-02T08:00:00.000Z',
    });
    expect(importedLabel(one?.importedFrom)).toBe('Jonas Novak · from Figma');
    expect(one?.thread[0]?.author).toBe('Michal');
    expect(importedLabel(one?.thread[0]?.importedFrom)).toBe('Tereza K · from Figma');
    expect(two?.author).toBe('Michal');
    expect(importedLabel(two?.importedFrom)).toBe('Tereza K · from Figma');
  });

  test('nothing in an imported thread mentions anyone', () => {
    const { records } = run([
      comment({ id: 'm', message: '@michal prosim zkontroluj, cc @tereza' }),
      comment({ id: 'm2', parentId: 'm', message: '@jonas ano' }),
    ]);
    expect(records[0]?.mentions).toEqual([]);
    expect(mentionsOf(records[0] as never)).toEqual([]);
  });
});

describe('what has no home', () => {
  test('a comment on a node that is not on the page is unplaced, not invented a position', () => {
    const { records, unplacedIds } = run([comment({ id: 'gone', nodeId: '9:9' })]);
    expect(records).toEqual([]);
    expect(unplacedIds).toEqual(['gone']);
  });

  test('a canvas-level pin sits at page coordinates; the artboard is the frame under it, else none', () => {
    const { records } = run([
      comment({ id: 'p1', nodeId: undefined, x: 1500, y: 700 }),
      comment({ id: 'p2', nodeId: undefined, x: 1900, y: 100 }),
    ]);
    expect(records[0]?.world).toEqual({ x: 500, y: 200 });
    expect(records[0]?.artboard).toBe(artboardIdOf('2:1'));
    expect(records[1]?.artboard).toBeUndefined();
  });

  test('a comment pinned to the page itself is a canvas-level pin', () => {
    const { records } = run([comment({ id: 'pg', nodeId: '0:0', x: 2100, y: 600 })]);
    expect(records[0]?.artboard).toBe(artboardIdOf('2:2'));
  });

  test('an empty message makes no pin, and the cap holds', () => {
    expect(run([comment({ message: '   ' })]).records).toEqual([]);
    const many = Array.from({ length: MAX_COMMENT_PINS + 5 }, (_, i) => comment({ id: `k${i}` }));
    const { records, report } = run(many);
    expect(records).toHaveLength(MAX_COMMENT_PINS);
    expect(report.entries.some((e) => e.detail?.includes('comments'))).toBe(true);
  });
});

describe('the writer is untrusted input', () => {
  test('a hostile name is cleaned: no direction marks, no zero-width, one line, bounded', () => {
    const hostile = [RLO, 'gnirts', LRO, ZWSP, ' Eve\n\t', BEL, 'Admin', 'x'.repeat(300), LRI].join(
      ''
    );
    const { records } = run([comment({ author: hostile })]);
    const name = records[0]?.importedFrom.author.name ?? '';
    expect(hiddenCodePoints(name)).toEqual([]);
    expect(name).not.toContain('\n');
    expect(Array.from(name).length).toBeLessThanOrEqual(80);
    expect(name.startsWith('gnirts')).toBe(true);
  });

  test('a name that is nothing but hidden characters reads as Someone', () => {
    const { records } = run([comment({ author: `${ZWSP}${RLO}${LRI}` })]);
    expect(importedLabel(records[0]?.importedFrom)).toBe('Someone · from Figma');
    const { records: none } = run([comment({ author: undefined })]);
    expect(importedLabel(none[0]?.importedFrom)).toBe('Someone · from Figma');
  });

  test('a hostile message loses its hidden characters like every other imported string', () => {
    const { records, report } = run([comment({ message: `a${RLO}b${ZWSP}c` })]);
    expect(records[0]?.text).toBe('abc');
    expect(report.entries.some((e) => e.disposition === 'hidden-chars-dropped')).toBe(true);
  });
});
