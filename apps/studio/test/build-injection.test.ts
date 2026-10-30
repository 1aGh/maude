// S7.5 — the canvas build injects the comp vocabulary's derived data (V2-1.10 §5.3 rules; §7 #11
// half): `__words` on <Captions>, `__speech` on <Duck>, from the comp's clips on disk × the
// transcripts of their sources. The file never changes; the transcripts are build inputs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { localDepsFromSource } from '../access/closure.ts';
import { buildCanvasModule } from '../canvas-build.ts';
import {
  canvasFormatLine,
  FORMAT_COPY,
  isMissingCanvasLibExport,
  SUPPORTED_FORMAT,
} from '../format.ts';
import { injectCompMedia, safeJson, videoDepsFor } from '../video/inject.ts';
import { type Transcript, validateTranscript } from '../video/schema.ts';

const A = 'assets/aaaaaaaa.mp4';
const M = 'assets/dddddddd.mp3';

function transcript(asset: string, over: Partial<Transcript> = {}): Transcript {
  return {
    format: 'maude.transcript',
    v: 1,
    asset,
    engine: { id: 'whisper.cpp', timing: 'dtw+energy' },
    words: [],
    speech: { source: 'words', regions: [] },
    createdAt: '2026-10-18T09:00:00.000Z',
    ...over,
  } as Transcript;
}

const NASTY = "it's `x` ${y} </script><b>";
const TA = transcript(A, {
  words: [
    { id: 'w0', t0: 0.2, t1: 0.5, text: 'pred' }, // before the trim: cut
    { id: 'w1', t0: 1.5, t1: 1.9, text: 'jsem' },
    { id: 'w2', t0: 2.0, t1: 2.3, text: NASTY },
  ],
  speech: {
    source: 'words',
    regions: [
      [1.5, 1.9],
      [2.0, 2.3],
    ],
  },
});

const comp = (trim: number, captions = '<Captions words="line" />') =>
  [
    "import { Captions, DCArtboard, DesignCanvas, Duck, VideoComp } from '@maude/canvas-lib';",
    "import { Audio, Video } from '@remotion/media';",
    "import { Sequence } from 'remotion';",
    'const Reel = () => (',
    '  <>',
    `    <Sequence name="a" from={0} durationInFrames={90}><Video src="${A}" trimBefore={${trim}} /></Sequence>`,
    `    <Duck db={-12} attackMs={100} releaseMs={100}><Audio src="${M}" volume={0.8} /></Duck>`,
    `    ${captions}`,
    '  </>',
    ');',
    'export default function Canvas() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="reel" width={1080} height={1920}><VideoComp component={Reel} durationInFrames={90} fps={30} /></DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

let root: string;
let canvas: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 's75-inject-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'ui'), { recursive: true });
  expect(validateTranscript(TA, { rel: 'assets/aaaaaaaa.transcript.json' }).ok).toBe(true);
  writeFileSync(join(root, 'assets/aaaaaaaa.transcript.json'), JSON.stringify(TA));
  canvas = join(root, 'ui/Reel.tsx');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The `__words={…}` value the injection put on the first <Captions>. */
function injectedWords(
  code: string
): Array<{ wordId: string; f0: number; f1: number; text: string }> {
  const m = /__words=\{(\[.*?\])\}(?=\s*\/?>)/s.exec(code);
  if (!m) throw new Error('no __words injected');
  return JSON.parse(m[1] as string);
}

describe('injectCompMedia — derived, never written', () => {
  test('<Captions> gets the comp words in comp frames; <Duck> the speech regions', () => {
    const src = comp(30); // source 1.0..4.0 s plays over comp 0..90
    const r = injectCompMedia(canvas, src, src, { designRoot: root });
    const words = injectedWords(r.code);
    expect(words.map((w) => w.wordId)).toEqual(['w1', 'w2']);
    expect(words[0]).toMatchObject({ f0: 15, f1: 27, text: 'jsem' });
    expect(words[1]?.text).toBe(NASTY);
    // two regions 3 frames apart merge (attack 100 ms + release 100 ms = 6 frames at 30 fps)
    expect(/__speech=\{\[\[15,39\]\]\}/.test(r.code)).toBe(true);
    // every source the comp plays is looked at — a voiceover on the Music track has words too
    expect(r.transcripts).toEqual([
      'assets/aaaaaaaa.transcript.json',
      'assets/dddddddd.transcript.json',
    ]);
  });

  test('a trim moves the words with no write to the captions', () => {
    writeFileSync(canvas, comp(0));
    const before = readFileSync(canvas, 'utf8');
    const late = injectedWords(injectCompMedia(canvas, before, before, { designRoot: root }).code);
    // trimBefore 0: source 0..3 s plays — w0 now shows, w1 at comp 45
    expect(late.map((w) => w.wordId)).toEqual(['w0', 'w1', 'w2']);
    expect(late[1]).toMatchObject({ f0: 45 });
    expect(readFileSync(canvas, 'utf8')).toBe(before); // the build wrote nothing
    expect(before.includes('__words')).toBe(false);
  });

  test('a comp’s own local Captions is not touched (the canvas-lib import decides)', () => {
    const local = comp(30)
      .replace('import { Captions, DCArtboard', 'import { DCArtboard')
      .replace('const Reel', 'const Captions = (p: { words?: string }) => null;\nconst Reel');
    const r = injectCompMedia(canvas, local, local, { designRoot: root });
    expect(r.code.includes('__words')).toBe(false);
  });

  test('an aliased import is followed; no designRoot injects an empty list', () => {
    const aliased = comp(30)
      .replace('import { Captions,', 'import { Captions as Subs,')
      .replace('<Captions words', '<Subs words');
    expect(
      injectedWords(injectCompMedia(canvas, aliased, aliased, { designRoot: root }).code)
    ).toHaveLength(2);
    expect(injectedWords(injectCompMedia(canvas, aliased, aliased).code)).toEqual([]);
  });

  test('the injected value is a safe JS expression: no word can close a script or a string', () => {
    const s = safeJson([{ text: '</script>  ' }]);
    expect(s.includes('<')).toBe(false);
    expect(s.includes(' ')).toBe(false);
    expect(JSON.parse(s)).toEqual([{ text: '</script>  ' }]);
  });
});

describe('buildCanvasModule — the bundle carries the words, as text', () => {
  test('the built module holds the words; the nasty word is data, never markup', async () => {
    const src = comp(30);
    writeFileSync(canvas, src);
    const built = await buildCanvasModule(canvas, src, {
      designRoot: root,
      restrictImportsTo: root,
    });
    expect(built.js).toContain('jsem');
    // The word is one double-quoted string VALUE in the module (never a template, never JSX
    // text): Bun reprints it with its own escapes, and the module is served as a file — the
    // escaping that matters is the injection's (no raw `<` reaches the bundler) and the render's.
    expect(built.js).toContain(JSON.stringify(NASTY));
    const injected = injectCompMedia(canvas, src, src, { designRoot: root }).code;
    expect(injected.slice(injected.indexOf('__words')).split('/>')[0]).not.toContain('<');
    expect(built.js).toContain('__speech');
    expect(readFileSync(canvas, 'utf8')).toBe(src);
  });
});

describe('transcripts are build inputs (freshness deps)', () => {
  test('a canvas whose comp plays the source lists its transcript; others list none', () => {
    const src = comp(30);
    const abs = join(root, 'assets/aaaaaaaa.transcript.json');
    // present or not: a transcript that appears later must rebuild too
    expect(videoDepsFor(src, canvas, root)).toEqual([
      abs,
      join(root, 'assets/dddddddd.transcript.json'),
    ]);
    expect(localDepsFromSource(src, canvas, root)).toContain(abs);
    // no <Captions>/<Duck>: no transcript dep, so a transcript change does not rebuild it
    const plain = src
      .replace(/\s*<Duck[^\n]*<\/Duck>/, '')
      .replace('<Captions words="line" />', '');
    expect(videoDepsFor(plain, canvas, root)).toEqual([]);
    expect(localDepsFromSource(plain, canvas, root)).not.toContain(abs);
  });
});

describe('a 1.x build: "This canvas uses Maude 2"', () => {
  test('a canvas-lib without the vocabulary fails the build with the canvas line', async () => {
    const stub = join(root, 'v1-canvas-lib.tsx');
    writeFileSync(
      stub,
      'export const DCArtboard = () => null;\nexport const VideoComp = () => null;\n'
    );
    const src = comp(30);
    const built = await Bun.build({
      entrypoints: [canvas],
      target: 'browser',
      throw: false,
      plugins: [
        {
          name: 'v1-lib',
          setup(b) {
            b.onResolve({ filter: /^@maude\/canvas-lib$/ }, () => ({ path: stub }));
            b.onResolve({ filter: /^(?:remotion|@remotion\/media|react(?:\/.*)?)$/ }, (a) => ({
              path: a.path,
              external: true,
            }));
          },
        },
      ],
    });
    expect(built.success).toBe(false);
    const message = built.logs.map((l) => l.message).join('\n');
    expect(isMissingCanvasLibExport(message.replace(stub, '/x/canvas-lib.tsx'))).toBe(true);
    const newer = {
      projectFormat: SUPPORTED_FORMAT + 1,
      supported: SUPPORTED_FORMAT,
      source: 'hub' as const,
    };
    expect(canvasFormatLine(message.replace(stub, '/x/canvas-lib.tsx'), newer)).toBe(
      FORMAT_COPY.newerCanvas
    );
    expect(src).toContain('Captions');
  });
});
