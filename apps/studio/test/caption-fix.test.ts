// S7.11 — fix a caption word (video.captions.fix-word) and V2-1.10 Q4: THIS video only.
// Typing over a word writes a `fixes` literal into this canvas's one <Captions>; the transcript sidecar is
// never touched (it is the engine's reading, shared by every video that uses the clip) and another video
// using the same clip keeps what the engine heard.

import { afterEach, describe, expect, test } from 'bun:test';

import { fixWord, styleCaptions } from '../client/v2/transcript/captions-api.js';
import { compMediaStore } from '../client/v2/transcript/comp-media-store.js';
import { buildTranscriptModel, flatItems } from '../client/v2/transcript/transcript-model.js';
import { captionFixesOf, captionsOf, compClips, compWords } from '../video/derive.ts';
import { A, FILE, install, mediaOf, source, video, WORDS } from './_captions-harness.ts';

const CAPTIONS = '    <Captions data-cd-id="captions" words="line" position="bottom" />';
let off = () => {};
afterEach(() => off());

async function ready() {
  const v = video({ transcripts: { [A]: { words: WORDS } } });
  v.source = source(CAPTIONS);
  off = install(v);
  await compMediaStore.load(FILE, 'reel');
  const item = (text: string) =>
    flatItems(buildTranscriptModel(mediaOf(v))).find((i: any) => i.original === text);
  return { v, item };
}

describe('fix-word', () => {
  test('writes a source-time fix into THIS video; the sidecar words and another video are untouched', async () => {
    const { v, item } = await ready();
    const otherVideo = source(CAPTIONS); // a second canvas using the same clip
    const transcriptBefore = JSON.stringify(v.transcripts);
    const r = await fixWord(item('Ehm…'), 'Hm');
    expect(r.ok).toBe(true);
    expect(v.calls).toHaveLength(1);
    expect(v.calls[0].verb).toBe('video.captions.add');
    expect(captionFixesOf(v.source)).toEqual([{ src: A, at: 1.2, text: 'Hm' }]);
    // the caption now says it …
    const shown = mediaOf(v).words.find((w: any) => w.wordId === 'w1');
    expect(shown.text).toBe('Hm');
    expect(shown.fixed).toBe(true);
    // … and nothing else moved
    expect(JSON.stringify(v.transcripts)).toBe(transcriptBefore);
    expect(captionFixesOf(otherVideo)).toEqual([]);
    const c = compClips(FILE, otherVideo, 'reel');
    expect(
      compWords(c, { [A]: { words: WORDS } as any }).find((w) => w.wordId === 'w1')?.text
    ).toBe('Ehm…');
  });

  test('typing it again replaces the fix; typing what the engine heard takes it away', async () => {
    const { v, item } = await ready();
    await fixWord(item('Ehm…'), 'Hm');
    await fixWord(item('Ehm…'), 'Hmm');
    expect(captionFixesOf(v.source)).toEqual([{ src: A, at: 1.2, text: 'Hmm' }]);
    await fixWord(item('Ehm…'), 'Ehm…');
    expect(captionFixesOf(v.source)).toEqual([]);
    expect(v.source).not.toContain('fixes=');
  });

  test('an empty word hides it from the captions only; the picture and sound stay', async () => {
    const { v, item } = await ready();
    await fixWord(item('Za'), '');
    expect(captionFixesOf(v.source)).toEqual([{ src: A, at: 1.565, text: null }]);
    const after = flatItems(buildTranscriptModel(mediaOf(v)));
    expect(after.find((i: any) => i.text === 'Za').state).toBe('hidden');
    expect(compClips(FILE, v.source, 'reel').total).toBe(150);
  });

  test('no captions yet: nothing is written (the fix would have no home)', async () => {
    const v = video({ transcripts: { [A]: { words: WORDS } } });
    off = install(v);
    await compMediaStore.load(FILE, 'reel');
    const item = flatItems(buildTranscriptModel(mediaOf(v)))[0];
    expect((await fixWord(item, 'x')).reason).toBe('no-captions');
    expect(v.calls).toEqual([]);
  });
});

describe('style (video.captions.style)', () => {
  test('words at a time, position, font and highlight are the props of the one <Captions>', async () => {
    const { v } = await ready();
    expect((await styleCaptions({ words: 3, position: 'top' })).ok).toBe(true);
    expect((await styleCaptions({ font: 'var(--font-display)', highlight: 'var(--accent)' })).ok).toBe(
      true
    );
    expect(captionsOf(v.source)).toEqual({
      words: 3,
      position: 'top',
      font: 'var(--font-display)',
      highlight: 'var(--accent)',
      maxChars: null,
      fixes: [],
    });
    expect((v.source.match(/<Captions/g) ?? []).length).toBe(1);
  });
});
