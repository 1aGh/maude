// The canvas half of Canvas | Pages (2.0.7 B2, decision `v2-207-pages-view`) — the store and the pure rules are in
// canvas-pages.ts.
//
//   usePagesView      mounted once by CanvasCore (canvas-shell.tsx): keeps the page order current, leaves the one
//                     page in sight (a CSS rule keyed on `html[data-maude-pages]`), puts the camera on it (again on
//                     a resize or when the shell's panels move), hears PageDown / PageUp (and → / ← with nothing
//                     selected) through the registry, and tells the shell `pages-view` — again on every `set-mode`
//                     seed, so a newly active canvas is never mistaken for the last one.
//   CanvasPagesSwitch the pill's Canvas | Pages and, in Pages, ‹ n / N ›.
//   runPagesAction    the shell's `run-action` lane: `view.pages`, `pages.next`, `pages.prev`.

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

/** `pages-view` to the studio (bridge/dgn-protocol.ts — active canvas only). Nothing outside the studio window. */
function tellShell(r: { on: boolean; index: number; total: number }): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage(
      { dgn: 'pages-view', v: 1, on: r.on, index: r.index, total: r.total },
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
}

export function usePagesView(opts: UsePagesViewOptions): boolean {
  const { controller, artboards, hostRef, here } = opts;
  const selArt = useRef(opts.selectedArtboard);
  selArt.current = opts.selectedArtboard;
  const on = usePagesShowing(here);
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
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => fit());
    ro.observe(host);
    return () => ro.disconnect();
  }, [on, at, rectKey, insetsSeq]);

  // tell the shell (Preview and Present are off while Pages is on) — and again when it seeds this canvas
  const pos = usePagePosition();
  const index = pos?.index ?? 0;
  const total = pos?.total ?? 0;
  const report = useRef({ on, index, total });
  report.current = { on, index, total };
  useEffect(() => {
    tellShell({ on, index, total });
  }, [on, index, total]);
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

/** The shell's `run-action` for Pages. True when the id was one of these (handled, or ignored in Preview/Present). */
export function runPagesAction(id: unknown): boolean {
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

/** The pill's Canvas | Pages, and in Pages ‹ n / N ›. Drawn in the pill's own classes (canvas-theme-pill.tsx). */
export function CanvasPagesSwitch() {
  const view = useCanvasView();
  const pos = usePagePosition();
  const pages = view === 'pages';
  return (
    <>
      <fieldset
        className="dc-theme-pill-seg"
        aria-label="Show the canvas as"
        data-testid="canvas-view"
      >
        {(['canvas', 'pages'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="dc-theme-pill-b"
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
@media (max-width:1399px){html[data-maude-pages] .dc-theme-pill-path,html[data-maude-pages] .dc-theme-pill-note{display:none}}
.dc-pages-count{min-width:44px;text-align:center;font-variant-numeric:tabular-nums;font-size:var(--maude-hud-type-xs,11px);color:var(--maude-chrome-fg-0)}
`;
