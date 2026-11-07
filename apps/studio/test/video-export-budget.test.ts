// video-export-budget — issue #128 §2a/§2b/§2c (T1.1).
//
// §2a  the shim's hard-kill budget scales with the frame count and stretches while frames keep
//      completing, so a long frame-step export is not killed mid-progress.
// §2b  the timeout message names the platform it is actually on.
// §2c  an export that passes no scale renders at 1× when the artboard's short side is >= 1080 px,
//      at 2× otherwise (decision maude/burndown-d6-default-export-scale).

import { describe, expect, test } from 'bun:test';

// @ts-expect-error — plain .mjs helper shared with the capture shim
import * as limits from '../bin/_video-limits.mjs';
// index first: video.ts alone trips the exporters import cycle (it is how every caller loads it)
import '../exporters/index.ts';
import { resolveScaleArg } from '../exporters/video.ts';

interface FakeTimer {
  at: number;
  fn: () => void;
  live: boolean;
}

/** A manual clock + timer list, so the watchdog is driven without real waiting. */
function fakeClock() {
  let t = 0;
  const timers: FakeTimer[] = [];
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const h = { at: t + ms, fn, live: true };
      timers.push(h);
      return h;
    },
    clearTimer: (h: FakeTimer) => {
      h.live = false;
    },
    advance(to: number) {
      for (;;) {
        const due = timers.filter((x) => x.live && x.at <= to).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.live = false;
        t = due.at;
        due.fn();
      }
      t = to;
    },
    get time() {
      return t;
    },
  };
}

describe('§2a hard-kill budget', () => {
  test('keeps the old floor for a short or unknown render', () => {
    expect(limits.hardKillBudgetMs({ timeoutMs: 60_000, frames: 0 })).toBe(150_000);
    expect(limits.hardKillBudgetMs({ timeoutMs: 60_000 })).toBe(150_000);
    expect(limits.hardKillBudgetMs({ timeoutMs: 300_000, frames: 0 })).toBe(300_000);
  });

  test('grows with the frame count so 1294 frames at ~2.5 s/frame fit', () => {
    const ms = limits.hardKillBudgetMs({ timeoutMs: 120_000, frames: 1294 });
    expect(ms).toBeGreaterThan(1294 * 2_500);
    expect(limits.hardKillBudgetMs({ timeoutMs: 120_000, frames: 2588 })).toBeGreaterThan(ms);
  });

  test('a render that keeps completing frames is not killed at the first deadline', () => {
    const clock = fakeClock();
    const killed: string[] = [];
    const hk = limits.createHardKill({
      timeoutMs: 60_000,
      onKill: (why: string) => killed.push(why),
      ...clock,
    });
    hk.setFrames(10);
    const budget = limits.hardKillBudgetMs({ timeoutMs: 60_000, frames: 10 });
    // frames complete right up to and well past the budget: still alive
    for (let at = 10_000; at <= budget + 100_000; at += 10_000) {
      clock.advance(at);
      hk.progress();
    }
    expect(killed).toEqual([]);
    // then it stalls: killed once the stall window passes with no frame
    clock.advance(clock.time + limits.HARD_KILL_STALL_MS + 1_000);
    expect(killed.length).toBe(1);
  });

  test('a render that never completes a frame is still killed at the budget', () => {
    const clock = fakeClock();
    const killed: string[] = [];
    limits.createHardKill({
      timeoutMs: 60_000,
      onKill: (why: string) => killed.push(why),
      ...clock,
    });
    clock.advance(149_999);
    expect(killed).toEqual([]);
    clock.advance(150_001);
    expect(killed.length).toBe(1);
  });

  test('frames arriving later raise the deadline of a render that is already running', () => {
    const clock = fakeClock();
    const killed: string[] = [];
    const hk = limits.createHardKill({
      timeoutMs: 60_000,
      onKill: (why: string) => killed.push(why),
      ...clock,
    });
    clock.advance(100_000);
    hk.setFrames(1294); // the fast path failed; the frame-step fallback learned its length
    hk.progress();
    clock.advance(200_000);
    hk.progress();
    expect(killed).toEqual([]);
  });
});

describe('§2b platform-aware timeout message', () => {
  test('macOS does not blame headless Linux', () => {
    const m = limits.hardTimeoutMessage({ ms: 150_000, platform: 'darwin', gpu: false });
    expect(m).not.toMatch(/linux/i);
    expect(m).toMatch(/macOS/);
    expect(m).toMatch(/150000ms/);
  });

  test('Linux keeps the headless-encoder hint', () => {
    const m = limits.hardTimeoutMessage({ ms: 150_000, platform: 'linux', gpu: true });
    expect(m).toMatch(/headless Linux/);
    expect(m).toMatch(/gpu=on/);
  });

  test('reports how far it got when frames were completing', () => {
    const m = limits.hardTimeoutMessage({
      ms: 1,
      platform: 'darwin',
      gpu: false,
      frame: 413,
      total: 1294,
    });
    expect(m).toMatch(/413 of 1294/);
  });
});

describe('§2c default export scale', () => {
  test('1x when the short side is >= 1080, else 2x', () => {
    expect(limits.defaultVideoScale(1080, 1900)).toBe(1);
    expect(limits.defaultVideoScale(1920, 1080)).toBe(1);
    expect(limits.defaultVideoScale(3840, 2160)).toBe(1);
    expect(limits.defaultVideoScale(1079, 1920)).toBe(2);
    expect(limits.defaultVideoScale(960, 540)).toBe(2);
  });

  test('an unmeasurable board keeps the old default of 2x', () => {
    expect(limits.defaultVideoScale(0, 0)).toBe(2);
    expect(limits.defaultVideoScale(Number.NaN, 1080)).toBe(2);
  });

  test('the exporter leaves the choice to the shim unless the user passed a scale', () => {
    expect(resolveScaleArg({})).toBe('auto');
    expect(resolveScaleArg({ scale: undefined })).toBe('auto');
    expect(resolveScaleArg({ scale: 1 })).toBe('1');
    expect(resolveScaleArg({ scale: 2 })).toBe('2');
    expect(resolveScaleArg({ scale: 3 })).toBe('3');
  });
});
