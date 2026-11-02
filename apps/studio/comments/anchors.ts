// Comment anchors — where a thread sits, and the V2-1.12 tolerant reader (S9.7).
//
// A comment record (`_comments/<slug>.json`, the canvas doc's `comments` lane) has no version
// field. It grows by adding top-level keys, which every reader since Phase 6 keeps verbatim
// (`api.ts backfillComment` spreads the raw record; V2-1.12 §5.1 R1/R3). So a Maude 1 peer
// carries a Maude 2 anchor through a read and a rewrite untouched, and a Maude 2 reader of a
// Maude 1 record invents nothing. `test/comments-anchors-mixed.test.ts` pins both directions.
//
// The anchors (every one optional; a record with none is an element comment on `selector`):
//   timeline      { clipStableId?, frameOffset?, frame?, lane? } — a video COMP's timeline
//   annotationId  an element `id` on the canvas board (#134/#136)
//   world         { x, y } — a floating comment's place on the canvas (#136)
//   artboard      the DCArtboard id the thread is on (V2-1.4)               — Maude 2
//   t             seconds into that artboard's video (co-comment-video)      — Maude 2
//   mm            { x, y } millimetres from the artboard's trim corner,
//                 top-left, for a print artboard (co-comment-print)          — Maude 2
//
// Every anchor is peer-supplied text (DDR-054): an anchor that fails its shape is DROPPED, never
// guessed at — the thread then renders detached, from `bounds`, and is never deleted. The /design:edit
// agent reads anchors as navigation, so a bounded shape is a security property, not tidiness.
//
// Erasable TypeScript only: the hub (`apps/hub/src/routes-v2/comments.mjs`) imports this under Node.

import { isAnnotationId, isWorldPoint, type WorldPoint } from '../comment-anchor.ts';

/** V2-1.4 artboard ids, plus the `.`/`:` imported boards carry. */
const ARTBOARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
/** A day of video. Anything longer is not a moment in a comp. */
export const MAX_VIDEO_SECONDS = 86_400;
/** Ten metres of paper. */
export const MAX_PRINT_MM = 10_000;

export interface TimelineAnchor {
  clipStableId?: string;
  frameOffset?: number;
  frame?: number;
  lane?: string;
}

export interface PrintPoint {
  x: number;
  y: number;
}

export interface CommentAnchors {
  timeline?: TimelineAnchor;
  annotationId?: string;
  world?: WorldPoint;
  artboard?: string;
  t?: number;
  mm?: PrintPoint;
}

/** The anchor keys this module owns. Every other top-level key is the record's, kept as is. */
export const ANCHOR_KEYS = Object.freeze([
  'timeline',
  'annotationId',
  'world',
  'artboard',
  't',
  'mm',
] as const);

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Today's timeline clamp (`api.ts sanitizeTimelineAnchor`), unchanged. */
export function sanitizeTimeline(raw: unknown): TimelineAnchor | undefined {
  if (!isObject(raw)) return undefined;
  const out: TimelineAnchor = {};
  if (typeof raw.clipStableId === 'string' && raw.clipStableId.length <= 200)
    out.clipStableId = raw.clipStableId;
  if (Number.isFinite(Number(raw.frameOffset)))
    out.frameOffset = Math.max(0, Math.round(Number(raw.frameOffset)));
  if (Number.isFinite(Number(raw.frame))) out.frame = Math.max(0, Math.round(Number(raw.frame)));
  if (typeof raw.lane === 'string' && raw.lane.length <= 40) out.lane = raw.lane;
  return out.clipStableId != null || out.frame != null ? out : undefined;
}

export function isArtboardId(v: unknown): v is string {
  return typeof v === 'string' && ARTBOARD_ID_RE.test(v);
}

/** Seconds into a video, to the millisecond; a number only (a string is not coerced). */
export function sanitizeVideoTime(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  if (raw < 0 || raw > MAX_VIDEO_SECONDS) return undefined;
  return Math.round(raw * 1000) / 1000;
}

/** A point on paper in millimetres, to a tenth; may sit in the bleed (negative). */
export function sanitizePrintPoint(raw: unknown): PrintPoint | undefined {
  if (!isObject(raw)) return undefined;
  const { x, y } = raw;
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (Math.abs(x) > MAX_PRINT_MM || Math.abs(y) > MAX_PRINT_MM) return undefined;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/** The valid anchors of a raw record (or a create payload). Invalid ones are simply absent. */
export function readAnchors(raw: unknown): CommentAnchors {
  const r = isObject(raw) ? raw : {};
  const out: CommentAnchors = {};
  const timeline = sanitizeTimeline(r.timeline);
  if (timeline) out.timeline = timeline;
  if (isAnnotationId(r.annotationId)) out.annotationId = r.annotationId;
  if (isWorldPoint(r.world)) out.world = { x: r.world.x, y: r.world.y };
  if (isArtboardId(r.artboard)) out.artboard = r.artboard;
  const t = sanitizeVideoTime(r.t);
  // A moment needs a board to be a moment ON (the timeline marker, `commentsAt`).
  if (t !== undefined && out.artboard) out.t = t;
  const mm = sanitizePrintPoint(r.mm);
  if (mm && out.artboard) out.mm = mm;
  return out;
}

/**
 * The tolerant read of one stored record: every key it holds is kept (Maude 1 and later fields
 * alike), and each anchor key is replaced by its sanitized value or removed. Never adds a key.
 */
export function withSanitizedAnchors<T extends object>(record: T): T {
  const out: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  const anchors = readAnchors(record) as Record<string, unknown>;
  for (const key of ANCHOR_KEYS) {
    if (key in anchors) out[key] = anchors[key];
    else delete out[key];
  }
  return out as T;
}

/**
 * The threads on one artboard that sit at a moment of its video, earliest first — what the
 * timeline draws as markers (S7's patch note in S9-slices §2 calls it `commentsAt(videoArtboard)`).
 */
export function commentsAt<C extends { artboard?: unknown; t?: unknown }>(
  list: readonly C[],
  artboard: string
): C[] {
  const at: { c: C; t: number }[] = [];
  for (const c of list) {
    if (c.artboard !== artboard) continue;
    const t = sanitizeVideoTime(c.t);
    if (t !== undefined) at.push({ c, t });
  }
  return at.sort((a, b) => a.t - b.t).map((x) => x.c);
}
