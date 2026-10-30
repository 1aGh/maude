// S7.22 (R2) — `safeZones="…"` is one more JSX string prop. A Maude 1.x peer that opens a canvas carrying it:
//   * draws the artboard as it always did — v1.9.1's DCArtboard destructures a closed prop list with no rest
//     spread, so an unknown prop reaches neither the DOM nor the render (frozen excerpt below, verbatim from the tag);
//   * keeps the prop byte for byte through every v1 artboard writer (resize, kind, label, hug, style, guides,
//     print, an element edit), because those parse the TSX and change only what they were asked to.
// Versioned files never break a v1 peer (V2-1.12 R1–R3).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyEdit,
  applyResizeArtboard,
  applySetArtboardGuides,
  applySetArtboardHug,
  applySetArtboardKind,
  applySetArtboardLabel,
  applySetArtboardPrint,
  applySetArtboardStyle,
  applyTextEdit,
  listElements,
} from '../canvas-edit.ts';

const CANVAS = '/x/Story.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Story() {
  return (
    <DesignCanvas>
      <DCArtboard id="reels" label="Reels" width={1080} height={1920} fixed safeZones="instagram-reels">
        <p data-cd-id="tickets" className="t">Vstupenky na webu</p>
      </DCArtboard>
      <DCArtboard id="post" label="Post" width={1080} height={1080} safeZones="instagram-grid">
        <p>Hi</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const zones = (s: string) => [...s.matchAll(/safeZones="([^"]*)"/g)].map((m) => m[1]);

describe('a v1 DCArtboard ignores the prop', () => {
  const frozen = readFileSync(
    join(import.meta.dir, 'fixtures', 'v1', 'dcartboard-props.v1.9.1.txt'),
    'utf8'
  );
  const destructure = frozen.slice(0, frozen.indexOf('}: {'));

  test('v1.9.1 destructures a closed list that does not include safeZones, with no rest spread', () => {
    expect(destructure).toContain('guides,');
    expect(destructure).toContain('print,');
    expect(destructure).not.toContain('safeZones');
    expect(destructure).not.toContain('...');
  });

  test('and stamps no attribute from it: the read-back list is the same closed set', () => {
    expect(frozen).not.toContain('safeZones');
    expect(frozen).not.toContain('safe-zones');
  });
});

describe('v1 writers leave the prop alone', () => {
  const before = zones(SRC);

  test('an element style write', () => {
    const out = applyEdit(CANVAS, SRC, 'tickets', 'style.color', "'red'").source;
    expect(out).not.toBe(SRC);
    expect(zones(out)).toEqual(before);
  });

  test('a text write', () => {
    const out = applyTextEdit(CANVAS, SRC, 'tickets', 'Vstupenky online').source;
    expect(out).not.toBe(SRC);
    expect(zones(out)).toEqual(before);
  });

  test('resize, hug, label, kind, style', () => {
    expect(zones(applyResizeArtboard(CANVAS, SRC, 'reels', 540, 960).source)).toEqual(before);
    expect(zones(applySetArtboardHug(CANVAS, SRC, 'post', true).source)).toEqual(before);
    expect(zones(applySetArtboardLabel(CANVAS, SRC, 'reels', 'Reels 2').source)).toEqual(before);
    expect(zones(applySetArtboardKind(CANVAS, SRC, 'reels', 'video').source)).toEqual(before);
    expect(
      zones(applySetArtboardStyle(CANVAS, SRC, 'reels', { background: 'red' }).source)
    ).toEqual(before);
  });

  test('guides and print (the object-valued props)', () => {
    expect(
      zones(applySetArtboardGuides(CANVAS, SRC, 'reels', { grid: { size: 40 } }).source)
    ).toEqual(before);
    expect(zones(applySetArtboardPrint(CANVAS, SRC, 'post', { paper: 'a6' }).source)).toEqual(
      before
    );
  });

  test('the element listing still finds every element', () => {
    const els = listElements(CANVAS, SRC);
    expect(els.some((e) => e.id === 'tickets')).toBe(true);
  });
});
