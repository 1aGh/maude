/**
 * @file       annotations/stamp-kinds.ts — the six vote stamps (S4.3 glyphs, S4.13 placement)
 * @scope      apps/studio/annotations/stamp-kinds.ts
 * @purpose    ONE list behind the gallery's Stamps row (client/v2/annotations/stamps-glyphs.jsx), the stamp
 *             row the gallery folds to, and the canvas's stamp faces (annotations/ui/stamps.tsx). Drawn in the
 *             glyph hand (16 grid, 1.5 stroke) from canvas 15 `STAMP`; "Stamp" in copy means only a vote stamp
 *             (CONTRACT §3). `id` is also the board's `stamp.kind` (a lowercase word), so it is API — append only.
 *             `tone` names an `--object-*` token; `keywords` are what the gallery search reads.
 */

export interface StampKind {
  id: string;
  name: string;
  tone: 'yellow' | 'coral' | 'sky' | 'green';
  keywords: readonly string[];
  /** Draw the path turned half a circle (the No thumb). */
  rotate?: boolean;
  d: string;
}

const THUMB =
  'M5.75 13.25V7.4L8.1 3c.85 0 1.5.75 1.32 1.6l-.42 2.15h2.9a1.35 1.35 0 0 1 1.33 1.6l-.75 3.8a1.35 1.35 0 0 1-1.33 1.1zM2.75 7.4h3v5.85h-3z';

/** Display order = the gallery's Stamps row. */
export const STAMP_KINDS: readonly StampKind[] = Object.freeze([
  { id: 'yes', name: 'Yes', tone: 'yellow', keywords: ['yes', 'agree', 'thumbs-up'], d: THUMB },
  {
    id: 'no',
    name: 'No',
    tone: 'coral',
    keywords: ['no', 'disagree', 'thumbs-down'],
    rotate: true,
    d: THUMB,
  },
  {
    id: 'star',
    name: 'Star',
    tone: 'yellow',
    keywords: ['star', 'favourite'],
    d: 'M8 2.4l1.7 3.5 3.85.55-2.8 2.7.68 3.8L8 11.15 4.57 12.95l.68-3.8-2.8-2.7 3.85-.55z',
  },
  {
    id: 'heart',
    name: 'Love it',
    tone: 'coral',
    keywords: ['love-it', 'love', 'heart'],
    d: 'M8 13.1S2.6 9.95 2.6 6.15A2.75 2.75 0 0 1 8 4.9a2.75 2.75 0 0 1 5.4 1.25c0 3.8-5.4 6.95-5.4 6.95z',
  },
  {
    id: 'ask',
    name: 'Question',
    tone: 'sky',
    keywords: ['question', 'ask', '?'],
    d: 'M6.2 6.1a1.85 1.85 0 0 1 3.6.6c0 1.35-1.8 1.55-1.8 2.75M8 11.55h.01',
  },
  {
    id: 'plus',
    name: '+1',
    tone: 'green',
    keywords: ['+1', 'plus'],
    d: 'M5 8h4M7 6v4M10.25 5.25L11.5 4.5v6.5',
  },
]);

export const stampKindById = (id: unknown): StampKind | null =>
  STAMP_KINDS.find((s) => s.id === id) ?? null;
