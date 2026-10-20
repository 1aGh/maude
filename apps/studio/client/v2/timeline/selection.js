// client/v2/timeline/selection.js — S7.10: the clip the Timeline has selected, as the right-hand inspector sees it.
//
// "Clip select → right inspector" (07 · ve-select, ve-text): a clip is not an element of the canvas, so the
// canvas's own selection payload can not carry it. The Timeline (which owns the selection and the verb pipe)
// publishes ONE snapshot here; the inspector panel turns it into the selection the frame draws (kind `clip` or
// `title`, kinds/clip.jsx) and a canvas selection releases it again. Nothing is stored: it is the Timeline's
// live state, gone when the Timeline is.
//
// The snapshot (everything the rows read and the one function they write through):
//   { kind: 'clip' | 'title', canvas, artboardId, fps, label, stableId,
//     seq: { from, duration, mediaTag, mediaSrc, mediaProps, fit, titleMotion, titleStyle, series, textValue, rowKind },
//     transitionAfter: { k, stableId, dur, presentation } | null,
//     onVerb: (verb, params) => Promise<any>,   // clip.<verb> through the shell's one pipe (undo, toasts, refusals)
//     onOp: (op, params) => Promise<any>,       // video.<op>: the same pipe for the video.* edit ops
//     deselect: () => void }                    // clear the Timeline's own highlight

import { useSyncExternalStore } from 'react';

let current = null;
let version = 0;
const subs = new Set();
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

/** Same selection, same numbers — a refetch that changed nothing must not redraw the inspector. */
function same(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind || a.stableId !== b.stableId || a.canvas !== b.canvas) return false;
  if (a.artboardId !== b.artboardId || a.fps !== b.fps || a.label !== b.label) return false;
  try {
    return (
      JSON.stringify([a.seq, a.transitionAfter]) === JSON.stringify([b.seq, b.transitionAfter])
    );
  } catch {
    return false;
  }
}

export const timelineSelection = {
  get: () => current,
  /** The Timeline's selection changed (or its numbers did). `null` = nothing selected. */
  set(next) {
    if (same(current, next)) {
      // keep the newest closures (they close over the live pipe) without redrawing
      if (current && next)
        Object.assign(current, {
          onVerb: next.onVerb,
          onOp: next.onOp,
          probeSources: next.probeSources,
          changeSong: next.changeSong,
          onJoin: next.onJoin,
          onRemoveJoin: next.onRemoveJoin,
          deselect: next.deselect,
        });
      return;
    }
    current = next;
    notify();
  },
  /** A canvas selection took over: clear the Timeline's highlight too, so one thing is selected at a time. */
  release() {
    if (!current) return;
    const d = current.deselect;
    current = null;
    notify();
    try {
      d?.();
    } catch {
      /* the Timeline may be gone */
    }
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  version: () => version,
};

/** The Timeline's selected clip, or null. */
export function useTimelineSelection() {
  useSyncExternalStore(
    timelineSelection.subscribe,
    timelineSelection.version,
    timelineSelection.version
  );
  return timelineSelection.get();
}

/**
 * The selection object the inspector frame draws for a published clip: element-shaped (`tag`, `text`, `attrs`),
 * with NO `id`, `selector` or `artboardId` — so nothing treats it as a canvas element or an artboard — and the
 * snapshot on `timeline`.
 */
export function timelineSelectionElement(sel) {
  if (!sel) return null;
  return { tag: sel.kind, text: sel.label, attrs: {}, timeline: sel, file: sel.canvas };
}
