// 2.0.7 — the mount ring mid-gesture: nothing goes down (no sleep, no media release, no unmount, no eviction)
// while the camera moves; on screen only what would otherwise show a block mounts (over the cut, the active
// artboard, a video); the settle applies the rest and frees what the gesture's mounts took past the budget.
import { describe, expect, test } from 'bun:test';
import { LiveRegistry } from '../artboard-live.ts';

function rig(opts: { budget?: number } = {}) {
  const frames: Array<() => void> = [];
  const timers: Array<{ at: number; fn: () => void }> = [];
  let clock = 1000;
  const r = new LiveRegistry('sleep', (fn) => frames.push(fn), {
    now: () => clock,
    later: (fn, ms) => timers.push({ at: clock + ms, fn }),
    budget: opts.budget,
  });
  return {
    r,
    frames(n = 30) {
      for (let i = 0; i < n; i++) {
        clock += 16;
        for (const fn of frames.splice(0)) fn();
      }
    },
    advance(ms: number) {
      clock += ms;
      for (const t of timers.splice(0)) {
        if (t.at <= clock) t.fn();
        else timers.push(t);
      }
    },
  };
}

describe('the mount ring changes nothing mid-gesture', () => {
  test('an awake artboard that leaves the prefetch ring mid-gesture stays awake until the settle', () => {
    const k = rig();
    const views: boolean[] = [];
    k.r.subscribe('a', (s) => views.push(s.live));
    k.r.setNear('a', true);
    k.r.setVisible('a', true);
    k.frames();
    expect(k.r.get('a').live).toBe(true);
    k.r.setInteracting(true);
    k.r.setVisible('a', false);
    k.r.setNear('a', false);
    k.frames();
    expect(k.r.get('a')).toMatchObject({ live: true, seen: true });
    expect(k.r.churnStats().gestureDowns).toBe(0);
    k.r.setInteracting(false);
    expect(k.r.get('a').live).toBe(false); // the settle puts it to sleep
    expect(views).toEqual([true, false]);
  });

  test('a mid-gesture mount pushes nothing out; the settle frees what it took past the budget', () => {
    const k = rig({ budget: 1000 });
    for (const id of ['far', 'on']) k.r.subscribe(id, () => {});
    k.r.setNear('far', true);
    k.r.setWeight('far', 900);
    k.frames();
    expect(k.r.get('far').seen).toBe(true);
    k.r.setNear('far', false); // still inside the keep ring: kept, not released
    k.r.setInteracting(true);
    k.r.setWeight('on', 400);
    k.r.setNear('on', true);
    k.r.setVisible('on', true);
    k.frames();
    expect(k.r.get('on').seen).toBe(true); // what is on screen mounts mid-gesture, past the budget
    expect(k.r.get('far').seen).toBe(true); // and pushes nothing out while the camera moves
    expect(k.r.churnStats()).toMatchObject({ gestureDowns: 0, releases: 0 });
    k.r.setInteracting(false);
    expect(k.r.get('far').seen).toBe(false); // the settle frees the budget
    expect(k.r.get('on').seen).toBe(true);
  });

  test('mid-gesture an on-screen artboard under the cut waits for the settle; over the cut, or the active one, mounts', () => {
    const k = rig();
    for (const id of ['small', 'big', 'pinned']) k.r.subscribe(id, () => {});
    k.r.setMayWait((id) => id !== 'big');
    k.r.setPinned('pinned', true);
    k.r.setInteracting(true);
    for (const id of ['small', 'big', 'pinned']) {
      k.r.setNear(id, true);
      k.r.setVisible(id, true);
    }
    k.frames(60);
    k.advance(1000);
    k.frames(60);
    expect(k.r.get('big').seen).toBe(true);
    expect(k.r.get('pinned').seen).toBe(true);
    expect(k.r.get('small').seen).toBe(false);
    k.r.setInteracting(false);
    k.frames();
    expect(k.r.get('small')).toMatchObject({ seen: true, live: true });
  });
});
