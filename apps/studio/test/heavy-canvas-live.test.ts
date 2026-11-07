// 2.0.5 — heavy canvases must not crash the tab. The decision logic of artboard-live.ts: which artboards run
// live (near the viewport, not in the overview), how they wake (a few per frame, never mid-gesture), what a
// capture gets (everything), and which WebGL contexts the budget keeps.
import { describe, expect, test } from 'bun:test';
import { LOD_ZOOM } from '../annotations/ui/lod.tsx';
import {
  decideLive,
  inOverview,
  LIVE_MAX_VISIBLE,
  LIVE_MIN_ZOOM,
  LiveRegistry,
  planWebgl,
  resolveLiveMode,
  WAKE_PER_FRAME,
  WEBGL_LIVE_CAP,
} from '../artboard-live.ts';

function manual() {
  const q: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => q.push(fn),
    flush() {
      while (q.length) q.shift()?.();
    },
    step() {
      const fns = q.splice(0);
      for (const fn of fns) fn();
    },
  };
}

describe('mode', () => {
  test('the studio frame sleeps; a top-level page (headless render) runs everything', () => {
    expect(resolveLiveMode({ search: '?canvas=a.tsx', embedded: true })).toBe('sleep');
    expect(resolveLiveMode({ search: '?canvas=a.tsx', embedded: false })).toBe('off');
  });
  test('a capture is always off, even when a mode is asked for', () => {
    expect(resolveLiveMode({ search: '?hide-chrome=1', embedded: true })).toBe('off');
    expect(resolveLiveMode({ search: '?hide-chrome=1&artboard-live=light', embedded: true })).toBe(
      'off'
    );
    expect(resolveLiveMode({ search: '?thumb-only=a1', embedded: true })).toBe('off');
  });
  test('an explicit mode wins otherwise (the crash card opens light)', () => {
    expect(resolveLiveMode({ search: '?artboard-live=light', embedded: true })).toBe('light');
    expect(resolveLiveMode({ search: '?artboard-live=sleep', embedded: false })).toBe('sleep');
    expect(resolveLiveMode({ search: '?artboard-live=off', embedded: true })).toBe('off');
    expect(resolveLiveMode({ search: '?artboard-live=bogus', embedded: true })).toBe('sleep');
  });
});

describe('LOD — the overview', () => {
  test('the zoom cut-over is the annotation mosaic one', () => {
    expect(LIVE_MIN_ZOOM).toBe(LOD_ZOOM);
  });
  test('zoomed out past the cut-over, or too many on screen, nothing runs live', () => {
    expect(inOverview(LIVE_MIN_ZOOM - 0.01, 1)).toBe(true);
    expect(inOverview(LIVE_MIN_ZOOM, 1)).toBe(false);
    expect(inOverview(1, LIVE_MAX_VISIBLE)).toBe(false);
    expect(inOverview(1, LIVE_MAX_VISIBLE + 1)).toBe(true);
    expect(inOverview(0, 1)).toBe(false); // an unmeasured zoom is not an overview
  });
  test('decideLive: near and not in overview; a capture forces live', () => {
    const base = { near: true, zoom: 1, visibleCount: 3, forceAll: false };
    expect(decideLive(base)).toBe(true);
    expect(decideLive({ ...base, near: false })).toBe(false);
    expect(decideLive({ ...base, zoom: 0.1 })).toBe(false);
    expect(decideLive({ ...base, visibleCount: 60 })).toBe(false);
    expect(decideLive({ ...base, near: false, zoom: 0.05, visibleCount: 88, forceAll: true })).toBe(
      true
    );
  });
});

describe('LiveRegistry', () => {
  test('off: every artboard is live and seen without any observer input', () => {
    const r = new LiveRegistry('off', () => {});
    expect(r.get('a')).toEqual({ live: true, seen: true, media: true });
  });

  test('an artboard nobody reported as near sleeps and is not seen', () => {
    const m = manual();
    const r = new LiveRegistry('sleep', m.schedule);
    r.subscribe('a', () => {});
    m.flush();
    expect(r.get('a')).toEqual({ live: false, seen: false, media: false });
  });

  test('near artboards wake a few per frame, and sleep at once when they leave', () => {
    const m = manual();
    const r = new LiveRegistry('sleep', m.schedule);
    const ids = Array.from({ length: 10 }, (_, i) => `a${i}`);
    for (const id of ids) r.subscribe(id, () => {});
    for (const id of ids) {
      r.setNear(id, true);
      r.setVisible(id, true);
    }
    expect(ids.filter((id) => r.isLive(id))).toHaveLength(0);
    m.step();
    expect(ids.filter((id) => r.isLive(id))).toHaveLength(WAKE_PER_FRAME);
    m.flush();
    expect(ids.filter((id) => r.isLive(id))).toHaveLength(10);
    r.setNear('a0', false);
    expect(r.isLive('a0')).toBe(false);
    // sleep mode keeps what was mounted
    expect(r.get('a0').seen).toBe(true);
  });

  test('light mode unmounts what leaves the viewport', () => {
    const m = manual();
    const r = new LiveRegistry('light', m.schedule);
    r.subscribe('a', () => {});
    r.setNear('a', true);
    m.flush();
    expect(r.get('a')).toEqual({ live: true, seen: true, media: true });
    r.setNear('a', false);
    expect(r.get('a')).toEqual({ live: false, seen: false, media: false });
  });

  test('light mode mounts nothing in the overview (zoomed out), however near', () => {
    const m = manual();
    const r = new LiveRegistry('light', m.schedule);
    r.subscribe('a', () => {});
    r.setZoom(0.1);
    r.setNear('a', true);
    r.setVisible('a', true);
    m.flush();
    expect(r.get('a')).toEqual({ live: false, seen: false, media: false });
    r.setZoom(1);
    m.flush();
    expect(r.get('a')).toEqual({ live: true, seen: true, media: true });
  });

  test('no wake while a gesture is in flight; the queue drains when it settles', () => {
    const m = manual();
    const r = new LiveRegistry('sleep', m.schedule);
    r.subscribe('a', () => {});
    r.setInteracting(true);
    r.setNear('a', true);
    m.flush();
    expect(r.isLive('a')).toBe(false);
    r.setInteracting(false);
    m.flush();
    expect(r.isLive('a')).toBe(true);
  });

  test('zooming out past the cut-over puts every live artboard to sleep; zooming back wakes them', () => {
    const m = manual();
    const r = new LiveRegistry('sleep', m.schedule);
    const seen: boolean[] = [];
    r.subscribe('a', (s) => seen.push(s.live));
    r.setNear('a', true);
    r.setVisible('a', true);
    m.flush();
    expect(r.isLive('a')).toBe(true);
    r.setZoom(0.1);
    expect(r.isLive('a')).toBe(false);
    expect(r.get('a').seen).toBe(true); // the DOM stays
    r.setZoom(0.5);
    m.flush();
    expect(r.isLive('a')).toBe(true);
    expect(seen).toEqual([true, false, true]);
  });

  test('more than LIVE_MAX_VISIBLE on screen is an overview, at any zoom', () => {
    const m = manual();
    const r = new LiveRegistry('sleep', m.schedule);
    const ids = Array.from({ length: LIVE_MAX_VISIBLE + 4 }, (_, i) => `a${i}`);
    for (const id of ids) {
      r.subscribe(id, () => {});
      r.setNear(id, true);
    }
    for (const id of ids.slice(0, LIVE_MAX_VISIBLE)) r.setVisible(id, true);
    m.flush();
    expect(ids.filter((id) => r.isLive(id)).length).toBe(ids.length);
    for (const id of ids) r.setVisible(id, true);
    expect(ids.filter((id) => r.isLive(id)).length).toBe(0);
  });

  test('a capture holds everything live at once — no queue — and releases back', () => {
    const m = manual();
    const r = new LiveRegistry('light', m.schedule);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (const id of ids) r.subscribe(id, () => {});
    r.setZoom(0.05);
    const release = r.holdAllLive();
    expect(ids.every((id) => r.get(id).live && r.get(id).seen)).toBe(true);
    release();
    expect(ids.some((id) => r.get(id).live || r.get(id).seen)).toBe(false);
  });
});

describe('planWebgl — the context budget', () => {
  const e = (key: number, over: Partial<Parameters<typeof planWebgl>[0][number]> = {}) => ({
    key,
    live: true,
    distance: key * 10,
    lastLive: 0,
    lost: false,
    ...over,
  });

  test('keeps the cap nearest the viewport centre and loses the rest', () => {
    const all = Array.from({ length: 20 }, (_, i) => e(i));
    const { lose, restore } = planWebgl(all);
    expect(lose).toEqual(Array.from({ length: 20 - WEBGL_LIVE_CAP }, (_, i) => i + WEBGL_LIVE_CAP));
    expect(restore).toEqual([]);
    expect(WEBGL_LIVE_CAP).toBeLessThan(16);
  });

  test('a sleeping artboard holds no context, however near', () => {
    const { lose } = planWebgl([e(0, { live: false, distance: 0 }), e(1)], 4);
    expect(lose).toEqual([0]);
  });

  test('restores a lost one that is back in the budget; ties go to the most recently live', () => {
    const plan = planWebgl(
      [e(0, { distance: 5, lastLive: 1 }), e(1, { distance: 5, lastLive: 9, lost: true })],
      1
    );
    expect(plan).toEqual({ lose: [0], restore: [1] });
  });
});
