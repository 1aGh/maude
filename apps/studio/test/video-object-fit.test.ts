// #128 §3 — `style.objectFit` on @remotion/media's <Video> was silently dropped (the component reads
// the `objectFit` PROP, default "contain"), so a 16:9 clip in a 9:16 artboard stayed letterboxed in the
// preview and in the export. Two halves: the canvas build maps the style to the prop (the file on disk
// is never touched), and `maude design check` tells the author to write the prop.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCanvasModule } from '../canvas-build.ts';
import { checkFile } from '../check/index.ts';
import { mapVideoObjectFit } from '../video/object-fit.ts';

const LIB = "import { DCArtboard, Reframe, VideoComp } from '@maude/canvas-lib';";
const MEDIA = "import { Audio, Video } from '@remotion/media';";
const canvas = (body: string, media = MEDIA) =>
  [
    LIB,
    media,
    'const Reel = () => (',
    '  <>',
    body,
    '  </>',
    ');',
    'export default () => (',
    '  <DCArtboard id="reel"><VideoComp component={Reel} durationInFrames={90} fps={30} /></DCArtboard>',
    ');',
  ].join('\n');

const map = (src: string) => mapVideoObjectFit('ui/Reel.tsx', src);

describe('mapVideoObjectFit — style.objectFit becomes the prop the renderer honours', () => {
  test('a literal style.objectFit is passed as the objectFit prop', () => {
    const src = canvas('    <Video src="a.mp4" style={{ objectFit: "cover", width: "100%" }} />');
    const out = map(src);
    expect(out).toContain('<Video objectFit={({ objectFit: "cover", width: "100%" })?.objectFit}');
    // the style stays exactly as written
    expect(out).toContain('style={{ objectFit: "cover", width: "100%" }}');
  });

  test('a spread helper (the cover() pattern) is read at runtime, not guessed', () => {
    const src = canvas(
      [
        '    <Video src="a.mp4" style={{ ...cover(), opacity: 0.9 }} />',
        '    <Video src="b.mp4" style={fit} />',
      ].join('\n')
    );
    const out = map(src);
    expect(out).toContain('<Video objectFit={({ ...cover(), opacity: 0.9 })?.objectFit}');
    expect(out).toContain('<Video objectFit={(fit)?.objectFit}');
  });

  test('the prop wins when both are given', () => {
    const src = canvas(
      '    <Video src="a.mp4" objectFit="contain" style={{ objectFit: "cover" }} />'
    );
    expect(map(src)).toBe(src);
  });

  test('an alias of Video is followed; Audio, a local Video and a style without objectFit are left alone', () => {
    const aliased = canvas(
      '    <MaudeVideo src="a.mp4" style={{ objectFit: "cover" }} />',
      "import { Video as MaudeVideo } from '@remotion/media';"
    );
    expect(map(aliased)).toContain('<MaudeVideo objectFit={');

    const untouched = [
      canvas('    <Audio src="a.mp3" style={{ objectFit: "cover" }} />'),
      canvas(
        '    <Video src="a.mp4" style={{ objectFit: "cover" }} />',
        'const Video = (p: object) => null;'
      ),
      canvas('    <Video src="a.mp4" style={{ width: "100%", height: "100%" }} />'),
      canvas('    <Video src="a.mp4" />'),
    ];
    for (const s of untouched) expect(map(s)).toBe(s);
  });

  test('a clip inside <Reframe> keeps Reframe in charge of its fit', () => {
    const src = canvas(
      '    <Reframe focus={[[0, 0.5, 0.5]]}><Video src="a.mp4" style={{ objectFit: "cover" }} /></Reframe>'
    );
    expect(map(src)).toBe(src);
  });

  test('text that does not parse comes back as it was (the bundler speaks for the syntax)', () => {
    const broken = `${MEDIA}\nconst x = <Video style={{ objectFit: "cover" }}`;
    expect(map(broken)).toBe(broken);
  });
});

describe('buildCanvasModule — the bundle carries the prop; the file never changes', () => {
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'maude-objfit-'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('the built module passes objectFit to <Video>', async () => {
    const src = canvas('    <Video src="assets/aaaaaaaa.mp4" style={{ objectFit: "cover" }} />');
    const file = join(root, 'Reel.tsx');
    writeFileSync(file, src);
    const built = await buildCanvasModule(file, src, { designRoot: root, restrictImportsTo: root });
    // the prop is read from the style at run time, next to the style the author wrote
    expect(built.js).toMatch(/\?\.objectFit/);
    expect(built.js).toContain('style: { objectFit: "cover" }');
    expect(readFileSync(file, 'utf8')).toBe(src);
  });
});

describe('maude design check — video-object-fit-style', () => {
  const warns = (src: string) =>
    checkFile('ui/Reel.tsx', src)
      .warnings.map((w) => w.code)
      .filter((c) => c === 'video-object-fit-style');

  test('style.objectFit on <Video> is flagged, and the fix names the prop', () => {
    const src = canvas('    <Video src="a.mp4" style={{ objectFit: "cover" }} />');
    expect(warns(src)).toEqual(['video-object-fit-style']);
    const w = checkFile('ui/Reel.tsx', src).warnings.find(
      (x) => x.code === 'video-object-fit-style'
    );
    expect(w?.where).toBe('ui/Reel.tsx:5');
    expect(w?.fix).toContain('objectFit="cover"');
    // a warning, not a refusal: the build already maps it
    expect(checkFile('ui/Reel.tsx', src).ok).toBe(true);
  });

  test('aliases are followed; a spread helper is flagged too', () => {
    expect(
      warns(
        canvas(
          '    <MaudeVideo src="a.mp4" style={{ ...cover() }} />',
          "import { Video as MaudeVideo } from '@remotion/media';"
        )
      )
    ).toEqual(['video-object-fit-style']);
  });

  test('the prop, a plain style, Audio and a non-remotion Video stay quiet', () => {
    expect(warns(canvas('    <Video src="a.mp4" objectFit="cover" />'))).toEqual([]);
    expect(warns(canvas('    <Video src="a.mp4" style={{ width: "100%" }} />'))).toEqual([]);
    expect(warns(canvas('    <Audio src="a.mp3" style={{ objectFit: "cover" }} />'))).toEqual([]);
    expect(
      warns(
        canvas(
          '    <Video src="a.mp4" style={{ objectFit: "cover" }} />',
          'const Video = (p: object) => null;'
        )
      )
    ).toEqual([]);
  });

  test('both objectFit prop and style: the prop wins, so nothing is lost and nothing is flagged', () => {
    expect(
      warns(canvas('    <Video src="a.mp4" objectFit="cover" style={{ objectFit: "contain" }} />'))
    ).toEqual([]);
  });
});
