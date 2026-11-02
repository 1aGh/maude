// client/v2/timeline/comment-strip-model.js — Round 11 (10 · co-comment-video): the read-only comment strip
// Preview draws under a video board — "0:12 / 0:30 · Hype trailer · 2 comments on this video" and each timed
// thread's face at its second (the board's `CommentTimeline`, minus the clips: Preview edits nothing).
// Pure: no DOM, no React — what is drawn is a plain test.
//
// Edit has the same markers on its timeline island (Timeline.jsx `stripComments`); Preview selects no video, so
// no island follows one. This is the strip for that mode and for a video nobody selected.

import { timeMarks } from '../../../annotations/time-marks.ts';
import { mss } from './ruler.js';

// A note's paper as a CSS colour: a plain hex value, else the default paper (a peer's string is never a colour).
// (The same rule as marks.jsx `markColour`; kept here so this model stays free of React and the shell store.)
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const paper = (fill) =>
  typeof fill === 'string' && HEX.test(fill) ? fill : 'var(--object-yellow)';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {{
 *   comments: Array<object> | null | undefined,   the active canvas's threads (`t` seconds + `artboard` id)
 *   board?: Array<object> | null,                  the canvas's annotation board — its notes pinned to a video (`timeRange`)
 *   comps: Array<{ id: string, artboardId?: string, artboardLabel?: string, fps?: number, durationInFrames?: number }>,
 *   compId: string | null,                         the video the shell's playhead follows
 *   frame: number,                                 that playhead
 * }} o
 * @returns {null | {
 *   compId: string, artboardId: string, artboardLabel: string, countLine: string,
 *   readout: { at: string, of: string }, playhead: number,
 *   marks: Array<{ id: string, author: string, text: string, seconds: number, at: number, on: boolean, resolved: boolean }>,
 *   notes: Array<{ id: string, seconds: number, at: number, width: number, on: boolean, colour: string }>,
 * }}
 */
export function commentStrip({ comments, board, comps, compId, frame } = {}) {
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
  const notesOf = (v) =>
    Array.isArray(board) && v?.artboardId ? timeMarks(board, v.artboardId) : [];
  const has = (v) => timed.some((c) => c.artboard === v?.artboardId) || notesOf(v).length > 0;
  // the video the playhead follows, when it has threads or notes; else the first video one is on
  const followed = videos.find((v) => v?.id === compId);
  const comp =
    followed && has(followed)
      ? followed
      : (videos.find((v) => v?.artboardId === timed[0]?.artboard) ?? videos.find(has));
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
  const bars = notesOf(comp).map((n) => {
    const from = Math.max(0, Math.min(0.99, (n.t0 * fps) / total));
    return {
      id: n.id,
      seconds: n.t0,
      at: from,
      width: Math.max(0.01, Math.min(1 - from, ((n.t1 - n.t0) * fps) / total)),
      on: mine && n.t0 <= at / fps && at / fps <= n.t1,
      colour: paper(n.colour),
    };
  });
  const countLine = bars.length
    ? [
        plural(bars.length, 'note', 'notes'),
        marks.length ? plural(marks.length, 'comment', 'comments') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : marks.length === 1
      ? '1 comment on this video'
      : `${marks.length} comments on this video`;
  return {
    compId: comp.id,
    artboardId: comp.artboardId,
    artboardLabel: comp.artboardLabel || comp.artboardId,
    countLine,
    readout: { at: mss(at / fps), of: mss(total / fps) },
    playhead: mine ? at / total : 0,
    marks,
    notes: bars,
  };
}
