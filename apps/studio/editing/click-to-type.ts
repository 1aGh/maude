// S2.12b — the Edit Text tool (`el-text`) is click to type. One click, one of three answers:
// type in place into the editable text under it, say the text is filled in from code, or add a
// text element where the momentary Insert Text slot used to (the toolbar's insert verb).
import { TOOLBAR_INSERT_EVENT } from '../input-router.tsx';

/** canvas-shell.tsx listens: enter the in-place caret on this element. */
export const ENTER_TEXT_EDIT_EVENT = 'maude:enter-text-edit';

export type ClickToType = 'edit' | 'code' | 'insert';

export function clickToType(
  doc: Document,
  target: HTMLElement | null,
  at: { clientX: number; clientY: number }
): ClickToType {
  if (!target) {
    doc.dispatchEvent(new CustomEvent(TOOLBAR_INSERT_EVENT, { detail: { kind: 'text' } }));
    return 'insert';
  }
  // Leaf-looking text the engine would refuse (mixed / expression source, no build-time
  // `data-cd-editable` marker) gets an honest hint, not a new element dropped on top of it.
  if (!target.hasAttribute('data-cd-editable')) return 'code';
  doc.dispatchEvent(
    new CustomEvent(ENTER_TEXT_EDIT_EVENT, {
      detail: { el: target, clientX: at.clientX, clientY: at.clientY },
    })
  );
  return 'edit';
}

/**
 * V2-8.7 — ↵ on a selected text object: the keyboard door of the same edit. The announcement says "Press Return to
 * type" (aria-live.tsx) and a keyboard-only run reaches the text with tab, so ↵ must open it the way a double click
 * does: in place, the whole text selected (ready to overwrite). A frame that holds objects is not a typing door
 * (↵ goes inside it — `enterSelection`); text filled in from code says so ('code'), as a click does.
 */
export function typeIntoSelected(doc: Document, el: HTMLElement | null): 'edit' | 'code' | null {
  if (!el) return null;
  const kids = Array.from(el.childNodes);
  if (kids.length === 0 || !kids.every((n) => n.nodeType === 3)) return null;
  if (!el.hasAttribute('data-cd-editable')) return 'code';
  doc.dispatchEvent(
    new CustomEvent(ENTER_TEXT_EDIT_EVENT, {
      detail: { el, clientX: 0, clientY: 0, selectAll: true },
    })
  );
  return 'edit';
}
