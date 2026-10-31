// S2.12b — the Edit Text tool (`el-text`) is click to type. One click, one of three answers:
// type in place into the editable text under it, say the text is filled in from code, or add a
// text where the pointer acted and type into it at once (r2-text-tool, UX audit U01 · D1 · A1).
//
// The add is ONE edit-op (`object.insert-shape` kind `text`, the Shape tool's lane): the text lands at the click in
// the container's own px, wears the system's body style when the canvas has one (GD-10), is selected, and opens in
// place with its words selected. Keys typed while the write is on its way are held, not routed: a single-key
// shortcut never fires between the click and the caret (they are typed into the text when it opens).
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import type { CommandRecord } from '../undo-stack.ts';
import { pointToLocal } from './draw-geometry.ts';
import { containerAt, localFrame } from './draw-tools.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refOfElement } from './object-actions.ts';
import { declaredTypeValues } from './type-role.ts';

/** canvas-shell.tsx listens: enter the in-place caret on this element. */
export const ENTER_TEXT_EDIT_EVENT = 'maude:enter-text-edit';

export type ClickToType = 'edit' | 'code' | 'insert';

export function clickToType(
  doc: Document,
  target: HTMLElement | null,
  at: { clientX: number; clientY: number },
  deps: InsertTextDeps = {}
): ClickToType {
  if (!target) {
    void insertTextAt(doc, { x: at.clientX, y: at.clientY }, deps);
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

// ── a new text at the pointer ───────────────────────────────────────────────────────────────

/** The one line a Text click off every artboard gets (CONTRACT §4: what happened, then the way on). */
export const TEXT_NOT_ON_ARTBOARD = 'Click on an artboard to add text there.';
/** The system's body style (`.t-body`, the design-system template's body role). */
export const BODY_ROLE = 't-body';

export interface InsertTextDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string) => void;
  record?: (rec: CommandRecord) => void;
  /** select the new text (the canvas selection set's replace, by ref) */
  select?: (created: ElementRef[]) => void;
  /** how long to wait for the new text to render before giving up the caret (ms) */
  waitMs?: number;
}

/** True when the canvas's stylesheets carry the system's body style. */
export function hasBodyRole(doc: Document): boolean {
  try {
    return Object.keys(declaredTypeValues(doc, BODY_ROLE)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Hold printable keys from the moment of the click until the text opens: the canvas router (and the shell's
 * crossing keys behind it) never hear them, so N / C / S / E cannot switch mode or open a picker mid-word. A key with
 * ⌘ / ⌃ / ⌥ still goes through (⌘Z is not typing); esc gives the hold up. Window capture runs before the router's
 * document capture listener.
 */
export function holdTyping(doc: Document, maxMs = 4000): { typed(): string; release(): void } {
  const win = doc.defaultView;
  let typed = '';
  let done = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      release();
      return;
    }
    if (e.key.length === 1) typed += e.key;
    else if (e.key === 'Backspace') typed = typed.slice(0, -1);
    else if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const timer = setTimeout(() => release(), maxMs);
  function release(): void {
    if (done) return;
    done = true;
    clearTimeout(timer);
    win?.removeEventListener('keydown', onKey, true);
  }
  win?.addEventListener('keydown', onKey, true);
  return { typed: () => typed, release };
}

/** Resolve once `[data-cd-id=element]` of that artboard is in the document (null after `waitMs`). */
function whenRendered(doc: Document, ref: ElementRef, waitMs: number): Promise<HTMLElement | null> {
  const sel = `[data-dc-screen="${CSS.escape(ref.artboard)}"] [data-cd-id="${CSS.escape(ref.element)}"]`;
  const until = Date.now() + waitMs;
  return new Promise((resolve) => {
    const look = () => {
      const el = doc.querySelector<HTMLElement>(sel);
      if (el) return resolve(el);
      if (Date.now() >= until) return resolve(null);
      setTimeout(look, 50);
    };
    look();
  });
}

/** Put what was typed during the write into the open editor, caret at its end. */
function typeHeld(doc: Document, el: HTMLElement, typed: string): void {
  if (!typed || doc.activeElement !== el) return;
  el.textContent = typed;
  try {
    const sel = doc.defaultView?.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* no selection API: the text is in, the caret stays where the browser put it */
  }
}

/** T + a click at screen point `at` with no text under it: a new text there, open for typing. */
export async function insertTextAt(
  doc: Document,
  at: { x: number; y: number },
  deps: InsertTextDeps = {}
): Promise<boolean> {
  const c = containerAt(doc, at.x, at.y);
  if (!c) {
    deps.toast?.(TEXT_NOT_ON_ARTBOARD);
    return false;
  }
  const hold = holdTyping(doc);
  try {
    const frameRef = c.frame ? refOfElement(c.el) : null;
    const { origin, k } = localFrame(c);
    const p = pointToLocal(at, origin, k);
    const params: Record<string, unknown> = {
      kind: 'text',
      artboard: c.artboard,
      at: { x: Math.round(p.x), y: Math.round(p.y) },
    };
    const pos = frameRef ? doc.defaultView?.getComputedStyle(c.el).position : 'relative';
    if (!pos || pos === 'static') params.relativeParent = true;
    if (hasBodyRole(doc)) params.role = BODY_ROLE;
    const ask: EditOpAsk = {
      op: 'object.insert-shape',
      targets: frameRef ? [frameRef] : [],
      params,
    };
    const r = await (deps.run ?? ((a: EditOpAsk) => runEditOp(a)))(ask);
    if (!r.ok) {
      deps.toast?.(r.message || 'That did not go through.');
      return false;
    }
    if (r.actionId === null && r.writeId) {
      const rec = editOpRecord(r.writeId, 'Add text');
      if (rec) deps.record?.(rec);
    }
    const made = r.created?.[0];
    if (!made) return false;
    const el = await whenRendered(doc, made, deps.waitMs ?? 3000);
    if (!el) return false;
    deps.select?.([made]);
    const typed = hold.typed();
    hold.release();
    doc.dispatchEvent(
      new CustomEvent(ENTER_TEXT_EDIT_EVENT, {
        detail: { el, clientX: at.x, clientY: at.y, selectAll: true, escKeeps: true },
      })
    );
    typeHeld(doc, el, typed);
    return true;
  } finally {
    hold.release();
  }
}
