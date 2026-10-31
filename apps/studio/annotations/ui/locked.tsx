/**
 * @file       annotations/ui/locked.tsx — the words a locked annotation speaks (S4.19, canvas 15 `an-layers`)
 * @scope      apps/studio/annotations/ui/locked.tsx
 * @purpose    A fully locked selection's small toolbar says "Locked · Unlock ⇧⌘L" (not a bare lock icon), and a drag
 *             on a locked annotation shows the tip "Locked — unlock to move it" at the pointer. The words are the
 *             shell list's own (client/v2/annotations/annotation-list-model.js: LOCKED_TOOLBAR, LOCKED_DRAG_TIP);
 *             test/s4-19-locked-line.test.tsx holds the two copies equal, since the canvas iframe does not import
 *             the shell's client code. The testids are the ones S4.17 registered for exactly this reuse.
 */

import { useEffect, useState } from 'react';

export const LOCKED_LINE = Object.freeze({ label: 'Locked', action: 'Unlock', kbd: '⇧⌘L' });
export const LOCKED_DRAG_TIP = 'Locked — unlock to move it';
/** r1 item 14 — a press in Edit on a quiet annotation (S4.9): it moves in Preview (CONTRACT ⌥⌘P). */
export const QUIET_MOVE_TIP = 'Switch to Preview to move it · ⌥⌘P';

const TIP_Z = 2147483000;

/** The tip, following the pointer while it is down on a locked annotation; `onDone` once it lets go. */
export function LockedDragTip({
  at,
  onDone,
  text = LOCKED_DRAG_TIP,
  testId = 'annotation-locked-tip',
  holdMs = 0,
}: {
  at: { x: number; y: number } | null;
  onDone: () => void;
  /** r1 item 14 — the same tip in other words (the quiet layer's `QUIET_MOVE_TIP`) */
  text?: string;
  testId?: string;
  /** how long the tip stays after the press ends (0: it goes with the press) */
  holdMs?: number;
}) {
  const [pos, setPos] = useState(at);
  useEffect(() => {
    setPos(at);
    if (!at) return;
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    let after: ReturnType<typeof setTimeout> | undefined;
    // a click's tip would only flash: `holdMs` keeps it readable after the press ends
    const up = () => {
      if (holdMs > 0) after = setTimeout(onDone, holdMs);
      else onDone();
    };
    // a tip that outlives a gesture the browser cancelled would stick: the timer is the backstop
    const timer = setTimeout(onDone, 4000);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return () => {
      clearTimeout(timer);
      if (after) clearTimeout(after);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
    };
  }, [at, onDone, holdMs]);
  if (!at || !pos) return null;
  return (
    <span
      role="tooltip"
      data-testid={testId}
      style={{
        position: 'fixed',
        left: pos.x + 14,
        top: pos.y + 18,
        zIndex: TIP_Z,
        pointerEvents: 'none',
        padding: '4px 9px',
        borderRadius: 7,
        background: '#26262b',
        color: '#fff',
        font: '500 12px/1.3 system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
      }}
    >
      {text}
    </span>
  );
}
