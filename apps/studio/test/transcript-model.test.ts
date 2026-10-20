// S7.11 — client/v2/transcript/transcript-model.js: the Transcript panel's pure side (07 · ve-captions).
//   select → wordIds, struck = uncovered by every clip, the cut plan the ⌫ runs (same numbers as the
//   `cut-words` verb), the fix a typed-over word becomes, and the words the panel says.

import { describe, expect, test } from 'bun:test';

import {
  buildTranscriptModel,
  captionFixes,
  cutPlan,
  cutTipText,
  flatItems,
  rangeKeys,
} from '../client/v2/transcript/transcript-model.js';

const SRC = 'assets/7c40e2b1.mp4';
const FPS = 30;

// Kilián: "Přišel jsem bez zkušenosti. Ehm… Za měsíc …" — "Ehm…" already cut out of the clip
const WORDS = [
  { id: 'w0', t0: 3.0, t1: 3.4, text: 'Přišel', p: 0.9 },
  { id: 'w1', t0: 3.4, t1: 3.7, text: 'jsem', p: 0.3 },
  { id: 'w2', t0: 3.7, t1: 4.0, text: 'bez' },
  { id: 'w3', t0: 4.0, t1: 4.9, text: 'zkušenosti.' },
  { id: 'w4', t0: 4.95, t1: 5.35, text: 'Ehm…' },
  { id: 'w5', t0: 5.4, t1: 5.65, text: 'Za' },
  { id: 'w6', t0: 5.65, t1: 6.05, text: 'měsíc' },
  { id: 'w7', t0: 8.4, t1: 8.9, text: 'Dneska', flags: ['loop'] },
];

// the clips play source 3.0 → 4.9 (frames 0..57), 5.4 → 6.05 (57..77), 8.4 → 8.9 (77..92): "Ehm…" is in none
const clip = (stableId: string, trimBefore: number, from: number, durationInFrames: number) => ({
  stableId,
  track: 'video',
  src: SRC,
  from,
  durationInFrames,
  trimBefore,
  playbackRate: 1,
  muted: false,
});
const word = (id: string, f0: number, f1: number, text: string, clipId: string, extra = {}) => ({
  src: SRC,
  wordId: id,
  clip: clipId,
  f0,
  f1,
  text,
  ...extra,
});

function media(over: Record<string, unknown> = {}) {
  return {
    fps: FPS,
    clips: [clip('name:a', 90, 0, 57), clip('name:b', 162, 57, 20), clip('name:c', 252, 77, 15)],
    words: [
      word('w0', 0, 12, 'Přišel', 'name:a', { p: 0.9 }),
      word('w1', 12, 21, 'jsem', 'name:a', { p: 0.3 }),
      word('w2', 21, 30, 'bez', 'name:a'),
      word('w3', 30, 57, 'zkušenosti.', 'name:a'),
      word('w5', 57, 65, 'Za', 'name:b'),
      word('w6', 65, 77, 'měsíc', 'name:b'),
    ],
    speech: [],
    beats: [],
    unresolved: [],
    transcripts: { [SRC]: { durationSec: 12, lang: 'cs', words: WORDS } },
    captions: { words: 'line', position: 'bottom', font: null, highlight: null, maxChars: null, fixes: [] },
    ...over,
  };
}

describe('buildTranscriptModel — what the panel shows', () => {
  test('a word no clip plays is struck; the ones a clip plays are on', () => {
    const m = buildTranscriptModel(media());
    const items = flatItems(m);
    expect(items.map((i: any) => [i.text, i.state])).toEqual([
      ['Přišel', 'on'],
      ['jsem', 'on'],
      ['bez', 'on'],
      ['zkušenosti.', 'on'],
      ['Ehm…', 'struck'],
      ['Za', 'on'],
      ['měsíc', 'on'],
      ['Dneska', 'noise'],
    ]);
  });

  test('paragraphs break on a pause; each starts with the comp time of its first word', () => {
    const m = buildTranscriptModel(media());
    const paras = m.sections[0].paragraphs;
    expect(paras.map((p: any) => [p.time, p.items.map((i: any) => i.text).join(' ')])).toEqual([
      ['0:00', 'Přišel jsem bez zkušenosti. Ehm… Za měsíc'],
      [null, 'Dneska'],
    ]);
  });

  test('p < 0.5 is marked, a loop word is "May be noise, not speech"', () => {
    const items = flatItems(buildTranscriptModel(media()));
    expect(items.find((i: any) => i.text === 'jsem').lowConfidence).toBe(true);
    expect(items.find((i: any) => i.text === 'Přišel').lowConfidence).toBe(false);
    const loop = items.find((i: any) => i.text === 'Dneska');
    expect(loop.loop).toBe(true);
    expect(loop.note).toBe('May be noise, not speech');
  });

  test('a fix that hides a word is hidden, not struck; a fix that names a loop word confirms it', () => {
    const m = media({
      words: media().words.filter((w) => w.wordId !== 'w2'), // hidden by { text: null }
    });
    const items = flatItems(buildTranscriptModel(m));
    expect(items.find((i: any) => i.text === 'bez').state).toBe('hidden');
    const confirmed = media({
      words: [...media().words, word('w7', 0, 1, 'Dneska', 'name:b', { fixed: true })],
    });
    const c = flatItems(buildTranscriptModel(confirmed)).find((i: any) => i.wordId === 'w7');
    expect(c.state).toBe('on');
  });

  test('a source with no transcript is missing, never invented; music is not asked for', () => {
    const m = buildTranscriptModel(
      media({
        clips: [...media().clips, { ...clip('loose:x', 0, 0, 30), src: 'assets/aaaa1111.mp4' }, { ...clip('loose:m', 0, 0, 30), track: 'music', src: 'assets/bbbb2222.mp3' }],
      })
    );
    expect(m.missing).toEqual(['assets/aaaa1111.mp4']);
  });

  test('no media, no words: an empty model that says so', () => {
    expect(buildTranscriptModel(null).sections).toEqual([]);
    expect(buildTranscriptModel(media({ transcripts: {} })).hasWords).toBe(false);
  });
});

describe('select → wordIds → the cut', () => {
  test('rangeKeys is inclusive and order-independent', () => {
    const m = buildTranscriptModel(media());
    const keys = flatItems(m).map((i: any) => i.key);
    expect(rangeKeys(m, keys[1], keys[3])).toEqual(keys.slice(1, 4));
    expect(rangeKeys(m, keys[3], keys[1])).toEqual(keys.slice(1, 4));
  });

  test('cutting words the clip plays: one clip, the source range, the seconds that leave', () => {
    const m = buildTranscriptModel(
      media({
        clips: [clip('name:a', 90, 0, 117)], // plays 3.0 → 6.9: Ehm… is inside
        words: [
          word('w0', 0, 12, 'Přišel', 'name:a'),
          word('w3', 30, 57, 'zkušenosti.', 'name:a'),
          word('w4', 59, 71, 'Ehm…', 'name:a'),
          word('w5', 72, 80, 'Za', 'name:a'),
        ],
      })
    );
    const ehm = flatItems(m).find((i: any) => i.text === 'Ehm…');
    const plan: any = cutPlan(m, [ehm.key]);
    expect(plan.clip).toBe('name:a');
    expect(plan.wordIds).toEqual(['w4']);
    // the gap before is 0.05 s (< 60 ms): that edge snaps to the word; after is 0.05 s: same — frames quantised
    expect(plan.srcStart).toBeCloseTo(4.95, 1);
    expect(plan.srcEnd).toBeCloseTo(5.35, 1);
    expect(plan.removedSec).toBe(0.4);
    expect(cutTipText(plan, 'the interview')).toBe('Struck “Ehm…” — cut 0.4 s from the interview');
  });

  test('struck words need no cut; words of two clips are refused with a line, not a guess', () => {
    const m = buildTranscriptModel(media());
    const items = flatItems(m);
    const struck: any = cutPlan(m, [items.find((i: any) => i.text === 'Ehm…').key]);
    expect(struck.refusal).toBe('Those words are already cut.');
    const across: any = cutPlan(m, [
      items.find((i: any) => i.text === 'zkušenosti.').key,
      items.find((i: any) => i.text === 'Za').key,
    ]);
    expect(across.refusal).toBe('Pick words from one clip to cut them.');
    expect(cutPlan(m, [])).toBeNull();
  });
});

describe('captionFixes — typing over a word (Q4: this video only)', () => {
  const m = buildTranscriptModel(media());
  const item = (t: string) => flatItems(m).find((i: any) => i.text === t);

  test('a typed word becomes a fix keyed by source time, at the middle of the word', () => {
    const next = captionFixes([], item('jsem'), 'tu');
    expect(next).toEqual([{ src: SRC, at: 3.55, text: 'tu' }]);
  });

  test('typing it again replaces that fix; typing the original text takes it away', () => {
    const one = captionFixes([], item('jsem'), 'tu');
    expect(captionFixes(one, item('jsem'), 'tam')).toEqual([{ src: SRC, at: 3.55, text: 'tam' }]);
    expect(captionFixes(one, item('jsem'), 'jsem')).toEqual([]);
  });

  test('other words\' fixes are kept; an empty word hides it (text: null)', () => {
    const other = [{ src: SRC, at: 5.0, text: 'x' }];
    expect(captionFixes(other, item('bez'), '   ')).toEqual([
      { src: SRC, at: 5.0, text: 'x' },
      { src: SRC, at: 3.85, text: null },
    ]);
  });

  test('a loop word is confirmed by a fix that keeps its text', () => {
    expect(captionFixes([], item('Dneska'), 'Dneska')).toEqual([
      { src: SRC, at: 8.65, text: 'Dneska' },
    ]);
  });
});
