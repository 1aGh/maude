// S7.8 — the ruler's steps and words, the frame stepper, the loop band and the play plan (07 · ve-play).
import { describe, expect, test } from 'bun:test';
import { createPlaybackStore, loopAt, STEP_READOUT_MS } from '../client/v2/timeline/playhead.js';
import {
  RULER_STEPS_S,
  readoutLabel,
  rulerLabel,
  rulerStepFrames,
  spanStepSeconds,
} from '../client/v2/timeline/ruler.js';
import {
  inBand,
  isBand,
  loopJump,
  playPlan,
  setLoopIn,
  setLoopOut,
  stepTarget,
} from '../client/v2/timeline/transport.js';

describe('ruler auto-steps 1 / 3 / 5 / 10 / 30 / 60 s by span', () => {
  test('the ladder', () => {
    expect(RULER_STEPS_S).toEqual([1, 3, 5, 10, 30, 60]);
  });

  test.each([
    [8, 1],
    [12, 1],
    [15, 3], // 07 · the 0:15 Reels
    [16, 3],
    [30, 5], // the 0:30 recap
    [32, 5],
    [60, 10],
    [70, 10],
    [160, 30], // a 2:40 video
    [300, 30],
    [301, 60],
    [900, 60],
  ])('a %i s span steps %i s', (span, step) => {
    expect(spanStepSeconds(span)).toBe(step);
  });

  test('a 15 s reel at fit zoom ticks every 3 s; never closer than the labels can breathe', () => {
    const fps = 30;
    expect(rulerStepFrames({ pxPerFrame: 2, fps, spanFrames: 450 })).toBe(3 * fps);
    // squeezed: 1 px per frame would put 3 s ticks 90 px apart — fine; 0.2 px does not
    expect(rulerStepFrames({ pxPerFrame: 0.2, fps, spanFrames: 450 })).toBe(10 * fps);
  });

  test('zoomed in past a second, the frame ladder takes over', () => {
    expect(rulerStepFrames({ pxPerFrame: 40, fps: 30, spanFrames: 60 })).toBeLessThan(30);
  });

  test('labels read m:ss on a whole second and a frame number between', () => {
    expect(rulerLabel(0, 30)).toBe('0:00');
    expect(rulerLabel(210, 30)).toBe('0:07');
    expect(rulerLabel(1830, 30)).toBe('1:01');
    expect(rulerLabel(215, 30)).toBe('215f');
  });
});

describe('the time readout while stepping', () => {
  test('0:07 + 2 frames, 1 frame in the singular, nothing on the second', () => {
    expect(readoutLabel(212, 30, true)).toBe('0:07 + 2 frames');
    expect(readoutLabel(211, 30, true)).toBe('0:07 + 1 frame');
    expect(readoutLabel(210, 30, true)).toBe('0:07');
  });

  test('not stepping, the readout stays the plain time', () => {
    expect(readoutLabel(212, 30, false)).toBe('0:07');
  });
});

describe('← / → a frame, ⇧← / ⇧→ a second', () => {
  test('one frame either way', () => {
    expect(stepTarget({ frame: 212, dir: 1, fps: 30, total: 450 })).toBe(213);
    expect(stepTarget({ frame: 212, dir: -1, fps: 30, total: 450 })).toBe(211);
  });

  test('shift is a whole second of the comp’s own frame rate', () => {
    expect(stepTarget({ frame: 212, dir: 1, shift: true, fps: 30, total: 450 })).toBe(242);
    expect(stepTarget({ frame: 212, dir: -1, shift: true, fps: 24, total: 450 })).toBe(188);
  });

  test('clamped to the cut', () => {
    expect(stepTarget({ frame: 0, dir: -1, fps: 30, total: 450 })).toBe(0);
    expect(stepTarget({ frame: 440, dir: 1, shift: true, fps: 30, total: 450 })).toBe(449);
  });
});

describe('I and O set a loop band', () => {
  test('I at 3.5 s, O at 9 s draws the 07 · ve-play band', () => {
    const a = setLoopIn(null, 105, 450);
    expect(a).toEqual({ in: 105, out: 450 });
    expect(setLoopOut(a, 270, 450)).toEqual({ in: 105, out: 270 });
  });

  test('O first starts the band at the top', () => {
    expect(setLoopOut(null, 270, 450)).toEqual({ in: 0, out: 270 });
  });

  test('an I past the old end, or an O before the old start, repairs the other end', () => {
    expect(setLoopIn({ in: 10, out: 100 }, 200, 450)).toEqual({ in: 200, out: 450 });
    expect(setLoopOut({ in: 200, out: 450 }, 100, 450)).toEqual({ in: 0, out: 100 });
  });

  test('a band is at least a frame, and inBand reads it half-open', () => {
    expect(isBand({ in: 5, out: 5 })).toBe(false);
    expect(isBand(null)).toBe(false);
    expect(inBand({ in: 10, out: 20 }, 10)).toBe(true);
    expect(inBand({ in: 10, out: 20 }, 20)).toBe(false);
  });

  test('with Loop on, playback reaching the end of the band jumps to its start', () => {
    const b = { in: 105, out: 270 };
    expect(loopJump(b, 270, true)).toBe(105);
    expect(loopJump(b, 269, true)).toBeNull();
    expect(loopJump(b, 300, false)).toBeNull();
    expect(loopJump(null, 300, true)).toBeNull();
  });
});

describe('tap Space: play with sound, tap again to pause', () => {
  const base = { muted: false, loop: false, compId: 'reels', frame: 120, total: 450, band: null };

  test('play syncs sound and loop, then plays — in that order', () => {
    const p = playPlan({ ...base, playing: false });
    expect(p.playing).toBe(true);
    expect(p.seekTo).toBeNull();
    expect(p.messages.map((m) => m.dgn)).toEqual([
      'timeline-mute',
      'timeline-loop',
      'timeline-play',
    ]);
    expect(p.messages[0]).toMatchObject({ muted: false, id: 'reels' }); // with sound
  });

  test('the second tap pauses', () => {
    const p = playPlan({ ...base, playing: true });
    expect(p.playing).toBe(false);
    expect(p.messages).toEqual([{ dgn: 'timeline-pause', id: 'reels' }]);
  });

  test('parked at the very end it starts again from the top', () => {
    expect(playPlan({ ...base, playing: false, frame: 449 }).seekTo).toBe(0);
  });

  test('with a loop band, play starts inside it', () => {
    const band = { in: 105, out: 270 };
    expect(playPlan({ ...base, playing: false, frame: 10, band }).seekTo).toBe(105);
    expect(playPlan({ ...base, playing: false, frame: 150, band }).seekTo).toBeNull();
  });
});

describe('what the transport remembers (playhead.js)', () => {
  test('each video has its own loop band; clear forgets it; a hollow band is not kept', () => {
    const s = createPlaybackStore();
    s.setLoop('reels', { in: 105, out: 270 });
    s.setLoop('wide', { in: 0, out: 90 });
    expect(s.loopFor('reels')).toEqual({ in: 105, out: 270 });
    expect(s.loopFor('wide')).toEqual({ in: 0, out: 90 });
    s.setLoop('reels', { in: 5, out: 5 });
    expect(s.loopFor('reels')).toBeNull();
    s.clearLoop('wide');
    expect(s.loopFor('wide')).toBeNull();
  });

  test('a step shows the frame for a moment, then the time is plain again', () => {
    let t = 1000;
    const s = createPlaybackStore({
      now: () => t,
      setTimer: (() => 0) as unknown as typeof setTimeout,
    });
    expect(s.stepping()).toBe(false);
    s.markStep();
    expect(s.stepping()).toBe(true);
    t += STEP_READOUT_MS + 1;
    expect(s.stepping()).toBe(false);
  });

  test('I and O at the followed playhead, and a store that notifies', () => {
    const s = createPlaybackStore();
    let seen = 0;
    s.subscribe(() => seen++);
    loopAt('in', { compId: 'reels', frame: 105, total: 450 }, s);
    loopAt('out', { compId: 'reels', frame: 270, total: 450 }, s);
    expect(s.loopFor('reels')).toEqual({ in: 105, out: 270 });
    expect(seen).toBe(2);
    loopAt('in', null as never, s); // nothing followed: nothing happens
    expect(seen).toBe(2);
  });
});
