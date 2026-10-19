/**
 * @file       annotations/ui/posture.ts — S4.9: how the annotation layer shows in this mode
 * @scope      apps/studio/annotations/ui/posture.ts
 * @purpose    One pure answer to "what does the layer do right now": the what-shows table's
 *             `annotations` row (bridge/mode-shows.ts) folded with the ⇧P switch.
 *
 *               drawn      Preview: full strength, editable
 *               quiet      Edit: faded paper, readable words, clicks reach the design
 *               read-only  Viewing: full strength, nothing to change
 *               hidden     Present always; any mode when ⇧P is off
 *
 *             A canvas no shell governs (mode null: a standalone canvas) keeps v1's behaviour, `drawn`.
 *             The paper of a quiet sticky is mixed with grey in plain sRGB (not faded to transparent), so
 *             its words keep their contrast on a light or a dark artboard alike; `quietPaper` and
 *             `contrast` are here so the 4.5:1 floor is a test, not a hope (canvas 15, an-visibility).
 */

import type { CanvasModeV2 } from '../../bridge/canvas-modes.ts';
import { modeCell } from '../../bridge/mode-shows.ts';

export type AnnotationPosture = 'drawn' | 'quiet' | 'read-only' | 'hidden';

export function annotationPosture(
  mode: CanvasModeV2 | null | undefined,
  visible: boolean,
  presenting = false,
  caps?: { annotate: boolean } | null
): AnnotationPosture {
  if (presenting || !visible) return 'hidden';
  if (!mode) return 'drawn';
  const cell = modeCell('annotations', mode) as AnnotationPosture;
  // S4.16 (canvas 15 an-viewer): Can comment holds Hand + Comment; the board is read-only for it, whichever
  // mode it is in (the server refuses the ops anyway - this only stops the layer offering them).
  return cell === 'drawn' && caps && !caps.annotate ? 'read-only' : cell;
}

/** The layer takes pointer input (tools, selection, drags) only when it is Preview's. */
export const postureTakesInput = (p: AnnotationPosture): boolean => p === 'drawn';

/** Ink (pen, arrows, shapes) fades to this in Edit. Sticky paper does not fade; it mixes (below). */
export const QUIET_INK_OPACITY = 0.45;
/** The grey a quiet sticky's paper is mixed with, half and half. */
export const QUIET_GREY = '#dcdcd8';
/** The words on any sticky (element-node.tsx draws them in this ink). */
export const STICKY_INK = '#2a2a28';
/** WCAG AA for body text. */
export const TEXT_FLOOR = 4.5;

function rgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1] as string;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** A sticky's paper in Edit: half its own colour, half grey. Anything that is not a hex colour passes through. */
export function quietPaper(fill: string): string {
  const a = rgb(fill);
  const b = rgb(QUIET_GREY);
  if (!a || !b) return fill;
  return `#${[0, 1, 2].map((i) => hex2(((a[i] as number) + (b[i] as number)) / 2)).join('')}`;
}

function luminance(c: [number, number, number]): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours (1 when either is not a hex colour). */
export function contrast(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
