// The board's three module-level facts (S10.6): the model the generated `@maude/ds/board` module
// registered, the specimens it imported, and the Light | Dark preview. All per canvas bundle, like
// canvas-lib's `__registerDesignSystem`.
//
// Light | Dark is the SYSTEM's own mode (a class + `data-theme` on each section, V2-1.6 §5.2). It is
// a viewing preference of this one canvas; it never writes `<html>`, never the app's theme. r4 #6: it IS the
// canvas's one Light | Dark (canvas-theme.ts) — the same mode every ordinary canvas's pill switches — so the
// specimen pages and every other artboard follow it, not only the seven sections. A parent (the app's
// `ds.set-theme-preview` action) reaches it by the dgn message `{ dgn: 'ds-theme-preview', mode }`
// (bridge/dgn-protocol.ts) and `?dsMode=dark` starts it Dark; both are PREVIEWS — nothing is remembered.
// The bar's own Light | Dark buttons remember the pick (per canvas, per Mac), like the pill on any canvas.

import { useSyncExternalStore } from 'react';
import { acceptFromShell } from '../../bridge/dgn-protocol.ts';
import {
  __resetCanvasTheme,
  getCanvasTheme,
  setCanvasTheme,
  useCanvasTheme,
} from '../../canvas-theme.ts';
import { type BoardMarks, type BoardMode, type BoardModel, cleanMarks, NO_MARKS } from './types.ts';

let model: BoardModel | null = null;
let specimens: Record<string, unknown> = {};
// S10.11 — the tokens the studio flags ("Changed outside", "2 versions"); a view of studio state, never persisted
let marks: BoardMarks = NO_MARKS;
const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

/** Called by the generated `@maude/ds/board` module. Idempotent; the last call wins. */
export function __registerBoardModel(next: BoardModel, specs: Record<string, unknown> = {}): void {
  model = next;
  specimens = specs;
  emit();
}

export const getBoardModel = (): BoardModel | null => model;
export const getSpecimen = (src: string): unknown => specimens[src];
/** The `preview/…tsx` pages this canvas kept as showcases, in the order the module registered them. */
export const getSpecimenSrcs = (): string[] => Object.keys(specimens);
export const getBoardMode = (): BoardMode => getCanvasTheme();

/** Show the system in `next` — a preview; nothing is remembered (the bar's buttons use `setCanvasTheme`). */
export function setBoardMode(next: BoardMode): void {
  if (next !== 'light' && next !== 'dark') return;
  setCanvasTheme(next, { persist: false });
}

export const getBoardMarks = (): BoardMarks => marks;

export function setBoardMarks(next: unknown): void {
  const clean = cleanMarks(next);
  if (
    clean.outside.join('\0') === marks.outside.join('\0') &&
    clean.conflicts.join('\0') === marks.conflicts.join('\0')
  )
    return;
  marks = clean;
  emit();
}

export const useBoardMarks = (): BoardMarks =>
  useSyncExternalStore(subscribe, getBoardMarks, getBoardMarks);
export const useBoardModel = (): BoardModel | null =>
  useSyncExternalStore(subscribe, getBoardModel, getBoardModel);
export const useBoardMode = (): BoardMode => useCanvasTheme();

let listening = false;
/** Wire the parent's `ds.set-theme-preview` message and `?dsMode=` once. Safe without a window. */
export function listenForThemePreview(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  try {
    if (new URLSearchParams(window.location.search).get('dsMode') === 'dark') setBoardMode('dark');
  } catch {
    /* no location */
  }
  window.addEventListener('message', (e: MessageEvent) => {
    // only the studio shell that framed this canvas may change the preview
    if (e.source !== window.parent || !e.data) return;
    // S10.16c: the typed dgn messages (bridge/dgn-protocol.ts), parsed and capped by the table
    const m = acceptFromShell(e, window);
    if (!m) return;
    if (m.dgn === 'ds-theme-preview') setBoardMode(m.mode);
    else if (m.dgn === 'ds-marks') setBoardMarks(m);
  });
  emit();
}

/** test seam */
export function __resetBoardState(): void {
  model = null;
  specimens = {};
  __resetCanvasTheme();
  marks = NO_MARKS;
  emit();
}
