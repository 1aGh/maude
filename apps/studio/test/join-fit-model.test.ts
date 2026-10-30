// S7.10 — the pure parts of the join picker (07 ve-transition), the "how should it sit?" ask (ve-fit-fill) and the clip
// inspector's numbers: no DOM, no React.
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  FRAMING_OPTIONS,
  framingValue,
  isSilentVideo,
  lengthWords,
  makesSound,
  parseLengthFrames,
  speedOptions,
  speedWords,
  srcInOut,
  timelineKindOf,
  volumeOf,
  volumeWords,
} from '../client/v2/inspector/kinds/clip-model.js';
import {
  askKey,
  isVertical,
  isWideComp,
  markAsked,
  resetFitMemory,
  shouldAsk,
  wasAsked,
} from '../client/v2/timeline/fit-model.js';
import {
  JOIN_TILES,
  joinFrames,
  joinSeconds,
  joinSecondsWords,
  joinTitle,
  previewKeyframes,
  stillSecond,
  tileOfPresentation,
} from '../client/v2/timeline/joins/join-model.js';

describe('the join (ve-transition)', () => {
  test('six tiles, in the canvas’s words and order', () => {
    expect(JOIN_TILES.map(([label]) => label)).toEqual([
      'Cut',
      'Fade',
      'Slide',
      'Wipe',
      'Flip',
      'Clock wipe',
    ]);
    expect(JOIN_TILES.map(([, key]) => key)).toEqual([
      'cut',
      'fade',
      'slide',
      'wipe',
      'flip',
      'clock',
    ]);
  });

  test('the comp’s presentation lights its tile: none is Cut, clock-wipe is Clock wipe', () => {
    expect(tileOfPresentation('none')).toBe('cut');
    expect(tileOfPresentation('clock-wipe')).toBe('clock');
    expect(tileOfPresentation('fade')).toBe('fade');
    expect(tileOfPresentation('spin')).toBeNull();
    expect(tileOfPresentation(null)).toBeNull();
  });

  test('the title names both clips; the slider speaks seconds and writes whole frames', () => {
    expect(joinTitle('Oslava', 'Logo')).toBe('Oslava → Logo');
    expect(joinTitle('', 'Logo')).toBe('Clip → Logo');
    expect(joinSeconds(15, 30)).toBe(0.5);
    expect(joinFrames(0.5, 30)).toBe(15);
    expect(joinFrames(0.04, 30)).toBe(1);
    expect(joinSecondsWords(0.5)).toBe('0.5 s');
    expect(joinSecondsWords(2)).toBe('2 s');
  });

  test('every tile plays something that ends with the incoming shot filling the frame', () => {
    for (const [, key] of JOIN_TILES) {
      const k = previewKeyframes(key);
      expect(k.a.length).toBeGreaterThanOrEqual(2);
      const last = k.b[k.b.length - 1] as Record<string, unknown>;
      expect(last.opacity ?? 1).toBe(1);
    }
    // reduced motion plays nothing: the incoming shot just shows
    expect(previewKeyframes('slide', { rm: true }).b[0]).toEqual({ opacity: 1 });
  });

  test('each shot is held on the frame the join meets it', () => {
    const a = {
      mediaSrc: 'assets/a.mp4',
      duration: 90,
      mediaProps: { trimBefore: 60, playbackRate: 1 },
    };
    // in 2.0 s, plays 3 s → leaves the file at 5.0 s; the held frame is a tenth before it
    expect(stillSecond(a, 'last', 30)).toBe(4.9);
    expect(stillSecond(a, 'first', 30)).toBe(2.1);
    expect(stillSecond({ mediaSrc: null }, 'last', 30)).toBeNull();
    // at double speed it plays twice as much of the file
    expect(stillSecond({ ...a, mediaProps: { trimBefore: 0, playbackRate: 2 } }, 'last', 30)).toBe(
      5.9
    );
  });
});

describe('a vertical clip on a wide video (ve-fit-fill)', () => {
  beforeEach(() => resetFitMemory());
  const wide = { width: 1920, height: 1080 };
  const seq = { stableId: 'c', mediaSrc: 'assets/a.mov', mediaTag: 'Video', fit: null };
  test('vertical means taller than wide by a margin; a wide video is the only one that asks', () => {
    expect(isVertical({ w: 1080, h: 1920 })).toBe(true);
    expect(isVertical({ w: 1080, h: 1080 })).toBe(false);
    expect(isVertical({ w: 1920, h: 1080 })).toBe(false);
    expect(isVertical(null)).toBe(false);
    expect(isWideComp(wide)).toBe(true);
    expect(isWideComp({ width: 1080, height: 1920 })).toBe(false);
  });

  test('asks once: not for a wide clip, a vertical video, a clip with a fit, or one already asked', () => {
    const v = { w: 1080, h: 1920 };
    expect(shouldAsk({ seq, comp: wide, size: v, asked: false })).toBe(true);
    expect(shouldAsk({ seq, comp: wide, size: { w: 1920, h: 1080 }, asked: false })).toBe(false);
    expect(shouldAsk({ seq, comp: { width: 1080, height: 1920 }, size: v, asked: false })).toBe(
      false
    );
    expect(shouldAsk({ seq: { ...seq, fit: 'blur' }, comp: wide, size: v, asked: false })).toBe(
      false
    );
    expect(shouldAsk({ seq, comp: wide, size: v, asked: true })).toBe(false);
    expect(
      shouldAsk({ seq: { ...seq, mediaTag: 'Audio' }, comp: wide, size: v, asked: false })
    ).toBe(false);
    expect(shouldAsk({ seq, comp: wide, size: null, asked: false })).toBe(false);
  });

  test('what was asked is remembered per clip, per canvas', () => {
    const k = askKey('ui/A.tsx', 'reel', 'name:one');
    expect(wasAsked(k)).toBe(false);
    markAsked(k);
    expect(wasAsked(k)).toBe(true);
    expect(wasAsked(askKey('ui/B.tsx', 'reel', 'name:one'))).toBe(false);
  });
});

describe('the clip inspector’s numbers', () => {
  test('speed words never say 1.0×; an odd rate is its own option', () => {
    expect(speedWords(1)).toBe('1×');
    expect(speedWords(0.25)).toBe('0.25×');
    expect(speedWords(1.5)).toBe('1.5×');
    expect(speedOptions(1).map((o: { label: string }) => o.label)).toEqual([
      '0.25×',
      '0.5×',
      '1×',
      '1.5×',
      '2×',
      '4×',
    ]);
    expect(speedOptions(3).map((o: { label: string }) => o.label)).toContain('3×');
  });

  test('length speaks seconds with a tenth; a typed length is seconds, frames or m:ss', () => {
    expect(lengthWords(75, 30)).toBe('2.5 s');
    expect(lengthWords(90, 30)).toBe('3 s');
    expect(parseLengthFrames('2.5', 30)).toBe(75);
    expect(parseLengthFrames('2,5 s', 30)).toBe(75);
    expect(parseLengthFrames('75f', 30)).toBe(75);
    expect(parseLengthFrames('1:05', 30)).toBe(1950);
    expect(parseLengthFrames('abc', 30)).toBeNull();
    expect(parseLengthFrames('0', 30)).toBeNull();
    expect(parseLengthFrames('', 30)).toBeNull();
  });

  test('volume: muted is 0, no prop is full, words are a percentage', () => {
    expect(volumeOf({ muted: true, volume: 0.8 })).toBe(0);
    expect(volumeOf({ volume: 0.7 })).toBe(0.7);
    expect(volumeOf(null)).toBe(1);
    expect(volumeWords(0.7)).toBe('70 %');
  });

  test('src · in · out are the file’s own seconds', () => {
    const seq = {
      mediaSrc: 'assets/dron-sweep-lajny-8s.mp4',
      duration: 75,
      mediaProps: { trimBefore: 60, playbackRate: 1 },
    };
    expect(srcInOut(seq, 30)).toEqual([
      ['src', 'dron-sweep-lajny-8s.mp4'],
      ['in', '0:02.0'],
      ['out', '0:04.5'],
    ]);
    expect(srcInOut({ duration: 30 }, 30)).toEqual([]);
  });

  test('Framing: Fill is the default and reads "All formats"', () => {
    expect(FRAMING_OPTIONS.map((o: { label: string }) => o.label)).toEqual([
      'All formats',
      'Fit',
      'Blur behind',
    ]);
    expect(framingValue(null)).toBe('fill');
    expect(framingValue('blur')).toBe('blur');
  });

  test('a title is plain JSX on its own; a beat, a picture and a slate are clips', () => {
    expect(timelineKindOf({ rowKind: 'jsx', series: false })).toBe('title');
    expect(timelineKindOf({ rowKind: 'jsx', series: true })).toBe('clip');
    expect(timelineKindOf({ rowKind: 'video' })).toBe('clip');
    expect(timelineKindOf({ rowKind: 'placeholder', placeholder: { prompt: 'x' } })).toBe('clip');
    expect(timelineKindOf({ rowKind: 'jsx', loose: true })).toBe('clip');
  });

  test('a video is silent only when no clip makes sound and no bed plays', () => {
    const muted = { mediaTag: 'Video', mediaSrc: 'a.mp4', mediaProps: { muted: true } };
    const zero = { mediaTag: 'Video', mediaSrc: 'b.mp4', mediaProps: { volume: 0 } };
    const loud = { mediaTag: 'Video', mediaSrc: 'c.mp4', mediaProps: { muted: false } };
    expect(makesSound(muted)).toBe(false);
    expect(makesSound(zero)).toBe(false);
    expect(makesSound(loud)).toBe(true);
    expect(isSilentVideo([muted, zero], [])).toBe(true);
    expect(isSilentVideo([muted, loud], [])).toBe(false);
    expect(isSilentVideo([muted], [{ src: 'bed.mp3' }])).toBe(false);
    expect(isSilentVideo([], [])).toBe(false); // an empty video has its own block
    expect(isSilentVideo([{ mediaTag: null, mediaSrc: null }], [])).toBe(false); // titles alone: nothing to say
  });
});
