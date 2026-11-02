// S7.18 (C22) — how long one export of a video may be, said the same way everywhere past 3 600 frames:
// the Timeline warns with the Export sheet's sentence and the server's number, "Allow longer" stores
// `artboardMeta[id].maxFrames` (≤ 18 000) through the one meta route, and the server holds it.
import { describe, expect, test } from 'bun:test';

import {
  allowLongerAtFollowed,
  bindCapTarget,
  CAP_CEILING,
  CAP_WORDS,
  capView,
  DEFAULT_CAP,
  loadMaxFrames,
  maxFramesOf,
  saveMaxFrames,
} from '../client/v2/timeline/advanced/video-cap.js';
import type { SpecUnit } from '../exporters/scope.ts';
import { enforceVideoCap, type VideoFacts } from '../exporters/video-cap.ts';
import { DEFAULT_MAX_FRAMES, MAX_FRAMES_CEILING } from '../kinds/meta.ts';
import {
  applyPresentPatch,
  PATCH_KEYS,
  parsePresentPatch,
  readMaxFrames,
  MAX_FRAMES_CEILING as SCHEMA_CEILING,
} from '../present/meta-schema.ts';

const FILE = '.design/ui/Recap.tsx';
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('one number, one sentence', () => {
  test('the Timeline’s numbers are the server’s', () => {
    expect(DEFAULT_CAP).toBe(DEFAULT_MAX_FRAMES);
    expect(CAP_CEILING).toBe(MAX_FRAMES_CEILING);
    expect(SCHEMA_CEILING).toBe(MAX_FRAMES_CEILING);
  });

  test('3 600 frames is fine; the first frame past it warns (C22 everywhere past 3 600)', () => {
    expect(capView({ frames: 900 }).warn).toBe(false);
    expect(capView({ frames: 3600 }).warn).toBe(false);
    expect(capView({ frames: 3601 })).toMatchObject({ kind: 'warn', warn: true, action: 'allow' });
  });

  test('the sentence is the Export sheet’s and the server’s, word for word', () => {
    const v = capView({ frames: 4800, fps: 30, label: 'Recap Reels' });
    expect(v.line).toBe(
      'Recap Reels is 2:40 long — one export goes up to 2:00 (3,600 frames at 30 fps).'
    );
    expect(v.actionLabel).toBe('Allow longer');
    // the server refuses with the same sentence (plus its own "Turn on Allow longer…" tail)
    const unit = {
      format: 'mp4',
      canvas: 'ui/reel.tsx',
      artboards: [{ id: 'reels', label: 'Recap Reels', w: 1080, h: 1920 }],
      options: {},
      v2: {},
    } as unknown as SpecUnit;
    const facts: VideoFacts = { frames: 4800, fps: 30, stored: null, clips: [] };
    const verdict = enforceVideoCap([unit], () => facts);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message.startsWith(v.line)).toBe(true);
  });

  test('allowed: the artboard’s own number; past even that, it says so', () => {
    expect(capView({ frames: 4800, stored: 18000, label: 'Recap' })).toMatchObject({
      kind: 'allowed',
      cap: 18000,
      line: 'Recap may export up to 10:00 (18,000 frames).',
      action: 'back',
      actionLabel: 'Back to the limit',
    });
    expect(capView({ frames: 19000, stored: 18000, label: 'Recap' })).toMatchObject({
      kind: 'past',
      warn: true,
    });
    // a stored number never lowers the default
    expect(capView({ frames: 4000, stored: 100 }).cap).toBe(DEFAULT_CAP);
  });

  test('under the limit it says what the limit is, offers nothing', () => {
    expect(capView({ frames: 900, fps: 30 })).toMatchObject({
      kind: 'ok',
      action: null,
      line: 'One export goes up to 2:00 (3,600 frames at 30 fps).',
    });
  });
});

describe('the meta route’s maxFrames', () => {
  const parse = (maxFrames: unknown) => parsePresentPatch({ file: '.design/a.tsx', maxFrames });

  test('is part of the route’s vocabulary', () => {
    expect(PATCH_KEYS).toContain('maxFrames');
  });

  test('a whole number of frames, 1 to 18 000, or null — nothing else', () => {
    expect(parse({ reels: 18000, wide: null })).toMatchObject({
      ok: true,
      patch: { maxFrames: { reels: 18000, wide: null } },
    });
    expect(parse({ reels: 1 }).ok).toBe(true);
    for (const bad of [0, -5, 18001, 4500.5, '9000', true, {}, [1]])
      expect(parse({ reels: bad })).toMatchObject({ ok: false, error: 'bad-field' });
    expect(parse([1])).toMatchObject({ ok: false });
    expect(parse({ 'no spaces': 9000 })).toMatchObject({ ok: false });
  });

  const current = {
    title: 'Recap',
    layout: { artboards: [{ id: 'reels', x: 0, y: 0 }] },
    artboardMeta: { reels: { notes: 'kept', snap: 'beat', poster: 90 }, wide: { maxFrames: 9000 } },
  };
  const apply = (maxFrames: Record<string, number | null>, known: string[] | null = null) => {
    const p = parse(maxFrames);
    if (!p.ok) throw new Error('parse');
    return applyPresentPatch(current, p.patch, known ? new Set(known) : null);
  };

  test('sets the number and keeps every other key — notes, snap, poster, layout', () => {
    const r = apply({ reels: 18000 });
    expect(r.ok && r.changed).toBe(true);
    if (!r.ok) return;
    expect(r.next.artboardMeta).toEqual({
      reels: { notes: 'kept', snap: 'beat', poster: 90, maxFrames: 18000 },
      wide: { maxFrames: 9000 },
    });
    expect(r.next.layout).toEqual(current.layout);
    expect(r.next.title).toBe('Recap');
  });

  test('null takes it off; an entry left empty goes with it', () => {
    const r = apply({ wide: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.artboardMeta).toEqual({ reels: current.artboardMeta.reels });
  });

  test('the same number again changes nothing; an artboard the canvas does not have is refused', () => {
    const same = apply({ wide: 9000 });
    expect(same.ok && same.changed).toBe(false);
    expect(apply({ ghost: 9000 }, ['reels', 'wide'])).toEqual({
      ok: false,
      error: 'unknown-artboard',
      ids: ['ghost'],
    });
  });

  test('readMaxFrames: only well-formed members; a peer’s junk reads as absent', () => {
    expect(
      readMaxFrames({
        artboardMeta: {
          a: { maxFrames: 9000 },
          b: { maxFrames: 99999 },
          c: { maxFrames: '9000' },
          'bad id': { maxFrames: 9000 },
          d: {},
        },
      })
    ).toEqual({ a: 9000 });
    expect(readMaxFrames(null)).toEqual({});
    expect(readMaxFrames({ artboardMeta: 7 })).toEqual({});
  });
});

describe('the client store', () => {
  test('GET canvas-meta: a stored number shows, an absent or malformed one is the limit', async () => {
    await loadMaxFrames(FILE, 'reels', (async () =>
      json(200, { artboardMeta: { reels: { maxFrames: 9000 } } })) as unknown as typeof fetch);
    expect(maxFramesOf(FILE, 'reels')).toBe(9000);
    await loadMaxFrames(FILE, 'wide', (async () =>
      json(200, { artboardMeta: { wide: { maxFrames: 99999 } } })) as unknown as typeof fetch);
    expect(maxFramesOf(FILE, 'wide')).toBeNull();
  });

  test('Allow longer: PATCH present-meta { maxFrames: { id: 18000 } }, shown at once', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return json(200, { ok: true, maxFrames: { rec: 18000 } });
    }) as unknown as typeof fetch;
    const done = await saveMaxFrames(FILE, 'rec', CAP_CEILING, f);
    expect(done).toEqual({ ok: true, message: CAP_WORDS.on });
    expect(calls).toEqual([
      { url: '/_api/present-meta', body: { file: FILE, maxFrames: { rec: 18000 } } },
    ]);
    expect(maxFramesOf(FILE, 'rec')).toBe(18000);
  });

  test('a refusal puts the old number back and says why (a role below Can edit gets the 403)', async () => {
    await saveMaxFrames(FILE, 'a', 9000, (async () =>
      json(200, { maxFrames: { a: 9000 } })) as unknown as typeof fetch);
    const done = await saveMaxFrames(FILE, 'a', 18000, (async () =>
      json(403, { error: 'read-only' })) as unknown as typeof fetch);
    expect(done).toEqual({ ok: false, message: CAP_WORDS.readOnly });
    expect(maxFramesOf(FILE, 'a')).toBe(9000);
    const failed = await saveMaxFrames(FILE, 'a', 18000, (async () =>
      json(500)) as unknown as typeof fetch);
    expect(failed.message).toBe(CAP_WORDS.failed);
  });

  test('null is back to the limit', async () => {
    const done = await saveMaxFrames(FILE, 'a', null, (async () =>
      json(200, { maxFrames: {} })) as unknown as typeof fetch);
    expect(done).toEqual({ ok: true, message: CAP_WORDS.off });
    expect(maxFramesOf(FILE, 'a')).toBeNull();
  });

  test('the ⌘K row acts on the followed video, and says so when there is none', async () => {
    bindCapTarget(() => ({ file: FILE, artboardId: 'reels' }));
    const sent: unknown[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return json(200, { maxFrames: { reels: 18000 } });
    }) as unknown as typeof fetch;
    expect(await allowLongerAtFollowed(true, f)).toBe(CAP_WORDS.on);
    expect(await allowLongerAtFollowed(false, f)).toBe(CAP_WORDS.off);
    expect(sent).toEqual([
      { file: FILE, maxFrames: { reels: 18000 } },
      { file: FILE, maxFrames: { reels: null } },
    ]);
    bindCapTarget(null);
    let called = false;
    const words = await allowLongerAtFollowed(true, (async () => {
      called = true;
      return json(200);
    }) as unknown as typeof fetch);
    expect(called).toBe(false);
    expect(words).toBe(CAP_WORDS.none);
  });
});
