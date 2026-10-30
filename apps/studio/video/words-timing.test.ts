// video/words-timing.test.ts — V2-1.10 §7 test #3 (S7.2): lag calibration + energy snap.
//
// No whisper, no `say`: the truth is built here — a voiced noise burst per word on a quiet floor —
// and the "whisper" words are the truth shifted by a DTW lag with jitter and bridged to the next
// word (what raw DTW output does, §6.1). Everything is deterministic (a seeded LCG).

import { describe, expect, test } from 'bun:test';
import { dtwWords, SR, synth, truthLine } from '../test/fixtures/video/synth.ts';
import type { RawWord } from './whisper-parse.ts';
import {
  capText,
  flagLoops,
  frameDb,
  measureLag,
  regionsFromMask,
  timeWords,
  voicingFromDb,
  voicingFromPcm,
} from './words-timing.ts';

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

describe('timeWords — lag calibration + energy snap on a built truth', () => {
  const { truth, pauses } = truthLine();
  const total = truth[truth.length - 1].end + 0.6;
  const pcm = synth(truth, total);
  const voicing = voicingFromPcm(pcm, SR);

  test('the measured lag is the DTW lag that was put in (±30 ms) and is removed', () => {
    const raw = dtwWords(truth, 0.17);
    const lag = measureLag(raw, voicing.onsets);
    expect(Math.abs(lag - 0.17)).toBeLessThan(0.03);
    const r = timeWords(raw, 'dtw', voicing);
    expect(Math.abs(r.lagMs - 170)).toBeLessThan(30);
  });

  test('word starts: p90 ≤ 150 ms and ≥ 95 % within 200 ms of the truth (§5.11)', () => {
    const r = timeWords(dtwWords(truth, 0.17), 'dtw', voicing);
    const err = r.words.map((w, i) => Math.abs(w.t0 - truth[i].start));
    expect(pct(err, 90)).toBeLessThanOrEqual(0.15);
    expect(err.filter((e) => e <= 0.2).length / err.length).toBeGreaterThanOrEqual(0.95);
  });

  test('raw DTW bridges every pause; the snap leaves ≤ 10 % bridged (§5.11)', () => {
    const bridged = (ws: Array<{ t0: number; t1: number }>) =>
      pauses.filter(([a, b]) => ws.some((w) => w.t0 < a && w.t1 > (a + b) / 2)).length; // a word reaches past the middle of the pause
    expect(pauses.length).toBeGreaterThanOrEqual(8);
    const raw = dtwWords(truth, 0.17).map((w, i) => ({ t0: w.start, t1: w.end, i }));
    // the raw clock puts every pause inside the word that ends where the next one begins
    expect(bridged(raw) / pauses.length).toBeGreaterThanOrEqual(0.9);
    const r = timeWords(dtwWords(truth, 0.17), 'dtw', voicing);
    expect(bridged(r.words) / pauses.length).toBeLessThanOrEqual(0.1);
  });

  test('no lag is measured with fewer than 2 matched onsets (one continuous run → 0)', () => {
    const one = [{ start: 0.3, end: 3.3 }];
    const v = voicingFromPcm(synth(one, 3.6), SR);
    expect(v.onsets.length).toBe(1);
    const raw: RawWord[] = [{ text: 'a', start: 0.47, end: 1.0, dtw: true }];
    expect(measureLag(raw, v.onsets)).toBe(0);
    expect(timeWords(raw, 'dtw', v).lagMs).toBe(0);
  });

  test('a word with no voiced frame keeps its start and is held to 120 ms', () => {
    const quiet = voicingFromDb(new Float32Array(500).fill(-90));
    expect(quiet.mask.some((m) => m === 1)).toBe(false); // a silent file is not voiced relative to itself
    const raw: RawWord[] = [{ text: 'hmm', start: 1.0, end: 1.9, dtw: true }];
    const r = timeWords(raw, 'dtw', quiet);
    expect(r.words[0].t0).toBe(1);
    expect(r.words[0].t1).toBeCloseTo(1.12, 3);
    expect(r.voiced).toEqual([false]);
  });

  test('a snapped word is at least 60 ms and sorted; ids are w0, w1, …', () => {
    const r = timeWords(dtwWords(truth, 0.17), 'dtw', voicing);
    expect(r.words.map((w) => w.id).slice(0, 3)).toEqual(['w0', 'w1', 'w2']);
    for (let i = 0; i < r.words.length; i++) {
      expect(r.words[i].t1 - r.words[i].t0).toBeGreaterThanOrEqual(0.059);
      if (i) expect(r.words[i].t0).toBeGreaterThanOrEqual(r.words[i - 1].t0);
    }
  });

  test('"segment" timing is left as whisper gave it: no lag removed, nothing snapped', () => {
    const raw = dtwWords(truth, 0.17).map((w) => ({ ...w, dtw: false }));
    const r = timeWords(raw, 'segment', voicing);
    expect(r.lagMs).toBe(0);
    expect(r.words[0].t0).toBeCloseTo(Math.round(raw[0].start * 1000) / 1000, 3);
    // …but a word is still marked voiced or not, for the speech regions
    expect(r.voiced.length).toBe(raw.length);
  });

  test('same input → same output (pure)', () => {
    const a = JSON.stringify(timeWords(dtwWords(truth, 0.17), 'dtw', voicing));
    const b = JSON.stringify(timeWords(dtwWords(truth, 0.17), 'dtw', voicing));
    expect(a).toBe(b);
  });
});

describe('voicing', () => {
  test('islands: gaps < 60 ms close, islands < 40 ms drop; onsets follow pauses ≥ 150 ms', () => {
    const mask = new Uint8Array(400);
    mask.fill(1, 10, 60); // 0.10–0.60
    mask.fill(1, 64, 100); // 40 ms gap → closed into the first island
    mask.fill(1, 130, 133); // 30 ms island → dropped
    mask.fill(1, 200, 260); // after a 100 ms gap from 100.. → pause ≥ 150 ms
    const regs = regionsFromMask(mask, 0.01, 0.06, 0.04);
    expect(regs).toEqual([
      [0.1, 1.0],
      [2.0, 2.6],
    ]);
    const db = Float32Array.from(mask, (m) => (m ? -20 : -80));
    expect(voicingFromDb(db).onsets).toEqual([0.1, 2.0]);
  });

  test('frameDb is 10 ms RMS in dBFS', () => {
    const pcm = new Float32Array(SR).fill(0.1); // −20 dBFS
    const db = frameDb(pcm, SR);
    expect(db.length).toBe(100);
    expect(db[0]).toBeCloseTo(-20, 1);
  });
});

describe('flagLoops (step 6)', () => {
  test('"Čej!" × 24 — the multilingual-model loop — is all flagged', () => {
    const f = flagLoops(Array.from({ length: 24 }, () => 'Čej!'));
    expect(f.every(Boolean)).toBe(true);
  });

  test('3 identical in a row is a loop, 2 is not; case and punctuation fold', () => {
    expect(flagLoops(['jo,', 'Jo', 'JO.'])).toEqual([true, true, true]);
    expect(flagLoops(['ehm', 'ehm', 'well'])).toEqual([false, false, false]);
    expect(flagLoops(['a', 'x', 'x', 'x', 'b', 'x', 'x'])).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  test('the loop flag lands on the word (`flags: ["loop"]`) and nowhere else', () => {
    const raw: RawWord[] = ['a', 'Čej!', 'čej', 'ČEJ.', 'b'].map((text, i) => ({
      text,
      start: i,
      end: i + 0.5,
      dtw: false,
    }));
    const r = timeWords(raw, 'segment', null);
    expect(r.words.map((w) => w.flags ?? null)).toEqual([null, ['loop'], ['loop'], ['loop'], null]);
  });
});

describe('capText', () => {
  test('caps at 64 UTF-16 units and never cuts a surrogate pair', () => {
    expect(capText('x'.repeat(100)).length).toBe(64);
    const s = `${'x'.repeat(63)}😀tail`;
    const c = capText(s);
    expect(c.length).toBeLessThanOrEqual(64);
    expect(c.endsWith('x')).toBe(true);
  });
});
