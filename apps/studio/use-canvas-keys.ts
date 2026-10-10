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
import type { ActionId } from './actions/types.ts';
import { isEditableTarget } from './input-router.tsx';

export type CanvasKeyHandlers = Readonly<Record<ActionId, (e: KeyboardEvent) => void>>;

export interface UseCanvasKeysOptions {
  /** Where v1's listener was attached. Default `window`. */
  target?: 'window' | 'document';
  /** v1's phase. Default bubble. */
  capture?: boolean;
}

export function useCanvasKeys(handlers: CanvasKeyHandlers, opts: UseCanvasKeysOptions = {}): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const ids = Object.keys(handlers).sort().join('|');
  const { target = 'window', capture = false } = opts;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const index = canvasKeyIndex(ids.split('|'));
    const t: Window | Document = target === 'document' ? document : window;
    const onKey = (e: Event) => {
      const ke = e as KeyboardEvent;
      const id = resolveCanvasKey(index, ke, isEditableTarget(ke.target));
      if (id) handlersRef.current[id]?.(ke);
    };
    t.addEventListener('keydown', onKey, capture);
    return () => t.removeEventListener('keydown', onKey, capture);
  }, [ids, target, capture]);
}
