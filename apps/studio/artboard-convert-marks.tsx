/**
 * @file       artboard-convert-marks.tsx — V2-8.5 c7 (08 ak-convert-after).
 * @scope      apps/studio/artboard-convert-marks.tsx
 * @purpose    The two marks the board draws right after "Make A6 print": "✓ Unchanged" under the post that stays as
 *             it was, and "+ 13 % height · Ink fill" beside the copy where the extra height is background. They come
 *             from the shell's `convert-marks` message (words only: from, to, a percent, a fill name — the canvas builds
 *             the strings), stay a few seconds, and are a mark on the canvas, never part of the design: they carry
 *             `.dc-artboard-guides` (the one class every exporter hides), sit OUTSIDE `.dc-artboard`, and are
 *             aria-hidden / pointer-events none.
 */

import { useSyncExternalStore } from 'react';

export interface ConvertMarks {
  from: string;
  to: string;
  extraPct: number;
  fill: string | null;
}

/** How long the marks stay up. */
export const CONVERT_MARKS_MS = 12000;

let current: ConvertMarks | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const notify = () => {
  for (const fn of subs) fn();
};

/** Show the marks (and take them back after `CONVERT_MARKS_MS`). `null` clears them. */
export function setConvertMarks(next: ConvertMarks | null): void {
  if (timer) clearTimeout(timer);
  timer = null;
  current = next;
  if (next) timer = setTimeout(() => setConvertMarks(null), CONVERT_MARKS_MS);
  notify();
}

export const getConvertMarks = (): ConvertMarks | null => current;
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};

/** "✓ Unchanged" — the post that stays. */
export const UNCHANGED_WORDS = '✓ Unchanged';

/** "+ 13 % height · Ink fill" — the copy's extra height, and what it is filled with. */
export const extraWords = (pct: number, fill: string | null): string =>
  `+ ${Math.round(pct)} % height${fill ? ` · ${fill} fill` : ''}`;

/** Of a board scaled to the paper's width, how tall the added background is (the percent is of the scaled design). */
export const extraHeightPx = (h: number, pct: number): number =>
  pct > 0 ? Math.round((h * pct) / (100 + pct)) : 0;

const TAG_BG = 'oklch(95% 0.03 250)';
const TAG_FG = 'oklch(38% 0.12 250)';
const TAG_EDGE = 'oklch(70% 0.1 250)';
const TAG_FONT = '600 12px/16px system-ui, -apple-system, sans-serif';

/** The marks of ONE artboard, in world coordinates. Renders nothing unless this board is named by the message. */
export function ArtboardConvertMarks({
  id,
  x,
  y,
  w,
  h,
  show = true,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  show?: boolean;
}) {
  const marks = useSyncExternalStore(subscribe, getConvertMarks, getConvertMarks);
  if (!show || !marks) return null;
  if (marks.from === id)
    return (
      <div
        className="dc-artboard-guides dc-convert-unchanged"
        data-testid="artboard-convert-unchanged"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: x,
          top: y + h + 16,
          padding: '3px 8px',
          borderRadius: 999,
          border: `1px solid ${TAG_EDGE}`,
          background: TAG_BG,
          color: TAG_FG,
          font: TAG_FONT,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {UNCHANGED_WORDS}
      </div>
    );
  if (marks.to === id && marks.extraPct > 0) {
    const bar = extraHeightPx(h, marks.extraPct);
    return (
      <div
        className="dc-artboard-guides dc-convert-extra"
        data-testid="artboard-convert-extra"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: x + w + 6,
          top: y + h - Math.max(bar, 20),
          height: Math.max(bar, 20),
          display: 'flex',
          alignItems: 'flex-end',
          gap: 6,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{ alignSelf: 'stretch', width: 3, borderRadius: 2, background: TAG_EDGE }}
        />
        <span
          style={{
            padding: '3px 8px',
            borderRadius: 6,
            border: `1px solid ${TAG_EDGE}`,
            background: TAG_BG,
            color: TAG_FG,
            font: TAG_FONT,
            whiteSpace: 'nowrap',
          }}
        >
          {extraWords(marks.extraPct, marks.fill)}
        </span>
      </div>
    );
  }
  return null;
}
ArtboardConvertMarks.displayName = 'ArtboardConvertMarks';
