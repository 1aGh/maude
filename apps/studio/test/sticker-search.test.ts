// S4.3 — the Stickers gallery's pure model: pack order (CONTRACT C13), keyword search across the four
// bundled packs and the vote stamps, chips, the empty state, Recent. Real manifests, no fixtures.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAMPS } from '../client/v2/annotations/stamps-glyphs.jsx';
import {
  orderPacks,
  packDisplayName,
  pushRecent,
  resolveRecent,
  searchStickers,
} from '../client/v2/annotations/sticker-search.js';

const DIR = join(import.meta.dir, '..', 'stickers');
// the API's shape (api.listStickers): slug-sorted, manifest names as written
const PACKS = readdirSync(DIR)
  .sort()
  .map((slug) => {
    const m = JSON.parse(readFileSync(join(DIR, slug, 'manifest.json'), 'utf8'));
    return {
      slug,
      name: m.name,
      author: m.author,
      attributionUrl: m.attributionUrl,
      stickers: m.stickers.map((s: any) => ({ ...s, url: `/_stickers/${slug}/${s.file}` })),
    };
  });
const ORDERED = orderPacks(PACKS);

describe('pack order and names (CONTRACT C13)', () => {
  test('FigJam Doodle · Life Style · Opposing Thoughts · Project status, names trimmed', () => {
    expect(ORDERED.map((p: any) => p.name)).toEqual([
      'FigJam Doodle',
      'Life Style',
      'Opposing Thoughts',
      'Project status',
    ]);
    expect(packDisplayName({ name: 'Project status stickers' })).toBe('Project status');
  });

  test('an unknown pack goes last', () => {
    const extra = { slug: 'zzz', name: 'Zed Stickers', stickers: [] };
    expect(orderPacks([extra, ...PACKS]).at(-1)?.slug).toBe('zzz');
  });
});

describe('search "done"', () => {
  const r = searchStickers(ORDERED, STAMPS, 'done');

  test('six of 80 in Project status; nothing else says done', () => {
    expect(r.empty).toBe(false);
    expect(r.packs).toHaveLength(1);
    expect(r.packs[0]).toMatchObject({ slug: 'project-status', name: 'Project status', total: 80 });
    expect(r.packs[0].stickers).toHaveLength(6);
    expect(r.count).toBe(6);
    expect(r.missing).toEqual(['FigJam Doodle', 'Life Style', 'Opposing Thoughts']);
    expect(r.stamps).toEqual([]);
  });

  test('the words that matched become chips, with counts', () => {
    expect(r.chips[0]).toEqual({ word: 'done', count: 4 });
    expect(r.chips[1]).toEqual({ word: 'almost-done', count: 2 });
    expect(r.chips.length).toBeLessThanOrEqual(4);
  });

  test('a chip narrows to the stickers that carry that word; the pack total stays', () => {
    const c = searchStickers(ORDERED, STAMPS, 'done', 'almost-done');
    expect(c.packs[0].stickers).toHaveLength(2);
    expect(c.count).toBe(2);
    expect(c.packs[0].total).toBe(80);
    expect(c.chips[0].word).toBe('done'); // the chip row does not collapse when one is picked
  });

  test('each hit carries the word that matched, for its label', () => {
    expect(r.packs[0].stickers.map((s: any) => s.word)).toContain('almost-done');
    expect(r.packs[0].stickers[0].pack).toBe('project-status');
    expect(r.packs[0].stickers[0].id).toBe(r.packs[0].stickers[0].file);
  });

  test('file names are not searched (the words are the contract)', () => {
    expect(searchStickers(ORDERED, STAMPS, 'group-46').empty).toBe(true);
  });
});

describe('the empty state', () => {
  test('"hotovo" finds nothing and suggests English words', () => {
    const r = searchStickers(ORDERED, STAMPS, 'hotovo');
    expect(r.empty).toBe(true);
    expect(r.suggest).toEqual(['done', 'finished', 'approved']);
    expect(r.query).toBe('hotovo');
  });

  test('a blank query is browse mode, not a search', () => {
    expect(searchStickers(ORDERED, STAMPS, '   ')).toBeNull();
    expect(searchStickers(ORDERED, STAMPS, '')).toBeNull();
  });
});

describe('stamps are searchable', () => {
  test('"+1" finds the +1 stamp', () => {
    const r = searchStickers(ORDERED, STAMPS, '+1');
    expect(r.stamps.map((s: any) => s.id)).toEqual(['plus']);
    expect(r.empty).toBe(false);
  });

  test('"yes" finds the Yes stamp and the FigJam Doodle yes sticker together', () => {
    const r = searchStickers(ORDERED, STAMPS, 'yes');
    expect(r.stamps.map((s: any) => s.id)).toContain('yes');
    expect(r.packs.map((p: any) => p.slug)).toContain('figjam-doodle');
  });

  test('"star" finds the Star stamp', () => {
    expect(searchStickers(ORDERED, STAMPS, 'star').stamps.map((s: any) => s.id)).toEqual(['star']);
  });
});

describe('Recent', () => {
  const A = { pack: 'project-status', id: 'group-51.png' };
  const B = { pack: 'figjam-doodle', id: 'slice1.png' };

  test('newest first, de-duplicated, capped at 12', () => {
    let list = pushRecent([], A);
    list = pushRecent(list, B);
    list = pushRecent(list, A);
    expect(list).toEqual([A, B]);
    for (let i = 0; i < 20; i++) list = pushRecent(list, { pack: 'p', id: `${i}.png` });
    expect(list).toHaveLength(12);
    expect(list[0].id).toBe('19.png');
  });

  test('resolved against the live catalogue; a removed sticker drops out', () => {
    const r = resolveRecent(ORDERED, [A, { pack: 'gone', id: 'x.png' }, B]);
    expect(r.map((s: any) => s.id)).toEqual(['group-51.png', 'slice1.png']);
    expect(r[0].url).toContain('/project-status/group-51.png');
  });

  test('garbage in storage is ignored', () => {
    expect(resolveRecent(ORDERED, [null, 1, 'x', {}, { pack: 1 }] as any)).toEqual([]);
  });
});
