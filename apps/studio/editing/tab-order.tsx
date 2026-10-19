// editing/tab-order.tsx — tab walks the objects in reading order (S2.21; artboard `ed-edge-keys`, rule
// `every-object-reachable-without-a-mouse`).
//
//   tab / ⇧tab   the next / previous object ON THE LEVEL YOU ARE ON, in reading order — left to right inside a
//                row, top to bottom down a column; the last one wraps to the first
//   ↵            goes inside (`object.enter`), tab then walks the children      esc    comes back out
//   badges       1…6 on the level, 4.1…4.3 inside the focused frame — the same order the keys use
//
// The order is the page's reading order, not the source's: a flex row laid out `row-reverse`, or an absolutely
// placed card, reads where it is drawn. Nothing is selected → tab takes the first object of the first artboard; an
// artboard is selected → the first object inside it.
//
// The ordering is pure over small measurements (`Measure`), so test/v2-edit-keyboard.test.tsx walks a fixture
// without a layout engine; the DOM fills the measurements in.

import { useEffect, useRef } from 'react';

import { resolveSelectionEl } from '../dom-selection.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { selectionForElement, stampedParent } from './selection.tsx';

const STAMPED = '[data-cd-id]';

/** What the walk needs to know about an element's box and whether it is on the page at all. */
export interface Measure {
  rectOf(el: Element): { left: number; top: number; width: number; height: number };
  shown(el: Element): boolean;
}

export const domMeasure: Measure = {
  rectOf: (el) => el.getBoundingClientRect(),
  shown: (el) =>
    el.getClientRects().length > 0 &&
    (typeof getComputedStyle !== 'function' || getComputedStyle(el).visibility !== 'hidden'),
};

/**
 * Reading order of two boxes: the one clearly higher goes first; boxes whose vertical middles fall within
 * each other's half height are one row, and read left to right. (A column is the same rule with no two in a row.)
 */
export function readsBefore(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number }
): number {
  const am = a.top + a.height / 2;
  const bm = b.top + b.height / 2;
  const slack = Math.min(a.height, b.height) / 2;
  if (Math.abs(am - bm) <= slack) return a.left - b.left || a.top - b.top;
  return am - bm;
}

/** The artboard body an element sits in. */
const bodyOf = (el: Element): Element | null => el.closest('.dc-artboard-body');

/** The stamped objects whose parent object is `parent` (null = straight in the artboard body `body`), in reading order. */
export function levelIn(
  body: Element,
  parent: Element | null,
  measure: Measure = domMeasure
): Element[] {
  const all = Array.from(body.querySelectorAll(STAMPED)).filter(
    (el) => stampedParent(el) === parent && measure.shown(el)
  );
  return all
    .map((el) => ({ el, rect: measure.rectOf(el) }))
    .sort((x, y) => readsBefore(x.rect, y.rect))
    .map((x) => x.el);
}

/** The level `el` belongs to, in reading order (el included). */
export function siblingsOf(el: Element, measure: Measure = domMeasure): Element[] {
  const body = bodyOf(el);
  return body ? levelIn(body, stampedParent(el), measure) : [el];
}

/** "4" for the fourth object of the top level, "4.2" for the second inside it. */
export function orderBadge(el: Element, measure: Measure = domMeasure): string {
  const parts: number[] = [];
  for (let at: Element | null = el; at; at = stampedParent(at)) {
    const i = siblingsOf(at, measure).indexOf(at);
    parts.unshift(i < 0 ? 1 : i + 1);
  }
  return parts.join('.');
}

/** Where `el` stands among its siblings: `{ n: 4, of: 6 }`. */
export function positionOf(el: Element, measure: Measure = domMeasure): { n: number; of: number } {
  const sibs = siblingsOf(el, measure);
  return { n: Math.max(0, sibs.indexOf(el)) + 1, of: sibs.length };
}

/** The artboard bodies in document order — what tab takes when nothing is selected. */
const bodies = (doc: Document): Element[] => Array.from(doc.querySelectorAll('.dc-artboard-body'));

/**
 * The element tab / ⇧tab lands on, or null when there is nothing to land on.
 *   one object selected    → its next / previous sibling, wrapping
 *   an artboard selected   → the first (last for ⇧tab) object inside it
 *   nothing selected       → the first (last) object of the first artboard that has one
 */
export function stepFrom(
  doc: Document,
  selected: readonly Selection[],
  dir: 1 | -1,
  measure: Measure = domMeasure
): Element | null {
  const last = [...selected].reverse().find((s) => s.id || s.artboardId);
  if (last?.id) {
    const el = resolveSelectionEl(doc, last);
    if (el) {
      const sibs = siblingsOf(el, measure);
      if (sibs.length === 0) return null;
      const at = sibs.indexOf(el);
      if (at < 0) return sibs[dir > 0 ? 0 : sibs.length - 1] ?? null;
      return sibs[(at + dir + sibs.length) % sibs.length] ?? null;
    }
  }
  const take = (body: Element): Element | null => {
    const top = levelIn(body, null, measure);
    return (dir > 0 ? top[0] : top[top.length - 1]) ?? null;
  };
  if (last?.artboardId) {
    const screen = doc.querySelector(`[data-dc-screen="${CSS.escape(last.artboardId)}"]`);
    const body = screen?.querySelector('.dc-artboard-body') ?? null;
    const hit = body ? take(body) : null;
    if (hit) return hit;
  }
  for (const body of bodies(doc)) {
    const hit = take(body);
    if (hit) return hit;
  }
  return null;
}

/** The selection tab lands on (select-set carries it to the shell like any other pick). */
export function stepSelection(
  doc: Document,
  selected: readonly Selection[],
  dir: 1 | -1,
  measure: Measure = domMeasure
): Selection | null {
  const el = stepFrom(doc, selected, dir, measure);
  return el ? selectionForElement(el) : null;
}

// ── the badges ──────────────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
.ed-order {
  position: fixed;
  pointer-events: none;
  z-index: 7;
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--maude-chrome-bg-1);
  color: var(--maude-chrome-fg-1);
  box-shadow: inset 0 0 0 1px var(--maude-chrome-border), 0 1px 2px var(--maude-chrome-shadow);
  font: 600 11px/1 var(--maude-chrome-font-mono);
  font-variant-numeric: tabular-nums;
}
.ed-order[data-on] {
  background: var(--ed-focus-ring);
  color: var(--ed-focus-ring-fg);
  box-shadow: 0 1px 2px var(--maude-chrome-shadow);
}
.ed-order--in {
  box-shadow: none;
  outline: 1px dashed var(--maude-chrome-fg-1);
}
`;

interface BadgeSpec {
  key: string;
  el: Element;
  text: string;
  on: boolean;
  inside: boolean;
}

/** The badges for the focused object's level and, dashed, its children. Pure over the DOM + measurements. */
export function badgesFor(focused: Element, measure: Measure = domMeasure): BadgeSpec[] {
  const out: BadgeSpec[] = [];
  const level = siblingsOf(focused, measure);
  const prefix = (() => {
    const p = stampedParent(focused);
    return p ? `${orderBadge(p, measure)}.` : '';
  })();
  for (const [i, el] of level.entries())
    out.push({
      key: `l${i}`,
      el,
      text: `${prefix}${i + 1}`,
      on: el === focused,
      inside: false,
    });
  const body = bodyOf(focused);
  if (body) {
    const here = orderBadge(focused, measure);
    for (const [i, el] of levelIn(body, focused, measure).entries())
      out.push({ key: `c${i}`, el, text: `${here}.${i + 1}`, on: false, inside: true });
  }
  return out;
}

/**
 * The reading-order badges: drawn while the keyboard is walking (the last thing touched was a key, not the
 * pointer), on the focused object's level and inside it. Nothing for a pointer user.
 */
export function OrderBadges({ active }: { active: boolean }) {
  const { selected } = useSelectionSet();
  const host = useRef<HTMLDivElement | null>(null);
  const one = selected.length === 1 && selected[0]?.id ? (selected[0] as Selection) : null;

  useEffect(() => {
    const root = host.current;
    if (!active || !one || !root || typeof document === 'undefined') return;
    let raf: number | null = null;
    let sig = '';
    const nodes = new Map<string, HTMLSpanElement>();
    const tick = () => {
      const el = resolveSelectionEl(document, one);
      const specs = el ? badgesFor(el) : [];
      const next = specs.map((s) => `${s.key}:${s.text}:${s.on ? 1 : 0}`).join('|');
      if (next !== sig) {
        sig = next;
        root.textContent = '';
        nodes.clear();
        for (const s of specs) {
          const n = document.createElement('span');
          n.className = `ed-order${s.inside ? ' ed-order--in' : ''}`;
          n.setAttribute('data-testid', 'edit-order-badge');
          n.setAttribute('data-order', s.text);
          if (s.on) n.setAttribute('data-on', 'true');
          n.setAttribute('aria-hidden', 'true');
          n.textContent = s.text;
          root.appendChild(n);
          nodes.set(s.key, n);
        }
      }
      for (const s of specs) {
        const n = nodes.get(s.key);
        if (!n || !s.el.isConnected) continue;
        const r = s.el.getBoundingClientRect();
        n.style.left = `${Math.round(r.left) + 5}px`;
        n.style.top = `${Math.round(r.top) + 5}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      root.textContent = '';
    };
  }, [active, one]);

  if (!active || !one) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      <div ref={host} data-testid="edit-order-badges" aria-hidden="true" />
    </>
  );
}
