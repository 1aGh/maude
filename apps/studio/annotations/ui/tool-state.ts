/**
 * @file       annotations/ui/tool-state.ts — the annotation tools' draw-time state (S4.8)
 * @scope      apps/studio/annotations/ui/tool-state.ts
 * @purpose    Colour, ink, thickness, Marker tip and the Highlighter's hue and nib used to be React
 *             state inside `annotations-layer.tsx`, set from the dark swatch tray (`AnnotationsChrome`)
 *             that stacked above the toolbar. They live here now so the toolbar's popovers
 *             (tool-palette.tsx) and the layer read ONE store, and so the shell can hand the same
 *             values to the next canvas that opens.
 *
 *             Per person (Q8): changes go to the shell (`annotation-prefs-set`, active canvas only),
 *             which writes `~/.config/maude/prefs.json` (`annotationPrefs`) — or `localStorage` in a
 *             cloud tab — and hands them to every canvas frame (`annotation-prefs`, parent only).
 *             The canvas origin has no prefs route (DDR-054), and iframe storage is lost in WKWebView.
 *
 *             `hydrate` never overrides a field this page's person already changed: a late disk read
 *             must not undo the click that happened first.
 *
 *             Also here, because it is the same "which tool may touch what" knowledge: the Eraser's
 *             scope. It rubs out Marker strokes and nothing else — never a sticky, a shape, text.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { type Stroke, strokeHitTest } from '../../annotations-model.ts';
import { acceptFromShell } from '../../bridge/dgn-protocol.ts';
import { rememberMarkerTip } from '../../toolbars/marker-tip.ts';
import {
  ANNOTATION_PREF_KEYS,
  type AnnotationPrefs,
  DEFAULT_ANNOTATION_PREFS,
  sanitizeAnnotationPrefs,
} from './tool-prefs.ts';

export type ToolSnapshot = Readonly<Required<AnnotationPrefs>>;

export interface ToolStateStore {
  get(): ToolSnapshot;
  subscribe(fn: () => void): () => void;
  /** A change made in this page: applied, remembered for this session, and persisted. */
  set(patch: AnnotationPrefs): boolean;
  /** The person's prefs as the shell read them: applied to every field not already changed here. */
  hydrate(prefs: unknown): boolean;
}

export function createToolState(
  opts: { persist?: (patch: AnnotationPrefs) => void } = {}
): ToolStateStore {
  let snap: ToolSnapshot = DEFAULT_ANNOTATION_PREFS;
  const touched = new Set<string>();
  const subs = new Set<() => void>();
  const notify = () => {
    for (const fn of subs) fn();
  };
  const apply = (clean: AnnotationPrefs): boolean => {
    let next: Required<AnnotationPrefs> | null = null;
    for (const k of ANNOTATION_PREF_KEYS) {
      const v = clean[k];
      if (v === undefined || v === snap[k]) continue;
      next ??= { ...snap };
      (next as Record<string, unknown>)[k] = v;
    }
    if (!next) return false;
    snap = Object.freeze(next);
    return true;
  };
  return {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    set(patch) {
      const clean = sanitizeAnnotationPrefs(patch);
      for (const k of Object.keys(clean)) touched.add(k);
      const changed = apply(clean);
      if (!changed) return false;
      try {
        opts.persist?.(clean);
      } catch {
        /* no shell to tell: the choice lasts for this page */
      }
      notify();
      return true;
    },
    hydrate(prefs) {
      const clean = sanitizeAnnotationPrefs(prefs);
      for (const k of touched) delete (clean as Record<string, unknown>)[k];
      if (!apply(clean)) return false;
      notify();
      return true;
    },
  };
}

const KEY = Symbol.for('maude.annotationToolState.v2');

/**
 * This document's one store. The first call wires the bridge: the shell's `annotation-prefs` seeds it
 * (parent only), and a local change goes up as `annotation-prefs-set`. A standalone canvas (no shell
 * above it) simply keeps the choice for the page.
 */
export function toolState(
  win: Window | undefined = typeof window === 'undefined' ? undefined : window
): ToolStateStore {
  const slot = (win ?? (globalThis as unknown as Window)) as unknown as Record<
    symbol,
    ToolStateStore
  >;
  const have = slot[KEY];
  if (have) return have;
  const store = createToolState({
    persist(prefs) {
      if (!win || win.parent === win) return;
      try {
        win.parent.postMessage({ dgn: 'annotation-prefs-set', prefs }, '*');
      } catch {
        /* detached */
      }
    },
  });
  slot[KEY] = store;
  if (win) {
    win.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window.parent) return; // only the shell speaks here (win is this window)
      if ((e.data as { dgn?: unknown } | null)?.dgn !== 'annotation-prefs') return;
      const m = acceptFromShell(e, win);
      if (m?.dgn !== 'annotation-prefs') return;
      store.hydrate(m.prefs);
    });
  }
  // The Marker's tip is also what M arms (Q4): the tip the person remembered is the one M arms.
  store.subscribe(() => rememberMarkerTip(store.get().tip));
  return store;
}

/** The live snapshot, re-rendering on a change. */
export function useToolState(store: ToolStateStore = toolState()): ToolSnapshot {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

// ─── the canvas theme the default ink follows ────────────────────────────────────────────────

/**
 * The canvas-shell CHROME theme — `data-maude-theme` on `<html>`, default 'dark'. This (NOT the DS
 * `data-theme`, which themes only artboard palettes) is what flips the canvas background the ink sits
 * on, so the default ink follows it. The dark/light toggle posts it into the iframe after mount.
 */
export function readChromeTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.maudeTheme === 'light' ? 'light' : 'dark';
}
export function useCanvasChromeTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(readChromeTheme);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => setTheme(readChromeTheme());
    sync(); // catch a value stamped between the initializer and this effect
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-maude-theme'],
    });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// ─── the Eraser's scope ──────────────────────────────────────────────────────────────────────

/** The Eraser rubs out Marker strokes (Marker and Highlighter are both `pen`); every other element is deleted, not rubbed out. */
export const isErasable = (s: Pick<Stroke, 'tool'>): boolean => s.tool === 'pen';

/**
 * The topmost stroke the Eraser takes at a point, or -1. A locked stroke is passed over (#137); so is
 * anything that is not a Marker stroke, which therefore never shadows the stroke underneath it.
 */
export function eraseTargetIndex(
  strokes: readonly Stroke[],
  locked: ReadonlySet<string>,
  wx: number,
  wy: number,
  tol: number
): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s && isErasable(s) && !locked.has(s.id) && strokeHitTest(s, wx, wy, tol)) return i;
  }
  return -1;
}
