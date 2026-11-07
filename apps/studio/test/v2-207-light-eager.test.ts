// 2.0.7 — light canvases mount every artboard and keep it (decision `v2-207-light-canvas-mounts-all`). A canvas
// whose measured element count (the measured artboards plus their average for the rest) fits MOUNT_NODE_BUDGET
// mounts every artboard, far ones too, paced by the queue, and never releases one: no churn and no stand-in blocks,
// as in 1.x. A heavy canvas keeps the ring. A light canvas that grows past the budget falls back to the ring. A
// video artboard's media still follows the ring, and nothing mounts or goes down mid-gesture that would not before.
import { describe, expect, test } from 'bun:test';
import {
  LIGHT_MIN_MEASURED,
  LiveRegistry,
  MOUNT_NODE_BUDGET,
  RELEASE_AFTER_MS,
} from '../artboard-live.ts';

function rig() {
  const frames: Array<() => void> = [];
  const timers: Array<{ at: number; fn: () => void }> = [];
  let clock = 1000;
  const r = new LiveRegistry('sleep', (fn) => frames.push(fn), {
    now: () => clock,
    later: (fn, ms) => timers.push({ at: clock + ms, fn }),
  });
  return {
    r,
    timers,
    frames(n = 60) {
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

type Rig = ReturnType<typeof rig>;

/**
 * A canvas of `n` artboards weighing `weight` elements each; the first `onScreen` are on screen (and near), the rest
 * far outside the keep ring. The gate's part is played here: every artboard that mounts is weighed.
 */
function canvas(k: Rig, n: number, weight: number, onScreen: number): string[] {
  const ids = Array.from({ length: n }, (_, i) => `ab${i}`);
  ids.forEach((id, i) => {
    k.r.subscribe(id, () => {});
    if (i < onScreen) {
      k.r.setNear(id, true, i);
      k.r.setVisible(id, true);
    } else {
      k.r.setNear(id, false, 10_000 + i);
      k.r.setKeep(id, false);
    }
  });
  settle(k, ids, weight);
  return ids;
}

/** Frames until nothing more mounts, weighing what did (as the gate's mount effect does). */
function settle(k: Rig, ids: string[], weight: number | ((id: string) => number)) {
  for (let round = 0; round < 40; round++) {
    k.frames(4);
    for (const id of ids)
      if (k.r.get(id).seen) k.r.setWeight(id, typeof weight === 'number' ? weight : weight(id));
  }
}

const mounted = (k: Rig, ids: string[]) => ids.filter((id) => k.r.get(id).seen).length;

describe('a light canvas mounts every artboard and keeps it', () => {
  test('far artboards mount too, once enough artboards are measured to know the canvas is light', () => {
    const k = rig();
    // 81 artboards × 65 elements = 5.3k (math-learning-spaces) against a 12k budget
    const ids = canvas(k, 81, 65, 6);
    expect(81 * 65).toBeLessThan(MOUNT_NODE_BUDGET);
    expect(mounted(k, ids)).toBe(81);
    expect(k.r.isLight()).toBe(true);
  });

  test('nothing is released: far for many graces, every artboard stays mounted', () => {
    const k = rig();
    const ids = canvas(k, 40, 65, 4);
    // the on-screen ones leave too (a pan to an empty corner)
    for (const id of ids.slice(0, 4)) {
      k.r.setVisible(id, false);
      k.r.setNear(id, false);
      k.r.setKeep(id, false);
    }
    k.advance(RELEASE_AFTER_MS * 5);
    k.frames();
    expect(mounted(k, ids)).toBe(40);
    expect(k.r.churnStats().releases).toBe(0);
  });

  test('a far artboard on a light canvas leaves no sweep timer running every frame', () => {
    const k = rig();
    const ids = canvas(k, 20, 65, 4);
    expect(mounted(k, ids)).toBe(20);
    k.advance(RELEASE_AFTER_MS * 2);
    for (let i = 0; i < 10; i++) k.advance(20);
    expect(k.timers.length).toBe(0);
  });

  test('before enough artboards are measured the ring decides (the default weight is not an estimate)', () => {
    const k = rig();
    const ids = Array.from({ length: 30 }, (_, i) => `ab${i}`);
    for (const id of ids) {
      k.r.subscribe(id, () => {});
      k.r.setKeep(id, false);
    }
    for (const id of ids.slice(0, LIGHT_MIN_MEASURED - 1)) {
      k.r.setNear(id, true);
      k.r.setVisible(id, true);
    }
    settle(k, ids, 65);
    expect(k.r.isLight()).toBe(false);
    expect(mounted(k, ids)).toBe(LIGHT_MIN_MEASURED - 1);
  });
});

describe('a heavy canvas keeps the ring', () => {
  test('88 artboards × 500 elements (mascot, 44k): far artboards stay placeholders, what leaves is released', () => {
    const k = rig();
    const ids = canvas(k, 88, 500, 6);
    expect(k.r.isLight()).toBe(false);
    expect(mounted(k, ids)).toBe(6);
    for (const id of ids.slice(0, 6)) {
      k.r.setVisible(id, false);
      k.r.setNear(id, false);
      k.r.setKeep(id, false);
    }
    k.advance(RELEASE_AFTER_MS + 20);
    k.frames();
    expect(mounted(k, ids)).toBe(0);
  });
});

describe('a light canvas that grows past the budget falls back to the ring', () => {
  test('the measured weight goes over: far artboards are released after their grace, on screen stays', () => {
    const k = rig();
    const ids = canvas(k, 40, 65, 4);
    expect(mounted(k, ids)).toBe(40);
    // an edit made every artboard heavy (40 × 400 = 16k)
    for (const id of ids) k.r.setWeight(id, 400);
    expect(k.r.isLight()).toBe(false);
    k.advance(RELEASE_AFTER_MS + 20);
    k.frames();
    expect(mounted(k, ids)).toBeLessThan(40);
    for (const id of ids.slice(0, 4)) expect(k.r.get(id).seen).toBe(true);
    expect(k.r.mountedWeight()).toBeLessThanOrEqual(MOUNT_NODE_BUDGET);
  });

  test('mid-gesture the fall-back releases nothing; the settle does', () => {
    const k = rig();
    const ids = canvas(k, 40, 65, 4);
    k.r.setInteracting(true);
    for (const id of ids) k.r.setWeight(id, 400);
    k.advance(RELEASE_AFTER_MS + 20);
    k.frames();
    expect(mounted(k, ids)).toBe(40);
    expect(k.r.churnStats().gestureDowns).toBe(0);
    k.r.setInteracting(false);
    expect(mounted(k, ids)).toBeLessThan(40);
  });
});

describe('the gesture hold on a light canvas', () => {
  test('far artboards wait for the settle to mount; on-screen ones still mount one at a time', () => {
    const k = rig();
    const ids = Array.from({ length: 30 }, (_, i) => `ab${i}`);
    for (const id of ids) {
      k.r.subscribe(id, () => {});
      k.r.setKeep(id, false);
    }
    for (const id of ids.slice(0, 6)) {
      k.r.setNear(id, true);
      k.r.setVisible(id, true);
    }
    k.r.setInteracting(true);
    settle(k, ids, 65);
    // mid-gesture only what is on screen mounts
    expect(mounted(k, ids)).toBe(6);
    k.r.setInteracting(false);
    settle(k, ids, 65);
    expect(mounted(k, ids)).toBe(30);
  });
});

describe("a video artboard's media still follows the ring on a light canvas", () => {
  test('far: mounted, no media; near: media; far for the grace: media released, still mounted', () => {
    const k = rig();
    const ids = canvas(k, 20, 65, 4);
    k.r.setEager('ab10', true);
    k.frames();
    expect(k.r.isLight()).toBe(true);
    expect(k.r.get('ab10')).toEqual({ live: false, seen: true, media: false });
    k.r.setKeep('ab10', true);
    k.r.setNear('ab10', true);
    k.frames();
    expect(k.r.get('ab10').media).toBe(true);
    k.r.setNear('ab10', false);
    k.r.setKeep('ab10', false);
    k.advance(RELEASE_AFTER_MS + 20);
    k.frames();
    expect(k.r.get('ab10')).toEqual({ live: false, seen: true, media: false });
    // and a far non-video artboard of a light canvas has no media either (its children are mounted, asleep)
    expect(k.r.get(ids[15] as string)).toEqual({ live: false, seen: true, media: false });
    // an artboard added far away (an edit) mounts at once and has no media inside its grace either
    k.r.subscribe('late', () => {});
    k.r.setKeep('late', false);
    k.frames(4);
    k.r.setZoom(0.9);
    k.frames(2);
    expect(k.r.get('late')).toEqual({ live: false, seen: true, media: false });
  });
});

// 2.0.7 — the crowded cutoff (LAYER_MAX_VISIBLE, `v2-207-webkit-crowded-no-layers`) protects HEAVY canvases only: on
// a light one every artboard keeps its compositing layer at any count (Safari, math fit cycle), so a fit-all zoom
// moves layers instead of repainting the mounted DOM at each scale step.
describe('a light canvas keeps its per-artboard layers however many are on screen', () => {
  test('light, 30 on screen: not crowded; heavy, 30 on screen: crowded', () => {
    const light = rig();
    canvas(light, 40, 65, 30);
    expect(light.r.isLight()).toBe(true);
    expect(light.r.visibleCount()).toBe(30);
    expect(light.r.crowded()).toBe(false);
    const heavy = rig();
    canvas(heavy, 88, 500, 30);
    expect(heavy.r.isLight()).toBe(false);
    expect(heavy.r.crowded()).toBe(true);
  });
});
