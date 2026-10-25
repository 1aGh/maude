// S4.9 (an-crowd) - below 25 % zoom stickies draw as colour blocks, sections carry counts, a hover card
// says who is in one, and a click zooms to it. Plus the visibility helpers behind the list's filter, the
// ⌘K "Hide resolved stickies" (C29) and ⇧⌘A.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  inMosaic,
  LOD_ZOOM,
  LodMosaic,
  lodCardWords,
  lodModel,
  zoomTarget,
} from '../annotations/ui/lod.tsx';
import {
  ANNOTATIONS_HIDDEN_TOAST,
  filterByAuthors,
  knownIds,
  personKeyOf,
  withoutResolved,
} from '../annotations/ui/visibility.ts';
import type { Stroke } from '../annotations-model.ts';

const sticky = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    tool: 'sticky',
    color: '#cfc4ec',
    x,
    y,
    w: 60,
    h: 50,
    text: id,
    fontSize: 14,
    ...extra,
  }) as unknown as Stroke;
const section = (id: string, label: string, x: number, y: number, w: number, h: number) =>
  ({ id, tool: 'section', label, x, y, w, h, color: '#ddd' }) as unknown as Stroke;

// "Nápady" holds 84 stickies by 3 people; 16 more sit loose.
const board: Stroke[] = [section('napady', 'Nápady', 0, 0, 2000, 1000)];
for (let i = 0; i < 84; i++)
  board.push(
    sticky(`n${i}`, (i % 12) * 150 + 20, Math.floor(i / 12) * 100 + 20, {
      authorName: ['Tereza', 'Jonas', 'Michal'][i % 3],
    })
  );
for (let i = 0; i < 16; i++) board.push(sticky(`l${i}`, 3000 + i * 70, 40));

describe('when the mosaic draws', () => {
  test('strictly below 25 %', () => {
    expect(LOD_ZOOM).toBe(0.25);
    expect(inMosaic(0.09)).toBe(true);
    expect(inMosaic(0.2499)).toBe(true);
    expect(inMosaic(0.25)).toBe(false);
    expect(inMosaic(1)).toBe(false);
    expect(inMosaic(0)).toBe(false); // an unmeasured camera is not a crowd
  });
});

describe('the model', () => {
  const m = lodModel(board);
  test('counts stickies per section, the rest stay loose', () => {
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0]?.count).toBe(84);
    expect(m.loose).toHaveLength(16);
  });
  test('the mosaic stands in for every sticky and section node', () => {
    expect(m.covered.size).toBe(101);
    expect(m.covered.has('n0')).toBe(true);
    expect(m.covered.has('napady')).toBe(true);
  });
  test('a sticky goes to the smallest section that holds it', () => {
    const nested = lodModel([
      section('outer', 'Outer', 0, 0, 1000, 1000),
      section('inner', 'Inner', 100, 100, 300, 300),
      sticky('a', 150, 150),
      sticky('b', 700, 700),
    ]);
    expect(nested.sections.find((s) => s.id === 'inner')?.count).toBe(1);
    expect(nested.sections.find((s) => s.id === 'outer')?.count).toBe(1);
  });
  test('who is in a section, in the order first seen', () => {
    expect(m.sections[0]?.people).toEqual(['h:Tereza', 'h:Jonas', 'h:Michal']);
  });
});

describe('the words', () => {
  test('hover card and hint', () => {
    expect(lodCardWords({ label: 'Nápady', count: 84 })).toEqual({
      head: 'Nápady · 84 stickies',
      hint: 'Click to zoom to it',
    });
    expect(lodCardWords({ label: 'Tisk', count: 1 }).head).toBe('Tisk · 1 sticky');
    expect(lodCardWords({ label: '', count: 3 }).head).toBe('Section · 3 stickies');
  });
  test('the zoom target leaves room around the section', () => {
    expect(zoomTarget({ x: 10, y: 20, w: 100, h: 50 }, 48)).toEqual({
      x: -38,
      y: -28,
      w: 196,
      h: 146,
    });
  });
});

describe('render', () => {
  const html = (quiet: boolean) =>
    renderToStaticMarkup(
      createElement(LodMosaic, { model: lodModel(board), zoom: 0.09, quiet, onZoomTo: () => {} })
    );
  test('one box per sticky, a count on the section, no card until hover', () => {
    const h = html(false);
    expect((h.match(/data-lod="tile"/g) ?? []).length).toBe(100);
    expect(h).toContain('Nápady 84');
    expect(h).not.toContain('annotations-lod-card');
    expect(h).toContain('Nápady · 84 stickies. Click to zoom to it');
  });
  test('a section is its own tone: the block is tinted and its count is a solid chip in that colour (15 an-crowd)', () => {
    const h = html(false);
    // section() above carries #ddd; the block washes it and the count chip is solid
    expect(h).toMatch(/data-lod="section"[^>]*style="[^"]*(color-mix|#ddd)/);
    expect(h).toMatch(/data-lod="count"[^>]*style="[^"]*background:#ddd/);
  });
  test('in Edit the mosaic is quiet and takes no pointer', () => {
    const h = html(true);
    expect(h).toContain('data-quiet="1"');
    expect(h).not.toContain('data-live');
    expect(h).toContain('disabled');
  });
  test('words hold a constant screen size: the count counter-scales by the zoom', () => {
    expect(html(false)).toContain(`scale(${1 / 0.09})`);
  });
});

describe('the list filter and Hide resolved (C29)', () => {
  const mixed: Stroke[] = [
    sticky('a', 0, 0, { authorName: 'Tereza' }),
    sticky('b', 0, 0, { authorName: 'Michal' }),
    sticky('c', 0, 0, { author: 'ai' }),
    sticky('d', 0, 0),
  ];
  test("person keys are the list's own", () => {
    expect(personKeyOf({ authorName: 'Tereza' }, 'Michal')).toBe('h:Tereza');
    expect(personKeyOf({ authorName: 'Michal' }, 'Michal')).toBe('you');
    expect(personKeyOf({ author: 'ai' })).toBe('ai');
    expect(personKeyOf({})).toBe('unknown');
  });
  test('empty list is Everyone; the filter hides, the board keeps them all', () => {
    expect(filterByAuthors(mixed, [], 'Michal')).toBe(mixed);
    expect(filterByAuthors(mixed, ['h:Tereza'], 'Michal').map((s) => s.id)).toEqual(['a']);
    expect(filterByAuthors(mixed, ['you', 'ai'], 'Michal').map((s) => s.id)).toEqual(['b', 'c']);
    expect(mixed).toHaveLength(4);
  });
  test('resolved stickies drop out of the drawing only when asked', () => {
    const withResolved = [
      sticky('open', 0, 0),
      sticky('done', 0, 0, { resolved: { by: 'Tereza', at: 1 } }),
    ];
    expect(withoutResolved(withResolved, false)).toBe(withResolved);
    expect(withoutResolved(withResolved, true).map((s) => s.id)).toEqual(['open']);
    expect(withoutResolved(mixed, true)).toBe(mixed);
  });
  test('annotation-select keeps ids that exist, once each', () => {
    expect(knownIds(['a', 'zz', 'a', 'c'], mixed)).toEqual(['a', 'c']);
  });
  test('the ⇧P toast says how to bring them back, and offers Show', () => {
    expect(ANNOTATIONS_HIDDEN_TOAST.title).toBe('Annotations hidden. Press ⇧P to bring them back.');
    expect(ANNOTATIONS_HIDDEN_TOAST.action).toBe('Show');
  });
});
