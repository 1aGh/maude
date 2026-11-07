/**
 * @file       canvas-theme-icons.tsx — the sun and moon on the Light | Dark switch (2.0.7, Michal: icons only,
 *             a more compact pill). Drawn in the maude-v2 icon grammar (16 grid, live area 2–14, 1.5 round
 *             stroke, `currentColor`) like canvas-ds-icons.tsx, kept apart from DS_GLYPHS because the kit has no
 *             theme glyphs yet (test/canvas-ds-icons.test.tsx pins DS_GLYPHS path for path to the kit).
 *             React-only, no studio imports — the canvas pill and the Design system bar both draw them.
 */

import type { JSX } from 'react';

export type ThemeMode = 'light' | 'dark';

/** The icon for one theme; `aria-hidden` — the button carries the name. */
export function ThemeIcon({ mode, size = 14 }: { mode: ThemeMode; size?: number }): JSX.Element {
  return (
    <svg
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
      {mode === 'light' ? (
        <>
          <circle cx="8" cy="8" r="2.75" />
          <path d="M8 2v1.25M8 12.75V14M2 8h1.25M12.75 8H14M3.75 3.75l.9.9M11.35 11.35l.9.9M3.75 12.25l.9-.9M11.35 4.65l.9-.9" />
        </>
      ) : (
        <path d="M13.25 9.75A5.5 5.5 0 1 1 6.25 2.75a4.25 4.25 0 0 0 7 7z" />
      )}
    </svg>
  );
}

/** The words a person reads for a theme: the button's name and its tooltip. */
export const THEME_WORD: Readonly<Record<ThemeMode, string>> = { light: 'Light', dark: 'Dark' };
