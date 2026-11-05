// Ported once from .design/ui/v2/_kit.tsx on 2026-11-04; site/ is the source now.
// The glyph family (16 grid, 1.5 round stroke) is the subset the public pages draw, plus the
// logo mark and the AI spark (verbatim paths, never redrawn).
import type { ReactNode } from 'react';

const GLYPHS: Record<string, ReactNode> = {
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
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="12.5" cy="8" r="1.1" />
    </g>
  ),
  chevron: <path d="M5 6.5l3 3 3-3" />,
  submenu: <path d="M6 4.5l3.5 3.5L6 11.5" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  home: (
    <path d="M2.5 7.25L8 2.75l5.5 4.5v5.25a1 1 0 0 1-1 1h-2.75V10h-3.5v3.5H3.5a1 1 0 0 1-1-1z" />
  ),
  file: (
    <>
      <path d="M4 2.5h5.25l2.75 2.75v8.25H4z" />
      <path d="M9 2.5v3h3" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M6.4 6.4a1.7 1.7 0 0 1 3.2.6c0 1.2-1.6 1.4-1.6 2.5M8 11.4h.01" />
    </>
  ),
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  share: (
    <>
      <path d="M8 9.5v-7M5.25 5.25L8 2.5l2.75 2.75" />
      <path d="M5 7.5h-.5A1.5 1.5 0 0 0 3 9v3a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V9a1.5 1.5 0 0 0-1.5-1.5H11" />
    </>
  ),
  export: (
    <>
      <path d="M8 2.5V10M5.25 7.25L8 10l2.75-2.75" />
      <path d="M2.75 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
    </>
  ),
  pulse: <path d="M1.75 8.5h2.5l1.5-4 2.5 7.5 1.75-5.5 1 2h3.25" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25l3.25 3.25" />
    </>
  ),
  'panel-right': (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2.5" />
      <path d="M10 3v10" />
    </>
  ),
  menu: <path d="M3 4.5h10M3 8h10M3 11.5h6" />,
  problem: (
    <>
      <path d="M8 2.75l5.75 10H2.25z" />
      <path d="M8 6.75v2.5M8 11h.01" />
    </>
  ),
  print: (
    <>
      <path d="M4.5 6V2.5h7V6M4.5 11.5h-1A1.5 1.5 0 0 1 2 10V7.5A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5V10a1.5 1.5 0 0 1-1.5 1.5h-1" />
      <path d="M4.5 9.5h7v4h-7z" />
    </>
  ),
  server: (
    <>
      <rect x="2.5" y="2.75" width="11" height="4.25" rx="1.5" />
      <rect x="2.5" y="9" width="11" height="4.25" rx="1.5" />
      <path d="M5 4.9h.01M5 11.1h.01" />
    </>
  ),
  folder: (
    <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h2.5L8 4.5h4A1.5 1.5 0 0 1 13.5 6v5.5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z" />
  ),
  cloud: (
    <path d="M4.75 12.5a2.75 2.75 0 0 1-.4-5.47A3.75 3.75 0 0 1 11.6 6a3.25 3.25 0 0 1 .15 6.5zM6.25 9.5l1.25 1.25 2.25-2.5" />
  ),
  sync: (
    <path d="M3 7.25a5 5 0 0 1 8.6-3L13 5.5M13 2.5v3h-3M13 8.75a5 5 0 0 1-8.6 3L3 10.5M3 13.5v-3h3" />
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  undo: <path d="M6 3.5L3 6.5l3 3M3 6.5h6.25a3.75 3.75 0 0 1 0 7.5H7.5" />,
  redo: <path d="M10 3.5l3 3-3 3M13 6.5H6.75a3.75 3.75 0 0 0 0 7.5H8.5" />,
  component: (
    <>
      <path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" />
      <path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" />
      <path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" />
      <path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" />
    </>
  ),
  crop: <path d="M4.5 1.75v9.75h9.75M1.75 4.5h9.75v9.75" />,
  system: (
    <>
      <rect x="2.5" y="2.5" width="4.75" height="4.75" rx="1.25" />
      <rect x="8.75" y="2.5" width="4.75" height="4.75" rx="1.25" />
      <rect x="2.5" y="8.75" width="4.75" height="4.75" rx="1.25" />
      <circle cx="11.125" cy="11.125" r="2.375" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2.5" />
      <path d="M5 6.5l2 1.5-2 1.5M8.75 10h2.5" />
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
  insert: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M8 5.5v5M5.5 8h5" />
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
  play: <path d="M5 3.5v9l7.5-4.5z" />,
  'eye-off': (
    <>
      <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" />
      <path d="M2.5 2.5l11 11" />
    </>
  ),
  people: (
    <>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2 13a4 4 0 0 1 8 0M10.5 3.5a2.25 2.25 0 0 1 0 4.25M12 9.25A4 4 0 0 1 14 13" />
    </>
  ),
};

/** One icon by name. Decorative: the label next to it carries the meaning. */
export function Icon({
  name,
  size = 16,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  if (name === 'spark') return <Spark size={size} color="currentColor" />;
  return (
    <svg
      className={`k-ic ${className}`}
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
      {GLYPHS[name] ?? GLYPHS.file}
    </svg>
  );
}

/** The maude mark (assets/logos/mark.svg). */
export function Mark({
  size = 22,
  tile = 'var(--accent)',
  star = 'var(--accent-fg)',
}: {
  size?: number;
  tile?: string;
  star?: string;
}) {
  return (
    <svg
      className="k-ic"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path d="M7 0H25A7 7 0 0 1 32 7V32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z" fill={tile} />
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill={star} />
    </svg>
  );
}

/** The AI spark, the mark's star scaled 26/22 (assets/logos/spark.svg). The AI only. */
export function Spark({ size = 14, color = 'var(--spark)' }: { size?: number; color?: string }) {
  return (
    <svg
      className="k-ic"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 3L19.309 12.691L29 16L19.309 19.309L16 29L12.691 19.309L3 16L12.691 12.691Z"
        fill={color}
      />
    </svg>
  );
}
