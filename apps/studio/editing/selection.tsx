// editing/selection.tsx — the selection model of Edit mode (S2.1, artboard ed-obj-enter).
//
//   click        selects the top object at the current depth (CanvasRouter onSelect, v1 + the
//                entered-group context);
//   double-click goes inside one level (CanvasRouter onDbl drill) — registry `object.enter`, ↵ too;
//   esc          steps out one level: the selected object's parent, and at the top the artboard
//                selection is dropped (`object.step-out`, the first rung of `ui.step-back`);
//   locked       a click on a locked object selects its nearest unlocked parent (V2-1.4 §5.5).
//
// Chrome: a dashed outline on the parent of a single selection (where you are "inside") and a name
// tag "Brand systems · 400 × 232". The shell gets refs / crumbs / kind with every `select-set`
// (S2-edit-ops.md §7) through use-selection-set's describer seam.

import { useEffect, useRef } from 'react';

import type { SelectionCrumb } from '../bridge/dgn-protocol.ts';
import { hoverTargetToSelection, resolveSelectionEl } from '../dom-selection.ts';
import type { ElementRef } from '../edit-ops/types.ts';
import { type Selection, setSelectionDescriber, useSelectionSet } from '../use-selection-set.tsx';
import {
  buildCrumbs,
  type CrumbNode,
  crumbLabel,
  layoutTag,
  nameTag,
  selectionKind,
  tagParts,
} from './crumbs.ts';
import { tokenRuler } from './token-ruler.tsx';

const STAMPED = '[data-cd-id]';

function bodyOf(el: Element): Element | null {
  return el.closest('.dc-artboard-body');
}

function artboardIdOf(el: Element): string | null {
  return el.closest('[data-dc-screen]')?.getAttribute('data-dc-screen') ?? null;
}

/** The nearest stamped ancestor of `el` inside its artboard body, or null at the top. */
export function stampedParent(el: Element): Element | null {
  const body = bodyOf(el);
  const p = el.parentElement?.closest(STAMPED) ?? null;
  return p && body?.contains(p) && p !== body ? p : null;
}

/** `el` when it is not locked, else its nearest unlocked stamped ancestor; null = the artboard. */
export function unlockedTarget(el: Element, isLocked: (el: Element) => boolean): Element | null {
  let at: Element | null = el;
  while (at && isLocked(at)) at = stampedParent(at);
  return at;
}

/** The shared lock (V2-1.4 / V2-2.19): `data-cd-locked` on the element. */
export function isLockedDom(el: Element): boolean {
  return el.hasAttribute('data-cd-locked');
}

function occurrenceOf(el: Element, id: string): number {
  const body = bodyOf(el);
  if (!body) return 0;
  try {
    const same = Array.from(body.querySelectorAll(`[data-cd-id="${CSS.escape(id)}"]`));
    return Math.max(0, same.indexOf(el));
  } catch {
    return 0;
  }
}

/** The selection one level up, or null when `sel` is already at the top of its artboard. */
export function stepOutSelection(doc: Document, sel: Selection): Selection | null {
  if (!sel.id) return null;
  const el = resolveSelectionEl(doc, sel);
  const parent = el ? stampedParent(el) : null;
  if (!parent) return null;
  return hoverTargetToSelection({
    el: parent,
    cdId: parent.getAttribute('data-cd-id'),
    artboardId: artboardIdOf(parent),
  } as Parameters<typeof hoverTargetToSelection>[0]);
}

function ownText(el: Element): string {
  let t = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent ?? '';
  return t.replace(/\s+/g, ' ').trim();
}

export function crumbNodeOf(el: Element): CrumbNode {
  const id = el.getAttribute('data-cd-id');
  const occ = id ? occurrenceOf(el, id) : 0;
  return {
    id,
    ...(occ ? { occurrence: occ } : {}),
    // a picture pasted from Figma is named by its frame ("Hero / v3"; 14 · ed-edge-paste), not by its file
    name:
      el.getAttribute('data-dc-element') ||
      (el.getAttribute('data-source') === 'figma' ? el.getAttribute('data-source-name') : null),
    aria: el.getAttribute('aria-label'),
    text: ownText(el),
    tag: el.tagName.toLowerCase(),
  };
}

function artboardNode(el: Element): CrumbNode {
  const screen = el.closest('[data-dc-screen]');
  const label =
    screen?.querySelector(':scope > .dc-artboard-label')?.textContent ??
    screen?.getAttribute('data-dc-screen') ??
    '';
  return { id: null, tag: 'article', artboardLabel: label };
}

/** artboard › every stamped ancestor › `el`, as crumbs. */
export function crumbsForElement(el: Element): SelectionCrumb[] {
  const artboard = artboardIdOf(el);
  if (!artboard) return [];
  const chain: CrumbNode[] = [];
  for (let at: Element | null = el; at; at = stampedParent(at)) chain.unshift(crumbNodeOf(at));
  return buildCrumbs(artboard, [artboardNode(el), ...chain]);
}

/** What the shell gets with every `select-set` (S2-edit-ops.md §7). */
export function describeSelection(
  doc: Document,
  next: readonly Selection[]
): { refs: ElementRef[]; crumbs?: SelectionCrumb[]; kind: ReturnType<typeof selectionKind> } {
  const refs: ElementRef[] = [];
  for (const s of next) {
    if (!s.id || !s.artboardId) continue;
    refs.push(
      s.index
        ? { artboard: s.artboardId, element: s.id, occurrence: s.index }
        : { artboard: s.artboardId, element: s.id }
    );
  }
  if (next.length !== 1) return { refs, kind: selectionKind(next.length, null) };
  const one = next[0] as Selection;
  const el = one.id ? resolveSelectionEl(doc, one) : null;
  if (!el) {
    // a whole-artboard selection
    const screen = one.artboardId
      ? doc.querySelector(`[data-dc-screen="${CSS.escape(one.artboardId)}"]`)
      : null;
    return {
      refs,
      kind: 'artboard',
      ...(screen && one.artboardId
        ? { crumbs: buildCrumbs(one.artboardId, [artboardNode(screen)]) }
        : {}),
    };
  }
  return {
    refs,
    crumbs: crumbsForElement(el),
    kind: selectionKind(1, {
      tag: el.tagName,
      elements: el.children.length,
      hasText: ownText(el).length > 0,
      component: el.hasAttribute('data-dc-component'),
      shape: el.hasAttribute('data-shape') && el.getAttribute('data-shape') !== 'path',
      path: el.getAttribute('data-shape') === 'path',
    }),
  };
}

// ── chrome ────────────────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
.ed-parent-outline {
  position: fixed;
  pointer-events: none;
  z-index: 4;
  box-sizing: border-box;
  border: 1px dashed var(--maude-hud-accent);
  border-radius: 2px;
}
.ed-name-tag {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  /* P8 C5 (14 .ed-sel-tag): 20 px under the object, radius-xs, semibold; the size after the name is regular at .86 */
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  box-sizing: border-box;
  padding: 0 8px;
  border-radius: var(--maude-hud-radius-xs, 3px);
  background: var(--maude-hud-accent);
  color: var(--maude-hud-accent-fg);
  font: 600 var(--maude-hud-type-xs, 11px)/16px var(--maude-chrome-font-body, system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* V2-8.7: regular weight alone says "quiet" — the board's .86 left the size at 3.9:1 on the accent (AA wants 4.5) */
.ed-name-tag > .ed-tag-q { font-weight: 400; opacity: 1; }
`;

function place(div: HTMLElement | null, el: Element | null, asTag = false): void {
  if (!div) return;
  const r = el?.isConnected ? el.getBoundingClientRect() : null;
  if (!r || (r.width === 0 && r.height === 0)) {
    div.style.display = 'none';
    return;
  }
  div.style.display = 'block';
  // the name tag hangs 6 px under the object, 1.5 px left of it (the selection ring's width); the outline is on it
  div.style.left = `${Math.round(asTag ? r.left - 1.5 : r.left)}px`;
  div.style.top = `${Math.round(asTag ? r.bottom + 6 : r.top)}px`;
  if (!asTag) {
    div.style.width = `${Math.round(r.width)}px`;
    div.style.height = `${Math.round(r.height)}px`;
  }
}

/** The dashed parent outline + the name tag for a single object selection. */
export function EditingSelection({ readOnly = false }: { readOnly?: boolean }) {
  const { selected } = useSelectionSet();
  const outlineRef = useRef<HTMLDivElement | null>(null);
  const tagRef = useRef<HTMLDivElement | null>(null);

  // The describer seam: refs / crumbs / kind ride every select-set post.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setSelectionDescriber((next) => describeSelection(document, next));
    return () => setSelectionDescriber(null);
  }, []);

  const one = selected.length === 1 && selected[0]?.id ? (selected[0] as Selection) : null;
  useEffect(() => {
    if (!one || typeof document === 'undefined') return;
    let raf: number | null = null;
    const tick = () => {
      const el = resolveSelectionEl(document, one);
      place(outlineRef.current, el ? stampedParent(el) : null);
      place(tagRef.current, el, true);
      if (tagRef.current && el instanceof HTMLElement) {
        const label = crumbLabel(crumbNodeOf(el));
        // 14 ed-lay-auto: a gap drag in flight (the token ruler is up) names the layout, not the size
        const text = tokenRuler.get()
          ? layoutTag(label)
          : nameTag(label, el.offsetWidth, el.offsetHeight);
        if (tagRef.current.textContent !== text) {
          // "<name> · <w> × <h>": the name in the tag's semibold, the size after it regular (14 .ed-tag-q)
          const tag = tagRef.current;
          const [name, rest] = tagParts(text);
          tag.textContent = name;
          if (rest) {
            const q = tag.ownerDocument.createElement('span');
            q.className = 'ed-tag-q';
            q.textContent = rest;
            tag.appendChild(q);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [one]);

  if (!one || readOnly) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      <div
        ref={outlineRef}
        className="ed-parent-outline"
        data-testid="edit-parent-outline"
        aria-hidden="true"
      />
      <div ref={tagRef} className="ed-name-tag" data-testid="edit-name-tag" aria-hidden="true" />
    </>
  );
}

type HoverArg = Parameters<typeof hoverTargetToSelection>[0];
const selectionOf = (el: Element, cdId: string | null, artboardId: string | null) =>
  hoverTargetToSelection({ el, cdId, artboardId } as HoverArg);

/** S2.21 — the selection that names `el` (a stamped object), for the keyboard walk (tab-order.tsx). */
export function selectionForElement(el: Element): Selection {
  return selectionOf(el, el.getAttribute('data-cd-id'), artboardIdOf(el));
}

/** The first stamped object inside `sel` (↵ / `object.enter`), or null when it has none. */
export function enterSelection(doc: Document, sel: Selection): Selection | null {
  const el = sel.id ? resolveSelectionEl(doc, sel) : null;
  const child = el?.querySelector(STAMPED) ?? null;
  return child ? selectionOf(child, child.getAttribute('data-cd-id'), artboardIdOf(child)) : null;
}

/** esc's first rung (`object.step-out`): select the parent; false when there is none to step to. */
export function stepOut(
  selSet: { selected: readonly Selection[]; replace: (s: Selection) => void },
  doc: Document = document
): boolean {
  if (selSet.selected.length !== 1) return false;
  const up = stepOutSelection(doc, selSet.selected[0] as Selection);
  if (!up) return false;
  selSet.replace(up);
  return true;
}

/** What a click on a LOCKED `el` selects: its nearest unlocked parent, else the artboard. */
export function lockedClickSelection(
  el: Element,
  isLocked: (el: Element) => boolean
): Selection | null {
  const artboardId = artboardIdOf(el);
  const up = unlockedTarget(el, isLocked);
  if (up) return selectionOf(up, up.getAttribute('data-cd-id'), artboardId);
  const screen = el.closest('[data-dc-screen]');
  return screen && artboardId ? selectionOf(screen, null, artboardId) : null;
}
