// V2-1.2 §7 T5 + T6 — Fit and reveal honour the occluded insets (§5.6), headless.
//
// T5: zero insets are byte-identical to today's fit (property, 5 000 random canvases × 3 hosts);
// with insets the fitted union sits inside the visible rect (plus `pad`), centred on the
// non-binding axis, zoom ≤ 1; a degenerate host drops an axis's insets with no NaN; reveal pans an
// element out from under a panel (today's whole-host reveal leaves it there); the occluded-insets
// message lands in the window-level store parent-gated, validated and seq-ordered (I4), and the
// consumers read it when they compute (an inset change alone never moves the camera, I1).
// T6: insetsFromIslands.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { canvasInsets, canvasModeStore } from '../bridge/canvas-mode-store.ts';
import {
  type Insets,
  insetsFromIslands,
  MIN_VISIBLE_PX,
  visibleRect,
  ZERO_INSETS,
} from '../bridge/occlusion.ts';
import { type ArtboardRect, computeFit } from '../canvas-lib.tsx';
import { revealElementViaCamera } from '../canvas-shell.tsx';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

let seed = 0x5eed;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const host = (w: number, h: number) => ({ clientWidth: w, clientHeight: h }) as HTMLElement;
const randomCanvas = (): ArtboardRect[] =>
  Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, i) => ({
    id: `a${i}`,
    x: Math.round(rnd() * 6000 - 3000),
    y: Math.round(rnd() * 4000 - 2000),
    w: 40 + Math.round(rnd() * 2400),
    h: 40 + Math.round(rnd() * 1800),
    kind: 'digital',
  }));

/** Today's (pre-V2-2.10) computeFit body, verbatim — the reference for I3. */
function computeFitV1(rects: ArtboardRect[], hostEl: HTMLElement, pad = 24) {
  if (rects.length === 0) return { x: 0, y: 0, zoom: 1 };
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    if (r.x < xMin) xMin = r.x;
    if (r.y < yMin) yMin = r.y;
    if (r.x + r.w > xMax) xMax = r.x + r.w;
    if (r.y + r.h > yMax) yMax = r.y + r.h;
  }
  const bw = xMax - xMin;
  const bh = yMax - yMin;
  const vw = hostEl.clientWidth;
  const vh = hostEl.clientHeight;
  if (!vw || !vh || bw <= 0 || bh <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.min((vw - pad * 2) / bw, (vh - pad * 2) / bh, 1.0);
  const x = (vw - bw * zoom) / 2 - xMin * zoom;
  const y = (vh - bh * zoom) / 2 - yMin * zoom;
  return { x, y, zoom };
}

const union = (rects: ArtboardRect[]) => ({
  x0: Math.min(...rects.map((r) => r.x)),
  y0: Math.min(...rects.map((r) => r.y)),
  x1: Math.max(...rects.map((r) => r.x + r.w)),
  y1: Math.max(...rects.map((r) => r.y + r.h)),
});

describe('Fit honours the occluded insets (T5)', () => {
  test('I3 — all-zero insets: byte-identical to today on 5 000 random canvases × 3 hosts', () => {
    const hosts = [host(1440, 900), host(1024, 768), host(390, 844)];
    for (let i = 0; i < 5000; i++) {
      const rects = randomCanvas();
      for (const h of hosts) {
        const want = computeFitV1(rects, h);
        expect(computeFit(rects, h)).toEqual(want);
        expect(computeFit(rects, h, 24, ZERO_INSETS)).toEqual(want);
      }
    }
  });

  test('insets {64, 360, 88, 320} on 1440 × 900: the union fits the visible rect, centred, zoom ≤ 1', () => {
    const ins: Insets = { top: 64, right: 360, bottom: 88, left: 320 };
    const v = visibleRect(1440, 900, ins);
    const pad = 24;
    for (let i = 0; i < 2000; i++) {
      const rects = randomCanvas();
      const { x, y, zoom } = computeFit(rects, host(1440, 900), pad, ins);
      const u = union(rects);
      const sx0 = u.x0 * zoom + x;
      const sx1 = u.x1 * zoom + x;
      const sy0 = u.y0 * zoom + y;
      const sy1 = u.y1 * zoom + y;
      const eps = 1e-6;
      expect(zoom).toBeLessThanOrEqual(1);
      expect(sx0).toBeGreaterThanOrEqual(v.x - eps);
      expect(sx1).toBeLessThanOrEqual(v.x + v.w + eps);
      expect(sy0).toBeGreaterThanOrEqual(v.y - eps);
      expect(sy1).toBeLessThanOrEqual(v.y + v.h + eps);
      // centred on both axes inside the visible rect
      expect(Math.abs((sx0 + sx1) / 2 - (v.x + v.w / 2))).toBeLessThan(1e-6);
      expect(Math.abs((sy0 + sy1) / 2 - (v.y + v.h / 2))).toBeLessThan(1e-6);
    }
  });

  test('a degenerate 600 × 400 host drops the horizontal insets, keeps the vertical, no NaN', () => {
    const ins: Insets = { top: 64, right: 360, bottom: 88, left: 320 };
    const v = visibleRect(600, 400, ins);
    expect(v).toEqual({ x: 0, y: 64, w: 600, h: 248 });
    expect(600 - 360 - 320).toBeLessThan(MIN_VISIBLE_PX);
    const f = computeFit(randomCanvas(), host(600, 400), 24, ins);
    expect([f.x, f.y, f.zoom].every(Number.isFinite)).toBe(true);
  });
});

// ── reveal ───────────────────────────────────────────────────────────────────

const rectEl = (left: number, top: number, w: number, h: number) =>
  ({
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + w,
      bottom: top + h,
      width: w,
      height: h,
    }),
  }) as unknown as HTMLElement;
const recorder = () => {
  const pans: Array<[number, number]> = [];
  return { pans, controller: { panBy: (dx: number, dy: number) => pans.push([dx, dy]) } as never };
};

describe('reveal honours the occluded insets (T5)', () => {
  test('an element at screen x 100–300 under a 320 px left panel pans to x = 360', () => {
    const { pans, controller } = recorder();
    const ins: Insets = { top: 0, right: 0, bottom: 0, left: 320 };
    revealElementViaCamera(rectEl(0, 0, 1440, 900), rectEl(100, 300, 200, 40), controller, ins);
    expect(pans).toEqual([[260, 0]]); // 100 → 360 = visible left (320) + margin (40)
  });

  test('zero insets: the whole host, exactly as before (an on-screen element does not move)', () => {
    const { pans, controller } = recorder();
    revealElementViaCamera(
      rectEl(0, 0, 1440, 900),
      rectEl(100, 300, 200, 40),
      controller,
      ZERO_INSETS
    );
    revealElementViaCamera(rectEl(0, 0, 1440, 900), rectEl(100, 300, 200, 40), controller);
    expect(pans).toEqual([]);
  });

  test('without an explicit argument it reads the store the shell writes', () => {
    const { pans, controller } = recorder();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: {
          dgn: 'occluded-insets',
          seq: 1,
          insets: { top: 0, right: 0, bottom: 0, left: 320 },
        },
      })
    );
    revealElementViaCamera(rectEl(0, 0, 1440, 900), rectEl(100, 300, 200, 40), controller);
    expect(pans).toEqual([[260, 0]]);
  });
});

describe('the occluded-insets lane (§5.6)', () => {
  const post = (source: unknown, data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));

  test('parent-gated, validated, an older seq dropped (I4); the store is window-level', () => {
    const store = canvasModeStore(window);
    expect(canvasModeStore(window)).toBe(store); // idempotent
    const seen: number[] = [];
    const off = store.subscribe((s) => seen.push(s.insetsSeq));
    const base = store.get().insetsSeq;
    post(
      { name: 'sibling' },
      { dgn: 'occluded-insets', seq: base + 10, insets: { top: 9, right: 9, bottom: 9, left: 9 } }
    );
    post(window.parent, {
      dgn: 'occluded-insets',
      seq: base + 11,
      insets: { top: -5, right: 0, bottom: 0, left: 0 },
    });
    expect(store.get().insetsSeq).toBe(base);
    post(window.parent, {
      dgn: 'occluded-insets',
      seq: base + 12,
      insets: { top: 64.2, right: 0, bottom: 88, left: 0 },
    });
    expect(canvasInsets()).toEqual({ top: 64, right: 0, bottom: 88, left: 0 });
    post(window.parent, {
      dgn: 'occluded-insets',
      seq: base + 5,
      insets: { top: 1, right: 1, bottom: 1, left: 1 },
    });
    expect(canvasInsets()).toEqual({ top: 64, right: 0, bottom: 88, left: 0 });
    expect(seen).toEqual([base + 12]);
    off();
    post(window.parent, {
      dgn: 'occluded-insets',
      seq: base + 20,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    expect(canvasInsets()).toEqual(ZERO_INSETS);
  });
});

// ── T6 ───────────────────────────────────────────────────────────────────────

describe('insetsFromIslands (T6)', () => {
  const frame = { left: 0, top: 0, right: 1440, bottom: 900 };
  test('a floating left panel gives its right edge plus the gap, rounded up', () => {
    const r = insetsFromIslands(frame, [
      { rect: { left: 12, top: 60, right: 311.2, bottom: 800 }, edge: 'left' },
    ]);
    expect(r).toEqual({ top: 0, right: 0, bottom: 0, left: 320 });
  });
  test('a pinned panel beside the frame gives 0; hidden / zero-size islands are ignored', () => {
    const pinnedFrame = { left: 320, top: 0, right: 1440, bottom: 900 };
    const r = insetsFromIslands(pinnedFrame, [
      { rect: { left: 0, top: 0, right: 320, bottom: 900 }, edge: 'left' },
      { rect: { left: 500, top: 0, right: 500, bottom: 0 }, edge: 'top' },
    ]);
    expect(r).toEqual(ZERO_INSETS);
  });
  test('per edge the deepest island wins; folded icons count', () => {
    const r = insetsFromIslands(frame, [
      { rect: { left: 1080, top: 60, right: 1428, bottom: 840 }, edge: 'right' },
      { rect: { left: 1392, top: 12, right: 1428, bottom: 48 }, edge: 'right' }, // folded icon
      { rect: { left: 400, top: 8, right: 1000, bottom: 52 }, edge: 'top' },
      { rect: { left: 600, top: 820, right: 840, bottom: 868 }, edge: 'bottom' },
    ]);
    expect(r).toEqual({ top: 60, right: 368, bottom: 88, left: 0 });
  });
});
