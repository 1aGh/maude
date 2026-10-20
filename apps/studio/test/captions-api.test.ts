// S7.11 — what the Captions tool and the Transcript panel DO (client/v2/transcript/captions-api.js), driven
// through a fake shell door onto the REAL edit ops and the REAL derivation (test/_captions-harness.ts).
//   - "Captions from speech": the words land, the toast says how many, Undo is on it; no engine = the
//     explanation and NO write; no speech = a quiet line and NO write;
//   - select "Ehm…" + ⌫: the video loses exactly its length, the captions follow, undo is one step.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  addCaptionsFromSpeech,
  cutSelection,
  findSpeech,
  NO_ENGINE_TEXT,
  NO_SPEECH_TEXT,
  setUpSpeech,
  transcriptUi,
} from '../client/v2/transcript/captions-api.js';
import { compMediaStore } from '../client/v2/transcript/comp-media-store.js';
import { buildTranscriptModel, flatItems } from '../client/v2/transcript/transcript-model.js';
import { compClips } from '../video/derive.ts';
import {
  A,
  FILE,
  install,
  mediaOf,
  source,
  type Video,
  video,
  WORDS,
} from './_captions-harness.ts';

let off = () => {};
afterEach(() => off());
beforeEach(() => {
  off = () => {};
});

describe('Captions from speech (video.captions.add)', () => {
  test('reads the words of a clip that has none, then adds the captions; the toast counts the words', async () => {
    const v = video();
    off = install(v);
    const r = await addCaptionsFromSpeech();
    expect(r.ok).toBe(true);
    expect(v.analysed).toEqual([A]);
    expect(v.calls.map((c) => [c.verb, c.params])).toEqual([
      ['video.captions.add', { words: 'line', position: 'bottom' }],
    ]);
    expect(v.source).toContain('<Captions data-cd-id="captions"');
    expect(v.toasts[0].text).toBe('Captions added — 3 words from the interview.');
    expect(v.toasts[0].ok).toBe(true);
    expect(v.toasts[0].action?.label).toBe('Undo');
    v.toasts[0].action?.onClick();
    expect(v.undone).toBe(1);
    expect(transcriptUi.get().open).toBe(true);
    expect(transcriptUi.get().working).toBeNull();
  });

  test('no speech engine: the explanation, nothing written, and Set up… opens Settings', async () => {
    const v = video({ engine: 'none' });
    off = install(v);
    const r = await addCaptionsFromSpeech();
    expect(r).toEqual({ ok: false, reason: 'no-engine' });
    expect(v.calls).toEqual([]);
    expect(v.source).toBe(source());
    expect(transcriptUi.get().noEngine).toBe(true);
    expect(NO_ENGINE_TEXT).toBe('Captions need speech recognition on this Mac.');
    setUpSpeech();
    expect(v.settings).toBe(1);
  });

  test('a source that says nothing: a quiet line, no captions', async () => {
    const v = video();
    off = install(v);
    // the engine finds no words in the file
    const door = (await import('../client/v2/transcript/captions-api.js')).transcriptDoor.get();
    if (door) door.analyse = async () => ({ ok: false, reason: 'no-words' });
    const r = await addCaptionsFromSpeech();
    expect(r.reason).toBe('no-speech');
    expect(v.calls).toEqual([]);
    expect(transcriptUi.get().notice).toBe(NO_SPEECH_TEXT);
  });

  test('with captions already there it only opens the Transcript panel', async () => {
    const v = video({ transcripts: { [A]: { words: WORDS } } });
    v.source = source('    <Captions data-cd-id="captions" words="line" position="bottom" />');
    off = install(v);
    const r = await addCaptionsFromSpeech();
    expect(r.ok).toBe(true);
    expect(v.calls).toEqual([]);
    expect(transcriptUi.get().open).toBe(true);
  });

  test("a refusal is said in the refuser's words, and nothing else happens", async () => {
    const v = video({ transcripts: { [A]: { words: WORDS } } });
    v.answer = () => ({ ok: false, message: 'An AI run is editing this video.' });
    off = install(v);
    const r = await addCaptionsFromSpeech();
    expect(r.reason).toBe('refused');
    expect(v.fails).toEqual([['Captions', 'An AI run is editing this video.']]);
    expect(v.toasts).toEqual([]);
  });

  test('Find speech reads the words and writes no captions', async () => {
    const v = video();
    off = install(v);
    expect((await findSpeech()).ok).toBe(true);
    expect(v.analysed).toEqual([A]);
    expect(v.calls).toEqual([]);
    expect(compMediaStore.get(FILE, 'reel')?.transcripts[A].words).toHaveLength(3);
  });
});

describe('edit by transcript (video.transcript.cut)', () => {
  async function ready(): Promise<Video> {
    const v = video({ transcripts: { [A]: { words: WORDS } } });
    v.source = source('    <Captions data-cd-id="captions" words="line" position="bottom" />');
    off = install(v);
    await compMediaStore.load(FILE, 'reel');
    return v;
  }
  const select = (v: Video, text: string) => {
    const model = buildTranscriptModel(mediaOf(v));
    const item = flatItems(model).find((i: any) => i.text === text);
    transcriptUi.select([item.key], item.key);
  };

  test('select "Ehm…" and ⌫: 0.4 s leave the clip, the captions follow, one undo', async () => {
    const v = await ready();
    const before = compClips(FILE, v.source, 'reel').total;
    select(v, 'Ehm…');
    const r = await cutSelection();
    expect(r.ok).toBe(true);
    expect(v.calls).toHaveLength(1);
    expect(v.calls[0].clipRef).toEqual({ stableId: 'name:a' });
    expect(v.calls[0].verb).toBe('cut-source-range');
    expect(v.calls[0].params.srcStart).toBeCloseTo(1.0, 1);
    expect(v.calls[0].params.srcEnd).toBeCloseTo(1.4, 1);
    // the video is 12 frames (0.4 s) shorter; "Za" moved 12 frames up, with no write to the captions
    expect(compClips(FILE, v.source, 'reel').total).toBe(before - 12);
    const after = mediaOf(v);
    expect(after.words.map((w: any) => [w.text, w.f0])).toEqual([
      ['Přišel', 6],
      ['Za', 31],
    ]);
    expect(v.source).toContain('<Captions data-cd-id="captions" words="line" position="bottom" />');
    // the panel strikes it and says so; the toast carries the one Undo
    const items = flatItems(buildTranscriptModel(after));
    expect(items.find((i: any) => i.text === 'Ehm…').state).toBe('struck');
    expect(transcriptUi.get().tip).toContain('Struck “Ehm…” — cut 0.4 s from the interview');
    expect(v.toasts.at(-1)?.text).toBe('Cut 0.4 s.');
    expect(v.toasts.at(-1)?.action?.label).toBe('Undo');
    expect(transcriptUi.get().selection).toEqual([]);
  });

  test('words already cut are not cut again', async () => {
    const v = await ready();
    select(v, 'Ehm…');
    await cutSelection();
    v.calls.length = 0;
    select(v, 'Ehm…');
    const r = await cutSelection();
    expect(r.reason).toBe('refused');
    expect(v.calls).toEqual([]);
    expect(transcriptUi.get().notice).toBe('Those words are already cut.');
  });
});
