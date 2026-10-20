// client/v2/timeline/edit/drop.jsx — S7.9 (07 · ve-drop): footage dragged in from Finder or Assets.
//
//   over the timeline → the caret where the clips land and `Drop 3 clips at 0:09` over `the video grows by
//                       what you drop` (a Finder drag cannot say how long its files are until they land);
//   over the artboard → they go to the end. While a file drag is anywhere over the window, the shell tells the
//                       canvas (`timeline-drop-hint`) to show the chip "Or drop here — adds at the end", and a
//                       catcher over the artboard's rect takes the drop, so the iframe needs no drop handler.
//
// The write is one `clip.insert` edit-op per file (client/v2/timeline/clip-verb.js `runInsertClip`).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { dropTip } from './words.js';

/** Is this drag carrying files? (dataTransfer.types is all a dragover may read.) */
export const hasFiles = (dt) => Array.from(dt?.types ?? []).includes('Files');

/** How many files a drag carries (dragover can count `items`, never read `files`). */
export const fileCount = (dt) =>
  Math.max(1, Array.from(dt?.items ?? []).filter((i) => i.kind === 'file').length || 1);

/** The tip beside the caret where clips land (the caret itself is the Timeline's `tl-drop-caret`). `x` is axis px. */
export function DropLanding({ x, count, atFrame, fps }) {
  const tip = dropTip({ count, atFrame, addedFrames: null, fps });
  return (
    <span className="tl-trim-tip tl-tip" data-testid="timeline-drop-tip" style={{ left: x + 8 }}>
      <span className="tl-tip-title">{tip.title}</span>
      <span className="tl-tip-dim">{tip.dim}</span>
    </span>
  );
}

/**
 * True while a file drag is anywhere over the window (enter / leave are counted, as they fire for every child).
 * `enabled: false` stands down (no video artboard to drop on).
 */
export function useFileDrag(enabled) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setOn(false);
      return undefined;
    }
    let depth = 0;
    const enter = (e) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth += 1;
      setOn(true);
    };
    const leave = (e) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOn(false);
    };
    const end = () => {
      depth = 0;
      setOn(false);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', end, true);
    window.addEventListener('dragend', end, true);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', end, true);
      window.removeEventListener('dragend', end, true);
      setOn(false);
    };
  }, [enabled]);
  return on;
}

/**
 * Over the artboard: a transparent catcher on its rect while files are in flight. The chip itself is the
 * canvas's (editing/drop-chip.tsx); this only takes the drop and hands the files to `onFiles` ("adds at the end").
 * @param {{ rect: { left: number, top: number, width: number, height: number }, onFiles: (files: File[]) => void }} p
 */
export function ArtboardDropCatcher({ rect, onFiles }) {
  if (!rect || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="tl-artboard-drop"
      data-testid="timeline-artboard-drop"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) onFiles(files);
      }}
    />,
    document.body
  );
}
