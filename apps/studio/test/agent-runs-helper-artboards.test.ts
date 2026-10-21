// S12.16 fix — an edit inside a helper component reaches the artboards that render it (S5 journey).
//
// The S5 journey fixture (`app5`: this repo's `.design/ui/GitPanel.tsx`) wraps every artboard's
// content in helper components defined in the same file. Before, any change outside a `DCArtboard`
// span reached the whole file, so another AI's hold on one artboard blocked an edit to a helper
// only other artboards use. Soundness (S5.4, one AI per artboard): a helper shared by two
// artboards reaches BOTH, and code nothing resolves (imports, an unused helper, the canvas
// component outside its artboards) still reaches the whole file.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedArtboards } from '../agent-runs.ts';

const FIXTURE = readFileSync(
  join(import.meta.dir, '..', '..', '..', '.design', 'ui', 'GitPanel.tsx'),
  'utf8'
);
const ALL = ['changes', 'save-version', 'publish', 'empty', 'conflict'];

const edit = (src: string, from: string, to: string) => {
  expect(src.split(from).length).toBe(2); // the fixture still holds the text once
  return src.replace(from, to);
};

describe('changedArtboards — helper components (the S5 journey fixture)', () => {
  test('a shared helper (Composer) reaches every artboard that renders it, and no other', () => {
    const after = edit(FIXTURE, '>Save all</button>', '>Save everything</button>');
    expect(changedArtboards(FIXTURE, after)).toEqual({
      scope: 'artboards',
      artboards: ['changes', 'save-version'],
    });
  });

  test('a helper one artboard renders (PublishPanel) reaches that artboard only', () => {
    const after = edit(
      FIXTURE,
      'Get the latest before you publish yours.',
      'Update first, then publish.'
    );
    expect(changedArtboards(FIXTURE, after)).toEqual({
      scope: 'artboards',
      artboards: ['publish'],
    });
  });

  test('a helper every artboard reaches through another (ShellFrame → MenuBar) reaches all of them', () => {
    const after = edit(
      FIXTURE,
      '<MenuBar unsaved={unsaved} />',
      '<MenuBar unsaved={unsaved ?? 0} />'
    );
    expect(changedArtboards(FIXTURE, after)).toEqual({ scope: 'artboards', artboards: ALL });
  });

  test('an import still reaches the whole file', () => {
    const after = edit(
      FIXTURE,
      'import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";',
      'import { DesignCanvas, DCSection, DCArtboard, DCPostIt } from "@maude/canvas-lib";'
    );
    expect(changedArtboards(FIXTURE, after)).toEqual({ scope: 'file', artboards: ALL });
  });
});

describe('changedArtboards — helper resolution stays sound', () => {
  const canvas = (
    o: { a?: string; b?: string; unused?: string; pre?: string } = {}
  ) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
const LABELS = { a: '${o.a ?? 'A'}' };
function Shared() {
  return <b>${o.b ?? 'shared'}</b>;
}
function OnlyA() {
  return <i>{LABELS.a}</i>;
}
function Unused() {
  return <u>${o.unused ?? 'nobody'}</u>;
}
function ViaMap() {
  return <s>map</s>;
}
const PARTS = [ViaMap];
export default function C() {
  const pre = '${o.pre ?? 'x'}';
  return (
    <DesignCanvas>
      <DCArtboard id="a" width={10} height={10}><OnlyA /><Shared /></DCArtboard>
      <DCArtboard id="b" width={10} height={10}><Shared />{PARTS.map((P) => <P key="p" />)}</DCArtboard>
      <DCArtboard id="c" width={10} height={10}><p>{pre}</p></DCArtboard>
    </DesignCanvas>
  );
}
`;
  const base = canvas();

  test('a helper two artboards render counts both (no false free)', () => {
    expect(changedArtboards(base, canvas({ b: 'SHARED' }))).toEqual({
      scope: 'artboards',
      artboards: ['a', 'b'],
    });
  });

  test('a const reached through a helper maps to that helper’s artboards', () => {
    expect(changedArtboards(base, canvas({ a: 'AA' }))).toEqual({
      scope: 'artboards',
      artboards: ['a'],
    });
  });

  test('a helper reached through a const (PARTS) maps through it', () => {
    expect(changedArtboards(base, base.replace('<s>map</s>', '<s>MAP</s>'))).toEqual({
      scope: 'artboards',
      artboards: ['b'],
    });
  });

  test('an unused helper, or the canvas component outside its artboards, reaches the file', () => {
    expect(changedArtboards(base, canvas({ unused: 'someone' }))).toEqual({
      scope: 'file',
      artboards: ['a', 'b', 'c'],
    });
    expect(changedArtboards(base, canvas({ pre: 'y' }))).toEqual({
      scope: 'file',
      artboards: ['a', 'b', 'c'],
    });
  });

  test('a helper also used outside every artboard (by the canvas body) reaches the file', () => {
    const src = base.replace("const pre = 'x';", "const pre = 'x'; void Shared;");
    expect(changedArtboards(src, src.replace('<b>shared</b>', '<b>S</b>'))).toEqual({
      scope: 'file',
      artboards: ['a', 'b', 'c'],
    });
  });

  test('one edit spanning two neighbouring helpers reaches the union of their artboards', () => {
    const after = canvas({ b: 'S2' }).replace('<i>{LABELS.a}</i>', '<em>{LABELS.a}</em>');
    expect(changedArtboards(base, after)).toEqual({ scope: 'artboards', artboards: ['a', 'b'] });
  });
});
