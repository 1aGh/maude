/** Announces canvas edit/undo/redo operations through the shared toast stack. */
import { useEffect, useRef } from 'react';
import { showCanvasToast } from './canvas-notifications.tsx';
import { useOpLogUndo } from './editing/undo-mode.ts';
import { useUndoStackOptional } from './use-undo-stack.tsx';

/** Legacy projects only (S2.20b): on the op log the shell announces "Undo: …" itself. */
export function UndoHud() {
  const undo = useUndoStackOptional();
  const opLog = useOpLogUndo();
  const lastTick = useRef(0);
  useEffect(() => {
    if (opLog) return;
    if (!undo.lastTick || !undo.lastLabel || lastTick.current === undo.lastTick) return;
    lastTick.current = undo.lastTick;
    showCanvasToast(undo.lastLabel, 'undo');
  }, [undo.lastTick, undo.lastLabel, opLog]);
  return null;
}
UndoHud.displayName = 'UndoHud';
