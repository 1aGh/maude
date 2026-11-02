/**
 * @file       annotations/time-marks.ts — S4.16: notes that belong to a moment of a video
 * @scope      apps/studio/annotations/time-marks.ts
 * @purpose    The pure half of "a sticky on a video has a time" (canvas 15 an-video):
 *               - `pinFor`      — the `timeRange` a sticky gets when it is placed on a video at the playhead
 *               - `timeChip`    — the chip's words ("0:12")
 *               - `pinOpacity`  — a note fades (≈ 0.32) while the playhead is outside its range
 *               - `timeMarks`   — S7's selector: every timed note of one video artboard as a bar on the track
 *             No DOM, no React: the layer, the timeline (S7.17) and the tests read the same answers.
 * @invariant  `timeRange` is the format's field (annotations/elements/_shared.ts `timeRangeField`): seconds,
 *             0..86400, `end >= start`, three decimals. Everything minted here already satisfies it, so the
 *             registry never has to refuse a pin.
 */

import type { AnnotationElement } from './types.ts';

/** A note placed on a video covers this many seconds ("0:12–0:15", canvas 15 an-video). */
export const PIN_SECONDS = 3;
/** Off its range a pinned note is dimmed to this, not hidden: the words stay readable (an-video). */
export const OFF_RANGE_OPACITY = 0.32;
/** The format's ceiling for a time (seconds in a day). */
export const MAX_SECONDS = 86_400;

export interface TimeRange {
  artboard: string;
  start: number;
  end: number;
}

/** One bar on the track (S7-slices "S7 ↔ S4": `{ id, t0, t1, colour }`). */
export interface TimeMark {
  id: string;
  t0: number;
  t1: number;
  colour: string;
}

const dp3 = (n: number) => Math.round(n * 1000) / 1000;

/** `0:12`, `1:05`, `1:02:03` — whole seconds, rounded down (a chip never says a moment that has not come). */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The chip a pinned note wears: the moment it starts at. */
export const timeChip = (r: Pick<TimeRange, 'start'>): string => formatTime(r.start);

/** Reads a stored `timeRange` leniently (records come from disk or a peer); undefined when it is not one. */
export function readTimeRange(v: unknown): TimeRange | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.artboard !== 'string' || !r.artboard) return undefined;
  if (typeof r.start !== 'number' || typeof r.end !== 'number') return undefined;
  if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end < r.start) return undefined;
  return { artboard: r.artboard, start: r.start, end: r.end };
}

/**
 * The pin a note gets when it is placed on `artboard` while the playhead is at `t` of a clip `duration`
 * seconds long: `[t, t + 3 s]`, clamped to the end of the clip (a note placed in the last seconds gets a shorter range).
 */
export function pinFor(
  artboard: string,
  t: number,
  duration: number,
  span: number = PIN_SECONDS
): TimeRange {
  const total = Math.min(MAX_SECONDS, Math.max(0, Number.isFinite(duration) ? duration : 0));
  const at = Math.min(Math.max(0, Number.isFinite(t) ? t : 0), total);
  // The pin starts exactly where the playhead was; near the end the range is shorter, never earlier.
  return { artboard, start: dp3(at), end: dp3(Math.min(total, at + span)) };
}

/** Is the playhead inside the note's range? (Both ends count: a note pinned 0:12–0:15 is on at 0:15.) */
export const inRange = (r: Pick<TimeRange, 'start' | 'end'>, t: number): boolean =>
  t >= r.start && t <= r.end;

/**
 * A pinned note's opacity at the playhead: full inside its range, `OFF_RANGE_OPACITY` outside. A note
 * with no pin — or one whose video has no playhead yet — is never dimmed.
 */
export function pinOpacity(range: TimeRange | undefined, playhead: number | null): number {
  if (!range || playhead === null) return 1;
  return inRange(range, playhead) ? 1 : OFF_RANGE_OPACITY;
}

/**
 * S7's selector: the timed notes of one video artboard, earliest first, as bars on the track. `colour` is
 * the note's paper (its `fill`), or '' when it has none, so the track needs no second lookup.
 */
export function timeMarks(board: Iterable<AnnotationElement>, artboardId: string): TimeMark[] {
  const out: TimeMark[] = [];
  for (const el of board) {
    const r = readTimeRange(el.timeRange);
    if (!r || r.artboard !== artboardId) continue;
    out.push({
      id: el.id,
      t0: r.start,
      t1: r.end,
      colour: typeof el.fill === 'string' ? el.fill : '',
    });
  }
  return out.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1 || (a.id < b.id ? -1 : 1));
}

/** The playhead of a video artboard, as the layer reads it (video-comp.tsx `playheadOf`). */
export interface PlayheadReading {
  /** Seconds. */
  t: number;
  /** Seconds. */
  duration: number;
}

/**
 * Pins the stickies that `next` ADDS over `prev` when they belong to a video artboard that has a playhead.
 * Only a new sticky with a `parentArtboard` (the commit path stamps it first — `withMembership`) and no pin
 * of its own: moving, editing or deleting a note never re-times it, and a note that arrives already pinned
 * (an import, a peer, an undo) keeps its range.
 */
export function withTimePins(
  prev: ReadonlyMap<string, AnnotationElement>,
  next: Map<string, AnnotationElement>,
  playheadOf: (artboardId: string) => PlayheadReading | null
): Map<string, AnnotationElement> {
  let out: Map<string, AnnotationElement> | null = null;
  for (const [id, el] of next) {
    if (prev.has(id) || el.type !== 'sticky' || el.timeRange !== undefined) continue;
    const ab = typeof el.parentArtboard === 'string' ? el.parentArtboard : null;
    if (!ab) continue;
    const head = playheadOf(ab);
    if (!head) continue;
    out ??= new Map(next);
    out.set(id, { ...el, timeRange: pinFor(ab, head.t, head.duration) });
  }
  return out ?? next;
}
