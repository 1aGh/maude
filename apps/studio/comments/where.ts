// Where a comment sits, in words (S9.22; canvases 10/co-comment-video, 10/co-comment-print).
//
// Pure, erasable TypeScript: the canvas overlay (comments-overlay.tsx, in the canvas iframe) and the
// shell's Comments panel (client/v2/comments/*) say the same sentence from the same function, so a
// thread header and a panel row cannot drift.
//
//   video   a moment of an artboard's video — "at 0:12". A pin shows only near its moment.
//   print   a point on paper, in millimetres from the TRIM corner (anchors.ts `mm`) — "14 mm from the
//           left · 2 mm above the trim" (the nearer side of each axis, said the way a printer would).

import { pxToMm, resolvePrintArtboard } from '../print/units.ts';

/** `12` → `0:12`; `754` → `12:34`; `3725` → `1:02:05`. Whole seconds (a moment, not a frame). */
export function formatVideoTime(t: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(t) ? t : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** "at 0:12" — the chip on a thread, a panel row and a timeline flag. */
export const videoChip = (t: number): string => `at ${formatVideoTime(t)}`;

/** A pin on a video shows for this long around its moment (seconds either side). */
export const VIDEO_PIN_WINDOW_S = 0.5;

/**
 * Does a timed pin show at the playhead? `now === null` means the video's playhead is not known
 * (no player on this page): the pin stays, because hiding a comment is worse than showing it early.
 */
export function videoPinVisible(
  t: number,
  now: number | null | undefined,
  windowS: number = VIDEO_PIN_WINDOW_S
): boolean {
  if (now === null || now === undefined || !Number.isFinite(now)) return true;
  return Math.abs(now - t) <= windowS;
}

export interface TrimMm {
  wMm: number;
  hMm: number;
}

/** The trim box of a print artboard from its `print` prop (JSON read off `data-dc-print`), or null. */
export function trimOfPrint(print: unknown): TrimMm | null {
  if (!print || typeof print !== 'object') return null;
  const p = print as { paper?: unknown; orientation?: unknown; bleedMm?: unknown };
  if (typeof p.paper !== 'string') return null;
  try {
    const r = resolvePrintArtboard({
      paper: p.paper,
      orientation: p.orientation === 'landscape' ? 'landscape' : 'portrait',
      ...(typeof p.bleedMm === 'number' ? { bleedMm: p.bleedMm } : {}),
    });
    return { wMm: r.trimWidthMm, hMm: r.trimHeightMm };
  } catch {
    return null;
  }
}

/**
 * A point inside a print artboard, as millimetres from its trim corner. `px` is measured from the
 * artboard's own top-left (the bleed box, unzoomed); the artboard IS the bleed box (print/units.ts),
 * so the trim corner sits one bleed in. Null when the artboard has no readable print prop.
 */
export function mmAtArtboardPx(
  print: unknown,
  px: { x: number; y: number }
): { x: number; y: number } | null {
  if (!print || typeof print !== 'object') return null;
  const p = print as { paper?: unknown; orientation?: unknown; bleedMm?: unknown };
  if (typeof p.paper !== 'string') return null;
  try {
    const r = resolvePrintArtboard({
      paper: p.paper,
      orientation: p.orientation === 'landscape' ? 'landscape' : 'portrait',
      ...(typeof p.bleedMm === 'number' ? { bleedMm: p.bleedMm } : {}),
    });
    const round = (v: number) => Math.round(pxToMm(v) * 10) / 10;
    return { x: round(px.x - r.bleedPx), y: round(px.y - r.bleedPx) };
  } catch {
    return null;
  }
}

const mmWord = (v: number) => `${Math.round(v)} mm`;

/**
 * "14 mm from the left · 2 mm above the trim". With the trim size the NEARER side of each axis is
 * named (right/left, bottom "above the trim"/top "from the top"); without it, left and top. A point
 * outside the trim is in the bleed and says so — the number would only mislead.
 */
export function formatPrintPosition(mm: { x: number; y: number }, trim?: TrimMm | null): string {
  if (trim && (mm.x < 0 || mm.y < 0 || mm.x > trim.wMm || mm.y > trim.hMm)) return 'In the bleed';
  const nearRight = !!trim && mm.x > trim.wMm / 2;
  const nearBottom = !!trim && mm.y > trim.hMm / 2;
  const horizontal = nearRight
    ? `${mmWord(trim.wMm - mm.x)} from the right`
    : `${mmWord(mm.x)} from the left`;
  const vertical = nearBottom
    ? `${mmWord(trim.hMm - mm.y)} above the trim`
    : `${mmWord(mm.y)} from the top`;
  return `${horizontal} · ${vertical}`;
}

export interface WhereInput {
  artboard?: unknown;
  t?: unknown;
  mm?: unknown;
}

export interface Where {
  /** the artboard id, when the comment names one */
  artboard: string | null;
  /** the chip under the header: "at 0:12" / "14 mm from the left · …", else null */
  chip: string | null;
  kind: 'video' | 'print' | 'artboard' | 'canvas';
}

/** What to say about where a comment sits; the artboard's NAME is the caller's (it reads the DOM / meta). */
export function whereOf(c: WhereInput, trim?: TrimMm | null): Where {
  const artboard = typeof c.artboard === 'string' && c.artboard ? c.artboard : null;
  if (typeof c.t === 'number' && Number.isFinite(c.t))
    return { artboard, chip: videoChip(c.t), kind: 'video' };
  const mm = c.mm as { x?: unknown; y?: unknown } | undefined;
  if (mm && typeof mm.x === 'number' && typeof mm.y === 'number')
    return {
      artboard,
      chip: formatPrintPosition({ x: mm.x, y: mm.y }, trim),
      kind: 'print',
    };
  return { artboard, chip: null, kind: artboard ? 'artboard' : 'canvas' };
}
