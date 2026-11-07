// 2.0.7 — the overview level (Michal 2026-11-07, decision v2-michal-207-overview-level, replacing the gesture-only
// stills): under the cut an artboard shows ONLY its still, settled or not; live content appears once it is big
// enough on screen, and the switch is one change per artboard. Pinned here:
//   - the rule: under the cut at a settled zoom it is its still (no hand-back on the settle); at the cut it is live;
//   - the exemptions: the selected / active artboard and a video artboard are never a still; a selection that lands
//     under the cut brings its artboard live;
//   - one visual sequence: cover (nothing better yet) → still → live, never cover after a still, never cover after
//     live, the hand-over paints the body UNDER the still before it fades, a zoom back out cancels it;
//   - the cache: a kept still stands in at once on a remount, an equal content signature is not redrawn, a change
//     is, a byte budget drops the least recently used still that is not standing in;
//   - drawing a hidden body shows it for the walk only;
//   - mounted: the gate hides an artboard under the cut before it paints; the frame takes the artboard's own colour.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as S from '../artboard-still.ts';
import {
  ARTBOARD_STILL_CSS,
  contentSignature,
  inOverviewCut,
  STILL_ATTR,
  STILL_MAX_SCREEN_PX,
  STILL_REVEAL_MS,
  StillCache,
  StillController,
  type StillView,
  targetView,
} from '../artboard-still.ts';
import * as R from '../artboard-still-raster.ts';

/** the walk state's attribute (2.0.7 follow-up) — spelled here so the file loads against a module without it */
const WALK = 'data-dc-still-walk';

/** A fake article/body pair: what the controller reads (width, rect, offsets) and writes (one attribute, children). */
function fakeTarget(width: number, at = 0) {
  const attrs = new Map<string, string>();
  const article = {
    offsetWidth: width,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    appendChild: (c: { parentNode?: unknown }) => {
      c.parentNode = article;
    },
    getBoundingClientRect: () => ({ left: at, top: 0, width: width * 0.1, height: 10 }),
  } as unknown as HTMLElement;
  const props = new Map<string, string>();
  const body = {
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: width,
    offsetHeight: 100,
    innerHTML: '<div>a</div>',
    style: { setProperty: (k: string, v: string) => props.set(k, v) },
  } as unknown as HTMLElement & { innerHTML: string };
  return {
    article,
    body,
    attr: () => attrs.get(STILL_ATTR) ?? null,
    walk: () => attrs.get(WALK) ?? null,
    props,
  };
}
function fakeEl(): HTMLElement {
  const el: Record<string, unknown> = {
    classList: { add() {} },
    style: {},
    setAttribute() {},
    parentNode: null,
    appendChild(c: { parentNode?: unknown }) {
      c.parentNode = el;
    },
    remove() {
      el.parentNode = null;
    },
  };
  return el as unknown as HTMLElement;
}

function rig() {
  const timers: Array<{ fn: () => void; due: number }> = [];
  const frames: Array<() => void> = [];
  const info = new Map<string, { visible: boolean; weight: number }>();
  const attrAtTake: Array<string | null> = [];
  const walkAtTake: Array<string | null> = [];
  let takes = 0;
  let clock = 0;
  const views: Array<[string, StillView]> = [];
  const t: Record<string, ReturnType<typeof fakeTarget>> = {};
  const cache = new StillCache(10_000);
  const c = new StillController({
    now: () => clock,
    take: async (body) => {
      takes += 1;
      const id = Object.keys(t).find((k) => t[k]?.body === body) ?? '';
      attrAtTake.push(t[id]?.attr() ?? null);
      walkAtTake.push(t[id]?.walk() ?? null);
      return fakeEl();
    },
    later: (fn, ms) => timers.push({ fn, due: clock + ms }),
    frame: (fn) => frames.push(fn),
    observe: null,
    info: (id) => info.get(id) ?? null,
    painted: async () => {},
    makeSlot: fakeEl,
    signature: (b) => (b as unknown as { innerHTML: string }).innerHTML,
    sizeOf: () => 1000,
    cache,
    onView: (id, v) => views.push([id, v]),
  });
  const add = (id: string, width = 1600, at = 0, flags = {}) => {
    t[id] = fakeTarget(width, at);
    info.set(id, { visible: true, weight: 500 });
    return c.register(id, t[id], flags);
  };
  /** one frame `ms` after the last: its callbacks, then the timers that are due */
  const tick = async (ms = 16) => {
    clock += ms;
    for (const f of frames.splice(0)) f();
    await new Promise((res) => setTimeout(res, 0));
    for (let k = 0; k < timers.length; ) {
      if ((timers[k]?.due ?? 0) <= clock) timers.splice(k, 1)[0]?.fn();
      else k += 1;
    }
    await new Promise((res) => setTimeout(res, 0));
  };
  /** everything pending: frames and timers over 10 s */
  const drawAll = async () => {
    for (let i = 0; i < 200; i++) await tick(50);
  };
  /** `n` frames */
  const run = async (n = 40) => {
    for (let i = 0; i < n; i++) await tick(16);
  };
  const seq = (id: string) => views.filter(([k]) => k === id).map(([, v]) => v);
  return {
    c,
    t,
    add,
    drawAll,
    run,
    tick,
    seq,
    info,
    cache,
    takes: () => takes,
    attrAtTake,
    walkAtTake,
  };
}

/** settle the canvas at `zoom` (the published zoom + the settle). */
function settleAt(c: StillController, zoom: number) {
  c.noteZoom(zoom);
  c.settle(zoom);
  c.setZoom(zoom);
}

describe('the overview rule', () => {
  test('the cut is one constant: narrower than it on screen is under it', () => {
    expect(STILL_MAX_SCREEN_PX).toBeGreaterThanOrEqual(120);
    expect(inOverviewCut(1600, 0.1)).toBe(true);
    expect(inOverviewCut(STILL_MAX_SCREEN_PX, 1)).toBe(false);
    expect(inOverviewCut(STILL_MAX_SCREEN_PX - 1, 1)).toBe(true);
  });

  test('under the cut a settled artboard stays its still — the settle hands nothing back', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    r.add('a');
    r.add('b', 4000); // 400 px on screen: over the cut
    await r.drawAll();
    expect(r.c.viewOf('a')).toBe('still');
    // a zoom that stays under the cut, and its settle
    r.c.noteZoom(0.11);
    r.c.noteZoom(0.1);
    r.c.settle(0.1);
    await r.run();
    expect(r.c.viewOf('a')).toBe('still');
    expect(r.t.a?.attr()).toBe('still');
    expect(r.c.viewOf('b')).toBe('live');
  });

  test('the selected / active artboard and a video artboard are never a still; a selection under the cut brings it live', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    r.add('p', 1600, 0, { pinned: true });
    r.add('v', 1600, 0, { eager: true });
    r.add('s');
    await r.drawAll();
    expect(r.c.viewOf('p')).toBe('live');
    expect(r.c.viewOf('v')).toBe('live');
    expect(r.c.viewOf('s')).toBe('still');
    r.c.update('s', { pinned: true });
    expect(r.c.viewOf('s')).toBe('paint'); // the body is shown at once, under its still
    await r.run();
    expect(r.c.viewOf('s')).toBe('live');
    expect(r.seq('s')).toEqual(['cover', 'still', 'paint', 'reveal', 'live']);
  });

  test('a pure pan changes nothing', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    r.add('a');
    await r.drawAll();
    const before = r.seq('a').length;
    r.c.noteZoom(0.1);
    r.c.noteZoom(0.1);
    r.c.settle(0.1);
    await r.run();
    expect(r.seq('a').length).toBe(before);
  });
});

describe('one visual sequence per artboard', () => {
  test('a fresh mount under the cut: cover, then its still — never live in between, never cover again', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    r.add('a');
    expect(r.c.viewOf('a')).toBe('cover');
    await r.drawAll();
    expect(r.seq('a')).toEqual(['cover', 'still']);
    // its content changes: the stale still keeps standing in until the new one is drawn (no cover in between)
    r.c.markDirty('a');
    expect(r.c.viewOf('a')).toBe('still');
    await r.drawAll();
    expect(r.seq('a')).toEqual(['cover', 'still']);
  });

  test('zooming in past the cut: the still holds mid-gesture, the settle paints the body under it, then it fades', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    r.add('a');
    await r.drawAll();
    r.c.noteZoom(0.2);
    r.c.noteZoom(0.3); // 480 px on screen
    expect(r.c.viewOf('a')).toBe('still');
    r.c.settle(0.3);
    await r.run(3);
    expect(['still', 'paint']).toContain(r.c.viewOf('a') as string);
    await r.run();
    expect(r.c.viewOf('a')).toBe('live');
    expect(r.seq('a')).toEqual(['cover', 'still', 'paint', 'reveal', 'live']);
  });

  test('a zoom back out during the hand-over cancels it: back to the still, no live, no cover', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    r.add('a');
    await r.drawAll();
    r.c.noteZoom(0.3);
    r.c.settle(0.3);
    await r.run(3); // quiet frames, then paint
    r.c.noteZoom(0.12);
    r.c.noteZoom(0.1);
    r.c.settle(0.1);
    await r.run();
    expect(r.c.viewOf('a')).toBe('still');
    expect(r.seq('a')).not.toContain('live');
    expect(r.seq('a').filter((v) => v === 'cover')).toEqual(['cover']);
  });

  test('a live artboard zoomed out under the cut: its still at once if it has one, else live until it is drawn', async () => {
    const r = rig();
    settleAt(r.c, 0.22);
    r.add('a'); // 352 px: live, and a still is drawn for it (under 2 × the cut)
    r.add('b', 8000); // 1760 px: no still prepared
    await r.drawAll();
    expect(r.c.viewOf('a')).toBe('live');
    expect(r.c.viewOf('b')).toBe('live');
    r.c.noteZoom(0.2);
    r.c.noteZoom(0.1); // a: 160 px; b: 800 px
    expect(r.c.viewOf('a')).toBe('still');
    r.c.noteZoom(0.02); // b: 160 px, no still: stays live mid-gesture
    expect(r.c.viewOf('b')).toBe('live');
    r.c.settle(0.02);
    expect(r.c.viewOf('b')).toBe('live');
    await r.drawAll();
    expect(r.c.viewOf('b')).toBe('still');
    expect(r.seq('b')).toEqual(['still']);
  });

  test('the target of every view: cover only before anything better, the still only under the cut', () => {
    const base = { exempt: false, hasStill: true, gesture: false };
    expect(targetView({ ...base, view: 'live', small: true })).toBe('still');
    expect(targetView({ ...base, view: 'live', small: true, hasStill: false })).toBe('live');
    expect(targetView({ ...base, view: 'still', small: true, hasStill: false })).toBe('cover');
    expect(targetView({ ...base, view: 'still', small: false })).toBe('live');
    expect(targetView({ ...base, view: 'still', small: false, gesture: true })).toBe('still');
    expect(targetView({ ...base, view: 'reveal', small: true, hasStill: false })).toBe('live');
    expect(targetView({ ...base, view: 'still', small: true, exempt: true })).toBe('live');
  });
});

describe('the cache', () => {
  test('a remount under the cut shows its kept still at once (no cover); an equal signature is not redrawn', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    const off = r.add('a');
    await r.drawAll();
    expect(r.takes()).toBe(1);
    off(); // released
    r.add('a');
    expect(r.c.viewOf('a')).toBe('still');
    await r.drawAll();
    expect(r.takes()).toBe(1); // same content: reused
    expect(r.c.stats().takes.reused).toBe(1);
    // the content changed under it: redrawn
    (r.t.a?.body as unknown as { innerHTML: string }).innerHTML = '<div>b</div>';
    r.c.markDirty('a');
    await r.drawAll();
    expect(r.takes()).toBe(2);
  });

  test('a remount over the cut hands over from its kept still (paint under it), never a blank', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    const off = r.add('a');
    await r.drawAll();
    off();
    settleAt(r.c, 0.5);
    r.add('a');
    expect(r.c.viewOf('a')).toBe('paint');
    await r.run();
    expect(r.c.viewOf('a')).toBe('live');
  });

  test('the byte budget drops the least recently used still that is not standing in', () => {
    const cache = new StillCache(2500);
    const els = [fakeEl(), fakeEl(), fakeEl()];
    cache.set('a', els[0] as HTMLElement, 's', 1000, () => false);
    cache.set('b', els[1] as HTMLElement, 's', 1000, () => false);
    cache.get('a'); // a used last
    cache.set('c', els[2] as HTMLElement, 's', 1000, () => false);
    expect(cache.ids().sort()).toEqual(['a', 'c']);
    // in use: kept over the budget
    cache.set('d', fakeEl(), 's', 1000, (k) => k === 'a' || k === 'c');
    expect(cache.ids().sort()).toEqual(['a', 'c', 'd']);
  });

  test('the content signature follows markup and size', () => {
    const b = { innerHTML: '<i></i>', offsetWidth: 10, offsetHeight: 20 };
    const s = contentSignature(b);
    expect(contentSignature({ ...b })).toBe(s);
    expect(contentSignature({ ...b, innerHTML: '<b></b>' })).not.toBe(s);
    expect(contentSignature({ ...b, offsetHeight: 21 })).not.toBe(s);
  });

  test('drawing a body hidden under its stand-in puts it in the render tree for the walk only — the view never changes', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    r.add('a');
    await r.drawAll();
    expect(r.attrAtTake).toEqual(['cover']); // what shows stays the cover while it is walked
    expect(r.walkAtTake).toEqual(['']); // the walk state is on for the walk
    expect(r.t.a?.walk()).toBeNull(); // and off after it
    expect(r.t.a?.attr()).toBe('still');
  });
});

describe('the CSS', () => {
  test('under its still the body keeps its box and its children leave the render tree', () => {
    expect(ARTBOARD_STILL_CSS).toContain(
      "[data-dc-still='still']:not([data-dc-still-walk]) > .dc-artboard-body > *"
    );
    expect(ARTBOARD_STILL_CSS).toContain('display: none !important');
    expect(ARTBOARD_STILL_CSS).toContain('--dc-still-h');
  });
});

// ── 2.0.7 follow-up: drawings during a pan, the settle hold, the frame budget ─────────────────────────────

/** A controllable whole drawing (`take`): each call waits for `finish()`. */
function deferredRig() {
  const timers: Array<{ fn: () => void; due: number }> = [];
  const frames: Array<() => void> = [];
  let clock = 0;
  const pending: Array<() => void> = [];
  let takes = 0;
  const tg = fakeTarget(1600);
  const c = new StillController({
    now: () => clock,
    take: () =>
      new Promise((res) => {
        takes += 1;
        pending.push(() => res(fakeEl()));
      }),
    later: (fn, ms) => timers.push({ fn, due: clock + ms }),
    frame: (fn) => frames.push(fn),
    observe: null,
    info: () => ({ visible: true, weight: 500 }),
    painted: async () => {},
    makeSlot: fakeEl,
    signature: (b) => (b as unknown as { innerHTML: string }).innerHTML,
    sizeOf: () => 1000,
    cache: new StillCache(10_000),
  });
  const tick = async (ms = 16) => {
    clock += ms;
    for (const f of frames.splice(0)) f();
    await new Promise((res) => setTimeout(res, 0));
    for (let k = 0; k < timers.length; ) {
      if ((timers[k]?.due ?? 0) <= clock) timers.splice(k, 1)[0]?.fn();
      else k += 1;
    }
    await new Promise((res) => setTimeout(res, 0));
  };
  const finish = async () => {
    for (const f of pending.splice(0)) f();
    await new Promise((res) => setTimeout(res, 0));
  };
  return { c, tg, tick, finish, takes: () => takes };
}

describe('drawings during a pan (the first-pass blocks)', () => {
  test('an artboard that mounts mid-pan becomes its still during the pan — no settle needed', async () => {
    const r = rig();
    settleAt(r.c, 0.1);
    await r.drawAll();
    r.c.noteZoom(0.1); // a pan starts
    r.add('a');
    expect(r.c.viewOf('a')).toBe('cover');
    for (let i = 0; i < 10; i++) {
      r.c.noteZoom(0.1); // still panning: no settle
      await r.tick(16);
    }
    expect(r.c.engaged()).toBe(true);
    expect(r.c.viewOf('a')).toBe('still');
    expect(r.seq('a')).toEqual(['cover', 'still']); // one change
  });

  test('nothing is drawn while the zoom moves; after it settles, nothing for the hold; a pan in the hold draws at once', async () => {
    expect(S.STILL_SETTLE_HOLD_MS).toBeGreaterThanOrEqual(1000);
    const r = rig();
    settleAt(r.c, 0.1);
    r.add('a');
    r.add('b');
    r.c.noteZoom(0.105); // a zoom before either was drawn
    await r.run(3);
    expect(r.takes()).toBe(0);
    r.c.noteZoom(0.1);
    r.c.settle(0.1);
    await r.run(40); // 640 ms after the settle
    expect(r.takes()).toBe(0);
    expect(r.c.viewOf('a')).toBe('cover');
    await r.tick(S.STILL_SETTLE_HOLD_MS);
    await r.run(5);
    expect(r.takes()).toBe(2);
    // a pan that starts inside the hold draws at once
    const p = rig();
    settleAt(p.c, 0.1);
    p.add('a');
    p.c.noteZoom(0.105);
    p.c.noteZoom(0.1);
    p.c.settle(0.1);
    await p.run(2);
    expect(p.takes()).toBe(0);
    p.c.noteZoom(0.1); // a pan
    await p.run(4);
    expect(p.takes()).toBe(1);
    expect(p.c.viewOf('a')).toBe('still');
  });

  test('a drawing gets the frame budget per slice: the pan budget mid-gesture, the idle budget settled', async () => {
    const frames: Array<() => void> = [];
    let clock = 0;
    const budgets: number[] = [];
    let steps = 0;
    const tg = fakeTarget(1600);
    const c = new StillController({
      now: () => clock,
      job: () =>
        ({
          ready: null,
          result: fakeEl(),
          phase: 'collect',
          abort() {},
          step(deadline: number) {
            budgets.push(deadline - clock);
            clock = deadline; // this slice spent the whole budget
            steps += 1;
            return steps % 3 === 0 ? 'done' : 'more';
          },
        }) as R.StillJob,
      later: () => 0,
      frame: (fn) => frames.push(fn),
      observe: null,
      info: () => ({ visible: true, weight: 1 }),
      painted: async () => {},
      makeSlot: fakeEl,
      signature: () => '',
      sizeOf: () => 1,
    } as S.StillControllerOptions);
    settleAt(c, 0.1);
    clock += S.STILL_SETTLE_HOLD_MS + 1; // past the settle's hold
    c.register('a', tg);
    for (let i = 0; i < 3; i++) for (const f of frames.splice(0)) f();
    expect(budgets).toEqual([
      S.STILL_IDLE_BUDGET_MS,
      S.STILL_IDLE_BUDGET_MS,
      S.STILL_IDLE_BUDGET_MS,
    ]);
    expect(c.viewOf('a')).toBe('still');
    c.markDirty('a');
    clock += S.STILL_TAKE_DELAY_MS + 1;
    c.noteZoom(0.1); // a pan
    for (let i = 0; i < 3; i++) for (const f of frames.splice(0)) f();
    expect(budgets.slice(3)).toEqual([
      S.STILL_PAN_BUDGET_MS,
      S.STILL_PAN_BUDGET_MS,
      S.STILL_PAN_BUDGET_MS,
    ]);
  });

  test('a change while it is drawn: the still is shown and drawn again; a picture that came in meanwhile is not a change', async () => {
    const r = deferredRig();
    settleAt(r.c, 0.1);
    await r.tick(S.STILL_SETTLE_HOLD_MS);
    r.c.register('a', r.tg);
    await r.tick();
    expect(r.takes()).toBe(1);
    r.c.markDirty('a'); // the DOM changed under the drawing
    await r.finish();
    await r.tick();
    expect(r.c.viewOf('a')).toBe('still'); // better than the cover
    for (let i = 0; i < 60; i++) await r.tick(16);
    expect(r.takes()).toBe(2); // and drawn again
    await r.finish();
    const q = deferredRig();
    settleAt(q.c, 0.1);
    await q.tick(S.STILL_SETTLE_HOLD_MS);
    q.c.register('a', q.tg);
    await q.tick();
    q.c.markDirty('a', 'load'); // a picture the drawing waits for
    await q.finish();
    for (let i = 0; i < 60; i++) await q.tick(16);
    expect(q.takes()).toBe(1);
    expect(q.c.viewOf('a')).toBe('still');
  });
});

describe('drawings in a pipeline', () => {
  test('while one drawing waits for its pictures to decode, the next one walks', async () => {
    const r = deferredRig();
    settleAt(r.c, 0.1);
    await r.tick(S.STILL_SETTLE_HOLD_MS);
    r.c.register('a', r.tg);
    r.c.register('b', fakeTarget(1600));
    await r.tick();
    expect(r.takes()).toBe(2); // both walked in one frame; their decodes overlap
    await r.finish();
    await r.tick();
    expect(r.c.viewOf('a')).toBe('still');
    expect(r.c.viewOf('b')).toBe('still');
  });
});

describe('the CSS of the walk', () => {
  test('walked: the children back in the render tree (not display:none), the body transparent', () => {
    expect(ARTBOARD_STILL_CSS).toContain(`:not([${WALK}]) > .dc-artboard-body > *`);
    expect(ARTBOARD_STILL_CSS).toContain(
      `.dc-artboard[${WALK}] > .dc-artboard-body { opacity: 0; }`
    );
  });
});

// ── mounted ───────────────────────────────────────────────────────────────────────────────────────

const observers: FakeIO[] = [];
class FakeIO {
  cb: (e: Array<{ target: Element; isIntersecting: boolean }>) => void;
  els = new Set<Element>();
  constructor(cb: FakeIO['cb']) {
    this.cb = cb;
    observers.push(this);
  }
  observe(el: Element) {
    this.els.add(el);
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
  }
}

describe('mounted in a DesignCanvas', () => {
  let lib: typeof import('../canvas-lib.tsx');
  let gate: typeof import('../artboard-live-gate.tsx');
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
    lib = await import('../canvas-lib.tsx');
    gate = await import('../artboard-live-gate.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    observers.length = 0;
    gate.resetArtboardLive();
  });

  test('the frame takes its own colour; no skeleton bar in the placeholder CSS', async () => {
    expect(gate.ARTBOARD_LIVE_CSS).not.toContain("[data-dc-placeholder='skeleton']");
    const src = await Bun.file(new URL('../canvas-lib.tsx', import.meta.url)).text();
    expect(src).toContain('background: var(--dc-own-bg, var(--bg-0, #ffffff));');
  });

  test('the gate registers a mounted artboard in a layout effect, under the cut as its cover before any paint', async () => {
    window.happyDOM.setURL('http://localhost/?artboard-live=sleep&artboard-still=on');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    gate.noteGestureZoom(0.1);
    await act(async () =>
      root.render(
        <lib.DesignCanvas>
          <lib.DCSection id="s" title="S">
            <lib.DCArtboard id="a0" label="a0" width={1600} height={900} background="#fafafa">
              <div data-body="a0" />
            </lib.DCArtboard>
          </lib.DCSection>
        </lib.DesignCanvas>
      )
    );
    for (const o of observers)
      for (const el of o.els) await act(async () => o.cb([{ target: el, isIntersecting: true }]));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    const stats = (window as unknown as { __maudeStillStats?: () => { registered: number } })
      .__maudeStillStats;
    expect(stats?.().registered).toBe(1);
    // the DOM never left (ids, selection), it is only out of the render tree under the stand-in
    expect(host.querySelector('[data-body="a0"]')).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
  test('a drawing walks in slices, waits for its pictures to decode off the main thread, then paints', async () => {
    const body = document.createElement('div');
    const rect = (x: number, y: number, w: number, h: number) => () =>
      ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y }) as DOMRect;
    Object.defineProperty(body, 'offsetWidth', { value: 1600 });
    body.getBoundingClientRect = rect(100, 50, 160, 90); // 10 % on screen
    for (let i = 0; i < 40; i++) {
      const d = document.createElement('div');
      d.style.backgroundColor = 'rgb(200, 10, 10)';
      d.getBoundingClientRect = rect(100 + i, 50, 10, 10);
      body.append(d);
    }
    const img = document.createElement('img');
    img.getBoundingClientRect = rect(120, 60, 50, 50);
    Object.defineProperty(img, 'complete', { value: false }); // still loading: the drawing waits for it
    let decoded: () => void = () => {};
    img.decode = () => new Promise<void>((res) => (decoded = res));
    body.append(img);
    document.body.append(body); // computed styles need it in the document
    // sliced: the same paint as at once, in body px (10 → 100)
    let clock = 0;
    const col = new R.Collector(
      body,
      () => 1,
      () => (clock += 1)
    );
    let slices = 0;
    while (!col.done && slices < 100) {
      col.run(clock + 1); // a check every 8 nodes: 8 nodes a slice
      slices += 1;
    }
    expect(slices).toBeGreaterThan(3);
    const once = R.collectOps(body);
    expect(col.ops.length).toBe(once.ops.length);
    expect(col.ops.length).toBe(41); // 40 boxes + the picture
    expect((col.ops[1] as { x: number; w: number }).x).toBe(10); // (101 − 100) / 0.1
    expect((col.ops[1] as { x: number; w: number }).w).toBe(100);
    // the job: walk state on for the walk only, then a wait for the decode, then the paint
    const calls: string[] = [];
    const job = R.startStill(body, {
      enter: () => calls.push('enter'),
      leave: () => calls.push('leave'),
    });
    let r = job.step(Number.POSITIVE_INFINITY);
    expect(r).toBe('wait');
    expect(job.phase).toBe('decode');
    expect(calls).toEqual(['enter', 'leave']);
    expect(job.step(Number.POSITIVE_INFINITY)).toBe('wait'); // still decoding
    decoded();
    await job.ready;
    r = job.step(Number.POSITIVE_INFINITY);
    expect(r).toBe('done');
    expect(calls).toEqual(['enter', 'leave']);
    body.remove();
  });
});
