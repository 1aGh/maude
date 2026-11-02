// V2-1.10 §7 test #7 — the in-house beat detector on in-test deterministic synthetic music (the §6.3
// generator): F ≥ 0.85 on the in-range tracks, `--bpm` re-tracks and keeps the bar phase, and the
// "ffmpeg filters only" baseline stays under 0.7 so the comparison stays honest.

import { describe, expect, test } from 'bun:test';

import { ffmpegOnlyBaseline, fMeasure, render, type Track } from '../test/_beats-synth.ts';
import { analyzeBeats, beatGridFrom, downbeatsOf } from './beats.ts';
import { readBeats, serializeBeats } from './schema.ts';

/** The four in-range tracks of V2-1.10 §6.3 (80–160 BPM) plus the swing / drift / straight cases. */
const IN_RANGE: Track[] = [
  { name: 'house 120', bpm: 120, pattern: 'house', durationSec: 30 },
  { name: 'swung hip-hop 92', bpm: 92, pattern: 'hiphop', swing: 0.62, durationSec: 30 },
  { name: 'half-time 140', bpm: 140, pattern: 'halftime', durationSec: 30 },
  {
    name: '8 s pad intro then 100',
    bpm: 100,
    pattern: 'hiphop',
    swing: 0.58,
    introSec: 8,
    durationSec: 34,
  },
  { name: 'hip-hop 84 swing', bpm: 84, pattern: 'hiphop', swing: 0.6, durationSec: 30 },
  { name: 'heavy swing 110', bpm: 110, pattern: 'hiphop', swing: 0.66, durationSec: 30 },
  { name: 'house 128 drifting ±1.5 %', bpm: 128, pattern: 'house', drift: 0.015, durationSec: 30 },
  { name: 'straight house 100', bpm: 100, pattern: 'house', durationSec: 30 },
];
/** Tracks where an octave / 3:2 slip is the documented limit (§6.3) — measured, never asserted per track. */
const HARD: Track[] = [
  { name: 'dnb 174', bpm: 174, pattern: 'dnb', durationSec: 30 },
  { name: 'house 150', bpm: 150, pattern: 'house', durationSec: 30 },
];

const cache = new Map<string, ReturnType<typeof render>>();
const rendered = (t: Track) => {
  let r = cache.get(t.name);
  if (!r) {
    r = render(t);
    cache.set(t.name, r);
  }
  return r;
};

describe('beats — F-measure on synthetic tracks (V2-1.10 #7)', () => {
  for (const track of IN_RANGE) {
    test(`${track.name}: F ≥ 0.85 and tempo within 4 %`, () => {
      const r = rendered(track);
      const a = analyzeBeats(r.samples);
      expect(fMeasure(a.beats, r.truth)).toBeGreaterThanOrEqual(0.85);
      expect(Math.abs(a.bpm - track.bpm) / track.bpm).toBeLessThan(0.04);
      expect(a.bpmSource).toBe('detected');
      expect(a.tempoStrength).toBeGreaterThan(0.15);
    });
  }

  test('the pad intro is not tracked: no beat before the drums start', () => {
    const t = IN_RANGE.find((x) => x.introSec) as Track;
    const a = analyzeBeats(rendered(t).samples);
    expect(a.beats[0]).toBeGreaterThan((t.introSec as number) - 0.15);
  });

  test('beats sit on the hit: median error under 25 ms', () => {
    const r = rendered(IN_RANGE[0] as Track);
    const a = analyzeBeats(r.samples);
    const errs = a.beats
      .map((b) => Math.min(...r.truth.map((t) => Math.abs(t - b))))
      .sort((x, y) => x - y);
    expect(errs[Math.floor(errs.length / 2)]).toBeLessThan(0.025);
  });

  test('the ffmpeg-only baseline stays under 0.7 while the detector clears it', () => {
    const all = [...IN_RANGE, ...HARD];
    let base = 0;
    let js = 0;
    for (const t of all) {
      const r = rendered(t);
      base += fMeasure(ffmpegOnlyBaseline(r.samples, t.durationSec), r.truth);
      js += fMeasure(analyzeBeats(r.samples).beats, r.truth);
    }
    base /= all.length;
    js /= all.length;
    expect(base).toBeLessThan(0.7);
    expect(js).toBeGreaterThan(base + 0.2);
  });

  test('deterministic: the same samples give the same bytes', () => {
    const r = rendered(IN_RANGE[1] as Track);
    const a = analyzeBeats(r.samples);
    const b = analyzeBeats(new Float32Array(r.samples));
    expect(b).toEqual(a);
  });
});

describe('beats — --bpm re-tracks and keeps the bar phase', () => {
  const swung = IN_RANGE[1] as Track; // the kick lands on the 1 only, so the bar phase is audible

  test('the detected bar phase puts the downbeats on the truth downbeats', () => {
    const r = rendered(swung);
    const a = analyzeBeats(r.samples);
    expect(a.bar.confidence).toBeGreaterThan(0.4);
    const downs = downbeatsOf({ beats: a.beats, bar: a.bar });
    const near = downs.filter((d) => r.downbeats.some((t) => Math.abs(t - d) < 0.07)).length;
    expect(near / downs.length).toBeGreaterThan(0.85);
  });

  test('--bpm at the detected tempo gives the same phase and still tracks', () => {
    const r = rendered(swung);
    const first = analyzeBeats(r.samples);
    const again = analyzeBeats(r.samples, {
      bpm: first.bpm,
      keepDownbeats: downbeatsOf({ beats: first.beats, bar: first.bar }),
    });
    expect(again.bpmSource).toBe('set');
    expect(again.bpm).toBe(first.bpm);
    expect(again.bar.phase).toBe(first.bar.phase);
    expect(fMeasure(again.beats, r.truth)).toBeGreaterThanOrEqual(0.85);
  });

  test('--bpm with a nudged tempo keeps the phase of the old downbeats', () => {
    const r = rendered(swung);
    const first = analyzeBeats(r.samples);
    const old = downbeatsOf({ beats: first.beats, bar: first.bar });
    const nudged = analyzeBeats(r.samples, { bpm: 92, keepDownbeats: old });
    expect(nudged.bpmSource).toBe('set');
    expect(nudged.bpm).toBe(92);
    const downs = downbeatsOf({ beats: nudged.beats, bar: nudged.bar });
    const near = downs.filter((d) => old.some((t) => Math.abs(t - d) < 0.1)).length;
    expect(near / downs.length).toBeGreaterThan(0.85);
  });

  test('the old downbeats win over the low-band vote: shifted by one beat moves the phase by one', () => {
    const r = rendered(swung);
    const first = analyzeBeats(r.samples);
    const one = first.beats[first.bar.phase + 1] as number;
    const shifted = [
      one,
      ...downbeatsOf({ beats: first.beats, bar: first.bar })
        .slice(1)
        .map((t) => t + (one - (first.beats[first.bar.phase] as number))),
    ];
    const again = analyzeBeats(r.samples, { bpm: first.bpm, keepDownbeats: shifted });
    expect(again.bar.phase).toBe((first.bar.phase + 1) % 4);
  });

  test('--bpm fixes an octave slip: 174 detected as 87 is re-tracked at 174', () => {
    const t = HARD[0] as Track;
    const r = rendered(t);
    const detected = analyzeBeats(r.samples);
    expect(detected.bpm).toBeLessThan(100); // the documented limit — the person or AI fixes it
    const fixed = analyzeBeats(r.samples, { bpm: 174 });
    expect(fixed.bpm).toBe(174);
    expect(fixed.bpmSource).toBe('set');
    expect(fMeasure(fixed.beats, r.truth)).toBeGreaterThanOrEqual(0.85);
  });
});

describe('beats — edge inputs', () => {
  test('silence, noise and a short clip never throw and say "no clear beat"', () => {
    const silence = analyzeBeats(new Float32Array(22_050 * 10));
    expect(silence.beats).toEqual([]);
    expect(silence.tempoStrength).toBe(0);
    let s = 12345;
    const noise = new Float32Array(22_050 * 20);
    for (let i = 0; i < noise.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      noise[i] = (s / 0x100000000 - 0.5) * 0.4;
    }
    expect(analyzeBeats(noise).tempoStrength).toBeLessThan(0.15);
    const short = analyzeBeats(new Float32Array(2000));
    expect(short.beats).toEqual([]);
    expect(short.durationSec).toBeCloseTo(0.091, 3);
  });
});

describe('beats — the grid round-trips through the strict writer', () => {
  test('beatGridFrom → serializeBeats → readBeats', () => {
    const r = rendered(IN_RANGE[0] as Track);
    const a = analyzeBeats(r.samples);
    const grid = beatGridFrom('assets/m.mp3', a, 'ffmpeg', '2026-10-18T09:00:00.000Z');
    const text = serializeBeats(grid, 'assets/m.beats.json');
    const back = readBeats(text, 'assets/m.beats.json');
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value.beats).toEqual(a.beats);
      expect(back.value.analyzer).toEqual({ id: 'maude-beats', version: 1, decode: 'ffmpeg' });
    }
    // 3 decimals on beats, 2 on bpm — what the format promises
    for (const b of a.beats) expect(Math.round(b * 1000) / 1000).toBe(b);
    expect(Math.round(a.bpm * 100) / 100).toBe(a.bpm);
  });
});
