// actions/documents.ts — which document resolves a binding (V2-1.3 contract §5.3 / §5.7).
//
// The shell and the canvas iframe each run the resolver on their own keydowns, with their own
// KeyCtx. 'text' means "a text field in THIS document", so a binding has to say which documents it
// belongs to — and its `when.focus` already does: chrome / timeline / modal are shell foci, canvas
// is the iframe's; a binding without a focus list belongs to both (the canvas forwards it when its
// action is `fromCanvas`, V2-1.3 §5.7). Timeline-layer bindings need timeline focus — shell only.

import { indexKeys, type KeyIndex } from './resolve.ts';
import type { ActionDef, ActionId, KeyBinding, KeyedAction } from './types.ts';

export type KeyDocument = 'shell' | 'canvas';

export function bindingInDocument(b: KeyBinding, doc: KeyDocument): boolean {
  const focus = b.when?.focus;
  if (doc === 'shell')
    return (
      b.layer === 'timeline' ||
      !focus ||
      focus.some((f) => f === 'chrome' || f === 'timeline' || f === 'modal')
    );
  return b.layer !== 'timeline' && (!focus || focus.includes('canvas'));
}

/** The index one document resolves: the bindings it owns, of the actions it has handlers for. */
export function documentIndex<A extends KeyedAction = ActionDef>(
  actions: readonly A[],
  doc: KeyDocument,
  handled: (id: ActionId) => boolean
): KeyIndex<A> {
  return indexKeys(actions, (a, b) => handled(a.id) && bindingInDocument(b, doc));
}
