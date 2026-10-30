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

const TIP_Z = 2147483000;

/** The tip, following the pointer while it is down on a locked annotation; `onDone` once it lets go. */
export function LockedDragTip({
  at,
  onDone,
}: {
  at: { x: number; y: number } | null;
  onDone: () => void;
}) {
  const [pos, setPos] = useState(at);
  useEffect(() => {
    setPos(at);
    if (!at) return;
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    const up = () => onDone();
    // a tip that outlives a gesture the browser cancelled would stick: the timer is the backstop
    const timer = setTimeout(onDone, 4000);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
    };
  }, [at, onDone]);
  if (!at || !pos) return null;
  return (
    <span
      role="tooltip"
      data-testid="annotation-locked-tip"
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
      {LOCKED_DRAG_TIP}
    </span>
  );
}
