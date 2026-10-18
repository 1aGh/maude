// editing/undo-mode.ts — S2.20b: which ⌘Z this canvas runs (V2-1.5 §5.4, V2-1.2 feed).
//
// On a project on the op log the shell owns the ⌘Z stack (client/v2/undo/use-undo-projection.jsx),
// so the iframe keeps NO durable stack: a ⌘Z / ⇧⌘Z pressed with the canvas focused — or a
// `run-action edit.undo` the shell sent — is forwarded to the shell as `undo-key {redo}`, and the
// DDR-050 stack (use-undo-stack.tsx) neither persists to sessionStorage nor takes records. A legacy
// project (an old hub link, or `MAUDE_LOCAL_STORE=0`) keeps the canvas stack and its HUD.
//
// The shell says which with the parent-gated state message `undo-mode {opLog}` — on every change and
// to a frame that has just loaded or rendered (client/v2/undo/use-undo-mode-lane.js). Until it
// speaks, the canvas is `legacy`: an old shell never sends it, and the canvas then behaves as today.

import { useSyncExternalStore } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';

export interface UndoModeStore {
  /** True while the shell runs ⌘Z from the op log. */
  opLog(): boolean;
  subscribe(fn: (opLog: boolean) => void): () => void;
}

const KEY = Symbol.for('maude.undoMode.v1');

/** The one store per canvas document (a soft HMR swap keeps it, like canvas-mode-store). */
export function undoModeStore(win: Window = window): UndoModeStore {
  const slot = win as unknown as Record<symbol, (UndoModeStore & { doc?: unknown }) | undefined>;
  const existing = slot[KEY];
  if (existing && existing.doc === win.document) return existing;
  let opLog = false;
  const subs = new Set<(opLog: boolean) => void>();
  const store: UndoModeStore = {
    opLog: () => opLog,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
  win.addEventListener('message', (e: MessageEvent) => {
    // parent-gated: a sibling canvas (same origin, DDR-054) cannot flip it
    const parent = win.parent;
    if (e.source !== parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'undo-mode') return;
    const m = acceptFromShell(e, win);
    if (m?.dgn !== 'undo-mode' || m.opLog === opLog) return;
    opLog = m.opLog;
    for (const fn of subs) fn(opLog);
  });
  Object.defineProperty(store, 'doc', { value: win.document });
  slot[KEY] = store;
  return store;
}

/** Is this canvas's ⌘Z the shell's (the op log)? False on a server without `window`. */
export function isOpLogUndo(win: Window | undefined = globalThis.window): boolean {
  return !!win && undoModeStore(win).opLog();
}

/**
 * In op-log mode: hand ⌘Z (`redo: false`) / ⇧⌘Z (`redo: true`) to the shell and answer true — the
 * caller then runs nothing locally. In legacy mode: false, and the caller runs the canvas stack.
 */
export function forwardUndoKey(redo: boolean, win: Window = window): boolean {
  if (!isOpLogUndo(win)) return false;
  try {
    win.parent.postMessage({ dgn: 'undo-key', redo }, '*');
  } catch {
    /* detached */
  }
  return true;
}

const noSub = () => () => {};
const never = () => false;

/** React: re-render when the shell flips the mode (UndoHud, the canvas undo stack). */
export function useOpLogUndo(): boolean {
  const s = typeof window === 'undefined' ? null : undoModeStore(window);
  return useSyncExternalStore(s ? s.subscribe : noSub, s ? s.opLog : never, never);
}
