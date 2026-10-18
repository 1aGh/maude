// S7.4 budget (V2-1.10 §5.11): deriving captions, speech and beats for 100 clips and 5 000 words
// takes ≤ 30 ms. Skipped under a load flag (MAUDE_SKIP_BENCH=1): headless timings swing with machine
// load, and a lane shared with other builders is exactly that. The numbers are the contract's.

import { describe, expect, test } from 'bun:test';

import { type ClipSpan, type CompClips, compBeats, compSpeech, compWords } from './derive.ts';
import type { BeatGrid, Transcript } from './schema.ts';

const SRC = 'assets/aaaaaaaa.mp4';
const MUSIC = 'assets/bbbbbbbb.mp3';
const FPS = 30;

function fixture(): {
  c: CompClips;
  ts: Record<string, Transcript>;
  grids: Record<string, BeatGrid>;
} {
  // ONE long source of 5 000 words, cut into 100 clips: every clip scans the whole word list, the
  // worst case for the derivation.
  const words = Array.from({ length: 5000 }, (_, i) => ({
    id: `w${i}`,
    t0: i * 0.4,
    t1: i * 0.4 + 0.3,
    text: `slovo${i}`,
    p: 0.9,
  }));
  const regions: Array<[number, number]> = [];
  for (let i = 0; i < 5000; i += 5) regions.push([i * 0.4, i * 0.4 + 1.3]);
  const t = {
    format: 'maude.transcript',
    v: 1,
    asset: SRC,
    engine: { id: 'whisper.cpp', timing: 'dtw+energy' },
    words,
    speech: { source: 'words', regions },
    createdAt: '2026-10-18T09:00:00.000Z',
  } as Transcript;
  const clips: ClipSpan[] = [];
  for (let i = 0; i < 100; i++) {
    clips.push({
      stableId: `Reel#${i}`,
      track: 'video',
      src: SRC,
      from: i * 60,
      durationInFrames: 60,
      trimBefore: i * 600,
      playbackRate: 1,
      muted: false,
    });
  }
  clips.push({
    stableId: 'loose:bed',
    track: 'music',
    src: MUSIC,
    from: 0,
    durationInFrames: 6000,
    trimBefore: 0,
    playbackRate: 1,
    muted: false,
    loose: true,
  });
  const grid = {
    format: 'maude.beats',
    v: 1,
    asset: MUSIC,
    durationSec: 200,
    analyzer: { id: 'maude-beats', version: 1, decode: 'ffmpeg' },
    bpm: 120,
    bpmSource: 'detected',
    tempoStrength: 0.8,
    beats: Array.from({ length: 400 }, (_, i) => i * 0.5),
    bar: { phase: 0, confidence: 0.9 },
    createdAt: '2026-10-18T09:00:00.000Z',
  } as BeatGrid;
  return {
    c: { fps: FPS, total: 6000, clips, unresolved: [] },
    ts: { [SRC]: t },
    grids: { [MUSIC]: grid },
  };
}

const skip = process.env.MAUDE_SKIP_BENCH === '1';

describe.skipIf(skip)('derive budget — 100 clips / 5 000 words ≤ 30 ms', () => {
  test('compWords + compSpeech + compBeats', () => {
    const { c, ts, grids } = fixture();
    // warm the JIT once, then take the best of five: the budget is the derivation's, not a GC pause's
    compWords(c, ts);
    let best = Number.POSITIVE_INFINITY;
    let words = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      words = compWords(c, ts).length;
      compSpeech(c, ts, { mergeGapFrames: 18 });
      compBeats(c, grids);
      best = Math.min(best, performance.now() - t0);
    }
    expect(words).toBeGreaterThan(100); // the work really ran
    expect(best).toBeLessThanOrEqual(30);
  });
});
