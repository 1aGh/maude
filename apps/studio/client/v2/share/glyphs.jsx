// client/v2/share/glyphs.jsx — P8 C7: the glyphs the collaboration surfaces draw (10 Share and
// Collaboration), lifted from the kit's `Icon` set (.design/ui/v2/_kit.tsx GLYPHS, 16 × 16, 1.5
// stroke). The shell's STICONS lacks these names; the kit IS the spec for a glyph, so the paths are
// the kit's, here, rather than a text "⌄ ✓ ×" standing in for one. A name STICONS already has
// (`check`, `link`, `clock`, `lock`, …) is drawn from there, so a shared glyph stays one glyph.

import { STICONS, StIcon } from '../../shell/icons.jsx';

const KIT = {
  chevron: <path d="M5 6.5l3 3 3-3" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  people: (
    <>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2 13a4 4 0 0 1 8 0M10.5 3.5a2.25 2.25 0 0 1 0 4.25M12 9.25A4 4 0 0 1 14 13" />
    </>
  ),
  home: (
    <path d="M2.5 7.25L8 2.75l5.5 4.5v5.25a1 1 0 0 1-1 1h-2.75V10h-3.5v3.5H3.5a1 1 0 0 1-1-1z" />
  ),
  duplicate: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.75" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="2.5" />
      <path d="M6.75 6.1v3.8L9.9 8z" />
    </>
  ),
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  trash: (
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 .9.9h3.8a1 1 0 0 0 1-.9l.6-8.1" />
  ),
  print: (
    <>
      <path d="M4.5 6V2.5h7V6M4.5 11.5h-1A1.5 1.5 0 0 1 2 10V7.5A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5V10a1.5 1.5 0 0 1-1.5 1.5h-1" />
      <path d="M4.5 9.5h7v4h-7z" />
    </>
  ),
  view: (
    <>
      <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" />
      <circle cx="8" cy="8" r="1.75" />
    </>
  ),
  arrow: <path d="M3 13L13 3M7.5 3H13v5.5" />,
  submenu: <path d="M6 4.5l3.5 3.5L6 11.5" />,
};

/** The kit's spark (`Spark`, _kit.tsx:263): the AI's mark — a face, a tag, a menu row. Never a person's. */
export function SparkGlyph({ size = 12, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
      style={{ flex: 'none', display: 'block' }}
    >
      <path d="M16 3L19.309 12.691L29 16L19.309 19.309L16 29L12.691 19.309L3 16L12.691 12.691Z" />
    </svg>
  );
}

/** One glyph by the kit's name. `size` is the drawn size in px. */
export function Glyph({ name, size = 14, className }) {
  if (KIT[name]) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flex: 'none', display: 'block' }}
      >
        {KIT[name]}
      </svg>
    );
  }
  return STICONS[name] ? <StIcon name={name} size={size} className={className} /> : null;
}
