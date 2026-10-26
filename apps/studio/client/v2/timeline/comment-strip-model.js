// client/v2/timeline/comment-strip-model.js — Round 11 (10 · co-comment-video): the read-only comment strip
// Preview draws under a video board — "0:12 / 0:30 · Hype trailer · 2 comments on this video" and each timed
// thread's face at its second (the board's `CommentTimeline`, minus the clips: Preview edits nothing).
// Pure: no DOM, no React — what is drawn is a plain test.
//
// Edit has the same markers on its timeline island (Timeline.jsx `stripComments`); Preview selects no video, so
// no island follows one. This is the strip for that mode and for a video nobody selected.

import { mss } from './ruler.js';

/**
 * @param {{
 *   comments: Array<object> | null | undefined,   the active canvas's threads (`t` seconds + `artboard` id)
 *   comps: Array<{ id: string, artboardId?: string, artboardLabel?: string, fps?: number, durationInFrames?: number }>,
 *   compId: string | null,                         the video the shell's playhead follows
 *   frame: number,                                 that playhead
 * }} o
 * @returns {null | {
 *   compId: string, artboardId: string, artboardLabel: string, countLine: string,
 *   readout: { at: string, of: string }, playhead: number,
 *   marks: Array<{ id: string, author: string, text: string, seconds: number, at: number, on: boolean, resolved: boolean }>,
 * }}
 */
export function commentStrip({ comments, comps, compId, frame } = {}) {
  const videos = Array.isArray(comps) ? comps : [];
  const timed = (Array.isArray(comments) ? comments : []).filter(
    (c) =>
      c &&
      typeof c.id === 'string' &&
      typeof c.artboard === 'string' &&
      typeof c.t === 'number' &&
      Number.isFinite(c.t) &&
      c.t >= 0 &&
      videos.some((v) => v?.artboardId === c.artboard)
  );
  if (!timed.length) return null;
  // the video the playhead follows, when it has threads; else the first video a thread is on
  const followed = videos.find((v) => v?.id === compId);
  const comp =
    followed && timed.some((c) => c.artboard === followed.artboardId)
      ? followed
      : videos.find((v) => v?.artboardId === timed[0].artboard);
  if (!comp) return null;
  const fps = Math.max(1, Math.round(comp.fps || 30));
  const total = Math.max(1, Math.round(comp.durationInFrames || 1));
  const mine = comp === followed;
  const at = mine ? Math.max(0, Math.min(total - 1, Math.round(Number(frame) || 0))) : 0;
  const marks = timed
    .filter((c) => c.artboard === comp.artboardId)
    .sort((a, b) => a.t - b.t)
    .map((c) => ({
      id: c.id,
      author: typeof c.author === 'string' ? c.author : '',
      text: typeof c.text === 'string' ? c.text : '',
      seconds: c.t,
      at: Math.max(0, Math.min(1, (c.t * fps) / total)),
      on: mine && Math.floor(at / fps) === Math.floor(c.t),
      resolved: c.status === 'resolved',
    }));
  return {
    compId: comp.id,
    artboardId: comp.artboardId,
    artboardLabel: comp.artboardLabel || comp.artboardId,
    countLine:
      marks.length === 1 ? '1 comment on this video' : `${marks.length} comments on this video`,
    readout: { at: mss(at / fps), of: mss(total / fps) },
    playhead: mine ? at / total : 0,
    marks,
  };
}
