// S7.12 — Snap to the beat (V2-1.10 §5.5 + Q6): the music's beats are a snap source of the Timeline's drags when
// `artboardMeta[id].snap` is on, and that choice is one write through the S7.8 meta route. Fixtures only.

import { describe, expect, test } from 'bun:test';

import { computeSnapTargets, snapFrame } from '../client/panels/timeline-snap.js';
import { snapBeatFrames, snapMode } from '../client/v2/timeline/lanes/music-model.js';
import { resolvedSnap } from '../kinds/meta.ts';
import { applyPresentPatch, parsePresentPatch, readSnaps } from '../present/meta-schema.ts';

const grid = (beats: number[], tempoStrength = 0.8) => ({
  bpm: 120,
  bpmSource: 'detected',
  tempoStrength,
  barConfidence: 0.9,
  beats,
  bars: [],
});
const song = (beats: number[], tempoStrength?: number) => ({
  stableId: 'loose:0',
  src: 'assets/song.mp3',
  track: 'music',
  from: 0,
  durationInFrames: 300,
  volume: 1,
  duck: null,
  grid: grid(beats, tempoStrength),
});
const BEATS = [0, 17, 34, 51, 68];

const base = { fps: 30, totalFrames: 300, clips: [], movingIndex: -1, playhead: 7 };

describe('computeSnapTargets takes the beats as one more source', () => {
  test('without beats the targets are the old ones; with beats each beat is a target', () => {
    const plain = computeSnapTargets(base);
    expect(plain).not.toContain(17);
    const withBeats = computeSnapTargets({ ...base, beats: BEATS });
    expect(withBeats).toContain(17);
    expect(withBeats).toContain(51);
    // the old sources are all still there
    for (const t of plain) expect(withBeats).toContain(t);
  });

  test('a dragged edge near a beat lands on it; Alt (threshold 0) and a far edge do not', () => {
    const targets = computeSnapTargets({ ...base, beats: BEATS });
    expect(snapFrame(35, targets, 3)).toBe(34); // 1 frame from the beat at 34
    expect(snapFrame(35, targets, 0)).toBe(35); // Alt: no snap
    expect(snapFrame(43, targets, 3)).toBe(43); // 8 frames from any beat or tick
  });

  test('beats are deduped against the ticks and clamped to the comp', () => {
    const t = computeSnapTargets({ ...base, beats: [30, 30.4, 9999, -3, Number.NaN] });
    expect(t.filter((f: number) => f === 30).length).toBe(1);
    expect(Math.max(...t)).toBeLessThanOrEqual(300);
    expect(Math.min(...t)).toBeGreaterThanOrEqual(0);
  });
});

describe('the default and the choice (Q6)', () => {
  test('Snap is ON when a song has a clear beat, OFF when none does; the file’s choice wins over the default', () => {
    expect(snapMode(null, [song(BEATS)])).toBe('beat');
    expect(snapMode(undefined, [])).toBe('off');
    expect(snapMode('off', [song(BEATS)])).toBe('off');
    expect(snapMode('beat', [song(BEATS)])).toBe('beat');
  });

  test('a song with no clear beat keeps Snap off whatever the file says (§5.2)', () => {
    expect(snapMode('beat', [song(BEATS, 0.1)])).toBe('off');
    expect(snapMode(null, [{ ...song(BEATS), grid: null }])).toBe('off');
  });

  test('the client default is the server’s own resolvedSnap', () => {
    for (const stored of [undefined, 'beat', 'off'] as const) {
      const meta = stored ? { artboardMeta: { a: { snap: stored } } } : {};
      // (with no clear beat at all the client forces Snap off — "stays off", §5.2 — even over a stored 'beat')
      expect(snapMode(stored ?? null, [song(BEATS)])).toBe(resolvedSnap(meta, 'a', true));
      if (!stored) expect(snapMode(null, [])).toBe(resolvedSnap(meta, 'a', false));
    }
  });

  test('snapBeatFrames: nothing when off; every clear grid’s beats, once and sorted, when on', () => {
    expect(snapBeatFrames([song(BEATS)], 'off')).toEqual([]);
    const two = [song([34, 0, 17]), { ...song([17, 100]), stableId: 'x' }, song([5], 0.05)];
    expect(snapBeatFrames(two, 'beat')).toEqual([0, 17, 34, 100]);
  });
});

describe('video.snap writes artboardMeta.snap through the S7.8 meta route and nothing else', () => {
  test('parse: beat / off / null are accepted, anything else is a bad field', () => {
    expect(parsePresentPatch({ file: 'a.tsx', snap: { reel: 'off', other: null } })).toEqual({
      ok: true,
      patch: { file: 'a.tsx', snap: { reel: 'off', other: null } },
    });
    for (const bad of ['loud', 1, true]) {
      const r = parsePresentPatch({ file: 'a.tsx', snap: { reel: bad } });
      expect(r.ok).toBe(false);
    }
    expect(parsePresentPatch({ file: 'a.tsx', snap: [] }).ok).toBe(false);
  });

  test('apply keeps every other key of the entry; null takes it back to the default and drops an empty entry', () => {
    const current = { artboardMeta: { reel: { poster: 90, notes: 'n' } }, layout: { x: 1 } };
    const a = applyPresentPatch(
      current,
      { file: 'a.tsx', snap: { reel: 'off' } },
      new Set(['reel'])
    );
    if (!a.ok) throw new Error('apply refused');
    expect(a.next).toEqual({
      artboardMeta: { reel: { poster: 90, notes: 'n', snap: 'off' } },
      layout: { x: 1 },
    });
    expect(readSnaps(a.next)).toEqual({ reel: 'off' });
    const b = applyPresentPatch(
      { artboardMeta: { reel: { snap: 'beat' } } },
      { file: 'a.tsx', snap: { reel: null } },
      new Set(['reel'])
    );
    if (!b.ok) throw new Error('apply refused');
    expect(b.next).toEqual({});
  });

  test('an artboard the canvas does not have is refused', () => {
    const r = applyPresentPatch({}, { file: 'a.tsx', snap: { ghost: 'off' } }, new Set(['reel']));
    expect(r.ok).toBe(false);
  });
});
