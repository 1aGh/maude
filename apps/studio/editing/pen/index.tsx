// editing/pen/index.tsx — the Pen's layer (S2.14): the drawing tool, point editing and Combine shapes, mounted once in
// the editing layer. Combine arrives as `run-action` from the inspector's row, ⌘K or an agent (like every other
// object action); it needs nothing drawn, so it lives here and not in an overlay.

import { useEffect, useRef } from 'react';

import { acceptFromShell } from '../../bridge/dgn-protocol.ts';
import { isReadOnlyCanvas } from '../../read-only-mode.ts';
import { useSelectionSet } from '../../use-selection-set.tsx';
import { useUndoStackOptional } from '../../use-undo-stack.tsx';
import { selectWhenRendered } from '../object-actions.ts';
import { COMBINE_ACTIONS, isCombineAction, runCombine } from './combine-run.ts';
import { PenTool } from './draw.tsx';
import { PointEdit } from './points.tsx';

/** Registry ids this layer runs when the shell asks (`dgn:'run-action'`). */
export const PEN_ACTIONS = COMBINE_ACTIONS;

export function PenLayer({ readOnly = false }: { readOnly?: boolean }) {
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const ref = useRef({ selSet, undo });
  ref.current = { selSet, undo };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'run-action')
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'run-action' || !isCombineAction(m.id) || isReadOnlyCanvas()) return;
      void runCombine(m.id, ref.current.selSet.selected, {
        record: (rec) => ref.current.undo?.record(rec),
        select: (created) => selectWhenRendered(created, (s) => ref.current.selSet.replace(s)),
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <>
      <PenTool readOnly={readOnly} />
      <PointEdit readOnly={readOnly} />
    </>
  );
}
PenLayer.displayName = 'PenLayer';
