// client/home/home-icons.jsx — the maude-v2 glyphs Home uses, lifted from the DS family
// (.design/ui/v2/_kit.tsx FAMILY / preview/iconography.tsx: 16 grid, 1.5 stroke) and the mark
// (assets/logos/mark.svg). Decorative: every one is aria-hidden; the control around it names it.

const GLYPHS = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25l3.25 3.25" />
    </>
  ),
  chevron: <path d="M5 6.5l3 3 3-3" />,
  home: (
    <path d="M2.5 7.25L8 2.75l5.5 4.5v5.25a1 1 0 0 1-1 1h-2.75V10h-3.5v3.5H3.5a1 1 0 0 1-1-1z" />
  ),
  folder: (
    <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h2.5L8 4.5h4A1.5 1.5 0 0 1 13.5 6v5.5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z" />
  ),
  cloud: (
    <path d="M4.75 12.5a2.75 2.75 0 0 1-.4-5.47A3.75 3.75 0 0 1 11.6 6a3.25 3.25 0 0 1 .15 6.5zM6.25 9.5l1.25 1.25 2.25-2.5" />
  ),
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  laptop: (
    <>
      <rect x="3.5" y="3.5" width="9" height="6.5" rx="1.25" />
      <path d="M1.75 12.5h12.5" />
    </>
  ),
  pin: <path d="M6 2.5h4l-.5 4 2.5 2.5H4l2.5-2.5zM8 9v4.5" />,
};

export function HIcon({ name, size = 16 }) {
  return (
    <svg
      className="home-ic"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name] ?? GLYPHS.folder}
    </svg>
  );
}

/** The maude mark — the DS logo specimen, lifted (DDR-141), never redrawn. */
export function HMark({ size = 22 }) {
  return (
    <svg
      className="home-ic"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 0H25A7 7 0 0 1 32 7V32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z" fill="var(--accent)" />
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="var(--accent-fg)" />
    </svg>
  );
}

/** The AI spark — AI only (the "Made by AI" chip). */
export function HSpark({ size = 10 }) {
  return (
    <svg
      className="home-ic"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M16 3L19.309 12.691L29 16L19.309 19.309L16 29L12.691 19.309L3 16L12.691 12.691Z"
        fill="currentColor"
      />
    </svg>
  );
}

const TONES = ['lilac', 'yellow', 'sky', 'green', 'coral', 'grey'];

/** A project wears a rounded square (initial + an object tone picked from its id). */
export function ProjectSquare({ id, name, size = 'sm' }) {
  let h = 0;
  for (const ch of String(id || name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = TONES[h % TONES.length];
  const ini = (String(name || '').trim()[0] || '·').toUpperCase();
  return (
    <span className={`home-sq home-sq--${size} home-sq--${tone}`} aria-hidden="true">
      {ini}
    </span>
  );
}
