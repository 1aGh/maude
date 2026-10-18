// S1.4 — ⌘K when there is nothing to show: no hits ("Nothing called “x”." — CONTRACT §4, rule
// 00/rule/nothing-found) and a brand-new Mac (Recent says so; Start here lists where to begin — 05 ·
// es-search-k / es-search-more). Copy is pinned to CONTRACT.md, not to a second copy of the words.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assemble, emptyCopy, footerCount } from '../client/v2/search/search-model.js';
import {
  fetchRecents,
  RECENT_CAP,
  RECENT_EMPTY,
  recentRows,
  START_HERE,
  startRows,
} from '../client/v2/search/search-recent.js';

const CONTRACT = readFileSync(
  path.join(import.meta.dir, '../../../.design/system/maude-v2/CONTRACT.md'),
  'utf8'
);
/** The markdown writes straight quotes; the screen draws curly ones. */
const straight = (s: string) => s.replace(/[“”]/g, '"');

describe('no hits: the CONTRACT line, word for word', () => {
  test('CONTRACT §4 holds the line the palette says', () => {
    const copy = emptyCopy('pricng', true);
    expect(CONTRACT).toContain(straight(`${copy.headline} ${copy.next}`));
  });

  test('without an AI (a browser tab) the second half goes, and so does the Ask AI row', () => {
    expect(emptyCopy('pricng', false)).toEqual({
      headline: 'Nothing called “pricng”.',
      next: 'Try another word.',
    });
    expect(assemble({ query: 'qqqq', local: [], remote: [], canAskAI: false }).ask).toBeNull();
  });

  test('zero rows: empty, 0 results, and Ask AI the only item, worded for a search that found nothing', () => {
    const res = assemble({ query: 'zzzzqq', local: [], remote: [], canAskAI: true });
    expect(res.empty).toBe(true);
    expect(footerCount(res)).toBe('0 results');
    expect(res.items.map((r: { id: string }) => r.id)).toEqual(['ask-ai']);
    expect(res.ask.name).toBe('Ask AI to find “zzzzqq”');
  });
});

describe('a Mac where nothing was opened yet', () => {
  test('the empty Recent line is the drawn one (05 · es-search-more)', () => {
    expect(RECENT_EMPTY).toEqual({
      headline: 'Nothing opened yet.',
      next: 'Canvases you open show up here, newest first.',
    });
  });

  test('Start here is the four registry rows, in the drawn order, with the registry’s own label and key', () => {
    expect(START_HERE).toEqual(['canvas.new', 'project.open', 'import.figma', 'help.shortcuts']);
    const rows = startRows([
      { id: 'noise', name: 'Noise' },
      { actionId: 'help.shortcuts', name: 'Keyboard shortcuts', keys: '?', icon: 'help', run: 1 },
      { actionId: 'canvas.new', name: 'New canvas', keys: '⌘N', run: 2 },
      { actionId: 'import.figma', name: 'Import from Figma…', keys: '' },
      { actionId: 'project.open', name: 'Open project…', keys: '⌘O', runnable: () => true },
    ]);
    expect(rows.map((r: { name: string }) => r.name)).toEqual([
      'New canvas',
      'Open project…',
      'Import from Figma…',
      'Keyboard shortcuts',
    ]);
    expect(rows.map((r: { keys: string }) => r.keys)).toEqual(['⌘N', '⌘O', '', '?']);
    expect(rows.every((r: { heading: string }) => r.heading === 'Start here')).toBe(true);
  });

  test('a row nothing can run here (Open project… in a browser tab) is not offered', () => {
    const rows = startRows([
      { actionId: 'canvas.new', name: 'New canvas' },
      { actionId: 'project.open', name: 'Open project…', runnable: () => false },
    ]);
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['New canvas']);
  });
});

describe('Recent: the canvases opened on this Mac, newest first', () => {
  const opened = {
    'ui/2026/combine/Combine-kampan.tsx': 300,
    'ui/Homepage.tsx': 500,
    'ui/Pricing.tsx': 100,
    'ui/a.tsx': 50,
    'ui/b.tsx': 40,
    'ui/c.tsx': 30,
  };

  test('newest first, capped, each opens by designRoot-relative path', () => {
    const rows = recentRows(opened, { designRel: '.design' });
    expect(rows.length).toBe(RECENT_CAP);
    expect(rows.slice(0, 3).map((r: { name: string }) => r.name)).toEqual([
      'Homepage',
      'Combine-kampan',
      'Pricing',
    ]);
    expect(rows[1]).toMatchObject({
      group: 'canvases',
      meta: 'ui/2026/combine',
      path: '.design/ui/2026/combine/Combine-kampan.tsx',
      artboardId: null,
      heading: 'Recent',
    });
  });

  test('"known empty" is only an ANSWER of no canvases; an error or an old server is "don’t know"', async () => {
    const answer = (status: number, body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await fetchRecents({ fetchImpl: answer(200, { pins: [], opened: {} }) })).toEqual({
      known: true,
      opened: {},
    });
    expect(
      (
        await fetchRecents({
          fetchImpl: answer(200, { pins: [], opened: { 'ui/A.tsx': 5, x: 'no' } }),
        })
      ).opened
    ).toEqual({ 'ui/A.tsx': 5 });
    expect((await fetchRecents({ fetchImpl: answer(404, {}) })).known).toBe(false);
    expect((await fetchRecents({ fetchImpl: answer(200, { pins: [] }) })).known).toBe(false);
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await fetchRecents({ fetchImpl: down })).known).toBe(false);
  });
});
