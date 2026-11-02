// S1.4 — the shared matcher (index/match.ts): a number is not a typo, and the marks the ⌘K rows draw.
import { describe, expect, test } from 'bun:test';
import { match, scoreRow, words } from '../index/match.ts';

const row = (name: string, meta = '') => ({ key: name, name, meta });
const hit = (name: string, meta: string, q: string) => scoreRow(row(name, meta), words(q));
const slice = (s: string, r: [number, number][]) => r.map(([a, b]) => s.slice(a, b));

describe('a word with a digit is a number, not a spelling (S1.3 follow-up)', () => {
  test('"2023" does not find 2026, in the name or the meta', () => {
    expect(hit('Combine-letak-2026', '', 'letak 2023')).toBeNull();
    expect(hit('Letak', '2026/combine', 'letak 2023')).toBeNull();
    expect(match([row('uniformy-2026-stare')], 'uniformy 2027')).toEqual([]);
  });

  test('the exact number still finds it, and a letter-only typo still does', () => {
    expect(hit('Combine-letak-2026', '', 'letak 2026')).not.toBeNull();
    expect(hit('Uniformy-2027', '', 'unifromy 2027')?.close).toBe(true);
    // "a6" has a digit: never a typo target either
    expect(hit('LetakA7', '', 'letak a6')).toBeNull();
  });

  test('a word that mixes letters and digits is also exact-only', () => {
    expect(hit('Sheet-v12', '', 'sheet v13')).toBeNull();
    expect(hit('Sheet-v12', '', 'sheet v12')).not.toBeNull();
    expect(hit('Sheet-v1234', '', 'sheet v1235')).toBeNull();
  });
});

describe('marks: where each word matched', () => {
  test('exact words mark the name; a word found in the meta marks the meta (accents mapped back)', () => {
    const h = hit('A · přední FLAG', 'artboard in LetakA6 · print', 'letak a6 predni');
    expect(slice('A · přední FLAG', h?.marks ?? [])).toEqual(['přední']);
    expect(slice('artboard in LetakA6 · print', h?.metaMarks ?? [])).toEqual(['LetakA6']);
  });

  test('a typo marks the token it stood for — in the name, or in the meta', () => {
    const inName = hit('Uniformy-2027', 'Alligators brand', 'unifromy');
    expect(inName?.marks).toEqual([]);
    expect(slice('Uniformy-2027', inName?.closeMarks ?? [])).toEqual(['Uniformy']);
    const inMeta = hit('Domácí dres 2027', 'artboard in Uniformy-2027', 'unifromy 2027');
    expect(slice('artboard in Uniformy-2027', inMeta?.metaMarks ?? [])).toEqual(['Uniformy']);
    expect(slice('Domácí dres 2027', inMeta?.marks ?? [])).toEqual(['2027']);
  });

  test('marks stay exact-only: a close match never adds to `marks` (the panel reads that)', () => {
    expect(hit('Pricing', '', 'pricng')?.marks).toEqual([]);
  });
});

describe('weak: every word of the query was a typo', () => {
  test('one exact word makes a row strong; none makes it weak', () => {
    expect(hit('Uniformy-2027', '', 'unifromy 2027')?.weak).toBe(false);
    expect(hit('Uniformy-2027', '', 'unifromy')?.weak).toBe(true);
    expect(hit('Pricing', '', 'pricing')?.weak).toBe(false);
    expect(hit('Pricing', 'Studio site', 'studio')?.weak).toBe(false);
  });
});
