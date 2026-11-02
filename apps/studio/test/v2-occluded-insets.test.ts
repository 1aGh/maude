// V2-4.1 (T6-shell) — the shell side of occluded insets (V2-1.2 §5.6): the islands → insets measure,
// and the pump that sends them to the canvas iframe(s) only on change, coalesced to one per animation
// frame, with a strictly increasing seq, seeded on `loaded`.
import { describe, expect, test } from 'bun:test';
import type { Insets } from '../bridge/occlusion.ts';
import {
  createInsetsPump,
  measureShellInsets,
  SEED_LADDER_MS,
  seedOnLadder,
} from '../client/v2/shell/occlusion-insets.js';

type R = { left: number; top: number; right: number; bottom: number };
const box = (r: R) => ({ ...r, width: r.right - r.left, height: r.bottom - r.top });
const el = (rect: R, attrs: Record<string, string> = {}) => ({
  getBoundingClientRect: () => box(rect),
  getAttribute: (k: string) => attrs[k] ?? null,
});
const root = (els: ReturnType<typeof el>[]) => ({ querySelectorAll: () => els });

const FRAME: R = { left: 0, top: 0, right: 1200, bottom: 800 };
const frame = el(FRAME);

describe('measureShellInsets', () => {
  test('pinned panels sit beside the frame, not over it: zero', () => {
    const left = el({ left: -280, top: 0, right: 0, bottom: 800 }, { 'data-occludes': 'left' });
    const right = el(
      { left: 1200, top: 0, right: 1500, bottom: 800 },
      { 'data-occludes': 'right' }
    );
    expect(measureShellInsets(frame, root([left, right]))).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  test('a floating left panel gives its right edge plus the 8px gap', () => {
    const left = el({ left: 16, top: 16, right: 264, bottom: 784 }, { 'data-occludes': 'left' });
    expect(measureShellInsets(frame, root([left]))).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 272,
    });
  });

  test('folded corner icons count; the deepest island per edge wins', () => {
    const icon = el({ left: 16, top: 16, right: 50, bottom: 50 }, { 'data-occludes': 'left' });
    const spark = el(
      { left: 1150, top: 750, right: 1184, bottom: 784 },
      { 'data-occludes': 'right' }
    );
    const ai = el({ left: 880, top: 16, right: 1184, bottom: 784 }, { 'data-occludes': 'right' });
    expect(measureShellInsets(frame, root([icon]))).toMatchObject({ left: 58, right: 0 });
    expect(measureShellInsets(frame, root([icon, spark, ai]))).toMatchObject({
      left: 58,
      right: 328,
    });
  });

  test('hidden / zero-size islands and unknown edges are ignored', () => {
    const hidden = el({ left: 0, top: 0, right: 0, bottom: 0 }, { 'data-occludes': 'left' });
    const bogus = el({ left: 16, top: 16, right: 300, bottom: 400 }, { 'data-occludes': 'middle' });
    const none = el({ left: 16, top: 16, right: 300, bottom: 400 });
    expect(measureShellInsets(frame, root([hidden, bogus, none]))).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  test('presenting, or a frame with no size, yields zeros', () => {
    const left = el({ left: 16, top: 16, right: 264, bottom: 784 }, { 'data-occludes': 'left' });
    expect(measureShellInsets(frame, root([left]), { presenting: true }).left).toBe(0);
    expect(
      measureShellInsets(el({ left: 0, top: 0, right: 0, bottom: 0 }), root([left])).left
    ).toBe(0);
    expect(measureShellInsets(null, root([left])).left).toBe(0);
  });
});

function pumpRig(initial: Insets) {
  let cur = initial;
  const sent: Array<{ seq: number; insets: Insets; to: string }> = [];
  const frames: Array<() => void> = [];
  const pump = createInsetsPump({
    measure: () => cur,
    send: (seq, insets, to) => sent.push({ seq, insets, to: to ?? 'all' }),
    schedule: (fn) => {
      frames.push(fn);
    },
  });
  const tick = () => {
    const f = frames.splice(0);
    for (const fn of f) fn();
  };
  return {
    pump,
    sent,
    tick,
    set: (i: Insets) => {
      cur = i;
    },
    pending: () => frames.length,
  };
}
const Z: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('seedOnLadder', () => {
  test('re-seeds one window on the ladder (its runtime listener is not up when `loaded` arrives)', () => {
    const r = pumpRig({ ...Z, left: 272 });
    const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
    seedOnLadder(r.pump, 'frame-a', {
      setTimer: (fn: () => void, ms: number) => {
        const t = { fn, ms, live: true };
        timers.push(t);
        return t;
      },
      clearTimer: (t: { live: boolean }) => {
        t.live = false;
      },
    });
    expect(timers.map((t) => t.ms)).toEqual(SEED_LADDER_MS);
    for (const t of timers) t.fn();
    expect(r.sent).toHaveLength(SEED_LADDER_MS.length);
    expect(r.sent.every((s) => s.to === 'frame-a')).toBe(true);
    const seqs = r.sent.map((s) => s.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length); // each rung is newer, or the canvas would drop it (I4)
  });

  test('stops once the window is gone, and cancel() clears every rung', () => {
    const r = pumpRig({ ...Z, left: 9 });
    let alive = true;
    const timers: Array<{ fn: () => void; live: boolean }> = [];
    const cancel = seedOnLadder(r.pump, 'frame-a', {
      alive: () => alive,
      setTimer: (fn: () => void) => {
        const t = { fn, live: true };
        timers.push(t);
        return t;
      },
      clearTimer: (t: { live: boolean }) => {
        t.live = false;
      },
    });
    timers[0]?.fn();
    alive = false;
    timers[1]?.fn();
    expect(r.sent).toHaveLength(1);
    cancel();
    expect(timers.every((t) => !t.live)).toBe(true);
  });
});

describe('createInsetsPump', () => {
  test('many requests in a frame coalesce into one send', () => {
    const r = pumpRig({ ...Z, left: 272 });
    r.pump.request();
    r.pump.request();
    r.pump.request();
    expect(r.pending()).toBe(1);
    r.tick();
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ insets: { left: 272 }, to: 'all' });
  });

  test('sends only on change; seq strictly increases', () => {
    const r = pumpRig({ ...Z, left: 272 });
    r.pump.request();
    r.tick();
    r.pump.request();
    r.tick(); // unchanged → nothing
    expect(r.sent).toHaveLength(1);
    r.set({ ...Z, left: 58 });
    r.pump.request();
    r.tick();
    r.set(Z);
    r.pump.request();
    r.tick();
    const seqs = r.sent.map((s) => s.seq);
    expect(seqs).toHaveLength(3);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(3);
  });

  test('a first all-zero measure still seeds nothing by itself (no change from the canvas default)', () => {
    const r = pumpRig(Z);
    r.pump.request();
    r.tick();
    expect(r.sent).toHaveLength(0);
  });

  test('seed(win) sends the current value to that window only, even when unchanged, with a newer seq', () => {
    const r = pumpRig({ ...Z, left: 272 });
    r.pump.request();
    r.tick();
    r.pump.seed('frame-b');
    r.pump.seed('frame-b');
    expect(r.sent.map((s) => s.to)).toEqual(['all', 'frame-b', 'frame-b']);
    const seqs = r.sent.map((s) => s.seq);
    expect(seqs[1]).toBeGreaterThan(seqs[0] as number);
    expect(seqs[2]).toBeGreaterThan(seqs[1] as number);
  });

  test('a seed before any frame measures on the spot', () => {
    const r = pumpRig({ ...Z, right: 328 });
    r.pump.seed('frame-a');
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ to: 'frame-a', insets: { right: 328 } });
  });

  test('dispose cancels a pending frame', () => {
    const r = pumpRig({ ...Z, left: 9 });
    r.pump.request();
    r.pump.dispose();
    r.tick();
    expect(r.sent).toHaveLength(0);
  });
});
