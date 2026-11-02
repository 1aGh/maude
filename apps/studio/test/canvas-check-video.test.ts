// S7.5 — `maude design check` holds the comp vocabulary's shapes (V2-1.10 §5.7 lint additions,
// §5.8 B3): one <Captions> per comp, <Duck> wraps one <Audio>, <Reframe> keys sorted / in range /
// no `follow`, `fixes` a JSON literal, and the build's own `__words` / `__speech` never in a file.

import { describe, expect, test } from 'bun:test';

import { checkFile } from '../check/index.ts';

const canvas = (body: string, imports = 'Captions, DCArtboard, Duck, Place, Reframe, VideoComp') =>
  [
    `import { ${imports} } from '@maude/canvas-lib';`,
    "import { Audio, Video } from '@remotion/media';",
    'const Reel = () => (',
    '  <>',
    body,
    '  </>',
    ');',
    'export default () => (',
    '  <DCArtboard id="reel"><VideoComp component={Reel} durationInFrames={90} fps={30} /></DCArtboard>',
    ');',
  ].join('\n');

const codes = (src: string) =>
  checkFile('ui/Reel.tsx', src)
    .errors.map((e) => e.code)
    .filter((c) => c.startsWith('video-'));

const GOOD = [
  '    <Reframe focus={[[0, 0.5, 0.42], [1.5, 0.55, 0.4]]} zoom={1.2} fit="fill" formats={{ "16:9": [[0, 0.5, 0.55]] }}>',
  '      <Video src="assets/aaaaaaaa.mp4" />',
  '    </Reframe>',
  '    <Duck db={-12}>',
  '      <Audio src="assets/dddddddd.mp3" volume={0.8} />',
  '    </Duck>',
  '    <Place at={[0.5, 0.8]} formats={{ "16:9": [0.5, 0.85] }}><h1>Recap</h1></Place>',
  '    <Captions data-cd-id="captions" words="line" fixes={[{ "src": "assets/aaaaaaaa.mp4", "at": 3.45, "text": "jsem" }, { "src": "assets/aaaaaaaa.mp4", "at": 9.1, "text": null }]} />',
].join('\n');

describe('canvas-tsx: the comp vocabulary', () => {
  test('the contract shapes pass', () => {
    expect(codes(canvas(GOOD))).toEqual([]);
  });

  test('<Reframe follow> is refused (B3: following a subject is not built)', () => {
    const src = canvas(GOOD.replace('<Reframe focus', '<Reframe follow="subject-1" focus'));
    expect(codes(src)).toEqual(['video-reframe-follow']);
    const r = checkFile('ui/Reel.tsx', src);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.fix).toContain('focus');
  });

  test('a second <Captions> in the same comp', () => {
    expect(codes(canvas(`${GOOD}\n    <Captions words={3} />`))).toEqual(['video-captions-twice']);
  });

  test('<Duck> wraps exactly one <Audio>', () => {
    expect(
      codes(canvas('    <Duck db={-12}><Audio src="a.mp3" /><Audio src="b.mp3" /></Duck>'))
    ).toEqual(['video-duck-child']);
    expect(codes(canvas('    <Duck db={-12}><Video src="a.mp4" /></Duck>'))).toEqual([
      'video-duck-child',
    ]);
  });

  test('<Reframe> keys sorted, x and y in 0…1, zoom ≥ 1, fit known', () => {
    expect(
      codes(
        canvas(
          '    <Reframe focus={[[2, 0.5, 0.5], [1, 0.5, 0.5]]}><Video src="a.mp4" /></Reframe>'
        )
      )
    ).toEqual(['video-reframe-focus']);
    expect(
      codes(canvas('    <Reframe focus={[[0, 1.4, 0.5]]}><Video src="a.mp4" /></Reframe>'))
    ).toEqual(['video-reframe-focus']);
    expect(codes(canvas('    <Reframe focus={KEYS}><Video src="a.mp4" /></Reframe>'))).toEqual([
      'video-reframe-focus',
    ]);
    expect(
      codes(
        canvas('    <Reframe formats={{ wide: [[0, 0.5, 0.5]] }}><Video src="a.mp4" /></Reframe>')
      )
    ).toEqual(['video-reframe-focus']);
    expect(codes(canvas('    <Reframe zoom={0.5}><Video src="a.mp4" /></Reframe>'))).toEqual([
      'video-reframe-zoom',
    ]);
    expect(codes(canvas('    <Reframe fit="stretch"><Video src="a.mp4" /></Reframe>'))).toEqual([
      'video-reframe-fit',
    ]);
  });

  test('`fixes` is a JSON literal of { src, at, text }', () => {
    expect(codes(canvas('    <Captions fixes={FIXES} />'))).toEqual(['video-captions-fixes']);
    expect(
      codes(canvas('    <Captions fixes={[{ "src": "a.mp4", "at": "3", "text": "x" }]} />'))
    ).toEqual(['video-captions-fixes']);
    // bare keys are a JS literal, not JSON: the build would read no fix at all
    expect(codes(canvas('    <Captions fixes={[{ src: "a.mp4", at: 3, text: "x" }]} />'))).toEqual([
      'video-captions-fixes',
    ]);
  });

  test('<Place> positions are pairs in 0…1', () => {
    expect(codes(canvas('    <Place at={[1.5, 0.5]}><h1>x</h1></Place>'))).toEqual([
      'video-place-at',
    ]);
  });

  test('the build’s derived props never live in a file', () => {
    expect(codes(canvas('    <Captions __words={[]} />'))).toEqual(['video-derived-prop']);
    expect(codes(canvas('    <Duck __speech={[]}><Audio src="a.mp3" /></Duck>'))).toEqual([
      'video-derived-prop',
    ]);
  });

  test('only the canvas-lib components are judged: a local Captions is the author’s', () => {
    const local = canvas(
      '    <Captions cues={CUES} />\n    <Captions cues={CUES} />\n    <Reframe follow="x" />',
      'DCArtboard, VideoComp'
    );
    expect(codes(local)).toEqual([]);
  });
});
