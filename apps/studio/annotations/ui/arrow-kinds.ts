/**
 * @file       annotations/ui/arrow-kinds.ts — an arrow's line, heads, inks and words (S4.11)
 * @scope      apps/studio/annotations/ui/arrow-kinds.ts
 * @purpose    Pure half of an-arrow-kinds: the defaults a NEW arrow is born with (Curved, a filled
 *             head), the vocabulary the small toolbar offers (Straight · Curved · Elbow; None ·
 *             Line · Triangle · Triangle outline · Circle · Diamond; two-way; inks 4 + "+5"), and
 *             the patches each choice writes. Every patch changes only the DRAWING — a bind
 *             (`startHost` / `endHost`, `startBind` / `endBind`) is never touched, so each kind keeps
 *             its binding.
 */

import { type ArrowStroke, STROKE_PALETTE } from '../../annotations-model.ts';
import type { ArrowHead, ArrowLineType } from '../../canvas-arrowheads.ts';

/** What a freshly drawn arrow carries: Curved, no tail, a filled head. */
export const NEW_ARROW: Readonly<{
  lineType: ArrowLineType;
  startHead: ArrowHead;
  endHead: ArrowHead;
}> = Object.freeze({ lineType: 'curved', startHead: 'none', endHead: 'triangle' });

export const ARROW_KINDS: ReadonlyArray<{ value: ArrowLineType; label: string }> = [
  { value: 'straight', label: 'Straight' },
  { value: 'curved', label: 'Curved' },
  { value: 'elbow', label: 'Elbow' },
];

export const ARROW_HEAD_CHOICES: ReadonlyArray<{ value: ArrowHead; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'line', label: 'Line' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'triangle-outline', label: 'Triangle outline' },
  { value: 'circle', label: 'Circle' },
  { value: 'diamond', label: 'Diamond' },
];

const S = STROKE_PALETTE;
/** Four inks up front (black first, CONTRACT C14), then "+5". */
export const ARROW_INK_FRONT: readonly { hex: string; name: string }[] = Object.freeze([
  { hex: S[8], name: 'Ink' },
  { hex: S[0], name: 'Red' },
  { hex: S[3], name: 'Green' },
  { hex: S[4], name: 'Blue' },
]);
export const ARROW_INK_MORE: readonly { hex: string; name: string }[] = Object.freeze([
  { hex: S[1], name: 'Orange' },
  { hex: S[2], name: 'Amber' },
  { hex: S[5], name: 'Purple' },
  { hex: S[6], name: 'Pink' },
  { hex: S[7], name: 'Grey' },
]);

/** The shaft kind of an arrow (absent = straight, back-compat). */
export const kindOf = (a: ArrowStroke): ArrowLineType => a.lineType ?? 'straight';
/** The head on the end (absent = a filled triangle, back-compat). */
export const endHeadOf = (a: ArrowStroke): ArrowHead => a.endHead ?? 'triangle';
export const startHeadOf = (a: ArrowStroke): ArrowHead => a.startHead ?? 'none';

/** Two-way = a head on both ends. */
export const isTwoWay = (a: ArrowStroke): boolean =>
  startHeadOf(a) !== 'none' && endHeadOf(a) !== 'none';

/** Straight · Curved · Elbow. Binds and ends stay as they are. */
export function kindPatch(kind: ArrowLineType): Partial<ArrowStroke> {
  return { lineType: kind };
}

/**
 * The head picker sets the head on the END; a two-way arrow keeps the same head at the start so
 * the picker never silently makes one side differ from the other.
 */
export function headPatch(a: ArrowStroke, head: ArrowHead): Partial<ArrowStroke> {
  return isTwoWay(a) && head !== 'none' ? { endHead: head, startHead: head } : { endHead: head };
}

/** Toggle two-way: a head on the start too (the end's), or none at the start. */
export function twoWayPatch(a: ArrowStroke): Partial<ArrowStroke> {
  if (isTwoWay(a)) return { startHead: 'none' };
  const end = endHeadOf(a);
  return {
    startHead: end === 'none' ? 'triangle' : end,
    endHead: end === 'none' ? 'triangle' : end,
  };
}

/** An arrow's words, trimmed; empty removes the label. */
export function labelPatch(text: string): Partial<ArrowStroke> {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  return { label: t || undefined };
}
