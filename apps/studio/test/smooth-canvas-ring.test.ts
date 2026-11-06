// 2.0.7 — smooth canvases with real data: the mount RING of artboard-live.ts. A canvas holds the DOM of what is
// on screen plus a prefetch ring, releases what has been far away for a while (hysteresis: a larger keep ring
// and a grace), never mounts past a DOM budget, keeps mounting on-screen artboards during a gesture (asleep,
// one per frame), and a capture still gets everything.
import { describe, expect, test } from 'bun:test';
import {
  GESTURE_MOUNT_GAP_MS,
  LAYER_MAX_VISIBLE,
  LiveRegistry,
  MOUNT_NODE_BUDGET,
  RELEASE_AFTER_MS,
  WAKE_PER_FRAME,
} from '../artboard-live.ts';

function rig(opts: { budget?: number; ceiling?: number; mode?: 'sleep' | 'light' } = {}) {
  const frames: Array<() => void> = [];
  const timers: Array<{ at: number; fn: () => void }> = [];
  let clock = 1000;
  const r = new LiveRegistry(opts.mode ?? 'sleep', (fn) => frames.push(fn), {
    now: () => clock,
    later: (fn, ms) => timers.push({ at: clock + ms, fn }),
    budget: opts.budget,
    ceiling: opts.ceiling,
  });
  return {
    r,
    /** one animation frame, 16 ms later */
    frame() {
      clock += 16;
      for (const fn of frames.splice(0)) fn();
    },
    frames(n = 50) {
      for (let i = 0; i < n; i++) this.frame();
    },
    advance(ms: number) {
      clock += ms;
      for (const t of timers.splice(0)) {
        if (t.at <= clock) t.fn();
        else timers.push(t);
      }
    },
    slowFrame(ms: number) {
      clock += ms;
      for (const fn of frames.splice(0)) fn();
    },
  };
}

const seen = (r: LiveRegistry, ids: string[]) => ids.filter((id) => r.get(id).seen);

describe('the mount ring', () => {
  test('a mounted artboard that leaves the keep ring is released after the grace, not before', () => {
    const k = rig();
    k.r.subscribe('a', () => {});
    k.r.setNear('a', true);
    k.r.setVisible('a', true);
    k.frames();
    expect(k.r.get('a').seen).toBe(true);
    k.r.setVisible('a', false);
    k.r.setNear('a', false);
    k.r.setKeep('a', false);
    k.advance(RELEASE_AFTER_MS - 100);
    expect(k.r.get('a').seen).toBe(true);
    k.advance(200);
    expect(k.r.get('a')).toEqual({ live: false, seen: false });
  });

  test('hysteresis: back inside the keep ring before the grace runs out, it stays mounted', () => {
    const k = rig();
    k.r.subscribe('a', () => {});
    k.r.setNear('a', true);
    k.frames();
    k.r.setNear('a', false);
    // between the prefetch ring and the keep ring: kept, however long
    k.advance(RELEASE_AFTER_MS * 4);
    expect(k.r.get('a').seen).toBe(true);
    k.r.setKeep('a', false);
    k.advance(RELEASE_AFTER_MS / 2);
    k.r.setKeep('a', true);
    k.advance(RELEASE_AFTER_MS * 2);
    expect(k.r.get('a').seen).toBe(true);
  });

  test('nothing is released mid-gesture; the settle releases what waited', () => {
    const k = rig();
    k.r.subscribe('a', () => {});
    k.r.setNear('a', true);
    k.frames();
    k.r.setInteracting(true);
    k.r.setNear('a', false);
    k.r.setKeep('a', false);
    k.advance(RELEASE_AFTER_MS * 2);
    expect(k.r.get('a').seen).toBe(true);
    k.r.setInteracting(false);
    expect(k.r.get('a').seen).toBe(false);
  });

  test('a pinned (active) artboard is never released', () => {
    const k = rig();
    k.r.subscribe('a', () => {});
    k.r.setNear('a', true);
    k.frames();
    k.r.setPinned('a', true);
    k.r.setNear('a', false);
    k.r.setKeep('a', false);
    k.advance(RELEASE_AFTER_MS * 2);
    expect(k.r.get('a').seen).toBe(true);
    k.r.setPinned('a', false);
    k.advance(RELEASE_AFTER_MS + 20);
    expect(k.r.get('a').seen).toBe(false);
  });
});

// 2.0.7 regression (video e2e): every write soft-reloads the canvas, which remounts every artboard's gate
// (`key=attempt`). The old gate unsubscribed, the slot went with it, the new gate subscribed to a fresh slot and
// fell back to a placeholder for a few frames — just when the shell reselects after `loaded`. The selected clip
// was gone, so the Transcript / Re-frame panel closed and Present lost its selection.
describe('a remount (an edit soft-reloads the canvas) never sends a mounted artboard back to a placeholder', () => {
  test('unsubscribe then subscribe in the same commit keeps the slot mounted and live', () => {
    const k = rig();
    const off = k.r.subscribe('a', () => {});
    k.r.setNear('a', true);
    k.r.setVisible('a', true);
    k.frames();
    expect(k.r.get('a')).toEqual({ live: true, seen: true });
    const views: Array<{ live: boolean; seen: boolean }> = [];
    // the commit: the old gate's layout cleanup, then the new gate's layout subscribe
    off();
    k.r.subscribe('a', (s) => views.push(s));
    expect(k.r.get('a')).toEqual({ live: true, seen: true });
    // then the old gate's passive cleanup (it unobserves its old article) — the new gate holds the id
    k.r.unobserve('a');
    k.frames();
    k.advance(RELEASE_AFTER_MS * 2);
    expect(k.r.get('a')).toEqual({ live: true, seen: true });
    expect(views).toEqual([]); // never a placeholder, never a sleep, in between
  });

  test('a slot nobody re-subscribes to is dropped after the grace (a real unmount)', () => {
    const k = rig();
    const off = k.r.subscribe('a', () => {});
    k.r.setNear('a', true);
    k.frames();
    off();
    k.r.unobserve('a');
    k.advance(1000);
    expect(k.r.mountedCount()).toBe(0);
    expect(k.r.get('a')).toEqual({ live: false, seen: false });
  });

  test('unobserve never resurrects a slot that is gone', () => {
    const k = rig();
    k.r.unobserve('ghost');
    expect(k.r.mountedCount()).toBe(0);
    expect(k.r.visibleCount()).toBe(0);
  });
});

describe('an artboard holding the selection (or the active one) is never released nor pushed out', () => {
  test('pinned far away for long: kept; and an on-screen mount past the budget never evicts it', () => {
    const k = rig({ budget: 1000, ceiling: 1000 });
    for (const id of ['sel', 'b']) k.r.subscribe(id, () => {});
    k.r.setNear('sel', true);
    k.frames();
    k.r.setWeight('sel', 900);
    k.r.setPinned('sel', true);
    k.r.setNear('sel', false);
    k.r.setKeep('sel', false);
    k.advance(RELEASE_AFTER_MS * 3);
    expect(k.r.get('sel').seen).toBe(true);
    // an on-screen artboard that does not fit: it would push out what is off screen — never the pinned one
    k.r.setVisible('b', true);
    k.r.setNear('b', true);
    k.frames();
    expect(k.r.get('sel').seen).toBe(true);
  });

  test('a live artboard (its media may be playing) is near, so it is never released', () => {
    const k = rig();
    k.r.subscribe('v', () => {});
    k.r.setNear('v', true);
    k.frames();
    expect(k.r.get('v').live).toBe(true);
    k.r.setVisible('v', false);
    k.r.setKeep('v', false); // a keep-ring report while near is ignored
    k.advance(RELEASE_AFTER_MS * 3);
    expect(k.r.get('v')).toEqual({ live: true, seen: true });
  });
});

describe('the DOM budget', () => {
  test('the default budget is a real bound', () => {
    expect(MOUNT_NODE_BUDGET).toBeGreaterThan(2000);
    expect(MOUNT_NODE_BUDGET).toBeLessThan(40000);
  });

  test('what is on screen always mounts — past the budget, up to the ceiling; the budget bounds what is off screen', () => {
    // the mascot canvas at a settled view: 41 artboards on screen weighed 17k against a 12k budget, and three
    // of them stayed placeholders for good — the viewport was never right
    const k = rig({ budget: 1000, ceiling: 2000 });
    const ids = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'];
    ids.forEach((id, i) => {
      k.r.subscribe(id, () => {});
      k.r.setWeight(id, 450);
      k.r.setNear(id, true, (ids.length - i) * 100);
      k.r.setVisible(id, true);
    });
    k.frames();
    // 4 × 450 = 1800 ≤ the 2000 ceiling (past the 1000 budget); the fifth would cross the ceiling
    expect(seen(k.r, ids)).toEqual(['a2', 'a3', 'a4', 'a5']);
    // nothing off screen mounts while the canvas is past its budget
    k.r.subscribe('p', () => {});
    k.r.setNear('p', true, 50);
    k.frames();
    expect(k.r.get('p').seen).toBe(false);
  });

  test('on-screen artboards mount nearest the centre first, and stop at the ceiling', () => {
    const k = rig({ budget: 1000, ceiling: 1000 });
    const ids = ['a0', 'a1', 'a2', 'a3', 'a4'];
    ids.forEach((id, i) => {
      k.r.subscribe(id, () => {});
      // a4 is the nearest, a0 the farthest
      k.r.setNear(id, true, (ids.length - i) * 100);
      k.r.setVisible(id, true);
    });
    k.frame();
    // unmeasured, each counts 400: the nearest two fit 1000, the third would not
    expect(seen(k.r, ids)).toEqual(['a3', 'a4']);
    k.r.setWeight('a3', 300);
    k.r.setWeight('a4', 300);
    k.frames();
    // measured lighter (300 each): one more fits (a2, the next nearest), then nothing
    expect(seen(k.r, ids)).toEqual(['a2', 'a3', 'a4']);
    k.r.setWeight('a2', 300);
    k.frames();
    expect(seen(k.r, ids)).toEqual(['a2', 'a3', 'a4']);
    expect(k.r.mountedWeight()).toBe(900);
  });

  test('an on-screen artboard pushes out an off-screen one (farthest, outside the prefetch ring first)', () => {
    const k = rig({ budget: 1000 });
    for (const [id, d] of [
      ['ring', 300],
      ['kept', 900],
    ] as const) {
      k.r.subscribe(id, () => {});
      k.r.setNear(id, true, d);
    }
    k.frames();
    k.r.setWeight('ring', 500);
    k.r.setWeight('kept', 500);
    k.r.setNear('kept', false); // left the prefetch ring, still inside the keep ring
    k.r.subscribe('v', () => {});
    k.r.setNear('v', true, 0);
    k.r.setVisible('v', true);
    k.frames();
    expect(k.r.get('v').seen).toBe(true);
    expect(k.r.get('kept').seen).toBe(false);
    expect(k.r.get('ring').seen).toBe(true);
  });

  test('a prefetch never pushes anything out', () => {
    const k = rig({ budget: 1000 });
    k.r.subscribe('v', () => {});
    k.r.setNear('v', true, 0);
    k.r.setVisible('v', true);
    k.frames();
    k.r.setWeight('v', 900);
    k.r.subscribe('p', () => {});
    k.r.setNear('p', true, 500);
    k.frames();
    expect(k.r.get('v').seen).toBe(true);
    expect(k.r.get('p').seen).toBe(false);
  });

  test('a capture mounts everything at once, whatever the budget', () => {
    const k = rig({ budget: 10 });
    const ids = ['a', 'b', 'c', 'd'];
    for (const id of ids) k.r.subscribe(id, () => {});
    k.r.setZoom(0.05);
    const release = k.r.holdAllLive();
    expect(ids.every((id) => k.r.get(id).live && k.r.get(id).seen)).toBe(true);
    release();
  });
});

describe('loading never blocks a gesture', () => {
  test('on-screen artboards keep mounting during a gesture — asleep, one per frame — and wake on the settle', () => {
    const k = rig();
    const ids = ['a', 'b', 'c', 'd'];
    k.r.setInteracting(true);
    for (const id of ids) {
      k.r.subscribe(id, () => {});
      k.r.setNear(id, true, 1);
      k.r.setVisible(id, true);
    }
    k.frame();
    expect(seen(k.r, ids)).toHaveLength(1);
    expect(ids.some((id) => k.r.isLive(id))).toBe(false);
    // the next one not sooner than GESTURE_MOUNT_GAP_MS later (a WebKit mount lays out + paints at once)
    k.frames(Math.floor(GESTURE_MOUNT_GAP_MS / 16) - 2);
    expect(seen(k.r, ids)).toHaveLength(1);
    k.frames(Math.ceil((3 * GESTURE_MOUNT_GAP_MS) / 16) + 6);
    expect(seen(k.r, ids)).toHaveLength(4);
    expect(ids.some((id) => k.r.isLive(id))).toBe(false);
    k.r.setInteracting(false);
    k.frames();
    expect(ids.every((id) => k.r.isLive(id))).toBe(true);
  });

  test('the prefetch ring waits for the settle', () => {
    const k = rig();
    k.r.setInteracting(true);
    k.r.subscribe('p', () => {});
    k.r.setNear('p', true, 800);
    k.frames();
    expect(k.r.get('p').seen).toBe(false);
    k.r.setInteracting(false);
    k.frames();
    expect(k.r.get('p').seen).toBe(true);
  });

  test('after a slow frame, the next frame mounts one artboard', () => {
    const k = rig();
    const ids = Array.from({ length: 8 }, (_, i) => `a${i}`);
    for (const id of ids) {
      k.r.subscribe(id, () => {});
      k.r.setNear(id, true, 1);
      k.r.setVisible(id, true);
    }
    k.frame();
    expect(seen(k.r, ids)).toHaveLength(WAKE_PER_FRAME);
    k.slowFrame(120);
    expect(seen(k.r, ids)).toHaveLength(WAKE_PER_FRAME + 1);
    k.frame();
    expect(seen(k.r, ids)).toHaveLength(2 * WAKE_PER_FRAME + 1);
  });

  test('overview() follows the zoom; a settle is announced (WebKit drops per-artboard layers there)', () => {
    const k = rig();
    let settled = 0;
    k.r.onSettle(() => {
      settled += 1;
    });
    k.r.setZoom(1);
    expect(k.r.overview()).toBe(false);
    k.r.setZoom(0.08);
    expect(k.r.overview()).toBe(true);
    k.r.setInteracting(true);
    k.r.setInteracting(false);
    expect(settled).toBe(1);
    expect(new LiveRegistry('off', () => {}).overview()).toBe(false);
    // crowded: more on screen than LAYER_MAX_VISIBLE (zoom alone is not enough — a few big boards keep layers)
    expect(k.r.crowded()).toBe(false);
    for (let i = 0; i <= LAYER_MAX_VISIBLE; i++) {
      k.r.subscribe(`c${i}`, () => {});
      k.r.setVisible(`c${i}`, true);
    }
    expect(k.r.crowded()).toBe(true);
  });

  test('light mode (after a crash) is unchanged: only live artboards mount', () => {
    const k = rig({ mode: 'light' });
    k.r.subscribe('a', () => {});
    k.r.setZoom(0.05);
    k.r.setNear('a', true);
    k.r.setVisible('a', true);
    k.frames();
    expect(k.r.get('a').seen).toBe(false);
  });
});

// 2.0.7 regression (video-formats "Add a format", video-present): a video artboard's comp registers itself only
// while it is mounted (window.__maudeVideoComps), and the link glyph, the Timeline's "Shared by 2 formats" and
// Present's format switch are all read from those registrations. A new 16:9 format placed beside the reel, outside
// the prefetch ring, stayed a placeholder — so the canvas and the shell saw one format.
describe('an eager artboard (a video) is always mounted', () => {
  test('far away it mounts anyway, past the budget, and is never released nor pushed out', () => {
    const k = rig({ budget: 500, ceiling: 500 });
    for (const id of ['on', 'video']) k.r.subscribe(id, () => {});
    k.r.setNear('on', true);
    k.r.setVisible('on', true);
    k.frames();
    k.r.setWeight('on', 480);
    k.r.setEager('video', true);
    k.r.setKeep('video', false);
    k.frames();
    expect(k.r.get('video')).toEqual({ live: false, seen: true }); // mounted, asleep (not near)
    k.r.setWeight('video', 400);
    k.advance(RELEASE_AFTER_MS * 3);
    // an on-screen artboard that does not fit pushes out what is off screen — never the eager one
    k.r.subscribe('b', () => {});
    k.r.setNear('b', true);
    k.r.setVisible('b', true);
    k.frames();
    expect(k.r.get('video').seen).toBe(true);
    k.r.setEager('video', false);
    k.advance(RELEASE_AFTER_MS + 20);
    expect(k.r.get('video').seen).toBe(false);
  });

  test('light mode (after a crash) ignores it: only live artboards mount', () => {
    const k = rig({ mode: 'light' });
    k.r.subscribe('video', () => {});
    k.r.setEager('video', true);
    k.frames();
    expect(k.r.get('video').seen).toBe(false);
  });
});
