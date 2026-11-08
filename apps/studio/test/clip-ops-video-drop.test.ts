// clip-ops-video-drop.test.ts — #128 §4 (T3.5): a video dropped into a fresh brief-board `kind="video"` artboard
// used to land as a SIBLING after the board's full-size placeholder (pushed out of the fixed artboard, nothing
// visible), at the source's pixel size, with the comp's 150-frame default length.

import { describe, expect, test } from 'bun:test';

import { applyInsertClipAt } from '../clip-ops.ts';

const BRIEF_BOARD = [
  'import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";',
  '',
  'export default function Reel() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCSection id="brief-board" title="Brief">',
  '        <DCArtboard kind="video" id="brief" label="Brief" width={1080} height={1900}>',
  '          <div',
  '            style={{ width: "100%", height: "100%", display: "flex", border: "1.5px dashed #d4d8dd" }}',
  '          >',
  '            <div style={{ fontSize: "22px" }}>Reel</div>',
  '            <div>Add sticky notes here.</div>',
  '          </div>',
  '        </DCArtboard>',
  '      </DCSection>',
  '    </DesignCanvas>',
  '  );',
  '}',
].join('\n');

const drop = (source: string, durationInFrames = 1255) =>
  applyInsertClipAt('/abs/Reel.tsx', source, undefined, {
    lane: 'storyline',
    durationInFrames,
    mediaTag: 'Video',
    src: 'assets/clip.mp4',
  });

describe('video drop into a kind="video" artboard (#128 §4)', () => {
  test('the full-size placeholder is replaced, not left beside the comp', () => {
    const r = drop(BRIEF_BOARD);
    expect(r.source).not.toContain('Add sticky notes here.');
    expect(r.source).toContain('<VideoComp component={VideoCut}');
    const board = r.source.slice(
      r.source.indexOf('<DCArtboard'),
      r.source.indexOf('</DCArtboard>')
    );
    expect(board.match(/<VideoComp/g)?.length).toBe(1);
    expect(board).not.toContain('<div');
  });

  test('the clip fills the artboard and carries the objectFit PROP, not a pixel size', () => {
    const r = drop(BRIEF_BOARD);
    expect(r.source).toMatch(/<Video[^>]*\bobjectFit="cover"/);
    expect(r.source).toMatch(/<Video[^>]*style=\{\{ width: '100%', height: '100%' \}\}/);
    expect(r.source).not.toMatch(/<Video[^>]*\d+px/);
  });

  test('the comp length follows the clip (no stale 150 frames)', () => {
    const r = drop(BRIEF_BOARD, 1255);
    expect(r.source).toMatch(/<VideoComp[^>]*durationInFrames=\{1255\}/);
    expect(r.source).toMatch(/<TransitionSeries\.Sequence[^>]*durationInFrames=\{1255\}/);
    expect(r.source).not.toContain('durationInFrames={150}');
  });

  test('a full-size root that holds a real design is NOT taken for the placeholder', () => {
    const real = BRIEF_BOARD.replace(
      '<div style={{ fontSize: "22px" }}>Reel</div>',
      '<img src="assets/logo.png" alt="" />'
    );
    const r = drop(real);
    expect(r.source).toContain('assets/logo.png');
    expect(r.source).toContain('<VideoComp component={VideoCut}');
  });
});
