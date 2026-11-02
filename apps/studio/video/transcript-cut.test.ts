// S7.6 — `clip.cut-source-range` (V2-1.10 §5.6 + §5.7, test #8): edit by transcript. The "Ehm…"
// fixture: `transcriptCut` turns the word into a 0.4 s source range, the op takes it out of the clip
// as one write (split × 2 + ripple remove), and the captions after it — derived, never written —
// arrive 12 frames earlier at 30 fps. A cut next to a transition answers the split's own refusal.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { compClips, compWords, transcriptCut } from './derive.ts';
import type { Transcript } from './schema.ts';

const FILE = 'ui/Reel.tsx';
const B = 'b.mp4';

const comp = (between = '') =>
  [
    "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
    "import { TransitionSeries } from '@remotion/transitions';",
    "import { Video } from '@remotion/media';",
    'const TOTAL = 270;',
    'const Comp = () => (',
    '  <TransitionSeries>',
    '    <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="a.mp4" /></TransitionSeries.Sequence>',
    `    <TransitionSeries.Sequence name="two" durationInFrames={120}><Video src="${B}" trimBefore={30} /></TransitionSeries.Sequence>`,
    ...(between ? [between] : []),
    '    <TransitionSeries.Sequence name="three" durationInFrames={60}><Video src="c.mp4" /></TransitionSeries.Sequence>',
    '  </TransitionSeries>',
    ');',
    'export default function Canvas() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="reel" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
    '',
  ].join('\n');

// clip "two" plays source 1.0 … 5.0 s at comp frames 90 … 210
const T: Transcript = {
  format: 'maude.transcript',
  v: 1,
  asset: B,
  engine: { id: 'whisper.cpp', timing: 'dtw+energy' },
  words: [
    { id: 'w0', t0: 1.2, t1: 1.8, text: 'Tak' },
    { id: 'w1', t0: 2.0, t1: 2.2, text: 'Ehm…' },
    { id: 'w2', t0: 2.4, t1: 2.8, text: 'jsem' },
    { id: 'w3', t0: 3.0, t1: 3.4, text: 'tady' },
  ],
  speech: { source: 'words', regions: [] },
  createdAt: '2026-10-18T09:00:00.000Z',
} as Transcript;

const op = EDIT_OPS.find((o) => o.id === 'clip.cut-source-range');
const run = (source: string, params: Record<string, unknown>) =>
  op?.apply(source, {
    file: FILE,
    op: 'clip.cut-source-range',
    targets: [],
    params: { artboard: 'reel', stableId: 'name:two', ...params },
  });

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('clip.cut-source-range', () => {
  test('the "Ehm…" word: 0.4 s out of the clip, the captions after it 12 frames earlier', () => {
    const cut = transcriptCut(T, ['w1'], undefined, { fps: 30 });
    expect(cut.srcStart).toBeCloseTo(1.9, 6);
    expect(cut.srcEnd).toBeCloseTo(2.3, 6);
    expect(cut.inPause).toBe(true);

    const before = comp();
    const out = run(before, { srcStart: cut.srcStart, srcEnd: cut.srcEnd });
    expect(out?.detail).toEqual({ removedFrames: 12, fromFrame: 117, toFrame: 129 });
    const after = out?.source as string;
    expect(after).toContain('const TOTAL = 258;');

    const wordsBefore = compWords(compClips(FILE, before, 'reel'), { [B]: T });
    const wordsAfter = compWords(compClips(FILE, after, 'reel'), { [B]: T });
    const at = (ws: typeof wordsBefore, id: string) => ws.find((w) => w.wordId === id);
    expect(at(wordsAfter, 'w1')).toBeUndefined(); // the cut word is struck
    expect(at(wordsAfter, 'w0')?.f0).toBe(at(wordsBefore, 'w0')?.f0); // before the cut: unmoved
    for (const id of ['w2', 'w3']) {
      expect((at(wordsAfter, id)?.f0 as number) - (at(wordsBefore, id)?.f0 as number)).toBe(-12);
      expect((at(wordsAfter, id)?.f1 as number) - (at(wordsBefore, id)?.f1 as number)).toBe(-12);
    }
    // the storyline after the cut: one, two (to the cut), two (after it), three
    const story = compClips(FILE, after, 'reel').clips.filter((c) => c.track === 'video');
    expect(story.map((c) => c.durationInFrames)).toEqual([90, 27, 81, 60]);
    expect(story[2]?.trimBefore).toBe(69);
  });

  test('a range at the clip edge trims instead of splitting twice; the whole clip removes it', () => {
    const head = run(comp(), { srcStart: 0.5, srcEnd: 2.0 }); // 1.0 is the clip's in-point
    expect(head?.detail).toMatchObject({ removedFrames: 30, fromFrame: 90, toFrame: 120 });
    const whole = run(comp(), { srcStart: 0, srcEnd: 9 });
    expect(whole?.detail).toMatchObject({ removedFrames: 120 });
    expect(whole?.source).toContain('const TOTAL = 150;');
    expect(whole?.source).not.toContain('name="two"');
  });

  test('a cut next to a transition answers the split refusal; a range outside the clip refuses', () => {
    const withXf = comp(
      '    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 10 })} />'
    );
    expect(() => run(withXf, { srcStart: 1.9, srcEnd: 2.3 })).toThrow(/touches a transition/);
    expect(() => run(comp(), { srcStart: 7, srcEnd: 8 })).toThrow(/not in this clip/);
    expect(() => run(comp(), { srcStart: 2, srcEnd: 2 })).toThrow(/Nothing to cut/);
  });

  test('through /_api/edit-op: one write, the facts in the answer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-cut-range-'));
    dirs.push(root);
    const designRoot = join(root, '.design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'Reel.tsx'), comp());
    let writes = 0;
    const specs = createEditRoutes({
      designRoot,
      designRel: '.design',
      repoRoot: root,
      emit: (e: string) => {
        if (e === 'activity:suppress') writes++;
      },
    });
    const editOp = specs.find((s) => s.path === '/_api/edit-op') as (typeof specs)[number];
    const res = await editOp.handle(
      new Request('http://localhost/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file: FILE,
          op: 'clip.cut-source-range',
          targets: [],
          params: { artboard: 'reel', stableId: 'name:two', srcStart: 1.9, srcEnd: 2.3 },
        }),
      }),
      {} as never
    );
    const j = (await res.json()) as { ok: boolean; detail?: unknown; writeId?: string };
    expect(j.ok).toBe(true);
    expect(j.detail).toEqual({ removedFrames: 12, fromFrame: 117, toFrame: 129 });
    expect(typeof j.writeId).toBe('string');
    expect(writes).toBe(1);
    expect(readFileSync(join(designRoot, 'ui', 'Reel.tsx'), 'utf8')).toContain(
      'const TOTAL = 258;'
    );
  });
});
