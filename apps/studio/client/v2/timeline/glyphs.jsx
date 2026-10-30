// client/v2/timeline/glyphs.jsx — P8 C3: the timeline's glyphs in the kit's hand (16 grid, 1.5 round stroke),
// lifted from the board's `_video.tsx` VIcon + the kit glyphs it falls back to (`.design/ui/v2/_kit.tsx`). One set
// for the header tools, the track chips, the join dots and the flags, so no text glyph (ƒ ▶ ◫ ♪ ⧓ 🔇) stands in
// for an icon again.

const PATHS = {
  // kit
  play: <path d="M5 3.5v9l7.5-4.5z" />,
  type: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <circle cx="6" cy="6.5" r="1.25" />
      <path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="2.5" />
      <path d="M6.75 6.1v3.8L9.9 8z" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  view: (
    <>
      <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" />
      <circle cx="8" cy="8" r="1.75" />
    </>
  ),
  submenu: <path d="M6 4.5l3.5 3.5L6 11.5" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3l2 1.25" />
    </>
  ),
  comment: (
    <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />
  ),
  // a sticky note (folded corner) — the Preview strip's "2 notes" (15 · an-video)
  note: (
    <path d="M4.5 2.5h7A2 2 0 0 1 13.5 4.5V9L9 13.5H4.5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM9 13.5V11A2 2 0 0 1 11 9h2.5" />
  ),
  sync: (
    <path d="M3 7.25a5 5 0 0 1 8.6-3L13 5.5M13 2.5v3h-3M13 8.75a5 5 0 0 1-8.6 3L3 10.5M3 13.5v-3h3" />
  ),
  // the board's video glyphs (_video.tsx VE_GLYPHS)
  scissors: (
    <>
      <circle cx="4.5" cy="11.5" r="2" />
      <circle cx="11.5" cy="11.5" r="2" />
      <path d="M6 10L11.5 2.5M10 10L4.5 2.5" />
    </>
  ),
  music: (
    <>
      <path d="M6 11.5V3.5l7-1.5v8" />
      <circle cx="4.25" cy="11.75" r="1.75" />
      <circle cx="11.25" cy="10" r="1.75" />
    </>
  ),
  volume: (
    <>
      <path d="M2.5 6.25h2.25L8 3.5v9L4.75 9.75H2.5z" />
      <path d="M10.5 6a2.75 2.75 0 0 1 0 4M12.25 4.25a5.25 5.25 0 0 1 0 7.5" />
    </>
  ),
  mute: (
    <>
      <path d="M2.5 6.25h2.25L8 3.5v9L4.75 9.75H2.5z" />
      <path d="M10.5 6.25l3 3.5M13.5 6.25l-3 3.5" />
    </>
  ),
  captions: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="2.5" />
      <path d="M4.75 7.25h3M9.25 7.25h2M4.75 9.75h1.5M7.75 9.75h3.5" />
    </>
  ),
  loop: (
    <path d="M2.75 8.5v-1a3 3 0 0 1 3-3h7M11 2.75l1.75 1.75L11 6.25M13.25 7.5v1a3 3 0 0 1-3 3h-7M5 13.25L3.25 11.5 5 9.75" />
  ),
  'step-back': (
    <>
      <path d="M12.5 3.5v9l-6-4.5z" />
      <path d="M3.5 3.5v9" />
    </>
  ),
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  transition: <path d="M2.5 3.5L8 8l-5.5 4.5zM13.5 3.5L8 8l5.5 4.5z" />,
  minus: <path d="M3.5 8h9" />,
  marker: <path d="M4.5 13.5v-11h7l-2 3 2 3h-7" />,
  spark: (
    <path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3zM12.5 11l.5 1.25 1.25.5-1.25.5-.5 1.25-.5-1.25-1.25-.5 1.25-.5z" />
  ),
};

/** A timeline glyph (`name` from the board's set). `size` px square; aria-hidden — the button names itself. */
export function TGlyph({ name, size = 14 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className="tl-ic"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}
