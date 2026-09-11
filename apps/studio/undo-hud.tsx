/** Announces canvas edit/undo/redo operations through the shared toast stack. */
import { useEffect, useRef } from 'react';
import { showCanvasToast } from './canvas-notifications.tsx';
import { useUndoStackOptional } from './use-undo-stack.tsx';

export function UndoHud() {
  const undo = useUndoStackOptional();
  const lastTick = useRef(0);
  useEffect(() => {
    if (!undo.lastTick || !undo.lastLabel || lastTick.current === undo.lastTick) return;
    lastTick.current = undo.lastTick;
    showCanvasToast(undo.lastLabel, 'undo');
  }, [undo.lastTick, undo.lastLabel]);
  return null;
}
UndoHud.displayName = 'UndoHud';
