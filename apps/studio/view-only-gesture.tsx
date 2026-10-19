// view-only-gesture.tsx — S9.21 (10 co-ask-edit): a view-only person's drag on the design does nothing; the
// shell says why ("You can look at Combine-kampan, not change it." / "Ask to edit, top right, …").
//
// Mounted by canvas-shell only on a read-only canvas (`?ro=1`, where no edit chrome exists). It tells the shell
// ONE fact — "a drag on the design went nowhere" — as `{ dgn: 'view-only-gesture', v: 1 }`: no text, no
// element, no position (DDR-054: the canvas origin is untrusted; the shell writes the tip from its own state).
// At most once per `quietMs`, and never for a drag that the design itself uses (a field, a slider, a scroll area
// or text being selected keeps its native behaviour and is not "nothing").

import { useEffect } from 'react';

const DRAG_PX = 8;
const NATIVE =
  'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"]';

export interface ViewOnlyGestureDeps {
  post: () => void;
  now?: () => number;
  /** How long after one tip the next drag stays quiet (default 30 s). */
  quietMs?: number;
}

/** True when a pointerdown on `t` starts a drag that goes nowhere on a read-only canvas. */
export function startsDeadDrag(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false;
  const el = t as Element;
  return !!el.closest('.dc-artboard-body') && !el.closest(NATIVE);
}

/** The pure tracker: feed it pointer events; it posts once a dead drag passes `DRAG_PX`. */
export function viewOnlyGestureTracker(deps: ViewOnlyGestureDeps) {
  const now = deps.now ?? Date.now;
  const quiet = deps.quietMs ?? 30_000;
  let start: { x: number; y: number } | null = null;
  let last = Number.NEGATIVE_INFINITY;
  return {
    down(
      e: { button: number; clientX: number; clientY: number; target: EventTarget | null } & {
        metaKey?: boolean;
        ctrlKey?: boolean;
        altKey?: boolean;
        shiftKey?: boolean;
      }
    ) {
      start = null;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!startsDeadDrag(e.target)) return;
      start = { x: e.clientX, y: e.clientY };
    },
    move(e: { clientX: number; clientY: number }) {
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_PX) return;
      start = null;
      if (now() - last < quiet) return;
      last = now();
      deps.post();
    },
    up() {
      start = null;
    },
  };
}

export function postViewOnlyGesture(): void {
  try {
    window.parent.postMessage({ dgn: 'view-only-gesture', v: 1 }, '*');
  } catch {
    /* detached */
  }
}

export function ViewOnlyGesture(): null {
  useEffect(() => {
    const t = viewOnlyGestureTracker({ post: postViewOnlyGesture });
    const down = (e: PointerEvent) => t.down(e);
    const move = (e: PointerEvent) => t.move(e);
    const up = () => t.up();
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
    };
  }, []);
  return null;
}
