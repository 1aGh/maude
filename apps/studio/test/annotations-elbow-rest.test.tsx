// S4.11 (the S4.10 follow-up) — an elbow arrow keeps its route around other artboards AT REST.
// While Desktop is dragged the router draws the arrow around Mobile (annotations/ui/ride.ts); once
// the drag is done `ArrowView` used to fall back to its plain single-corner elbow, straight
// through Mobile. The route the drag settled on now lives on `RenderItem.ends.route` and the node
// draws it; the same router, the same grid-20 settle, the same obstacles.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createArrowRouter } from '../annotations/route.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { ElementNode } from '../annotations/ui/element-node.tsx';
import type { RenderItem, ResolvedEnds } from '../annotations/ui/render-model.ts';
import {
  type BoardRect,
  isElbow,
  labelPoint,
  obstaclesFor,
  polylineMid,
  routeElbowsAtRest,
} from '../annotations/ui/rest-route.ts';
import { straightCrosses } from '../annotations/ui/ride.ts';

const MOBILE: BoardRect = { id: 'mobile', x: 400, y: 0, w: 390, h: 844 };
const DESKTOP: BoardRect = { id: 'desktop', x: 0, y: 1000, w: 1440, h: 900 };
const BOARDS = [DESKTOP, MOBILE];

const arrowItem = (
  o: Partial<AnnotationElement> = {},
  ends: Partial<ResolvedEnds> = {}
): RenderItem => ({
  el: {
    id: 'arw',
    type: 'arrow',
    index: 'a0',
    start: { x: 100, y: 400 },
    end: { x: 600, y: 1720 },
    line: 'elbow',
    ...o,
  } as AnnotationElement,
  // Tereza's sticky on the empty canvas left of Mobile → a note right of it, with Mobile
  // squarely in the straight line's way.
  ends: { x1: 190, y1: 420, x2: 1100, y2: 500, ...ends },
});

const html = (it: RenderItem) =>
  renderToStaticMarkup(
    createElement(ElementNode, {
      el: it.el,
      ends: it.ends,
      interactive: false,
      edit: null,
      resolveAsset: (h: string) => h,
    })
  );

describe('the route is held on the item', () => {
  test('the straight line would cross Mobile; the routed elbow does not', () => {
    const it = arrowItem({}, { x1: 190, y1: 420, x2: 1100, y2: 500 });
    const [out] = routeElbowsAtRest([it], BOARDS, createArrowRouter());
    const route = out?.ends?.route;
    expect(route && route.length).toBeGreaterThanOrEqual(2);
    expect(straightCrosses({ x: 190, y: 420 }, { x: 1100, y: 500 }, [MOBILE])).not.toBeNull();
    for (let i = 1; i < (route?.length ?? 0); i++) {
      const a = route?.[i - 1];
      const b = route?.[i];
      if (!a || !b) continue;
      expect(straightCrosses(a, b, [MOBILE])).toBeNull();
      // the waypoints between the snapped ends are axis-aligned, like the drag's settle
      if (i > 1 && i < (route?.length ?? 0) - 1) expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    expect(route?.[0]).toEqual({ x: 190, y: 420 });
    expect(route?.at(-1)).toEqual({ x: 1100, y: 500 });
  });

  test('it is the SAME route the drag settles on (one router, grid 20)', () => {
    const it = arrowItem();
    const mine = routeElbowsAtRest([it], BOARDS, createArrowRouter())[0]?.ends?.route;
    const settle = createArrowRouter().frame(
      [
        {
          id: 'arw',
          start: { x: 190, y: 420 },
          goal: { x: 1100, y: 500 },
          obstacles: obstaclesFor(BOARDS, { x: 190, y: 420 }, { x: 1100, y: 500 }),
        },
      ],
      'settle'
    );
    expect(mine).toEqual(settle.routes.get('arw')?.points);
  });

  test('the artboards an end sits on are not obstacles; only the others are', () => {
    expect(obstaclesFor(BOARDS, { x: 190, y: 420 }, { x: 1100, y: 500 }).map((o) => o.x)).toEqual([
      0, 400,
    ]);
    // an end inside Mobile and one inside Desktop: nothing else to avoid
    expect(obstaclesFor(BOARDS, { x: 500, y: 100 }, { x: 1000, y: 1300 })).toEqual([]);
    expect(obstaclesFor(BOARDS, { x: 500, y: 100 }, { x: 1000, y: 1300 })).toEqual([]);
  });

  test('items that are not elbows, or have nothing in the way, are returned untouched', () => {
    const straight = arrowItem({ line: 'curved' });
    const clear = arrowItem({}, { x1: 10, y1: 1100, x2: 300, y2: 1500 });
    const note: RenderItem = { el: { id: 'n', type: 'sticky', index: 'a1' } as AnnotationElement };
    const out = routeElbowsAtRest([straight, clear, note], BOARDS, createArrowRouter());
    expect(out[0]).toBe(straight);
    expect(out[2]).toBe(note);
    // inside Desktop, no obstacle: the plain elbow is still the drawing
    expect(out[1]?.ends?.route).toBeUndefined();
    expect(isElbow(straight.el)).toBe(false);
  });
});

describe('the node draws the route it was given', () => {
  test('with a route: a path through every waypoint; without: the single-corner elbow', () => {
    const plain = arrowItem();
    const [routed] = routeElbowsAtRest([plain], BOARDS, createArrowRouter());
    if (!routed) throw new Error('no item');
    const withRoute = html(routed);
    const route = routed.ends?.route ?? [];
    expect(route.length).toBeGreaterThan(2);
    expect(withRoute).toContain(`data-route="${route.length}"`);
    for (const p of route)
      expect(withRoute).toContain(`${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`);

    const noRoute = html(plain);
    expect(noRoute).not.toContain('data-route');
    // the legacy corner: one L between the two ends
    expect(noRoute).toContain('M190 420 L1100 420 L1100 500');
  });

  test('the node box covers the whole route, not only the two ends', () => {
    const [routed] = routeElbowsAtRest([arrowItem()], BOARDS, createArrowRouter());
    const out = html(routed as RenderItem);
    const left = Number(/left:(-?[\d.]+)px/.exec(out)?.[1]);
    const xs = (routed?.ends?.route ?? []).map((p) => p.x);
    expect(left).toBeLessThanOrEqual(Math.min(190, 1100, ...xs));
  });
});

describe('the words follow the line (an-arrow-kinds 3)', () => {
  test('a label sits on the middle of the route and moves when the route does', () => {
    const [routed] = routeElbowsAtRest(
      [arrowItem({ label: 'swipe up' })],
      BOARDS,
      createArrowRouter()
    );
    if (!routed?.ends) throw new Error('no item');
    const mid = labelPoint(routed.el, routed.ends);
    expect(mid).toEqual(polylineMid(routed.ends.route ?? []));
    const out = html(routed);
    expect(out).toContain('data-testid="annot-arrow-label"');
    expect(out).toContain('swipe up');
    // a different end → a different place
    const [moved] = routeElbowsAtRest(
      [arrowItem({ label: 'swipe up' }, { x2: 1200, y2: 700 })],
      BOARDS,
      createArrowRouter()
    );
    expect(moved?.ends && labelPoint(moved.el, moved.ends)).not.toEqual(mid);
  });

  test('straight: the chord’s middle; curved: off the chord by 11 %', () => {
    const e = { x1: 0, y1: 0, x2: 200, y2: 0 } as ResolvedEnds;
    expect(
      labelPoint({ id: 'a', type: 'arrow', index: 'a0', line: 'straight' } as AnnotationElement, e)
    ).toEqual({ x: 100, y: 0 });
    const c = labelPoint(
      { id: 'a', type: 'arrow', index: 'a0', line: 'curved' } as AnnotationElement,
      e
    );
    expect(c.x).toBeCloseTo(100, 5);
    expect(Math.abs(c.y)).toBeCloseTo(22, 5);
  });
});

describe('a lost end is dashed with no head (an-dangling)', () => {
  test('the node draws the arrow dashed and drops the head on the dangling end', () => {
    const live = arrowItem({ line: 'straight' });
    const lost = { ...live, ends: { ...(live.ends as ResolvedEnds), dangling: { end: true } } };
    const a = html(live);
    const b = html(lost);
    expect(a).not.toContain('data-dangling');
    expect(b).toContain('data-dangling="1"');
    expect(b).toContain('stroke-dasharray');
    // the live arrow has its filled head (a polyline), the lost end has none
    expect(a).toContain('<polyline');
    expect(b).not.toContain('<polyline');
  });
});
