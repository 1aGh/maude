// apps/studio/bridge/canvas-mode-store.ts — the canvas document's window-level mode snapshot
// (V2-1.2 §5.1). Window-level (`Symbol.for`), not module state, so it survives soft HMR
// re-evaluation and is shared by every bundle in the document (canvas-lib runtime, comment-mount).
//
// One idempotent `message` listener, installed on first use, applies the shell's `occluded-insets`
// through the typed table (parent-gated, validated, an older `seq` dropped — §5.6 I4). The camera
// consumers read `insets` when they compute (Fit, reveal); an inset change alone never moves the
// camera (I1). `set-mode` (and with it `mode` / `caps`) joins the snapshot with the dormant governed
// path (V2-2.10e); nothing in the v1 shell sends either message yet.

import { acceptFromShell } from './dgn-protocol.ts';
import { type Insets, ZERO_INSETS } from './occlusion.ts';

export interface CanvasModeSnapshot {
  readonly insets: Readonly<Insets>;
  /** The `seq` of the applied `occluded-insets` (-1 = none yet). */
  readonly insetsSeq: number;
}

export interface CanvasModeStore {
  get(): CanvasModeSnapshot;
  subscribe(fn: (s: CanvasModeSnapshot) => void): () => void;
}

const KEY = Symbol.for('maude.canvasMode.v2');

export function canvasModeStore(win: Window): CanvasModeStore {
  const slot = win as unknown as Record<symbol, CanvasModeStore | undefined>;
  const existing = slot[KEY];
  if (existing) return existing;
  let snap: CanvasModeSnapshot = { insets: ZERO_INSETS, insetsSeq: -1 };
  const subs = new Set<(s: CanvasModeSnapshot) => void>();
  const store: CanvasModeStore = {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
  win.addEventListener('message', (e: MessageEvent) => {
    const m = acceptFromShell(e, win);
    if (m?.dgn !== 'occluded-insets') return;
    if (m.seq <= snap.insetsSeq) return; // I4 — an older (or repeated) seq is dropped
    snap = { ...snap, insets: Object.freeze({ ...m.insets }), insetsSeq: m.seq };
    for (const fn of subs) fn(snap);
  });
  slot[KEY] = store;
  return store;
}

/** The insets the camera consumers honour right now (zero outside a browser document). */
export function canvasInsets(): Readonly<Insets> {
  return typeof window === 'undefined' ? ZERO_INSETS : canvasModeStore(window).get().insets;
}

// Installed when the canvas runtime loads, so an `occluded-insets` the shell seeds on `loaded`
// isn't missed by a listener a later first fit would have installed.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  canvasModeStore(window);
}
