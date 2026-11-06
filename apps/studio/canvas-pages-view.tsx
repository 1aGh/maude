// The canvas half of Canvas | Pages (2.0.7 B2, decision `v2-207-pages-view`) — the store and the pure rules are in
// canvas-pages.ts.
//
//   usePagesView      mounted once by CanvasCore (canvas-shell.tsx): keeps the page order current, leaves the one
//                     page in sight (a CSS rule keyed on `html[data-maude-pages]`), puts the camera on it (again on
//                     a resize or when the shell's panels move), hears PageDown / PageUp (and → / ← with nothing
//                     selected) through the registry, and tells the shell `pages-view` — again on every `set-mode`
//                     seed, so a newly active canvas is never mistaken for the last one.
//   CanvasPagesSwitch the pill's Canvas | Pages and, in Pages, ‹ n / N › — also on the Design system canvas's bar
//                     (ds/board/ds-bar.tsx, `variant="ds"`; decision `v2-207-pages-on-ds-canvas`).
//   runPagesAction    the shell's `run-action` lane: `view.pages`, `pages.next`, `pages.prev` — and, while Pages
//                     shows, `view.zoom-to-artboard` turns to that artboard's page (`turnToPage`).
//
// A pick in the left panel (or a selection made anywhere) of an artboard Pages has out of sight turns to its page
// (decision `v2-207-pages-pick-turns-page`): the jump selects the artboard and frames it, and before 2.0.7 polish
// the camera and the selection box went to a hidden artboard — an empty frame.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { canvasInsets, canvasModeStore } from './bridge/canvas-mode-store.ts';
import type { ArtboardRect, ViewportControllerHandle } from './canvas-lib.tsx';
import {
  getCanvasView,
  getPageChosen,
  getPagesState,
  PAGES_ATTR,
  PAGES_STYLE_ID,
  pageCamera,
  pageCounter,
  pagesApply,
  pagesHideCss,
  pagesOrder,
  setCanvasView,
  setPageAt,
  setPagesOrder,
  stepPage,
  subscribeCanvasView,
  useCanvasView,
  usePagePosition,
} from './canvas-pages.ts';
import type { PresentMeta } from './present/order.ts';
import { useCanvasKeys } from './use-canvas-keys.ts';

type Camera = { x: number; y: number; zoom: number };

const modeStore = () => (typeof window === 'undefined' ? null : canvasModeStore(window));
const noSub = () => () => {};

/** The shell's mode for this canvas (null on a free canvas), live. */
function useShellMode(): string | null {
  const s = modeStore();
  return useSyncExternalStore(
    s ? s.subscribe : noSub,
    () => s?.get().mode ?? null,
    () => null
  );
}

/** The occluded insets' sequence, live — the panels moved, the page refits. */
function useInsetsSeq(): number {
  const s = modeStore();
  return useSyncExternalStore(
    s ? s.subscribe : noSub,
    () => s?.get().insetsSeq ?? -1,
    () => -1
  );
}

const pageAtNow = () => getPagesState().at;

/**
 * `pages-view` to the studio (bridge/dgn-protocol.ts — active canvas only): on, which page of how many, and the
 * artboard on it (`id`, only while on — the left panel marks it). Nothing outside the studio window.
 */
function tellShell(r: { on: boolean; index: number; total: number; id: string | null }): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage(
      {
        dgn: 'pages-view',
        v: 1,
        on: r.on,
        index: r.index,
        total: r.total,
        ...(r.on && r.id ? { id: r.id } : {}),
      },
      '*'
    );
  } catch {
    /* detached */
  }
}

/** Is Pages showing on this canvas right now? (The pill and the rule both ask.) */
export function usePagesShowing(here: boolean): boolean {
  const view = useCanvasView();
  const mode = useShellMode();
  return here && view === 'pages' && pagesApply(mode);
}

/** May the switch be offered here? (Edit or Viewing in the studio window — not Preview, Present, a capture.) */
export function usePagesAvailable(): boolean {
  return pagesApply(useShellMode());
}

/** What the mounted canvas's Pages is doing, for the shell's lanes (one canvas per frame). */
const live: { on: boolean; fit: (() => void) | null } = { on: false, fit: null };

/**
 * Turn to artboard `id`'s page when Pages shows and has it; already on it, put the camera back on the page.
 * True when Pages took it (the caller then leaves the camera alone).
 */
export function turnToPage(id: unknown): boolean {
  if (!live.on || typeof id !== 'string' || !id) return false;
  const { order, at } = getPagesState();
  if (!order.includes(id)) return false;
  if (at === id) live.fit?.();
  else setPageAt(id);
  return true;
}

/**
 * A pick (`select-by-id`: Layers, the Canvases tab, the AI, a restore) of artboard `id` while Pages shows: turn to its
 * page when another one is showing (decision `v2-207-pages-stale-selection` — keyed on the pick, never on a change
 * of the selected artboard, so the artboard that was selected before a page step turns back too). True when the
 * page turned (the page's own camera follows; the caller leaves the camera alone). On its page already → false, and
 * the pick reveals inside the page as always.
 */
export function pickTurnsPage(id: unknown): boolean {
  if (!live.on || typeof id !== 'string' || !id) return false;
  const { order, at } = getPagesState();
  if (at === id || !order.includes(id)) return false;
  setPageAt(id);
  return true;
}

/** Tests only: leave the selection behind on a page turn, so a pick can be shown to turn back on its own. */
let dropOff = false;
export function __pagesDropOff(off: boolean): void {
  dropOff = off;
}

function presentMeta(): PresentMeta | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __canvas_meta__?: { present?: PresentMeta } }).__canvas_meta__
    ?.present;
}

function ensureStyle(css: string | null): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(PAGES_STYLE_ID) as HTMLStyleElement | null;
  if (css === null) {
    el?.remove();
    document.documentElement.removeAttribute(PAGES_ATTR);
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = PAGES_STYLE_ID;
    (document.head ?? document.documentElement).appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
  document.documentElement.setAttribute(PAGES_ATTR, '');
}

export interface UsePagesViewOptions {
  controller: ViewportControllerHandle | null;
  artboards: readonly ArtboardRect[];
  /** The selected artboard (or the one the selection is in) — where Pages opens; else the first page. */
  selectedArtboard: () => string | null;
  hostRef: { current: HTMLElement | null };
  /** May Pages show on this canvas at all? (Not on the Design system canvas, an embed, a follower.) */
  here: boolean;
  /** What the canvas has selected, for the → / ← aliases (a selection's arrows nudge it). */
  selectionNone: () => boolean;
  /**
   * The page showing is now `page`: drop whatever is selected on another artboard (decision
   * `v2-207-pages-stale-selection`). Called synchronously on every page turn while Pages shows — keys, ‹ ›, a
   * script, run-action, a left-panel jump, a layout change — so it must read the selection as of now, not a render.
   */
  dropOffPage?: (page: string) => void;
}

export function usePagesView(opts: UsePagesViewOptions): boolean {
  const { controller, artboards, hostRef, here } = opts;
  const selArt = useRef(opts.selectedArtboard);
  selArt.current = opts.selectedArtboard;
  const on = usePagesShowing(here);
  live.on = on;
  useEffect(
    () => () => {
      live.on = false;
    },
    []
  );
  const at = useSyncExternalStore(subscribeCanvasView, pageAtNow, pageAtNow);
  const insetsSeq = useInsetsSeq();
  const ctlRef = useRef(controller);
  ctlRef.current = controller;
  /** The camera Canvas had when Pages came on (in this session), put back when it goes off. */
  const savedCam = useRef<Camera | null>(null);

  // the order, from the live layout and the Present order
  const orderKey = artboards.map((r) => `${r.id}:${r.x}:${r.y}:${r.w}:${r.h}`).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: orderKey is the layout's identity
  useEffect(() => {
    setPagesOrder(pagesOrder(artboards, presentMeta()));
  }, [orderKey]);

  // Pages comes on: open on the selected artboard (else where this session left off, else the first page), and keep
  // the Canvas camera to put back
  const wasOn = useRef(false);
  useEffect(() => {
    if (on && !wasOn.current) {
      const { order } = getPagesState();
      const picked = selArt.current();
      if (picked && order.includes(picked)) setPageAt(picked);
      else if (!order.includes(getPageChosen() ?? '')) setPageAt(null);
      const c = ctlRef.current?.viewport;
      savedCam.current = c ? { x: c.x, y: c.y, zoom: c.zoom } : null;
    }
    if (!on && wasOn.current) {
      const ctl = ctlRef.current;
      if (ctl) {
        if (savedCam.current) ctl.setViewport(savedCam.current);
        else ctl.fit();
      }
      savedCam.current = null;
    }
    wasOn.current = on;
  }, [on]);

  // a selection made on another artboard (a left-panel pick, Layers, the AI) turns to its page: Pages never leaves
  // the selection — or the camera the jump moves — on an artboard it hides
  const selNow = opts.selectedArtboard();
  useEffect(() => {
    if (!on || !selNow) return;
    const { order, at: showing } = getPagesState();
    if (selNow !== showing && order.includes(selNow)) setPageAt(selNow);
  }, [on, selNow]);

  // …and the other way round (decision `v2-207-pages-stale-selection`): a page turn by ANY route drops what is
  // selected on the artboard it leaves — no outline on empty canvas, no Inspector naming a hidden artboard. What a
  // real mouse click on › already did (that click lands on the canvas and clears); keys, a script click, run-action
  // and a left-panel jump did not. Synchronous, in the store's own listener, so a pick that turns the page (it
  // selected first) is read as it is now and kept.
  const dropRef = useRef(opts.dropOffPage);
  dropRef.current = opts.dropOffPage;
  useEffect(() => {
    let last = getPagesState().at;
    return subscribeCanvasView(() => {
      const now = getPagesState().at;
      if (now === last) return;
      last = now;
      if (live.on && now && !dropOff) dropRef.current?.(now);
    });
  }, []);
  useEffect(() => {
    // Pages coming on opens on the selected artboard; anything else selected (a multi-selection) is off the page
    const showing = getPagesState().at;
    if (on && showing && !dropOff) dropRef.current?.(showing);
  }, [on]);

  // the rule that leaves the one page
  useEffect(() => {
    ensureStyle(on && at ? pagesHideCss(at) : null);
    return () => ensureStyle(null);
  }, [on, at]);

  // the camera on the page — again when the host resizes or the shell's panels move
  const rect = at ? artboards.find((r) => r.id === at) : undefined;
  const rectKey = rect ? `${rect.x}:${rect.y}:${rect.w}:${rect.h}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: rectKey + insetsSeq are the fit's inputs
  useEffect(() => {
    if (!on || !rect) return undefined;
    const host = hostRef.current;
    const fit = () => {
      const ctl = ctlRef.current;
      if (!ctl || !host) return;
      ctl.setViewport(
        pageCamera(rect, { w: host.clientWidth, h: host.clientHeight }, canvasInsets())
      );
    };
    fit();
    live.fit = fit;
    const unfit = () => {
      if (live.fit === fit) live.fit = null;
    };
    if (!host || typeof ResizeObserver === 'undefined') return unfit;
    const ro = new ResizeObserver(() => fit());
    ro.observe(host);
    return () => {
      ro.disconnect();
      unfit();
    };
  }, [on, at, rectKey, insetsSeq]);

  // tell the shell (Preview and Present are off while Pages is on) — and again when it seeds this canvas
  const pos = usePagePosition();
  const index = pos?.index ?? 0;
  const total = pos?.total ?? 0;
  const id = pos ? at : null;
  const report = useRef({ on, index, total, id });
  report.current = { on, index, total, id };
  useEffect(() => {
    tellShell({ on, index, total, id });
  }, [on, index, total, id]);
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return undefined;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      if ((e.data as { dgn?: unknown } | null)?.dgn !== 'set-mode') return;
      tellShell(report.current);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // the paging keys, from the registry (PageDown / PageUp; → / ← with nothing selected)
  const selNone = useRef(opts.selectionNone);
  selNone.current = opts.selectionNone;
  useCanvasKeys(
    {
      'pages.next': (e) => {
        if (getCanvasView() !== 'pages') return;
        e.preventDefault();
        stepPage('next');
      },
      'pages.prev': (e) => {
        if (getCanvasView() !== 'pages') return;
        e.preventDefault();
        stepPage('prev');
      },
    },
    { selection: () => (selNone.current() ? 'none' : 'object') }
  );

  return on;
}

/**
 * The shell's `run-action` for Pages. True when the id was one of these (handled, or ignored in Preview/Present).
 * `view.zoom-to-artboard` is Pages' only while it shows and has the artboard (it turns the page); else false, and the
 * caller frames the artboard as always.
 */
export function runPagesAction(id: unknown, params?: { id?: unknown }): boolean {
  if (id === 'view.zoom-to-artboard') return turnToPage(params?.id);
  if (id === 'view.pages') {
    if (!pagesApply(modeStore()?.get().mode ?? null)) return true;
    setCanvasView(getCanvasView() === 'pages' ? 'canvas' : 'pages');
    return true;
  }
  if (id === 'pages.next' || id === 'pages.prev') {
    stepPage(id === 'pages.next' ? 'next' : 'prev');
    return true;
  }
  return false;
}

const SEG_WORD = { canvas: 'Canvas', pages: 'Pages' } as const;
const SEG_TITLE = {
  canvas: 'The whole canvas',
  pages: 'One artboard at a time',
} as const;

/** The two homes of the switch: the canvas pill (canvas-theme-pill.tsx) and the Design system bar (ds-bar.tsx). */
const SEG_CLASS = {
  pill: { seg: 'dc-theme-pill-seg', b: 'dc-theme-pill-b' },
  ds: { seg: 'ds-bar-seg', b: 'ds-bar-b' },
} as const;

/**
 * Canvas | Pages, and in Pages ‹ n / N ›, drawn in its host's own classes: the canvas pill's, or the Design system
 * bar's (`variant="ds"`, which also brings the pager's chrome and steps aside where Pages cannot show — the pill
 * itself is gone there).
 */
export function CanvasPagesSwitch({ variant = 'pill' }: { variant?: 'pill' | 'ds' } = {}) {
  const view = useCanvasView();
  const pos = usePagePosition();
  const available = usePagesAvailable();
  const pages = view === 'pages';
  const cls = SEG_CLASS[variant];
  if (variant === 'ds' && !available) return null;
  return (
    <>
      {variant === 'ds' ? <style data-dc-pages-css="">{PAGES_PILL_CSS}</style> : null}
      <fieldset className={cls.seg} aria-label="Show the canvas as" data-testid="canvas-view">
        {(['canvas', 'pages'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={cls.b}
            data-testid={`canvas-view-${v}`}
            aria-pressed={view === v}
            title={SEG_TITLE[v]}
            onClick={() => setCanvasView(v)}
          >
            {SEG_WORD[v]}
          </button>
        ))}
      </fieldset>
      {pages && pos ? (
        // biome-ignore lint/a11y/useSemanticElements: a pager group of buttons, not a form
        <span
          className="dc-pages-nav"
          role="group"
          aria-label="Pages"
          data-testid="canvas-pages-nav"
        >
          <button
            type="button"
            className="dc-pages-b"
            data-testid="canvas-pages-prev"
            aria-label="Previous page"
            title="Previous page (PageUp)"
            aria-keyshortcuts="PageUp"
            disabled={pos ? pos.index === 0 : true}
            onClick={() => stepPage('prev')}
          >
            <Chevron dir="prev" />
          </button>
          <span className="dc-pages-count" data-testid="canvas-pages-count" aria-live="polite">
            {pageCounter(pos.index, pos.total)}
          </span>
          <button
            type="button"
            className="dc-pages-b"
            data-testid="canvas-pages-next"
            aria-label="Next page"
            title="Next page (PageDown)"
            aria-keyshortcuts="PageDown"
            disabled={pos ? pos.index >= pos.total - 1 : true}
            onClick={() => stepPage('next')}
          >
            <Chevron dir="next" />
          </button>
        </span>
      ) : null}
    </>
  );
}

function Chevron({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <polyline
        points={dir === 'prev' ? '10 3.5 5.5 8 10 12.5' : '6 3.5 10.5 8 6 12.5'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The pager's chrome, beside the pill's own (canvas-theme-pill.tsx `PILL_CSS`). */
export const PAGES_PILL_CSS = `
.dc-pages-nav{display:inline-flex;align-items:center;gap:2px;margin-left:4px}
.dc-pages-b{appearance:none;display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:var(--maude-hud-radius-md,10px);background:transparent;color:var(--maude-chrome-fg-1);cursor:pointer}
.dc-pages-b:hover:not(:disabled){background:var(--maude-chrome-bg-3);color:var(--maude-chrome-fg-0)}
.dc-pages-b:disabled{opacity:.4;cursor:default}
.dc-pages-b:focus-visible{outline:2px solid var(--maude-hud-focus-ring);outline-offset:1px}
@media (max-width:1399px){html[data-maude-pages] .dc-theme-pill-path{display:none}}
.dc-pages-count{min-width:44px;text-align:center;font-variant-numeric:tabular-nums;font-size:var(--maude-hud-type-xs,11px);color:var(--maude-chrome-fg-0)}
`;
