// S7.13 — linked formats are derived, never stored (S7-slices Q4): video artboards that mount one comp share a cut,
// "Make an unlinked copy" forks it, and the Formats list is built from the canvas source alone. The sources here are
// made by the real ops (video.format.add / video.format.unlink), so the derivation reads exactly what they write.

import { describe, expect, test } from 'bun:test';

import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import {
  FORMAT_PRESETS,
  linkedFormats,
  linkGroups,
  unlinkedBase,
} from '../video/linked-formats.ts';

const FILE = 'ui/Recap.tsx';
const BASE = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { Sequence } from 'remotion';",
  'const Recap = () => (',
  '  <Sequence name="one" durationInFrames={90}><div>hi</div></Sequence>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reels" label="Recap · Reels · 0:03" kind="video" width={1080} height={1920}><VideoComp component={Recap} durationInFrames={90} fps={30} width={1080} height={1920} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

function run(source: string, op: string, params: Record<string, unknown>): string {
  const o = EDIT_OPS.find((x) => x.id === op);
  if (!o) throw new Error(`no op ${op}`);
  return o.apply(source, { file: FILE, op, targets: [], params }).source;
}

const add = (s: string, w: number, h: number, artboard = 'reels') =>
  run(s, 'video.format.add', { artboard, width: w, height: h });

describe('the pure core', () => {
  test('artboards that share a comp are a group, in the order first seen; a lone comp is not', () => {
    const g = linkGroups([
      { id: 'a', comp: 'Recap' },
      { id: 'b', comp: 'Hype' },
      { id: 'c', comp: 'Recap' },
      { id: 'd', comp: null },
      { id: 'e', comp: 'Recap' },
    ]);
    expect(g).toEqual([{ comp: 'Recap', ids: ['a', 'c', 'e'] }]);
  });

  test('on the canvas the key is the component function itself', () => {
    const A = () => null;
    const B = () => null;
    const g = linkGroups([
      { id: 'x', comp: A },
      { id: 'y', comp: A },
      { id: 'z', comp: B },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]?.comp).toBe(A);
    expect(g[0]?.ids).toEqual(['x', 'y']);
  });

  test('a fork is named <Comp>Unlinked[N]; nothing else is one', () => {
    expect(unlinkedBase('RecapUnlinked')).toBe('Recap');
    expect(unlinkedBase('RecapUnlinked2')).toBe('Recap');
    expect(unlinkedBase('Recap')).toBeNull();
    expect(unlinkedBase('Unlinked')).toBeNull();
    expect(unlinkedBase(null)).toBeNull();
  });
});

describe('the Formats list of a source', () => {
  test('a lone video: itself, nothing to unlink, three other formats on offer', () => {
    const r = linkedFormats(FILE, BASE, 'reels');
    expect(r?.comp).toBe('Recap');
    expect(r?.formats.map((f) => [f.artboardId, f.name, f.size, f.current])).toEqual([
      ['reels', 'Reels 9:16', '1080 × 1920', true],
    ]);
    expect(r?.canUnlink).toBe(false);
    expect(r?.free.map((p) => p.name)).toEqual(['16:9', '1:1', '4:5']);
  });

  test('+ Add a format: the new 16:9 is linked, listed after "this one", and no longer on offer', () => {
    const src = add(BASE, 1920, 1080);
    const r = linkedFormats(FILE, src, 'reels');
    expect(r?.formats.map((f) => [f.artboardId, f.name, f.size, f.current, f.linked])).toEqual([
      ['reels', 'Reels 9:16', '1080 × 1920', true, true],
      ['reels-16x9', '16:9', '1920 × 1080', false, true],
    ]);
    expect(r?.canUnlink).toBe(true);
    expect(r?.free.map((p) => p.name)).toEqual(['1:1', '4:5']);
    // asked from the other artboard: the same cut, the other one is "this one"
    const other = linkedFormats(FILE, src, 'reels-16x9');
    expect(other?.formats.map((f) => [f.artboardId, f.current])).toEqual([
      ['reels', false],
      ['reels-16x9', true],
    ]);
  });

  test('three formats share the cut (the canvas’s "Shared by 3 formats")', () => {
    let src = add(BASE, 1920, 1080);
    src = add(src, 1080, 1080);
    const r = linkedFormats(FILE, src, 'reels');
    expect(r?.formats.map((f) => f.aspect)).toEqual(['9:16', '1:1', '16:9']);
    expect(r?.formats.every((f) => f.linked)).toBe(true);
  });

  test('Make an unlinked copy: the fork leaves the group and is listed as a copy of the cut it came from', () => {
    let src = add(BASE, 1920, 1080);
    src = run(src, 'video.format.unlink', { artboard: 'reels-16x9' });
    const r = linkedFormats(FILE, src, 'reels');
    expect(r?.formats.map((f) => f.artboardId)).toEqual(['reels']);
    expect(r?.copies.map((f) => [f.artboardId, f.unlinkedCopy, f.linked])).toEqual([
      ['reels-16x9', true, false],
    ]);
    expect(r?.canUnlink).toBe(false);
    // the copy knows where it came from, and has nothing to unlink any more
    const copy = linkedFormats(FILE, src, 'reels-16x9');
    expect(copy?.unlinkedFrom).toBe('Recap');
    expect(copy?.comp).toBe('RecapUnlinked');
    expect(copy?.canUnlink).toBe(false);
    // the 16:9 aspect is free again for the original cut
    expect(r?.free.map((p) => p.name)).toContain('16:9');
  });

  test('a source that does not parse, or an artboard that is not a video, answers null', () => {
    expect(linkedFormats(FILE, 'export default function (', 'reels')).toBeNull();
    expect(linkedFormats(FILE, BASE, 'nope')).toBeNull();
  });

  test('the presets are the catalogue’s three video rows and the feed post', () => {
    expect(FORMAT_PRESETS.map((p) => [p.name, p.w, p.h])).toEqual([
      ['Reels 9:16', 1080, 1920],
      ['16:9', 1920, 1080],
      ['1:1', 1080, 1080],
      ['4:5', 1080, 1350],
    ]);
  });
});
