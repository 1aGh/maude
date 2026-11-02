// annotations/ui/ai-marks.tsx — S4.15 (15 Annotations `an-ai-write`, `an-ai-stickers`, `an-ai-apply`): how the
// AI's writing reads on the layer. Not an extra sticky colour — a spark edge:
//   · a sticky the AI wrote has neutral paper, a spark edge and a spark glyph, and says "AI" under it;
//   · an arrow the AI drew is spark-coloured (its ends bound to the element it means, S4.5);
//   · a status sticker the AI placed (Done! / Flagged) wears a small spark badge — "Placed by AI";
//   · a sticky the AI resolved gets a spark-coloured tick ("Resolved by AI"), still struck through and kept.
// `author.kind: 'ai'` is the stamp the strict-write door puts on everything the agent writes (ai-write.ts); it
// cannot be set by a person's op, so the look is a statement of fact, not a style anyone can borrow.

import type { AnnotationElement } from '../types.ts';

/** The AI's spark (artboard-activity-overlay's `--dc-ai-spark`, as a literal: SVG attributes cannot read a var). */
export const AI_SPARK = 'oklch(0.66 0.2 36)';
/** Neutral paper for an AI sticky — the spark edge, not a swatch, says who wrote it. */
export const AI_PAPER = '#fbf8f4';
/** `resolved.by` when the agent resolved a sticky (ai-write.ts `AI_RESOLVER`). */
export const AI_BY = 'AI';

/** The human default paper for a sticky with no stored fill (annotations/constants.ts DEFAULT_STICKY_FILL). */
const DEFAULT_PAPER = '#fce8a6';

/**
 * A sticky's paper (lead decision `v2-lead-explicit-fill-beats-ai-neutral-paper`): the stored `fill` ALWAYS
 * renders; the neutral AI paper is only the default for an AI sticky that has none. (`annotate --board`
 * cards carry their colour, and the spark edge — not a swatch — is what says who wrote it.)
 */
export function stickyPaper(el: AnnotationElement): string {
  if (typeof el.fill === 'string' && el.fill) return el.fill;
  return isAiAuthored(el) ? AI_PAPER : DEFAULT_PAPER;
}

/** A section's tone: its stored `color` always renders, whoever wrote it (no AI override). */
export function sectionTone(el: AnnotationElement, fallback = '#8a8a8a'): string {
  return typeof el.color === 'string' && el.color ? el.color : fallback;
}

export function isAiAuthored(el: AnnotationElement): boolean {
  const a = el.author;
  return !!a && typeof a === 'object' && (a as { kind?: unknown }).kind === 'ai';
}

export function resolvedByAi(el: AnnotationElement): boolean {
  const r = el.resolved;
  return !!r && typeof r === 'object' && (r as { by?: unknown }).by === AI_BY;
}

/** CSS appended to the layer's sheet (src/ANNOT_CSS), after the base rules so the spark tick wins. */
export const AI_MARKS_CSS = `
/* S4.15 - the AI's marks (annotations/ui/ai-marks.tsx) */
.dc-annot-spark { position: absolute; left: 8px; top: 9px; width: 14px; height: 14px; color: ${AI_SPARK}; pointer-events: none; }
.dc-annot-done[data-by="ai"] { background: ${AI_SPARK}; color: oklch(0.2 0.03 36); }
.dc-annot-ai-badge {
  position: absolute; right: -4px; top: -4px; width: 18px; height: 18px; display: grid; place-items: center;
  border-radius: 50%; background: ${AI_SPARK}; color: oklch(0.2 0.03 36); pointer-events: none;
}
`;

export function SparkGlyph({ className, size = 14 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z" fill="currentColor" />
    </svg>
  );
}
