// S3.2b (md-present-full · md-keys) — the Pointer (L): a ringed dot in the presenter's presence colour with
// a short trail, published on awareness `pointer` in world coordinates.
//   · L toggles it while presenting (and only then); modifiers and text fields leave L alone
//   · it follows the mouse; peers get the world point at ≤ 30 Hz, and null the moment it turns off
//   · reduced motion drops the trail; the trail never outlives TRAIL_MS
//   · the registry: `tool.pointer` is L in the `present` scope only
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { canvasKeyCtx } from '../actions/ctx.ts';
import { documentIndex } from '../actions/documents.ts';
import { ACTIONS } from '../actions/index.ts';
import { k } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import { modeKeys, pendingSlots } from '../bridge/canvas-modes.ts';
import {
  createPointerDot,
  type PointerDeps,
  PUBLISH_MS,
  sanitizePointer,
  TRAIL_MS,
  trailPoints,
} from '../present/pointer-dot.tsx';

interface Rig {
  eng: ReturnType<typeof createPointerDot>;
  published: Array<{ x: number; y: number } | null>;
  clock: { t: number };
  frames: Array<() => void>;
  reduced: { v: boolean };
  presenting: { v: boolean };
  move(x: number, y: number): void;
  key(key: string, init?: KeyboardEventInit, target?: EventTarget): KeyboardEvent;
  flush(): void;
  dot(): HTMLElement | null;
  trail(): SVGPolylineElement | null;
}

let rigs: Rig[] = [];
function rig(): Rig {
  const published: Rig['published'] = [];
  const clock = { t: 1000 };
  const frames: Array<() => void> = [];
  const reduced = { v: false };
  const presenting = { v: true };
  const deps: PointerDeps = {
    win: window,
    toWorld: (x, y) => ({ x: x * 2, y: y * 2 }), // zoom 0.5
    publish: (p) => published.push(p),
    color: () => 'oklch(0.74 0.16 40)',
    now: () => clock.t,
    raf: (cb) => {
      frames.push(() => cb(clock.t));
      return frames.length;
    },
    caf: () => {},
    reducedMotion: () => reduced.v,
  };
  const eng = createPointerDot(deps);
  eng.setPresenting(true);
  const r: Rig = {
    eng,
    published,
    clock,
    frames,
    reduced,
    presenting,
    move(x, y) {
      window.dispatchEvent(
        new window.MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true })
      );
    },
    key(key, init = {}, target = document.body) {
      const e = new window.KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(e);
      return e;
    },
    flush() {
      const run = frames.splice(0);
      for (const f of run) f();
    },
    dot: () => document.querySelector('[data-testid="present-pointer-dot"]'),
    trail: () => document.querySelector('[data-testid="present-pointer-trail"]'),
  };
  rigs.push(r);
  return r;
}
afterEach(() => {
  for (const r of rigs) r.eng.dispose();
  rigs = [];
  document.body.innerHTML = '';
});

describe('the L key', () => {
  test('L toggles the dot on and off while presenting, and swallows the key', () => {
    const r = rig();
    expect(r.eng.isOn()).toBe(false);
    expect(r.dot()).toBeNull();
    const e = r.key('l');
    expect(e.defaultPrevented).toBe(true);
    expect(r.eng.isOn()).toBe(true);
    expect(r.dot()).not.toBeNull();
    r.key('L'); // caps lock / shift-L: the same key
    expect(r.eng.isOn()).toBe(false);
    expect(r.dot()).toBeNull();
  });

  test('a chord, a text field and a held key leave it alone', () => {
    const r = rig();
    r.key('l', { metaKey: true });
    r.key('l', { ctrlKey: true });
    r.key('l', { altKey: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    r.key('l', {}, input);
    expect(r.eng.isOn()).toBe(false);
    r.key('l', { repeat: true });
    expect(r.eng.isOn()).toBe(false);
  });

  test('outside Present, L is not ours', () => {
    const r = rig();
    r.eng.setPresenting(false);
    const e = r.key('l');
    expect(e.defaultPrevented).toBe(false);
    expect(r.eng.isOn()).toBe(false);
  });

  test('leaving Present turns the dot off and tells peers', () => {
    const r = rig();
    r.key('l');
    r.move(10, 10);
    r.flush();
    r.eng.setPresenting(false);
    expect(r.dot()).toBeNull();
    expect(r.published.at(-1)).toBeNull();
    // and the next Present starts with it off
    r.eng.setPresenting(true);
    expect(r.eng.isOn()).toBe(false);
  });

  test('the shell’s forwarded L (tool.key) toggles it too', () => {
    const r = rig();
    const fakeParent = { postMessage() {} };
    // happy-dom's window.parent is the window itself: a message "from the parent" is one whose source is it
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { dgn: 'run-action', v: 1, id: 'tool.key', params: { key: 'L' } },
        source: window.parent as unknown as MessageEventSource,
      })
    );
    void fakeParent;
    expect(r.eng.isOn()).toBe(true);
  });
});

describe('following the mouse', () => {
  test('the dot sits on the pointer and peers get the world point', () => {
    const r = rig();
    r.key('l');
    r.move(300, 200);
    r.flush();
    expect(r.dot()?.style.transform).toContain('300px');
    expect(r.dot()?.style.transform).toContain('200px');
    expect(r.published.at(-1)).toEqual({ x: 600, y: 400 });
  });

  test('publishing is throttled to ~30 Hz and the last point is not lost', () => {
    const r = rig();
    r.key('l');
    r.move(10, 10);
    r.flush();
    const n = r.published.length;
    r.clock.t += PUBLISH_MS - 5;
    r.move(20, 20);
    r.flush();
    expect(r.published.length).toBe(n); // too soon
    r.clock.t += PUBLISH_MS;
    r.flush();
    expect(r.published.length).toBe(n + 1);
    expect(r.published.at(-1)).toEqual({ x: 40, y: 40 });
  });

  test('turning it off publishes null once', () => {
    const r = rig();
    r.key('l');
    r.move(5, 5);
    r.flush();
    r.key('l');
    expect(r.published.filter((p) => p === null).length).toBe(1);
  });

  test('the mouse leaving the window hides the dot and withdraws the point', () => {
    const r = rig();
    r.key('l');
    r.move(5, 5);
    r.flush();
    document.documentElement.dispatchEvent(new window.MouseEvent('mouseleave'));
    r.flush();
    expect(r.dot()?.getAttribute('data-hidden')).toBe('true');
    expect(r.published.at(-1)).toBeNull();
  });
});

describe('the trail', () => {
  test('points older than TRAIL_MS are dropped', () => {
    const pts = [
      { x: 0, y: 0, t: 0 },
      { x: 5, y: 5, t: 300 },
      { x: 9, y: 9, t: 500 },
    ];
    expect(trailPoints(pts, 400).length).toBe(3);
    expect(trailPoints(pts, TRAIL_MS + 1).map((p) => p.t)).toEqual([300, 500]);
    expect(trailPoints(pts, TRAIL_MS + 301).map((p) => p.t)).toEqual([500]);
    expect(trailPoints(pts, 99999)).toEqual([]);
  });

  test('a moving dot draws a trail; Reduce motion draws none', () => {
    const r = rig();
    r.key('l');
    for (let i = 0; i < 4; i++) {
      r.move(10 + i * 20, 10);
      r.clock.t += 16;
      r.flush();
    }
    expect(r.trail()?.getAttribute('points')?.split(' ').length).toBeGreaterThan(1);
    r.reduced.v = true;
    r.move(200, 200);
    r.clock.t += 16;
    r.flush();
    expect(r.trail()?.getAttribute('points') ?? '').toBe('');
  });
});

describe('sanitizePointer — a peer’s dot is untrusted input', () => {
  test('finite numbers pass; anything else is null', () => {
    expect(sanitizePointer({ x: 1.5, y: -2 })).toEqual({ x: 1.5, y: -2 });
    expect(sanitizePointer({ x: Number.NaN, y: 0 })).toBeNull();
    expect(sanitizePointer({ x: Number.POSITIVE_INFINITY, y: 0 })).toBeNull();
    expect(sanitizePointer({ x: '1', y: 2 })).toBeNull();
    expect(sanitizePointer(null)).toBeNull();
    expect(sanitizePointer([1, 2])).toBeNull();
    expect(sanitizePointer({ x: 1, y: 2, extra: 'x' })).toEqual({ x: 1, y: 2 });
    expect(sanitizePointer({ x: 1e12, y: 0 })).toBeNull(); // far outside any canvas
  });
});

describe('the registry: L belongs to the present scope', () => {
  const ctxIn = (mode: 'edit' | 'preview' | 'viewing' | 'present') =>
    canvasKeyCtx({ typing: false, readOnly: false, mode });
  const CANVAS = documentIndex(
    ACTIONS,
    'canvas',
    (id) => id.startsWith('tool.') && id !== 'tool.hand-hold'
  );

  test('Present answers L and only L; the slot is no longer pending', () => {
    expect(modeKeys('present')).toEqual(['L']);
    expect(pendingSlots().some((p) => p.slot.tool === 'pointer')).toBe(false);
  });

  test('tool.pointer resolves on L in Present and nowhere else', () => {
    expect(resolveChord(CANVAS, k('L'), ctxIn('present'))?.action.id).toBe('tool.pointer');
    for (const m of ['edit', 'preview', 'viewing'] as const)
      expect(resolveChord(CANVAS, k('L'), ctxIn(m))).toBeNull();
  });
});
