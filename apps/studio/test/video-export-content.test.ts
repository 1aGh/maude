// S7.19 (07 ve-export) — what the Export sheet offers for a video: the formats around the artboard (linked ones
// ticked, an unlinked copy not), whether captions can be burned in, and the artboard's own stored ceiling, which
// starts the sheet with Allow longer on. The numbers come from the server's estimate rows (`videoInfo`); the sheet's
// module (`videoExportContent`) only reads them. S8.6's rule is untouched: stored is a ceiling, not a switch.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  allowLongerDefault,
  formatsFor,
  isPartial,
  videoCtx,
} from '../client/v2/export/sections/video-model.js';
import { buildSpec, initialState } from '../client/v2/export/use-export-spec.js';
import { videoExportContent } from '../client/v2/export/video-content.js';
import type { SpecUnit } from '../exporters/scope.ts';
import { capFor, defaultVideoFacts, videoInfo } from '../exporters/video-cap.ts';
import { makeSandbox } from './_helpers.ts';

const CLIP = 'assets/aaaaaaaa.mp4';
const SOURCE = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { Sequence, OffthreadVideo } from 'remotion';",
  `const Recap = () => (<Sequence name="a" durationInFrames={90}><OffthreadVideo src="${CLIP}" /></Sequence>);`,
  `const RecapUnlinked = () => (<Sequence name="a" durationInFrames={90}><OffthreadVideo src="${CLIP}" /></Sequence>);`,
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reels" label="Recap · Reels" kind="video" width={1080} height={1920}><VideoComp component={Recap} durationInFrames={90} fps={30} width={1080} height={1920} /></DCArtboard>',
  '      <DCArtboard id="wide" label="Recap · 16:9" kind="video" width={1920} height={1080}><VideoComp component={Recap} durationInFrames={90} fps={30} width={1920} height={1080} /></DCArtboard>',
  '      <DCArtboard id="copy" label="16:9 copy" kind="video" width={1920} height={1080}><VideoComp component={RecapUnlinked} durationInFrames={90} fps={30} width={1920} height={1080} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const TRANSCRIPT = {
  format: 'maude.transcript',
  v: 1,
  asset: CLIP,
  durationSec: 3,
  lang: 'cs',
  engine: { id: 'whisper.cpp', timing: 'dtw+energy' },
  words: [{ id: 'w0', t0: 0.5, t1: 0.9, text: 'srdce', p: 0.9 }],
  speech: { source: 'words', regions: [[0.5, 0.9]] },
  createdAt: '2026-10-18T09:00:00.000Z',
};

function sandbox(opts: { transcript?: boolean; maxFrames?: number } = {}) {
  const { designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'Recap.tsx'), SOURCE);
  if (opts.transcript) {
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(
      join(designRoot, 'assets', 'aaaaaaaa.transcript.json'),
      JSON.stringify(TRANSCRIPT)
    );
  }
  if (opts.maxFrames)
    writeFileSync(
      join(designRoot, 'ui', 'Recap.meta.json'),
      JSON.stringify({ artboardMeta: { reels: { maxFrames: opts.maxFrames } } })
    );
  return designRoot;
}

const unit = (artboard: string, w: number, h: number): SpecUnit =>
  ({
    format: 'mp4',
    canvas: 'ui/Recap.tsx',
    artboards: [{ id: artboard, label: artboard, w, h }],
    options: {},
    v2: {},
  }) as unknown as SpecUnit;

describe('the estimate rows carry the formats, the speech and the stored ceiling', () => {
  test('a linked 16:9 is a format of the reels, the unlinked copy is marked as one', () => {
    const designRoot = sandbox({ transcript: true, maxFrames: 9000 });
    const rows = videoInfo([unit('reels', 1080, 1920)], defaultVideoFacts(designRoot));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.stored).toBe(9000);
    expect(row.speech).toBe(true);
    expect(row.formats.map((f) => [f.artboard, f.linked, f.copy])).toEqual([
      ['reels', true, false],
      ['wide', true, false],
      ['copy', false, true],
    ]);
    expect(row.formats[1]).toMatchObject({ size: '1920 × 1080', label: 'Recap · 16:9' });
  });

  test('no transcript, no stored ceiling: no captions to burn in, nothing stored', () => {
    const designRoot = sandbox();
    const row = videoInfo([unit('wide', 1920, 1080)], defaultVideoFacts(designRoot))[0];
    expect(row.speech).toBe(false);
    expect(row.stored).toBeNull();
  });

  test('the strip clips say which clip they are: its name, its file and the title it carries (09 ex-video filmstrip)', () => {
    const designRoot = sandbox();
    const row = videoInfo([unit('wide', 1920, 1080)], defaultVideoFacts(designRoot))[0];
    expect(row.clips).toHaveLength(1);
    expect(row.clips[0]).toMatchObject({
      track: 'video2',
      from: 0,
      frames: 90,
      name: 'a',
      src: CLIP,
    });
  });

  test('a title on a clip names the clip as its title lane text', () => {
    const designRoot = sandbox();
    const file = join(designRoot, 'ui/Recap.tsx');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        /const Recap = .*\n/,
        `const Recap = () => (<Sequence name="a" durationInFrames={90}><OffthreadVideo src="${CLIP}" /><KineticTitle text="RYCHLOST" /></Sequence>);\n`
      )
    );
    const row = videoInfo([unit('wide', 1920, 1080)], defaultVideoFacts(designRoot))[0];
    expect(row.clips[0]?.title).toBe('RYCHLOST');
  });

  test('stored is a ceiling, not a switch (S8.6): the server rule is unchanged', () => {
    expect(capFor(false, 9000)).toBe(3600);
    expect(capFor(true, 9000)).toBe(9000);
  });
});

describe('videoExportContent — the sheet’s content from those rows', () => {
  const designRoot = sandbox({ transcript: true, maxFrames: 9000 });
  const read = defaultVideoFacts(designRoot);
  const rows = [
    ...videoInfo([unit('reels', 1080, 1920)], read),
    ...videoInfo([unit('wide', 1920, 1080)], read),
  ].map((r) => ({ ...r, canvas: 'ui/Recap.tsx' }));

  test('one artboard selected → 2 videos ticked, the unlinked copy offered unticked', () => {
    const c = videoExportContent('ui/Recap.tsx', ['reels'], rows.slice(0, 1));
    expect(c.formats.map((f) => [f.artboardId, f.linked, f.ticked])).toEqual([
      ['reels', true, true],
      ['wide', true, true],
      ['copy', false, false],
    ]);
    expect(videoCtx(c.formats)).toEqual({ ids: ['reels', 'wide'], linked: true });
  });

  test('captions: Off by default, on offer only when the cut has speech; sound is shared', () => {
    const c = videoExportContent('ui/Recap.tsx', ['reels'], rows);
    expect(c.captions).toEqual({ available: true, defaultMode: 'off' });
    expect(c.soundOnly).toBe('shared');
    const none = videoExportContent('ui/Recap.tsx', ['reels'], [{ ...rows[0], speech: false }]);
    expect(none.captions.available).toBe(false);
  });

  test('maxFrames comes from the artboard’s stored ceiling and starts Allow longer on', () => {
    expect(videoExportContent('ui/Recap.tsx', ['reels'], rows).maxFrames).toBe(9000);
    expect(allowLongerDefault('ui/Recap.tsx', ['reels'], rows)).toBe(true);
    const bare = rows.map((r) => ({ ...r, stored: null }));
    expect(videoExportContent('ui/Recap.tsx', ['reels'], bare).maxFrames).toBeNull();
    expect(allowLongerDefault('ui/Recap.tsx', ['reels'], bare)).toBe(false);
  });

  test('an unlinked copy asked for by name is ticked (it is the artboard asked for)', () => {
    const c = videoExportContent(
      'ui/Recap.tsx',
      ['copy'],
      [
        {
          ...rows[0],
          artboard: 'copy',
          label: '16:9 copy',
          w: null,
          h: null,
          formats: [{ artboard: 'copy', label: '16:9 copy', size: '', linked: false, copy: false }],
        },
      ]
    );
    expect(c.formats).toEqual([
      { artboardId: 'copy', label: '16:9 copy', size: '', linked: false, ticked: true },
    ]);
  });

  test('rows with no formats (an older server) read as the artboard alone — the S8.6 fallback', () => {
    const c = videoExportContent('ui/r.tsx', ['a'], [{ artboard: 'a', label: 'A', w: 100, h: 50 }]);
    expect(c.formats).toEqual([
      { artboardId: 'a', label: 'A', size: '100 × 50', linked: false, ticked: true },
    ]);
    expect(c.maxFrames).toBeNull();
  });
});

describe('This canvas (07 ve-export): 3 of 4 formats ticked', () => {
  const four = [
    ['a', 'Reels 9:16'],
    ['b', '16:9'],
    ['c', '1:1'],
    ['d', '16:9 copy'],
  ].map(([artboard, label]) => ({
    canvas: 'ui/Recap.tsx',
    artboard,
    label,
    w: 1080,
    h: 1080,
    formats: [
      ...['a', 'b', 'c'].map((x) => ({
        artboard: x,
        label: x,
        size: '',
        linked: true,
        copy: false,
      })),
      { artboard: 'd', label: '16:9 copy', size: '', linked: false, copy: true },
    ],
  }));
  const formats = formatsFor({ scope: 'canvas', canvas: 'ui/Recap.tsx', base: [], rows: four });

  test('the formats are offered for a canvas export when the canvas has more than one', () => {
    expect(formats).toHaveLength(4);
    expect(formats.filter((f) => f.ticked)).toHaveLength(3);
    // one video and nothing else to tick: no row (the other scopes export everything they reach)
    expect(
      formatsFor({
        scope: 'canvas',
        canvas: 'ui/Recap.tsx',
        base: [],
        rows: [{ artboard: 'x', label: 'X', w: 1, h: 1 }],
      })
    ).toEqual([]);
    expect(formatsFor({ scope: 'folder', canvas: 'ui/Recap.tsx', base: [], rows: four })).toEqual(
      []
    );
  });

  test('the ticked three, not the copy, become a selection of this canvas', () => {
    const v = videoCtx(formats);
    expect(isPartial('canvas', formats, v.ids)).toBe(true);
    const state = { ...initialState(), scope: 'canvas', format: 'mp4' };
    const spec = buildSpec(state, {
      designRel: '.design',
      activePath: '.design/ui/Recap.tsx',
      video: { ...v, partial: true },
    });
    expect(spec.scope).toBe('selection');
    expect(spec.canvas).toBe('ui/Recap.tsx');
    expect(spec.selection).toEqual({ artboards: ['a', 'b', 'c'] });
  });

  test('everything ticked stays a plain canvas export', () => {
    const v = videoCtx(formats, { d: true });
    expect(isPartial('canvas', formats, v.ids)).toBe(false);
    const state = { ...initialState(), scope: 'canvas', format: 'mp4' };
    const spec = buildSpec(state, {
      designRel: '.design',
      activePath: '.design/ui/Recap.tsx',
      video: v,
    });
    expect(spec.scope).toBe('canvas');
    expect(spec.selection).toBeUndefined();
  });
});
