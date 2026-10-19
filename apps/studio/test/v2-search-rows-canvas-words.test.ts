// S1.23 G6 — ⌘K rows the way 11 · pn-k-close draws them:
//   a canvas   "Alligators brand · 2026/dresy · 12 artboards" and its picture (not "ui/2026/dresy" and an icon)
//   an artboard of a print kind   "artboard in LetakA6 · print"
import { describe, expect, test } from 'bun:test';
import { remoteRows } from '../client/v2/search/search-model.js';

const KEY = 'a'.repeat(64);
const row = (o: Record<string, unknown>) => ({
  group: 'canvases',
  key: 'ui/2026/dresy/Uniformy-2027.tsx',
  name: 'Uniformy-2027',
  meta: 'ui/2026/dresy',
  score: 4,
  close: false,
  marks: [],
  ...o,
});

describe('a canvas row', () => {
  test('reads "<project> · <folder without the group> · N artboards" and carries its picture', () => {
    const [r] = remoteRows({ rows: [row({ boards: 12, cover: KEY })] } as never, {
      project: 'Alligators brand',
    });
    expect(r.meta).toBe('Alligators brand · 2026/dresy · 12 artboards');
    expect(r.thumb).toBe(`/_api/thumb/${KEY}`);
  });

  test('a canvas straight in the group has no folder part; one artboard is "1 artboard"', () => {
    const [r] = remoteRows(
      { rows: [row({ key: 'ui/Home.tsx', name: 'Home', meta: 'ui', boards: 1 })] } as never,
      { project: 'Studio site' }
    );
    expect(r.meta).toBe('Studio site · 1 artboard');
  });

  test('parts the answer does not have are left out; no cover → no picture (the icon stays)', () => {
    const [r] = remoteRows({ rows: [row({})] } as never, {});
    expect(r.meta).toBe('2026/dresy');
    expect(r.thumb).toBeNull();
    expect(r.icon).toBe('file');
  });

  test('a cover that is not a picture key is not turned into an address', () => {
    const [r] = remoteRows({ rows: [row({ cover: '../../etc/passwd' })] } as never, {});
    expect(r.thumb).toBeNull();
  });

  test('a design-system specimen keeps its own line', () => {
    const [r] = remoteRows(
      {
        rows: [
          row({
            key: 'system/maude-v2/preview/button.tsx',
            meta: 'system/maude-v2/preview',
            boards: 3,
          }),
        ],
      } as never,
      { project: 'Alligators brand' }
    );
    expect(r.meta).toBe('Design system · maude-v2 · preview');
  });
});

describe('an artboard row', () => {
  const board = (kind: string | null | undefined) =>
    row({
      group: 'artboards',
      key: 'ui/2026/LetakA6.tsx#front',
      name: 'A · přední FLAG',
      meta: 'LetakA6 2026 print',
      ...(kind === undefined ? {} : { kind }),
    });

  test('a print artboard says so', () => {
    const [r] = remoteRows({ rows: [board('print')] } as never, {});
    expect(r.meta).toBe('artboard in LetakA6 · print');
  });

  test('other kinds, and a server that does not say, keep "artboard in <canvas>"', () => {
    expect(remoteRows({ rows: [board('digital')] } as never, {})[0].meta).toBe(
      'artboard in LetakA6'
    );
    expect(remoteRows({ rows: [board(null)] } as never, {})[0].meta).toBe('artboard in LetakA6');
    expect(remoteRows({ rows: [board(undefined)] } as never, {})[0].meta).toBe(
      'artboard in LetakA6'
    );
  });
});
