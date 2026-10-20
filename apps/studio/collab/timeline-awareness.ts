// collab/timeline-awareness.ts — S7.17 (07 · ve-together): two awareness fields for working on one video together.
//
//   timeline  { artboardId, frame }                         where this person's playhead is, on the video
//                                                           artboard their timeline follows; null = no timeline
//   editing   { since }                                     Phase 30 soft "editing" heads-up (unchanged)
//             { since, kind: 'caption-word', artboardId, wordKey }
//                                                           the caption word this person is fixing — a SOFT
//                                                           lock (Gate 0 A10): others see it as hers and their
//                                                           UI refuses to touch it; no server refuses on it
//                                                           (V2-1.15 §13, DDR-120 kept)
//
// `editing` keeps its Phase 30 name and its `since`: a v1 peer reads `{ since }` out of the caption form and
// shows the soft "editing" badge it always showed — which is true. Nothing is versioned (awareness is never
// written to disk).
//
// Both are UNTRUSTED on the way in (DDR-054): known keys only, ids in their V2-1.4 grammar, ints bounded,
// a bounded word key with no control characters. A bad member drops the WHOLE field (null), never a part.
//
// Who may see / publish them (the relay strip, `collab/room.ts` + `apps/hub/src/present-strip.mjs`):
//   - a presentation FOLLOWER (receive-only `follow` capability — a person outside the project) never
//     receives `timeline` or `editing` (MEMBER_ONLY_FIELDS);
//   - a read-only connection (no `edit` on the canvas) never publishes `editing` (EDITOR_ONLY_FIELDS) —
//     a viewer cannot fix a caption, so its claim to be fixing one would only lock other people out.
//
// Pure: no React, no DOM.

/** The artboard id grammar the other awareness fields use (S3 `present.artboardId`). */
const ARTBOARD_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Frames: a 2-hour video at 120 fps is 864 000; anything past this bound is not a playhead. */
export const TIMELINE_FRAME_MAX = 10_000_000;
/** A caption word key (`transcript-model.js` `wordKey`: `src|wordId|clip`), bounded. */
export const WORD_KEY_MAX = 512;
/** A clock skew we accept on `since` (the same ±5 s Phase 30 allows). */
const SINCE_SKEW_MS = 5000;

export interface TimelineAwareness {
  artboardId: string;
  frame: number;
}

export interface CaptionWordEditing {
  since: number;
  kind: 'caption-word';
  artboardId: string;
  wordKey: string;
}

export type EditingAwareness = { since: number } | CaptionWordEditing;

/** Awareness fields a person outside the project (a presentation follower) never receives. */
export const MEMBER_ONLY_FIELDS: readonly string[] = Object.freeze(['timeline', 'editing']);
/** Awareness fields a connection without `edit` on the canvas never publishes. */
export const EDITOR_ONLY_FIELDS: readonly string[] = Object.freeze(['editing']);

const TIMELINE_KEYS = ['artboardId', 'frame'];
const CAPTION_KEYS = ['since', 'kind', 'artboardId', 'wordKey'];

const isPlainObj = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;

const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(o).every((k) => allowed.includes(k));

/** A word key as the caption lane and the Transcript panel name a word: `src|wordId|clip`, bounded, no controls. */
export function isWordKey(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 5 || v.length > WORD_KEY_MAX) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 32 || c === 127) return false;
  }
  return v.split('|').length >= 3;
}

/** The `timeline` field, validated whole: `{ artboardId, frame }` or null. */
export function sanitizeTimeline(raw: unknown): TimelineAwareness | null {
  if (!isPlainObj(raw) || !onlyKeys(raw, TIMELINE_KEYS)) return null;
  const { artboardId, frame } = raw;
  if (typeof artboardId !== 'string' || !ARTBOARD_RE.test(artboardId)) return null;
  if (
    typeof frame !== 'number' ||
    !Number.isInteger(frame) ||
    frame < 0 ||
    frame > TIMELINE_FRAME_MAX
  )
    return null;
  return { artboardId, frame };
}

/**
 * The `editing` field, validated whole. `{ since }` alone is Phase 30's heads-up (extra keys ignored, as a
 * v1 reader does); a `kind` makes it a caption word, where every member must be right or the field is null.
 */
export function sanitizeEditing(raw: unknown, now: number = Date.now()): EditingAwareness | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const since = e.since;
  if (typeof since !== 'number' || !Number.isFinite(since) || since <= 0) return null;
  if (since > now + SINCE_SKEW_MS) return null;
  if (!('kind' in e)) return { since };
  if (!isPlainObj(raw) || !onlyKeys(e, CAPTION_KEYS)) return null;
  if (e.kind !== 'caption-word') return null;
  if (typeof e.artboardId !== 'string' || !ARTBOARD_RE.test(e.artboardId)) return null;
  if (!isWordKey(e.wordKey)) return null;
  return { since, kind: 'caption-word', artboardId: e.artboardId, wordKey: e.wordKey };
}

/** The caption word an `editing` value holds, or null. */
export function captionWordOf(
  editing: EditingAwareness | null | undefined
): CaptionWordEditing | null {
  return editing && 'kind' in editing && editing.kind === 'caption-word' ? editing : null;
}
