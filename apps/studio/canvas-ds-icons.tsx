/**
 * @file       canvas-ds-icons.tsx — the maude-v2 icon family for the chrome Maude draws INSIDE the canvas
 *             iframe (P8 C5): the two toolbars, the artboard label's kind glyph, the size ghost, chips.
 * @purpose    One hand with the shell and the boards: 16 grid, live area 2–14, 1.5 round stroke,
 *             `currentColor`. Paths are copied verbatim from `.design/system/maude-v2/preview/iconography.tsx`
 *             GLYPHS and the board kit's KIT_GLYPHS (`.design/ui/v2/_kit.tsx` — kinds, More tools, Marker,
 *             Stickers, Section). The iframe cannot import the shell's `client/v2/shell/icons.jsx` (another
 *             bundle), so this is the canvas-side copy; `test/canvas-ds-icons.test.tsx` pins the paths to the kit.
 *             React-only, no studio imports.
 */

import type { JSX, ReactNode } from 'react';

export const DS_GLYPHS: Readonly<Record<string, ReactNode>> = {
  select: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  hand: (
    <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />
  ),
  frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  shape: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.5" />
      <circle cx="10.25" cy="10.25" r="3.5" />
    </>
  ),
  pen: (
    <>
      <path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" />
      <path d="M8.75 4.75l2.5 2.5" />
    </>
  ),
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  sticky: (
    <>
      <path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" />
      <path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" />
    </>
  ),
  // rc.1 F16 — one comment glyph everywhere: the speech bubble the Comments panel and the share cluster wear.
  // (It was the DS tile cut square on one corner, which read as Shape beside the other tools.)
  comment: (
    <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v3.5A2.5 2.5 0 0 1 11 11H8l-3 2.5V11A2.5 2.5 0 0 1 2.5 8.5V5A2.5 2.5 0 0 1 5 2.5z" />
  ),
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="12.5" cy="8" r="1.1" />
    </g>
  ),
  print: (
    <>
      <path d="M4.5 6V2.5h7V6M4.5 11.5h-1A1.5 1.5 0 0 1 2 10V7.5A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5V10a1.5 1.5 0 0 1-1.5 1.5h-1" />
      <path d="M4.5 9.5h7v4h-7z" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  problem: (
    <>
      <path d="M8 2.75l5.75 10H2.25z" />
      <path d="M8 6.75v2.5M8 11h.01" />
    </>
  ),
  // ── kit additions (board _kit.tsx KIT_GLYPHS) ──
  component: (
    <>
      <path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" />
      <path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" />
      <path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" />
      <path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" />
    </>
  ),
  line: <path d="M3 13L13 3" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />,
  polygon: <path d="M8 2.25l5.5 4-2.1 6.5H4.6l-2.1-6.5z" />,
  crop: <path d="M4.5 1.75v9.75h9.75M1.75 4.5h9.75v9.75" />,
  slice: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" strokeDasharray="2 2" />
      <path d="M5.5 10.5l5-5" />
    </>
  ),
  web: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2.5" />
      <path d="M2 6.25h12M4.5 4.65h.01M6.25 4.65h.01" />
    </>
  ),
  digital: (
    <>
      <rect x="4.5" y="2" width="7" height="12" rx="2" />
      <path d="M7.25 11.75h1.5" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="2.5" />
      <path d="M6.75 6.1v3.8L9.9 8z" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <circle cx="6" cy="6.5" r="1.25" />
      <path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" />
    </>
  ),
  arrow: <path d="M3 13L13 3M7.5 3H13v5.5" />,
  highlighter: (
    <>
      <path d="M9.5 2.75l3.75 3.75-5.5 5.5H4v-3.75z" />
      <path d="M2.5 13.5h5" />
    </>
  ),
  marker: (
    <>
      <path d="M10.75 2.75l2.5 2.5-6 6-2.5-2.5z" />
      <path d="M4.75 8.75L3 13l4.25-1.75" />
    </>
  ),
  stamp: (
    <>
      <circle className="dc-tp-stamp-disc" cx="8" cy="8" r="5.75" />
      <path d="M5.6 9.4a2.9 2.9 0 0 0 4.8 0" />
      <path d="M6.1 6.4h.01M9.9 6.4h.01" strokeWidth={2} />
    </>
  ),
  section: (
    <>
      <path d="M2.5 5V3.5a1 1 0 0 1 1-1H5M11 2.5h1.5a1 1 0 0 1 1 1V5M13.5 11v1.5a1 1 0 0 1-1 1H11M5 13.5H3.5a1 1 0 0 1-1-1V11" />
      <path d="M5.5 6h5" />
    </>
  ),
  eraser: (
    <path d="M6.5 13.5h7M3.1 9.4l5.5-5.5a1.5 1.5 0 0 1 2.1 0l2.4 2.4a1.5 1.5 0 0 1 0 2.1l-5.1 5.1H6.2z" />
  ),
  link: (
    <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.75.75M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.75-.75" />
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3l2 1.25" />
    </>
  ),
  play: <path d="M5 3.5v9l7.5-4.5z" />,
  // P8 C3 - the context menus' icon column (14 ed-ab-menu / ed-obj-order, 01): the kit's glyphs, path for path
  edit: (
    <>
      <path d="M9.5 3.5l2 2L6 11l-2.75.75L4 9z" />
      <path d="M3 13.5h10" />
    </>
  ),
  export: (
    <>
      <path d="M8 2.5V10M5.25 7.25L8 10l2.75-2.75" />
      <path d="M2.75 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.75" />
      <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
    </>
  ),
  duplicate: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.75" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </>
  ),
  trash: (
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" />
  ),
  'eye-off': (
    <>
      <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" />
      <path d="M2.5 2.5l11 11" />
    </>
  ),
  submenu: <path d="M6 4.5l3.5 3.5L6 11.5" />,
  // the Design system glyph: four squares and a dot (_kit.tsx `system`)
  system: (
    <>
      <rect x="2.5" y="2.5" width="4.75" height="4.75" rx="1.25" />
      <rect x="8.75" y="2.5" width="4.75" height="4.75" rx="1.25" />
      <rect x="2.5" y="8.75" width="4.75" height="4.75" rx="1.25" />
      <circle cx="11.125" cy="11.125" r="2.375" />
    </>
  ),
};

/** One DS glyph by name; an unknown name draws nothing (never a wrong glyph). */
export function DsIcon({
  name,
  size = 16,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}): JSX.Element | null {
  const g = DS_GLYPHS[name];
  if (!g) return null;
  return (
    <svg
      className={className}
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
      {g}
    </svg>
  );
}

/** The AI spark — the mark's star (assets/logos/spark.svg), filled. The AI only. */
export function DsSpark({ size = 12, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M16 3L19.309 12.691L29 16L19.309 19.309L16 29L12.691 19.309L3 16L12.691 12.691Z"
        fill={color}
      />
    </svg>
  );
}
