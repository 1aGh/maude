// apps/studio/preview/preview-camera.tsx — Edit ⇄ Preview in the canvas (04 md-motion).
//
// r2-p3 (Michal TD1d, decision maude/v2-michal-ux-audit-td-decisions): a mode switch changes only the toolbar —
// Preview keeps the Edit camera and the panels keep their place. The S3.9 camera ease (a 220 ms glide onto the
// artboard in view) was switched off by that decision and, per #170 D3, is removed: nothing here moves the camera.
//
// What stays is the document's side of Preview, mounted by canvas-lib's `DesignCanvasInner` through
// `usePreviewMark`: `html[data-maude-preview]` while the shell's mode is Preview, so a web artboard's design
// surface scrolls inside itself (styles below), and `usePreviewing` for chrome that steps aside in Preview.

import { useEffect, useSyncExternalStore } from 'react';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';

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

/**
 * Mount Edit ⇄ Preview on a canvas. Reads the shell's `set-mode` through the document's mode store
 * (canvas-mode-store.ts) and marks the document while the mode is Preview (`html[data-maude-preview]`) so a web
 * artboard can scroll inside itself. It never moves the camera.
 */
export function usePreviewMark(): void {
  const win = typeof window === 'undefined' ? null : window;
  useEffect(() => {
    if (!win) return;
    const store = canvasModeStore(win);
    ensurePreviewStyles(win.document);
    const root = win.document.documentElement;
    const mark = () => {
      if (store.get().mode === 'preview') root.setAttribute('data-maude-preview', '');
      else root.removeAttribute('data-maude-preview');
    };
    mark();
    const unsub = store.subscribe(mark);
    return () => {
      unsub();
      root.removeAttribute('data-maude-preview');
    };
  }, [win]);
}
