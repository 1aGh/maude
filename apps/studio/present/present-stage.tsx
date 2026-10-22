// apps/studio/present/present-stage.tsx — S3.2a: Present · Artboards inside the canvas (md-present-lift).
//
// The stage is the canvas host. Entering Present lifts ONE artboard onto it — the camera glides to the
// kind-aware fit (fit.ts) over `--dur-route` (280 ms; 1 ms under reduced motion) while a dark mask fades
// in around it, so every other artboard sinks into the dark. The audience sees one artboard, never the
// canvas (A8: the shell holds module updates while this runs, `_shell.html`).
//
//   click · → · space      the next artboard (← · ⇧space the previous), in the run `order.ts` builds
//   esc                    `mode-request back` — the shell decides where it returns to (escStep)
//   wheel                  a web artboard scrolls inside the stage (S3.3) — never the canvas camera
//   a clip (S3.3)          plays when its artboard's turn comes; a click pauses it (present-media.ts)
//   `present-step {to}`    the shell's own controls and presenter view (canvas-mode-store `step`)
//   every move             `present-position {index,total,artboardId}` (reportPresentPosition)
//
// Leaving puts the camera back EXACTLY where it was (the last frame is `setCamera(saved)`, not the end of
// an interpolation, so the numbers are byte-equal) and restores the selection Present cleared.
//
// Mounted by canvas-lib's `DesignCanvasInner` through `usePresentStage` and nothing else: the camera is
// the viewport controller's, handed in as `setCamera`/`getCamera`. The engine below is plain TS with its
// scheduling injected, so the tests drive it frame by frame.

import { type RefObject, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { canvasModeStore, reportPresentPosition } from '../bridge/canvas-mode-store.ts';
import type { ArtboardRect } from '../canvas-lib.tsx';
import { resolveBleedMm, resolveMmPx } from '../print/units.ts';
import {
  type AwarenessChanges,
  readForeignPeers,
  touchesForeignClient,
  useCollab,
} from '../use-collab.tsx';
import { cameraFor, type Fit, fitForKind, scrolled } from './fit.ts';
import { createFollower, type FollowView, newPresentSid } from './follow.ts';
import { formatIdsOf, onlyIds, type PresentMeta, presentRun, startIndex } from './order.ts';
import { usePointerDot } from './pointer-dot.tsx';
import {
  type ClipRef,
  createPresentMedia,
  type StageMedia,
  watchArtboardMedia,
} from './present-media.ts';
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

/**
 * S3.14 (G2) - the attribute the document root carries while ANY Present is on (Artboards or Canvas). canvas-lib's
 * engine CSS keys on it to draw only the work, as 04 md-present-lift / -full / -canvas do: no artboard label
 * bar, no breakpoint chip, no selection frame (the editor chrome list: `PRESENT_HIDES`).
 */
export const PRESENT_ATTR = 'data-maude-presenting';

/** The editor chrome that never reaches an audience. Mirrored into the engine CSS of canvas-lib.tsx. */
export const PRESENT_HIDES: readonly string[] = [
  '.dc-canvas .dc-artboard-label', // the title bar of every artboard (hiding it hugs the artboard to its design)
  '.dc-canvas .dc-artboard-video-badge',
  '.dc-canvas .dc-artboard-guides', // the web breakpoint chip, print marks, generic guides
  '.ed-ab-frame', // the selected artboard's frame and its eight handles
  '.ed-ab-handle',
  '.dc-cv-halo', // a selected / hovered element's halo
  '.dc-cv-group-bbox',
  '.dc-activity-rim',
  // S4.9 - the annotation layer never reaches an audience, whatever the viewer's own switch says.
  '.dc-annot-scene',
  '.dc-annot-lod',
  '.dc-annot-svg',
];

/** The CSS the engine stylesheet carries for `PRESENT_HIDES`. */
export const presentHidesCss = (): string =>
  `${PRESENT_HIDES.map((sel) => `html[${PRESENT_ATTR}] ${sel}`).join(',\n')} { display: none !important; }
/* the frame of an artboard (its hairline, and the active-artboard accent ring) is editor chrome too */
html[${PRESENT_ATTR}] .dc-canvas .dc-artboard { box-shadow: none !important; border-color: transparent !important; }`;

/**
 * The artboards with the size they have NOW. The stage fits an artboard at `start` - one frame after the label
 * bars went (PRESENT_HIDES), before the artboards' own observers have reported the shorter boxes - so it asks
 * the DOM, not the state, for the height (a forced layout, once per fit).
 */
export function liveRects(
  rects: readonly ArtboardRect[],
  world: HTMLElement | null
): readonly ArtboardRect[] {
  if (!world) return rects;
  // gate-b-polish3 (07 · ve-fullscreen) — the box the audience sees is the artboard's INSIDE: its hairline
  // border is editor chrome (made transparent while presenting), so a hole cut at the outer corner with the
  // design's width left a white sliver on the left/top and cut the right edge off by the border's width.
  const boxes = new Map<string, { h: number; dx: number; dy: number }>();
  for (const el of world.querySelectorAll<HTMLElement>('[data-dc-screen]'))
    boxes.set(el.getAttribute('data-dc-screen') ?? '', {
      h: el.clientHeight > 0 ? el.clientHeight : el.offsetHeight,
      dx: el.clientLeft || 0,
      dy: el.clientTop || 0,
    });
  return rects.map((r) => {
    const b = boxes.get(r.id);
    if (!b) return r;
    const h = b.h > 0 && Math.abs(b.h - r.h) >= 1 ? b.h : r.h;
    if (h === r.h && !b.dx && !b.dy) return r;
    return { ...r, x: r.x + b.dx, y: r.y + b.dy, h };
  });
}

/** The lift tween, in ms, when the token is absent: `--dur-route` (client/styles/1-tokens-shell.css). */
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
  /** S3.7a — every announced move; may return the session to stamp on `present-position`. */
  onMove?(pos: { index: number; total: number; artboardId: string }): {
    sid: string;
    seq: number;
  } | null;
  /** S3.7a — a person moved the stage here (a key or a click), not the shell or the presenter. */
  onLocalStep?(): void;
  /** S3.3 — the clip on the presented artboard (present-media.ts). Absent: nothing plays. */
  media?: StageMedia;
  /** S7.19 — the artboards that share `id`'s cut (`PresentSpec.only === 'formats'`); null = `id` is no video. */
  formatIds?(id: string): string[] | null;
}

export interface StageState {
  active: boolean;
  index: number;
  total: number;
  artboardId: string | null;
}

export interface PresentStage {
  start(from?: string | null, only?: 'formats' | null): void;
  stop(): void;
  step(to: number | 'next' | 'prev'): void;
  /** The artboards, the host or the meta changed under a running stage: re-fit without a tween. */
  refresh(): void;
  /** S3.7a — follow mode: show the presenter's artboard (by id; its index when the id is not in this
   *  run). A no-op when it is already on screen. */
  goTo(artboardId: string, index: number): void;
  /** S3.7a — the audience window: keys and clicks do nothing, and the pointer is hidden. */
  setLocked(locked: boolean): void;
  /** S7.19 — the artboards this Present is limited to (`only: 'formats'`), or null when it shows them all. */
  deck(): readonly string[] | null;
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

/** S3.6b — one cell of the `present-run` report (dgn-protocol `present-run`). */
export interface PresentRunCell {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const PRESENT_RUN_MAX = 2000;
const finiteOr0 = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * S3.6b — the artboards the presenter view's order map draws: canvas order, world rects, the label the
 * canvas shows (else the id). Clamped to what the dgn row accepts, so a big canvas never sends a
 * report the shell refuses whole.
 */
export function presentRunReport(
  artboards: readonly ArtboardRect[],
  labelOf: (id: string) => string | null
): PresentRunCell[] {
  return artboards.slice(0, PRESENT_RUN_MAX).map((a) => {
    const id = String(a.id).slice(0, 200);
    const label = (labelOf(a.id) ?? '').trim().slice(0, 200) || id;
    return {
      id,
      label,
      x: finiteOr0(a.x),
      y: finiteOr0(a.y),
      w: finiteOr0(a.w),
      h: finiteOr0(a.h),
    };
  });
}

/** The label an artboard shows on the canvas (its `.dc-artboard-label`), or null. */
function artboardLabel(world: HTMLElement | null, id: string): string | null {
  if (!world) return null;
  for (const el of Array.from(world.querySelectorAll('[data-dc-screen]'))) {
    if (el.getAttribute('data-dc-screen') !== id) continue;
    return el.querySelector('.dc-artboard-label')?.textContent ?? null;
  }
  return null;
}

/** Canvas → shell: the Present run (dgn `present-run`, active canvas only). */
export function reportPresentRun(win: Window, artboards: PresentRunCell[]): void {
  if (win.parent === win) return;
  try {
    win.parent.postMessage({ dgn: 'present-run', artboards }, '*');
  } catch {
    /* detached */
  }
}

export function createPresentStage(deps: StageDeps): PresentStage {
  let active = false;
  /** S7.19 — `only: 'formats'`: the artboards this Present is limited to (the video's formats); null = all. */
  let deckIds: string[] | null = null;
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
  let locked = false;
  /** S3.3 — a web artboard's scroll, in artboard px, and the fit it scrolls within (before the scroll). */
  let scroll = 0;
  let baseFit: Fit | null = null;

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
  const currentRun = () => onlyIds(presentRun(deps.getArtboards(), deps.readMeta()), deckIds);

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
    // The page above is left: the clip on it stops BEFORE the shell hears the move, so no echo of the old
    // clip reaches the new place.
    if (announce) deps.media?.leave();
    if (id !== artboardId) scroll = 0; // each visit to a page starts at its top
    artboardId = id;
    const base = fitForKind({
      kind: rect.kind,
      art: { w: rect.w, h: rect.h },
      stage: stageSize(),
      bleedPx: rect.kind === 'print' ? bleedPxOf(deps.getWorld(), id) : 0,
      minScale: ZOOM_MIN,
      maxScale: ZOOM_MAX,
    });
    baseFit = base;
    scroll = Math.min(Math.max(0, scroll), base.maxScroll);
    const fit = scrolled(base, scroll);
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
    if (announce) {
      const session = deps.onMove?.({ index, total, artboardId: id }) ?? null;
      reportPresentPosition(deps.win, { index, total, artboardId: id, ...(session ?? {}) });
      deps.media?.arrive(id);
    }
  };

  const go = (to: number | 'next' | 'prev', local = false) => {
    if (!active || exiting) return;
    const n = currentRun().run.length;
    if (n === 0) return;
    const target = to === 'next' ? index + 1 : to === 'prev' ? index - 1 : Math.trunc(to);
    if (!Number.isFinite(target)) return;
    const clamped = Math.min(Math.max(0, target), n - 1);
    if (clamped === index && artboardId !== null) return; // the end (or the start): nothing to move to
    show(clamped, 'cut', true);
    if (local) deps.onLocalStep?.();
  };

  const applyCursor = () => {
    const host = deps.getHost();
    if (host) host.style.cursor = active && locked ? 'none' : '';
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
    if (locked) {
      // The audience window takes no keys at all — the presenter's Mac drives it.
      consume(e);
      return;
    }
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
    if (!e.repeat) go(to, true);
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
      if (locked) return;
      if (m.button === 0 && !m.metaKey && !m.ctrlKey && !m.altKey && !m.shiftKey) {
        // A click on a playing clip pauses it; on anything else it moves on.
        if (!deps.media?.click()) go('next', true);
      }
    };
    // S3.3 — the trackpad scrolls a web artboard inside the stage (never the canvas camera). A pinch
    // (ctrl + wheel), a sideways swipe and every other kind do nothing.
    const onWheel = (e: Event) => {
      if (!own(e)) return;
      consume(e);
      const w = e as WheelEvent;
      if (locked || w.ctrlKey || w.metaKey || !baseFit || baseFit.maxScroll <= 0 || exiting) return;
      const unit = w.deltaMode === 1 ? 16 : w.deltaMode === 2 ? stageSize().h : 1;
      const dy = (Number(w.deltaY) || 0) * unit;
      if (!dy) return;
      const next = Math.min(baseFit.maxScroll, Math.max(0, scroll + dy / baseFit.scale));
      if (next === scroll) return;
      scroll = next;
      show(index, 'cut', false);
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
      'gesturestart',
      'gesturechange',
    ];
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('click', onClick, true);
    for (const t of swallow) win.addEventListener(t, eat, { capture: true, passive: false });
    win.addEventListener('wheel', onWheel, { capture: true, passive: false });
    win.addEventListener('resize', onResize);
    detach = () => {
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('click', onClick, true);
      for (const t of swallow) win.removeEventListener(t, eat, true);
      win.removeEventListener('wheel', onWheel, true);
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
    start(from, only) {
      if (active) return;
      deckIds =
        only === 'formats' && from && from !== 'start' ? (deps.formatIds?.(from) ?? null) : null;
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
      scroll = 0;
      deps.media?.start();
      // The audience sees no selection halo: clear it now, restore it on the way out.
      if (sel && saved.selection.length > 0) sel.clear();
      attach();
      applyCursor();
      const r = currentRun();
      show(startIndex(r, from), 'lift', true);
    },

    stop() {
      if (!active) return;
      active = false;
      deckIds = null;
      detach?.();
      detach = null;
      applyCursor();
      deps.media?.stop();
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

    goTo(id, at) {
      if (!active || exiting) return;
      const run = currentRun().run;
      if (run.length === 0) return;
      let i = run.indexOf(id);
      if (i < 0)
        i = Math.min(Math.max(0, Math.trunc(Number.isFinite(at) ? at : 0)), run.length - 1);
      if (i === index && artboardId === run[i]) return;
      show(i, 'cut', true);
    },

    deck: () => deckIds,

    setLocked(next) {
      locked = !!next;
      applyCursor();
    },

    dispose() {
      if (active) {
        active = false;
        detach?.();
        detach = null;
        deps.media?.stop();
        const sel = deps.getSelection();
        if (sel && saved && saved.selection.length > 0) sel.replace(saved.selection as never);
        exiting = true;
      }
      if (exiting) finishExit();
      cancelTween();
      removeMask();
      applyCursor();
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

/** video-comp.tsx's registry entry, as far as the engine reads it. */
type ClipLike = ClipRef;

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
  const presenting = !!snap && snap.mode === 'present';
  const active = presenting && snap?.present?.kind === 'artboards';
  const from = snap?.present?.from;
  const only = snap?.present?.only ?? null;
  const stepN = snap?.step?.n ?? 0;
  const stepTo = snap?.step?.to;
  // S3.7a — publish the position on awareness only while the shell grants it (caps.present).
  const broadcast = active && snap?.caps?.present === true;
  const follow = active ? (snap?.follow ?? null) : null;

  const collab = useCollab();
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const broadcastRef = useRef(broadcast);
  broadcastRef.current = broadcast;
  /** The running presentation session (new per Present start), while broadcasting. */
  const sessionRef = useRef<{ sid: string; seq: number } | null>(null);
  /** The follower loop (S3.7a), while following. */
  const followRef = useRef<{ moved(): void; localStep(): void } | null>(null);

  const engineRef = useRef<PresentStage | null>(null);
  if (!engineRef.current && win) {
    engineRef.current = createPresentStage({
      win,
      getHost: () => optsRef.current.hostRef.current,
      getWorld: () => optsRef.current.worldRef.current,
      getArtboards: () => liveRects(optsRef.current.artboards, optsRef.current.worldRef.current),
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
      onMove: (pos) => {
        followRef.current?.moved();
        if (!broadcastRef.current) return null;
        let s = sessionRef.current;
        if (s) s.seq += 1;
        else {
          s = { sid: newPresentSid(), seq: 0 };
          sessionRef.current = s;
        }
        collabRef.current?.publishAwareness({
          present: { v: 1, sid: s.sid, ...pos, seq: s.seq, media: null },
        });
        return { sid: s.sid, seq: s.seq };
      },
      onLocalStep: () => followRef.current?.localStep(),
      // S7.19 — the video artboards that mount the same component are one deck (`video/link-groups.ts`)
      formatIds: (id) => {
        const reg = (
          win as unknown as {
            __maudeVideoComps?: Map<string, { artboardId: string | null; component?: unknown }>;
          }
        ).__maudeVideoComps;
        if (!reg) return null;
        const items: Array<{ id: string; comp: unknown }> = [];
        for (const e of reg.values())
          if (e.artboardId) items.push({ id: e.artboardId, comp: e.component });
        return formatIdsOf(items, id);
      },
      media: createPresentMedia({
        win,
        clips: () => {
          const reg = (win as unknown as { __maudeVideoComps?: Map<string, ClipLike> })
            .__maudeVideoComps;
          return reg ? ([...reg.values()] as unknown as ClipRef[]) : [];
        },
        post: (msg) => {
          if (win.parent === win) return;
          try {
            win.parent.postMessage(msg, '*');
          } catch {
            /* detached */
          }
        },
        setTimer: (fn, ms) => win.setTimeout(fn, ms),
        clearTimer: (h) => win.clearTimeout(h),
        watch: (id, onFail) => watchArtboardMedia(win.document, id, onFail),
      }),
    });
  }

  // S3.14 (G2) - the audience sees the work only. A layout effect, so the chrome is gone before the stage's
  // effect below measures the artboards it is about to lift.
  useLayoutEffect(() => {
    if (!presenting || !win) return;
    const root = win.document.documentElement;
    root.setAttribute(PRESENT_ATTR, '');
    return () => root.removeAttribute(PRESENT_ATTR);
  }, [presenting, win]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `from` is read once, at the start
  useEffect(() => {
    const engine = engineRef.current;
    if (!active || !engine) return;
    engine.start(from, only);
    return () => engine.stop();
  }, [active]);

  const seenStep = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one step per `n`
  useEffect(() => {
    if (!active || stepN === 0 || stepN === seenStep.current || stepTo === undefined) return;
    seenStep.current = stepN;
    engineRef.current?.step(stepTo);
  }, [active, stepN]);

  // S3.7a — stop broadcasting (Present ended, a role clamp took caps.present away): clear the field so
  // followers see "ended", and start a new session next time.
  useEffect(() => {
    if (broadcast || !sessionRef.current) return;
    sessionRef.current = null;
    collabRef.current?.publishAwareness({ present: null });
  }, [broadcast]);

  // S3.7a — a closing page clears its position at once (the throttled publish would not flush).
  useEffect(() => {
    if (!win) return;
    const onHide = () => {
      if (!sessionRef.current) return;
      sessionRef.current = null;
      collabRef.current?.publishAwareness({ present: null });
      try {
        collabRef.current?.awareness.setLocalStateField('present', null);
      } catch {
        /* no awareness */
      }
    };
    win.addEventListener('pagehide', onHide);
    return () => win.removeEventListener('pagehide', onHide);
  }, [win]);

  usePresentFollow(win, engineRef, followRef, follow, collab);

  // The artboards (a drag, an HMR, a peer's order) moved under a running stage.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on the artboard list only
  useEffect(() => {
    if (active) engineRef.current?.refresh();
  }, [opts.artboards]);

  // S3.6b — the presenter view's order map draws the run from the canvas's own layout: report it at
  // Present start and whenever the artboard list changes under a running stage.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the report follows the artboard list
  useEffect(() => {
    if (!active || !win) return;
    const world = optsRef.current.worldRef.current;
    // S7.19: a deck of formats (`only: 'formats'`) reports itself — the shell's format switch reads this list
    const deck = engineRef.current?.deck() ?? null;
    reportPresentRun(
      win,
      presentRunReport(
        deck ? opts.artboards.filter((a) => deck.includes(String(a.id))) : opts.artboards,
        (id) => artboardLabel(world, id)
      )
    );
  }, [active, opts.artboards]);

  // Unmount: declared after the start/stop effect, so its cleanup runs second and lands the exit at once.
  useEffect(() => () => engineRef.current?.dispose(), []);

  // S3.2b — the two small things Present · Canvas shares with this stage, mounted here so canvas-lib's
  // one mount point stays the only one: the presenter's Pointer (L) and the zoom the shell's pill shows.
  usePointerDot({ viewport: opts.controller.viewport });
  usePresentZoom(opts.controller.viewport.zoom);
}

// ─────────────────────────────────────────────────────────────────────────────
// S3.7a — follow mode (a follower canvas: `follow=1`, seeded by client/v2/present/follow-view.jsx)

type FollowSnap = { sid: string | null; live: boolean; locked: boolean; n: number } | null;

/**
 * Keep the stage on the presenter's artboard while Live; a local ← → (or a click) turns Live off and the
 * follower page offers Catch up (`present-follow {live: true}`). Reads foreign states only through the
 * trust boundary (`readForeignPeers` → `sanitizeForeignState`), publishes `watching`, and tells the
 * follower page what it shows (`present-follow-state`).
 */
function usePresentFollow(
  win: Window | null,
  engineRef: { current: PresentStage | null },
  followRef: { current: { moved(): void; localStep(): void } | null },
  follow: FollowSnap,
  collab: ReturnType<typeof useCollab>
): void {
  const following = !!follow && !!win;
  const wantSid = follow?.sid ?? null;
  const liveRef = useRef(true);
  const lockedRef = useRef(false);
  const tickRef = useRef<(() => void) | null>(null);
  const viewRef = useRef<FollowView | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one loop per (session, collab)
  useEffect(() => {
    if (!following || !win) return;
    const follower = createFollower(wantSid);
    let watching: string | null = null;
    const post = () => {
      const v = viewRef.current;
      const st = engineRef.current?.state();
      const t = v?.target ?? null;
      const clampInt = (n: number) => Math.min(2000, Math.max(0, Math.trunc(n) || 0));
      if (win.parent === win) return;
      try {
        win.parent.postMessage(
          {
            dgn: 'present-follow-state',
            live: liveRef.current,
            sid: v?.sid ?? null,
            presenterName: (v?.presenterName ?? '').slice(0, 64),
            presenterIndex: clampInt(t?.index ?? 0),
            index: clampInt(st?.index ?? 0),
            total: clampInt(t?.total ?? st?.total ?? 0),
            watchers: Math.min(100000, Math.max(0, v?.watchers ?? 0)),
            ended: !!v?.ended,
          },
          '*'
        );
      } catch {
        /* detached */
      }
    };
    const tick = () => {
      const peers = collab ? readForeignPeers(collab.awareness) : [];
      const v = follower.update(peers);
      viewRef.current = v;
      if (v.sid !== watching) {
        watching = v.sid;
        collab?.publishAwareness({ watching });
      }
      const t = v.target;
      // goTo announces a move, which posts the state itself; post here only when nothing moved.
      const before = engineRef.current?.state().artboardId;
      if (liveRef.current && t) engineRef.current?.goTo(t.artboardId, t.index);
      if (engineRef.current?.state().artboardId === before) post();
    };
    tickRef.current = tick;
    followRef.current = {
      moved: () => post(),
      localStep: () => {
        if (!liveRef.current) return;
        liveRef.current = false;
        post();
      },
    };
    const aw = collab?.awareness;
    const onChange = (changes?: AwarenessChanges) => {
      if (aw && !touchesForeignClient(changes, aw.clientID)) return;
      tick();
    };
    aw?.on('change', onChange);
    tick();
    return () => {
      aw?.off('change', onChange);
      tickRef.current = null;
      followRef.current = null;
      viewRef.current = null;
      if (watching !== null) collab?.publishAwareness({ watching: null });
    };
  }, [following, wantSid, collab]);

  // Each `present-follow` (n counts them): live / locked as the follower page says; Catch up rejoins.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one apply per `n`
  useEffect(() => {
    if (!follow) {
      if (lockedRef.current) engineRef.current?.setLocked(false);
      lockedRef.current = false;
      liveRef.current = true;
      return;
    }
    liveRef.current = follow.live;
    lockedRef.current = follow.locked;
    engineRef.current?.setLocked(follow.locked);
    tickRef.current?.();
  }, [follow?.n, following]);
}

/**
 * S3.14 (G2) - Present clears the selection (the audience sees no halo) and puts it back on the way out ("selection,
 * zoom and panels are as you left them", 04 md-present-lift). Mounted by canvas-shell's `CanvasCore`, the one place
 * the selection set is in scope: `usePresentStage` sits ABOVE the provider in canvas-lib (`DesignCanvasInner` renders
 * `CanvasShell`), so the `selection` it is handed is null in a real canvas and its own clear/restore never ran.
 * Covers Present · Canvas too, which has no stage. `annot` is the annotation selection (a `clear()` only).
 */
export function usePresentSelection(
  sel: { selected: readonly unknown[]; clear(): void; replace(s: never): void },
  annot: { clear(): void }
): void {
  const win = typeof window === 'undefined' ? null : window;
  const store = win ? canvasModeStore(win) : null;
  const snap = useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.get : NO_SNAPSHOT,
    NO_SNAPSHOT
  );
  const presenting = !!snap && snap.mode === 'present';
  const selRef = useRef(sel);
  selRef.current = sel;
  const annotRef = useRef(annot);
  annotRef.current = annot;
  useEffect(() => {
    if (!presenting) return;
    const saved = [...selRef.current.selected];
    selRef.current.clear();
    annotRef.current.clear();
    return () => {
      if (saved.length > 0) selRef.current.replace(saved as never);
    };
  }, [presenting]);
}
