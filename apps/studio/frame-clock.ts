/**
 * @file       frame-clock.ts — 2.0.7: Maude's own frame callbacks, exempt from the gesture freeze
 * @scope      apps/studio/frame-clock.ts (canvas frame only; React-free)
 * @purpose    While the camera moves, an artboard's own frame callbacks wait (Michal: "while you pan or zoom,
 *             artboards must not redraw"). The canvas frame's document (`plugins/design/templates/_shell.html`,
 *             script `maude-frame-freeze`) gates `window.requestAnimationFrame` before any module loads, so the
 *             canvas runtime (motion captures it when it loads), Remotion's Player, pixi, three.js and a canvas's
 *             own loops all wait while frozen and run on the first frame after the thaw, in the order they asked.
 *
 *             Maude's own frame code must never wait — the camera's animation, the gesture's own end
 *             (`afterQuietFrame`), the mount ring's queue, the stills' slices and the chrome that follows the camera
 *             (halos, comment pins, toolbars). It calls `frameRaf` / `frameCaf` instead of the globals:
 *             `test/v2-207-gesture-freeze.test.tsx` fails on a bare `requestAnimationFrame(` anywhere in the frame's
 *             import graph.
 *
 *             Without the shell's script (tests, a document that is not the canvas shell) these are the plain
 *             globals and `setFrameFreeze` does nothing.
 */

/** The API the shell's `maude-frame-freeze` script installs on the canvas frame's window. */
export interface FrameFreezeApi {
  v: number;
  /** The platform's requestAnimationFrame — never deferred. */
  raf(cb: FrameRequestCallback): number;
  /** Cancels a frame callback of either kind (a deferred one too). */
  caf(id: number): void;
  /** Freeze (renews the watchdog) or thaw. */
  set(on: boolean): void;
  frozen(): boolean;
  /** Called on every freeze / thaw transition (a watchdog thaw too). */
  on(fn: (frozen: boolean) => void): () => void;
  stats(): {
    frozen: boolean;
    freezes: number;
    held: number;
    deferred: number;
    flushed: number;
    watchdog: number;
  };
}

export const FRAME_FREEZE_KEY = '__maudeFrameFreeze';

export function frameFreezeApi(): FrameFreezeApi | null {
  if (typeof window === 'undefined') return null;
  const a = (window as unknown as Record<string, unknown>)[FRAME_FREEZE_KEY] as
    | FrameFreezeApi
    | undefined;
  return a && typeof a.raf === 'function' ? a : null;
}

/** requestAnimationFrame for Maude's own code: runs on the next frame even while the gesture freeze holds. */
export function frameRaf(cb: FrameRequestCallback): number {
  const a = frameFreezeApi();
  return a ? a.raf(cb) : requestAnimationFrame(cb);
}

/** cancelAnimationFrame for a handle from `frameRaf` (or any other). */
export function frameCaf(id: number): void {
  const a = frameFreezeApi();
  if (a) a.caf(id);
  else cancelAnimationFrame(id);
}

/** `win.requestAnimationFrame` for a window Maude's code was handed: the exempt one when it is this frame's. */
export function frameRafOn(win: Window, cb: FrameRequestCallback): number {
  return typeof window !== 'undefined' && win === window
    ? frameRaf(cb)
    : win.requestAnimationFrame(cb);
}

export function frameCafOn(win: Window, id: number): void {
  if (typeof window !== 'undefined' && win === window) frameCaf(id);
  else win.cancelAnimationFrame(id);
}

/** The camera is moving (renew on every input) / it stopped. */
export function setFrameFreeze(on: boolean): void {
  frameFreezeApi()?.set(on);
}

export function frameFrozen(): boolean {
  return frameFreezeApi()?.frozen() ?? false;
}

/** Freeze / thaw transitions; a no-op subscription without the shell's script. */
export function onFrameFreeze(fn: (frozen: boolean) => void): () => void {
  return frameFreezeApi()?.on(fn) ?? (() => {});
}
