// S3.2a (md-present-lift) — Present · Artboards inside the canvas: the lift, the stage mask, the step
// keys, and leaving exactly as it was.
//   · Present from "Post 1:1" lifts that artboard to the stage over --dur-route (280 ms; 1 ms reduced)
//     while the others sink to dark (the mask)
//   · click · → · space = next, ← · ⇧space = previous, in canvas order, skipping meta.present.skip
//   · the shell's present-step {to} is honoured; every move echoes present-position
//   · esc asks the shell to step back; leaving puts the camera back BYTE-EQUAL and the selection too
// The engine runs on a manual clock; the last describe mounts `usePresentStage` for real, LAST: the mode
// store turns governed for good on its first set-mode.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  // `document`, not `window`: a `window` stub another file left must not skip the DOM.
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import type { ArtboardRect } from '../canvas-lib.tsx';
import {
  type Camera,
  createPresentStage,
  LIFT_MS,
  liveRects,
  PRESENT_ATTR,
  PRESENT_HIDES,
  type PresentStage,
  presentHidesCss,
  type StageDeps,
  usePresentSelection,
  usePresentStage,
} from '../present/present-stage.tsx';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

const STAGE_W = 1600;
const STAGE_H = 900;
// Post 1:1, a 9:16 story and a web page, in canvas order (a row of two, then one below).
const BOARDS: ArtboardRect[] = [
  { id: 'post-1x1', x: 0, y: 0, w: 1080, h: 1080, kind: 'digital' },
  { id: 'story', x: 1300, y: 0, w: 1080, h: 1920, kind: 'video' },
  { id: 'home', x: 0, y: 2300, w: 1440, h: 2000, kind: 'web' },
];
const CAM: Camera = { x: 1.2345678901234567e-20, y: -0.1 + 0.2, zoom: 0.30000000000000004 };

const posts: Array<Record<string, unknown>> = [];
const fakeParent = { postMessage: (m: Record<string, unknown>) => posts.push(m) };
let realParent: PropertyDescriptor | undefined;
function asIframe() {
  realParent = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
}
function restoreParent() {
  if (typeof window === 'undefined') return; // the DOM is already unregistered
  if (realParent) Object.defineProperty(window, 'parent', realParent);
  else Reflect.deleteProperty(window, 'parent');
}
const positions = () => posts.filter((p) => p.dgn === 'present-position');
const backs = () => posts.filter((p) => p.dgn === 'mode-request' && p.mode === 'back');

interface Rig {
  host: HTMLElement;
  world: HTMLElement;
  stage: PresentStage;
  cam: Camera;
  sets: Camera[];
  meta: { order?: unknown; skip?: unknown } | undefined;
  rects: ArtboardRect[];
  reduced: boolean;
  selection: { selected: unknown[]; cleared: number; replaced: unknown[][] };
  advance(ms: number): void;
  mask(): HTMLElement | null;
  press(key: string, init?: KeyboardEventInit, target?: EventTarget): KeyboardEvent;
  click(target?: Element, init?: MouseEventInit): MouseEvent;
}

function rig(): Rig {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: STAGE_W });
  Object.defineProperty(host, 'clientHeight', { value: STAGE_H });
  const world = document.createElement('div');
  host.appendChild(world);
  for (const b of BOARDS) {
    const a = document.createElement('article');
    a.setAttribute('data-dc-screen', b.id);
    world.appendChild(a);
  }
  document.body.appendChild(host);
  let clock = 0;
  let nextId = 1;
  const frames = new Map<number, (t: number) => void>();
  const r = {
    host,
    world,
    cam: { ...CAM },
    sets: [] as Camera[],
    meta: undefined as Rig['meta'],
    rects: BOARDS.map((b) => ({ ...b })),
    reduced: false,
    selection: {
      selected: [{ selector: '#a' }, { selector: '#b', artboardId: 'post-1x1' }] as unknown[],
      cleared: 0,
      replaced: [] as unknown[][],
    },
  } as Rig;
  const sel = {
    get selected() {
      return r.selection.selected;
    },
    replace(s: unknown) {
      r.selection.replaced.push(s as unknown[]);
      r.selection.selected = s as unknown[];
    },
    clear() {
      r.selection.cleared += 1;
      r.selection.selected = [];
    },
  };
  const deps: StageDeps = {
    win: window,
    getHost: () => host,
    getWorld: () => world,
    getArtboards: () => r.rects,
    getCamera: () => ({ ...r.cam }),
    setCamera: (c) => {
      r.cam = { ...c };
      r.sets.push({ ...c });
    },
    getSelection: () => sel as never,
    readMeta: () => r.meta,
    raf: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    caf: (id) => {
      frames.delete(id);
    },
    now: () => clock,
    reducedMotion: () => r.reduced,
    liftMs: () => LIFT_MS,
  };
  r.stage = createPresentStage(deps);
  r.advance = (ms) => {
    clock += ms;
    const due = [...frames.entries()];
    frames.clear();
    for (const [, cb] of due) cb(clock);
  };
  r.mask = () => host.querySelector('[data-maude-present-stage]');
  r.press = (key, init = {}, target: EventTarget = host) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };
  r.click = (target = host, init = {}) => {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    target.dispatchEvent(e);
    return e;
  };
  return r;
}

let rg: Rig | null = null;
beforeEach(() => {
  posts.length = 0;
});
afterEach(() => {
  rg?.stage.dispose();
  rg?.host.remove();
  rg = null;
});
beforeAll(asIframe);
afterAll(restoreParent);

// ── the lift ─────────────────────────────────────────────────────────────────────────────────────

describe('Present from "Post 1:1": the lift', () => {
  test('the camera glides to the fit over 280 ms and the others sink behind the dark mask', () => {
    rg = rig();
    rg.stage.start('post-1x1');
    // 1080 square in 1600x900: fits the height, centred (pillars)
    const s = 900 / 1080;
    const want = { x: (1600 - 1080 * s) / 2, y: 0, zoom: s };
    // frame 0: nothing has moved yet (the lift starts from where the camera was)
    expect(rg.cam).toEqual(CAM);
    rg.advance(140);
    expect(rg.cam).not.toEqual(CAM);
    expect(rg.cam).not.toEqual(want);
    rg.advance(140);
    expect(rg.cam.x).toBeCloseTo(want.x, 6);
    expect(rg.cam.y).toBeCloseTo(want.y, 6);
    expect(rg.cam.zoom).toBeCloseTo(want.zoom, 9);
    const m = rg.mask();
    expect(m).not.toBeNull();
    expect(m?.parentElement).toBe(rg.world); // it rides the camera: world coordinates
    expect(m?.style.left).toBe('0px');
    expect(m?.style.width).toBe('1080px');
    expect(m?.style.height).toBe('1080px');
    expect(m?.style.opacity).toBe('1');
    expect(m?.style.transition).toBe('opacity 280ms ease-out');
    expect(m?.style.boxShadow).toContain('var(--bg-0');
    expect(m?.style.pointerEvents).toBe('none');
  });

  test('under reduced motion the lift is a cut (1 ms)', () => {
    rg = rig();
    rg.reduced = true;
    rg.stage.start('post-1x1');
    const s = 900 / 1080;
    expect(rg.cam.zoom).toBeCloseTo(s, 9);
    expect(rg.mask()?.style.transition).toBe('opacity 1ms ease-out');
  });

  test('it starts from the artboard Present was asked for, and announces where it is', () => {
    rg = rig();
    rg.stage.start('story');
    expect(rg.stage.state()).toMatchObject({
      active: true,
      index: 1,
      total: 3,
      artboardId: 'story',
    });
    expect(positions()).toEqual([
      { dgn: 'present-position', index: 1, total: 3, artboardId: 'story' },
    ]);
  });

  test("'start' (or nothing) starts at the first artboard", () => {
    rg = rig();
    rg.stage.start('start');
    expect(rg.stage.state().artboardId).toBe('post-1x1');
  });

  test('the selection is cleared for the audience', () => {
    rg = rig();
    rg.stage.start('post-1x1');
    expect(rg.selection.cleared).toBe(1);
    expect(rg.selection.selected).toEqual([]);
  });

  test('a print artboard shows its trim: the mask window is inset by the bleed', () => {
    rg = rig();
    rg.rects = [{ id: 'flyer', x: 100, y: 200, w: 800, h: 1100, kind: 'print' }];
    const a = rg.world.querySelector('[data-dc-screen]');
    a?.setAttribute('data-dc-screen', 'flyer');
    a?.setAttribute('data-dc-print', JSON.stringify({ paper: 'a4', bleedMm: 3 }));
    rg.stage.start('flyer');
    const m = rg.mask();
    // 3 mm at 96 dpi = 11 px: the mask opens on the trim only
    expect(m?.style.left).toBe('111px');
    expect(m?.style.top).toBe('211px');
    expect(m?.style.width).toBe('778px');
    expect(m?.style.height).toBe('1078px');
  });
});

// ── stepping ─────────────────────────────────────────────────────────────────────────────────────

describe('stepping', () => {
  const at = () => rg?.stage.state().artboardId;

  test('→ and space walk canvas order, ← and ⇧space walk back; the ends hold', () => {
    rg = rig();
    rg.stage.start('start');
    rg.advance(300);
    const e = rg.press('ArrowRight');
    expect(e.defaultPrevented).toBe(true);
    expect(at()).toBe('story');
    rg.press(' ', { code: 'Space' });
    expect(at()).toBe('home');
    rg.press('ArrowRight'); // the last one: nowhere to go
    expect(at()).toBe('home');
    rg.press('ArrowLeft');
    expect(at()).toBe('story');
    rg.press(' ', { code: 'Space', shiftKey: true });
    expect(at()).toBe('post-1x1');
    rg.press('ArrowLeft');
    expect(at()).toBe('post-1x1');
    expect(positions().map((p) => p.index)).toEqual([0, 1, 2, 1, 0]);
  });

  test('a step is a cut: the camera is on the next artboard at once', () => {
    rg = rig();
    rg.stage.start('start');
    rg.advance(300);
    rg.press('ArrowRight');
    // 1080x1920 in 1600x900 -> height bound
    expect(rg.cam.zoom).toBeCloseTo(900 / 1920, 9);
    expect(rg.mask()?.style.left).toBe('1300px');
    expect(rg.mask()?.style.height).toBe('1920px');
  });

  test('click is next; the mouse never reaches the canvas router', () => {
    rg = rig();
    let leaked = 0;
    for (const t of ['pointerdown', 'mousedown', 'dblclick', 'wheel']) {
      rg.host.addEventListener(t, () => {
        leaked += 1;
      });
    }
    rg.stage.start('start');
    rg.advance(300);
    const child = rg.world.querySelector('article') as Element;
    for (const t of ['pointerdown', 'mousedown', 'dblclick']) {
      child.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
    }
    child.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 }));
    expect(leaked).toBe(0);
    const c = rg.click(child);
    expect(c.defaultPrevented).toBe(true);
    expect(at()).toBe('story');
    // a right click or a modified click is not "next"
    rg.click(child, { button: 2 });
    rg.click(child, { metaKey: true });
    expect(at()).toBe('story');
  });

  test('skipped artboards are not visited and not counted', () => {
    rg = rig();
    rg.meta = { skip: ['story'] };
    rg.stage.start('start');
    expect(rg.stage.state().total).toBe(2);
    rg.press('ArrowRight');
    expect(at()).toBe('home');
    expect(positions().at(-1)).toEqual({
      dgn: 'present-position',
      index: 1,
      total: 2,
      artboardId: 'home',
    });
  });

  test('an explicit meta order is the order', () => {
    rg = rig();
    rg.meta = { order: ['home', 'post-1x1', 'gone'] };
    rg.stage.start('start');
    expect(at()).toBe('home');
    rg.press('ArrowRight');
    expect(at()).toBe('post-1x1');
    rg.press('ArrowRight');
    expect(at()).toBe('story'); // not named: follows in canvas order
  });

  test("the shell's present-step: a number jumps (clamped), next / prev move", () => {
    rg = rig();
    rg.stage.start('start');
    rg.stage.step(2);
    expect(at()).toBe('home');
    rg.stage.step(99);
    expect(at()).toBe('home');
    rg.stage.step('prev');
    expect(at()).toBe('story');
    rg.stage.step(0);
    expect(at()).toBe('post-1x1');
    rg.stage.step(Number.NaN);
    expect(at()).toBe('post-1x1');
  });

  test('typing in a field, and shell chords, do not step', () => {
    rg = rig();
    rg.stage.start('start');
    const input = document.createElement('input');
    rg.world.appendChild(input);
    rg.press('ArrowRight', {}, input);
    rg.press(' ', { code: 'Space' }, input);
    rg.press('ArrowRight', { metaKey: true });
    rg.press('ArrowRight', { altKey: true });
    expect(at()).toBe('post-1x1');
    // a zoom chord is eaten so the stage's camera cannot drift
    expect(rg.press('=', { metaKey: true }).defaultPrevented).toBe(true);
  });

  test('a key held down steps once', () => {
    rg = rig();
    rg.stage.start('start');
    rg.press('ArrowRight');
    rg.press('ArrowRight', { repeat: true });
    expect(at()).toBe('story');
  });

  test('keys do nothing before Present and after it', () => {
    rg = rig();
    rg.press('ArrowRight');
    expect(rg.stage.state().active).toBe(false);
    rg.stage.start('start');
    rg.stage.stop();
    rg.advance(300);
    const e = rg.press('ArrowRight');
    expect(e.defaultPrevented).toBe(false);
  });
});

// ── esc ──────────────────────────────────────────────────────────────────────────────────────────

describe('esc', () => {
  test('esc asks the shell to step back — it does not leave by itself', async () => {
    rg = rig();
    rg.stage.start('start');
    const e = rg.press('Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(backs()).toEqual([{ dgn: 'mode-request', mode: 'back', cause: 'esc' }]);
    expect(rg.stage.state().active).toBe(true);
  });

  test('every artboard skipped: nothing to show, no mask, no position — and esc still gets you out', async () => {
    await Bun.sleep(260); // the document asks for "back" once per 250 ms
    rg = rig();
    rg.meta = { skip: ['post-1x1', 'story', 'home'] };
    rg.stage.start('start');
    expect(rg.mask()).toBeNull();
    expect(positions()).toEqual([]);
    rg.press('Escape');
    expect(backs()).toHaveLength(1);
  });
});

// ── leaving ──────────────────────────────────────────────────────────────────────────────────────

describe('leaving: the camera and the selection come back exactly', () => {
  test('after esc settles, the camera is byte-equal to the one Present found', () => {
    rg = rig();
    rg.stage.start('story');
    rg.advance(300);
    rg.press('ArrowRight');
    rg.advance(16);
    const before = rg.selection.selected;
    expect(before).toEqual([]);
    rg.stage.stop();
    // settling: the dark fades out while the camera glides back
    expect(rg.mask()?.style.opacity).toBe('0');
    rg.advance(140);
    expect(rg.cam).not.toEqual(CAM);
    expect(rg.mask()).not.toBeNull();
    rg.advance(140);
    // Object.is on every field: an interpolation that "ends" within an ulp is not good enough
    expect(Object.is(rg.cam.x, CAM.x)).toBe(true);
    expect(Object.is(rg.cam.y, CAM.y)).toBe(true);
    expect(Object.is(rg.cam.zoom, CAM.zoom)).toBe(true);
    expect(rg.mask()).toBeNull();
    expect(rg.stage.state().active).toBe(false);
  });

  test('the selection Present cleared is put back as it was', () => {
    rg = rig();
    const original = rg.selection.selected;
    rg.stage.start('start');
    rg.stage.stop();
    expect(rg.selection.replaced).toHaveLength(1);
    expect(rg.selection.replaced[0]).toEqual(original);
    expect(rg.selection.selected).toEqual(original);
  });

  test('no selection: nothing is cleared and nothing is restored', () => {
    rg = rig();
    rg.selection.selected = [];
    rg.stage.start('start');
    rg.stage.stop();
    expect(rg.selection.cleared).toBe(0);
    expect(rg.selection.replaced).toHaveLength(0);
  });

  test('under reduced motion the way back is a cut', () => {
    rg = rig();
    rg.reduced = true;
    rg.stage.start('start');
    rg.stage.stop();
    expect(rg.cam).toEqual(CAM);
    expect(rg.mask()).toBeNull();
  });

  test('leaving while the lift is still gliding does not strand the camera', () => {
    rg = rig();
    rg.stage.start('start');
    rg.advance(100);
    rg.stage.stop();
    rg.advance(300);
    rg.advance(300);
    expect(
      Object.is(rg.cam.x, CAM.x) && Object.is(rg.cam.y, CAM.y) && Object.is(rg.cam.zoom, CAM.zoom)
    ).toBe(true);
    expect(rg.mask()).toBeNull();
  });

  test('dispose (unmount) lands everything at once', () => {
    rg = rig();
    rg.stage.start('story');
    rg.advance(100);
    rg.stage.dispose();
    expect(rg.cam).toEqual(CAM);
    expect(rg.mask()).toBeNull();
    expect(rg.selection.replaced).toHaveLength(1);
  });

  test('Present again while the last exit is settling starts from the original camera', () => {
    rg = rig();
    rg.stage.start('start');
    rg.advance(300);
    rg.stage.stop();
    rg.advance(100);
    rg.stage.start('start'); // mid-exit
    rg.stage.stop();
    rg.advance(300);
    rg.advance(300);
    expect(Object.is(rg.cam.x, CAM.x) && Object.is(rg.cam.zoom, CAM.zoom)).toBe(true);
  });

  test('the listeners are gone: no key or click steps, no event is swallowed', () => {
    rg = rig();
    rg.stage.start('start');
    rg.stage.stop();
    rg.advance(300);
    const e = rg.click();
    expect(e.defaultPrevented).toBe(false);
  });
});

// ── keeping up with the canvas ───────────────────────────────────────────────────────────────────

describe('the canvas changes under a running stage', () => {
  test('a moved artboard is followed; a deleted one leaves the stage on the same place in the run', () => {
    rg = rig();
    rg.stage.start('story');
    rg.advance(300);
    rg.rects = rg.rects.map((r) => (r.id === 'story' ? { ...r, x: 5000 } : r));
    rg.stage.refresh();
    expect(rg.mask()?.style.left).toBe('5000px');
    rg.rects = rg.rects.filter((r) => r.id !== 'story');
    rg.stage.refresh();
    expect(rg.stage.state()).toMatchObject({ index: 1, total: 2, artboardId: 'home' });
  });
});

// ── the React mount — LAST: the store turns governed for good ────────────────────────────────────

describe('usePresentStage', () => {
  let root: Root | null = null;
  let host: HTMLElement;
  const camera = { current: { ...CAM } };
  const viewportSets: Camera[] = [];

  function Probe({ rects }: { rects: ArtboardRect[] }) {
    const hostRef = { current: host };
    const worldRef = { current: host.firstElementChild as HTMLElement };
    usePresentStage({
      hostRef,
      worldRef,
      artboards: rects,
      controller: {
        viewport: camera.current,
        setViewport: (v) => {
          camera.current = { ...v };
          viewportSets.push({ ...v });
        },
      },
      selection: null,
    });
    return null;
  }

  const setMode = (mode: string, present: unknown = null) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: fakeParent as unknown as Window,
          data: {
            dgn: 'set-mode',
            v: 2,
            seq: canvasModeStore(window).get().modeSeq + 1,
            mode,
            present,
            caps: { edit: true, annotate: true, comment: true },
          },
        })
      );
    });

  beforeAll(() => {
    host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: STAGE_W });
    Object.defineProperty(host, 'clientHeight', { value: STAGE_H });
    host.appendChild(document.createElement('div'));
    document.body.appendChild(host);
    // reduced motion: the lift and the way back are cuts, so no timer is needed
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true });
  });
  afterAll(() => {
    act(() => root?.unmount());
    host.remove();
  });

  test('the shell says present/artboards: lift; the shell says edit: camera back byte-equal', () => {
    root = createRoot(document.createElement('div'));
    act(() => root?.render(createElement(Probe, { rects: BOARDS })));
    expect(host.querySelector('[data-maude-present-stage]')).toBeNull(); // inert until the shell says
    setMode('edit');
    expect(host.querySelector('[data-maude-present-stage]')).toBeNull();

    setMode('present', { kind: 'artboards', from: 'story' });
    expect(host.querySelector('[data-maude-present-stage]')).not.toBeNull();
    expect(camera.current.zoom).toBeCloseTo(900 / 1920, 9);
    expect(positions().at(-1)).toEqual({
      dgn: 'present-position',
      index: 1,
      total: 3,
      artboardId: 'story',
    });

    // the shell's own step
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: fakeParent as unknown as Window,
          data: { dgn: 'present-step', to: 'next' },
        })
      );
    });
    expect(positions().at(-1)).toMatchObject({ index: 2, artboardId: 'home' });

    setMode('edit');
    expect(host.querySelector('[data-maude-present-stage]')).toBeNull();
    expect(Object.is(camera.current.x, CAM.x)).toBe(true);
    expect(Object.is(camera.current.y, CAM.y)).toBe(true);
    expect(Object.is(camera.current.zoom, CAM.zoom)).toBe(true);
  });

  test('Present · Canvas is not the stage: nothing is lifted', () => {
    setMode('present', { kind: 'canvas' });
    expect(host.querySelector('[data-maude-present-stage]')).toBeNull();
    setMode('edit');
  });

  // ── S3.14 (G2): Present draws the work only ─────────────────────────────────────────────────────────

  test('G2: the document root carries the presenting attribute for Present · Artboards AND Present · Canvas', () => {
    const rootEl = document.documentElement;
    setMode('edit');
    expect(rootEl.hasAttribute(PRESENT_ATTR)).toBe(false);
    setMode('present', { kind: 'artboards', from: 'story' });
    expect(rootEl.hasAttribute(PRESENT_ATTR)).toBe(true);
    setMode('edit');
    expect(rootEl.hasAttribute(PRESENT_ATTR)).toBe(false);
    setMode('present', { kind: 'canvas' });
    expect(rootEl.hasAttribute(PRESENT_ATTR)).toBe(true);
    setMode('preview');
    expect(rootEl.hasAttribute(PRESENT_ATTR)).toBe(false);
  });

  test('G2: the chrome list hides the label bar, the breakpoint chip and the selection frame, only while presenting', () => {
    const css = presentHidesCss();
    for (const sel of PRESENT_HIDES) expect(css).toContain(`html[${PRESENT_ATTR}] ${sel}`);
    for (const must of ['.dc-artboard-label', '.dc-artboard-guides', '.ed-ab-frame', '.dc-cv-halo'])
      expect(PRESENT_HIDES.some((h) => h.includes(must))).toBe(true);
    expect(css).toMatch(/display:\s*none\s*!important/);
    expect(css).toMatch(/\.dc-artboard \{ box-shadow: none !important/); // the active-artboard accent ring
    // and the engine stylesheet carries it (canvas-lib's ENGINE_CSS interpolates the same function)
    const lib = readFileSync(join(import.meta.dir, '../canvas-lib.tsx'), 'utf8');
    expect(lib).toContain('${presentHidesCss()}');
  });

  test('G2: the stage fits what the DOM measures now, not the height the observers have yet to report', () => {
    const world = document.createElement('div');
    const art = document.createElement('article');
    art.setAttribute('data-dc-screen', 'a"b');
    Object.defineProperty(art, 'offsetHeight', { value: 400 });
    world.append(art);
    const rects: ArtboardRect[] = [
      { id: 'a"b', x: 0, y: 0, w: 400, h: 425, kind: 'digital' },
      { id: 'gone', x: 0, y: 500, w: 400, h: 100, kind: 'digital' },
    ];
    const out = liveRects(rects, world);
    expect(out[0]?.h).toBe(400);
    expect(out[1]).toBe(rects[1]); // not in the DOM: untouched
    expect(liveRects(rects, null)).toBe(rects);
  });

  test('G2: Present clears the selection it finds in the canvas shell and puts it back on the way out', () => {
    const calls: string[] = [];
    let held: unknown[] = ['a', 'b'];
    const sel = {
      get selected() {
        return held;
      },
      clear: () => {
        calls.push('clear');
        held = [];
      },
      replace: (s: unknown[]) => {
        calls.push(`replace:${s.join('+')}`);
        held = s;
      },
    };
    const annot = { clear: () => calls.push('annot-clear') };
    function SelProbe() {
      usePresentSelection(sel as never, annot);
      return null;
    }
    const r2 = createRoot(document.createElement('div'));
    act(() => r2.render(createElement(SelProbe)));
    setMode('present', { kind: 'canvas' });
    expect(calls).toEqual(['clear', 'annot-clear']);
    expect(held).toEqual([]);
    setMode('edit');
    expect(calls).toEqual(['clear', 'annot-clear', 'replace:a+b']);
    // nothing selected: nothing to put back
    calls.length = 0;
    held = [];
    setMode('present', { kind: 'artboards', from: 'story' });
    setMode('edit');
    expect(calls).toEqual(['clear', 'annot-clear']);
    act(() => r2.unmount());
  });
});
