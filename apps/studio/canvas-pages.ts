// The canvas's Canvas | Pages view (2.0.7 B2, decision `v2-207-pages-view`).
//
// Canvas is the infinite canvas. Pages shows ONE artboard at a time, filling the view, and pages through them in the
// canvas's order: the Present order when "Order and notes…" set one, else the layout order (rows, left to right —
// present/order.ts). Skipped artboards stay in: Pages is the designer's own view, not a presentation.
//
//   the switch  next to Light | Dark on the pill at the top of the canvas (canvas-theme-pill.tsx)
//   the pick    remembered per canvas, per Mac: `_canvas-state/<slug>.view.json` `canvasView` (DDR-115), never the
//               versioned `.meta.json`. It reaches the iframe as `window.__canvas_meta__.canvasView` on load, like
//               `canvasTheme` (canvas-theme.ts).
//   the page    which artboard is showing is this session's only (no write per step).
//   the shell   is told `pages-view` (bridge/dgn-protocol.ts) so Preview and Present are off while Pages is on;
//               the shell drives the frame only through `run-action` (`view.pages`, `pages.next`, `pages.prev`).
//
// Pages applies only to the designer's own view in the studio window: Edit or Viewing, framed by the studio, not an
// embed, a Present follower or a past version. A headless capture (exports, `maude design screenshot`) loads the
// canvas as the top document, so it always renders the whole canvas.
//
// The store lives on `globalThis` for the reason canvas-theme.ts gives: a soft HMR re-evaluation must agree.

import { useSyncExternalStore } from 'react';
import type { Insets } from './bridge/occlusion.ts';
import { type OrderRect, type PresentMeta, presentRun } from './present/order.ts';
import { isEmbedCanvas, isFollowCanvas, isHistoricalCanvas } from './read-only-mode.ts';

export type CanvasView = 'canvas' | 'pages';

interface Store {
  /** the pick made in this session; null = none (the saved one, else Canvas) */
  chosen: CanvasView | null;
  /** the artboard Pages shows, this session; null = the first */
  at: string | null;
  /** the artboards in page order, as the canvas last laid them out */
  order: string[];
  subs: Set<() => void>;
}

const KEY = '__maudeCanvasPages';

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  let s = g[KEY];
  if (!s) {
    s = { chosen: null, at: null, order: [], subs: new Set() };
    g[KEY] = s;
  }
  return s;
}

const emit = (): void => {
  for (const f of [...store().subs]) f();
};

interface MetaWindow {
  __canvas_meta__?: { canvasView?: unknown; present?: PresentMeta };
  __canvas_meta_file__?: string;
  __maude_last_meta_self_write_at?: number;
}

const isView = (v: unknown): v is CanvasView => v === 'canvas' || v === 'pages';

function savedView(): CanvasView | null {
  if (typeof window === 'undefined') return null;
  const v = (window as unknown as MetaWindow).__canvas_meta__?.canvasView;
  return isView(v) ? v : null;
}

/** The view this canvas is set to: this session's pick, else the saved one, else Canvas. */
export function getCanvasView(): CanvasView {
  return store().chosen ?? savedView() ?? 'canvas';
}

/** Remember the pick for this canvas on this Mac (best-effort, like the camera and the Light | Dark pick). */
function persist(view: CanvasView): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
  if (!persistsView()) return;
  const w = window as unknown as MetaWindow;
  const file = typeof w.__canvas_meta_file__ === 'string' ? w.__canvas_meta_file__ : null;
  if (!file) return;
  // keep the page-load snapshot current, so a soft remount reads the pick back (DDR-138)
  if (w.__canvas_meta__ && typeof w.__canvas_meta__ === 'object')
    w.__canvas_meta__.canvasView = view;
  w.__maude_last_meta_self_write_at = Date.now();
  fetch('/_api/canvas-meta', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, patch: { canvasView: view } }),
  }).catch((err) => {
    console.warn('[canvas-pages] persist failed:', err);
  });
}

/** An embed, a Present follower and a past version are not the designer's own view (read-only-mode.ts). */
function persistsView(): boolean {
  return !isEmbedCanvas() && !isFollowCanvas() && !isHistoricalCanvas();
}

/** Switch the canvas to `view`. `persist: false` shows it without remembering it. */
export function setCanvasView(view: CanvasView, opts: { persist?: boolean } = {}): void {
  if (!isView(view)) return;
  const s = store();
  const changed = getCanvasView() !== view;
  s.chosen = view;
  if (opts.persist !== false && changed) persist(view);
  if (changed) emit();
}

export function subscribeCanvasView(f: () => void): () => void {
  const subs = store().subs;
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export const useCanvasView = (): CanvasView =>
  useSyncExternalStore(subscribeCanvasView, getCanvasView, getCanvasView);

// ── the page order ─────────────────────────────────────────────────────────────────────────────

/** Every artboard in page order: the Present order (when set) over the layout order. Skipped ones stay in. */
export function pagesOrder(
  rects: readonly OrderRect[],
  present: PresentMeta | null | undefined
): string[] {
  const order =
    present && typeof present === 'object' && !Array.isArray(present) ? present.order : undefined;
  return presentRun(rects, { order }).run;
}

/** Where `at` sits in `order` (an id the canvas no longer has is the first page). */
export function pageIndex(order: readonly string[], at: string | null | undefined): number {
  if (!at) return 0;
  const i = order.indexOf(at);
  return i < 0 ? 0 : i;
}

/** The page after / before `at`, held at the ends (no wrap: the counter says where you are). */
export function pageStep(
  order: readonly string[],
  at: string | null | undefined,
  dir: 'next' | 'prev'
): string | null {
  if (order.length === 0) return null;
  const i = pageIndex(order, at);
  const j = dir === 'next' ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1);
  return order[j];
}

/** What the counter says: `{ index, total, id }` (index 0-based), or null with no artboard. */
export function pagePosition(
  order: readonly string[],
  at: string | null | undefined
): { index: number; total: number; id: string } | null {
  if (order.length === 0) return null;
  const index = pageIndex(order, at);
  return { index, total: order.length, id: order[index] };
}

/** The live order and the page showing, as the canvas laid them out last (the pill and the keys read it). */
export function getPagesState(): { order: readonly string[]; at: string | null } {
  const s = store();
  return { order: s.order, at: s.order.length ? s.order[pageIndex(s.order, s.at)] : null };
}

/** The artboard this session asked Pages to show (null = none yet; may name one the canvas no longer has). */
export const getPageChosen = (): string | null => store().at;

/** The canvas reports its order (called by usePagesView on every layout change). */
export function setPagesOrder(order: readonly string[]): void {
  const s = store();
  if (s.order.length === order.length && s.order.every((id, i) => id === order[i])) return;
  s.order = [...order];
  emit();
}

/** Show artboard `id` (when Pages has it). */
export function setPageAt(id: string | null): void {
  const s = store();
  if (s.at === id) return;
  s.at = id;
  emit();
}

/** Next / Previous page. Returns true when Pages is on and there was somewhere to go. */
export function stepPage(dir: 'next' | 'prev'): boolean {
  if (getCanvasView() !== 'pages') return false;
  const { order, at } = getPagesState();
  const to = pageStep(order, at, dir);
  if (!to || to === at) return false;
  setPageAt(to);
  return true;
}

/** The pill's counter and buttons re-read on any change. */
let snapCache: { key: string; value: { index: number; total: number } | null } = {
  key: '',
  value: null,
};
function pageSnapshot(): { index: number; total: number } | null {
  const { order, at } = getPagesState();
  const p = pagePosition(order, at);
  const key = p ? `${p.index}/${p.total}` : '';
  if (snapCache.key !== key)
    snapCache = { key, value: p ? { index: p.index, total: p.total } : null };
  return snapCache.value;
}

export const usePagePosition = (): { index: number; total: number } | null =>
  useSyncExternalStore(subscribeCanvasView, pageSnapshot, pageSnapshot);

// ── where Pages applies ────────────────────────────────────────────────────────────────────────

/** Is this the studio window's own view of the canvas? A capture loads the canvas as the top document. */
export function framedByStudio(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.parent !== window;
  } catch {
    return false;
  }
}

/**
 * Does Pages show here? Only in Edit or Viewing (a free canvas has no shell mode: null), framed by the studio, and
 * not an embed, a Present follower or a past version.
 */
export function pagesApply(mode: string | null | undefined): boolean {
  if (mode && mode !== 'edit' && mode !== 'viewing') return false;
  return framedByStudio() && persistsView();
}

// ── the camera and the rule that leaves one artboard ───────────────────────────────────────────

/** The room the Light | Dark pill takes at the top of the canvas (16 px from the top, 44 px tall), plus a gap. */
export const PAGES_TOP_ROOM = 72;
/** The margin around the page on the other sides. */
export const PAGES_PAD = 32;
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4;

/**
 * The camera that shows `rect` whole, as large as fits, centred in the visible part of a `w × h` host (the shell's
 * floating panels occlude `insets`; the pill takes `top`). Pure.
 */
export function pageCamera(
  rect: { x: number; y: number; w: number; h: number },
  host: { w: number; h: number },
  insets: Readonly<Insets>,
  opts: { pad?: number; top?: number } = {}
): { x: number; y: number; zoom: number } {
  const pad = opts.pad ?? PAGES_PAD;
  const top = Math.max(insets.top, opts.top ?? PAGES_TOP_ROOM);
  if (!(rect.w > 0) || !(rect.h > 0) || !(host.w > 0) || !(host.h > 0))
    return { x: 0, y: 0, zoom: 1 };
  let left = insets.left + pad;
  let right = host.w - insets.right - pad;
  let up = top;
  let down = host.h - insets.bottom - pad;
  // the panels leave too little room: fill the host instead of a sliver
  if (right - left < 120) {
    left = pad;
    right = host.w - pad;
  }
  if (down - up < 120) {
    up = pad;
    down = host.h - pad;
  }
  const vw = Math.max(1, right - left);
  const vh = Math.max(1, down - up);
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(vw / rect.w, vh / rect.h)));
  return {
    x: left + (vw - rect.w * zoom) / 2 - rect.x * zoom,
    y: up + (vh - rect.h * zoom) / 2 - rect.y * zoom,
    zoom,
  };
}

/** The attribute the rule keys on while Pages shows. */
export const PAGES_ATTR = 'data-maude-pages';
/** The style element that holds the rule. */
export const PAGES_STYLE_ID = 'dc-pages-css';

/** A CSS string literal for an artboard id (the id is the canvas's own, but never trusted as CSS). */
const cssString = (s: string): string =>
  `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r\f]/g, ' ')}"`;

/**
 * Every artboard but `id` steps out of sight and out of reach. Off during a capture (`#maude-capture-chrome`,
 * exporters/capture-chrome.ts), so an in-window export still sees every artboard.
 */
export function pagesHideCss(id: string): string {
  return `html[${PAGES_ATTR}]:not(:has(#maude-capture-chrome)) .dc-canvas .dc-artboard:not([data-dc-screen=${cssString(id)}]){visibility:hidden !important;pointer-events:none !important}`;
}

/** The pill's "2 / 6". */
export const pageCounter = (index: number, total: number): string => `${index + 1} / ${total}`;

/** test seam */
export function __resetCanvasPages(): void {
  const s = store();
  s.chosen = null;
  s.at = null;
  s.order = [];
  snapCache = { key: '', value: null };
  emit();
}
