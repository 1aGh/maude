/**
 * @file       annotations/ui/text-style.ts — one box model for every text slot
 * @scope      apps/studio/annotations/ui/text-style.ts
 * @purpose    DDR-242 AD7: object text renders as HTML, and its display box and
 *             its editor (`<textarea>`) share ONE class and ONE inline style,
 *             so wrapping and line positions are identical by construction —
 *             no jump when an edit opens or commits. Every slot (sticky body,
 *             standalone text, shape label, section title) gets its style here.
 *             React-free apart from the CSSProperties type.
 */

import type { CSSProperties } from 'react';

export const TEXT_FONT = 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

/** Line heights per slot — the values the v1 renderers used, so nothing moves. */
export const LINE_HEIGHT = {
  sticky: 1.35,
  label: 1.25,
  text: 1.25,
} as const;

export type TextSlot = 'sticky' | 'label' | 'text' | 'title';
export type TextAlign = 'left' | 'center' | 'right';
export type ListStyle = 'bullet' | 'number';

export interface TextFormat {
  fontSize: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  align?: TextAlign;
}

export function textDecoration(strike?: boolean, underline?: boolean): string | undefined {
  if (strike && underline) return 'line-through underline';
  if (strike) return 'line-through';
  if (underline) return 'underline';
  return undefined;
}

/** Inline style shared by a slot's display block and its textarea. */
export function slotTextStyle(slot: TextSlot, f: TextFormat): CSSProperties {
  const align = f.align ?? (slot === 'label' ? 'center' : 'left');
  return {
    fontFamily: TEXT_FONT,
    fontSize: `${f.fontSize}px`,
    lineHeight: slot === 'title' ? undefined : LINE_HEIGHT[slot],
    fontWeight: f.bold ? 700 : undefined,
    fontStyle: f.italic ? 'italic' : undefined,
    textDecoration: textDecoration(f.strike, f.underline),
    textAlign: align,
    ...(f.color ? { color: f.color } : {}),
  };
}

/** Standalone text is anchored at its `x`: left edge, centre or right edge by alignment (v1 semantics). */
export function anchorShift(align: TextAlign | undefined): string | undefined {
  if (align === 'center') return 'translateX(-50%)';
  if (align === 'right') return 'translateX(-100%)';
  return undefined;
}

/** Render-only list markers (DDR-091): never stored in the text. */
export function withListMarkers(text: string, list?: ListStyle): string {
  if (!list) return text;
  return text
    .split('\n')
    .map((line, i) => (list === 'bullet' ? `• ${line}` : `${i + 1}. ${line}`))
    .join('\n');
}

/**
 * Inverse of {@link withListMarkers} for text typed in an editor that showed
 * them. Lenient: any leading `N. ` goes, whatever number the user left there,
 * so renumbering while editing round-trips.
 */
export function stripListMarkers(text: string, list?: ListStyle): string {
  if (!list) return text;
  const re = list === 'bullet' ? /^• / : /^\d+\.\s/;
  return text
    .split('\n')
    .map((line) => line.replace(re, ''))
    .join('\n');
}

/**
 * The stylesheet for the text layer. Display blocks and editors share
 * `.dc-annot-text`; the textarea adds only what a form control needs to look
 * like plain text (no border, no resize grip, inherited font).
 */
export const TEXT_LAYER_CSS = `
.dc-annot-scene { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; pointer-events: none; }
.dc-annot-el { position: absolute; pointer-events: none; }
.dc-annot-el > svg.dc-annot-geo { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.dc-annot-text { box-sizing: border-box; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.dc-annot-text--nowrap { white-space: pre; overflow-wrap: normal; }
textarea.dc-annot-text {
  display: block; resize: none; border: 0; outline: none; background: transparent; pointer-events: auto;
  padding: 0; overflow: hidden; color: inherit; cursor: text;
  caret-color: var(--maude-hud-accent, #4a63e7);
  -webkit-appearance: none; appearance: none;
}
.dc-annot-label { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 8px; box-sizing: border-box; }
.dc-annot-label > .dc-annot-text { width: 100%; }
.dc-annot-chip { position: absolute; left: 0; box-sizing: border-box; border-radius: 5px; white-space: nowrap; overflow: visible; }
.dc-annot-placeholder { position: absolute; inset: 0; border: 1.5px dashed rgba(127,127,127,0.7); border-radius: 6px;
  display: flex; align-items: center; justify-content: center; font: 11px ${TEXT_FONT}; color: rgba(127,127,127,0.9); }
`.trim();
