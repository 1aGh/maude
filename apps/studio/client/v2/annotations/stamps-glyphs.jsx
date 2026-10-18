// client/v2/annotations/stamps-glyphs.jsx — S4.3: the six vote stamps, drawn in the glyph hand (16 grid,
// 1.5 stroke) from canvas 15 `STAMP`. "Stamp" in copy means only a vote stamp (CONTRACT §3); the
// internal id stays `stamp`. `keywords` are what the gallery search reads, so "+1", "yes" and "star"
// find them without the mouse.
//
// `tone` names an `--object-*` token (the sticky/stamp paper hues); the glyph is `--object-ink` on it.

/** Display order = the gallery's Stamps row. */
export const STAMPS = Object.freeze([
  {
    id: 'yes',
    name: 'Yes',
    tone: 'yellow',
    keywords: ['yes', 'agree', 'thumbs-up'],
    d: 'M5.75 13.25V7.4L8.1 3c.85 0 1.5.75 1.32 1.6l-.42 2.15h2.9a1.35 1.35 0 0 1 1.33 1.6l-.75 3.8a1.35 1.35 0 0 1-1.33 1.1zM2.75 7.4h3v5.85h-3z',
  },
  {
    id: 'no',
    name: 'No',
    tone: 'coral',
    keywords: ['no', 'disagree', 'thumbs-down'],
    rotate: true,
    d: 'M5.75 13.25V7.4L8.1 3c.85 0 1.5.75 1.32 1.6l-.42 2.15h2.9a1.35 1.35 0 0 1 1.33 1.6l-.75 3.8a1.35 1.35 0 0 1-1.33 1.1zM2.75 7.4h3v5.85h-3z',
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

export const stampById = (id) => STAMPS.find((s) => s.id === id) ?? null;

/** One stamp glyph. */
export function StampGlyph({ id, size = 16 }) {
  const s = stampById(id);
  if (!s) return null;
  return (
    <svg
      className="k-ic"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={s.d} transform={s.rotate ? 'rotate(180 8 8)' : undefined} />
    </svg>
  );
}
