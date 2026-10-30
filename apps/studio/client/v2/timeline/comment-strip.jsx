// client/v2/timeline/comment-strip.jsx — Round 11 (10 · co-comment-video): the read-only comment strip of a video
// board in Preview. The island's own material (`.island .tl-island`), the board's header (`0:12 / 0:30`, the
// video's name, "2 comments on this video") and one face per timed thread at its second. A face seeks the
// player to its moment; nothing here edits, adds or removes a thread — the threads live on the picture.
//
// p8-r11-15 (15 · an-video): the same strip also marks the NOTES pinned to this video — a bar in the note's paper
// from its start to its end (the board's `an-tl-mk--st`), and "2 notes · 1 comment" in the header. A click seeks.
//
// Mounted by `CommentStripHost` (Preview only). The model is comment-strip-model.js.

import { Person } from '../share/person.jsx';
import { TGlyph } from './glyphs.jsx';

/**
 * @param {{
 *   strip: ReturnType<typeof import('./comment-strip-model.js').commentStrip>,
 *   placement: { left: number, width: number },
 *   onSeek?: (commentId: string, seconds: number) => void,
 * }} props
 */
export function CommentStrip({ strip, placement, onSeek }) {
  if (!strip) return null;
  return (
    <section
      className="island tl-island tl-island--compact tl-cs"
      data-testid="comment-strip"
      data-artboard={strip.artboardId}
      aria-label="Comments on this video"
      style={{ left: placement.left, width: placement.width }}
    >
      <div className="tl-cs-head">
        <span className="tl-readout" data-testid="comment-strip-readout">
          <b>{strip.readout.at}</b> <span className="tl-readout-len">/ {strip.readout.of}</span>
        </span>
        <span className="tl-name" data-testid="comment-strip-name">
          <TGlyph name="video" size={12} />
          {strip.artboardLabel}
        </span>
        <span className="tl-comments-n" data-testid="comment-strip-count">
          <TGlyph name={strip.notes.length ? 'note' : 'comment'} size={12} />
          {strip.countLine}
        </span>
      </div>
      <div className="tl-cs-track" data-testid="comment-strip-track">
        <span className="tl-cs-line" aria-hidden="true" />
        {strip.playhead > 0 || strip.marks.some((m) => m.on) ? (
          <span
            className="tl-cs-playhead"
            data-testid="comment-strip-playhead"
            aria-hidden="true"
            style={{ left: `${strip.playhead * 100}%` }}
          />
        ) : null}
        {strip.notes.map((n) => (
          <button
            key={n.id}
            type="button"
            className="tl-cs-note"
            data-testid={`comment-strip-note-${n.id}`}
            data-on={n.on ? 'true' : undefined}
            aria-label="Note on this part of the video"
            style={{ left: `${n.at * 100}%`, width: `${n.width * 100}%`, background: n.colour }}
            onClick={() => onSeek?.(n.id, n.seconds)}
          />
        ))}
        {strip.marks.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`tl-cs-mark${m.on ? ' is-on' : ''}${m.resolved ? ' is-resolved' : ''}`}
            data-testid={`comment-strip-mark-${m.id}`}
            title={`${m.author || 'comment'}: ${m.text}`}
            style={{ left: `${m.at * 100}%` }}
            onClick={() => onSeek?.(m.id, m.seconds)}
          >
            <Person name={m.author} size="sm" />
          </button>
        ))}
      </div>
    </section>
  );
}
