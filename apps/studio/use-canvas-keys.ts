/**
 * @file       use-canvas-keys.ts — V2-2.4 step 5 (V2-1.3 contract §5.5)
 * @scope      apps/studio/use-canvas-keys.ts
 * @purpose    A canvas key owner's one keydown listener, resolved through the action registry:
 *             the owner hands in `{ actionId: handler }`, the hook resolves each keydown against
 *             those actions' canvas bindings (actions/keymap.gen.ts) and runs the winner. No chord
 *             is matched by hand. The listener sits where the owner's v1 listener sat (target +
 *             phase), so the pure swap keeps cross-owner order; a handler calls
 *             `e.preventDefault()` itself, exactly where v1 did.
 */

import { useEffect, useRef } from 'react';

import { canvasKeyIndex, resolveCanvasKey } from './actions/canvas-keys.ts';
import type { ActionId, SelKind } from './actions/types.ts';
import { canvasModeStore, canvasSingleKeys } from './bridge/canvas-mode-store.ts';
import { isEditableTarget } from './input-router.tsx';

export type CanvasKeyHandlers = Readonly<Record<ActionId, (e: KeyboardEvent) => void>>;

export interface UseCanvasKeysOptions {
  /** Where v1's listener was attached. Default `window`. */
  target?: 'window' | 'document';
  /** v1's phase. Default bubble. */
  capture?: boolean;
  /** S3.11 — what the canvas has selected right now (read per keydown), for a selection-keyed binding. */
  selection?: () => SelKind;
}

export function useCanvasKeys(handlers: CanvasKeyHandlers, opts: UseCanvasKeysOptions = {}): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const ids = Object.keys(handlers).sort().join('|');
  const { target = 'window', capture = false } = opts;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const index = canvasKeyIndex(ids.split('|'));
    const t: Window | Document = target === 'document' ? document : window;
    const onKey = (e: Event) => {
      const ke = e as KeyboardEvent;
      const id = resolveCanvasKey(
        index,
        ke,
        isEditableTarget(ke.target),
        // S3.11 — the shell's mode when it governs this canvas (a binding keyed to Preview/Viewing, like
        // `inspect.edit`, can only match with it); undefined on a free canvas = the v1 context ('edit')
        canvasModeStore(window).get().mode ?? undefined,
        canvasSingleKeys(),
        selectionRef.current?.()
      );
      if (id) handlersRef.current[id]?.(ke);
    };
    t.addEventListener('keydown', onKey, capture);
    return () => t.removeEventListener('keydown', onKey, capture);
  }, [ids, target, capture]);
}
