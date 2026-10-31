/**
 * @file edit-ops/slot-defaults.ts
 * @purpose P6 T3 (inspector-ux-rules IR-11, Michal TD3): the colour a NEW paint starts as, per slot — a DS schema role
 * token with a fixed literal fallback, never `currentColor` and never a bare hex. The fallback keeps the paint visible
 * on a canvas with no design system (or one that lacks the role) and ds-check accepts a literal that sits in a ROLE
 * token's fallback (P1). The literals match P1's new-object defaults in `insert-shape.ts` / `path.ts`, so a shape the
 * Shape tool draws and a fill the Inspector's "+" adds are the same colour.
 *
 * Pure: no IO, no DOM, no React.
 */

import type { Paint } from './words-paint.ts';

export type Slot = 'background' | 'fill' | 'text' | 'border' | 'stroke' | 'gradientEnd';

/** slot → `{ token, fallback }`. */
export const SLOT_DEFAULTS: Readonly<Record<Slot, { token: string; fallback: string }>> =
  Object.freeze({
    /** an artboard's, frame's or button's background (a frame on a `--bg-0` page stays visible) */
    background: { token: '--bg-1', fallback: '#f4f4f5' },
    /** a shape's fill */
    fill: { token: '--bg-3', fallback: '#d4d4d8' },
    /** a text's colour */
    text: { token: '--fg-0', fallback: '#18181b' },
    /** a border */
    border: { token: '--border-default', fallback: '#a1a1aa' },
    /** a line's or Pen path's stroke */
    stroke: { token: '--fg-1', fallback: '#52525b' },
    /** a gradient's second stop */
    gradientEnd: { token: '--bg-0', fallback: '#ffffff' },
  });

/** The paint of a slot's default: `{ token: '--bg-3', fallback: '#d4d4d8' }`. */
export function slotPaint(slot: Slot): Paint {
  const d = SLOT_DEFAULTS[slot];
  return { token: d.token, fallback: d.fallback };
}

/** The CSS of a slot's default: `var(--bg-3, #d4d4d8)`. */
export function slotCss(slot: Slot): string {
  const d = SLOT_DEFAULTS[slot];
  return `var(${d.token}, ${d.fallback})`;
}

/** Which slot the Fill section's colour is for this kind: a shape or path is filled, everything else has a background. */
export function fillSlotFor(kind: string | null | undefined): Slot {
  return kind === 'shape' || kind === 'path' ? 'fill' : 'background';
}
