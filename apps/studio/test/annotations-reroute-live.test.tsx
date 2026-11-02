// S4.10 — live re-route while an artboard is dragged (canvas 15 `an-follow`; contract
// client/v2/contracts/S2-S4-artboard-motion-ids.md §1; S4 Q4). The drag-bus frame subscriber
// moves members on screen and re-routes the bound arrows through the budgeted router — grid 40
// while dragging, grid 20 on settle — and shows the refused straight line ("the straight line
// would cross Mobile"). The settled route eases in on --dur-soft; reduced motion jumps. A frame
// never re-renders React (S4 Risk 1): the layer subscribes through a ref.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { createArrowRouter, type RouteJob, type RouteMode } from '../annotations/route.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  createDomRideSink,
  createRideController,
  type DragFrameLike,
  type LiveArrow,
  type RideSink,
  straightCrosses,
} from '../annotations/ui/ride.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

// Mobile sits squarely between Tereza's sticky and where Desktop ends up.
const MOBILE = { id: 'mobile', x: 400, y: 0, w: 390, h: 844 };
const DESKTOP = { id: 'desktop', x: 0, y: 1000, w: 1440, h: 900 };
const LAYOUT = [DESKTOP, MOBILE];
const LABELS: Record<string, string> = { desktop: 'Desktop', mobile: 'Mobile' };

const el = (o: Record<string, unknown>): AnnotationElement =>
  ({ index: 'a0', ...o }) as AnnotationElement;
const BOARD: AnnotationElement[] = [
  el({ id: 'tereza', type: 'sticky', x: 20, y: 320, w: 150, h: 150 }),
  el({ id: 'sun', type: 'sticky', x: 300, y: 1020, w: 92, h: 92, parentArtboard: 'desktop' }),
  el({
    id: 'arw',
    type: 'arrow',
    start: { x: 100, y: 400 },
    end: { x: 600, y: 1720 },
    endHost: {
      ref: 'el:desktop/cta',
      label: 'See the work',
      box: { x: 600, y: 1700, w: 120, h: 40 },
    },
    line: 'elbow',
  }),
];

const frame = (
  phase: DragFrameLike['phase'],
  dx: number,
  dy: number,
  alt = false
): DragFrameLike => ({
  phase,
  moved: [{ id: 'desktop', dx, dy }],
  startRects: { desktop: { x: DESKTOP.x, y: DESKTOP.y, w: DESKTOP.w, h: DESKTOP.h } },
  alt,
});

interface Calls {
  translate: Array<[string, number, number]>;
  hide: Array<[string, boolean]>;
  arrows: Array<{ a: LiveArrow; phase: 'drag' | 'settle' }>;
  clears: number;
}

function setup(board: AnnotationElement[] = BOARD, defaultInk?: () => string) {
  const calls: Calls = { translate: [], hide: [], arrows: [], clears: 0 };
  const sink: RideSink = {
    translate: (id, dx, dy) => void calls.translate.push([id, dx, dy]),
    hide: (id, h) => void calls.hide.push([id, h]),
    arrow: (a, phase) => void calls.arrows.push({ a, phase }),
    clear: () => void calls.clears++,
  };
  const real = createArrowRouter();
  const modes: RouteMode[] = [];
  const router = {
    frame: (jobs: readonly RouteJob[], mode: RouteMode) => {
      modes.push(mode);
      return real.frame(jobs, mode);
    },
    forget: real.forget,
    clear: real.clear,
  };
  const queue: Array<() => void> = [];
  const timers: Array<() => void> = [];
  let elements = board;
  const ctl = createRideController({
    elements: () => elements,
    layoutRects: () => LAYOUT,
    elementRects: () => null,
    labelOf: (id) => LABELS[id] ?? id,
    router,
    sink,
    ...(defaultInk ? { defaultInk } : {}),
    schedule: (fn) => void queue.push(fn),
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => {},
  });
  return {
    ctl,
    calls,
    modes,
    flush: () => {
      for (let i = 0; i < 50 && queue.length; i++) (queue.shift() as () => void)();
    },
    fireTimers: () => {
      for (const t of timers.splice(0)) t();
    },
    setElements: (e: AnnotationElement[]) => {
      elements = e;
    },
  };
}

describe('live re-route while the artboard is dragged', () => {
  test('members translate, loose notes stay, the bound elbow goes around Mobile, never through', () => {
    const h = setup();
    h.ctl.onFrame(frame('start', 0, 0));
    expect(h.calls.hide).toEqual([['arw', true]]);
    h.ctl.onFrame(frame('move', 500, -500));
    h.ctl.onFrame(frame('move', 1000, -1000));
    expect(h.calls.translate.filter(([id]) => id === 'sun').at(-1)).toEqual(['sun', 1000, -1000]);
    expect(h.calls.translate.some(([id]) => id === 'tereza')).toBe(false);
    const last = h.calls.arrows.at(-1) as { a: LiveArrow; phase: string };
    expect(last.phase).toBe('drag');
    expect(last.a.id).toBe('arw');
    // The end follows the button on the moved artboard (box carried by the delta).
    const end = last.a.points.at(-1) as { x: number; y: number };
    expect(end.x).toBeGreaterThanOrEqual(1600 - 0.01);
    expect(end.y).toBeLessThan(1000);
    // Routed (more than a straight segment), and no segment crosses Mobile.
    expect(last.a.points.length).toBeGreaterThan(2);
    for (let i = 1; i < last.a.points.length; i++) {
      const a = last.a.points[i - 1] as { x: number; y: number };
      const b = last.a.points[i] as { x: number; y: number };
      expect(straightCrosses(a, b, [MOBILE])).toBeNull();
    }
    // …and the refused straight line says why.
    expect(last.a.tag?.text).toBe('the straight line would cross Mobile');
    // p8-r11-15 (an-follow): …and, while the artboard is still in hand, the bubble that says what letting go does.
    expect(last.a.route?.text).toBe('Let go — the shortest clean path');
    expect(h.modes.every((m) => m === 'drag')).toBe(true);
  });

  test("p8-r12-15: the live route is drawn in the theme's default ink, never the light-canvas literal (dark: #ededed)", () => {
    const ink = (board: AnnotationElement[], themed: string) => {
      const h = setup(board, () => themed);
      h.ctl.onFrame(frame('start', 0, 0));
      h.ctl.onFrame(frame('move', 1000, -1000));
      return (h.calls.arrows.at(-1) as { a: LiveArrow }).a;
    };
    const arw = BOARD[2] as AnnotationElement;
    // an arrow with no stored colour, and one that stored the palette's black: both follow the theme
    for (const stored of [{}, { color: '#1f1f1f' }]) {
      const a = ink([...BOARD.slice(0, 2), { ...arw, ...stored }], '#ededed');
      expect(a.color).toBe('#ededed');
      // the heads carry the same ink - nothing of the literal survives in the primitives
      expect(JSON.stringify(a.prims)).not.toMatch(/#1f1f1f|#1a1a1a/i);
    }
    // a colour somebody picked is theirs in every theme
    const picked = ink([...BOARD.slice(0, 2), { ...arw, color: '#3b82f6' }], '#ededed');
    expect(picked.color).toBe('#3b82f6');
  });

  test('p8-r11-15: the let-go bubble is a drag-only hint — the settled route has none', () => {
    const h = setup();
    h.ctl.onFrame(frame('start', 0, 0));
    h.ctl.onFrame(frame('move', 1000, -1000));
    h.ctl.onFrame(frame('end', 1000, -1000));
    h.flush();
    const settled = h.calls.arrows.at(-1) as { a: LiveArrow; phase: string };
    expect(settled.phase).toBe('settle');
    expect(settled.a.route).toBeNull();
  });

  test('let go: one settle at grid 20 is scheduled, then the hold lets go when the board lands', () => {
    const h = setup();
    h.ctl.onFrame(frame('start', 0, 0));
    h.ctl.onFrame(frame('move', 1000, -1000));
    h.ctl.onFrame(frame('end', 1000, -1000));
    h.flush();
    expect(h.modes).toContain('settle');
    expect(h.calls.arrows.at(-1)?.phase).toBe('settle');
    expect(h.ctl.active()).toBe(true);
    const clearsBefore = h.calls.clears;
    // The board has not caught up yet: keep the picture.
    h.ctl.boardChanged();
    expect(h.calls.clears).toBe(clearsBefore);
    // The committed move lands: the members are where the rider put them → let go.
    h.setElements(BOARD.map((e) => (e.id === 'sun' ? { ...e, x: 1300, y: 20 } : e)));
    h.ctl.boardChanged();
    expect(h.calls.clears).toBe(clearsBefore + 1);
    expect(h.ctl.active()).toBe(false);
  });

  test('a refused commit never strands the picture: the hold expires', () => {
    const h = setup();
    h.ctl.onFrame(frame('start', 0, 0));
    h.ctl.onFrame(frame('end', 1000, -1000));
    h.fireTimers();
    expect(h.ctl.active()).toBe(false);
  });

  test('esc cancels: everything snaps back; ⌥-drag duplicates move nobody', () => {
    const h = setup();
    h.ctl.onFrame(frame('start', 0, 0));
    h.ctl.onFrame(frame('move', 200, 0));
    const c = h.calls.clears;
    h.ctl.onFrame(frame('cancel', 200, 0));
    expect(h.calls.clears).toBe(c + 1);
    expect(h.ctl.active()).toBe(false);

    const alt = setup();
    alt.ctl.onFrame(frame('start', 0, 0, true));
    alt.ctl.onFrame(frame('move', 200, 0, true));
    expect(alt.calls.translate).toHaveLength(0);
    expect(alt.calls.arrows).toHaveLength(0);
  });
});

describe('the DOM sink', () => {
  const mountWorld = () => {
    const world = document.createElement('div');
    world.className = 'dc-world';
    world.innerHTML =
      '<div class="dc-annot-scene"><div class="dc-annot-el" data-id="sun" style="transform: rotate(2deg)"></div><div class="dc-annot-el" data-id="arw"></div></div>';
    document.body.appendChild(world);
    return world;
  };
  const live = (id: string, tag: LiveArrow['tag'] = null): LiveArrow => ({
    id,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    prims: [{ el: 'path', d: 'M0 0 L10 0 L10 10', dash: false }],
    color: '#1a1a1a',
    width: 2,
    tag,
    route: null,
  });

  test('a translate composes with the rotation; clear restores every node', () => {
    const world = mountWorld();
    const sink = createDomRideSink(
      () => world,
      () => false
    );
    sink.translate('sun', 12, -4);
    sink.hide('arw', true);
    const sun = world.querySelector('[data-id="sun"]') as HTMLElement;
    expect(sun.style.translate).toBe('12px -4px');
    expect(sun.style.transform).toContain('rotate');
    sink.arrow(
      live('arw', { text: 'the straight line would cross Mobile', at: { x: 5, y: 5 } }),
      'drag'
    );
    expect(world.querySelector('[data-testid="annot-cross-tag"]')?.textContent).toBe(
      'the straight line would cross Mobile'
    );
    // p8-r11-15: the let-go bubble rides with the live arrow and goes with the next frame that has none
    sink.arrow(
      { ...live('arw'), route: { text: 'Let go — the shortest clean path', at: { x: 7, y: 3 } } },
      'drag'
    );
    const bubble = world.querySelector('[data-testid="annot-route-tag"]') as HTMLElement;
    expect(bubble.textContent).toBe('Let go — the shortest clean path');
    expect(bubble.style.left).toBe('7px');
    sink.arrow(live('arw'), 'drag');
    expect(world.querySelector('[data-testid="annot-route-tag"]')).toBeNull();
    sink.arrow({ ...live('arw'), route: { text: 'x', at: { x: 0, y: 0 } } }, 'drag');
    sink.clear();
    expect(sun.style.translate).toBe('');
    expect((world.querySelector('[data-id="arw"]') as HTMLElement).style.visibility).toBe('');
    expect(world.querySelector('[data-testid="annot-ride"]')).toBeNull();
  });

  test('p8-r11-15: both chips keep their screen size at any zoom (counter-scaled), the bubble sits above its point', () => {
    const world = mountWorld();
    const sink = createDomRideSink(
      () => world,
      () => false,
      () => 0.25
    );
    sink.arrow(
      {
        ...live('arw', { text: 'the straight line would cross Mobile', at: { x: 5, y: 5 } }),
        route: { text: 'Let go — the shortest clean path', at: { x: 7, y: 3 } },
      },
      'drag'
    );
    const cross = world.querySelector('[data-testid="annot-cross-tag"]') as HTMLElement;
    const bubble = world.querySelector('[data-testid="annot-route-tag"]') as HTMLElement;
    expect(cross.style.transform).toContain('scale(4)');
    expect(bubble.style.transform).toContain('scale(4)');
    // 8 screen px above the point at 25 % = 32 world px
    expect(bubble.style.transform).toContain('calc(-100% - 32px)');
    sink.clear();
  });

  test('p8-r12-15: the chips read the zoom off the world they sit in, so a stale getter cannot leave them at world size', () => {
    const world = mountWorld();
    world.style.setProperty('--dc-zoom', '0.26'); // what canvas-lib writes on every frame
    const sink = createDomRideSink(
      () => world,
      () => false,
      () => 1 // the stale answer (no live-viewport mirror yet on the first drag)
    );
    sink.arrow(
      {
        ...live('arw', { text: 'the straight line would cross Mobile', at: { x: 5, y: 5 } }),
        route: { text: 'Let go — the shortest clean path', at: { x: 7, y: 3 } },
      },
      'drag'
    );
    const scaleOf = (id: string): number => {
      const m = /scale\(([\d.]+)\)/.exec(
        (world.querySelector(`[data-testid="${id}"]`) as HTMLElement).style.transform
      );
      return Number(m?.[1]);
    };
    // 12 px type at 26 % shows as ~3 px; the counter-scale brings it back to ~12 px
    expect(12 * 0.26 * scaleOf('annot-cross-tag')).toBeCloseTo(12, 0);
    expect(12 * 0.26 * scaleOf('annot-route-tag')).toBeCloseTo(12, 0);
    sink.clear();
  });

  test('settle eases in on --dur-soft; reduced motion jumps', () => {
    const world = mountWorld();
    const eased = createDomRideSink(
      () => world,
      () => false
    );
    eased.arrow(live('arw'), 'drag');
    eased.arrow(live('arw'), 'settle');
    const gs = world.querySelectorAll('[data-ride-arrow="arw"]');
    expect(gs).toHaveLength(2); // the dragged route fades out under the settled one
    expect(gs[1]?.getAttribute('class')).toContain('is-settling');
    eased.clear();

    const jump = createDomRideSink(
      () => world,
      () => true
    );
    jump.arrow(live('arw'), 'drag');
    jump.arrow(live('arw'), 'settle');
    const one = world.querySelectorAll('[data-ride-arrow="arw"]');
    expect(one).toHaveLength(1);
    expect(one[0]?.getAttribute('class') ?? '').not.toContain('is-settling');
  });
});

describe('the bus hook never re-renders per frame', () => {
  test('60 frames, one render; the rider answers the commit; unmount unsubscribes', async () => {
    const { createDragBusCore } = await import('../drag-bus.ts');
    const { useDragBusRideOn } = await import('../canvas-lib.tsx');
    const bus = createDragBusCore({ layout: () => LAYOUT, commit: () => {}, warn: () => {} });
    let renders = 0;
    const seen: string[] = [];
    const riders: string[] = [];
    function Layer() {
      renders++;
      useDragBusRideOn(bus, {
        frame: (f) => void seen.push(f.phase),
        rider: (_moved, g) => {
          riders.push(g);
          return null;
        },
      });
      return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Layer />));
    const before = renders;
    await act(async () => {
      bus.emitFrame(frame('start', 0, 0) as never);
      for (let i = 1; i <= 58; i++) bus.emitFrame(frame('move', i * 10, 0) as never);
      bus.emitFrame(frame('end', 580, 0) as never);
    });
    expect(seen).toHaveLength(60);
    expect(renders).toBe(before);
    bus.commitPositions([{ id: 'desktop', x: 580, y: 1000 }], { undoGroup: 'ab-move-hook000001' });
    expect(riders).toEqual(['ab-move-hook000001']);
    await act(async () => root.unmount());
    roots.splice(0);
    bus.emitFrame(frame('move', 1, 0) as never);
    expect(seen).toHaveLength(60);
  });
});
