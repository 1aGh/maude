// editing/object-actions.ts — the canvas wiring of the S2.6 object ops (S2.6, ed-obj-order).
//
// One hook, `useObjectOps()`, used by the editing layer (keys, the shell's `run-action`) and by the
// canvas context menu (canvas-shell's element registry), so the menu row, the chord and ⌘K all run
// the same function. It owns three small things the ops need from the DOM: the objects a menu acts
// on (the whole selection when the pointer is on one of them), "select matching", and selecting the
// frame a write created once the canvas has re-rendered it.

import { useMemo, useRef } from 'react';

import { showCanvasToast } from '../canvas-notifications.tsx';
import type { ContextTarget } from '../context-menu.tsx';
import { hoverTargetToSelection, resolveSelectionEl } from '../dom-selection.ts';
import { hasStyleToMatch, matchSignature } from '../edit-ops/select-matching.ts';
import type { ElementRef } from '../edit-ops/types.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import type { ObjectMenuDeps } from './object-menu.tsx';
import { type ObjectOpAction, type ObjectOpDeps, refsOf, runObjectOp } from './object-ops.ts';

type HoverArg = Parameters<typeof hoverTargetToSelection>[0];

const artboardOf = (el: Element): string | null =>
  el.closest('[data-dc-screen]')?.getAttribute('data-dc-screen') ?? null;

/** `el` as an ElementRef (its index among same-id nodes in its artboard when it is a repeat). */
export function refOfElement(el: Element): ElementRef | null {
  const id = el.getAttribute('data-cd-id');
  const artboard = artboardOf(el);
  if (!id || !artboard) return null;
  const body = el.closest('.dc-artboard-body');
  let occ = 0;
  if (body) {
    try {
      occ = Math.max(
        0,
        Array.from(body.querySelectorAll(`[data-cd-id="${CSS.escape(id)}"]`)).indexOf(el)
      );
    } catch {
      occ = 0;
    }
  }
  return occ ? { artboard, element: id, occurrence: occ } : { artboard, element: id };
}

export const selectionOf = (el: Element): Selection =>
  hoverTargetToSelection({
    el,
    cdId: el.getAttribute('data-cd-id'),
    artboardId: artboardOf(el),
  } as HoverArg);

/** Every stamped element in `ref`'s artboard whose "same style" signature equals `el`'s. */
export function matchingElements(el: Element): Element[] {
  const parts = (e: Element) => ({
    tag: e.tagName,
    className: e.getAttribute('class'),
    style: e.getAttribute('style'),
  });
  const mine = parts(el);
  if (!hasStyleToMatch(mine)) return [];
  const want = matchSignature(mine);
  const body = el.closest('.dc-artboard-body');
  if (!body) return [];
  return Array.from(body.querySelectorAll('[data-cd-id]')).filter(
    (e) => matchSignature(parts(e)) === want
  );
}

/** Select `refs` as soon as the canvas shows them (a structural write re-renders asynchronously). */
export function selectWhenRendered(
  refs: ElementRef[],
  replace: (s: Selection[]) => void,
  doc: Document = document
): void {
  let tries = 0;
  const attempt = () => {
    const els: Element[] = [];
    for (const r of refs) {
      const el = doc.querySelector(
        `[data-dc-screen="${CSS.escape(r.artboard)}"] [data-cd-id="${CSS.escape(r.element)}"]`
      );
      if (el) els.push(el);
    }
    if (els.length === refs.length && els.length > 0) return replace(els.map(selectionOf));
    if (++tries < 25) setTimeout(attempt, 100);
  };
  attempt();
}

export interface ObjectOps {
  run(action: ObjectOpAction, refs?: ElementRef[], params?: Record<string, unknown>): Promise<void>;
  menuDeps: ObjectMenuDeps;
}

export function useObjectOps(): ObjectOps {
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const live = useRef({ selSet, undo });
  live.current = { selSet, undo };
  return useMemo<ObjectOps>(() => {
    const deps: ObjectOpDeps = {
      toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
      record: (rec) => live.current.undo?.record(rec),
      select: (refs) => selectWhenRendered(refs, (s) => live.current.selSet.replace(s)),
    };
    const run: ObjectOps['run'] = async (action, refs, params) => {
      await runObjectOp(action, refs ?? refsOf(live.current.selSet.selected), deps, params);
    };
    const selectedElements = (): Element[] =>
      live.current.selSet.selected
        .map((s) => (s.id ? resolveSelectionEl(document, s) : null))
        .filter((e): e is Element => !!e);
    const elementsFor = (t: ContextTarget): Element[] => {
      const picked = selectedElements();
      if (t.el && picked.includes(t.el)) return picked;
      return t.el ? [t.el] : picked;
    };
    const menuDeps: ObjectMenuDeps = {
      elementsFor,
      run: (action, t) => {
        const refs = elementsFor(t)
          .map(refOfElement)
          .filter((r): r is ElementRef => !!r);
        void run(action, refs);
      },
      selectMatching: (t) => {
        const found = t.el ? matchingElements(t.el) : [];
        if (found.length > 1) live.current.selSet.replace(found.map(selectionOf));
        else showCanvasToast('Nothing else has this style.', 'info');
      },
    };
    return { run, menuDeps };
  }, []);
}
