// apps/studio/bridge/canvas-mode-store.ts — the canvas document's window-level mode snapshot
// (V2-1.2 §5.1). Window-level (`Symbol.for`), not module state, so it survives soft HMR
// re-evaluation and is shared by every bundle in the document (canvas-lib runtime, comment-mount).
//
// One idempotent `message` listener, installed on first use, applies the shell's `occluded-insets`
// through the typed table (parent-gated, validated, an older `seq` dropped — §5.6 I4). The camera
// consumers read `insets` when they compute (Fit, reveal); an inset change alone never moves the
// camera (I1).
//
// It also keeps the shell's `key-prefs` (V2-4 gate: the "Single-key shortcuts" switch) in `singleKeys`.
//
// The same listener applies the shell's `set-mode` (V2-4.3b — the governed path, §5.4): parent-gated,
// an older `seq` dropped, the mode clamped by the caps (and by a `?ro=1` canvas). The first applied
// `set-mode` makes the document GOVERNED; from then on the `ToolProvider`s adopt `mode` from here and
// a cross-mode gesture becomes a `mode-request`. `claimEcho(seq)` lets exactly one provider echo each
// applied `set-mode` as `mode-changed` (M2), however many providers the document mounts.
//
// S3.1 — Present: the snapshot carries the shell's `present` spec (Present · Artboards or · Canvas).
// The shell's `present-step` (its controls, presenter view) lands in `step` for the Present stage
// (S3.2a), and `reportPresentPosition` is the stage's one way to say it moved on: it tells the shell
// (`present-position`) and this document's HMR applier (`PRESENT_POSITION_EVENT`), which lands a
// canvas write it held while the audience was looking (A8).

import { isReadOnlyCanvas } from '../read-only-mode.ts';
import {
  type CanvasModeV2,
  clampMode,
  homeModeOfTool,
  type ModeCaps,
  type PresentSpec,
  type ToolId,
} from './canvas-modes.ts';
import { acceptFromShell } from './dgn-protocol.ts';
import { type Insets, ZERO_INSETS } from './occlusion.ts';

export interface CanvasModeSnapshot {
  readonly insets: Readonly<Insets>;
  /** The `seq` of the applied `occluded-insets` (-1 = none yet). */
  readonly insetsSeq: number;
  /** Governed (V2-4.3b): the shell's mode; null until the first applied `set-mode`. */
  readonly mode: CanvasModeV2 | null;
  readonly present: PresentSpec | null;
  readonly caps: Readonly<ModeCaps> | null;
  /** The `seq` of the applied `set-mode` (-1 = none yet). */
  readonly modeSeq: number;
  /** The tool the shell asked for with this `set-mode` (null = keep the tool, or the mode's rest
   *  when the mode changed). Already checked against the mode. */
  readonly tool: ToolId | null;
  /** The mode before this `set-mode` (null on the first one). */
  readonly prevMode: CanvasModeV2 | null;
  /** The requested mode was clamped (echo cause `clamp`). */
  readonly clamped: boolean;
  /** V2-4 gate — the shell's "Single-key shortcuts" switch (`key-prefs`); on until the shell says off. */
  readonly singleKeys: boolean;
  /** S3.1 — the shell's last `present-step` while presenting (`n` counts them, so the same `to`
   *  twice is two steps); null outside Present. */
  readonly step: { readonly to: number | 'next' | 'prev'; readonly n: number } | null;
}

export interface CanvasModeStore {
  get(): CanvasModeSnapshot;
  subscribe(fn: (s: CanvasModeSnapshot) => void): () => void;
  /** True for the first caller per applied `set-mode` seq — that caller posts the one echo. */
  claimEcho(seq: number): boolean;
  /** True once per distinct `mode-request` until the next applied `set-mode` (or 250 ms): both providers
   *  see the same keydown, so the document asks the shell once. */
  claimRequest(key: string): boolean;
}

const KEY = Symbol.for('maude.canvasMode.v2');

export function canvasModeStore(win: Window): CanvasModeStore {
  const slot = win as unknown as Record<symbol, CanvasModeStore | undefined>;
  const existing = slot[KEY] as (CanvasModeStore & { doc?: unknown }) | undefined;
  // Keyed to the document too: a test runner that re-registers a DOM onto the same global keeps the
  // slot but drops its listeners (a real window keeps its document across soft HMR).
  if (existing && existing.doc === win.document) return existing;
  let snap: CanvasModeSnapshot = {
    insets: ZERO_INSETS,
    insetsSeq: -1,
    mode: null,
    present: null,
    caps: null,
    modeSeq: -1,
    tool: null,
    prevMode: null,
    clamped: false,
    singleKeys: true,
    step: null,
  };
  let steps = 0;
  let echoed = -1;
  let asked = new Map<string, number>(); // key → when (a denied request may be asked again later)
  const subs = new Set<(s: CanvasModeSnapshot) => void>();
  const store: CanvasModeStore = {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    claimEcho(seq) {
      if (seq !== snap.modeSeq || seq <= echoed) return false;
      echoed = seq;
      return true;
    },
    claimRequest(key) {
      const now = Date.now();
      const at = asked.get(key);
      if (at !== undefined && now - at < 250) return false;
      asked.set(key, now);
      return true;
    },
  };
  win.addEventListener('message', (e: MessageEvent) => {
    const m = acceptFromShell(e, win);
    if (m?.dgn === 'set-mode') {
      if (m.seq <= snap.modeSeq) return; // an older (or repeated) seq is dropped, like I4
      asked = new Map();
      const caps: ModeCaps = isReadOnlyCanvas()
        ? { edit: false, annotate: false, comment: m.caps.comment }
        : { ...m.caps };
      const mode = clampMode(m.mode, caps);
      const toolMode = m.tool ? homeModeOfTool(m.tool, caps, mode) : null;
      const tool = m.tool && (toolMode === null || toolMode === mode) ? m.tool : null;
      snap = {
        ...snap,
        mode,
        present: mode === 'present' ? (m.present ?? { kind: 'canvas' }) : null,
        caps: Object.freeze(caps),
        modeSeq: m.seq,
        tool,
        prevMode: snap.mode,
        clamped: mode !== m.mode,
        step: mode === 'present' ? snap.step : null,
      };
      for (const fn of subs) fn(snap);
      return;
    }
    if (m?.dgn === 'present-step') {
      if (snap.mode !== 'present') return; // a step outside Present means nothing
      steps += 1;
      snap = { ...snap, step: Object.freeze({ to: m.to, n: steps }) };
      for (const fn of subs) fn(snap);
      return;
    }
    if (m?.dgn === 'key-prefs') {
      if (m.singleKeys === snap.singleKeys) return;
      snap = { ...snap, singleKeys: m.singleKeys };
      for (const fn of subs) fn(snap);
      return;
    }
    if (m?.dgn !== 'occluded-insets') return;
    if (m.seq <= snap.insetsSeq) return; // I4 — an older (or repeated) seq is dropped
    snap = { ...snap, insets: Object.freeze({ ...m.insets }), insetsSeq: m.seq };
    for (const fn of subs) fn(snap);
  });
  Object.defineProperty(store, 'doc', { value: win.document });
  slot[KEY] = store;
  return store;
}

/** The document event `_shell.html`'s HMR applier listens on to land a held write (A8). */
export const PRESENT_POSITION_EVENT = 'maude:present-position';

/**
 * S3.1 — Present · Artboards moved on: tell the shell (`present-position`, the counter and the
 * presenter view read it) and this document's HMR applier (it lands the write it held). The Present
 * stage (S3.2a) calls it on every step, the first one included. A canvas faking it can only make a
 * held write land sooner — never hold one (the hold itself is the shell's parent-gated `set-mode`).
 */
export function reportPresentPosition(
  win: Window,
  pos: { index: number; total: number; artboardId: string }
): void {
  const index = Math.max(0, Math.trunc(pos.index));
  const total = Math.max(0, Math.trunc(pos.total));
  const artboardId = String(pos.artboardId).slice(0, 200);
  try {
    const Ctor = (win as Window & { CustomEvent?: typeof CustomEvent }).CustomEvent ?? CustomEvent;
    win.document.dispatchEvent(
      new Ctor(PRESENT_POSITION_EVENT, { detail: { index, total, artboardId } })
    );
  } catch {
    /* no document */
  }
  if (win.parent === win) return;
  try {
    win.parent.postMessage({ dgn: 'present-position', index, total, artboardId }, '*');
  } catch {
    /* detached */
  }
}

/** The insets the camera consumers honour right now (zero outside a browser document). */
export function canvasInsets(): Readonly<Insets> {
  return typeof window === 'undefined' ? ZERO_INSETS : canvasModeStore(window).get().insets;
}

/** V2-4 gate — may a character-key chord fire in this canvas? (true outside a browser document.) */
export function canvasSingleKeys(): boolean {
  return typeof window === 'undefined' ? true : canvasModeStore(window).get().singleKeys;
}

/**
 * Calls `fn` exactly once, with the first applied `occluded-insets` snapshot — immediately when the
 * shell's insets already arrived before the caller subscribed. Returns the unsubscribe.
 */
export function onFirstInsets(
  store: CanvasModeStore,
  fn: (s: CanvasModeSnapshot) => void
): () => void {
  let done = false;
  const fire = (s: CanvasModeSnapshot) => {
    if (done || s.insetsSeq < 0) return;
    done = true;
    unsub();
    fn(s);
  };
  const unsub = store.subscribe(fire);
  fire(store.get());
  return unsub;
}

/**
 * §5.6 I2 — boot re-fit, once only: the first insets re-fit the camera only while it still IS the boot
 * fit (`bootFit` is null when the camera came from a persisted viewport / a soft-reload resume, or when
 * the boot fit already honoured insets), the user is not gesturing, and the insets are not all zero.
 */
export function shouldBootRefit(
  bootFit: { x: number; y: number; zoom: number } | null,
  current: { x: number; y: number; zoom: number },
  interacting: boolean,
  insets: Readonly<Insets>
): boolean {
  if (!bootFit || interacting) return false;
  if (!insets.top && !insets.right && !insets.bottom && !insets.left) return false;
  return bootFit.x === current.x && bootFit.y === current.y && bootFit.zoom === current.zoom;
}

// Installed when the canvas runtime loads, so an `occluded-insets` the shell seeds on `loaded`
// isn't missed by a listener a later first fit would have installed.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  canvasModeStore(window);
}
