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
