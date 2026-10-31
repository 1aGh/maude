// editing/selection-follow.tsx — r2-text-tool (UX audit design D3, user-advocate U11): the Inspector's values follow
// the object. X / Y / W / H and every knob read the selection payload (`authored`, `geometry`), which the canvas
// measured when the object was picked. A drag (the optimistic left / top before the write lands), an arrow nudge, an
// undo / redo or a teammate's change moves the object without a new pick, so the Inspector kept "X 57 · Y 286" while
// the object sat at 846.
//
// This watches the SELECTED elements only — an attribute change on one of them, or one of them leaving the document
// (a reload remounted it) — and, at most every FOLLOW_MS and never mid-drag, re-measures them. When what the
// Inspector reads changed, the same selection is posted again (the shell treats the same selector as no new pick:
// no Inspector auto-open, no panel fold — P8 c6). Pan / zoom moves only the screen `bounds`, which is not compared.

import { useEffect, useRef } from 'react';

import { resolveSelectionEl } from '../dom-selection.ts';
import { isElementDragActive } from '../drag-state.ts';
import { type Selection, useSelectionSetOptional } from '../use-selection-set.tsx';
import { selectionOf } from './object-actions.ts';

export const FOLLOW_MS = 120;

/** What the Inspector reads off a selection that can change while it stays selected. */
const readOf = (s: Selection): string =>
  JSON.stringify([s.authored ?? null, s.geometry ?? null, s.worldW ?? null, s.worldH ?? null]);

/**
 * The selection re-measured from the document, or null when nothing the Inspector reads has changed (or an entry
 * cannot be found — a remount in flight; the next mutation tries again).
 */
export function refreshSelection(
  doc: Document,
  selected: readonly Selection[]
): Selection[] | null {
  if (selected.length === 0) return null;
  let changed = false;
  const next: Selection[] = [];
  for (const s of selected) {
    if (!s.id) {
      next.push(s);
      continue;
    }
    const el = resolveSelectionEl(doc, s);
    if (!el) return null;
    const fresh = { ...s, ...selectionOf(el), file: s.file, index: s.index };
    if (readOf(fresh) !== readOf(s)) changed = true;
    next.push(fresh);
  }
  return changed ? next : null;
}

export function SelectionFollowsDom() {
  const selSet = useSelectionSetOptional();
  const live = useRef(selSet);
  live.current = selSet;
  // which objects are selected (not their payload): a re-measure keeps the key, a new pick changes it
  const pickKey = (selSet?.selected ?? [])
    .filter((s) => s.id)
    .map((s) => `${s.selector}#${s.index ?? 0}`)
    .join('|');

  useEffect(() => {
    if (!pickKey || typeof MutationObserver === 'undefined' || typeof document === 'undefined')
      return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let els: Element[] = [];
    const resolve = () => {
      els = (live.current?.selected ?? [])
        .filter((s) => s.id)
        .map((s) => resolveSelectionEl(document, s))
        .filter((e): e is Element => !!e);
    };
    resolve();
    const check = () => {
      timer = null;
      if (isElementDragActive()) {
        timer = setTimeout(check, FOLLOW_MS);
        return;
      }
      const cur = live.current;
      if (!cur) return;
      const next = refreshSelection(document, cur.selected);
      if (next) cur.replace(next);
      resolve();
    };
    const mo = new MutationObserver((records) => {
      if (timer) return;
      const relevant =
        els.some((el) => !el.isConnected) ||
        // mid-remount the selection resolved to nothing: the next added node may be it
        (els.length === 0 && records.some((r) => r.type === 'childList')) ||
        records.some((r) => r.type === 'attributes' && els.includes(r.target as Element));
      if (relevant) timer = setTimeout(check, FOLLOW_MS);
    });
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    return () => {
      mo.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [pickKey]);

  return null;
}
