// S7.9 (07 · ve-drop, ve-trim-split, ve-move-transition) — the words and numbers of the three edit gestures.
// Pure: the Timeline measures, these say what the gesture will do before the pointer lets go.

import { describe, expect, test } from 'bun:test';

import { moveLanding, totalAfterRetime } from '../client/v2/timeline/edit/ripple.js';
import { dropTip, moveTip, splitToastText, trimTip } from '../client/v2/timeline/edit/words.js';

const FPS = 30;
// Hype trailer, Reels: four series beats of 3 s, a title over 0–10 s, a logo over the whole cut (12 s).
const HYPE = [
  { stableId: 'a', label: 'Tunel', series: true, from: 0, duration: 90 },
  { stableId: 'b', label: 'Touchdown', series: true, from: 90, duration: 90 },
  { stableId: 'c', label: 'Dron nad lajnou', series: true, from: 180, duration: 90 },
  { stableId: 'd', label: 'Oslava', series: true, from: 270, duration: 90 },
  { stableId: 't', label: 'SRDCE', series: false, from: 0, duration: 300 },
];

describe('the video is as long as its clips', () => {
  test('trim a beat by 0.6 s: the rest closes up and the video is 0.6 s shorter', () => {
    expect(totalAfterRetime({ sequences: HYPE, index: 1, newDuration: 72 })).toBe(342);
  });

  test('trim the last beat: only its own end moves', () => {
    expect(totalAfterRetime({ sequences: HYPE, index: 3, newDuration: 60 })).toBe(330);
  });

  test('a layer reaching further than the beats holds the video where it is', () => {
    const longer = HYPE.map((s) => (s.stableId === 't' ? { ...s, duration: 360 } : s));
    expect(totalAfterRetime({ sequences: longer, index: 1, newDuration: 72 })).toBe(360);
  });

  test('a layer is not rippled: trimming one changes only its own end', () => {
    expect(totalAfterRetime({ sequences: HYPE, index: 4, newDuration: 100 })).toBe(360);
    expect(totalAfterRetime({ sequences: HYPE, index: 4, newDuration: 120, newFrom: 300 })).toBe(
      420
    );
  });
});

describe('the tip under a trim (ve-trim-split)', () => {
  test('Touchdown · 2.4 s, −0.6 s · video 0:14', () => {
    expect(
      trimTip({ name: 'Touchdown', frames: 72, deltaFrames: -18, totalFrames: 432, fps: FPS })
    ).toEqual({ title: 'Touchdown · 2.4 s', dim: '−0.6 s · video 0:14' });
  });

  test('a longer clip says + and nothing changes at zero', () => {
    expect(
      trimTip({ name: 'Oslava', frames: 105, deltaFrames: 15, totalFrames: 465, fps: FPS }).dim
    ).toBe('+0.5 s · video 0:15');
    expect(
      trimTip({ name: 'Oslava', frames: 90, deltaFrames: 0, totalFrames: 450, fps: FPS }).dim
    ).toBe('no change · video 0:15');
  });

  test('S names the clip and the time it split at', () => {
    expect(splitToastText('Oslava', 300, FPS)).toBe('Split Oslava at 0:10.');
  });
});

describe('the tip over a drop (ve-drop)', () => {
  test('Drop 3 clips at 0:09, the video grows by 0:20', () => {
    expect(dropTip({ count: 3, atFrame: 270, addedFrames: 600, fps: FPS })).toEqual({
      title: 'Drop 3 clips at 0:09',
      dim: 'the video grows by 0:20',
    });
  });

  test('one clip is "1 clip"; an unknown length does not invent a number', () => {
    expect(dropTip({ count: 1, atFrame: 0, addedFrames: null, fps: FPS })).toEqual({
      title: 'Drop 1 clip at 0:00',
      dim: 'the video grows by what you drop',
    });
  });

  test('over the artboard (no place on the timeline) clips go to the end', () => {
    expect(dropTip({ count: 2, atFrame: null, addedFrames: null, fps: FPS }).title).toBe(
      'Drop 2 clips at the end'
    );
  });
});

describe('where a dragged beat lands (ve-move-transition)', () => {
  const story = ['Tunel', 'Výběh', 'Touchdown', 'Dron nad lajnou', 'Huddle'];

  test('Dron nad lajnou lifts and the line says "Drop before Touchdown"; the length does not change', () => {
    const l = moveLanding({ count: story.length, slot: 3, targetSlot: 2 });
    expect(l).toEqual({ position: 'before', refSlot: 2 });
    expect(moveTip(l, story)).toBe('Drop before Touchdown');
  });

  test('past the last beat it drops after it; where it started it drops nowhere', () => {
    const end = moveLanding({ count: story.length, slot: 0, targetSlot: 4 });
    expect(end).toEqual({ position: 'after', refSlot: 4 });
    expect(moveTip(end, story)).toBe('Drop after Huddle');
    expect(moveLanding({ count: story.length, slot: 2, targetSlot: 2 })).toBeNull();
    expect(moveTip(null, story)).toBe('Drop here');
  });

  test('refSlot is an index into the beats as they stood before the lift', () => {
    // dragging the first beat to slot 2 of the others: before the 4th beat of the original order
    expect(moveLanding({ count: story.length, slot: 0, targetSlot: 2 })).toEqual({
      position: 'before',
      refSlot: 3,
    });
  });
});
