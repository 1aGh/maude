// V2-1.10 §7 test #11 (schema half; the build-injection half is S7.5's) — the transcript and beats
// sidecars: preserving round trips (unknown keys byte for byte, at every level), tolerant readers,
// strict writers, the caps, and the asset ↔ file-name rule.

import { describe, expect, test } from 'bun:test';

import {
  type BeatGrid,
  MAX_BEATS,
  MAX_REGIONS,
  MAX_WORDS,
  readBeats,
  readTranscript,
  SidecarWriteError,
  serializeBeats,
  serializeTranscript,
  sidecarRelFor,
  TRANSCRIPT_MAX_BYTES,
  type Transcript,
  validateBeats,
  validateTranscript,
} from './schema.ts';

const REL = 'assets/ab12cd34.transcript.json';
const BREL = 'assets/9f00aa11.beats.json';

function transcript(extra: Record<string, unknown> = {}): Transcript {
  return {
    format: 'maude.transcript',
    v: 1,
    asset: 'assets/ab12cd34.mp4',
    durationSec: 12.5,
    lang: 'cs',
    engine: { id: 'whisper.cpp', model: 'base', timing: 'dtw+energy', lagMs: 120 },
    words: [
      { id: 'w0', t0: 0.42, t1: 0.71, text: 'Ahoj', p: 0.91 },
      { id: 'w1', t0: 0.71, t1: 1.05, text: 'světe,' },
      { id: 'w2', t0: 2.2, t1: 2.4, text: 'čej', flags: ['loop'] },
    ],
    speech: {
      source: 'words',
      regions: [
        [0.42, 1.05],
        [2.2, 2.4],
      ],
    },
    createdAt: '2026-10-18T09:00:00.000Z',
    ...extra,
  } as Transcript;
}

function beats(extra: Record<string, unknown> = {}): BeatGrid {
  return {
    format: 'maude.beats',
    v: 1,
    asset: 'assets/9f00aa11.mp3',
    durationSec: 4,
    analyzer: { id: 'maude-beats', version: 1, decode: 'ffmpeg' },
    bpm: 120,
    bpmSource: 'detected',
    tempoStrength: 0.62,
    beats: [0.25, 0.75, 1.25, 1.75, 2.25],
    bar: { phase: 1, confidence: 0.55 },
    createdAt: '2026-10-18T09:00:00.000Z',
    ...extra,
  } as BeatGrid;
}

/** A newer peer's file: unknown keys at every level, in odd places in the key order. */
function newerTranscriptText(): string {
  const t = transcript() as unknown as Record<string, unknown>;
  const words = (t.words as Record<string, unknown>[]).map((w, i) =>
    i === 1 ? { emphasis: { level: 2, by: 'ai' }, ...w, speaker: 'A' } : w
  );
  return `${JSON.stringify(
    {
      format: t.format,
      zz: [1, { nested: true }],
      v: t.v,
      asset: t.asset,
      durationSec: t.durationSec,
      lang: t.lang,
      engine: { ...(t.engine as object), diarized: true },
      words,
      speech: { ...(t.speech as object), vad: 'silero' },
      createdAt: t.createdAt,
      futureBlock: { a: 'x' },
    },
    null,
    2
  )}\n`;
}

describe('transcript — preserving round trip', () => {
  test('a canonical file reads and re-serializes to the same bytes', () => {
    const text = `${JSON.stringify(transcript(), null, 2)}\n`;
    const r = readTranscript(text, REL);
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializeTranscript(r.value, REL)).toBe(text);
  });

  test('unknown keys at the top, on a word, in engine and speech survive byte for byte', () => {
    const text = newerTranscriptText();
    const r = readTranscript(text, REL);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(serializeTranscript(r.value, REL)).toBe(text);
    // and an edit of a known field keeps every unknown one in its place
    const edited = { ...r.value, lang: 'en' };
    const out = serializeTranscript(edited, REL);
    expect(out).toBe(text.replace('"lang": "cs"', '"lang": "en"'));
  });

  test('untrusted word text is data: quotes, backticks, ${, </script> round-trip unchanged', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal `${` is the point.
    const nasty = ["it's", '`x`', '${alert(1)}', '</script>', ' '];
    const t = transcript({
      words: nasty.map((text, i) => ({ id: `w${i}`, t0: i, t1: i + 0.5, text })),
    });
    const text = serializeTranscript(t, REL);
    const r = readTranscript(text, REL);
    expect(r.ok && r.value.words.map((w) => w.text)).toEqual(nasty);
  });
});

describe('transcript — tolerant reader, strict writer', () => {
  test('a newer engine id / timing / flag reads, but our writer refuses it', () => {
    const t = transcript({
      engine: { id: 'whisper-next', timing: 'forced-align' },
      words: [{ id: 'w0', t0: 0, t1: 1, text: 'a', flags: ['laugh'] }],
    });
    expect(readTranscript(JSON.stringify(t)).ok).toBe(true);
    expect(validateTranscript(t, { strict: true }).errors).toEqual([
      expect.stringContaining('engine.id'),
      expect.stringContaining('engine.timing'),
      expect.stringContaining('words[0].flags'),
    ]);
    expect(() => serializeTranscript(t)).toThrow(SidecarWriteError);
  });

  test('order, uniqueness, t1 > t0, regions, energy — writer rules only', () => {
    const bad = transcript({
      words: [
        { id: 'w0', t0: 2, t1: 3, text: 'b' },
        { id: 'w0', t0: 1, t1: 1, text: 'a' },
      ],
      speech: {
        source: 'words',
        regions: [
          [1, 3],
          [2, 4],
        ],
      },
    });
    expect(validateTranscript(bad).ok).toBe(true); // a reader takes it as it is
    const errs = validateTranscript(bad, { strict: true }).errors.join('\n');
    expect(errs).toContain('used twice');
    expect(errs).toContain('t1 must be > t0');
    expect(errs).toContain('sorted by t0');
    expect(errs).toContain('not overlap');
    const energy = transcript({ engine: { id: 'energy', timing: 'none' } });
    expect(validateTranscript(energy, { strict: true }).errors).toEqual([
      'words: must be [] when engine.id is "energy"',
    ]);
  });

  test('required fields, types and versions are judged by readers too', () => {
    for (const [patch, needle] of [
      [{ v: 2 }, 'v: must be 1'],
      [{ format: 'maude.beats' }, 'format'],
      [{ asset: '../etc/passwd' }, 'asset'],
      [{ words: 'none' }, 'words: required array'],
      [{ speech: { source: 'words' } }, 'speech.regions'],
      [{ engine: { id: 'whisper.cpp' } }, 'engine.timing'],
      [{ lang: 'Czech' }, 'lang'],
      [{ createdAt: 7 }, 'createdAt'],
    ] as const) {
      const r = readTranscript(JSON.stringify(transcript(patch as Record<string, unknown>)));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join('\n')).toContain(needle);
    }
  });

  test('asset must name the file: assets/<sha8>.<ext> ↔ assets/<sha8>.transcript.json', () => {
    expect(sidecarRelFor('assets/ab12cd34.mp4', 'transcript')).toBe(REL);
    expect(sidecarRelFor('assets/ab12cd34.mp3', 'beats')).toBe('assets/ab12cd34.beats.json');
    expect(sidecarRelFor('elsewhere/x.mp4', 'beats')).toBeNull();
    const text = JSON.stringify(transcript());
    expect(readTranscript(text, 'assets/00000000.transcript.json').ok).toBe(false);
    expect(readTranscript(text, 'assets/ab12cd34.beats.json').ok).toBe(false);
    expect(readTranscript(text, REL).ok).toBe(true);
  });

  test('caps: 2 MB file, 50 000 words, 20 000 regions, 64-char word', () => {
    const big = ' '.repeat(TRANSCRIPT_MAX_BYTES + 1);
    expect(readTranscript(big)).toEqual({ ok: false, errors: ['file: larger than 2097152 bytes'] });
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `w${i}`, t0: i, t1: i + 0.5, text: 'a' }));
    expect(validateTranscript(transcript({ words: many(MAX_WORDS) })).ok).toBe(true);
    expect(validateTranscript(transcript({ words: many(MAX_WORDS + 1) })).errors).toEqual([
      'words: more than 50000 items',
    ]);
    const spans = (n: number) => Array.from({ length: n }, (_, i) => [i, i + 0.5]);
    expect(
      validateTranscript(
        transcript({ speech: { source: 'words', regions: spans(MAX_REGIONS + 1) } })
      ).errors
    ).toEqual(['speech.regions: more than 20000 items']);
    expect(
      validateTranscript(transcript({ words: [{ id: 'w0', t0: 0, t1: 1, text: 'x'.repeat(65) }] }))
        .errors
    ).toEqual(['words[0].text: exceeds 64 chars']);
  });

  test('readers never throw, whatever they are handed', () => {
    for (const junk of [
      '',
      'null',
      '[]',
      '"x"',
      '{',
      '{"format":"maude.transcript","v":1}',
      '1e999',
    ])
      expect(() => readTranscript(junk)).not.toThrow();
    for (const junk of [
      null,
      0,
      [],
      'x',
      { words: [null, 1, 'a'] },
      { speech: { regions: [[1]] } },
    ])
      expect(() => validateTranscript(junk)).not.toThrow();
    expect(() => readBeats('{"bar":7}')).not.toThrow();
  });
});

describe('beats', () => {
  test('a newer peer’s keys survive the round trip byte for byte', () => {
    const b = beats() as unknown as Record<string, unknown>;
    const text = `${JSON.stringify(
      {
        ...b,
        analyzer: { ...(b.analyzer as object), window: 2048 },
        bar: { ...(b.bar as object), meter: '4/4' },
        sections: [{ t0: 0, label: 'intro' }],
      },
      null,
      2
    )}\n`;
    const r = readBeats(text, BREL);
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializeBeats(r.value, BREL)).toBe(text);
  });

  test('strict: known decode / bpmSource, strictly ascending beats', () => {
    const b = beats({ bpmSource: 'tapped', beats: [1, 1, 0.5] });
    expect(validateBeats(b).ok).toBe(true);
    const errs = validateBeats(b, { strict: true }).errors.join('\n');
    expect(errs).toContain('bpmSource');
    expect(errs).toContain('strictly ascending');
    expect(() =>
      serializeBeats(beats({ analyzer: { id: 'maude-beats', version: 1, decode: 'gpu' } }))
    ).toThrow(SidecarWriteError);
  });

  test('required numbers and ranges; the 20 000-beat cap', () => {
    for (const [patch, needle] of [
      [{ bpm: 9 }, 'bpm'],
      [{ tempoStrength: 1.5 }, 'tempoStrength'],
      [{ bar: { phase: 4, confidence: 0.5 } }, 'bar.phase'],
      [{ analyzer: { id: 'other', version: 1, decode: 'ffmpeg' } }, 'analyzer.id'],
      [{ durationSec: undefined }, 'durationSec'],
      [{ beats: [0.5, 'x'] }, 'beats[1]'],
    ] as const) {
      const r = validateBeats(beats(patch as Record<string, unknown>));
      expect(r.ok).toBe(false);
      expect(r.errors.join('\n')).toContain(needle);
    }
    const many = Array.from({ length: MAX_BEATS + 1 }, (_, i) => i / 10);
    expect(validateBeats(beats({ beats: many })).errors).toEqual(['beats: more than 20000 items']);
  });
});
