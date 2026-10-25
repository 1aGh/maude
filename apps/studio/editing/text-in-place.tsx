// editing/text-in-place.tsx — S2.12 (ed-text-edit): the canvas half of editing text where it stands.
//
// The caret itself is canvas-shell's (double-click a leaf text, `text-caret.ts` draws the blink); this
// layer adds what the 14 Editing board shows around it:
//   · the edit-tone ring (a 1.5px accent ring and a soft halo, `.ed-sel--edit`), replacing v1's outline;
//   · while the text is Czech, the ties: a small arc under every space that will become a no-break space
//     (one-letter words, from `tiePositions`), measured from the live text so they follow every keystroke,
//     the camera and the zoom.
// The typed copy is written by `commitTextInPlace` (text-actions.ts): one edit-op, one undo step.
//
// Tokens only: the accent is the canvas's own `--maude-hud-accent`; the arc and ring take no other colour.

import { useEffect, useState } from 'react';

import { isCzech, tiePositions } from '../edit-ops/czech-ties.ts';
import { langIn } from './type-role.ts';

export const TEXT_RING_STYLE_ID = 'maude-text-in-place-css';
const EDITING = '[contenteditable].dc-text-editing';

const CSS = `
${EDITING} {
  outline: none;
  box-shadow:
    0 0 0 1.5px var(--maude-hud-accent, #0d99ff),
    0 0 0 5px color-mix(in oklab, var(--maude-hud-accent, #0d99ff) 18%, transparent);
  border-radius: 1px;
}
.dc-tie-arc {
  position: fixed;
  z-index: 2147483000;
  pointer-events: none;
  overflow: visible;
  fill: none;
  stroke: var(--maude-hud-accent, #0d99ff);
  stroke-linecap: round;
}
`;

export function ensureTextRingStyle(doc: Document = document): void {
  if (doc.getElementById(TEXT_RING_STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = TEXT_RING_STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

export interface TieArc {
  /** the index of the space in the element's text */
  at: number;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: number;
}

/** [node, offset] of the `index`th character of the element's text. */
function charAt(el: Element, index: number): [Text, number] | null {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (index < seen + len) return [n, index - seen];
    seen += len;
  }
  return null;
}

/**
 * The arcs for `el`'s text now: one under each space `tiePositions` names, in viewport px. The arc is
 * 0.6em wide and 0.25em deep, 0.15em left of the space and just under the baseline (14 Editing `.ed-tie`),
 * scaled by the canvas zoom.
 */
export function tieArcs(el: HTMLElement): TieArc[] {
  const win = el.ownerDocument.defaultView;
  if (!win) return [];
  const positions = tiePositions(el.textContent ?? '');
  if (positions.length === 0) return [];
  const box = el.getBoundingClientRect();
  const zoom = el.offsetWidth > 0 ? box.width / el.offsetWidth : 1;
  const em = (Number.parseFloat(win.getComputedStyle(el).fontSize) || 16) * (zoom || 1);
  const out: TieArc[] = [];
  for (const at of positions) {
    const start = charAt(el, at);
    if (!start) continue;
    const range = el.ownerDocument.createRange();
    range.setStart(start[0], start[1]);
    range.setEnd(start[0], start[1] + 1);
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push({
      at,
      x: r.left - 0.15 * em,
      y: r.top + 0.95 * em,
      w: 0.6 * em,
      h: 0.25 * em,
      stroke: Math.max(1, 0.12 * em),
    });
  }
  return out;
}

/**
 * P8 c10 (14 ed-text-edit): while a Czech text is typed, the page's other Czech copy shows its ties too — the board draws
 * the arcs under "v" and "s" of the body line while the headline is edited. The text-only leaves of the SAME artboard
 * whose language is Czech (capped — a page of hundreds of lines draws none past the cap).
 */
const PEER_CAP = 40;
export function czechPeers(el: HTMLElement): HTMLElement[] {
  const board = el.closest('[data-dc-screen]');
  if (!board) return [];
  const out: HTMLElement[] = [];
  for (const n of board.querySelectorAll<HTMLElement>('*')) {
    if (n === el || n.contains(el) || el.contains(n) || n.children.length > 0) continue;
    if (!(n.textContent ?? '').trim() || !isCzech(langIn(n))) continue;
    if (tiePositions(n.textContent ?? '').length === 0) continue;
    out.push(n);
    if (out.length >= PEER_CAP) break;
  }
  return out;
}

const sig = (arcs: TieArc[]): string =>
  arcs.map((a) => `${a.at}:${Math.round(a.x)},${Math.round(a.y)},${Math.round(a.w)}`).join('|');

/** Mounted once by the editing layer: the ring style, and the tie arcs of the text being edited. */
export function TextInPlace({ readOnly }: { readOnly?: boolean }) {
  const [arcs, setArcs] = useState<TieArc[]>([]);

  useEffect(() => {
    if (typeof document === 'undefined' || readOnly) return;
    ensureTextRingStyle(document);
    let raf = 0;
    let last = '';
    // the page's other Czech lines are found when the text or the focus changes, not on every frame
    let peers: HTMLElement[] = [];
    let peersOf: HTMLElement | null = null;
    const measure = (refind = false) => {
      const el = document.querySelector(EDITING) as HTMLElement | null;
      const czech = !!el && isCzech(langIn(el));
      if (!el || !czech) peers = [];
      else if (refind || peersOf !== el) peers = czechPeers(el);
      peersOf = el;
      const next = czech && el ? [...tieArcs(el), ...peers.flatMap((p) => tieArcs(p))] : [];
      const s = sig(next);
      if (s !== last) {
        last = s;
        setArcs(next);
      }
      return !!el;
    };
    // pan / zoom fire no DOM event: follow them with rAF for as long as a text is being edited (the
    // discrete events below keep the arcs right where rAF is paused, e.g. an occluded WKWebView)
    const loop = () => {
      raf = measure() ? requestAnimationFrame(loop) : 0;
    };
    const kick = () => {
      measure(true);
      if (!raf && document.querySelector(EDITING)) raf = requestAnimationFrame(loop);
    };
    const events = ['input', 'keyup', 'focusin', 'focusout', 'selectionchange'] as const;
    for (const e of events) document.addEventListener(e, kick, true);
    return () => {
      for (const e of events) document.removeEventListener(e, kick, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [readOnly]);

  if (arcs.length === 0) return null;
  return (
    <>
      {arcs.map((a, i) => (
        <svg
          key={`${i}:${a.at}`}
          className="dc-tie-arc"
          data-testid="edit-tie-arc"
          aria-hidden="true"
          viewBox="0 0 12 5"
          style={{ left: a.x, top: a.y, width: a.w, height: a.h, strokeWidth: a.stroke }}
        >
          <path d="M1 1.2Q6 5.2 11 1.2" vectorEffect="non-scaling-stroke" />
        </svg>
      ))}
    </>
  );
}
