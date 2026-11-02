// video/speech.test.ts — V2-1.10 §7 test #4 (S7.2): speech regions come from words.

import { describe, expect, test } from 'bun:test';
import { dtwWords, regionScore, SR, synth, truthLine } from '../test/fixtures/video/synth.ts';
import type { TranscriptWord } from './schema.ts';
import { energySpeechRegions, speechRegionsFromWords, speechSeconds } from './speech.ts';
import { timeWords, voicingFromPcm } from './words-timing.ts';

const w = (id: number, t0: number, t1: number, extra: Partial<TranscriptWord> = {}) => ({
  id: `w${id}`,
  t0,
  t1,
  text: `x${id}`,
  p: 0.9,
  ...extra,
});

describe('speechRegionsFromWords (§5.6 step 7)', () => {
  test('"Čej!" × 24 — the loop-flagged hallucination — gives 0 s of regions', () => {
    const words = Array.from({ length: 24 }, (_, i) =>
      w(i, i * 0.5, i * 0.5 + 0.4, { text: 'Čej!', p: 0.99, flags: ['loop'] })
    );
    const r = speechRegionsFromWords(
      words,
      words.map(() => true)
    );
    expect(r).toEqual([]);
    expect(speechSeconds(r)).toBe(0);
  });

  test('p < 0.35 and unvoiced words are left out; an absent p counts as confident', () => {
    const words = [
      w(0, 1, 1.4, { p: 0.34 }),
      w(1, 3, 3.4, { p: 0.35 }),
      w(2, 5, 5.4, { p: undefined }),
      w(3, 7, 7.4),
    ];
    const r = speechRegionsFromWords(words, [true, true, true, false]);
    expect(r).toEqual([
      [2.88, 3.52],
      [4.88, 5.52],
    ]);
  });

  test('padded by 0.12 s, merged across gaps < 0.8 s, kept apart from 0.8 s', () => {
    // padded: [0.38, 1.12] and [1.78, 2.52]: gap 0.66 → merged
    const merged = speechRegionsFromWords([w(0, 0.5, 1.0), w(1, 1.9, 2.4)], [true, true]);
    expect(merged).toEqual([[0.38, 2.52]]);
    // padded: [0.38, 1.12] and [2.0, 2.52]: gap 0.88 → apart
    const apart = speechRegionsFromWords([w(0, 0.5, 1.0), w(1, 2.12, 2.4)], [true, true]);
    expect(apart.length).toBe(2);
  });

  test('the first region never starts before 0 and regions are sorted and disjoint', () => {
    const r = speechRegionsFromWords(
      [w(0, 0.05, 0.3), w(1, 5, 5.3), w(2, 9, 9.3)],
      [true, true, true]
    );
    expect(r[0][0]).toBe(0);
    for (let i = 1; i < r.length; i++) expect(r[i][0]).toBeGreaterThan(r[i - 1][1]);
  });

  test('VO-like fixture: recall ≥ 0.95 of the voiced truth at the defaults (§5.11 / test #4)', () => {
    const { truth } = truthLine();
    const total = truth[truth.length - 1].end + 0.6;
    const voicing = voicingFromPcm(synth(truth, total), SR);
    const t = timeWords(dtwWords(truth, 0.17), 'dtw', voicing);
    const regions = speechRegionsFromWords(t.words, t.voiced, total);
    const score = regionScore(
      truth.map((x) => [x.start, x.end] as [number, number]),
      regions,
      total
    );
    expect(score.recall).toBeGreaterThanOrEqual(0.95);
    // the held gaps inside phrases are speech to a ducker (§6.2): precision is not the budget
    expect(score.precision).toBeGreaterThan(0.6);
  });
});

describe('energySpeechRegions — the labelled fallback (--speech-only)', () => {
  test('finds the voiced stretches and closes silences shorter than 0.35 s', () => {
    // 1.0–2.0 s and 2.2–3.0 s (a 0.2 s silence → one region), then 5.0–5.6 s (a 2 s silence → apart)
    const pcm = synth(
      [
        { start: 1.0, end: 2.0 },
        { start: 2.2, end: 3.0 },
        { start: 5.0, end: 5.6 },
      ],
      6.5
    );
    const r = energySpeechRegions(pcm, SR);
    expect(r.length).toBe(2);
    expect(r[0][0]).toBeCloseTo(1.0, 1);
    expect(r[0][1]).toBeCloseTo(3.0, 1);
    expect(r[1][0]).toBeCloseTo(5.0, 1);
  });

  test('is band-limited to 150 Hz – 4 kHz: a loud 30 Hz rumble is not speech', () => {
    const pcm = synth([{ start: 2, end: 3 }], 5);
    for (let i = 0; i < pcm.length; i++) pcm[i] += 0.3 * Math.sin((2 * Math.PI * 30 * i) / SR);
    const r = energySpeechRegions(pcm, SR);
    expect(r.length).toBe(1);
    expect(r[0][0]).toBeGreaterThan(1.8);
    expect(r[0][1]).toBeLessThan(3.3);
  });

  test('a silent file has no regions', () => {
    expect(energySpeechRegions(new Float32Array(SR * 2), SR)).toEqual([]);
  });
});
