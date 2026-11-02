// client/v2/annotations/stamps-glyphs.jsx — S4.3: the six vote stamps, drawn in the glyph hand (16 grid,
// 1.5 stroke) from canvas 15 `STAMP`. "Stamp" in copy means only a vote stamp (CONTRACT §3); the
// internal id stays `stamp`. `keywords` are what the gallery search reads, so "+1", "yes" and "star"
// find them without the mouse.
//
// `tone` names an `--object-*` token (the sticky/stamp paper hues); the glyph is `--object-ink` on it.

import { STAMP_KINDS } from '../../../annotations/stamp-kinds.ts';

/** Display order = the gallery's Stamps row (the data lives in annotations/stamp-kinds.ts, shared with the canvas). */
export const STAMPS = STAMP_KINDS;

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
