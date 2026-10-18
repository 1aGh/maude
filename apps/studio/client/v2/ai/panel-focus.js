// client/v2/ai/panel-focus.js — S5.8 (03 `ai-open`): ⌘/ opens the AI chat panel AND focuses its field; esc
// gives focus back to where it came from.
//
// Pure DOM helpers (no React) so test/v2-ai-island-focus.test.tsx can drive them against happy-dom.

/** Event a caller fires to put focus in the field of an already-open AI chat panel (⌘/ while it shows). */
export const FOCUS_AI_EVENT = 'maude:focus-ai';

/** Ask the open AI chat panel to focus its field. */
export function requestFocusAI(target = globalThis) {
  target.dispatchEvent?.(new CustomEvent(FOCUS_AI_EVENT));
}

/** ⌘/ with the AI chat panel already showing and focus somewhere else: focus its field rather than fold it.
 *  True when that is the case (the caller then calls `requestFocusAI`); false → the caller toggles. */
export function aiPanelWantsFocus(doc = globalThis.document) {
  const island = doc?.querySelector?.('[data-testid="ai-chat-island"]');
  if (
    !island ||
    island.getAttribute('aria-hidden') === 'true' ||
    island.style?.display === 'none'
  ) {
    return false;
  }
  return !island.contains(doc.activeElement);
}

/** Is `el` shown? Inline `display:none` on it or any ancestor up to `root` (the panel hides a chat that way). */
function shown(el, root) {
  for (let n = el; n && n !== root?.parentElement; n = n.parentElement) {
    if (n.hidden || n.style?.display === 'none') return false;
  }
  return true;
}

/** The composer field of the chat that is showing (not the hidden ones), or null. */
export function composerField(root) {
  if (!root) return null;
  for (const ta of root.querySelectorAll('textarea.chat-input')) {
    if (!ta.disabled && shown(ta, root)) return ta;
  }
  return null;
}

/** Focus the field and put the caret at the end. Returns whether it took focus. */
export function focusComposer(root) {
  const ta = composerField(root);
  if (!ta) return false;
  ta.focus({ preventScroll: true });
  try {
    const n = ta.value.length;
    ta.setSelectionRange(n, n);
  } catch {
    /* a field type without a selection */
  }
  return root.ownerDocument.activeElement === ta;
}

/** Did esc come from the composer field, with nobody having used it already (a menu, the slash list)? */
export function isComposerEscape(e) {
  return (
    e.key === 'Escape' &&
    !e.defaultPrevented &&
    !e.isComposing &&
    !e.shiftKey &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    e.target?.matches?.('textarea.chat-input')
  );
}
