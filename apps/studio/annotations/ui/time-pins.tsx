/**
 * @file       annotations/ui/time-pins.tsx — S4.16: the two small tags a sticky can wear, and the fade
 * @scope      apps/studio/annotations/ui/time-pins.tsx
 * @purpose    Canvas 15 an-video: a note placed on a video carries a time chip ("0:12") and fades to ≈ 0.32
 *             while the playhead is outside its range. Canvas 15 an-print: a note over a print artboard says
 *             "Not printed" (exports leave the layer out — exporters/scope.ts `annotationsExportPolicy`).
 *             `useTimePin(el)` is the one hook `element-node.tsx`'s StickyView calls; the rest is markup.
 * @invariant  READ-ONLY. It reads the playhead (video-comp.tsx `usePlayhead`) and the artboard's kind off the
 *             DOM; it never moves the transport and never writes the board. The fade is CSS on `data-pin`,
 *             so reduced motion collapses it in one rule (`TIME_PIN_CSS`).
 */

import type { ReactNode } from 'react';
import { usePlayhead } from '../../video-comp.tsx';
import { OFF_RANGE_OPACITY, pinOpacity, readTimeRange, timeChip } from '../time-marks.ts';
import type { AnnotationElement } from '../types.ts';

/** Appended to the layer's stylesheet (annotations-layer.tsx `ANNOT_CSS` sibling). */
export const TIME_PIN_CSS = `
/* S4.16 - a note pinned to a moment of a video fades off its range (canvas 15 an-video); the fade eases on
   --dur-soft, and reduced motion collapses it. */
.dc-annot-el[data-pin] { transition: opacity var(--dur-soft, 160ms) var(--ease-out, ease-out); }
.dc-annot-el[data-pin="off"] { opacity: ${OFF_RANGE_OPACITY}; }
.dc-annot-pintag {
  position: absolute; bottom: 100%; margin-bottom: 4px; display: inline-flex; align-items: center; gap: 4px;
  font: 600 10px/1 var(--font-ui, system-ui, sans-serif); padding: 3px 7px; border-radius: 999px; white-space: nowrap;
  pointer-events: none; color: var(--maude-hud-fg, #1a1a1a); background: var(--maude-hud-bg, #fff);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.12);
}
.dc-annot-pintag[data-pin-tag="time"] { left: 4px; }
.dc-annot-pintag[data-pin-tag="print"] { right: 4px; }
.dc-annot-pintag svg { width: 11px; height: 11px; flex: none; }
@media (prefers-reduced-motion: reduce) { .dc-annot-el[data-pin] { transition-duration: 1ms; } }
`;

/** The kind (`digital` · `print` · `web` · `video`) the canvas stamped on an artboard, or null when unknown. */
export function artboardKindOf(id: string | null | undefined): string | null {
  if (!id || typeof document === 'undefined') return null;
  for (const el of document.querySelectorAll('[data-dc-screen]')) {
    if (el.getAttribute('data-dc-screen') === id) return el.getAttribute('data-dc-kind');
  }
  return null;
}

export interface TimePin {
  /** `data-pin` for the node: "on" inside the range, "off" outside, absent for an unpinned note. */
  attrs: Record<string, string> | undefined;
  /** The chip's words, "0:12", or null. */
  chip: string | null;
  /** The note sits over a print artboard. */
  unprinted: boolean;
  /** The opacity the note has right now (1 or `OFF_RANGE_OPACITY`) — what the CSS paints, for tests. */
  opacity: number;
}

/** One sticky's pin state at the current playhead. Hooks: call it unconditionally. */
export function useTimePin(el: AnnotationElement): TimePin {
  const range = readTimeRange(el.timeRange);
  const head = usePlayhead(range?.artboard);
  const opacity = pinOpacity(range, head ? head.t : null);
  const parent = typeof el.parentArtboard === 'string' ? el.parentArtboard : null;
  const unprinted = parent !== null && artboardKindOf(parent) === 'print';
  return {
    attrs: range ? { 'data-pin': opacity < 1 ? 'off' : 'on' } : undefined,
    chip: range ? timeChip(range) : null,
    unprinted,
    opacity,
  };
}

const CLOCK = (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M6 3.4V6l1.8 1.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);
const PRINTER = (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M3.4 4.2V1.8h5.2v2.4M3.4 8.4H2.2V4.2h7.6v4.2H8.6M3.4 6.8h5.2v3.4H3.4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

/** The chips a pinned / over-print sticky wears, above its top edge. Empty for an ordinary note. */
export function PinTags({ pin }: { pin: TimePin }): ReactNode {
  if (!pin.chip && !pin.unprinted) return null;
  return (
    <>
      {pin.chip ? (
        <span className="dc-annot-pintag" data-pin-tag="time" title={`Pinned to ${pin.chip}`}>
          {CLOCK}
          {pin.chip}
        </span>
      ) : null}
      {pin.unprinted ? (
        <span
          className="dc-annot-pintag"
          data-pin-tag="print"
          title="This note stays out of print files"
        >
          {PRINTER}
          Not printed
        </span>
      ) : null}
    </>
  );
}
