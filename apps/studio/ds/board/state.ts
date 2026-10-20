// The board's three module-level facts (S10.6): the model the generated `@maude/ds/board` module
// registered, the specimens it imported, and the Light | Dark preview. All per canvas bundle, like
// canvas-lib's `__registerDesignSystem`.
//
// Light | Dark is the SYSTEM's own mode (a class + `data-theme` on each section, V2-1.6 §5.2). It is
// a viewing preference of this one canvas; it never writes `<html>`, never the app's theme, and is
// not persisted. A parent (the app's `ds.set-theme-preview` action) reaches it by postMessage
// `{ type: 'maude:ds-theme-preview', mode }`; `?dsMode=dark` starts it Dark.

import { useSyncExternalStore } from 'react';
import { type BoardMarks, type BoardMode, type BoardModel, cleanMarks, NO_MARKS } from './types.ts';

let model: BoardModel | null = null;
let specimens: Record<string, unknown> = {};
let mode: BoardMode = 'light';
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
export const getBoardMode = (): BoardMode => mode;

export function setBoardMode(next: BoardMode): void {
  if (next !== 'light' && next !== 'dark') return;
  if (next === mode) return;
  mode = next;
  emit();
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
export const useBoardMode = (): BoardMode =>
  useSyncExternalStore(subscribe, getBoardMode, getBoardMode);

let listening = false;
/** Wire the parent's `ds.set-theme-preview` message and `?dsMode=` once. Safe without a window. */
export function listenForThemePreview(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  try {
    if (new URLSearchParams(window.location.search).get('dsMode') === 'dark') mode = 'dark';
  } catch {
    /* no location */
  }
  window.addEventListener('message', (e: MessageEvent) => {
    // only the studio shell that framed this canvas may change the preview
    if (e.source !== window.parent) return;
    const d = e.data as { type?: unknown; mode?: unknown } | null;
    if (d && d.type === 'maude:ds-theme-preview') setBoardMode(d.mode as BoardMode);
    if (d && d.type === 'maude:ds-marks') setBoardMarks(d);
  });
  emit();
}

/** test seam */
export function __resetBoardState(): void {
  model = null;
  specimens = {};
  mode = 'light';
  marks = NO_MARKS;
  emit();
}
