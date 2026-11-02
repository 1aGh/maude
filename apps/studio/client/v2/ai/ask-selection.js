// client/v2/ai/ask-selection.js — S2.19 (14 Editing `ed-edge-ask`): ⌘/ on a selection, in place.
//
// The canvas tells the shell which elements are selected and where (`ask-selection`, the one number the shell
// cannot measure); the SHELL draws the bubble and owns the words — a canvas is untrusted (DDR-054), so a prompt
// never travels canvas → shell. The bubble's ↵ hands `{ text, scope }` to the AI chat's composer through the
// event below, and the composer sends it like any typed ask: every gate, one run, one undo step.
//
//   ASK_SELECTION_EVENT                 `maude:ask-selection` — `detail: { text, scope }`
//   sendAskSelection({ text, scope })   park + announce (the composer may mount after: it is the AI island, which
//                                       is hidden, never unmounted, so the usual case is the live listener)
//   subscribeAskSelection(on)           the composer's side; `on({ text, scope })` once per ask → unsubscribe
//   bubblePlacement(...)                where the bubble sits: under the selection, flipped above when it would
//                                       leave the window, kept inside it sideways
//   BUBBLE_SIZE · ASK_TEXT_MAX
//
// No DOM beyond the event target, no React: test/v2-ask-selection.test.ts runs it directly.

import { ASK_AI_MAX } from '../search/search-env.js';
import { annotationsScope, artboardScope, elementsScope } from './scope.js';

export const ASK_SELECTION_EVENT = 'maude:ask-selection';
export const ASK_SELECTION_PENDING_KEY = '__maudeAskSelectionPending';
export const ASK_TEXT_MAX = ASK_AI_MAX;

/** The bubble's box (CSS px) — placement needs it before it has painted. */
export const BUBBLE_SIZE = { w: 448, h: 56 };
const GAP = 12;
const MARGIN = 8;

/**
 * Hand a person's words, scoped to their selection, to the AI chat's composer. Refused (false) when there are
 * no words or no valid element in the scope.
 */
export function sendAskSelection({ text, scope } = {}, target = globalThis) {
  const words = typeof text === 'string' ? text.trim().slice(0, ASK_TEXT_MAX) : '';
  if (!words) return false;
  const ok =
    scope?.kind === 'elements'
      ? elementsScope(scope.refs, scope.selected)
      : // S4.15 — "Make these changes" on the AI's offer: the same stickies, plus the ids it answers
        scope?.kind === 'annotations'
        ? annotationsScope(scope)
        : scope?.kind === 'artboards' && scope.ids?.length === 1
          ? artboardScope(scope.ids[0])
          : null;
  if (!ok) return false;
  const detail = { text: words, scope: ok };
  target[ASK_SELECTION_PENDING_KEY] = detail;
  target.dispatchEvent?.(new CustomEvent(ASK_SELECTION_EVENT, { detail }));
  return true;
}

export function subscribeAskSelection(on, target = globalThis) {
  const take = (detail) => {
    target[ASK_SELECTION_PENDING_KEY] = undefined;
    const kind = detail?.scope?.kind;
    if (detail?.text && (kind === 'elements' || kind === 'artboards' || kind === 'annotations'))
      on(detail);
  };
  if (target[ASK_SELECTION_PENDING_KEY]) take(target[ASK_SELECTION_PENDING_KEY]);
  const handler = (e) => take(e?.detail);
  target.addEventListener?.(ASK_SELECTION_EVENT, handler);
  return () => target.removeEventListener?.(ASK_SELECTION_EVENT, handler);
}

/**
 * Where the bubble goes, in window px. `frame` is the canvas iframe's box in the window; `rect` the selection's
 * box in the iframe's viewport (what the canvas reported). Under the selection, its left edge; above it when
 * there is no room below; always inside the window.
 * @returns {{ left: number, top: number, above: boolean }}
 */
export function bubblePlacement(frame, rect, viewport, size = BUBBLE_SIZE) {
  const x = frame.left + rect.x;
  const y = frame.top + rect.y;
  const maxLeft = Math.max(MARGIN, viewport.w - size.w - MARGIN);
  const left = Math.min(Math.max(x, MARGIN), maxLeft);
  const below = y + rect.h + GAP;
  const fits = below + size.h + MARGIN <= viewport.h;
  const above = !fits && y - GAP - size.h >= MARGIN;
  const top = above
    ? y - GAP - size.h
    : Math.min(below, Math.max(MARGIN, viewport.h - size.h - MARGIN));
  return { left: Math.round(left), top: Math.round(top), above };
}
