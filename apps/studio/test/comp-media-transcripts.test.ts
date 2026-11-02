// S7.11 — what the Transcript panel and the Captions inspector read beyond the covered words:
//   `transcripts`  the source words of every clip's source (the panel strikes the ones no clip covers);
//   `captions`     the comp's <Captions> props and its `fixes` (null when there is none).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createVideoRoutes } from '../routes/video.ts';
import { captionsOf } from '../video/derive.ts';
import { makeSandbox } from './_helpers.ts';

const A = 'assets/aaaaaaaa.mp4';

const SOURCE = (captions: string) =>
  [
    'const TOTAL = 90;',
    'const Reel = () => (',
    '  <>',
    '    <TransitionSeries>',
    `      <TransitionSeries.Sequence name="a" durationInFrames={90}><OffthreadVideo src="${A}" /></TransitionSeries.Sequence>`,
    '    </TransitionSeries>',
    captions,
    '  </>',
    ');',
    'export default function Canvas() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="reel"><VideoComp component={Reel} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

const FULL = `    <Captions data-cd-id="captions" words={3} position="top" font="var(--font-display)" highlight="var(--accent)" maxChars={24} fixes={${JSON.stringify([{ src: A, at: 1.7, text: 'jsem' }])}} />`;

describe('captionsOf — the <Captions> props as the file says them', () => {
  test('words, position, font, highlight, maxChars and fixes', () => {
    expect(captionsOf(SOURCE(FULL))).toEqual({
      words: 3,
      position: 'top',
      font: 'var(--font-display)',
      highlight: 'var(--accent)',
      maxChars: 24,
      fixes: [{ src: A, at: 1.7, text: 'jsem' }],
    });
  });
  test('the §5.3 defaults for a bare <Captions />, and null when there is none', () => {
    expect(captionsOf(SOURCE('    <Captions words="line" position="bottom" />'))).toEqual({
      words: 'line',
      position: 'bottom',
      font: null,
      highlight: null,
      maxChars: null,
      fixes: [],
    });
    expect(captionsOf(SOURCE(''))).toBeNull();
  });
});

describe('GET /_api/comp-media — transcripts + captions', () => {
  test('every source word is there, struck or not; captions mirrors the file', async () => {
    const { designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'Reel.tsx'), SOURCE(FULL));
    writeFileSync(
      join(designRoot, 'assets', 'aaaaaaaa.transcript.json'),
      JSON.stringify({
        format: 'maude.transcript',
        v: 1,
        asset: A,
        durationSec: 12,
        lang: 'cs',
        engine: { id: 'whisper.cpp', timing: 'dtw+energy' },
        words: [
          { id: 'w0', t0: 1.5, t1: 1.9, text: 'jsem', p: 0.4 },
          { id: 'w1', t0: 2.5, t1: 2.8, text: 'Ehm…', flags: ['loop'] },
          { id: 'w2', t0: 40, t1: 41, text: 'pozdě' },
        ],
        speech: { source: 'words', regions: [[1.5, 2.8]] },
        createdAt: '2026-10-18T09:00:00.000Z',
      })
    );
    const spec = createVideoRoutes({ designRoot, designRel: '.design' }).find(
      (s) => s.path === '/_api/comp-media'
    );
    const res = await Promise.resolve(
      spec?.handle(
        new Request(
          'http://127.0.0.1:4399/_api/comp-media?canvas=.design/ui/Reel.tsx&artboard=reel'
        ),
        {}
      )
    );
    const body = (await (res as Response).json()) as Record<string, any>;
    expect(body.transcripts[A]).toEqual({
      durationSec: 12,
      lang: 'cs',
      words: [
        { id: 'w0', t0: 1.5, t1: 1.9, text: 'jsem', p: 0.4 },
        { id: 'w1', t0: 2.5, t1: 2.8, text: 'Ehm…', flags: ['loop'] },
        { id: 'w2', t0: 40, t1: 41, text: 'pozdě' },
      ],
    });
    expect(body.captions.words).toBe(3);
    expect(body.captions.fixes).toEqual([{ src: A, at: 1.7, text: 'jsem' }]);
  });
});
