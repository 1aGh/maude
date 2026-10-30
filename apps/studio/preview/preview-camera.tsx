// apps/studio/preview/preview-camera.tsx — S3.9: Edit ⇄ Preview in the canvas (04 md-motion).
//
// One switch, one place, one artboard: pressing Preview eases the camera onto the artboard you were on over
// `--dur-panel` (220 ms) shaped by `--ease-out`, while the shell folds the panels toward their icons; back
// to Edit runs the same frames in reverse. Reduced motion is a 1 ms cut.
//
//   · ONE move per transition. The shell sends the TARGET layout's insets first and `set-mode` second, so
//     the fit below already honours the folded panels. An inset change on its own never moves the camera
//     (V2-1.2 §5.6 I1): this module reacts to a mode transition and to nothing else.
//   · Edit ⇄ Preview (and Viewing ⇄ Preview) only. Present is S3.2a's stage and has its own lift
//     (present-stage.tsx); a Present transition here cancels a running ease and forgets the way back.
//   · The camera belongs to the person: a gesture mid-ease stops it, and Preview → Edit only returns the
//     camera when it is still where the ease left it.
//
// Mounted by canvas-lib's `DesignCanvasInner` through `usePreviewCamera` and nothing else. The engine is
// plain TS with its scheduling injected, so the tests drive it frame by frame.

import { type RefObject, useEffect, useRef, useSyncExternalStore } from 'react';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import type { CanvasModeV2 } from '../bridge/canvas-modes.ts';
import { type Insets, visibleRect, ZERO_INSETS } from '../bridge/occlusion.ts';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `--dur-panel` when the token is absent (client/styles/1-tokens-shell.css). */
export const EASE_MS = 220;
/** `--ease-out` when the token is absent. */
export const EASE_OUT: readonly [number, number, number, number] = [0.2, 0, 0, 1];

const SAME_EPS = 1e-6;
const sameCam = (a: Camera, b: Camera) =>
  Math.abs(a.x - b.x) < SAME_EPS &&
  Math.abs(a.y - b.y) < SAME_EPS &&
  Math.abs(a.zoom - b.zoom) < 1e-9;

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────

const isBase = (m: CanvasModeV2 | null) => m === 'edit' || m === 'viewing';

/** Which mode transitions move the camera. Present (either side), boot, a re-sent mode and a role clamp
 *  between Edit and Viewing do not. */
export function easeKind(
  prev: CanvasModeV2 | null,
  next: CanvasModeV2 | null
): 'enter' | 'leave' | null {
  if (isBase(prev) && next === 'preview') return 'enter';
  if (prev === 'preview' && isBase(next)) return 'leave';
  return null;
}

/** A CSS `cubic-bezier(x1, y1, x2, y2)` as a function of time (Newton, bisection as the fallback). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s;
  const Y = (s: number) => ((ay * s + by) * s + cy) * s;
  const dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = X(s) - t;
      if (Math.abs(err) < 1e-7) return Y(s);
      const d = dX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 40; i++) {
      const x = X(s);
      if (Math.abs(x - t) < 1e-7) break;
      if (x < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return Y(s);
  };
}

/**
 * The artboard in view: nearest the centre of the visible area, for the layout the camera was drawn for
 * (`insets` = what covered the canvas BEFORE the panels folded). Ties go to the first in canvas order.
 */
export function inViewArtboard(
  cam: Camera,
  host: { w: number; h: number },
  insets: Readonly<Insets>,
  rects: readonly BoardRect[]
): BoardRect | null {
  if (rects.length === 0 || !cam.zoom) return null;
  const v = visibleRect(host.w, host.h, insets);
  const cx = (v.x + v.w / 2 - cam.x) / cam.zoom;
  const cy = (v.y + v.h / 2 - cam.y) / cam.zoom;
  let best: BoardRect | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const r of rects) {
    const d = (r.x + r.w / 2 - cx) ** 2 + (r.y + r.h / 2 - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

// ── the engine ───────────────────────────────────────────────────────────────────────────────────

export interface PreviewEaseDeps {
  /** The camera as it is right now (exact — the live mirror, not the settle-cadence published value). */
  getCamera(): Camera;
  setCamera(c: Camera): void;
  getArtboards(): readonly BoardRect[];
  /** The canvas host's size; null / zero when it is not showing (a background canvas). */
  getHostSize(): { w: number; h: number } | null;
  /** 04 md-preview-combine: a canvas with several boards and NO links has nothing to step through, so Preview
   *  keeps the overview ("pan across all 15") instead of zooming onto one board. Absent = never hold. */
  holdOverview?(): boolean;
  /** The camera that lands `rect` in the visible area under the CURRENT insets. */
  fit(rect: BoardRect): Camera;
  raf(cb: (now: number) => void): number;
  caf(id: number): void;
  now(): number;
  reducedMotion(): boolean;
  durationMs(): number;
  easing(): (t: number) => number;
}

export interface PreviewEase {
  /** Edit / Viewing → Preview. `insetsBefore` = the insets the camera was drawn under. */
  enter(insetsBefore?: Readonly<Insets>): boolean;
  /** Preview → Edit / Viewing: back to where Edit left it, if the camera is still where the ease left it. */
  leave(): boolean;
  /** Present (or anything else that is not ours) took over: cancel and forget the way back. */
  stop(): void;
  moving(): boolean;
  dispose(): void;
}

export function createPreviewEase(deps: PreviewEaseDeps): PreviewEase {
  let tween: number | null = null;
  /** The camera Edit left, and the one the ease landed on (null while it is still running). */
  let saved: { from: Camera; landed: Camera | null } | null = null;
  /** The camera as this engine last set it, read back (the controller clamps zoom). */
  let last: Camera | null = null;

  const ms = () => (deps.reducedMotion() ? 1 : Math.max(1, deps.durationMs()));
  const cancel = () => {
    if (tween !== null) deps.caf(tween);
    tween = null;
  };
  const put = (c: Camera) => {
    deps.setCamera({ ...c });
    last = deps.getCamera();
  };

  /** Glide to `to`; the LAST frame is `to` itself, never an interpolation that rounds. */
  const glide = (to: Camera, done: (landed: Camera) => void) => {
    cancel();
    const from = deps.getCamera();
    const dur = ms();
    if (dur <= 1 || sameCam(from, to)) {
      if (!sameCam(from, to)) put(to);
      done(deps.getCamera());
      return;
    }
    const ease = deps.easing();
    const t0 = deps.now();
    last = from;
    const tick = (now: number) => {
      // the person took the camera (a pan, a wheel, a jump): the ease is over
      if (last && !sameCam(deps.getCamera(), last)) {
        tween = null;
        saved = null;
        return;
      }
      const t = Math.min(1, Math.max(0, (now - t0) / dur));
      if (t >= 1) {
        tween = null;
        put(to);
        done(deps.getCamera());
        return;
      }
      const e = ease(t);
      put({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        zoom: from.zoom + (to.zoom - from.zoom) * e,
      });
      tween = deps.raf(tick);
    };
    tween = deps.raf(tick);
  };

  return {
    enter(insetsBefore = ZERO_INSETS) {
      cancel();
      saved = null;
      const host = deps.getHostSize();
      if (!host?.w || !host.h) return false;
      if (deps.holdOverview?.()) return false;
      const cam = deps.getCamera();
      const board = inViewArtboard(cam, host, insetsBefore, deps.getArtboards());
      if (!board) return false;
      const to = deps.fit(board);
      if (sameCam(cam, to)) return false;
      saved = { from: cam, landed: null };
      const mine = saved;
      glide(to, (landed) => {
        if (saved === mine) mine.landed = landed;
      });
      return true;
    },

    leave() {
      const s = saved;
      saved = null;
      if (!s) return false;
      const running = tween !== null;
      const cur = deps.getCamera();
      // moved by the person since the ease landed: the camera is theirs
      if (!running && !(s.landed && sameCam(cur, s.landed))) return false;
      if (sameCam(cur, s.from)) {
        cancel();
        return false;
      }
      glide(s.from, () => {});
      return true;
    },

    stop() {
      cancel();
      saved = null;
    },

    moving: () => tween !== null,

    dispose() {
      cancel();
      saved = null;
    },
  };
}

// ── the React mount ──────────────────────────────────────────────────────────────────────────────

const STYLE_ID = 'maude-preview-style';

/**
 * Preview's live surfaces (injected once; the canvas-lib ENGINE_CSS stays untouched). A web artboard's
 * design surface scrolls inside itself while previewing — it is `overflow: hidden` in Edit, where the
 * artboard is a frame to move, not a page to read. Scrollbars stay out of the picture.
 */
export function ensurePreviewStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
html[data-maude-preview] .dc-canvas .dc-artboard[data-dc-kind='web'] > .dc-artboard-body {
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}
html[data-maude-preview] .dc-canvas .dc-artboard[data-dc-kind='web'] > .dc-artboard-body::-webkit-scrollbar {
  display: none;
}
`;
  doc.head.appendChild(style);
}

function cssTokenMs(win: Window): number {
  try {
    const raw = win
      .getComputedStyle(win.document.documentElement)
      .getPropertyValue('--dur-panel')
      .trim();
    const m = /^([\d.]+)(ms|s)$/.exec(raw);
    if (m) return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  } catch {
    /* no computed style */
  }
  return EASE_MS;
}

function cssEasing(win: Window): (t: number) => number {
  try {
    const raw = win
      .getComputedStyle(win.document.documentElement)
      .getPropertyValue('--ease-out')
      .trim();
    const m =
      /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(raw);
    if (m) return cubicBezier(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
  } catch {
    /* no computed style */
  }
  return cubicBezier(...EASE_OUT);
}

function reducedMotion(win: Window): boolean {
  try {
    return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const NO_SUBSCRIBE = () => () => {};
const NO_SNAPSHOT = () => null;

/** Is the shell's mode Preview right now? (A hook, for chrome that steps aside in Preview.) */
export function usePreviewing(): boolean {
  const win = typeof window === 'undefined' ? null : window;
  const store = win ? canvasModeStore(win) : null;
  const mode = useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? () => store.get().mode : NO_SNAPSHOT,
    NO_SNAPSHOT
  );
  return mode === 'preview';
}

export interface UsePreviewCameraOptions<T extends BoardRect = BoardRect> {
  hostRef: RefObject<HTMLElement | null>;
  artboards: readonly T[];
  /** The viewport controller's handle: the way to set the camera. */
  controller: { viewport: Camera; setViewport(v: Camera): void };
  /** The exact live camera (canvas-lib's `getLiveViewport`); the controller's published one lags. */
  getCamera?: () => Camera | null;
  /** The camera that lands one artboard in the visible area (canvas-lib's `computeFit`, insets applied). */
  fit(rect: T): Camera;
}

/**
 * Mount Edit ⇄ Preview on a canvas. Reads the shell's `set-mode` through the document's mode store
 * (canvas-mode-store.ts) and moves the camera on a transition, once. It also marks the document while the
 * mode is Preview (`html[data-maude-preview]`) so a web artboard can scroll inside itself.
 */
export function usePreviewCamera<T extends BoardRect>(opts: UsePreviewCameraOptions<T>): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const win = typeof window === 'undefined' ? null : window;
  const engineRef = useRef<PreviewEase | null>(null);

  useEffect(() => {
    if (!win) return;
    const store = canvasModeStore(win);
    ensurePreviewStyles(win.document);
    const engine = createPreviewEase({
      getCamera: () => {
        const o = optsRef.current;
        return { ...(o.getCamera?.() ?? o.controller.viewport) };
      },
      setCamera: (c) => optsRef.current.controller.setViewport(c),
      getArtboards: () => optsRef.current.artboards,
      getHostSize: () => {
        const h = optsRef.current.hostRef.current;
        return h ? { w: h.clientWidth, h: h.clientHeight } : null;
      },
      fit: (rect) => optsRef.current.fit(rect as T),
      holdOverview: () =>
        optsRef.current.artboards.length > 1 && !win.document.querySelector('[data-cd-link]'),
      raf: (cb) => win.requestAnimationFrame(cb),
      caf: (id) => win.cancelAnimationFrame(id),
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      reducedMotion: () => reducedMotion(win),
      durationMs: () => cssTokenMs(win),
      easing: () => cssEasing(win),
    });
    engineRef.current = engine;

    // The insets the camera was DRAWN under. The shell sends the target layout's insets right before
    // `set-mode` (same task), so a change that just arrived is the folded layout and the value before that
    // burst is the one the camera knows. Older changes are the camera's own layout already.
    const BURST_MS = 100;
    const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let curInsets: Readonly<Insets> = store.get().insets;
    let beforeBurst: Readonly<Insets> = curInsets;
    let lastChangeAt = Number.NEGATIVE_INFINITY;
    let insetsSeq = store.get().insetsSeq;
    let modeSeq = store.get().modeSeq;
    const root = win.document.documentElement;
    const mark = (mode: CanvasModeV2 | null) => {
      if (mode === 'preview') root.setAttribute('data-maude-preview', '');
      else root.removeAttribute('data-maude-preview');
    };
    mark(store.get().mode);

    const onSnap = () => {
      const s = store.get();
      const now = clock();
      if (s.insetsSeq !== insetsSeq) {
        insetsSeq = s.insetsSeq;
        if (now - lastChangeAt > BURST_MS) beforeBurst = curInsets;
        curInsets = s.insets;
        lastChangeAt = now;
      }
      if (s.modeSeq === modeSeq) return;
      modeSeq = s.modeSeq;
      mark(s.mode);
      if (s.mode === 'present' || s.prevMode === 'present') {
        engine.stop();
        return;
      }
      const kind = easeKind(s.prevMode, s.mode);
      if (kind === 'enter') engine.enter(now - lastChangeAt <= BURST_MS ? beforeBurst : curInsets);
      else if (kind === 'leave') engine.leave();
    };
    const unsub = store.subscribe(onSnap);
    return () => {
      unsub();
      engine.dispose();
      engineRef.current = null;
      root.removeAttribute('data-maude-preview');
    };
  }, [win]);
}
