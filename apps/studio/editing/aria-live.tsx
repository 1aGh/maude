// editing/aria-live.tsx — what VoiceOver hears when the keyboard lands on an object (S2.21; artboard
// `ed-edge-keys`: “Services, frame, 3 items, in a row — 4 of 6. Press Return to go inside.”).
//
// The objects themselves are not focusable DOM — the canvas is one surface and the selection is the focus — so
// the message goes through a polite live region. It speaks the way the design words it: the name, the kind, how
// many items it holds and how they are laid out, where it stands among its siblings, and what ↵ will do.
// Spoken only while the keyboard is the last thing used (a click on an object is not announced a second time).
//
// `describeFocus` is pure — test/v2-edit-keyboard.test.tsx pins the strings — and `factsOf` reads one element.

import { useEffect, useRef, useState } from 'react';

import type { SelectionKind } from '../bridge/dgn-protocol.ts';
import { resolveSelectionEl } from '../dom-selection.ts';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { crumbLabel, selectionKind, tagWord } from './crumbs.ts';
import { useKeyboardModality } from './focus-model.tsx';
import { crumbNodeOf, stampedParent } from './selection.tsx';
import { domMeasure, type Measure, positionOf } from './tab-order.tsx';

export type LayoutWord = 'row' | 'column' | 'grid';

export interface FocusFacts {
  name: string;
  kind: SelectionKind;
  /** objects directly inside */
  items: number;
  layout: LayoutWord | null;
  /** 1-based place among the siblings, and how many there are */
  n: number;
  of: number;
}

const KIND_WORD: Record<SelectionKind, string> = {
  frame: 'frame',
  text: 'text',
  image: 'image',
  path: 'path',
  shape: 'shape',
  instance: 'component',
  artboard: 'artboard',
  multi: 'selection',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The sentence. Frame / component / artboard with items: “Press Return to go inside.”; text: “… to type.” */
export function describeFocus(f: FocusFacts): string {
  const parts: string[] = [f.name || 'Untitled', KIND_WORD[f.kind]];
  if (f.items > 0) parts.push(plural(f.items, 'item', 'items'));
  if (f.layout) parts.push(`in a ${f.layout}`);
  let line = parts.join(', ');
  if (f.of > 1) line += ` — ${f.n} of ${f.of}`;
  line += '.';
  if (f.kind === 'text') line += ' Press Return to type.';
  else if (f.items > 0) line += ' Press Return to go inside.';
  return line;
}

function layoutOf(el: Element): LayoutWord | null {
  if (typeof getComputedStyle !== 'function') return null;
  const cs = getComputedStyle(el);
  if (cs.display === 'grid' || cs.display === 'inline-grid') return 'grid';
  if (cs.display === 'flex' || cs.display === 'inline-flex')
    return cs.flexDirection.startsWith('column') ? 'column' : 'row';
  return null;
}

const itemsOf = (el: Element, measure: Measure): number =>
  Array.from(el.querySelectorAll('[data-cd-id]')).filter(
    (c) => stampedParent(c) === el && measure.shown(c)
  ).length;

/**
 * What VoiceOver calls the object: its crumb name, and — for a frame that has none of its own (no layer name, no
 * label, no loose words, so the crumb would be the tag, “div”) — the first heading inside it (“Services”).
 */
export function spokenNameOf(el: Element): string {
  const node = crumbNodeOf(el);
  const label = crumbLabel(node);
  if (label !== tagWord(node.tag)) return label;
  const heading = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
  const words = (heading?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return words ? crumbLabel({ ...node, text: words }) : label;
}

/** What the screen reader needs to know about the focused object. */
export function factsOf(el: Element, measure: Measure = domMeasure): FocusFacts {
  const items = itemsOf(el, measure);
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const { n, of } = positionOf(el, measure);
  return {
    name: spokenNameOf(el),
    kind: selectionKind(1, {
      tag: el.tagName,
      elements: el.children.length,
      hasText: text.length > 0 && items === 0,
      component: el.hasAttribute('data-dc-component'),
      shape: el.hasAttribute('data-shape') && el.getAttribute('data-shape') !== 'path',
      path: el.getAttribute('data-shape') === 'path',
    }),
    items,
    layout: items > 0 ? layoutOf(el) : null,
    n,
    of,
  };
}

const SR_ONLY = `
.ed-sr-only {
  position: fixed;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`;

/** The live region. Speaks when the keyboard selects something; silent for the pointer. */
export function AriaLive() {
  const { selected } = useSelectionSet();
  const kb = useKeyboardModality();
  const [message, setMessage] = useState('');
  const spoken = useRef('');
  const one = selected.length === 1 && selected[0]?.id ? (selected[0] as Selection) : null;

  useEffect(() => {
    if (!kb || !one || typeof document === 'undefined') {
      spoken.current = '';
      return;
    }
    // after select-set has landed in the DOM
    const id = setTimeout(() => {
      const el = resolveSelectionEl(document, one);
      if (!el) return;
      const next = describeFocus(factsOf(el));
      // the same words twice in a row would be swallowed by the live region; a trailing NBSP re-announces
      setMessage(next === spoken.current ? `${next} ` : next);
      spoken.current = next;
    }, 0);
    return () => clearTimeout(id);
  }, [kb, one]);

  return (
    <>
      <style>{SR_ONLY}</style>
      <div
        className="ed-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="edit-aria-live"
      >
        {message}
      </div>
    </>
  );
}
