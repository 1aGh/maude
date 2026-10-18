// video/whisper-parse.test.ts — V2-1.10 §7 tests #1 and #2 (S7.2).
// The committed fixtures are in whisper.cpp's real JSON shape, synthesised (no model on the CI
// machine): the same V5 showreel line (vo-65) in the proposed `-ojf -ml 1 -sow -dtw -nfa` shape and
// in today's `-oj -ml 1` shape.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { whisperJsonToWords } from '../bin/_transcribe.mjs';
import { parseWhisperFull } from './whisper-parse.ts';

const FIX = `${import.meta.dir}/../test/fixtures/video`;
const OJF = readFileSync(`${FIX}/whisper-vo65.ojf.json`, 'utf8');
const OJ = readFileSync(`${FIX}/whisper-vo65.oj-ml1.json`, 'utf8');

describe('parseWhisperFull — the -ojf words (V2-1.10 §5.6 step 3)', () => {
  test('words are whole words: no punctuation-only items, no sub-words, no non-speech tags', () => {
    const { words } = parseWhisperFull(OJF);
    expect(words.map((w) => w.text)).toEqual([
      'And',
      "you're",
      'not',
      'the',
      'only',
      'cursor.',
      'Live,',
      'peer',
      'to',
      'peer,',
      'through',
      'a',
      'hub',
      'you',
      'run',
      'no',
      'SaaS,',
      'no',
      'sign-up.',
    ]);
    for (const w of words) expect(/[\p{L}\p{N}]/u.test(w.text)).toBe(true);
    // [MUSIC], the lone dash and *click* are dropped by rule
    expect(words.some((w) => /^[[(*♪]/.test(w.text))).toBe(false);
  });

  test("start is the DTW time of the word's first text token, in seconds", () => {
    const r = parseWhisperFull(OJF);
    expect(r.timing).toBe('dtw');
    // fixture: segment starts at 0.30 s, DTW lag +0.17 s → t_dtw = 47 cs
    expect(r.words[0].start).toBeCloseTo(0.47, 5);
    expect(r.words[0].dtw).toBe(true);
    expect(r.lang).toBe('en');
  });

  test('end = next word start, capped by the segment end and start + 1.2 s', () => {
    const { words } = parseWhisperFull(OJF);
    const [and, youre] = words;
    // "And": DTW start 0.47, segment end 0.52 (before the start + 0.1 s floor 0.57), the next word
    // starts at 0.72 → the segment end, floored at start + 0.1 s, caps it
    expect(and.end).toBeCloseTo(0.57, 5);
    // a word whose next word is far away is capped at start + 1.2 s
    const long = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 5000 },
          text: ' Hello',
          tokens: [{ text: ' Hello', p: 0.9, t_dtw: 10 }],
        },
        {
          offsets: { from: 5000, to: 5400 },
          text: ' there',
          tokens: [{ text: ' there', p: 0.9, t_dtw: 500 }],
        },
      ],
    });
    const w = parseWhisperFull(long).words;
    expect(w[0].end).toBeCloseTo(0.1 + 1.2, 5);
    expect(youre.start).toBeGreaterThan(and.start);
  });

  test('p is the lowest token probability of the word', () => {
    const doc = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 600 },
          text: ' SaaS,',
          tokens: [
            { text: ' S', p: 0.91, t_dtw: 5 },
            { text: 'aa', p: 0.42, t_dtw: 9 },
            { text: 'S', p: 0.8, t_dtw: 12 },
            { text: ',', p: 0.99, t_dtw: 15 },
            { text: '[_TT_30]', p: 0.0001, t_dtw: -1 },
          ],
        },
      ],
    });
    const [w] = parseWhisperFull(doc).words;
    expect(w.p).toBe(0.42); // the special token's 0.0001 never counts
  });

  test('a file that is not JSON, or has no transcription, is an empty parse and never throws', () => {
    expect(parseWhisperFull('not json').words).toEqual([]);
    expect(parseWhisperFull('{}').words).toEqual([]);
    expect(parseWhisperFull('[1,2]').words).toEqual([]);
    expect(parseWhisperFull('{"transcription":[null,3,{"text":5}]}').words).toEqual([]);
  });
});

describe('parseWhisperFull — t_dtw = -1 is segment timing, never DTW (test #2)', () => {
  test('every text token without a DTW time → engine.timing "segment", start = segment start', () => {
    const doc = JSON.parse(OJF);
    for (const seg of doc.transcription) for (const t of seg.tokens) t.t_dtw = -1;
    const r = parseWhisperFull(JSON.stringify(doc));
    expect(r.timing).toBe('segment');
    expect(r.words[0].start).toBeCloseTo(0.3, 5);
    expect(r.words.every((w) => w.dtw === false)).toBe(true);
  });

  test('one word without a DTW time makes the whole file "segment" (no mixed clocks)', () => {
    const doc = JSON.parse(OJF);
    for (const t of doc.transcription[3].tokens) t.t_dtw = -1;
    const r = parseWhisperFull(JSON.stringify(doc));
    expect(r.timing).toBe('segment');
    // every word now starts at its segment start, so one file never mixes two clocks
    expect(r.words[1].start).toBeCloseTo(0.55, 5);
  });
});

describe("today's -oj -ml 1 output is the regression (test #1)", () => {
  test('whisperJsonToWords leaves S, aa, S and "," as separate caption words', () => {
    const texts = whisperJsonToWords(OJ).map((w) => w.text);
    const i = texts.indexOf('aa');
    expect(texts.slice(i - 1, i + 3)).toEqual(['S', 'aa', 'S', ',']);
    // 22 segments become more items than words (the "1.36 items per word" of §6.1)
    expect(texts.length).toBeGreaterThan(parseWhisperFull(OJF).words.length + 10);
  });
});
