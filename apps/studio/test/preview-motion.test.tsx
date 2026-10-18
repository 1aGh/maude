// S3.9 (md-motion) — Edit ⇄ Preview: the camera eases onto the artboard in view, once.
//   · the engine, on a manual clock: 220 ms (--dur-panel), ease-out (--ease-out), a 1 ms cut under
//     reduced motion, the LAST frame is the target itself; Preview → Edit puts the camera back, unless
//     the person moved it; a gesture mid-ease stops it
//   · never Present: the ease belongs to Edit ⇄ Preview only (S3.2a's stage owns the Present lift)
//   · the hook, against the mode store: ONE move per transition, and an inset change alone moves nothing
//     (V2-1.2 §5.6 I1); a first `set-mode` (boot) and a re-sent one move nothing
//   · a web artboard scrolls inside itself in Preview, and a wheel that cannot scroll there still pans
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { type Insets, visibleRect, ZERO_INSETS } from '../bridge/occlusion.ts';
import {
  type BoardRect,
  type Camera,
  createPreviewEase,
  cubicBezier,
  EASE_MS,
  easeKind,
  inViewArtboard,
  type PreviewEaseDeps,
  usePreviewCamera,
} from '../preview/preview-camera.tsx';
import { previewWheelPassthrough, scrollsInside } from '../preview/wheel-scroll.ts';

const HOST = { w: 1600, h: 900 };
const BOARDS: BoardRect[] = [
  { id: 'home', x: 0, y: 0, w: 1440, h: 900 },
  { id: 'pricing', x: 1700, y: 0, w: 1440, h: 900 },
  { id: 'mobile', x: 0, y: 1100, w: 390, h: 844 },
];
const A: Camera = { x: 600, y: 310, zoom: 0.28 }; // zoomed out, the Homepage under the centre

/** The camera that lands `r` in the visible area, like canvas-lib's computeFit for one rect. */
function fitInto(r: BoardRect, ins: Readonly<Insets>): Camera {
  const v = visibleRect(HOST.w, HOST.h, ins);
  const zoom = Math.min((v.w - 48) / r.w, (v.h - 48) / r.h, 1);
  return {
    x: v.x + (v.w - r.w * zoom) / 2 - r.x * zoom,
    y: v.y + (v.h - r.h * zoom) / 2 - r.y * zoom,
    zoom,
  };
}

// ── the pieces ───────────────────────────────────────────────────────────────────────────────────

describe('easeKind: which transitions move the camera', () => {
  test('Edit / Viewing ⇄ Preview do; everything else does not', () => {
    expect(easeKind('edit', 'preview')).toBe('enter');
    expect(easeKind('viewing', 'preview')).toBe('enter');
    expect(easeKind('preview', 'edit')).toBe('leave');
    expect(easeKind('preview', 'viewing')).toBe('leave');
    // Present is S3.2a's lift; the ease never touches it
    expect(easeKind('edit', 'present')).toBeNull();
    expect(easeKind('present', 'edit')).toBeNull();
    expect(easeKind('preview', 'present')).toBeNull();
    expect(easeKind('present', 'preview')).toBeNull();
    // boot, a re-sent mode, a role clamp
    expect(easeKind(null, 'preview')).toBeNull();
    expect(easeKind('preview', 'preview')).toBeNull();
    expect(easeKind('edit', 'edit')).toBeNull();
    expect(easeKind('edit', 'viewing')).toBeNull();
  });
});

describe('cubicBezier (--ease-out)', () => {
  const out = cubicBezier(0.2, 0, 0, 1);
  test('hits both ends and is front-loaded', () => {
    expect(out(0)).toBe(0);
    expect(out(1)).toBe(1);
    // 04 md-motion frame 2: at 40 ms of 220 ease-out has done "most of the move early"
    expect(out(40 / 220)).toBeGreaterThan(0.3);
    expect(out(0.5)).toBeGreaterThan(0.8);
  });
});

describe('inViewArtboard', () => {
  test('the artboard nearest the visible centre, honouring the insets the camera was drawn for', () => {
    // zoomed out over all three: the centre of the 1600x900 host is over the Homepage
    const cam: Camera = { x: 500, y: 315, zoom: 0.3 };
    expect(inViewArtboard(cam, HOST, ZERO_INSETS, BOARDS)?.id).toBe('home');
    // a left panel 700 px wide moves the visible centre right, toward pricing
    const panel: Insets = { top: 0, right: 0, bottom: 0, left: 700 };
    expect(inViewArtboard(cam, HOST, panel, BOARDS)?.id).toBe('pricing');
    expect(inViewArtboard(cam, HOST, ZERO_INSETS, [])).toBeNull();
  });
});

// ── the engine, on a manual clock ───────────────────────────────────────────────────────────────

interface Rig {
  ease: ReturnType<typeof createPreviewEase>;
  cam: Camera;
  sets: Camera[];
  rects: BoardRect[];
  reduced: boolean;
  host: { w: number; h: number } | null;
  insets: Insets;
  advance(ms: number): void;
  frames(): number;
}

function rig(): Rig {
  let clock = 0;
  let nextId = 1;
  const queue = new Map<number, (t: number) => void>();
  const r = {
    cam: { ...A },
    sets: [] as Camera[],
    rects: BOARDS.map((b) => ({ ...b })),
    reduced: false,
    host: { ...HOST } as { w: number; h: number } | null,
    insets: { top: 0, right: 0, bottom: 0, left: 0 } as Insets,
  } as Rig;
  const deps: PreviewEaseDeps = {
    getCamera: () => ({ ...r.cam }),
    setCamera: (c) => {
      r.cam = { ...c };
      r.sets.push({ ...c });
    },
    getArtboards: () => r.rects,
    getHostSize: () => r.host,
    fit: (rect) => fitInto(rect, r.insets),
    raf: (cb) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf: (id) => {
      queue.delete(id);
    },
    now: () => clock,
    reducedMotion: () => r.reduced,
    durationMs: () => EASE_MS,
    easing: () => cubicBezier(0.2, 0, 0, 1),
  };
  r.ease = createPreviewEase(deps);
  r.advance = (ms) => {
    clock += ms;
    const due = [...queue.entries()];
    queue.clear();
    for (const [, cb] of due) cb(clock);
  };
  r.frames = () => queue.size;
  return r;
}

let rg: Rig | null = null;
afterEach(() => {
  rg?.ease.dispose();
  rg = null;
});

describe('Edit → Preview: the engine', () => {
  test('eases onto the artboard in view over 220 ms; the last frame is the target itself', () => {
    rg = rig();
    const want = fitInto(BOARDS[0], rg.insets);
    expect(rg.ease.enter(ZERO_INSETS)).toBe(true);
    expect(rg.cam).toEqual(A); // frame 0: nothing has moved yet
    rg.advance(40);
    expect(rg.cam).not.toEqual(A);
    expect(rg.cam).not.toEqual(want);
    // ease-out: well past 30 % of the way at 40 ms
    const done = (rg.cam.zoom - A.zoom) / (want.zoom - A.zoom);
    expect(done).toBeGreaterThan(0.3);
    rg.advance(180);
    expect(Object.is(rg.cam.x, want.x)).toBe(true);
    expect(Object.is(rg.cam.y, want.y)).toBe(true);
    expect(Object.is(rg.cam.zoom, want.zoom)).toBe(true);
    expect(rg.ease.moving()).toBe(false);
    expect(rg.frames()).toBe(0);
  });

  test('reduced motion is one 1 ms cut to the target', () => {
    rg = rig();
    rg.reduced = true;
    rg.ease.enter(ZERO_INSETS);
    expect(rg.sets).toHaveLength(1);
    expect(rg.cam).toEqual(fitInto(BOARDS[0], rg.insets));
    expect(rg.frames()).toBe(0);
  });

  test('no artboards, or a host with no size (a background canvas): nothing moves', () => {
    rg = rig();
    rg.rects = [];
    expect(rg.ease.enter(ZERO_INSETS)).toBe(false);
    rg.rects = BOARDS;
    rg.host = { w: 0, h: 0 };
    expect(rg.ease.enter(ZERO_INSETS)).toBe(false);
    expect(rg.sets).toHaveLength(0);
  });

  test('already there: no move', () => {
    rg = rig();
    rg.cam = fitInto(BOARDS[0], rg.insets);
    rg.ease.enter(ZERO_INSETS);
    rg.advance(300);
    expect(rg.sets).toHaveLength(0);
  });

  test('a gesture mid-ease stops it: the camera is the person’s', () => {
    rg = rig();
    rg.ease.enter(ZERO_INSETS);
    rg.advance(60);
    const n = rg.sets.length;
    rg.cam = { x: rg.cam.x + 80, y: rg.cam.y, zoom: rg.cam.zoom }; // the person panned
    rg.advance(60);
    expect(rg.sets).toHaveLength(n);
    expect(rg.ease.moving()).toBe(false);
  });
});

describe('Preview → Edit: the same frames in reverse', () => {
  test('puts the camera back where Edit left it', () => {
    rg = rig();
    rg.ease.enter(ZERO_INSETS);
    rg.advance(220);
    rg.ease.leave();
    rg.advance(110);
    expect(rg.cam).not.toEqual(A);
    rg.advance(110);
    expect(Object.is(rg.cam.x, A.x)).toBe(true);
    expect(Object.is(rg.cam.y, A.y)).toBe(true);
    expect(Object.is(rg.cam.zoom, A.zoom)).toBe(true);
  });

  test('leaving mid-ease turns around from where it is', () => {
    rg = rig();
    rg.ease.enter(ZERO_INSETS);
    rg.advance(100);
    rg.ease.leave();
    rg.advance(300);
    expect(rg.cam).toEqual(A);
  });

  test('a camera the person moved in Preview stays where they put it', () => {
    rg = rig();
    rg.ease.enter(ZERO_INSETS);
    rg.advance(220);
    rg.cam = { x: rg.cam.x - 300, y: rg.cam.y, zoom: rg.cam.zoom };
    const moved = { ...rg.cam };
    expect(rg.ease.leave()).toBe(false);
    rg.advance(300);
    expect(rg.cam).toEqual(moved);
  });

  test('Preview entered without an ease (a view-only boot) has nothing to go back to', () => {
    rg = rig();
    expect(rg.ease.leave()).toBe(false);
    expect(rg.sets).toHaveLength(0);
  });
});

describe('never Present', () => {
  test('stop() (Present took over) cancels a running ease and forgets the way back', () => {
    rg = rig();
    rg.ease.enter(ZERO_INSETS);
    rg.advance(60);
    const n = rg.sets.length;
    rg.ease.stop();
    rg.advance(300);
    expect(rg.sets).toHaveLength(n);
    expect(rg.ease.leave()).toBe(false);
  });
});

// ── the hook, against the mode store ────────────────────────────────────────────────────────────

describe('usePreviewCamera: one camera move per Edit ⇄ Preview', () => {
  let root: Root | null = null;
  let host: HTMLElement;
  let clock = 0;
  const raf = new Map<number, (t: number) => void>();
  let rafId = 1;
  let nowSpy: ReturnType<typeof spyOn> | null = null;
  let realRaf: typeof window.requestAnimationFrame;
  let realCaf: typeof window.cancelAnimationFrame;
  let realParent: PropertyDescriptor | undefined;
  const sets: Camera[] = [];
  const camera = { current: { ...A } };
  const fakeParent = { postMessage: () => {} };
  const board = (id: string) => BOARDS.find((b) => b.id === id) as BoardRect;

  function Probe() {
    usePreviewCamera({
      hostRef: { current: host },
      artboards: BOARDS as never,
      controller: {
        viewport: camera.current,
        setViewport: (v) => {
          camera.current = { ...v };
          sets.push({ ...v });
        },
      },
      getCamera: () => ({ ...camera.current }),
      fit: (rect) => fitInto(board(rect.id), canvasModeStore(window).get().insets),
    });
    return null;
  }

  const advance = (ms: number) => {
    clock += ms;
    const due = [...raf.entries()];
    raf.clear();
    act(() => {
      for (const [, cb] of due) cb(clock);
    });
  };
  const shell = (data: Record<string, unknown>) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { source: fakeParent as unknown as Window, data })
      );
    });
  const setMode = (mode: string, present: unknown = null) =>
    shell({
      dgn: 'set-mode',
      v: 2,
      seq: canvasModeStore(window).get().modeSeq + 1,
      mode,
      present,
      caps: { edit: true, annotate: true, comment: true },
    });
  const setInsets = (insets: Insets) =>
    shell({
      dgn: 'occluded-insets',
      seq: canvasModeStore(window).get().insetsSeq + 1,
      insets,
    });

  beforeAll(() => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
    realRaf = window.requestAnimationFrame;
    realCaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((cb: (t: number) => void) => {
      const id = rafId++;
      raf.set(id, cb);
      return id;
    }) as never;
    window.cancelAnimationFrame = ((id: number) => {
      raf.delete(id);
    }) as never;
    nowSpy = spyOn(performance, 'now').mockImplementation(() => clock);
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false });
    host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: HOST.w });
    Object.defineProperty(host, 'clientHeight', { value: HOST.h });
    document.body.appendChild(host);
  });
  afterAll(() => {
    act(() => root?.unmount());
    nowSpy?.mockRestore();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCaf;
    if (realParent) Object.defineProperty(window, 'parent', realParent);
    else Reflect.deleteProperty(window, 'parent');
    host.remove();
  });
  beforeEach(() => {
    sets.length = 0;
  });

  test('boot: the first set-mode (Edit) moves nothing', () => {
    root = createRoot(document.createElement('div'));
    act(() => root?.render(createElement(Probe)));
    setMode('edit');
    advance(300);
    expect(sets).toHaveLength(0);
    expect(document.documentElement.hasAttribute('data-maude-preview')).toBe(false);
  });

  test('Preview: the insets arrive first, then set-mode; the camera eases once and lands', () => {
    // the shell sends the TARGET layout's insets before set-mode (panels folded: nothing on the left)
    setInsets({ top: 64, right: 0, bottom: 64, left: 0 });
    advance(300);
    expect(sets).toHaveLength(0); // an inset change alone never moves the camera (I1)

    setMode('preview');
    expect(document.documentElement.hasAttribute('data-maude-preview')).toBe(true);
    advance(60);
    expect(sets.length).toBeGreaterThan(0);
    advance(400);
    const want = fitInto(board('home'), { top: 64, right: 0, bottom: 64, left: 0 });
    expect(camera.current).toEqual(want);
    const settled = sets.length;

    // the pill folds and the toolbar settles a moment later: more insets, still no move
    setInsets({ top: 64, right: 0, bottom: 72, left: 0 });
    advance(400);
    expect(sets).toHaveLength(settled);
    // the same mode again (a re-sent set-mode) moves nothing either
    setMode('preview');
    advance(400);
    expect(sets).toHaveLength(settled);
  });

  test('Present from Preview and back moves nothing here (S3.2a owns it)', () => {
    const before = sets.length;
    setMode('present', { kind: 'artboards', from: 'start' });
    advance(400);
    expect(document.documentElement.hasAttribute('data-maude-preview')).toBe(false);
    setMode('preview');
    advance(400);
    expect(sets).toHaveLength(before);
    expect(document.documentElement.hasAttribute('data-maude-preview')).toBe(true);
  });

  test('back to Edit eases the camera home, then the attribute is gone', () => {
    // Present stood between: the way back was forgotten, so Preview → Edit has nowhere to return to
    setMode('edit');
    advance(400);
    expect(document.documentElement.hasAttribute('data-maude-preview')).toBe(false);
    // a fresh round trip: Edit → Preview → Edit returns to the Edit camera
    camera.current = { x: -120, y: 30, zoom: 0.2 };
    const edit = { ...camera.current };
    const n = sets.length;
    setMode('preview');
    advance(400);
    expect(camera.current).not.toEqual(edit);
    setMode('edit');
    advance(400);
    expect(camera.current).toEqual(edit);
    expect(sets.length).toBeGreaterThan(n);
  });
});

// ── a web artboard scrolls inside itself ────────────────────────────────────────────────────────

describe('scrollsInside / previewWheelPassthrough', () => {
  function scroller(over: { top?: number; sh?: number; ch?: number; overflowY?: string }) {
    const board = document.createElement('div');
    board.className = 'dc-artboard-body';
    const el = document.createElement('div');
    el.style.overflowY = over.overflowY ?? 'auto';
    Object.defineProperty(el, 'scrollHeight', { value: over.sh ?? 3000 });
    Object.defineProperty(el, 'clientHeight', { value: over.ch ?? 900 });
    el.scrollTop = over.top ?? 0;
    const leaf = document.createElement('p');
    el.appendChild(leaf);
    board.appendChild(el);
    document.body.appendChild(board);
    return { board, el, leaf };
  }
  afterEach(() => {
    for (const b of document.querySelectorAll('.dc-artboard-body')) b.remove();
  });

  test('wheel down inside a scroller with room below: the design scrolls', () => {
    const { board, leaf } = scroller({ top: 0 });
    expect(scrollsInside(leaf, board, 0, 120)).toBe(true);
  });

  test('at the bottom, a wheel down pans the canvas; wheel up still scrolls', () => {
    const { board, leaf } = scroller({ top: 2100 }); // 2100 + 900 = 3000
    expect(scrollsInside(leaf, board, 0, 120)).toBe(false);
    expect(scrollsInside(leaf, board, 0, -120)).toBe(true);
  });

  test('a surface that cannot scroll never takes the wheel', () => {
    const fits = scroller({ sh: 900, ch: 900 });
    expect(scrollsInside(fits.leaf, fits.board, 0, 120)).toBe(false);
    const hidden = scroller({ overflowY: 'hidden' });
    expect(scrollsInside(hidden.leaf, hidden.board, 0, 120)).toBe(false);
  });

  test('previewWheelPassthrough: Preview only, and a zoom or shift wheel is the canvas’s', () => {
    const { board, leaf } = scroller({ top: 0 });
    // a plain event shape: happy-dom's WheelEvent drops the modifier flags
    const wheel = (init: Partial<WheelEvent>) =>
      ({ deltaX: 0, deltaY: 120, target: leaf, ...init }) as unknown as WheelEvent;
    expect(previewWheelPassthrough(wheel({}), 'edit')).toBe(false);
    expect(previewWheelPassthrough(wheel({}), 'present')).toBe(false);
    expect(previewWheelPassthrough(wheel({}), 'preview')).toBe(true);
    expect(previewWheelPassthrough(wheel({ ctrlKey: true }), 'preview')).toBe(false);
    expect(previewWheelPassthrough(wheel({ metaKey: true }), 'preview')).toBe(false);
    expect(previewWheelPassthrough(wheel({ shiftKey: true }), 'preview')).toBe(false);
    // outside any artboard body there is nothing to scroll
    expect(previewWheelPassthrough(wheel({ target: document.body }), 'preview')).toBe(false);
    expect(board.isConnected).toBe(true);
  });
});
