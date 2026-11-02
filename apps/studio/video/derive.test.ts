// S7.4 — video/derive.ts (V2-1.10 §5.4, §5.6; tests #5, #6, #10 of §7): the comp's clips crossed
// with the sidecars. Pure and deterministic: every case here is a number the contract pins.

import { describe, expect, test } from 'bun:test';

import {
  aspectKey,
  type CaptionFix,
  type ClipSpan,
  captionFixesOf,
  compBeats,
  compClips,
  compSpeech,
  compWords,
  duckedSrcOf,
  duckGain,
  placeAt,
  reframeWindow,
  transcriptCut,
} from './derive.ts';
import type { BeatGrid, Transcript } from './schema.ts';

const CANVAS = '/abs/Reel.tsx';
const A = 'assets/aaaaaaaa.mp4';
const B = 'assets/bbbbbbbb.mp4';
const C = 'assets/cccccccc.mp4';
const M = 'assets/dddddddd.mp3';

const SRC = [
  'const FPS = 30;',
  'const XF = 10;',
  'const TOTAL = 140;',
  'const Reel = () => (',
  '  <>',
  '    <TransitionSeries>',
  `      <TransitionSeries.Sequence name="a" durationInFrames={90}><OffthreadVideo src="${A}" trimBefore={30} /></TransitionSeries.Sequence>`,
  '      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />',
  `      <TransitionSeries.Sequence name="b" durationInFrames={60}><OffthreadVideo src="${B}" playbackRate={2} /></TransitionSeries.Sequence>`,
  '    </TransitionSeries>',
  `    <Sequence name="ov" from={20} durationInFrames={30}><OffthreadVideo src="${C}" muted /></Sequence>`,
  `    <Duck db={-12}><Audio src="${M}" volume={0.8} trimBefore={15} /></Duck>`,
  '    <Captions words="line" />',
  '  </>',
  ');',
  'function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel"><VideoComp component={Reel} durationInFrames={TOTAL} fps={FPS} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
].join('\n');

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

// a: source 1.0..4.0 s plays (trimBefore 30 frames, 90 frames at rate 1), comp frames 0..90.
const TA = transcript(A, {
  words: [
    { id: 'w0', t0: 0.2, t1: 0.5, text: 'pred' }, //            before the trim: cut
    { id: 'w1', t0: 1.5, t1: 1.9, text: 'jsem' }, //            comp 15..27
    { id: 'w2', t0: 2.0, t1: 2.3, text: 'ha', flags: ['loop'] }, // loop: hidden unless named
    { id: 'w3', t0: 3.9, t1: 4.2, text: 'konec' }, //           straddles the clip's out point: cut
  ],
  speech: {
    source: 'words',
    regions: [
      [0.2, 0.5],
      [1.5, 2.3],
      [3.9, 4.2],
    ],
  },
});
// b: rate 2, no trim: source 0..4 s plays over comp frames 80..140.
const TB = transcript(B, {
  words: [{ id: 'w0', t0: 1.0, t1: 1.4, text: 'dva' }], // comp 80 + 15 = 95 .. 80 + 21 = 101
  speech: { source: 'words', regions: [[1.0, 1.4]] },
});
const TC = transcript(C, {
  words: [{ id: 'w0', t0: 0, t1: 0.5, text: 'tichy' }],
  speech: { source: 'words', regions: [[0, 0.5]] },
});

describe('compClips — the Timeline’s enumerator, in absolute comp frames', () => {
  const c = compClips(CANVAS, SRC, 'reel');

  test('fps, total, and the series cursor walk (a transition overlaps its neighbours)', () => {
    expect(c.fps).toBe(30);
    expect(c.total).toBe(140);
    expect(c.unresolved).toEqual([]);
    const byId = Object.fromEntries(c.clips.map((k) => [k.stableId, k]));
    expect(byId['name:a']).toMatchObject({
      track: 'video',
      src: A,
      from: 0,
      durationInFrames: 90,
      trimBefore: 30,
      playbackRate: 1,
      muted: false,
    });
    expect(byId['name:b']).toMatchObject({
      track: 'video',
      from: 80,
      durationInFrames: 60,
      playbackRate: 2,
      trimBefore: 0,
    });
  });

  test('tracks are derived: standalone video → video2, audio → music; muted is read', () => {
    const ov = c.clips.find((k) => k.stableId === 'name:ov');
    expect(ov).toMatchObject({ track: 'video2', from: 20, durationInFrames: 30, muted: true });
    const bed = c.clips.find((k) => k.src === M);
    expect(bed).toMatchObject({
      track: 'music',
      from: 0,
      durationInFrames: 140,
      trimBefore: 15,
      loose: true,
    });
  });

  test('a fractional playbackRate and volume={0} are read exactly (numAttr rounds them)', () => {
    const src = SRC.replace(
      `src="${A}" trimBefore={30}`,
      `src="${A}" trimBefore={30} playbackRate={0.5} volume={0}`
    );
    const a = compClips(CANVAS, src, 'reel').clips.find((k) => k.stableId === 'name:a');
    expect(a).toMatchObject({ playbackRate: 0.5, muted: true });
  });

  test('a second overlapping music bed lands on music2', () => {
    const two = SRC.replace(
      '    <Captions words="line" />',
      '    <Audio src="assets/eeeeeeee.mp3" />\n    <Captions words="line" />'
    );
    const tracks = compClips(CANVAS, two, 'reel')
      .clips.filter((k) => k.src.endsWith('.mp3'))
      .map((k) => k.track);
    expect(tracks).toEqual(['music', 'music2']);
  });

  test('a clip whose timing is not literal is reported, never guessed', () => {
    const dyn = SRC.replace(
      'from={20} durationInFrames={30}',
      'from={start} durationInFrames={30}'
    );
    const r = compClips(CANVAS, dyn, 'reel');
    expect(r.unresolved).toEqual(['name:ov']);
    expect(r.clips.some((k) => k.stableId === 'name:ov')).toBe(false);
    const noDur = SRC.replace('durationInFrames={90}', 'durationInFrames={len}');
    expect(compClips(CANVAS, noDur, 'reel').unresolved).toContain('name:a');
  });

  test('a hidden clip renders nothing, so it is no span', () => {
    const hidden = SRC.replace(
      `<Sequence name="ov" from={20} durationInFrames={30}><OffthreadVideo src="${C}" muted /></Sequence>`,
      `<Sequence name="ov" from={20} durationInFrames={30}>{false && (<OffthreadVideo src="${C}" muted />)}</Sequence>`
    );
    expect(compClips(CANVAS, hidden, 'reel').clips.some((k) => k.src === C)).toBe(false);
  });
});

describe('compWords — captions follow the cut with no write (§5.4, test #5)', () => {
  const c = compClips(CANVAS, SRC, 'reel');
  const ts = { [A]: TA, [B]: TB };

  test('a word is shown when its source interval is inside the source the clip plays', () => {
    const words = compWords(c, ts);
    expect(words.map((w) => `${w.src}:${w.wordId}`)).toEqual([`${A}:w1`, `${B}:w0`]);
    const jsem = words[0];
    expect(jsem).toMatchObject({ clip: 'name:a', f0: 15, f1: 27, text: 'jsem' });
    expect(words[1]).toMatchObject({ clip: 'name:b', f0: 95, f1: 101, text: 'dva' });
  });

  test('a word moves with a trim and with a speed change; the same words come back', () => {
    const trimmed = SRC.replace('trimBefore={30}', 'trimBefore={0}');
    const w = compWords(compClips(CANVAS, trimmed, 'reel'), ts);
    // trim 0 → source 0..3 s: w0 (0.2..0.5) now shown, w1 at 1.5 s is frame 45..57
    expect(w.filter((x) => x.src === A).map((x) => [x.wordId, x.f0, x.f1])).toEqual([
      ['w0', 6, 15],
      ['w1', 45, 57],
    ]);
  });

  test('a loop-flagged word shows only when a fix names it; a fix replaces text, null hides', () => {
    const fixes: CaptionFix[] = [
      { src: A, at: 2.1, text: 'ha ha' }, // names w2 (the loop word) — shown with the new text
      { src: A, at: 1.7, text: null }, //   hides w1
      { src: B, at: 99, text: 'x' }, //     matches nothing — ignored
    ];
    const w = compWords(c, ts, fixes);
    expect(w.map((x) => x.wordId + ':' + x.text)).toEqual(['w2:ha ha', 'w0:dva']);
    expect(w[0]?.fixed).toBe(true);
    expect(w[1]?.fixed).toBeUndefined();
  });

  test('the same source moment used twice shows twice', () => {
    const twice = SRC.replace(
      '    <Captions words="line" />',
      `    <Sequence name="again" from={100} durationInFrames={60}><OffthreadVideo src="${A}" trimBefore={30} /></Sequence>\n    <Captions words="line" />`
    );
    const w = compWords(compClips(CANVAS, twice, 'reel'), ts).filter((x) => x.src === A);
    expect(w.map((x) => [x.clip, x.f0])).toEqual([
      ['name:a', 15],
      ['name:again', 115],
    ]);
  });

  test('inside a transition overlap the word belongs to the earlier clip, once', () => {
    // Two clips of the same source over the same moment, overlapping by 10 frames.
    const src = [
      'const Reel = () => (',
      '  <TransitionSeries>',
      `    <TransitionSeries.Sequence name="p" durationInFrames={60}><OffthreadVideo src="${A}" /></TransitionSeries.Sequence>`,
      '    <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} />',
      `    <TransitionSeries.Sequence name="q" durationInFrames={60}><OffthreadVideo src="${A}" trimBefore={50} /></TransitionSeries.Sequence>`,
      '  </TransitionSeries>',
      ');',
      'function Canvas() { return <DCArtboard id="r"><VideoComp component={Reel} durationInFrames={110} fps={30} /></DCArtboard>; }',
    ].join('\n');
    const cc = compClips(CANVAS, src, 'r');
    // p plays source 0..2 s over comp 0..60; q plays 1.667..3.667 s over comp 50..110.
    // The word at 1.75..1.95 s is comp 52.5..58.5 in p and comp 52.5..58.5 in q: both in the overlap.
    const t = transcript(A, { words: [{ id: 'w0', t0: 1.75, t1: 1.95, text: 'x' }] });
    const w = compWords(cc, { [A]: t });
    expect(w).toHaveLength(1);
    expect(w[0]?.clip).toBe('name:p');
  });

  test('no transcript for a source → that clip contributes nothing, no throw', () => {
    expect(compWords(c, {})).toEqual([]);
  });
});

describe('captionFixesOf — the JSON literal <Captions fixes> carries', () => {
  test('reads the literal; an unreadable or malformed one is ignored', () => {
    const fixes = JSON.stringify([
      { src: A, at: 3.45, text: 'jsem' },
      { src: A, at: 9.1, text: null },
      { src: 7, at: 1, text: 'bad' },
    ]);
    const src = `<Captions words={3} fixes={${fixes}} />`;
    expect(captionFixesOf(src)).toEqual([
      { src: A, at: 3.45, text: 'jsem' },
      { src: A, at: 9.1, text: null },
    ]);
    expect(captionFixesOf('<Captions fixes={[oops]} />')).toEqual([]);
    expect(captionFixesOf('<Captions />')).toEqual([]);
    // text containing the delimiters survives (bracket matching ignores strings)
    const tricky = JSON.stringify([{ src: A, at: 1, text: '] } ${x} </script>' }]);
    expect(captionFixesOf(`<Captions fixes={${tricky}} />`)[0]?.text).toBe('] } ${x} </script>');
  });
});

describe('duckedSrcOf — the bed a <Duck> wraps', () => {
  test('reads the wrapped Audio src literal; none gives null', () => {
    expect(duckedSrcOf(SRC)).toBe(M);
    expect(duckedSrcOf("<Duck db={-9}>\n  <MaudeAudio src='assets/x.mp3' /></Duck>")).toBe(
      'assets/x.mp3'
    );
    expect(duckedSrcOf('<Audio src="assets/x.mp3" />')).toBeNull();
    expect(duckedSrcOf('<Duck><div /></Duck>')).toBeNull();
    expect(duckedSrcOf('<Duck><Audio src={bed} /></Duck>')).toBeNull();
  });
});

describe('compSpeech + duckGain — ducking from the cut (§5.4, test #6)', () => {
  const c = compClips(CANVAS, SRC, 'reel');
  const ts = { [A]: TA, [B]: TB, [C]: TC };

  test('regions of non-muted video clips, mapped to comp frames; muted and the ducked bed excluded', () => {
    // a: regions clipped to source 1.0..4.0 → [1.5,2.3] = comp 15..39; [3.9,4.0] = comp 87..90.
    // b (rate 2): [1.0,1.4] = comp 80 + 15 .. 80 + 21 = 95..101. ov is muted → nothing.
    expect(compSpeech(c, ts)).toEqual([
      [15, 39],
      [87, 90],
      [95, 101],
    ]);
  });

  test('regions merge across a gap shorter than attack + release', () => {
    expect(compSpeech(c, ts, { mergeGapFrames: 10 })).toEqual([
      [15, 39],
      [87, 101],
    ]);
  });

  test('a voiceover on the music track ducks the bed; the bed never ducks itself', () => {
    const src = SRC.replace(
      '    <Captions words="line" />',
      `    <Sequence name="vo" from={0} durationInFrames={60}><Audio src="${C}" /></Sequence>\n    <Captions words="line" />`
    );
    const cc = compClips(CANVAS, src, 'reel');
    const vo = cc.clips.find((k) => k.stableId === 'name:vo');
    expect(vo?.track).toBe('music');
    expect(compSpeech(cc, ts)[0]).toEqual([0, 39]); // the voice-over's 0..15 touches clip a's 15..39
    // the bed itself, when named as the exception, contributes none of its own
    const bedTs = {
      ...ts,
      [M]: transcript(M, { speech: { source: 'energy', regions: [[0, 9]] } }),
    };
    expect(compSpeech(cc, bedTs, { exceptSrc: M }).some(([a, b]) => a === 0 && b >= 140)).toBe(
      false
    );
    expect(compSpeech(cc, bedTs).some(([a, b]) => a === 0 && b >= 140)).toBe(true);
  });

  test('duckGain is 1 outside speech, 10^(db/20) inside, a linear-in-dB ramp either side', () => {
    const o = { db: -12, attackFrames: 6, releaseFrames: 12 };
    const speech: Array<[number, number]> = [[100, 200]];
    const full = 10 ** (-12 / 20);
    const half = 10 ** (-6 / 20);
    expect(duckGain(0, speech, o)).toBe(1);
    expect(duckGain(94, speech, o)).toBe(1);
    expect(duckGain(97, speech, o)).toBeCloseTo(half, 6);
    expect(duckGain(100, speech, o)).toBeCloseTo(full, 6);
    expect(duckGain(199, speech, o)).toBeCloseTo(full, 6);
    expect(duckGain(200, speech, o)).toBeCloseTo(full, 6);
    expect(duckGain(206, speech, o)).toBeCloseTo(half, 6);
    expect(duckGain(212, speech, o)).toBe(1);
    expect(duckGain(500, speech, o)).toBe(1);
    // no regions, and db >= 0, change nothing
    expect(duckGain(150, [], o)).toBe(1);
    expect(duckGain(150, speech, { ...o, db: 3 })).toBe(1);
  });

  test('a pure function of the frame: overlapping ramps take the deeper of the two', () => {
    const o = { db: -12, attackFrames: 10, releaseFrames: 10 };
    const speech: Array<[number, number]> = [
      [100, 110],
      [115, 130],
    ];
    // frame 112 is in the first region's release (-12 · (1 − 2/10)) and the second's attack (-12 · 7/10)
    const a = duckGain(112, speech, o);
    const dbOf = (g: number) => 20 * Math.log10(g);
    expect(dbOf(a)).toBeCloseTo(-12 * 0.8, 5);
    expect(duckGain(112, speech, o)).toBe(a);
  });
});

describe('compBeats — the music clip’s grid in comp frames', () => {
  test('beats inside the played source range, shifted by the trim, as comp frames', () => {
    const c = compClips(CANVAS, SRC, 'reel');
    // bed: trimBefore 15 frames = source 0.5 s; comp frame = round(beat·30 − 15)
    const grid = {
      format: 'maude.beats',
      v: 1,
      asset: M,
      durationSec: 10,
      analyzer: { id: 'maude-beats', version: 1, decode: 'ffmpeg' },
      bpm: 120,
      bpmSource: 'detected',
      tempoStrength: 0.8,
      beats: [0.25, 0.5, 1, 1.5, 2, 30],
      bar: { phase: 0, confidence: 0.9 },
      createdAt: '2026-10-18T09:00:00.000Z',
    } as BeatGrid;
    // 0.25 s is before the trim; 30 s is past the clip's end (0.5 s + 140 frames = 5.17 s)
    expect(compBeats(c, { [M]: grid })).toEqual([0, 15, 30, 45]);
  });

  test('a comp with no grid has no beats', () => {
    expect(compBeats(compClips(CANVAS, SRC, 'reel'), {})).toEqual([]);
  });
});

describe('transcriptCut — edit by transcript (§5.6)', () => {
  const t = transcript(A, {
    words: [
      { id: 'w0', t0: 1.0, t1: 1.4, text: 'a' },
      { id: 'w1', t0: 1.5, t1: 1.9, text: 'b' }, // 100 ms after w0
      { id: 'w2', t0: 1.93, t1: 2.3, text: 'c' }, // 30 ms after w1: a short gap
      { id: 'w3', t0: 3.0, t1: 3.4, text: 'd' },
    ],
  });

  test('a gap of at least 60 ms is cut at its midpoint; both edges mirror', () => {
    const r = transcriptCut(t, ['w1']);
    // before w1: gap 1.4..1.5 (100 ms) → 1.45. After w1: gap 1.9..1.93 (30 ms) → no midpoint rule
    expect(r.srcStart).toBeCloseTo(1.45, 6);
  });

  test('a long gap on both sides → midpoints, in a pause', () => {
    const r = transcriptCut(t, ['w2']);
    // before: 1.9..1.93 is short; after: 2.3..3.0 (700 ms) → 2.65
    expect(r.srcEnd).toBeCloseTo(2.65, 6);
    const r2 = transcriptCut(t, ['w3']);
    expect(r2.srcStart).toBeCloseTo(2.65, 6);
  });

  test('a short gap cuts at the quietest 10 ms frame within ±50 ms of the edge', () => {
    // 10 ms frames; loud everywhere (1) except frame 196 (1.96 s), the quietest near w2.t0 = 1.93
    const energy = new Float32Array(400).fill(1);
    energy[196] = 0.001;
    const r = transcriptCut(t, ['w2'], energy);
    expect(r.srcStart).toBeCloseTo(1.96, 6);
  });

  test('a cut that is not in silence says so; one in a pause does not', () => {
    const loud = new Float32Array(400).fill(1);
    expect(transcriptCut(t, ['w2'], loud).inPause).toBe(false);
    const quiet = new Float32Array(400).fill(0.0001);
    quiet.fill(1, 100, 140); // w0 voiced 1.0..1.4
    quiet.fill(1, 150, 190); // w1 voiced 1.5..1.9
    expect(transcriptCut(t, ['w1'], quiet).inPause).toBe(true);
    // no energy at all: the midpoint branch is the pause
    expect(transcriptCut(t, ['w3']).inPause).toBe(true);
  });

  test('a run of words is one cut from the first edge to the last; edges are quantised to frames', () => {
    const r = transcriptCut(t, ['w1', 'w2'], undefined, { fps: 25 });
    expect(r.srcStart).toBeCloseTo(36 / 25, 9); // 1.45 s · 25 = 36.25 → frame 36
    expect(r.srcEnd).toBeCloseTo(66 / 25, 9); //   2.65 s · 25 = 66.25 → frame 66
  });

  test('unknown word ids select nothing', () => {
    expect(() => transcriptCut(t, ['nope'])).toThrow();
  });
});

describe('reframeWindow + placeAt — framing math (§5.3, §5.8)', () => {
  test('a 9:16 window out of a 16:9 source, centred on the focus point, clamped to the source', () => {
    const src = { w: 1920, h: 1080 };
    const out = { w: 1080, h: 1920 };
    const r = reframeWindow([0.5, 0.42], src, out, 1);
    expect(r.w).toBeCloseTo(607.5, 6);
    expect(r.h).toBeCloseTo(1080, 6);
    expect(r.x).toBeCloseTo(960 - 303.75, 6);
    expect(r.y).toBe(0);
    // a focus at the edge clamps; zoom 2 halves the window and lets y move
    expect(reframeWindow([0, 0.5], src, out, 1).x).toBe(0);
    expect(reframeWindow([1, 0.5], src, out, 1).x).toBeCloseTo(1920 - 607.5, 6);
    const z = reframeWindow([0.5, 0.42], src, out, 2);
    expect(z.w).toBeCloseTo(303.75, 6);
    expect(z.h).toBeCloseTo(540, 6);
    expect(z.y).toBeCloseTo(1080 * 0.42 - 270, 6);
    // zoom below 1 is 1
    expect(reframeWindow([0.5, 0.5], src, out, 0.2).w).toBeCloseTo(607.5, 6);
  });

  test('a source narrower than the output aspect crops the height instead', () => {
    const r = reframeWindow([0.5, 0.5], { w: 1080, h: 1920 }, { w: 1920, h: 1080 }, 1);
    expect(r.w).toBeCloseTo(1080, 6);
    expect(r.h).toBeCloseTo(607.5, 6);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo(960 - 303.75, 6);
  });

  test('aspectKey reduces W:H; placeAt picks formats["W:H"] ?? at, a centre anchor in output pixels', () => {
    expect(aspectKey(1080, 1920)).toBe('9:16');
    expect(aspectKey(1920, 1080)).toBe('16:9');
    expect(aspectKey(1000, 1000)).toBe('1:1');
    const spec = {
      at: [0.5, 0.8] as [number, number],
      formats: { '9:16': [0.5, 0.7] as [number, number] },
    };
    expect(placeAt(spec, { w: 1080, h: 1920 })).toEqual({ x: 540, y: 1344 });
    expect(placeAt(spec, { w: 1920, h: 1080 })).toEqual({ x: 960, y: 864 });
    expect(placeAt({ at: [2, -1] }, { w: 100, h: 100 })).toEqual({ x: 100, y: 0 }); // clamped to the frame
  });
});

describe('determinism', () => {
  test('the same inputs give byte-identical output', () => {
    const c1 = compClips(CANVAS, SRC, 'reel');
    const c2 = compClips(CANVAS, SRC, 'reel');
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
    const ts = { [A]: TA, [B]: TB };
    expect(JSON.stringify(compWords(c1, ts))).toBe(JSON.stringify(compWords(c2, ts)));
  });
});

// a type-level guard that the exported span shape is what the contract names
const _span: ClipSpan | undefined = undefined;
void _span;
