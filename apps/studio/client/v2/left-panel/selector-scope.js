// client/v2/left-panel/selector-scope.js — S11.9: the canvas half of "Select by selector" (bridge
// `select-by-selector {selector}`, 06 · ad-left), as a pure function over a Document so the canvas shell and
// the tests run the same code.
//
//   SCOPED   a match counts only INSIDE an artboard (`[data-dc-screen]`): the canvas's own chrome, the
//            toolbar, halos and the stage around the boards are never selected.
//   CAPPED   at most `cap` elements (500); `truncated` says there were more, so the shell can say so.
//   SAFE     a selector is only ever handed to `querySelectorAll`; an invalid one answers `invalid`
//            (never thrown into the message handler), an over-long one is refused before it is parsed.
//
// The shell then selects the matches through the existing selection path (`selSet.replace`), so there is no
// second selection mechanism. Nothing here reads or writes the project.

import { SELECT_CAP, SELECTOR_MAX_LEN } from './advanced-model.js';

const ARTBOARD = '[data-dc-screen]';

/**
 * @param {Document} doc
 * @param {string} selector
 * @returns {{ ok: true, els: Element[], truncated: boolean } | { ok: false, reason: 'empty'|'long'|'invalid' }}
 */
export function scopedMatches(doc, selector, cap = SELECT_CAP) {
  const sel = typeof selector === 'string' ? selector.trim() : '';
  if (!sel) return { ok: false, reason: 'empty' };
  if (sel.length > SELECTOR_MAX_LEN) return { ok: false, reason: 'long' };
  const els = [];
  const seen = new Set();
  try {
    for (const board of doc.querySelectorAll(ARTBOARD)) {
      for (const el of board.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        if (els.length >= cap) return { ok: true, els, truncated: true };
        seen.add(el);
        els.push(el);
      }
    }
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, els, truncated: false };
}
