// S7.8 — `video.poster.set` from the client: the playhead's frame becomes `artboardMeta[id].poster` through the
// one meta route; the flag shows at once and goes back if the server says no (a role below Can edit gets the
// 403, whatever the UI shows).
import { describe, expect, test } from 'bun:test';
import {
  bindPosterSource,
  loadPoster,
  POSTER_WORDS,
  posterOf,
  savePoster,
  setPosterAtPlayhead,
} from '../client/v2/timeline/poster.js';

const FILE = '.design/ui/Recap.tsx';
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('read', () => {
  test('GET canvas-meta: a stored frame shows, an absent or malformed one is the default', async () => {
    await loadPoster(FILE, 'reels', (async () =>
      json(200, { artboardMeta: { reels: { poster: 210 } } })) as unknown as typeof fetch);
    expect(posterOf(FILE, 'reels')).toBe(210);
    await loadPoster(FILE, 'wide', (async () =>
      json(200, { artboardMeta: { wide: { poster: -1 } } })) as unknown as typeof fetch);
    expect(posterOf(FILE, 'wide')).toBeNull();
  });
});

describe('write', () => {
  test('PATCH present-meta { poster: { id: frame } } and the words say where', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return json(200, { ok: true, poster: { reels: 212 } });
    }) as unknown as typeof fetch;
    const done = await savePoster(FILE, 'reels', 212, 30, f);
    expect(done).toEqual({ ok: true, message: 'Poster frame set to 0:07.' });
    expect(calls).toEqual([
      { url: '/_api/present-meta', body: { file: FILE, poster: { reels: 212 } } },
    ]);
    expect(posterOf(FILE, 'reels')).toBe(212);
  });

  test('a refusal puts the old frame back and says why', async () => {
    await savePoster(FILE, 'a', 30, 30, (async () =>
      json(200, { poster: { a: 30 } })) as unknown as typeof fetch);
    const done = await savePoster(FILE, 'a', 99, 30, (async () =>
      json(403, { error: 'read-only' })) as unknown as typeof fetch);
    expect(done).toEqual({ ok: false, message: POSTER_WORDS.readOnly });
    expect(posterOf(FILE, 'a')).toBe(30);
    const failed = await savePoster(FILE, 'a', 99, 30, (async () =>
      json(500)) as unknown as typeof fetch);
    expect(failed.message).toBe(POSTER_WORDS.failed);
  });

  test('null takes it back to the default', async () => {
    const done = await savePoster(FILE, 'a', null, 30, (async () =>
      json(200, { poster: {} })) as unknown as typeof fetch);
    expect(done).toEqual({ ok: true, message: 'Poster frame reset.' });
    expect(posterOf(FILE, 'a')).toBeNull();
  });
});

describe('the ⌘K row', () => {
  test('sets the followed video’s poster at the playhead', async () => {
    bindPosterSource(() => ({ file: FILE, artboardId: 'reels', frame: 105.4, fps: 30 }));
    const sent: unknown[] = [];
    const words = await setPosterAtPlayhead((async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return json(200, { poster: { reels: 105 } });
    }) as unknown as typeof fetch);
    expect(sent).toEqual([{ file: FILE, poster: { reels: 105 } }]);
    expect(words).toBe('Poster frame set to 0:03.');
  });

  test('with no video followed it says so and writes nothing', async () => {
    bindPosterSource(() => null);
    let called = false;
    const words = await setPosterAtPlayhead((async () => {
      called = true;
      return json(200);
    }) as unknown as typeof fetch);
    expect(called).toBe(false);
    expect(words).toBe(POSTER_WORDS.none);
  });
});
