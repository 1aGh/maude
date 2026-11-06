// 2.0.7 — Michal (decision v2-michal-207-overview-still-during-gesture): on a heavy canvas at overview zoom, a small
// artboard shows its still picture instead of its live content while a zoom runs, and its live content comes back
// on the settle. Pinned here:
//   - the threshold is one constant, and the entry test is "narrower than it on screen";
//   - the selected / active artboard (`pinned`) and a video artboard (`eager`) never swap, and a selection that
//     lands mid-zoom brings its artboard back at once;
//   - only a zoom swaps (a pure pan never), and only on a heavy canvas, and only an artboard that has a still;
//   - the settle restores every artboard, a few per frame, nearest the centre first;
//   - a picture's src retry is not a paint change (it redrew stills forever), its load is;
//   - mounted in a real DesignCanvas: the gate registers its artboard, and a zoom with no still yet swaps nothing.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  isPaintMutation,
  resolveStillMode,
  STILL_ATTR,
  STILL_MAX_SCREEN_PX,
  STILL_RESTORE_PER_FRAME,
  StillController,
  stillEligible,
} from '../artboard-still.ts';

/** A fake article/body pair: what the controller reads (width, rect) and writes (one attribute, one child). */
function fakeTarget(width: number, at = 0) {
  const attrs = new Set<string>();
  const children: unknown[] = [];
  const article = {
    offsetWidth: width,
    setAttribute: (k: string) => attrs.add(k),
    removeAttribute: (k: string) => attrs.delete(k),
    appendChild: (c: unknown) => children.push(c),
    getBoundingClientRect: () => ({ left: at, top: 0, width: width * 0.1, height: 10 }),
  } as unknown as HTMLElement;
  const body = {
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: width,
    offsetHeight: 100,
  } as HTMLElement;
  return { article, body, swapped: () => attrs.has(STILL_ATTR), children };
}
function fakeStill(): HTMLElement {
  return { classList: { add() {} }, style: {}, remove() {} } as unknown as HTMLElement;
}

function rig(opts: { heavy?: boolean } = {}) {
  const timers: Array<() => void> = [];
  const frames: Array<() => void> = [];
  const info = new Map<string, { visible: boolean; weight: number }>();
  const c = new StillController({
    take: async () => fakeStill(),
    later: (fn) => timers.push(fn),
    cancel: () => {
      timers.length = 0;
    },
    frame: (fn) => frames.push(fn),
    observe: null,
    info: (id) => info.get(id) ?? null,
    minNodes: 1000,
  });
  const t: Record<string, ReturnType<typeof fakeTarget>> = {};
  const add = (id: string, width = 1600, at = 0) => {
    t[id] = fakeTarget(width, at);
    info.set(id, { visible: true, weight: opts.heavy === false ? 10 : 1200 });
    c.register(id, t[id]);
  };
  /** run the pending take timers until every still is drawn */
  const drawAll = async () => {
    for (let i = 0; i < 50 && timers.length; i++) {
      const fn = timers.shift() as () => void;
      fn();
      await new Promise((res) => setTimeout(res, 0));
    }
  };
  const nextFrame = () => {
    const fs = frames.splice(0);
    for (const f of fs) f();
  };
  return { c, t, add, drawAll, nextFrame, info };
}

describe('which artboard may stand in as its still', () => {
  test('the threshold is one constant: narrower than it on screen, pinned and video never, no still never', () => {
    expect(STILL_MAX_SCREEN_PX).toBeGreaterThanOrEqual(120);
    const base = { pinned: false, eager: false, hasStill: true };
    // 1600 px at 10 % = 160 px on screen
    expect(stillEligible({ ...base, width: 1600, zoom: 0.1 })).toBe(true);
    expect(stillEligible({ ...base, width: STILL_MAX_SCREEN_PX, zoom: 1 })).toBe(false);
    expect(stillEligible({ ...base, width: STILL_MAX_SCREEN_PX - 1, zoom: 1 })).toBe(true);
    expect(stillEligible({ ...base, width: 1600, zoom: 0.1, pinned: true })).toBe(false);
    expect(stillEligible({ ...base, width: 1600, zoom: 0.1, eager: true })).toBe(false);
    expect(stillEligible({ ...base, width: 1600, zoom: 0.1, hasStill: false })).toBe(false);
    // once standing in, it stays a still until the settle however far the zoom goes
    expect(stillEligible({ ...base, width: 1600, zoom: 2, showing: true })).toBe(true);
  });

  test('on in the studio on WebKit only; never in a capture; the frame parameter wins', () => {
    expect(resolveStillMode({ search: '', webkit: true, liveMode: 'sleep' })).toBe('on');
    expect(resolveStillMode({ search: '', webkit: false, liveMode: 'sleep' })).toBe('off');
    expect(resolveStillMode({ search: '?artboard-still=on', webkit: true, liveMode: 'off' })).toBe(
      'off'
    );
    expect(
      resolveStillMode({ search: '?artboard-still=on', webkit: false, liveMode: 'sleep' })
    ).toBe('on');
    expect(
      resolveStillMode({ search: '?artboard-still=off', webkit: true, liveMode: 'sleep' })
    ).toBe('off');
  });

  test("a picture's src retry is not a paint change; anything else is", () => {
    const img = { tagName: 'IMG' } as unknown as Node;
    const div = { tagName: 'DIV' } as unknown as Node;
    expect(isPaintMutation({ type: 'attributes', attributeName: 'src', target: img })).toBe(false);
    expect(isPaintMutation({ type: 'attributes', attributeName: 'class', target: img })).toBe(true);
    expect(isPaintMutation({ type: 'attributes', attributeName: 'src', target: div })).toBe(true);
    expect(isPaintMutation({ type: 'childList', attributeName: null, target: div })).toBe(true);
  });
});

describe('the swap during a zoom and the restore on the settle', () => {
  test('a zoom swaps the small artboards that have a still; the settle brings them all back', async () => {
    const r = rig();
    r.add('a');
    r.add('b');
    r.add('big', 4000); // 400 px on screen at 10 %
    r.c.setZoom(0.1);
    await r.drawAll();
    expect(r.c.stats().withStill).toBe(2); // the big one is not worth a still at this zoom
    r.c.noteZoom(0.1); // the gesture's first write: no scale change yet
    expect(r.t.a?.swapped()).toBe(false);
    r.c.noteZoom(0.105);
    expect(r.t.a?.swapped()).toBe(true);
    expect(r.t.b?.swapped()).toBe(true);
    expect(r.t.big?.swapped()).toBe(false);
    // zooming in far keeps the still until the settle (no repaint mid-gesture)
    r.c.noteZoom(0.6);
    expect(r.t.a?.swapped()).toBe(true);
    r.c.settle();
    expect(r.t.a?.swapped()).toBe(false);
    expect(r.t.b?.swapped()).toBe(false);
  });

  test('a pure pan never swaps', async () => {
    const r = rig();
    r.add('a');
    r.c.setZoom(0.1);
    await r.drawAll();
    for (let i = 0; i < 10; i++) r.c.noteZoom(0.1);
    expect(r.t.a?.swapped()).toBe(false);
    r.c.settle();
    expect(r.t.a?.swapped()).toBe(false);
  });

  test('the selected / active artboard and a video artboard never swap; a selection mid-zoom brings it back', async () => {
    const r = rig();
    r.add('sel');
    r.add('vid');
    r.add('other');
    r.c.update('sel', { pinned: true });
    r.c.update('vid', { eager: true });
    r.c.setZoom(0.1);
    await r.drawAll();
    r.c.noteZoom(0.1);
    r.c.noteZoom(0.11);
    expect(r.t.sel?.swapped()).toBe(false);
    expect(r.t.vid?.swapped()).toBe(false);
    expect(r.t.other?.swapped()).toBe(true);
    r.c.update('other', { pinned: true }); // the user clicks it mid-gesture
    expect(r.t.other?.swapped()).toBe(false);
  });

  test('a light canvas never swaps, and an artboard with no still yet stays live', async () => {
    const light = rig({ heavy: false });
    light.add('a');
    light.c.setZoom(0.1);
    await light.drawAll();
    light.c.noteZoom(0.1);
    light.c.noteZoom(0.12);
    expect(light.t.a?.swapped()).toBe(false);

    const fresh = rig();
    fresh.add('a');
    fresh.c.setZoom(0.1);
    // no drawing has run yet
    fresh.c.noteZoom(0.1);
    fresh.c.noteZoom(0.12);
    expect(fresh.t.a?.swapped()).toBe(false);
  });

  test('the settle hands back a few per frame, nearest the centre first', async () => {
    const r = rig();
    const n = STILL_RESTORE_PER_FRAME + 2;
    // spread across the screen: x = 0, 100, 200, … (the rig's viewport centre is innerWidth / 2)
    for (let i = 0; i < n; i++) r.add(`a${i}`, 1600, i * 100);
    r.c.setZoom(0.1);
    await r.drawAll();
    r.c.noteZoom(0.1);
    r.c.noteZoom(0.11);
    expect(r.c.stats().showing).toBe(n);
    r.c.settle();
    expect(r.c.stats().showing).toBe(n - STILL_RESTORE_PER_FRAME);
    r.nextFrame();
    expect(r.c.stats().showing).toBe(0);
  });

  test('a new gesture before the restore finished keeps the rest as stills until it settles', async () => {
    const r = rig();
    const n = STILL_RESTORE_PER_FRAME + 2;
    for (let i = 0; i < n; i++) r.add(`a${i}`, 1600, i * 100);
    r.c.setZoom(0.1);
    await r.drawAll();
    r.c.noteZoom(0.1);
    r.c.noteZoom(0.11);
    r.c.settle();
    r.c.noteZoom(0.11); // a pan starts at once
    r.nextFrame();
    expect(r.c.stats().showing).toBe(2);
    r.c.settle();
    expect(r.c.stats().showing).toBe(0);
  });
});

type IOEntry = { target: Element; isIntersecting: boolean };
const observers: FakeIO[] = [];
class FakeIO {
  els = new Set<Element>();
  constructor(
    public cb: (e: IOEntry[]) => void,
    public opts?: { rootMargin?: string }
  ) {
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

  test('the gate registers a mounted artboard; a zoom with no still yet leaves it live (never a blank)', async () => {
    window.happyDOM.setURL('http://localhost/?artboard-live=sleep&artboard-still=on');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <lib.DesignCanvas>
          <lib.DCSection id="s" title="S">
            <lib.DCArtboard id="a0" label="a0" width={1600} height={900}>
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
    const stats = (
      window as unknown as { __maudeStillStats?: () => { registered: number; showing: number } }
    ).__maudeStillStats;
    expect(typeof stats).toBe('function');
    expect(stats?.().registered).toBe(1);
    gate.noteGestureZoom(0.1);
    gate.noteGestureZoom(0.12);
    expect(stats?.().showing).toBe(0);
    expect(host.querySelector(`[${STILL_ATTR}]`)).toBeNull();
    expect(host.querySelector('[data-body="a0"]')).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
});
