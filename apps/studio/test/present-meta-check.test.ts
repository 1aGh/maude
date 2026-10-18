// S3.5 — `maude design check` on a canvas sidecar's Present ids: an id that is not an artboard of the
// canvas, and an id listed twice (check/index.ts checkPresentIds; S3-slices row S3.5).

import { describe, expect, test } from 'bun:test';

import { artboardIdsOfSource, checkFile } from '../check/index.ts';

const SRC = `export default () => (
  <DesignCanvas>
    <DCArtboard id="a" label="One" width={10} height={10} />
    <DCArtboard id="b" label="Two" width={10} height={10} />
  </DesignCanvas>
);
`;
const REL = 'ui/Deck.meta.json';
const meta = (extra: Record<string, unknown>) => JSON.stringify({ title: 'Deck', ...extra });
const codes = (r: { errors: { code: string }[]; warnings: { code: string }[] }) => ({
  errors: r.errors.map((e) => e.code),
  warnings: r.warnings.map((e) => e.code),
});

describe('Present ids in a .meta.json', () => {
  const artboards = artboardIdsOfSource('ui/Deck.tsx', SRC);

  test('the canvas source lists its literal artboard ids', () => {
    expect(artboards).toEqual({ ids: ['a', 'b'], complete: true });
    expect(
      artboardIdsOfSource('x.tsx', 'export default () => <DCArtboard id={name} />;\n')?.complete
    ).toBe(false);
    expect(artboardIdsOfSource('x.tsx', 'export default (')).toBeNull();
  });

  test('known ids are clean', () => {
    const text = meta({
      present: { order: ['b', 'a'], skip: ['a'] },
      artboardMeta: { a: { notes: 'n' } },
    });
    expect(codes(checkFile(REL, text, { artboards }))).toEqual({ errors: [], warnings: [] });
    expect(codes(checkFile(REL, text, { artboards, strict: true }))).toEqual({
      errors: [],
      warnings: [],
    });
  });

  test('an unknown id is a warning on disk and an error in a strict write that set it', () => {
    const text = meta({ present: { order: ['a', 'gone'] }, artboardMeta: { zz: { notes: 'n' } } });
    expect(codes(checkFile(REL, text, { artboards }))).toEqual({
      errors: [],
      warnings: ['present-unknown-artboard', 'present-unknown-artboard'],
    });
    expect(codes(checkFile(REL, text, { artboards, strict: true }))).toEqual({
      errors: ['present-unknown-artboard', 'present-unknown-artboard'],
      warnings: [],
    });
    // the same dangling ids, untouched by this write: not this write's fault
    expect(codes(checkFile(REL, text, { artboards, strict: true, against: text }))).toEqual({
      errors: [],
      warnings: ['present-unknown-artboard', 'present-unknown-artboard'],
    });
  });

  test('a duplicate is a warning; a strict write gets the schema error once', () => {
    const text = meta({ present: { order: ['a', 'b', 'a'] } });
    expect(codes(checkFile(REL, text, { artboards }))).toEqual({
      errors: [],
      warnings: ['present-duplicate'],
    });
    expect(codes(checkFile(REL, text, { artboards, strict: true }))).toEqual({
      errors: ['meta-invalid'],
      warnings: [],
    });
  });

  test('without the canvas (or a dynamic one) only the duplicate rule runs', () => {
    const text = meta({ present: { order: ['ghost', 'ghost'] } });
    expect(codes(checkFile(REL, text))).toEqual({ errors: [], warnings: ['present-duplicate'] });
    expect(
      codes(checkFile(REL, text, { artboards: { ids: ['a'], complete: false } })).warnings
    ).toEqual(['present-duplicate']);
  });
});
