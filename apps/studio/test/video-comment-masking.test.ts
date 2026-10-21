// gate-b-fix3 — the comp readers scan canvas source TEXT (DDR-150); a comment that merely names <Captions>,
// <Duck>, <TitleMotion> or <Reframe> must not read as that element being present. Strings and JSX text that
// contain `//` are not comments and keep working.

import { describe, expect, test } from 'bun:test';

import { enumerateClips } from '../canvas-edit.ts';
import {
  captionFixesOf,
  captionsOf,
  compClips,
  compMusic,
  duckedSrcOf,
  ducksBySrc,
} from '../video/derive.ts';
import { maskComments } from '../video/mask-comments.ts';

const FILE = 'ui/Reel.tsx';
const comp = (extra: string, imports = '') =>
  [
    "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
    "import { Audio, Sequence } from 'remotion';",
    imports,
    'const Comp = () => (',
    '  <>',
    `    <Sequence name="title" from={0} durationInFrames={60}>${extra}<div data-cd-id="t">{"Hi"}</div></Sequence>`,
    '    <Audio src="bed.mp3" volume={0.5} />',
    '  </>',
    ');',
    'export default function Canvas() {',
    '  return (<DesignCanvas><DCArtboard id="reel" label="R" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={60} fps={30} width={1080} height={1920} /></DCArtboard></DesignCanvas>);',
    '}',
    '',
  ].join('\n');

describe('a comment that names <Captions> is not captions', () => {
  test('line comment, block comment and JSX comment', () => {
    expect(captionsOf('// <Captions words={3} />\nconst a = 1;')).toBeNull();
    expect(captionsOf('/* <Captions position="top"> */\nconst a = 1;')).toBeNull();
    expect(captionsOf('const a = <p>{/* <Captions /> */}</p>;')).toBeNull();
    expect(captionFixesOf('// <Captions fixes={[{"src":"a","at":1,"text":"x"}]} />')).toEqual([]);
  });

  test('a real <Captions> after a commented one is the real one', () => {
    const src = '// <Captions words={1} />\nconst a = <Captions words={3} position="top" />;';
    expect(captionsOf(src)?.words).toBe(3);
    expect(captionsOf(src)?.position).toBe('top');
  });

  test('a // inside JSX text or a string is not a comment', () => {
    const src = 'const a = <p>https://x.y</p>; const b = <Captions words={1} />; const s = "//";';
    expect(captionsOf(src)?.words).toBe(1);
  });
});

describe('a comment that names <Duck> is not a duck', () => {
  const real = '<Duck db={-9}><Audio src="bed.mp3" /></Duck>';
  test('duckedSrcOf and ducksBySrc skip the commented one', () => {
    const src = `// <Duck db={-3}><Audio src="other.mp3" /></Duck>\n${real}`;
    expect(duckedSrcOf(`/* ${real} */`)).toBeNull();
    expect(ducksBySrc(`// ${real}`).size).toBe(0);
    expect(duckedSrcOf(src)).toBe('bed.mp3');
    expect([...ducksBySrc(src).keys()]).toEqual(['bed.mp3']);
    expect(ducksBySrc(src).get('bed.mp3')?.db).toBe(-9);
  });

  test('the Music lane reads no dip for a commented Duck, and the volume of the real Audio', () => {
    const source = comp('', '// <Duck db={-20}><Audio src="bed.mp3" /></Duck>');
    const c = compClips(FILE, source, 'reel');
    const music = compMusic(c, {}, source);
    expect(music.map((m) => m.duck)).toEqual([null]);
    expect(music[0]?.volume).toBe(0.5);
  });
});

describe('a comment that names <TitleMotion> or <Reframe> is not one (the enumerator)', () => {
  const title = (source: string) =>
    enumerateClips(FILE, source, 'reel').clips.find((c) => c.stableId === 'name:title');

  test('<TitleMotion> in a comment inside the clip reads no motion', () => {
    expect(title(comp('{/* <TitleMotion preset="pop" frames={20}> */}'))?.titleMotion).toBeNull();
    expect(title(comp('{/* <Reframe fit="blur"> */}'))?.fit).toBeNull();
  });

  test('the real thing still reads', () => {
    const real = comp('').replace(
      '<div data-cd-id="t">{"Hi"}</div>',
      '<TitleMotion preset="pop" frames={20}><div data-cd-id="t">{"Hi"}</div></TitleMotion>'
    );
    expect(title(real)?.titleMotion).toEqual({ preset: 'pop', frames: 20 });
  });
});

describe('maskComments', () => {
  test('keeps length and newlines; leaves strings and JSX text alone; untouched when there is no comment', () => {
    const src = [
      'const a = 1; // b',
      '/* c',
      'd */',
      'const s = "//"; const p = <p>http://x</p>;',
    ].join('\n');
    const out = maskComments(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).toContain('"//"');
    expect(out).toContain('http://x');
    expect(out).not.toContain('// b');
    expect(maskComments('const a = 1;')).toBe('const a = 1;');
  });
});
