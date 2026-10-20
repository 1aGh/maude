// client/v2/timeline/tracks.js — S7.8: the four tracks (C35), derived, never stored.
//
// 07 · the timeline draws exactly four tracks, top to bottom = what covers what: Text · Graphics · Video ·
// Music. A comp's bytes do not change for this (V2-1.12 §5.3): the track of a clip is a pure reading of what
// the comp already says, and it is the SAME reading `video/derive.ts` makes on the server —
//   · a storyline beat (series)                → Video
//   · a standalone video / image / loose media → Video 2 (C35: "existing comps' overlay lanes migrate to Video 2")
//   · a standalone <Audio> (clip or bed)       → Music, and a second one that overlaps it → Music 2
//   · anything with no media of its own        → Text, unless its name says it is a graphic (a logo bug, a badge)
// Video 2 and Music 2 are drawn only when something is on them (S7.18's "+ track" can ask for an empty one).
// Pure: the Timeline hands in its parsed `sequences` and `audio`, it gets back where each one belongs.

/** @typedef {'text'|'gfx'|'video2'|'video'|'music'|'music2'} TrackId */

/** Top to bottom: what covers what. `fixed` tracks are always drawn. */
export const TRACKS = [
  { id: 'text', label: 'Text', icon: 'type', fixed: true },
  { id: 'gfx', label: 'Graphics', icon: 'image', fixed: true },
  { id: 'video2', label: 'Video 2', icon: 'video', fixed: false },
  { id: 'video', label: 'Video', icon: 'video', fixed: true },
  { id: 'music', label: 'Music', icon: 'music', fixed: true },
  { id: 'music2', label: 'Music 2', icon: 'music', fixed: false },
];

const MEDIA_VIDEO = new Set(['Video', 'OffthreadVideo', 'MaudeVideo', 'Img', 'Image']);
/** A hand-authored scene named like a graphic (a logo in the corner, a badge, a URL card) sits on Graphics. */
const GRAPHIC_NAME =
  /logo|graphic|badge|sticker|watermark|\bbug\b|icon|banner|\bcta\b|\burl\b|chip|shape/i;

/** The track of one parsed sequence row. (An audio row's second lane is decided by `deriveTracks`.) */
export function trackOfSequence(seq) {
  if (!seq) return 'video';
  if (seq.series) return 'video';
  if (seq.mediaTag === 'Audio') return 'music';
  if (MEDIA_VIDEO.has(seq.mediaTag) || seq.loose) return 'video2';
  return GRAPHIC_NAME.test(String(seq.label ?? '')) ? 'gfx' : 'text';
}

const overlaps = (a, b) => a.from < b.from + b.duration && b.from < a.from + a.duration;

/**
 * @param {{ sequences?: object[], audio?: object[], extra?: TrackId[] }} input
 *   `sequences` / `audio` as `parseCompTimeline` returns them; `extra` = tracks the person added ("+ track").
 * @returns {{ id: TrackId, label: string, icon: string, fixed: boolean,
 *   members: { kind: 'seq'|'audio', index: number }[] }[]} the drawn tracks, top to bottom
 */
export function deriveTracks({ sequences = [], audio = [], extra = [] } = {}) {
  const by = new Map(TRACKS.map((t) => [t.id, { ...t, members: [] }]));
  const musicSpans = [];
  const lane = (span) => {
    const track = musicSpans.some((o) => overlaps(o, span)) ? 'music2' : 'music';
    musicSpans.push(span);
    return track;
  };
  sequences.forEach((seq, index) => {
    let id = trackOfSequence(seq);
    if (id === 'music') id = lane(seq);
    by.get(id).members.push({ kind: 'seq', index });
  });
  // loose <Audio> beds come after the clips, in document order, like the server's walk
  audio.forEach((a, index) => {
    const id = lane({ from: a.from ?? 0, duration: a.duration ?? 1 });
    by.get(id).members.push({ kind: 'audio', index });
  });
  return TRACKS.filter(
    (t) => t.fixed || by.get(t.id).members.length > 0 || extra.includes(t.id)
  ).map((t) => by.get(t.id));
}
