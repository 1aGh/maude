// client/v2/timeline/marks.jsx — S7.17 (07 · ve-together): what other people left on the video, on the ruler.
//
//   comment flags     a thread pinned to a moment of this video (S9.22 `commentsAt` — `artboard` + `t`): a flag at
//                     that frame; a click opens the thread (`comments.open-thread`, the shell's one runner)
//   time marks        a sticky pinned to a time range of this video (S4.16 `timeMarks`): a bar from its start to its
//                     end in the sticky's paper colour; a click puts the playhead on its start
//
// Comments with the v1 clip anchor (`timeline: { clipStableId, frameOffset }`) keep their 💬 strip in Timeline.jsx;
// this file draws only the v2 moment anchor, so a thread never shows twice. Everything here is read: the comment
// list the shell already holds and the board the Layers list already reads (`boardSource`). Peer-written text is
// only ever a `title`; a colour is used only when it is a plain hex value.

import { useContext, useEffect, useState } from 'react';

import { timeMarks } from '../../../annotations/time-marks.ts';
import { commentsAt } from '../../../comments/anchors.ts';
import { ShellStoreContext } from '../../stores/shell-store.jsx';
import { boardSource } from '../annotations/annotation-list.jsx';

const TEXT_MAX = 120;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const DEFAULT_PAPER = 'var(--object-yellow)';

/** A sticky's paper as a CSS colour: a hex value, else the default paper (never a peer's arbitrary string). */
export function markColour(fill) {
  return typeof fill === 'string' && HEX.test(fill) ? fill : DEFAULT_PAPER;
}

const clip = (s) => String(s ?? '').slice(0, TEXT_MAX);

/**
 * The flags of one video: `commentsAt` over the canvas's comments, minus the v1-anchored ones, at a frame.
 * @returns {Array<{ id: string, frame: number, author: string, resolved: boolean, title: string }>}
 */
export function commentFlags(list, artboardId, fps) {
  if (!artboardId || !Array.isArray(list)) return [];
  const rate = Math.max(1, Math.round(fps || 30));
  return commentsAt(
    list.filter((c) => c && typeof c === 'object' && !c.timeline && typeof c.id === 'string'),
    artboardId
  ).map((c) => {
    const author = clip(c.author || 'Comment');
    return {
      id: c.id,
      frame: Math.round(c.t * rate),
      author,
      resolved: c.status === 'resolved' || c.resolved === true,
      title: `${author}: ${clip(c.text)}`,
    };
  });
}

/**
 * The time marks of one video, in frames, with a safe colour.
 * @returns {Array<{ id: string, f0: number, f1: number, colour: string }>}
 */
export function timeMarkBars(board, artboardId, fps) {
  if (!artboardId || !Array.isArray(board)) return [];
  const rate = Math.max(1, Math.round(fps || 30));
  return timeMarks(board, artboardId).map((m) => ({
    id: m.id,
    f0: Math.round(m.t0 * rate),
    f1: Math.max(Math.round(m.t0 * rate) + 1, Math.round(m.t1 * rate)),
    colour: markColour(m.colour),
  }));
}

/** The shell's thread runner, loaded when a flag is first clicked (it pulls the menu graph — shell-events.js). */
const openThread = (file, id) =>
  import('../shell/menu-runner.js')
    .then((m) => m.menuRunner.run('comments.open-thread', { file, id }))
    .catch(() => false);

/** This canvas's annotation board, re-read when it changes (the Layers list's source). */
function useBoard(file, source = boardSource) {
  const [board, setBoard] = useState([]);
  useEffect(() => {
    if (!file) {
      setBoard([]);
      return undefined;
    }
    let alive = true;
    const load = () =>
      source
        .load(file)
        .then((b) => alive && setBoard(b))
        .catch(() => alive && setBoard([]));
    load();
    const off = source.subscribe(file, load);
    return () => {
      alive = false;
      off();
    };
  }, [file, source]);
  return board;
}

/**
 * Flags and time marks on the ruler of the followed video.
 * @param {{ file: string|null, artboardId: string|null, fps: number, total: number,
 *   x: (frame: number) => number, onSeek?: (frame: number) => void, onOpenThread?: (file: string, id: string) => void,
 *   board?: object[] }} props
 */
export function RulerMarks({ file, artboardId, fps, total, x, onSeek, onOpenThread, board }) {
  const store = useContext(ShellStoreContext);
  const comments = file ? (store?.shellCore?.commentsByFile?.[file] ?? []) : [];
  const read = useBoard(board ? null : file);
  const last = Math.max(0, (total || 1) - 1);
  const at = (f) => Math.min(last, Math.max(0, f));
  const flags = commentFlags(comments, artboardId, fps);
  const bars = timeMarkBars(board ?? read, artboardId, fps);
  if (!flags.length && !bars.length) return null;
  return (
    <>
      {bars.map((b) => (
        <button
          key={`m${b.id}`}
          type="button"
          className="tl-time-mark"
          data-testid={`timeline-time-mark-${b.id}`}
          aria-label="Note on this part of the video"
          style={{
            left: x(at(b.f0)),
            width: Math.max(4, x(at(b.f1)) - x(at(b.f0))),
            background: b.colour,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSeek?.(at(b.f0));
          }}
        />
      ))}
      {flags.map((f) => (
        <button
          key={`c${f.id}`}
          type="button"
          className={`tl-flag${f.resolved ? ' is-resolved' : ''}`}
          data-testid={`timeline-flag-${f.id}`}
          aria-label={`Comment by ${f.author}`}
          title={f.title}
          style={{ left: x(at(f.frame)) }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            (onOpenThread ?? openThread)(file, f.id);
          }}
        />
      ))}
    </>
  );
}
