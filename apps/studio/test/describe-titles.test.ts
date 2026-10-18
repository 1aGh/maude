// Row titles and collapsing (V2-1.9 §5.5.3, §5.5.4, S1.10) + the attribution-cache entry per
// `(actionId, canvas)` (§5.5.5, beside V2-1.17's extractor). CONTRACT §3–§4 voice: curly quotes, no
// "we", counts with the real noun, times as "6 Oct, 14:05".

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Change } from '../history/describe';
import { collapseChanges, rowTitle, wordsTitle } from '../history/titles';
import { createAttributionCache } from '../index/extractors/attribution-cache';

const ch = (
  kind: Change['kind'],
  words: string,
  artboards: string[] = ['home'],
  extra: Partial<Change> = {}
): Change => ({ artboards, grade: 'W1', kind, words, ...extra });

const labelOf = (k: string) => ({ home: 'Homepage', pricing: 'Pricing' })[k] ?? k;

describe('words title (the edit row)', () => {
  test('the first W1 change of the primary artboard by priority, + N more', () => {
    const cs = [
      ch('style', 'Frame: Fill black → white'),
      ch('text', '“Welcome back”: Text set to “Hi”'),
      ch('added', 'Button added'),
      ch('style', 'Frame: Gap 16 → 24 px', ['pricing']),
    ];
    expect(wordsTitle(cs)).toBe('Button added + 3 more');
  });

  test('priority: artboard added/removed/renamed > element added/removed > text > style/css/attr > data > other', () => {
    const order: Change[] = [
      ch('moved', 'Frame moved up'),
      ch('data', 'Plan: Price 9 → 12'),
      ch('attr', 'Image: Alt text “a” → “b”'),
      ch('css', 'Frame: Gap 8 → 4 px'),
      ch('style', 'Frame: Fill black → white'),
      ch('text', '“Hi”: Text “Hi” → “Hello”'),
      ch('removed', 'Divider removed'),
      ch('artboard-renamed', 'Artboard “A” renamed to “B”'),
    ];
    const titles: string[] = [];
    let rest = [...order];
    while (rest.length > 1) {
      titles.push(wordsTitle(rest).replace(/ \+ \d+ more$/, ''));
      const first = titles[titles.length - 1];
      rest = rest.filter((c) => c.words !== first);
    }
    expect(titles).toEqual([
      'Artboard “A” renamed to “B”',
      'Divider removed',
      '“Hi”: Text “Hi” → “Hello”',
      // style, css and attr share a rank: the first written wins
      'Image: Alt text “a” → “b”',
      'Frame: Gap 8 → 4 px',
      'Frame: Fill black → white',
      'Plan: Price 9 → 12',
    ]);
  });

  test('the primary artboard is the one with the most lines; canvas-level lines come last', () => {
    const cs = [
      ch('artboard-added', 'Artboard “Pricing” added', ['pricing']),
      ch('style', 'Frame: Fill black → white'),
      ch('style', 'Frame: Gap 16 → 24 px'),
      ch('annotation', 'Sticky added', []),
    ];
    expect(wordsTitle(cs)).toBe('Frame: Fill black → white + 3 more');
  });

  test('only fallbacks: the fallback line; nothing visible: said so', () => {
    const f: Change = {
      artboards: ['home'],
      grade: 'F',
      kind: 'layout',
      words: 'Changed layout in Homepage',
    };
    expect(wordsTitle([f])).toBe('Changed layout in Homepage');
    expect(
      wordsTitle([f, { ...f, artboards: ['pricing'], words: 'Changed layout in Pricing' }])
    ).toBe('Changed layout in Homepage + 1 more');
    expect(wordsTitle([])).toBe('No visible change');
  });

  test('a W2 line is used when there is no W1 line', () => {
    const w2: Change = { ...ch('style', 'Frame: Style changed'), grade: 'W2' };
    const f: Change = { ...ch('layout', 'Changed layout in Homepage'), grade: 'F' };
    expect(wordsTitle([f, w2])).toBe('Frame: Style changed + 1 more');
  });
});

describe('row titles (§5.5.4)', () => {
  const at = new Date(2026, 9, 5, 18, 40).getTime();
  const words = [ch('style', 'Frame: Fill black → white')];

  test('named, baseline, aside, trash', () => {
    expect(rowTitle({ kind: 'named', name: 'Before the pitch', changes: words }).title).toBe(
      'Before the pitch'
    );
    expect(rowTitle({ kind: 'baseline', changes: [] }).title).toBe('Version history starts here');
    expect(rowTitle({ kind: 'aside', actor: 'You', changes: [] }).title).toBe(
      'Your version, not kept'
    );
    expect(rowTitle({ kind: 'aside', actor: 'Jonas', changes: [] }).title).toBe(
      "Jonas's version, not kept"
    );
    expect(rowTitle({ kind: 'trash', label: 'Pricing', changes: [] }).title).toBe(
      'Moved “Pricing” to the trash'
    );
  });

  test('ai: the prompt, 60 characters at most; a canvas-only session gets the words title instead', () => {
    const prompt = 'Make the hero calmer and move the call to action under the headline please';
    const r = rowTitle({ kind: 'ai', prompt, changes: words });
    expect(r.title.length).toBeLessThanOrEqual(60);
    expect(r.title.endsWith('…')).toBe(true);
    expect(r.title.startsWith('Make the hero calmer')).toBe(true);
    expect(rowTitle({ kind: 'ai', prompt: 'Calmer hero', changes: words }).title).toBe(
      'Calmer hero'
    );
    // the prompt may name another canvas: a canvas-only session never shows it
    const scoped = rowTitle({
      kind: 'ai',
      prompt: 'Copy the Pricing table into this canvas',
      scope: 'canvas-only',
      changes: words,
    });
    expect(scoped.title).toBe('Frame: Fill black → white');
    expect(scoped.title).not.toContain('Pricing');
  });

  test('restore: the name, or the time; plus the one artboard', () => {
    expect(
      rowTitle({ kind: 'restore', restored: { name: 'Before the pitch' }, changes: [] }).title
    ).toBe('Restored “Before the pitch”');
    expect(rowTitle({ kind: 'restore', restored: { at }, changes: [] }).title).toBe(
      'Restored 5 Oct, 18:40'
    );
    expect(
      rowTitle({ kind: 'restore', restored: { at, onlyArtboard: 'Pricing' }, changes: [] }).title
    ).toBe('Restored 5 Oct, 18:40 — only Pricing');
    expect(
      rowTitle({
        kind: 'restore',
        restored: { name: 'Before the pitch', onlyArtboard: 'Pricing' },
        changes: [],
      }).title
    ).toBe('Restored “Before the pitch” — only Pricing');
  });

  test('undo: the undone title, or a chat with its change count', () => {
    expect(rowTitle({ kind: 'undo', undid: { title: 'Calmer hero' }, changes: [] }).title).toBe(
      'Undid “Calmer hero”'
    );
    expect(rowTitle({ kind: 'undo', undid: { chat: true, changes: 3 }, changes: [] }).title).toBe(
      'Undid a chat — 3 changes'
    );
    expect(rowTitle({ kind: 'undo', undid: { chat: true, changes: 1 }, changes: [] }).title).toBe(
      'Undid a chat — 1 change'
    );
  });

  test('outside: the words title, with the sub', () => {
    expect(rowTitle({ kind: 'outside', changes: words })).toEqual({
      title: 'Frame: Fill black → white',
      sub: '· changed outside Maude',
    });
  });

  test('edit: the words title', () => {
    expect(rowTitle({ kind: 'edit', changes: words }).title).toBe('Frame: Fill black → white');
    expect(rowTitle({ kind: 'edit', changes: [] }).title).toBe('No visible change');
  });

  test('no title carries a straight quote, a backtick, or a "we"', () => {
    const all = [
      rowTitle({ kind: 'named', name: 'Pitch', changes: [] }).title,
      rowTitle({ kind: 'restore', restored: { name: 'Pitch' }, changes: [] }).title,
      rowTitle({ kind: 'undo', undid: { title: 'Pitch' }, changes: [] }).title,
      rowTitle({ kind: 'trash', label: 'Pitch', changes: [] }).title,
    ];
    for (const t of all) {
      expect(t).not.toMatch(/["`]/);
      expect(t).not.toMatch(/\bwe\b/i);
    }
  });
});

describe('collapsing (§5.5.3)', () => {
  const many = (n: number, artboard = 'home') =>
    Array.from({ length: n }, (_, i) =>
      ch('style', `Frame ${i}: Gap ${i} → ${i + 1} px`, [artboard])
    );

  test('12 lines stay, 13 become one "Reworked …" line, the originals kept for Compare', () => {
    const twelve = collapseChanges(many(12), { labelOf });
    expect(twelve.changes).toHaveLength(12);
    expect(twelve.detail.size).toBe(0);
    const thirteen = collapseChanges(many(13), { labelOf });
    expect(thirteen.changes.map((c) => [c.artboards, c.grade, c.words])).toEqual([
      [['home'], 'W1', 'Reworked Homepage — 13 changes'],
    ]);
    expect(thirteen.detail.get('home')).toHaveLength(13);
  });

  test('only the busy artboard collapses; the order of the rest is kept', () => {
    const cs = [
      ch('artboard-added', 'Artboard “Pricing” added', ['pricing']),
      ...many(14),
      ch('annotation', 'Sticky added', []),
    ];
    const r = collapseChanges(cs, { labelOf });
    expect(r.changes.map((c) => c.words)).toEqual([
      'Artboard “Pricing” added',
      'Reworked Homepage — 14 changes',
      'Sticky added',
    ]);
  });

  test('more than half the elements added or removed collapses even when the lines are few', () => {
    const cs = [
      ch('added', 'Section added', ['home'], { weight: 9 }),
      ch('removed', 'Footer removed', ['home'], { weight: 3 }),
    ];
    const kept = collapseChanges(cs, { labelOf, elementCount: () => 40 });
    expect(kept.changes).toHaveLength(2);
    const reworked = collapseChanges(cs, { labelOf, elementCount: () => 14 });
    expect(reworked.changes.map((c) => c.words)).toEqual(['Reworked Homepage — 2 changes']);
  });

  test('a line shared by two artboards is kept while another artboard still shows it', () => {
    const shared = ch('style', 'Frame: Width 120 → 150 px', ['home', 'pricing']);
    const r = collapseChanges([shared, ...many(13)], { labelOf });
    expect(r.changes.map((c) => c.words)).toEqual([
      'Frame: Width 120 → 150 px',
      'Reworked Homepage — 14 changes',
    ]);
  });

  test('the title of a collapsed version is the rework line', () => {
    const r = collapseChanges(many(20), { labelOf });
    expect(wordsTitle(r.changes)).toBe('Reworked Homepage — 20 changes');
  });
});

describe('attribution cache — one entry per (actionId, canvas)', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'attr-cache-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const changes = [ch('style', 'Frame: Fill black → white')];

  test('computes once, then reads; a new instance reads the disk', () => {
    const dir = tmp();
    let calls = 0;
    const compute = () => {
      calls++;
      return { changes, detail: {}, ms: 3 };
    };
    const a = createAttributionCache({ dir });
    expect(a.get('act_1', 'ui/home.tsx')).toBeUndefined();
    expect(a.getOrCompute('act_1', 'ui/home.tsx', compute).changes).toEqual(changes);
    a.getOrCompute('act_1', 'ui/home.tsx', compute);
    expect(calls).toBe(1);
    const b = createAttributionCache({ dir });
    expect(b.get('act_1', 'ui/home.tsx')?.changes).toEqual(changes);
    // another canvas of the same action is its own entry
    b.getOrCompute('act_1', 'ui/pricing.tsx', compute);
    expect(calls).toBe(2);
    expect(createAttributionCache({ dir }).get('act_1', 'ui/home.tsx')).toBeDefined();
  });

  test('a corrupt or foreign file, or an older describer, is a miss that recomputes', () => {
    const dir = tmp();
    const a = createAttributionCache({ dir });
    a.set('act_2', 'ui/home.tsx', { changes, detail: {}, ms: 1 });
    const file = readdirSync(dir).find((f) => f.includes('act_2')) as string;
    writeFileSync(join(dir, file), '{"nope":');
    expect(createAttributionCache({ dir }).get('act_2', 'ui/home.tsx')).toBeUndefined();
    writeFileSync(
      join(dir, file),
      JSON.stringify({ format: 'maude.attribution-cache', v: 1, describer: -1, canvases: {} })
    );
    expect(createAttributionCache({ dir }).get('act_2', 'ui/home.tsx')).toBeUndefined();
    const raw = JSON.parse(
      (() => {
        const c = createAttributionCache({ dir });
        c.set('act_2', 'ui/home.tsx', { changes, detail: {}, ms: 1 });
        return readFileSync(join(dir, file), 'utf8');
      })()
    );
    expect(raw.format).toBe('maude.attribution-cache');
    expect(Object.keys(raw.canvases)).toEqual(['ui/home.tsx']);
  });

  test('an action id can never leave the cache directory', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'x'), { recursive: true });
    const c = createAttributionCache({ dir: join(dir, 'x') });
    c.set('../../escape', 'ui/home.tsx', { changes, detail: {}, ms: 1 });
    c.set('a/b\\c', 'ui/home.tsx', { changes, detail: {}, ms: 1 });
    expect(readdirSync(dir).sort()).toEqual(['x']);
    expect(readdirSync(join(dir, 'x')).every((f) => /^[\w.-]+$/.test(f))).toBe(true);
    expect(c.get('../../escape', 'ui/home.tsx')?.changes).toEqual(changes);
  });

  test('forget drops the entry, an actionId entry holds each canvas apart', () => {
    const dir = tmp();
    const c = createAttributionCache({ dir });
    c.set('act_3', 'ui/home.tsx', { changes, detail: {}, ms: 1 });
    c.set('act_3', 'ui/pricing.tsx', { changes: [], detail: {}, ms: 1 });
    expect(c.get('act_3', 'ui/pricing.tsx')?.changes).toEqual([]);
    c.forget('act_3');
    expect(createAttributionCache({ dir }).get('act_3', 'ui/home.tsx')).toBeUndefined();
  });
});
