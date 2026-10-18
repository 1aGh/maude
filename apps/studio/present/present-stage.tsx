// apps/studio/present/present-stage.tsx — S3.2a: Present · Artboards inside the canvas (md-present-lift).
//
// The stage is the canvas host. Entering Present lifts ONE artboard onto it — the camera glides to the
// kind-aware fit (fit.ts) over `--dur-route` (280 ms; 1 ms under reduced motion) while a dark mask fades
// in around it, so every other artboard sinks into the dark. The audience sees one artboard, never the
// canvas (A8: the shell holds module updates while this runs, `_shell.html`).
//
//   click · → · space      the next artboard (← · ⇧space the previous), in the run `order.ts` builds
//   esc                    `mode-request back` — the shell decides where it returns to (escStep)
//   `present-step {to}`    the shell's own controls and presenter view (canvas-mode-store `step`)
//   every move             `present-position {index,total,artboardId}` (reportPresentPosition)
//
// Leaving puts the camera back EXACTLY where it was (the last frame is `setCamera(saved)`, not the end of
// an interpolation, so the numbers are byte-equal) and restores the selection Present cleared.
//
// Mounted by canvas-lib's `DesignCanvasInner` through `usePresentStage` and nothing else: the camera is
// the viewport controller's, handed in as `setCamera`/`getCamera`. The engine below is plain TS with its
// scheduling injected, so the tests drive it frame by frame.

import { type RefObject, useEffect, useRef, useSyncExternalStore } from 'react';
import { canvasModeStore, reportPresentPosition } from '../bridge/canvas-mode-store.ts';
import type { ArtboardRect } from '../canvas-lib.tsx';
import { resolveBleedMm, resolveMmPx } from '../print/units.ts';
import { cameraFor, fitForKind } from './fit.ts';
import { type PresentMeta, presentRun, startIndex } from './order.ts';
import { usePointerDot } from './pointer-dot.tsx';
import { usePresentZoom } from './present-zoom.ts';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** The slice of the selection set Present needs (use-selection-set.tsx). */
export interface SelectionLike {
  readonly selected: readonly unknown[];
  replace(s: never): void;
  clear(): void;
}

/** The lift tween, in ms, when the token is absent: `--dur-route` (client/styles/1-tokens-maude.css). */
export const LIFT_MS = 280;
const MASK_SPREAD_PX = 100000;
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4;

export interface StageDeps {
  win: Window;
  getHost(): HTMLElement | null;
  getWorld(): HTMLElement | null;
  getArtboards(): readonly ArtboardRect[];
  getCamera(): Camera;
  setCamera(c: Camera): void;
  getSelection(): SelectionLike | null;
  readMeta(): PresentMeta | undefined;
  raf(cb: (now: number) => void): number;
  caf(id: number): void;
  now(): number;
  reducedMotion(): boolean;
  liftMs(): number;
}

export interface StageState {
  active: boolean;
  index: number;
  total: number;
  artboardId: string | null;
}

export interface PresentStage {
  start(from?: string | null): void;
  stop(): void;
  step(to: number | 'next' | 'prev'): void;
  /** The artboards, the host or the meta changed under a running stage: re-fit without a tween. */
  refresh(): void;
  /** Unmount: undo everything at once. */
  dispose(): void;
  state(): StageState;
}

const sameCam = (a: Camera, b: Camera) =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.zoom - b.zoom) < 1e-9;

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false;
  const tag = String(el.tagName).toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

function bleedPxOf(world: HTMLElement | null, id: string): number {
  if (!world) return 0;
  for (const el of Array.from(world.querySelectorAll('[data-dc-screen]'))) {
    if (el.getAttribute('data-dc-screen') !== id) continue;
    const raw = el.getAttribute('data-dc-print');
    if (!raw) return 0;
    try {
      const p = JSON.parse(raw) as { paper?: unknown; bleedMm?: unknown };
      if (typeof p.paper !== 'string') return 0;
      const bleedMm = typeof p.bleedMm === 'number' ? p.bleedMm : undefined;
      return resolveMmPx(
        resolveBleedMm({ paper: p.paper, ...(bleedMm === undefined ? {} : { bleedMm }) })
      );
    } catch {
      return 0;
    }
  }
  return 0;
}

export function createPresentStage(deps: StageDeps): PresentStage {
  let active = false;
  let index = 0;
  let total = 0;
  let artboardId: string | null = null;
  /** What Present found and puts back. */
  let saved: { camera: Camera; selection: unknown[] } | null = null;
  /** The camera as this stage last set it (the controller's own published value lags a frame or two). */
  let cam: Camera | null = null;
  let mask: HTMLElement | null = null;
  let tween: number | null = null;
  let exiting = false;
  let detach: (() => void) | null = null;

  const ms = () => (deps.reducedMotion() ? 1 : Math.max(1, deps.liftMs()));

  const setCam = (c: Camera) => {
    cam = { ...c };
    deps.setCamera({ ...c });
  };

  const cancelTween = () => {
    if (tween !== null) deps.caf(tween);
    tween = null;
  };

  /** Glide the camera to `to`; the LAST frame is `to` itself, never an interpolation that rounds. */
  const glide = (to: Camera, dur: number, done?: () => void) => {
    cancelTween();
    const from = cam ?? deps.getCamera();
    if (dur <= 1 || sameCam(from, to)) {
      setCam(to);
      done?.();
      return;
    }
    const t0 = deps.now();
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / dur));
      if (t >= 1) {
        tween = null;
        setCam(to);
        done?.();
        return;
      }
      const e = 1 - (1 - t) ** 3; // ease-out cubic, the canvas' own programmatic ease
      setCam({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        zoom: from.zoom + (to.zoom - from.zoom) * e,
      });
      tween = deps.raf(tick);
    };
    tween = deps.raf(tick);
  };

  const ensureMask = (): HTMLElement | null => {
    if (mask) return mask;
    const world = deps.getWorld();
    if (!world) return null;
    const el = world.ownerDocument.createElement('div');
    el.setAttribute('data-maude-present-stage', '');
    el.setAttribute('aria-hidden', 'true');
    const s = el.style;
    s.position = 'absolute';
    s.pointerEvents = 'none';
    s.zIndex = '2147483000';
    s.boxShadow = `0 0 0 ${MASK_SPREAD_PX}px var(--bg-0, oklch(0.165 0.012 255))`;
    s.opacity = '0';
    s.transition = `opacity ${ms()}ms ease-out`;
    world.appendChild(el);
    mask = el;
    return el;
  };

  const removeMask = () => {
    mask?.remove();
    mask = null;
  };

  const fadeMask = (to: 0 | 1) => {
    if (!mask) return;
    mask.style.transition = `opacity ${ms()}ms ease-out`;
    // A frame at the old opacity first, or the browser has nothing to transition from.
    void mask.offsetWidth;
    mask.style.opacity = String(to);
  };

  /** The run right now, from the live rects + meta (a peer or the AI may have changed either). */
  const currentRun = () => presentRun(deps.getArtboards(), deps.readMeta());

  const stageSize = () => {
    const host = deps.getHost();
    return { w: host?.clientWidth || 0, h: host?.clientHeight || 0 };
  };

  /** Show artboard `i` of the run: place the mask, and the camera — by glide (the lift) or at once. */
  const show = (i: number, how: 'lift' | 'cut', announce: boolean) => {
    const r = currentRun();
    total = r.run.length;
    if (total === 0) {
      artboardId = null;
      index = 0;
      removeMask();
      return;
    }
    index = Math.min(Math.max(0, i), total - 1);
    const id = r.run[index];
    const rect = deps.getArtboards().find((a) => a.id === id);
    if (!rect) return;
    artboardId = id;
    const fit = fitForKind({
      kind: rect.kind,
      art: { w: rect.w, h: rect.h },
      stage: stageSize(),
      bleedPx: rect.kind === 'print' ? bleedPxOf(deps.getWorld(), id) : 0,
      minScale: ZOOM_MIN,
      maxScale: ZOOM_MAX,
    });
    const el = ensureMask();
    if (el) {
      el.style.left = `${rect.x + fit.window.x}px`;
      el.style.top = `${rect.y + fit.window.y}px`;
      el.style.width = `${fit.window.w}px`;
      el.style.height = `${fit.window.h}px`;
    }
    const to = cameraFor(fit, { x: rect.x, y: rect.y });
    if (how === 'lift') {
      fadeMask(1);
      glide(to, ms());
    } else {
      cancelTween();
      if (el) {
        el.style.opacity = '1';
      }
      if (!cam || !sameCam(cam, to)) setCam(to);
    }
    if (announce) reportPresentPosition(deps.win, { index, total, artboardId: id });
  };

  const go = (to: number | 'next' | 'prev') => {
    if (!active || exiting) return;
    const n = currentRun().run.length;
    if (n === 0) return;
    const target = to === 'next' ? index + 1 : to === 'prev' ? index - 1 : Math.trunc(to);
    if (!Number.isFinite(target)) return;
    const clamped = Math.min(Math.max(0, target), n - 1);
    if (clamped === index && artboardId !== null) return; // the end (or the start): nothing to move to
    show(clamped, 'cut', true);
  };

  const askBack = () => {
    const win = deps.win;
    if (win.parent === win) return;
    if (!canvasModeStore(win).claimRequest('back|')) return; // the input router asks for the same esc
    try {
      win.parent.postMessage({ dgn: 'mode-request', mode: 'back', cause: 'esc' }, '*');
    } catch {
      /* detached */
    }
  };

  const consume = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      consume(e);
      askBack();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) {
      // Zoom chords would move the stage's camera; every other chord belongs to the shell.
      if ((e.metaKey || e.ctrlKey) && ['=', '+', '-', '0', '1'].includes(e.key)) consume(e);
      return;
    }
    if (isEditable(e.target)) return;
    let to: 'next' | 'prev' | null = null;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') to = 'next';
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') to = 'prev';
    else if (e.key === ' ' || e.code === 'Space') to = e.shiftKey ? 'prev' : 'next';
    if (!to) return;
    consume(e);
    if (!e.repeat) go(to);
  };

  const attach = () => {
    const host = deps.getHost();
    const win = deps.win;
    const NodeCtor = (win as unknown as { Node: typeof Node }).Node;
    const own = (e: Event) => !!host && e.target instanceof NodeCtor && host.contains(e.target);
    const onClick = (e: Event) => {
      if (!own(e)) return;
      const m = e as MouseEvent;
      consume(e);
      if (m.button === 0 && !m.metaKey && !m.ctrlKey && !m.altKey && !m.shiftKey) go('next');
    };
    // The router and the viewport controller must not see the audience's mouse: nothing is selected,
    // dragged, edited or panned on the stage.
    const eat = (e: Event) => {
      if (own(e)) consume(e);
    };
    const onResize = () => refresh();
    const swallow = [
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'dblclick',
      'contextmenu',
      'wheel',
      'gesturestart',
      'gesturechange',
    ];
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('click', onClick, true);
    for (const t of swallow) win.addEventListener(t, eat, { capture: true, passive: false });
    win.addEventListener('resize', onResize);
    detach = () => {
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('click', onClick, true);
      for (const t of swallow) win.removeEventListener(t, eat, true);
      win.removeEventListener('resize', onResize);
    };
  };

  const refresh = () => {
    if (!active || exiting || artboardId === null) return;
    const r = currentRun();
    const at = r.run.indexOf(artboardId);
    // Its artboard left the run (deleted, now skipped): stay on the same place in the run.
    // Mid-lift, a re-fit glides to the corrected target; settled, it cuts.
    show(at >= 0 ? at : index, tween !== null ? 'lift' : 'cut', at !== index || at < 0);
  };

  const finishExit = () => {
    cancelTween();
    const s = saved;
    saved = null;
    exiting = false;
    removeMask();
    if (s) setCam(s.camera);
    cam = null;
  };

  return {
    start(from) {
      if (active) return;
      if (exiting) {
        // Re-entered while the last exit was still settling: land it, then start from where it landed.
        const landed = saved?.camera;
        finishExit();
        if (landed) cam = { ...landed };
      }
      active = true;
      const sel = deps.getSelection();
      saved = {
        camera: { ...(cam ?? deps.getCamera()) },
        selection: sel ? [...sel.selected] : [],
      };
      cam = null;
      // The audience sees no selection halo: clear it now, restore it on the way out.
      if (sel && saved.selection.length > 0) sel.clear();
      attach();
      const r = currentRun();
      show(startIndex(r, from), 'lift', true);
    },

    stop() {
      if (!active) return;
      active = false;
      detach?.();
      detach = null;
      const s = saved;
      const sel = deps.getSelection();
      if (sel && s && s.selection.length > 0) sel.replace(s.selection as never);
      if (!s) return;
      exiting = true;
      fadeMask(0);
      glide(s.camera, ms(), finishExit);
    },

    step: (to) => go(to),
    refresh,

    dispose() {
      if (active) {
        active = false;
        detach?.();
        detach = null;
        const sel = deps.getSelection();
        if (sel && saved && saved.selection.length > 0) sel.replace(saved.selection as never);
        exiting = true;
      }
      if (exiting) finishExit();
      cancelTween();
      removeMask();
    },

    state: () => ({ active, index, total, artboardId }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The React mount

export interface UsePresentStageOptions {
  hostRef: RefObject<HTMLElement | null>;
  worldRef: RefObject<HTMLElement | null>;
  artboards: readonly ArtboardRect[];
  /** The viewport controller's handle: the camera as published, and the way to set it. */
  controller: { viewport: Camera; setViewport(v: Camera): void };
  selection: SelectionLike | null;
}

function cssMs(win: Window): number {
  try {
    const raw = win
      .getComputedStyle(win.document.documentElement)
      .getPropertyValue('--dur-route')
      .trim();
    const m = /^([\d.]+)(ms|s)$/.exec(raw);
    if (m) return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  } catch {
    /* no computed style */
  }
  return LIFT_MS;
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

/**
 * Mount Present · Artboards on a canvas. Reads the shell's `set-mode` through the document's mode store
 * (canvas-mode-store.ts), so it is inert until the shell says `present` with `kind: 'artboards'`.
 */
export function usePresentStage(opts: UsePresentStageOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const win = typeof window === 'undefined' ? null : window;
  const store = win ? canvasModeStore(win) : null;
  const snap = useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.get : NO_SNAPSHOT,
    NO_SNAPSHOT
  );
  const active = !!snap && snap.mode === 'present' && snap.present?.kind === 'artboards';
  const from = snap?.present?.from;
  const stepN = snap?.step?.n ?? 0;
  const stepTo = snap?.step?.to;

  const engineRef = useRef<PresentStage | null>(null);
  if (!engineRef.current && win) {
    engineRef.current = createPresentStage({
      win,
      getHost: () => optsRef.current.hostRef.current,
      getWorld: () => optsRef.current.worldRef.current,
      getArtboards: () => optsRef.current.artboards,
      getCamera: () => ({ ...optsRef.current.controller.viewport }),
      setCamera: (c) => optsRef.current.controller.setViewport(c),
      getSelection: () => optsRef.current.selection,
      readMeta: () =>
        (win as unknown as { __canvas_meta__?: { present?: PresentMeta } }).__canvas_meta__
          ?.present,
      raf: (cb) => win.requestAnimationFrame(cb),
      caf: (id) => win.cancelAnimationFrame(id),
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      reducedMotion: () => reducedMotion(win),
      liftMs: () => cssMs(win),
    });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `from` is read once, at the start
  useEffect(() => {
    const engine = engineRef.current;
    if (!active || !engine) return;
    engine.start(from);
    return () => engine.stop();
  }, [active]);

  const seenStep = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one step per `n`
  useEffect(() => {
    if (!active || stepN === 0 || stepN === seenStep.current || stepTo === undefined) return;
    seenStep.current = stepN;
    engineRef.current?.step(stepTo);
  }, [active, stepN]);

  // The artboards (a drag, an HMR, a peer's order) moved under a running stage.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on the artboard list only
  useEffect(() => {
    if (active) engineRef.current?.refresh();
  }, [opts.artboards]);

  // Unmount: declared after the start/stop effect, so its cleanup runs second and lands the exit at once.
  useEffect(() => () => engineRef.current?.dispose(), []);

  // S3.2b — the two small things Present · Canvas shares with this stage, mounted here so canvas-lib's
  // one mount point stays the only one: the presenter's Pointer (L) and the zoom the shell's pill shows.
  usePointerDot({ viewport: opts.controller.viewport });
  usePresentZoom(opts.controller.viewport.zoom);
}
